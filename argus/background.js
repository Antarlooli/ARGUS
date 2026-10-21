import { adapters } from "./adapters.js";

browser.action.onClicked.addListener(async () => {
  const url = browser.runtime.getURL("dashboard.html");
  const [tab] = await browser.tabs.query({ url });
  if (tab) {
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
  } else {
    await browser.tabs.create({ url });
  }
});

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "login") {
        const a = adapters[msg.platform];
        if (!a) throw new Error(`Unknown platform: ${msg.platform}`);
        const account = await a.login(msg.credentials);
        account.id = crypto.randomUUID();
        account.addedAt = Date.now();
        sendResponse({ ok: true, account });
      } else if (msg.type === "fetchColumn") {
        const items = await fetchColumn(msg.columnId);
        sendResponse({ ok: true, items });
      } else {
        throw new Error(`Unknown message: ${msg.type}`);
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true;
});

async function fetchColumn(columnId) {
  const { columns = [], accounts = [] } =
    await browser.storage.local.get(["columns", "accounts"]);
  const column = columns.find(c => c.id === columnId);
  if (!column) throw new Error("Column not found");

  const account = accounts.find(a => a.id === column.accountId);
  if (!account) throw new Error("Account not found");
  const adapter = adapters[column.platform];
  if (!adapter) throw new Error(`No adapter for ${column.platform}`);

  return column.type === "hashtag"
    ? adapter.fetchHashtag(account, column.hashtag)
    : adapter.fetchHome(account);
}
