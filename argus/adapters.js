export const adapters = {
  bluesky: {
    async login({ handle, appPassword }) {
      const res = await fetch(
        "https://bsky.social/xrpc/com.atproto.server.createSession",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: handle, password: appPassword })
        }
      );
      if (!res.ok) throw new Error(`Bluesky login failed: ${res.status}`);
      const s = await res.json();
      return {
        platform: "bluesky",
        username: s.handle,
        token: s.accessJwt,
        refreshToken: s.refreshJwt,
        did: s.did
      };
    },
    async fetchHome(account) {
      const res = await fetch(
        "https://bsky.social/xrpc/app.bsky.feed.getTimeline?limit=30",
        { headers: { Authorization: `Bearer ${account.token}` } }
      );
      if (!res.ok) throw new Error(`Bluesky timeline failed: ${res.status}`);
      const data = await res.json();
      return (data.feed || []).map(e => mapPost(e.post));
    },
    async fetchHashtag(account, tag) {
      const q = encodeURIComponent("#" + tag);
      const res = await fetch(
        `https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=${q}&limit=30`,
        { headers: { Authorization: `Bearer ${account.token}` } }
      );
      if (!res.ok) throw new Error(`Bluesky search failed: ${res.status}`);
      const data = await res.json();
      return (data.posts || []).map(mapPost);
    }
  }
};

function mapPost(post) {
  return {
    id: post.uri,
    author: post.author?.displayName || post.author?.handle || "",
    handle: post.author?.handle || "",
    text: post.record?.text || "",
    createdAt: post.record?.createdAt || null,
    url: post.author?.handle
      ? `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split("/").pop()}`
      : null
  };
}
