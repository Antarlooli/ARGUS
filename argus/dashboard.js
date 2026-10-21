import { populateBoardPicker, renderCatalog, openThread } from "./fourchan-view.js";
import { rssAdapter } from "./rss-adapter.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = { columns: [], accounts: [] };

async function loadState() {
  const s = await browser.storage.local.get(["columns", "accounts", "schemaVersion"]);
  state.columns = s.columns || [];
  state.accounts = s.accounts || [];
  if (!s.schemaVersion || s.schemaVersion < 1) await browser.storage.local.set({ schemaVersion: 1 });
}
async function saveState() {
  await browser.storage.local.set({
    columns: state.columns, accounts: state.accounts
  });
}

function renderSidebar() {
  const ul = $("#column-list");
  ul.replaceChildren(...state.columns.map(c => {
    const li = document.createElement("li");
    li.textContent = c.title;
    li.addEventListener("click", () => scrollTo(c.id));
    return li;
  }));
}

function renderColumns() {
  $("#columns").replaceChildren(...state.columns.map(makeColumn));
  for (const c of state.columns) {
    const body = $(`.column[data-id="${c.id}"] .column-body`);
    if (body) renderColumnBody(c, body);
  }
}

function makeColumn(col) {
  const el = document.createElement("div");
  el.className = "column";
  el.dataset.id = col.id;
  el.innerHTML = `<div class="column-header"><span class="title"></span><button class="refresh" title="Refresh" aria-label="Refresh column">⟳</button><button class="remove" title="Remove column" aria-label="Remove column">×</button></div><div class="column-body"><p class="muted">Loading…</p></div>`;
  $(".title", el).textContent = col.title;
  $(".remove", el).addEventListener("click", async () => {
    state.columns = state.columns.filter(c => c.id !== col.id);
    await saveState(); renderSidebar(); renderColumns();
  });
  $(".refresh", el).addEventListener("click", () => {
    const body = $(".column-body", el);
    renderColumnBody(col, body);
  });
  return el;
}

async function renderColumnBody(column, bodyEl) {
  bodyEl.innerHTML = `<p class="muted">Loading…</p>`;

  if (column.type === "board") {
    await renderCatalog(bodyEl, column.board, t => openThread(column.board, t.no));
    return;
  }
  if (column.type === "rss") {
    try {
      const items = await rssAdapter.fetch(column);
      if (!items.length) { bodyEl.replaceChildren(messageNode("No items.")); return; }
      bodyEl.replaceChildren(...items.map(makeItem));
    } catch (e) {
      bodyEl.replaceChildren(errorNode(e.message));
    }
    return;
  }
  // social: route through background
  try {
  const resp = await browser.runtime.sendMessage({ type: "fetchColumn", columnId: column.id });
  if (!resp.ok) { bodyEl.replaceChildren(errorNode(resp.error)); return; }
  if (!resp.items.length) { bodyEl.innerHTML = `<p class="muted">No items.</p>`; return; }
  bodyEl.replaceChildren(...resp.items.map(makeItem));
  } catch (e) { bodyEl.replaceChildren(errorNode(e.message)); }
}

function makeItem(item) {
  const div = document.createElement("div");
  div.className = "item";
  const author = document.createElement("div");
  author.className = "author";
  author.textContent = item.handle ? `@${item.handle}` : item.author;
  const time = document.createElement("div");
  time.className = "time";
  time.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString() : "";
  const text = document.createElement("div");
  text.textContent = item.text;
  if (item.url) {
    let target;
    try { target = new URL(item.url); } catch { target = null; }
    if (target && ["http:", "https:"].includes(target.protocol)) {
      text.style.cursor = "pointer";
      text.addEventListener("click", () => browser.tabs.create({ url: target.href }));
    }
  }
  div.append(author, time, text);
  return div;
}

