// Small browser-native RSS 2.0, Atom, RDF/RSS 1.0 and JSON Feed parser.
// Kept local so feeds never require remote code. Uses DOMParser, not HTML insertion.
export function parseFeed(input) {
  const text = String(input || "").trim();
  if (text.startsWith("{")) {
    const f = JSON.parse(text);
    return { title: f.title || "", items: (f.items || []).map(i => ({
      title: i.title, link: i.url || i.external_url, published: i.date_published || i.date_modified,
      guid: i.id
    })) };
  }
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Feed is not valid XML");
  const root = doc.documentElement;
  const atom = root.localName.toLowerCase() === "feed";
  const nodes = atom ? [...root.children].filter(n => n.localName === "entry") : [...doc.getElementsByTagName("item")];
  const val = (node, name) => [...node.children].find(n => n.localName.toLowerCase() === name.toLowerCase())?.textContent?.trim() || "";
  const linkFor = n => {
    if (!atom) return val(n, "link");
    const links = [...n.children].filter(x => x.localName === "link");
    return (links.find(x => !x.getAttribute("rel") || x.getAttribute("rel") === "alternate") || links[0])?.getAttribute("href") || "";
  };
  const channel = atom ? root : [...doc.getElementsByTagName("channel")][0] || root;
  return { title: val(channel, "title"), items: nodes.map(n => ({
    title: val(n, "title"), link: linkFor(n), guid: val(n, "guid") || val(n, "id"),
    pubDate: val(n, "pubDate") || val(n, "published") || val(n, "updated") || val(n, "date")
  })) };
}
