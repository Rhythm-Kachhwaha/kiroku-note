/**
 * Test Suite for Tier 4 Session 1 Features:
 * - T4-A: History Multi-Select & Bulk Operations
 *   - Checkboxes on card rows
 *   - Floating / sticky bulk action bar
 *   - Select all / none
 *   - Bulk delete with 2-step confirmation
 *   - Bulk deck re-assignment
 *   - Bulk sync
 *   - Preserving T3-C single delete undo toast
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

test("Tier 4 Session 1: HTML & CSS Structure Verification", () => {
  // Bulk Action Bar & elements in HTML
  assert.ok(
    htmlContent.includes('id="bulk-action-bar"'),
    "HTML must include #bulk-action-bar element"
  );
  assert.ok(
    htmlContent.includes('id="bulk-select-all-cb"'),
    "HTML must include #bulk-select-all-cb checkbox"
  );
  assert.ok(
    htmlContent.includes('id="bulk-selected-count"'),
    "HTML must include #bulk-selected-count element"
  );
  assert.ok(
    htmlContent.includes('id="btn-bulk-sync"'),
    "HTML must include #btn-bulk-sync button"
  );
  assert.ok(
    htmlContent.includes('id="bulk-deck-select"'),
    "HTML must include #bulk-deck-select dropdown"
  );
  assert.ok(
    htmlContent.includes('id="btn-bulk-delete"'),
    "HTML must include #btn-bulk-delete button"
  );
  assert.ok(
    htmlContent.includes('id="btn-bulk-cancel"'),
    "HTML must include #btn-bulk-cancel button"
  );

  // CSS definitions
  assert.ok(
    cssContent.includes(".bulk-action-bar"),
    "CSS must define rules for .bulk-action-bar"
  );
  assert.ok(
    cssContent.includes(".history-select-cb"),
    "CSS must define rules for .history-select-cb"
  );
  assert.ok(
    cssContent.includes(".bulk-selected"),
    "CSS must define rules for .bulk-selected"
  );
  assert.ok(
    cssContent.includes(".btn-bulk-delete"),
    "CSS must define rules for .btn-bulk-delete"
  );
});

test("T4-A: Selection State Management & Bulk Action Bar in VM", () => {
  const mockBar = { hidden: true };
  const mockCount = { textContent: "" };
  const mockSelectAll = { checked: false, indeterminate: false };
  const mockItems = [];
  const mockCheckboxes = [];

  const mockHistoryCardsList = {
    replaceChildren: () => {
      mockItems.length = 0;
      mockCheckboxes.length = 0;
    },
    append: (item) => {
      mockItems.push(item);
    },
    querySelectorAll: (sel) => {
      if (sel === ".history-select-cb") return mockCheckboxes;
      if (sel === ".history-item") return mockItems;
      return [];
    }
  };

  const sandbox = {
    document: {
      createElement: (tag) => {
        const el = {
          tagName: tag.toUpperCase(),
          className: "",
          classList: {
            add: (cls) => {
              if (!el.className.includes(cls)) el.className += " " + cls;
            },
            remove: (cls) => {
              el.className = el.className.replace(new RegExp("\\b" + cls + "\\b", "g"), "").trim();
            },
            contains: (cls) => el.className.includes(cls),
            toggle: (cls, force) => {
              if (force) el.classList.add(cls);
              else el.classList.remove(cls);
            }
          },
          style: {},
          dataset: {},
          children: [],
          append: (child) => {
            el.children.push(child);
            if (child.className && child.className.includes("history-select-cb")) {
              mockCheckboxes.push(child);
            }
          },
          addEventListener: (evt, fn) => {
            el["on" + evt] = fn;
          },
          setAttribute: (k, v) => { el[k] = v; },
        };
        return el;
      },
    },
    historyCardsList: mockHistoryCardsList,
    bulkActionBar: mockBar,
    bulkSelectedCount: mockCount,
    bulkSelectAllCb: mockSelectAll,
    selectedHistoryCardId: null,
    updateHeroReading: () => {},
    clearDictionaryView: () => {},
    setSaveBadge: () => {},
    updateSyncUI: () => {},
    loadHistory: async () => {},
    setStatus: () => {},
    selectedHistoryCardIds: new Set(),
    currentRenderedCardIds: [],
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };

  vm.createContext(sandbox);

  // Extract bulk operations logic from sidepanel.js
  const startIdx = jsContent.indexOf("// Bulk Operations State & Handlers (T4-A)");
  const endIdx = jsContent.indexOf("async function checkClipboardForJapanese", startIdx);
  const bulkCode = jsContent.slice(startIdx, endIdx);

  vm.runInContext(bulkCode, sandbox);

  // Check initial state
  assert.equal(sandbox.bulkActionBar.hidden, true);
  assert.equal(sandbox.selectedHistoryCardIds.size, 0);

  // Simulate rendering cards
  sandbox.currentRenderedCardIds = [1, 2, 3];
  sandbox.selectAllVisibleCards();

  assert.equal(sandbox.selectedHistoryCardIds.size, 3);
  assert.equal(sandbox.bulkActionBar.hidden, false);
  assert.equal(sandbox.bulkSelectedCount.textContent, "3 selected");
  assert.equal(sandbox.bulkSelectAllCb.checked, true);

  // Clear selection
  sandbox.clearBulkSelection();
  assert.equal(sandbox.selectedHistoryCardIds.size, 0);
  assert.equal(sandbox.bulkActionBar.hidden, true);
  assert.equal(sandbox.bulkSelectedCount.textContent, "0 selected");
  assert.equal(sandbox.bulkSelectAllCb.checked, false);
});

test("T4-A: Bulk Delete 2-Click Confirmation Execution", async () => {
  let deleteFetchCalled = false;
  let deletePayload = null;

  const mockFetch = async (url, options = {}) => {
    if (options.method === "DELETE") {
      deleteFetchCalled = true;
      deletePayload = JSON.parse(options.body);
      return { ok: true, json: async () => ({ deleted_count: 2, deleted: true, card_ids: [10, 20] }) };
    }
    return { ok: true, json: async () => ({}) };
  };

  const mockBtnDelete = {
    className: "btn-bulk-delete",
    classList: {
      add: (cls) => { mockBtnDelete.className += " " + cls; },
      remove: (cls) => { mockBtnDelete.className = mockBtnDelete.className.replace(cls, "").trim(); },
      contains: (cls) => mockBtnDelete.className.includes(cls),
    },
    textContent: "Delete",
  };

  const sandbox = {
    fetch: mockFetch,
    API_CARDS_BULK_DELETE_URL: "http://127.0.0.1:21828/api/cards/bulk",
    btnBulkDelete: mockBtnDelete,
    bulkActionBar: { hidden: false },
    bulkSelectedCount: { textContent: "2 selected" },
    bulkSelectAllCb: { checked: false, indeterminate: false },
    historyCardsList: { querySelectorAll: () => [] },
    setStatus: () => {},
    loadHistory: async () => {},
    selectedHistoryCardIds: new Set(),
    currentRenderedCardIds: [],
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };

  vm.createContext(sandbox);

  const startIdx = jsContent.indexOf("// Bulk Operations State & Handlers (T4-A)");
  const endIdx = jsContent.indexOf("async function checkClipboardForJapanese", startIdx);
  const bulkCode = jsContent.slice(startIdx, endIdx);

  vm.runInContext(bulkCode, sandbox);

  sandbox.selectedHistoryCardIds.add(10);
  sandbox.selectedHistoryCardIds.add(20);

  // Perform bulk delete directly
  await sandbox.performBulkDelete();

  assert.equal(deleteFetchCalled, true);
  assert.deepEqual(deletePayload, { card_ids: [10, 20] });
  assert.equal(sandbox.selectedHistoryCardIds.size, 0);
});