function scrollTo(id) {
  $(`.column[data-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", inline: "start" });
}

async function refreshAll() {
  const n = state.columns.length;
  $("#status").textContent = `Refreshing ${n} column${n === 1 ? "" : "s"}…`;
  await Promise.all(state.columns.map(c => {
    const body = $(`.column[data-id="${c.id}"] .column-body`);
    return body ? renderColumnBody(c, body) : null;
  }));
  $("#status").textContent = `Refreshed ${n} column${n === 1 ? "" : "s"}`;
}

$("#add-column-btn").addEventListener("click", openColumnDialog);
$("#accounts-btn").addEventListener("click", () => $("#account-dialog").showModal());
$("#refresh-btn").addEventListener("click", refreshAll);

async function openColumnDialog() {
  const dlg = $("#column-dialog");
  const boardSel = $("select[name=board]", dlg);
  if (!boardSel.options.length) {
    try { await populateBoardPicker(boardSel); }
    catch (e) { $("#status").textContent = `Boards failed: ${e.message}`; }
  }
  const accSel = $("select[name=accountId]", dlg);
  accSel.replaceChildren(...state.accounts.map(a => {
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = `${a.platform}: ${a.username}`;
    return o;
  }));
  updateColumnDialogFields(dlg);
  dlg.showModal();
}

function updateColumnDialogFields(dlg) {
  const type = $("select[name=type]", dlg).value;
  const show = (name, visible) => {
    const el = $(`[name=${name}]`, dlg);
    if (el) el.closest("label").style.display = visible ? "" : "none";
  };
  show("platform", type === "home" || type === "hashtag");
  show("accountId", type === "home" || type === "hashtag");
  show("hashtag",   type === "hashtag");
  show("board",     type === "board");
  show("feedUrl",   type === "rss");
}

$("#column-dialog select[name=type]")
  .addEventListener("change", e => updateColumnDialogFields(e.target.closest("dialog")));

$("#account-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $("#status").textContent = "Logging in…";
  const resp = await browser.runtime.sendMessage({
    type: "login",
    platform: fd.get("platform"),
    credentials: { handle: fd.get("handle"), appPassword: fd.get("appPassword") }
  });
  if (!resp.ok) { $("#status").textContent = `Login failed: ${resp.error}`; return; }
  state.accounts.push(resp.account);
  await saveState();
  $("#status").textContent = `Logged in as ${resp.account.username}`;
  $("#account-dialog").close();
  e.target.reset();
});

$("#column-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const type = fd.get("type");
  const column = { id: crypto.randomUUID(), type, title: fd.get("title") };
  if (type === "board") {
    column.board = fd.get("board");
    if (!column.board) { $("#status").textContent = "Pick a board first"; return; }
  } else if (type === "rss") {
    column.feedUrl = fd.get("feedUrl");
    if (!column.feedUrl) { $("#status").textContent = "Feed URL required"; return; }
    let feed; try { feed = new URL(column.feedUrl); } catch { $("#status").textContent = "Enter a valid feed URL"; return; }
    if (feed.protocol !== "https:") { $("#status").textContent = "Feeds must use HTTPS"; return; }
    if (!await browser.permissions.request({ origins: [`https://${feed.host}/*`] })) { $("#status").textContent = "Feed permission was not granted"; return; }
  } else {
    column.platform = fd.get("platform");
    column.accountId = fd.get("accountId") || null;
    column.hashtag = fd.get("hashtag") || null;
    if (!column.accountId) { $("#status").textContent = "Add an account first"; return; }
  }
  state.columns.push(column);
  await saveState();
  renderSidebar();
  renderColumns();
  $("#column-dialog").close();
  e.target.reset();
});

$$("[data-close]").forEach(b =>
  b.addEventListener("click", e => e.target.closest("dialog").close())
);

function messageNode(text, cls="muted") { const p=document.createElement("p"); p.className=cls; p.textContent=text; return p; }
function errorNode(text) { const p=messageNode(`Could not load: ${text}`, "error"); const b=document.createElement("button"); b.textContent="Retry"; b.addEventListener("click", e => { const c=e.currentTarget.closest(".column"); const col=state.columns.find(x=>x.id===c?.dataset.id); if(col) renderColumnBody(col,$(".column-body",c)); }); p.append(" ",b); return p; }

function esc(s) {
  const d = document.createElement("div"); d.textContent = s; return d.innerHTML;
}

(async () => {
  await loadState();
  renderSidebar();
  renderColumns();
})();
