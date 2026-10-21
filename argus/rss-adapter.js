import { parseFeed } from "./vendor/feedsmith.js";

export const rssAdapter = {
  async fetch(column) {
    const url = column.feedUrl;
    if (!url) throw new Error("No feed URL configured");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);

    const xml = await res.text();
    const feed = parseFeed(xml);
    return (feed.items || []).slice(0, 30).map(item => ({
      id: item.link || item.guid || String(Math.random()),
      author: feed.title || column.title,
      handle: feed.title || "",
      text: item.title || "(untitled)",
      createdAt: item.pubDate || item.published || null,
      url: item.link || null
    }));
  }
};
