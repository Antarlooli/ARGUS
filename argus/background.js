import { adapters } from "./adapters.js";

let accountWriteQueue = Promise.resolve();

browser.action.onClicked.addListener(async () => {
  try {
    const url = browser.runtime.getURL("dashboard.html");
    // tabs.query's URL filter accepts match patterns, not every exact extension URL.
    const tabs = await browser.tabs.query({});
    const tab = tabs.find(candidate => candidate.url === url);
    if (tab) {
      await browser.tabs.update(tab.id, { active: true });
      await browser.windows.update(tab.windowId, { focused: true });
    } else {
      await browser.tabs.create({ url });
    }
  } catch (error) {
    console.error("Argus could not open its dashboard:", error);
  }
});

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (!message || typeof message.type !== "string") throw new Error("Invalid request.");
      if (message.type === "login") {
        const adapter = adapters[message.platform];
        if (!adapter) throw new Error(`Unsupported platform: ${message.platform || "(empty)"}`);
        const account = await adapter.login(message.credentials);
        account.id = crypto.randomUUID();
        account.addedAt = Date.now();
        sendResponse({ ok: true, account });
        return;
      }
      if (message.type === "fetchColumn") {
        const items = await fetchColumn(message.columnId);
        sendResponse({ ok: true, items });
        return;
      }
      throw new Error(`Unknown request: ${message.type}`);
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unexpected background error." });
    }
  })();
  return true;
});

async function fetchColumn(columnId) {
  const { columns = [], accounts = [] } = await browser.storage.local.get(["columns", "accounts"]);
  const column = columns.find(item => item.id === columnId);
  if (!column) throw new Error("Column not found. It may have been removed; reload the dashboard.");
  if (!['home', 'hashtag'].includes(column.type)) throw new Error(`Unsupported social column type: ${column.type}`);
  const account = accounts.find(item => item.id === column.accountId);
  if (!account) throw new Error("Account not found. Add a Bluesky account first.");
  const adapter = adapters[column.platform];
  if (!adapter) throw new Error(`No adapter for ${column.platform || "this platform"}.`);

  const items = column.type === "hashtag"
    ? await adapter.fetchHashtag(account, column.hashtag)
    : await adapter.fetchHome(account);

  // Adapters may rotate access tokens; serialize writes and merge against current storage.
  if (account.token) {
    const write = accountWriteQueue.then(async () => {
      const latest = await browser.storage.local.get("accounts");
      const currentAccounts = Array.isArray(latest.accounts) ? latest.accounts : [];
      const index = currentAccounts.findIndex(item => item.id === account.id);
      if (index >= 0) {
        currentAccounts[index] = { ...currentAccounts[index], token: account.token, refreshToken: account.refreshToken };
        await browser.storage.local.set({ accounts: currentAccounts });
      }
    });
    accountWriteQueue = write.catch(() => {});
    await write;
  }
  return items;
}
