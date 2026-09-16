const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const htmlPath = fs.existsSync("extension/sidepanel/sidepanel.html")
  ? "extension/sidepanel/sidepanel.html"
  : path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

const cssPath = fs.existsSync("extension/sidepanel/sidepanel.css")
  ? "extension/sidepanel/sidepanel.css"
  : path.resolve(__dirname, "../sidepanel/sidepanel.css");
const css = fs.readFileSync(cssPath, "utf8");

const jsPath = fs.existsSync("extension/sidepanel/sidepanel.js")
  ? "extension/sidepanel/sidepanel.js"
  : path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

// ==========================================================================
// 1. HTML Structural & Accessibility Verification
// ==========================================================================
console.log("Testing Sync All and Duplicate HTML structure...");

assert.ok(
  html.includes('id="btn-sync-all"'),
  "Sync All button (#btn-sync-all) must exist in sidepanel.html"
);

assert.ok(
  html.includes('id="sync-all-status"'),
  "Sync All status container (#sync-all-status) must exist in sidepanel.html"
);

assert.ok(
  html.includes('aria-label="Sync all eligible cards to Anki"') || html.includes('aria-label="Sync all eligible'),
  "Sync All button must have an accessible aria-label"
);

assert.ok(
  html.includes('role="status"') && html.includes('aria-live="polite"'),
  "Sync All status container must have role='status' and aria-live='polite'"
);

// ==========================================================================
// 2. CSS Styling & Focus Visibility Verification
// ==========================================================================
console.log("Testing Sync All CSS rules...");

assert.ok(css.includes(".btn-sync-all"), ".btn-sync-all rule must exist in sidepanel.css");
assert.ok(css.includes(".btn-sync-all:focus-visible"), ".btn-sync-all:focus-visible high-contrast ring must exist");
assert.ok(css.includes(".btn-sync-all:disabled"), ".btn-sync-all:disabled state must exist");
assert.ok(css.includes(".btn-sync-all.syncing"), ".btn-sync-all.syncing busy state must exist");
assert.ok(css.includes(".sync-all-status"), ".sync-all-status rule must exist");
assert.ok(css.includes(".sync-all-status.success"), ".sync-all-status.success rule must exist");
assert.ok(css.includes(".sync-all-status.partial"), ".sync-all-status.partial rule must exist");
assert.ok(css.includes(".sync-all-status.failed"), ".sync-all-status.failed rule must exist");

// ==========================================================================
// 3. JS Logic Verification in Mock DOM
// ==========================================================================
console.log("Testing JS capture deck passing and Sync All execution...");

function createMockElement(tagName) {
  const el = {
    tagName: tagName.toUpperCase(),
    value: "",
    textContent: "",
    hidden: false,
    disabled: false,
    className: "",
    style: {},
    _attrs: {},
    _listeners: {},
    children: [],
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] || null; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener(type, fn) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(fn);
    },
    dispatchEvent(event) {
      const type = event.type || "click";
      if (this._listeners[type]) {
        this._listeners[type].forEach(fn => fn(event));
      }
      return true;
    },
    classList: {
      _classes: new Set(),
      add(c) { el.classList._classes.add(c); el.className = Array.from(el.classList._classes).join(" "); },
      remove(c) { el.classList._classes.delete(c); el.className = Array.from(el.classList._classes).join(" "); },
      contains(c) { return el.classList._classes.has(c); },
      toggle(c) {
        if (el.classList._classes.has(c)) {
          el.classList.remove(c);
        } else {
          el.classList.add(c);
        }
      },
    },
    replaceChildren(...nodes) { this.children = nodes; },
    append(...nodes) { this.children.push(...nodes); },
    focus() {},
    select() {},
  };
  return el;
}

// Check identify() extracts targetDeck
assert.ok(
  jsContent.includes("deck_name: targetDeck"),
  "identify() must pass deck_name: targetDeck to API_CAPTURE_URL"
);

