import { fourChanAdapter } from "./fourchan-adapter.js";

export async function populateBoardPicker(selectEl) {
  const boards = await fourChanAdapter.getBoards();
  const ws = boards.filter(b => b.ws_board).sort((a, b) => a.board.localeCompare(b.board));
  const nsfw = boards.filter(b => !b.ws_board).sort((a, b) => a.board.localeCompare(b.board));
  selectEl.replaceChildren();
  for (const [label, list] of [["Worksafe", ws], ["NSFW", nsfw]]) {
    if (!list.length) continue;
    const og = document.createElement("optgroup");
    og.label = label;
    for (const b of list) {
      const o = document.createElement("option");
      o.value = b.board;
      o.textContent = `/${b.board}/ — ${b.title}`;
      og.append(o);
    }
    selectEl.append(og);
  }
}

const catalogRequest = new WeakMap();
export async function renderCatalog(container, board, onOpenThread) {
  const requestId = (catalogRequest.get(container) || 0) + 1;
  catalogRequest.set(container, requestId);
  container.replaceChildren(message(`Loading /${board}/ catalog…`));
  let items;
  try { items = await fourChanAdapter.getCatalog(board); }
  catch (e) {
    if (catalogRequest.get(container) === requestId) container.replaceChildren(retryMessage(`Could not load /${board}/: ${e.message}`, () => renderCatalog(container, board, onOpenThread)));
    return;
  }
  if (catalogRequest.get(container) !== requestId) return;
  if (!items.length) { container.replaceChildren(message("No threads on this board.")); return; }

  const grid = document.createElement("div");
  grid.className = "catalog-grid";
  for (const t of items) grid.append(catalogCard(t, onOpenThread));
  container.replaceChildren(grid);
}

function catalogCard(t, onOpenThread) {
  const card = document.createElement("article");
  card.className = "thread-card" + (t.sticky ? " sticky" : "");
  card.tabIndex = 0;

  if (t.image) {
    const img = document.createElement("img");
    img.src = t.image.thumb;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.alt = "";
    attachHoverZoom(img, t.image);
    img.addEventListener("click", e => { e.stopPropagation(); openLightbox(t.image); });
    card.append(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "no-image";
    card.append(ph);
  }

  const meta = document.createElement("div");
  meta.className = "thread-meta";
  meta.textContent = `R:${t.replies} · I:${t.images}` + (t.sticky ? " · sticky" : "");
  card.append(meta);

  if (t.subject) {
    const sub = document.createElement("div");
    sub.className = "thread-subject";
    sub.textContent = t.subject;
    card.append(sub);
  }
  if (t.comment) {
    const body = document.createElement("div");
    body.className = "thread-body";
    body.append(sanitize(t.comment));
    card.append(body);
  }

  const open = () => onOpenThread(t);
  card.addEventListener("click", open);
  card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });
  return card;
}

let threadModal = null;
let threadRequest = 0;
function ensureThreadModal() {
  if (threadModal) return threadModal;
  threadModal = document.createElement("dialog");
  threadModal.className = "thread-modal";
  threadModal.innerHTML = `
    <header class="thread-header">
      <span class="thread-title">Thread</span>
      <a class="thread-external" target="_blank" rel="noopener noreferrer">Open on 4chan ↗</a>
      <button class="thread-close" aria-label="Close">✕</button>
    </header>
    <div class="thread-body-scroll"></div>
  `;
  document.body.append(threadModal);
  threadModal.querySelector(".thread-close").addEventListener("click", () => threadModal.close());
  threadModal.addEventListener("click", e => { if (e.target === threadModal) threadModal.close(); });
  return threadModal;
}

export async function openThread(board, threadNo) {
  const modal = ensureThreadModal();
  const title = modal.querySelector(".thread-title");
  const ext   = modal.querySelector(".thread-external");
  const body  = modal.querySelector(".thread-body-scroll");

  title.textContent = `/${board}/ — thread #${threadNo}`;
  ext.href = `https://boards.4chan.org/${board}/thread/${threadNo}`;
  const requestId = ++threadRequest;
  body.replaceChildren(message(`Loading /${board}/ thread #${threadNo}…`));
  modal.showModal();

  let data;
  try { data = await fourChanAdapter.getThread(board, threadNo); }
  catch (e) {
    if (requestId === threadRequest) body.replaceChildren(retryMessage(`Could not load thread: ${e.message}`, () => openThread(board, threadNo)));
    return;
  }
  if (requestId !== threadRequest) return;
  if (!data.posts.length) { body.replaceChildren(message("This thread has no posts.")); return; }
  body.replaceChildren(...data.posts.map(p => postElement(p)));
  body.scrollTop = 0;
}

