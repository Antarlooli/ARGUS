const API = "https://a.4cdn.org";
const CDN = "https://i.4cdn.org";

let queue = Promise.resolve();
let lastHit = 0;
const MIN_GAP = 1100;

function rateLimited(fn) {
  const next = queue.then(async () => {
    const wait = Math.max(0, MIN_GAP - (Date.now() - lastHit));
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastHit = Date.now();
    return fn();
  });
  queue = next.catch(() => {});
  return next;
}

const cache = {
  boards: { data: null, at: 0 },
  catalog: new Map(),
  thread: new Map()
};
const BOARDS_TTL  = 24 * 60 * 60 * 1000;
const CATALOG_TTL = 60 * 1000;
const THREAD_TTL  = 30 * 1000;
const pending = new Map();

function coalesce(key, task) {
  if (pending.has(key)) return pending.get(key);
  const promise = task().finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

export const fourChanAdapter = {
  async getBoards(force = false) {
    const c = cache.boards;
    if (!force && c.data && Date.now() - c.at < BOARDS_TTL) return c.data;
    const res = await rateLimited(() => fetch(`${API}/boards.json`));
    if (!res.ok) throw new Error(`Boards failed (${res.status})`);
    const json = await res.json();
    cache.boards = { data: json.boards || [], at: Date.now() };
    return cache.boards.data;
  },

  async getCatalog(board, force = false) {
    const c = cache.catalog.get(board);
    if (!force && c && Date.now() - c.at < CATALOG_TTL) return c.items;
    return coalesce(`catalog:${board}`, async () => {
      const headers = {};
      if (c?.lastModified) headers["If-Modified-Since"] = c.lastModified;
      const res = await rateLimited(() => fetch(`${API}/${board}/catalog.json`, { headers }));
      if (res.status === 304 && c) { c.at = Date.now(); return c.items; }
      if (!res.ok) throw new Error(`Catalog /${board}/ failed (${res.status}${res.statusText ? ` ${res.statusText}` : ""}).`);
      const pages = await res.json();
      if (!Array.isArray(pages)) throw new Error(`Catalog /${board}/ returned an invalid response.`);
      const items = pages.flatMap(page => Array.isArray(page.threads) ? page.threads : [])
        .map(thread => normalizeThread(board, thread));
      cache.catalog.set(board, { items, at: Date.now(), lastModified: res.headers.get("Last-Modified") });
      return items;
    });
  },

  async getThread(board, no, force = false) {
    if (!/^[a-z0-9]+$/i.test(board) || !/^\d+$/.test(String(no))) throw new Error("Invalid board or thread number.");
    const key = `${board}:${no}`;
    const c = cache.thread.get(key);
    if (!force && c && Date.now() - c.at < THREAD_TTL) return c.data;
    return coalesce(`thread:${key}`, async () => {
      const res = await rateLimited(() => fetch(`${API}/${board}/thread/${no}.json`));
      if (!res.ok) throw new Error(`Thread #${no} on /${board}/ failed (${res.status}).`);
      const json = await res.json();
      if (!Array.isArray(json.posts)) throw new Error(`Thread #${no} returned an invalid response.`);
      const posts = json.posts.map(post => normalizePost(board, post));
      const data = { board, threadNo: no, posts };
      cache.thread.set(key, { data, at: Date.now() });
      return data;
    });
  }
};

function normalizeThread(board, t) {
  return {
    board, no: t.no,
    subject: t.sub || "", comment: t.com || "",
    name: t.name || "Anonymous",
    time: t.time ? new Date(t.time * 1000) : null,
    replies: t.replies || 0, images: t.images || 0,
    sticky: !!t.sticky, closed: !!t.closed,
    image: t.tim ? imageMeta(board, t) : null,
    url: `https://boards.4chan.org/${board}/thread/${t.no}`
  };
}

function normalizePost(board, p) {
  return {
    board, no: p.no, resto: p.resto || 0, isOP: !p.resto,
    name: p.name || "Anonymous",
    tripcode: p.trip || null, capcode: p.capcode || null,
    subject: p.sub || "", comment: p.com || "",
    time: p.time ? new Date(p.time * 1000) : null,
    image: p.tim ? imageMeta(board, p) : null,
    url: `https://boards.4chan.org/${board}/thread/${p.resto || p.no}#p${p.no}`
  };
}

function imageMeta(board, o) {
  return {
    thumb: `${CDN}/${board}/${o.tim}s.jpg`,
    full:  `${CDN}/${board}/${o.tim}${o.ext}`,
    filename: o.filename, ext: o.ext,
    w: o.w, h: o.h, fsize: o.fsize
  };
}