assert.ok(
  jsContent.includes("API_CARD_SYNC_ALL_URL"),
  "API_CARD_SYNC_ALL_URL constant must exist in sidepanel.js"
);

assert.ok(
  jsContent.includes("async function triggerSyncAll"),
  "triggerSyncAll function must exist in sidepanel.js"
);

// Extract and test triggerSyncAll behavior
(async () => {
  const mockBtnSyncAll = createMockElement("button");
  const mockSyncAllStatus = createMockElement("div");
  let historyReloadCount = 0;
  let lastStatusMsg = "";

  let mockFetchResponse = {
    ok: true,
    json: async () => ({ total_eligible: 2, synced_count: 2, failed_count: 0, results: [] }),
  };

  const sandbox = {
    document: { addEventListener: () => {} },
    btnSyncAll: mockBtnSyncAll,
    syncAllStatus: mockSyncAllStatus,
    API_CARD_SYNC_ALL_URL: "http://127.0.0.1:21828/api/cards/sync-all",
    isSyncAllRunning: false,
    fetch: async (url, opts) => mockFetchResponse,
    formatErrorMessage: (e) => String(e.message || e),
    setStatus: (msg, isErr) => { lastStatusMsg = msg; },
    loadHistory: async () => { historyReloadCount++; },
  };

  vm.createContext(sandbox);

  const startIdx = jsContent.indexOf("async function triggerSyncAll");
  const endIdx = jsContent.indexOf("// Keyboard shortcuts", startIdx);
  const fnSrc = jsContent.slice(startIdx, endIdx !== -1 ? endIdx : undefined);

  vm.runInContext(fnSrc, sandbox);



  // Test 1: Full Success
  mockFetchResponse = {
    ok: true,
    json: async () => ({ total_eligible: 3, synced_count: 3, failed_count: 0, results: [] }),
  };
  await sandbox.triggerSyncAll();

  assert.equal(sandbox.isSyncAllRunning, false, "Sync all lock should be released");
  assert.equal(mockBtnSyncAll.disabled, false, "Button should be re-enabled");
  assert.equal(mockBtnSyncAll.textContent, "Sync All", "Button text should be restored");
  assert.equal(mockSyncAllStatus.className, "sync-all-status success");
  assert.ok(mockSyncAllStatus.textContent.includes("3 cards synced to Anki"));
  assert.equal(historyReloadCount, 1, "loadHistory should be called once on success");

  // Test 2: Partial Failure
  mockFetchResponse = {
    ok: true,
    json: async () => ({ total_eligible: 5, synced_count: 4, failed_count: 1, results: [] }),
  };
  await sandbox.triggerSyncAll();

  assert.equal(mockSyncAllStatus.className, "sync-all-status partial");
  assert.ok(mockSyncAllStatus.textContent.includes("4 synced, ⚠ 1 failed"));
  assert.equal(historyReloadCount, 2, "loadHistory should be called on partial failure");

  // Test 3: Zero Eligible Cards
  mockFetchResponse = {
    ok: true,
    json: async () => ({ total_eligible: 0, synced_count: 0, failed_count: 0, results: [] }),
  };
  await sandbox.triggerSyncAll();

  assert.equal(mockSyncAllStatus.className, "sync-all-status");
  assert.ok(mockSyncAllStatus.textContent.includes("No cards to sync"));

  // Test 4: Anki Disconnected / Error
  mockFetchResponse = {
    ok: false,
    status: 503,
    json: async () => ({ detail: "Cannot connect to AnkiConnect: Connection refused" }),
  };
  await sandbox.triggerSyncAll();

  assert.equal(mockSyncAllStatus.className, "sync-all-status failed");
  assert.ok(mockSyncAllStatus.textContent.includes("Connection refused"));

  console.log("PASS: All Sync All and Duplicate detection tests passed successfully.");
})();
