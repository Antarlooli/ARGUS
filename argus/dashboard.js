import { populateBoardPicker, renderCatalog, openThread } from "./fourchan-view.js";
import { rssAdapter } from "./rss-adapter.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { columns: [], accounts: [] };
const renderSequence = new WeakMap();
let refreshing = false;
let loadingBoards = false;

async function loadState() {
  const stored = await browser.storage.local.get(["columns", "accounts", "schemaVersion"]);
  state.columns = Array.isArray(stored.columns) ? stored.columns : [];
  state.accounts = Array.isArray(stored.accounts) ? stored.accounts : [];
  if (!Number.isInteger(stored.schemaVersion) || stored.schemaVersion < 1) {
    await browser.storage.local.set({ schemaVersion: 1 });
  }
}

async function saveState() {
  await browser.storage.local.set({ columns: state.columns, accounts: state.accounts });
}

function setStatus(message, isError = false) {
  const status = $("#status");
  status.textContent = message;
  status.classList.toggle("status-error", isError);
}

function renderSidebar() {
  const list = $("#column-list");
  if (!state.columns.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "No columns yet";
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...state.columns.map(column => {
    const item = document.createElement("li");
    item.textContent = column.title;
    item.tabIndex = 0;
    item.addEventListener("click", () => scrollTo(column.id));
    item.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); scrollTo(column.id); }
    });
    return item;
  }));
}

function renderColumns() {
  const root = $("#columns");
  if (!state.columns.length) {
    const empty = document.createElement("section");
    empty.className = "empty-dashboard";
    const heading = document.createElement("h1");
    heading.textContent = "Your watch starts here";
    const detail = document.createElement("p");
    detail.textContent = "Add a feed, a Bluesky timeline, or a board to create your first column.";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "+ Add your first column";
    button.addEventListener("click", openColumnDialog);
    empty.append(heading, detail, button);
    root.replaceChildren(empty);
    return;
  }
  root.replaceChildren(...state.columns.map(makeColumn));
  for (const column of state.columns) {
    const columnElement = [...root.querySelectorAll(".column")].find(element => element.dataset.id === column.id);
    const body = columnElement?.querySelector(".column-body");
    if (body) void renderColumnBody(column, body);
  }
}

function makeColumn(column) {
  const element = document.createElement("section");
  element.className = "column";
  element.dataset.id = column.id;
  element.innerHTML = `<header class="column-header"><span class="title"></span><button class="refresh" type="button" title="Refresh" aria-label="Refresh column">⟳</button><button class="remove" type="button" title="Remove column" aria-label="Remove column">×</button></header><div class="column-body"></div>`;
  $(".title", element).textContent = column.title;
  $(".refresh", element).addEventListener("click", () => void renderColumnBody(column, $(".column-body", element)));
  $(".remove", element).addEventListener("click", () => void removeColumn(column.id));
  return element;
}

async function removeColumn(id) {
  const previous = state.columns;
  state.columns = previous.filter(column => column.id !== id);
  try {
    await saveState();
    renderSidebar(); renderColumns();
    setStatus("Column removed.");
  } catch (error) {
    state.columns = previous;
    setStatus(`Could not save changes: ${error.message}`, true);
  }
}

async function renderColumnBody(column, body) {
  const requestId = (renderSequence.get(body) || 0) + 1;
  renderSequence.set(body, requestId);
  body.replaceChildren(messageNode("Loading…"));

  if (column.type === "board") {
    await renderCatalog(body, column.board, thread => void openThread(column.board, thread.no));
    return;
  }
  try {
    let items;
    if (column.type === "rss") {
      items = await rssAdapter.fetch(column);
    } else if (column.type === "home" || column.type === "hashtag") {
      const response = await browser.runtime.sendMessage({ type: "fetchColumn", columnId: column.id });
      if (!response?.ok) throw new Error(response?.error || "The background script returned no response.");
      items = response.items;
    } else {
      throw new Error(`Unsupported column type: ${column.type}`);
    }
    if (renderSequence.get(body) !== requestId) return;
    if (!Array.isArray(items) || items.length === 0) {
      body.replaceChildren(messageNode("No items."));
      return;
    }
    body.replaceChildren(...items.map(makeItem));
  } catch (error) {
    if (renderSequence.get(body) === requestId) body.replaceChildren(errorNode(error.message, () => renderColumnBody(column, body)));
  }
}

