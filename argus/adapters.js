const XRPC = "https://bsky.social/xrpc";
const refreshes = new Map();
let bskyQueue = Promise.resolve();
let lastBskyRequest = 0;
const BSKY_MIN_GAP_MS = 101; // At most ~2,970 requests per rolling five-minute window.

export const adapters = {
  bluesky: {
    async login({ handle, appPassword } = {}) {
      const identifier = String(handle || "").trim();
      const password = String(appPassword || "").trim();
      if (!identifier || !password) throw new Error("Enter your Bluesky handle and app password.");
      const res = await bskyFetch(`${XRPC}/com.atproto.server.createSession`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password })
      });
      if (!res.ok) throw await apiError("Bluesky login", res);
      const session = await res.json();
      if (!session.accessJwt || !session.refreshJwt || !session.handle) {
        throw new Error("Bluesky returned an incomplete session.");
      }
      return {
        platform: "bluesky",
        username: session.handle,
        token: session.accessJwt,
        refreshToken: session.refreshJwt,
        did: session.did
      };
    },

    async fetchHome(account) {
      const data = await authenticatedGet(account, `${XRPC}/app.bsky.feed.getTimeline?limit=30`);
      return (data.feed || []).map(entry => mapPost(entry.post));
    },

    async fetchHashtag(account, tag) {
      const normalized = String(tag || "").trim().replace(/^#+/, "");
      if (!normalized) throw new Error("Enter a hashtag (without the #).");
      const q = encodeURIComponent(`#${normalized}`);
      const data = await authenticatedGet(account, `${XRPC}/app.bsky.feed.searchPosts?q=${q}&limit=30`);
      return (data.posts || []).map(mapPost);
    }
  }
};

async function authenticatedGet(account, url) {
  let res = await bskyFetch(url, { headers: { Authorization: `Bearer ${account.token}` } });
  if (res.status === 401 && account.refreshToken) {
    const key = account.did || account.id || account.username || account.refreshToken;
    let refreshPromise = refreshes.get(key);
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const refreshed = await bskyFetch(`${XRPC}/com.atproto.server.refreshSession`, {
          method: "POST",
          headers: { Authorization: `Bearer ${account.refreshToken}` }
        });
        if (!refreshed.ok) throw await apiError("Bluesky session refresh", refreshed);
        const session = await refreshed.json();
        if (!session.accessJwt) throw new Error("Bluesky returned an incomplete refreshed session. Please sign in again.");
        return { token: session.accessJwt, refreshToken: session.refreshJwt || account.refreshToken };
      })();
      refreshes.set(key, refreshPromise);
      refreshPromise.finally(() => refreshes.delete(key)).catch(() => {});
    }
    const session = await refreshPromise;
    account.token = session.token;
    account.refreshToken = session.refreshToken;
    res = await bskyFetch(url, { headers: { Authorization: `Bearer ${account.token}` } });
  }
  if (!res.ok) throw await apiError("Bluesky feed", res);
  return res.json();
}

async function apiError(label, response) {
  if (response.status === 429) {
    const retry = response.headers.get("Retry-After");
    return new Error(`${label} rate limited (429).${retry ? ` Retry after ${retry} seconds.` : " Try again later."}`);
  }
  if (response.status === 401 || response.status === 403) {
    return new Error(`${label} unauthorized (${response.status}). Check your credentials or sign in again.`);
  }
  return new Error(`${label} failed (${response.status}).`);
}

function mapPost(post) {
  const handle = post?.author?.handle || "";
  const rkey = String(post?.uri || "").split("/").pop();
  return {
    id: post?.uri || `${handle}:${rkey}`,
    author: post?.author?.displayName || handle || "Unknown author",
    handle,
    text: post?.record?.text || "",
    createdAt: post?.record?.createdAt || null,
    url: handle && rkey ? `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}` : null
  };
}

function bskyFetch(url, options) {
  const request = bskyQueue.then(async () => {
    const wait = Math.max(0, BSKY_MIN_GAP_MS - (Date.now() - lastBskyRequest));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastBskyRequest = Date.now();
    return fetch(url, options);
  });
  bskyQueue = request.catch(() => {});
  return request;
}