function postElement(p) {
  const art = document.createElement("article");
  art.className = "post" + (p.isOP ? " op" : "");
  art.id = `p${p.no}`;

  const head = document.createElement("div");
  head.className = "post-head";
  const name = document.createElement("strong");
  name.textContent = p.name;
  head.append(name);
  if (p.tripcode) {
    const trip = document.createElement("span");
    trip.className = "trip"; trip.textContent = ` !${p.tripcode}`;
    head.append(trip);
  }
  if (p.capcode) {
    const cap = document.createElement("span");
    cap.className = "capcode"; cap.textContent = ` ## ${p.capcode}`;
    head.append(cap);
  }
  const time = document.createElement("span");
  time.className = "post-time";
  time.textContent = p.time ? ` ${p.time.toLocaleString()}` : "";
  head.append(time);
  const no = document.createElement("span");
  no.className = "post-no"; no.textContent = ` No.${p.no}`;
  head.append(no);
  art.append(head);

  if (p.image) {
    const fig = document.createElement("figure");
    fig.className = "post-image";
    const img = document.createElement("img");
    img.src = p.image.thumb;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    attachHoverZoom(img, p.image);
    img.addEventListener("click", () => openLightbox(p.image));
    fig.append(img);
    const cap = document.createElement("figcaption");
    cap.textContent =
      `${p.image.filename}${p.image.ext} · ${p.image.w}×${p.image.h} · ${fmtSize(p.image.fsize)}`;
    fig.append(cap);
    art.append(fig);
  }

  if (p.subject) {
    const sub = document.createElement("div");
    sub.className = "post-subject"; sub.textContent = p.subject;
    art.append(sub);
  }

  if (p.comment) {
    const com = document.createElement("div");
    com.className = "post-comment";
    com.append(sanitize(p.comment));
    com.querySelectorAll('a[href^="#p"]').forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        const m = a.getAttribute("href").match(/^#p(\d+)$/);
        if (!m) return;
        const target = document.getElementById(`p${m[1]}`);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("flash");
        setTimeout(() => target.classList.remove("flash"), 1200);
      });
    });
    art.append(com);
  }
  return art;
}

let hoverEl = null;
let hoverTimer = null;
let mx = 0, my = 0;

function attachHoverZoom(el, image) {
  const isVideo = /\.(webm|mp4)$/i.test(image.full);
  el.addEventListener("mouseenter", () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showHover(image, isVideo), 180);
  });
  el.addEventListener("mousemove", e => {
    mx = e.clientX; my = e.clientY;
    if (hoverEl) placeHover();
  });
  el.addEventListener("mouseleave", hideHover);
}

function showHover(image, isVideo) {
  hideHover();
  const box = document.createElement("div");
  box.className = "hover-zoom";
  let media;
  if (isVideo) {
    media = document.createElement("video");
    media.muted = true; media.loop = true; media.autoplay = true; media.playsInline = true;
  } else {
    media = document.createElement("img");
    media.referrerPolicy = "no-referrer";
  }
  media.src = image.full;
  media.addEventListener("load", placeHover);
  media.addEventListener("loadedmetadata", placeHover);
  box.append(media);
  document.body.append(box);
  hoverEl = box;
  placeHover();
}

function placeHover() {
  if (!hoverEl) return;
  const w = hoverEl.offsetWidth, h = hoverEl.offsetHeight;
  const pad = 18;
  let x = mx + pad, y = my + pad;
  if (x + w > innerWidth - 8)  x = mx - w - pad;
  if (y + h > innerHeight - 8) y = innerHeight - h - 8;
  hoverEl.style.left = `${Math.max(8, x)}px`;
  hoverEl.style.top  = `${Math.max(8, y)}px`;
}

function hideHover() {
  clearTimeout(hoverTimer);
  if (hoverEl) { hoverEl.remove(); hoverEl = null; }
}

let lightbox = null;
function ensureLightbox() {
  if (lightbox) return lightbox;
  lightbox = document.createElement("dialog");
  lightbox.className = "lightbox";
  lightbox.innerHTML = `
    <div class="lightbox-inner">
      <div class="lightbox-media"></div>
      <div class="lightbox-caption"></div>
    </div>
  `;
  document.body.append(lightbox);
  lightbox.addEventListener("click", e => { if (e.target === lightbox) lightbox.close(); });
  return lightbox;
}

function openLightbox(image) {
  hideHover();
  const box = ensureLightbox();
  const mediaBox = box.querySelector(".lightbox-media");
  const caption = box.querySelector(".lightbox-caption");
  mediaBox.replaceChildren();
  const isVideo = /\.(webm|mp4)$/i.test(image.full);
  if (isVideo) {
    const v = document.createElement("video");
    v.src = image.full; v.controls = true; v.autoplay = true; v.loop = true; v.playsInline = true;
    mediaBox.append(v);
  } else {
    const img = document.createElement("img");
    img.src = image.full; img.referrerPolicy = "no-referrer";
    mediaBox.append(img);
  }
  caption.textContent =
    `${image.filename}${image.ext} · ${image.w}×${image.h} · ${fmtSize(image.fsize)}`;
  box.showModal();
}

const OK_TAGS = new Set([
  "A","BR","SPAN","STRONG","EM","B","I","U","S","PRE","CODE",
  "SUB","SUP","WBR","ABBR","DIV"
]);
const OK_CLASSES = new Set([
  "quote","quotelink","deadlink","spoiler","abbr","fortune","math"
]);

function sanitize(html) {
  const src = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const out = document.createDocumentFragment();
  walk(src.body.firstChild, out);
  return out;
}

function walk(node, out) {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.append(document.createTextNode(child.nodeValue));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = child.tagName;
    if (!OK_TAGS.has(tag)) { walk(child, out); continue; }
    const el = document.createElement(tag.toLowerCase());
    if (tag === "A") {
      const href = child.getAttribute("href") || "";
      if (/^#p\d+$/.test(href)) {
        el.setAttribute("href", href);
      } else if (/^https?:\/\//i.test(href)) {
        el.setAttribute("href", href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }
    const classes = (child.getAttribute("class") || "")
      .split(/\s+/).filter(c => OK_CLASSES.has(c));
    if (classes.length) el.setAttribute("class", classes.join(" "));
    walk(child, el);
    out.append(el);
  }
}

function message(text, className = "muted") {
  const node = document.createElement("p");
  node.className = className;
  node.textContent = text;
  return node;
}

function retryMessage(text, retry) {
  const node = message(text, "error");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Retry";
  button.addEventListener("click", retry, { once: true });
  node.append(" ", button);
  return node;
}

function fmtSize(bytes) {
  if (!bytes) return "?";
  const u = ["B","KB","MB","GB"]; let n = bytes, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