function makeItem(item) {
  const wrapper = document.createElement("article");
  wrapper.className = "item";
  const author = document.createElement("div");
  author.className = "author";
  author.textContent = item.handle ? `@${item.handle}` : (item.author || "Unknown author");
  const time = document.createElement("time");
  time.className = "time";
  if (item.createdAt && Number.isFinite(Date.parse(item.createdAt))) {
    time.dateTime = new Date(item.createdAt).toISOString();
    time.textContent = new Date(item.createdAt).toLocaleString();
  }
  const text = document.createElement("div");
  text.className = "item-text";
  text.textContent = item.text || "";
  if (item.url) {
    try {
      const url = new URL(item.url);
      if (url.protocol === "https:" || url.protocol === "http:") {
        const link = document.createElement("a");
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open post ↗";
        wrapper.append(author, time, text, link);
        return wrapper;
      }
    } catch { /* Invalid remote URLs are rendered as plain text. */ }
  }
  wrapper.append(author, time, text);
  return wrapper;
}

function scrollTo(id) {
  const element = [...$$(".column")].find(column => column.dataset.id === id);
  element?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
}

async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  const button = $("#refresh-btn");
  button.disabled = true;
  const count = state.columns.length;
  setStatus(`Refreshing ${count} column${count === 1 ? "" : "s"}…`);
  try {
    await Promise.all(state.columns.map(column => {
      const body = [...$$(".column")].find(item => item.dataset.id === column.id)?.querySelector(".column-body");
      return body ? renderColumnBody(column, body) : Promise.resolve();
    }));
    const failures = $$(".column-body .error").length;
    setStatus(failures ? `Refresh finished: ${failures} column${failures === 1 ? "" : "s"} need attention.` : `Refreshed ${count} column${count === 1 ? "" : "s"}.`, failures > 0);
  } finally {
    refreshing = false;
    button.disabled = false;
  }
}

async function openColumnDialog() {
  const dialog = $("#column-dialog");
  populateAccountSelect();
  updateColumnDialogFields(dialog);
  dialog.showModal();
  if ($("select[name=type]", dialog).value === "board") await ensureBoardPicker();
}

function populateAccountSelect() {
  const select = $("select[name=accountId]", $("#column-dialog"));
  const previous = select.value;
  select.replaceChildren();
  if (!state.accounts.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Add a Bluesky account first";
    select.append(option);
    return;
  }
  for (const account of state.accounts) {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = `${account.platform}: ${account.username}`;
    select.append(option);
  }
  if (state.accounts.some(account => account.id === previous)) select.value = previous;
}

async function ensureBoardPicker() {
  const select = $("select[name=board]", $("#column-dialog"));
  if (select.dataset.loaded === "true" || loadingBoards) return;
  loadingBoards = true;
  select.replaceChildren();
  select.disabled = true;
  try {
    await populateBoardPicker(select);
    if (!select.options.length) throw new Error("The board list was empty.");
    select.dataset.loaded = "true";
  } catch (error) {
    setStatus(`Could not load the 4chan board list: ${error.message}`, true);
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Could not load boards — retry by reopening Add Column";
    select.replaceChildren(option);
  } finally {
    select.disabled = false;
    loadingBoards = false;
  }
}

function updateColumnDialogFields(dialog) {
  const type = $("select[name=type]", dialog).value;
  const show = (name, visible) => {
    const input = $(`[name=${name}]`, dialog);
    if (input) input.closest("label").hidden = !visible;
  };
  show("platform", type === "home" || type === "hashtag");
  show("accountId", type === "home" || type === "hashtag");
  show("hashtag", type === "hashtag");
  show("board", type === "board");
  show("feedUrl", type === "rss");
  $("#column-form button[type=submit]").disabled = type === "board" && !$("select[name=board]", dialog).value;
}

$("#column-dialog select[name=type]").addEventListener("change", async event => {
  const select = event.currentTarget;
  const dialog = select.closest("dialog");
  const type = select.value;
  updateColumnDialogFields(dialog);
  if (type === "board") await ensureBoardPicker();
  updateColumnDialogFields(dialog);
});
$("select[name=board]", $("#column-dialog")).addEventListener("change", () => updateColumnDialogFields($("#column-dialog")));
$("#add-column-btn").addEventListener("click", () => void openColumnDialog());
$("#accounts-btn").addEventListener("click", () => { renderAccounts(); $("#account-dialog").showModal(); });
$("#refresh-btn").addEventListener("click", () => void refreshAll());

async function handleAccountSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $("button[type=submit]", form);
  const data = new FormData(form);
  submit.disabled = true;
  setStatus("Signing in to Bluesky…");
  try {
    const response = await browser.runtime.sendMessage({
      type: "login",
      platform: data.get("platform"),
      credentials: { handle: data.get("handle"), appPassword: data.get("appPassword") }
    });
    if (!response?.ok) throw new Error(response?.error || "No response from the background script.");
    const account = response.account;
    const existing = state.accounts.findIndex(item => item.username.toLowerCase() === account.username.toLowerCase());
    if (existing >= 0) account.id = state.accounts[existing].id;
    const previous = state.accounts;
    state.accounts = [...state.accounts.filter(item => item.id !== account.id), account];
    try { await saveState(); }
    catch (error) { state.accounts = previous; throw error; }
    populateAccountSelect();
    renderAccounts();
    setStatus(`Logged in as ${account.username}.`);
    form.reset();
    $("#account-dialog").close();
  } catch (error) {
    setStatus(`Login failed: ${error.message}`, true);
  } finally {
    submit.disabled = false;
  }
}

