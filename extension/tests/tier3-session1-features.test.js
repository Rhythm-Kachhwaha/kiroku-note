/**
 * Test Suite for Tier 3 Session 1 Features:
 * - T3-A: Smart Save Shortcut (Alt+Enter)
 * - T3-C: 5-Second Undo Toast on History Deletion
 * - T3-J: Detailed Live Sync Progress Modal
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const htmlPath = path.join(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.join(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.join(__dirname, "../sidepanel/sidepanel.js");

const htmlContent = fs.readFileSync(htmlPath, "utf-8");
const cssContent = fs.readFileSync(cssPath, "utf-8");
const jsContent = fs.readFileSync(jsPath, "utf-8");

test("Tier 3 Session 1: HTML & CSS Structure Verification", () => {
  // T3-A: Save button tooltip
  assert.ok(
    htmlContent.includes('id="save-card-btn"') && htmlContent.includes("Alt+Enter"),
    "Save card button must mention Alt+Enter in its tooltip"
  );

  // T3-C: Undo Toast element & CSS
  assert.ok(
    htmlContent.includes('id="undo-toast"'),
    "HTML must include #undo-toast element"
  );
  assert.ok(
    htmlContent.includes('id="undo-toast-message"'),
    "HTML must include #undo-toast-message element"
  );
  assert.ok(
    htmlContent.includes('id="btn-undo-delete"'),
    "HTML must include #btn-undo-delete button"
  );
  assert.ok(
    cssContent.includes(".undo-toast") && cssContent.includes(".btn-undo-delete"),
    "CSS must define rules for .undo-toast and .btn-undo-delete"
  );

  // T3-J: Live Sync Progress Modal & CSS
  assert.ok(
    htmlContent.includes('id="sync-progress-modal"'),
    "HTML must include #sync-progress-modal element"
  );
  assert.ok(
    htmlContent.includes('id="btn-close-sync-modal"'),
    "HTML must include #btn-close-sync-modal button"
  );
  assert.ok(
    htmlContent.includes('id="sync-progress-summary"'),
    "HTML must include #sync-progress-summary element"
  );
  assert.ok(
    htmlContent.includes('id="sync-modal-progress-bar"'),
    "HTML must include #sync-modal-progress-bar element"
  );
  assert.ok(
    htmlContent.includes('id="sync-progress-list"'),
    "HTML must include #sync-progress-list element"
  );
  assert.ok(
    htmlContent.includes('id="btn-dismiss-sync-modal"'),
    "HTML must include #btn-dismiss-sync-modal button"
  );
  assert.ok(
    cssContent.includes(".sync-progress-modal") && cssContent.includes(".sync-item"),
    "CSS must define rules for .sync-progress-modal and .sync-item"
  );
});

test("T3-A: Alt+Enter Smart Save Shortcut Execution", async () => {
  let saveCalled = false;
  let syncCalled = false;

  const listeners = {};
  const mockDocument = {
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    querySelector: () => null,
  };

  const mockCardEditor = { hidden: false };
  let saveCardResult = { id: 42, expression: "猫" };

  const sandbox = {
    document: mockDocument,
    navigator: { platform: "Win32" },
    ocrCaptureBtn: null,
    cardEditor: mockCardEditor,
    saveCard: async () => {
      saveCalled = true;
      return saveCardResult;
    },
    triggerAnkiSync: async () => {
      syncCalled = true;
    },
    fieldExpression: { focus: () => {}, select: () => {} },
    fieldMeaning: { focus: () => {}, select: () => {} },
    syncProgressModal: { hidden: true },
    cardSettingsPopover: null,
    layoutSettingsPopover: null,
    optionalDetails: null,
    optionalFields: null,
  };

  vm.createContext(sandbox);

  // Extract keydown listener logic from sidepanel.js
  const startIdx = jsContent.indexOf('document.addEventListener("keydown", event => {');
  assert.ok(startIdx !== -1, "Keydown listener must exist in sidepanel.js");
  const endIdx = jsContent.indexOf("if (event.key === \"Escape\") {", startIdx);
  const codeSlice = jsContent.slice(startIdx, endIdx);

  vm.runInContext(codeSlice + "\n});", sandbox);

  const handler = listeners["keydown"][0];
  assert.ok(typeof handler === "function", "Keydown handler must be registered");

  // 1. Trigger Alt+Enter when target is an input (should be guarded and ignored)
  let prevented = false;
  handler({
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    key: "Enter",
    code: "Enter",
    target: { matches: (sel) => sel.includes("input[type=text]") },
    preventDefault: () => { prevented = true; },
  });
  assert.equal(saveCalled, false, "Alt+Enter inside text input must not trigger save");
  assert.equal(syncCalled, false, "Sync must not trigger when input is focused");

  // 2. Trigger Alt+Enter from general element (e.g. editor body / buttons)
  prevented = false;
  handler({
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    key: "Enter",
    code: "Enter",
    target: { matches: () => false },
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true, "Alt+Enter must prevent default browser behavior");
  assert.equal(saveCalled, true, "saveCard must be called on Alt+Enter");

  // Allow Promise chain to resolve
  await new Promise(r => setTimeout(r, 20));
  assert.equal(syncCalled, true, "triggerAnkiSync must be called sequentially after saveCard succeeds");

  // 3. Test failed save does NOT call sync
  saveCalled = false;
  syncCalled = false;
  saveCardResult = null; // Save fails

  handler({
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    key: "Enter",
    code: "Enter",
    target: { matches: () => false },
    preventDefault: () => {},
  });
  assert.equal(saveCalled, true);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(syncCalled, false, "If save fails, Anki sync must NOT be called (SQLite-first invariant)");
});

test("T3-C: 5-Second Undo Toast on History Deletion", async () => {
  let deletedUrls = [];
  const mockFetch = async (url, options = {}) => {
    if (options && options.method === "DELETE") {
      deletedUrls.push(url);
    }
    return { ok: true, json: async () => ({}) };
  };

  const mockToast = { hidden: true };
  const mockToastMessage = { textContent: "" };
  const mockBtnUndo = { onclick: null };
  const mockCardEl = { style: { display: "" } };
  const mockHistoryCardsList = {
    querySelector: (sel) => {
      if (sel.includes('data-card-id="101"')) return mockCardEl;
      return null;
    }
  };

  let lastStatus = "";
  const sandbox = {
    API_CARD_DETAIL_URL: (id) => `http://127.0.0.1:21828/api/cards/${id}`,
    fetch: mockFetch,
    undoToast: mockToast,
    undoToastMessage: mockToastMessage,
    btnUndoDelete: mockBtnUndo,
    historyCardsList: mockHistoryCardsList,
    fieldCardId: { value: "101" },
    fieldExpression: { value: "日本語" },
    fieldReading: { value: "にほんご" },
    fieldMeaning: { value: "Japanese language" },
    fieldHint: { value: "" },
    fieldExampleSentence: { value: "" },
    fieldExampleTranslation: { value: "" },
    fieldImage: { value: "" },
    fieldAudio: { value: "" },
    fieldTags: { value: "" },
    fieldNotes: { value: "" },
    expression: { textContent: "日本語" },
    updateHeroReading: () => {},
    wordMeaningsSummary: { textContent: "", hidden: false },
    showcaseJlptBadge: { hidden: false, textContent: "N3" },
    showcasePosBadge: { hidden: false, textContent: "noun" },
    showcasePitchBadge: { hidden: false, textContent: "" },
    clearDictionaryView: () => {},
    setSaveBadge: () => {},
    cardEditor: { hidden: false },
    updateSyncUI: () => {},
    ankiConnected: true,
    selectedHistoryCardId: 101,
    scheduleCardPreviewUpdate: () => {},
    setStatus: (msg) => { lastStatus = msg; },
    loadHistory: async () => {},
    window: { addEventListener: () => {} },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };

  vm.createContext(sandbox);

  // Extract T3-C functions from sidepanel.js
  const startIdx = jsContent.indexOf("// T3-C: 5-Second Undo Toast on History Deletion");
  const endIdx = jsContent.indexOf("async function retrySyncFromHistory", startIdx);
  const codeSlice = jsContent.slice(startIdx, endIdx);

  vm.runInContext(codeSlice, sandbox);

  // Case 1: First click triggers 2-click confirm
  const mockDelBtn = {
    classList: {
      contains: (cls) => cls === "dummy",
      add: function(cls) { this[cls] = true; },
      remove: function(cls) { delete this[cls]; },
    },
    textContent: "×",
    title: "",
  };
  mockDelBtn.classList.contains = function(cls) { return Boolean(this[cls]); };

  await sandbox.deleteLocalCard(101, "日本語", mockDelBtn);
  assert.equal(mockDelBtn.classList.contains("confirm-delete"), true, "First click adds confirm-delete");
  assert.equal(mockToast.hidden, true, "Toast not yet shown on first click");
  assert.equal(deletedUrls.length, 0, "No DELETE request sent on first click");

  // Case 2: Second click confirms deletion -> hides element and shows 5s undo toast
  await sandbox.deleteLocalCard(101, "日本語", mockDelBtn);
  assert.equal(mockCardEl.style.display, "none", "Card element should be immediately hidden in UI");
  assert.equal(mockToast.hidden, false, "Undo toast must be revealed");
  assert.ok(mockToastMessage.textContent.includes("日本語"), "Toast message must show card expression");
  assert.ok(typeof mockBtnUndo.onclick === "function", "Undo button onclick handler must be attached");
  assert.equal(deletedUrls.length, 0, "Card is not permanently deleted yet during 5-second window");

  // Case 3: User clicks "Undo" -> restores card in UI, cancels timer
  mockBtnUndo.onclick({ preventDefault: () => {} });
  assert.equal(mockCardEl.style.display, "", "Card element display must be restored on Undo");
  assert.equal(mockToast.hidden, true, "Undo toast must be hidden on Undo");
  assert.ok(lastStatus.includes("Restored"), "Status message indicates card was restored");
  assert.equal(deletedUrls.length, 0, "No DELETE request sent when undone");

  // Case 4: Letting 5-second timeout expire permanently deletes card
  await sandbox.deleteLocalCard(101, "日本語", mockDelBtn); // Click 1: arms confirm
  await sandbox.deleteLocalCard(101, "日本語", mockDelBtn); // Click 2: executes deferred delete
  assert.equal(mockToast.hidden, false);
  // Fast forward or trigger the commit
  await sandbox.commitPendingDelete();
  assert.equal(deletedUrls.length, 1, "DELETE request issued after undo window expires");
  assert.ok(deletedUrls[0].endsWith("/101"), "DELETE request targeted correct card ID");
  assert.equal(mockToast.hidden, true, "Toast hidden after commit");
  assert.equal(sandbox.cardEditor.hidden, true, "Editor hidden after committed deletion of active card");
});

test("T3-J: Detailed Live Sync Progress Modal Execution", async () => {
  const modalEl = { hidden: true, addEventListener: () => {} };
  const summaryEl = { textContent: "" };
  const progressBarEl = { style: { width: "0%" } };
  const items = [];
  const listEl = {
    replaceChildren: () => { items.length = 0; },
    append: (child) => { items.push(child); },
    scrollTop: 0,
    scrollHeight: 100,
  };
  const dismissBtn = { hidden: true, addEventListener: () => {} };
  const btnSync = { disabled: false, classList: { add: () => {}, remove: () => {} }, textContent: "Sync All", addEventListener: () => {} };
  const statusEl = { hidden: true, className: "", textContent: "" };

  const mockResponse = {
    total_eligible: 3,
    synced_count: 2,
    failed_count: 1,
    results: [
      { id: 1, sync_status: "synced", expression: "林", error: null },
      { id: 2, sync_status: "synced", expression: "森", error: null },
      { id: 3, sync_status: "failed", expression: "火", error: "Deck not found" },
    ],
  };

  const sandbox = {
    document: {
      addEventListener: () => {},
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        className: "",
        textContent: "",
        title: "",
        append: function(...children) { this.children = (this.children || []).concat(children); },
      }),
    },
    btnSyncAll: btnSync,
    syncAllStatus: statusEl,
    syncProgressModal: modalEl,
    btnCloseSyncModal: { addEventListener: () => {} },
    syncProgressSummary: summaryEl,
    syncModalProgressBar: progressBarEl,
    syncProgressList: listEl,
    btnDismissSyncModal: dismissBtn,
    API_CARD_SYNC_ALL_URL: "http://127.0.0.1:21828/api/cards/sync-all",
    isSyncAllRunning: false,
    fetch: async () => ({
      ok: true,
      json: async () => mockResponse,
    }),
    formatErrorMessage: (e) => String(e),
    setStatus: () => {},
    loadHistory: async () => {},
  };

  vm.createContext(sandbox);

  // Extract triggerSyncAll from sidepanel.js
  const startIdx = jsContent.indexOf("async function triggerSyncAll");
  const endIdx = jsContent.indexOf("// Keyboard shortcuts", startIdx);
  const codeSlice = jsContent.slice(startIdx, endIdx);

  vm.runInContext(codeSlice, sandbox);

  // 1. Silent sync (e.g. background auto-reconnect) must NOT show modal
  await sandbox.triggerSyncAll({ silent: true });
  assert.equal(modalEl.hidden, true, "Silent sync must not open sync progress modal");

  // 2. Explicit user triggerSyncAll({ silent: false }) opens modal and streams items
  await sandbox.triggerSyncAll({ silent: false });
  assert.equal(modalEl.hidden, false, "Modal must be open during sync");
  assert.equal(dismissBtn.hidden, false, "Dismiss button should be visible when sync finishes");
  assert.equal(progressBarEl.style.width, "100%", "Progress bar should be at 100%");
  assert.ok(summaryEl.textContent.includes("2 succeeded"), "Summary must reflect 2 succeeded");
  assert.ok(summaryEl.textContent.includes("1 failed"), "Summary must reflect 1 failed");

  // Check itemized list
  assert.equal(items.length, 3, "List must contain 3 item rows");
  assert.equal(items[0].className, "sync-item success", "First item row should have success class");
  assert.equal(items[0].children[0].textContent, "✓", "Success item should show ✓ checkmark");
  assert.equal(items[0].children[1].textContent, "林", "First item expression should be displayed");

  assert.equal(items[1].className, "sync-item success", "Second item row should have success class");
  assert.equal(items[1].children[1].textContent, "森", "Second item expression should be displayed");

  assert.equal(items[2].className, "sync-item failed", "Third item row should have failed class");
  assert.equal(items[2].children[0].textContent, "✗", "Failed item should show ✗ crossmark");
  assert.equal(items[2].children[1].textContent, "火", "Failed item expression should be displayed");
  assert.equal(items[2].children[2].textContent, "Deck not found", "Failed item error message should be displayed");
});