function renderAccounts() {
  const list = $("#saved-accounts");
  if (!list) return;
  if (!state.accounts.length) {
    list.replaceChildren(messageNode("No Bluesky accounts connected."));
    return;
  }
  list.replaceChildren(...state.accounts.map(account => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${account.platform}: ${account.username}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => void removeAccount(account.id));
    item.append(name, remove);
    return item;
  }));
}

async function removeAccount(id) {
  const account = state.accounts.find(item => item.id === id);
  if (!account || !window.confirm(`Remove ${account.username} and its social columns?`)) return;
  const oldAccounts = state.accounts;
  const oldColumns = state.columns;
  state.accounts = state.accounts.filter(item => item.id !== id);
  state.columns = state.columns.filter(column => column.accountId !== id);
  try {
    await saveState();
    renderAccounts(); populateAccountSelect(); renderSidebar(); renderColumns();
    setStatus(`Removed ${account.username}.`);
  } catch (error) {
    state.accounts = oldAccounts; state.columns = oldColumns;
    setStatus(`Could not remove account: ${error.message}`, true);
  }
}

$("#account-form").addEventListener("submit", event => void handleAccountSubmit(event));

async function handleColumnSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $("button[type=submit]", form);
  const data = new FormData(form);
  const type = String(data.get("type") || "");
  const title = String(data.get("title") || "").trim();
  if (!title) { setStatus("Enter a title for this column.", true); return; }
  submit.disabled = true;
  try {
    const column = { id: crypto.randomUUID(), type, title };
    if (type === "board") {
      column.board = String(data.get("board") || "");
      if (!/^[a-z0-9]+$/i.test(column.board)) throw new Error("Choose a valid board.");
    } else if (type === "rss") {
      let feed;
      try { feed = new URL(String(data.get("feedUrl") || "")); }
      catch { throw new Error("Enter a valid HTTPS feed URL."); }
      if (feed.protocol !== "https:" || feed.username || feed.password) throw new Error("Feeds must use a valid HTTPS URL without embedded credentials.");
      const originPattern = `${feed.origin}/*`;
      // Request immediately during the submit gesture; awaiting `contains()` first can lose activation in Firefox.
      const granted = await browser.permissions.request({ origins: [originPattern] });
      if (!granted) throw new Error("Feed host permission was not granted.");
      column.feedUrl = feed.href;
    } else if (type === "home" || type === "hashtag") {
      column.platform = String(data.get("platform") || "bluesky");
      column.accountId = String(data.get("accountId") || "");
      const account = state.accounts.find(item => item.id === column.accountId);
      if (!account) throw new Error("Connect a Bluesky account before adding a social column.");
      if (type === "hashtag") {
        column.hashtag = String(data.get("hashtag") || "").trim().replace(/^#+/, "");
        if (!column.hashtag) throw new Error("Enter a hashtag to search.");
      }
    } else {
      throw new Error(`Unsupported column type: ${type}`);
    }

    const previous = state.columns;
    state.columns = [...state.columns, column];
    try { await saveState(); }
    catch (error) { state.columns = previous; throw error; }
    renderSidebar(); renderColumns();
    setStatus(`Added ${title}.`);
    form.reset();
    updateColumnDialogFields($("#column-dialog"));
    $("#column-dialog").close();
  } catch (error) {
    setStatus(`Could not add column: ${error.message}`, true);
  } finally {
    submit.disabled = false;
  }
}

$("#column-form").addEventListener("submit", event => void handleColumnSubmit(event));
$$("[data-close]").forEach(button => button.addEventListener("click", event => event.currentTarget.closest("dialog").close()));

function messageNode(text, className = "muted") {
  const paragraph = document.createElement("p");
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

function errorNode(text, retry) {
  const paragraph = messageNode(`Could not load: ${text}`, "error");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Retry";
  button.addEventListener("click", retry, { once: true });
  paragraph.append(" ", button);
  return paragraph;
}

(async () => {
  try {
    await loadState();
    renderSidebar();
    renderAccounts();
    renderColumns();
    setStatus(state.columns.length ? `${state.columns.length} column${state.columns.length === 1 ? "" : "s"} ready.` : "Ready. Add your first column.");
  } catch (error) {
    setStatus(`Argus could not load saved data: ${error.message}. Check Firefox extension storage permissions, then reload this tab.`, true);
  }
})();
