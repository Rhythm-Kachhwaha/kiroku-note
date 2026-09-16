const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const jsPath = fs.existsSync("extension/sidepanel/sidepanel.js")
  ? "extension/sidepanel/sidepanel.js"
  : path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

function createMockElement(tagName, id = "") {
  const el = {
    tagName: tagName.toUpperCase(),
    id,
    value: "",
    textContent: "",
    hidden: false,
    disabled: false,
    className: "",
    options: [],
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
      const type = typeof event === "string" ? event : event.type || "click";
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

console.log("Running Deck-Aware Saved-State & Duplicate UI Regression Tests...");

(async () => {
  // In-memory database simulation for testing
  let nextCardId = 1;
  const storedCards = [];

  function findCard(expr, reading, deck) {
    const nExpr = (expr || "").trim().toLowerCase();
    const nRead = (reading || "").trim().toLowerCase();
    const nDeck = (deck || "Default").trim().toLowerCase();
    return storedCards.find(c => {
      return (
        (c.expression || "").trim().toLowerCase() === nExpr &&
        (c.reading || "").trim().toLowerCase() === nRead &&
        (c.deck_name || "Default").trim().toLowerCase() === nDeck
      );
    });
  }

  const mockFetch = async (url, opts = {}) => {
    const urlObj = new URL(url);
    const method = (opts.method || "GET").toUpperCase();

    // GET /api/cards
    if (urlObj.pathname === "/api/cards" && method === "GET") {
      const deck = urlObj.searchParams.get("deck");
      const search = urlObj.searchParams.get("search");

      let filtered = [...storedCards];
      if (deck && deck !== "all") {
        filtered = filtered.filter(c => (c.deck_name || "Default").trim().toLowerCase() === deck.trim().toLowerCase());
      }
      if (search) {
        const s = search.trim().toLowerCase();
        filtered = filtered.filter(c =>
          (c.expression || "").toLowerCase().includes(s) ||
          (c.reading || "").toLowerCase().includes(s)
        );
      }

      return {
        ok: true,
        json: async () => ({
          cards: filtered,
          total: filtered.length,
          limit: 50,
          offset: 0,
        }),
      };
    }

    // POST /api/cards/save
    if (urlObj.pathname === "/api/cards/save" && method === "POST") {
      const payload = JSON.parse(opts.body || "{}");
      const existing = findCard(payload.expression, payload.reading, payload.deck_name);

      if (existing && (!payload.id || payload.id !== existing.id)) {
        return {
          ok: true,
          json: async () => ({
            ...existing,
            is_duplicate: true,
            is_new: false,
            is_updated: false,
          }),
        };
      }

      if (payload.id) {
        const idx = storedCards.findIndex(c => c.id === payload.id);
        if (idx >= 0) {
          const updated = { ...storedCards[idx], ...payload, updated_at: new Date().toISOString() };
          storedCards[idx] = updated;
          return {
            ok: true,
            json: async () => ({
              ...updated,
              is_duplicate: false,
              is_new: false,
              is_updated: true,
            }),
          };
        }
      }

      const newCard = {
        id: nextCardId++,
        expression: payload.expression,
        reading: payload.reading || "",
        meaning: payload.meaning || "",
        deck_name: payload.deck_name || "Default",
        sync_status: "pending",
        sync_error: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      storedCards.push(newCard);
      return {
        ok: true,
        json: async () => ({
          ...newCard,
          is_duplicate: false,
          is_new: true,
          is_updated: false,
        }),
      };
    }

    // POST /api/capture
    if (urlObj.pathname === "/api/capture" && method === "POST") {
      const payload = JSON.parse(opts.body || "{}");
      const expr = payload.text;
      const reading = payload.text === "食べる" ? "たべる" : "";
      const deck = payload.deck_name || "Default";
      const existing = findCard(expr, reading, deck);

      if (existing) {
        return {
          ok: true,
          json: async () => ({
            id: existing.id,
            expression: existing.expression,
            reading: existing.reading,
            meaning: existing.meaning,
            deck_name: existing.deck_name,
            is_duplicate: true,
            status: "already_saved",
            sync_status: existing.sync_status,
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          id: null,
          expression: expr,
          reading: reading,
          meaning: "to eat",
          deck_name: deck,
          is_duplicate: false,
          status: "draft",
          sync_status: "pending",
        }),
      };
    }

    return { ok: false, status: 404, json: async () => ({}) };
  };

  const fieldExpression = createMockElement("input", "field-expression");
  const fieldReading = createMockElement("input", "field-reading");
  const fieldMeaning = createMockElement("textarea", "field-meaning");
  const fieldDeckSelect = createMockElement("select", "field-deck-select");
  const fieldDeckName = createMockElement("input", "field-deck-name");
  const fieldCardId = createMockElement("input", "field-card-id");
  const saveBadge = createMockElement("span", "save-badge");
  const saveCardBtn = createMockElement("button", "save-card-btn");
  const statusEl = createMockElement("div", "capture-status");
  const expressionEl = createMockElement("div", "expression");
  const readingEl = createMockElement("div", "reading");
  const cardEditor = createMockElement("form", "card-editor");

  fieldDeckSelect.options = [
    { value: "Deck A", textContent: "Deck A" },
    { value: "Deck B", textContent: "Deck B" },
  ];

  let currentStatus = "";
  let currentSyncUIStatus = "";

  const sandbox = {
    document: {
      querySelector: (sel) => {
        switch (sel) {
          case "#field-expression": return fieldExpression;
          case "#field-reading": return fieldReading;
          case "#field-meaning": return fieldMeaning;
          case "#field-deck-select": return fieldDeckSelect;
          case "#field-deck-name": return fieldDeckName;
          case "#field-card-id": return fieldCardId;
          case "#save-badge": return saveBadge;
          case "#save-card-btn": return saveCardBtn;
          case "#capture-status": return statusEl;
          case "#expression": return expressionEl;
          case "#reading": return readingEl;
          case "#card-editor": return cardEditor;
          default: return null;
        }
      },
      addEventListener: () => {},
    },
    fieldExpression,
    fieldReading,
    fieldMeaning,
    fieldDeckSelect,
    fieldDeckName,
    fieldCardId,
    saveBadge,
    saveCardBtn,
    status: statusEl,
    expression: expressionEl,
    reading: readingEl,
    cardEditor,
    API_CARDS_URL: "http://127.0.0.1:8000/api/cards",
    API_SAVE_URL: "http://127.0.0.1:8000/api/cards/save",
    API_CAPTURE_URL: "http://127.0.0.1:8000/api/capture",
    fetch: mockFetch,
    URLSearchParams,
    URL,
    setTimeout,
    clearTimeout,
    console,
    ankiConnected: true,
    currentCaptureId: 0,
    currentDraftMedia: {},
    currentDictionaryEntries: [],
    currentKanjiEntries: [],
    sessionCardCount: 0,
    selectedHistoryCardId: null,
    formatErrorMessage: (e) => String(e.message || e),
    setStatus: (msg) => { currentStatus = msg; },
    updateSyncUI: (st) => { currentSyncUIStatus = st; },
    scheduleCardPreviewUpdate: () => {},
    updateSessionCounter: () => {},
    loadHistory: async () => {},
    renderDetails: () => {},
    clearDictionaryView: () => {},
    clearAllMedia: () => {},
    updateMediaPreviews: () => {},
    setIndicatorStatus: () => {},
  };

  vm.createContext(sandbox);

  // Extract functions and event attachments from sidepanel.js
  const duplicateFnsCode = jsContent.slice(
    jsContent.indexOf("var duplicateCheckTimer = null;"),
    jsContent.indexOf("// Card save form submission")
  );
  vm.runInContext(duplicateFnsCode, sandbox);

  // Run identify definition
  const identifyCode = jsContent.slice(
    jsContent.indexOf("async function identify(text)"),
    jsContent.indexOf("// Media preview management")
  );
  vm.runInContext(identifyCode, sandbox);

  // Helper for saving
  async function simulateSave() {
    const expr = fieldExpression.value.trim();
    const read = fieldReading.value.trim();
    const targetDeck = fieldDeckSelect.value.trim() || fieldDeckName.value.trim() || "Default";
    const payload = {
      id: fieldCardId.value ? parseInt(fieldCardId.value, 10) : null,
      expression: expr,
      reading: read,
      meaning: fieldMeaning.value.trim(),
      deck_name: targetDeck,
    };

    const res = await mockFetch("http://127.0.0.1:8000/api/cards/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();

    if (body.is_duplicate) {
      saveBadge.textContent = "ALREADY SAVED";
      saveBadge.className = "badge already-saved";
      saveBadge.hidden = false;
      fieldCardId.value = String(body.id);
      sandbox.setStatus("Card already saved.");
    } else {
      saveBadge.textContent = "SAVED";
      saveBadge.className = "badge saved";
      saveBadge.hidden = false;
      fieldCardId.value = String(body.id);
      sandbox.setStatus(body.is_updated ? "Card updated." : "Card saved.");
    }
    return body;
  }

  // =========================================================================
  // TEST A: Save expression+reading in Deck A -> same expression+reading in Deck A is duplicate
  // =========================================================================
  console.log("Test A: Save 食べる / たべる in Deck A...");
  fieldExpression.value = "食べる";
  fieldReading.value = "たべる";
  fieldMeaning.value = "to eat";
  fieldDeckSelect.value = "Deck A";
  fieldDeckName.value = "Deck A";
  fieldCardId.value = "";

  const saveA1 = await simulateSave();
  assert.equal(saveA1.is_new, true, "First save in Deck A must be new");
  assert.equal(saveA1.is_duplicate, false, "First save in Deck A must not be duplicate");
  assert.equal(saveBadge.textContent, "SAVED", "Badge should indicate SAVED");
  assert.equal(fieldCardId.value, "1", "Card ID should be 1");

  // Recalculate duplicate state in Deck A
  await sandbox.refreshDuplicateState();
  assert.equal(saveBadge.hidden, false, "Badge must be visible");
  assert.equal(saveBadge.textContent, "ALREADY SAVED", "Should show ALREADY SAVED in Deck A");
  assert.equal(fieldCardId.value, "1", "FieldCardId should point to Deck A card");

  // =========================================================================
  // TEST B: Switch to Deck B -> same expression+reading becomes saveable
  // =========================================================================
  console.log("Test B: Switch to Deck B -> becomes saveable...");
  fieldDeckSelect.value = "Deck B";
  fieldDeckName.value = "Deck B";

  await sandbox.refreshDuplicateState();
  assert.equal(saveBadge.hidden, true, "Badge must be hidden when switching to unsaved Deck B");
  assert.equal(saveBadge.textContent, "", "Badge text must be cleared");
  assert.equal(fieldCardId.value, "", "FieldCardId must be cleared to allow saving new card in Deck B");
  assert.equal(currentStatus, "Card draft ready. Edit and save.", "Status should invite user to save");

  // =========================================================================
  // TEST C: Save it in Deck B -> becomes blocked as duplicate when Deck B selected
  // =========================================================================
  console.log("Test C: Save it in Deck B...");
  const saveB1 = await simulateSave();
  assert.equal(saveB1.is_new, true, "First save in Deck B must be new");
  assert.equal(saveB1.is_duplicate, false, "First save in Deck B must not be duplicate");
  assert.equal(saveB1.id, 2, "Should create a distinct card in Deck B with ID 2");
  assert.equal(storedCards.length, 2, "Database must hold 2 distinct cards for Deck A and Deck B");

  // Recalculate duplicate state for Deck B
  await sandbox.refreshDuplicateState();
  assert.equal(saveBadge.hidden, false, "Badge must be visible in Deck B after saving");
  assert.equal(saveBadge.textContent, "ALREADY SAVED", "Should show ALREADY SAVED in Deck B");
  assert.equal(fieldCardId.value, "2", "FieldCardId should point to Deck B card ID (2)");

  // =========================================================================
  // TEST D: Switch back to Deck A -> correctly recognized as already saved with ID 1
  // =========================================================================
  console.log("Test D: Switch back to Deck A...");
  fieldDeckSelect.value = "Deck A";
  fieldDeckName.value = "Deck A";

  await sandbox.refreshDuplicateState();
  assert.equal(saveBadge.hidden, false, "Badge must be visible in Deck A");
  assert.equal(saveBadge.textContent, "ALREADY SAVED", "Should show ALREADY SAVED in Deck A");
  assert.equal(fieldCardId.value, "1", "FieldCardId should point back to Deck A card ID (1)");
  assert.equal(currentStatus, "Card already saved.");

  // =========================================================================
  // TEST E: Different reading in the same deck remains allowed
  // =========================================================================
  console.log("Test E: Different reading in same deck...");
  fieldReading.value = "くらう";

  await sandbox.refreshDuplicateState();
  assert.equal(saveBadge.hidden, true, "Badge must be hidden for different reading in Deck A");
  assert.equal(fieldCardId.value, "", "FieldCardId must be empty for different reading");
  assert.equal(currentStatus, "Card draft ready. Edit and save.");

  // Save the different reading in Deck A
  const saveA2 = await simulateSave();
  assert.equal(saveA2.is_new, true, "Different reading must be saved as a new card");
  assert.equal(saveA2.id, 3, "New reading gets ID 3");
  assert.equal(storedCards.length, 3, "Database must hold 3 cards total");

  // Restore reading to たべる
  fieldReading.value = "たべる";
  await sandbox.refreshDuplicateState();
  assert.equal(saveBadge.textContent, "ALREADY SAVED", "Restoring reading should restore ALREADY SAVED");
  assert.equal(fieldCardId.value, "1", "Restoring reading points back to card 1");

  // =========================================================================
  // TEST F: Changing the deck while a captured word is displayed immediately refreshes state
  // =========================================================================
  console.log("Test F: Changing deck with captured word displayed...");
  // Simulate capture of 飲む in Deck A (not saved yet)
  fieldExpression.value = "飲む";
  fieldReading.value = "のむ";
  fieldDeckSelect.value = "Deck A";
  fieldDeckName.value = "Deck A";
  fieldCardId.value = "";

  await sandbox.refreshDuplicateState();
  assert.equal(saveBadge.hidden, true, "Unsaved word 飲む in Deck A has hidden badge");

  // Save 飲む in Deck A
  await simulateSave();
  assert.equal(fieldCardId.value, "4", "飲む in Deck A gets card ID 4");

  // Switch to Deck B while 飲む is displayed
  fieldDeckSelect.value = "Deck B";
  fieldDeckName.value = "Deck B";
  await sandbox.refreshDuplicateState();

  assert.equal(saveBadge.hidden, true, "Changing to Deck B immediately removes ALREADY SAVED without recapturing");
  assert.equal(fieldCardId.value, "", "FieldCardId cleared so user can save 飲む in Deck B immediately");
  assert.equal(currentStatus, "Card draft ready. Edit and save.");

  // Switch back to Deck A while 飲む is displayed
  fieldDeckSelect.value = "Deck A";
  fieldDeckName.value = "Deck A";
  await sandbox.refreshDuplicateState();

  assert.equal(saveBadge.hidden, false, "Switching back to Deck A immediately shows ALREADY SAVED");
  assert.equal(saveBadge.textContent, "ALREADY SAVED");
  assert.equal(fieldCardId.value, "4", "FieldCardId points to card 4");
  assert.equal(currentStatus, "Card already saved.");

  console.log(">>> ALL DECK-AWARE DUPLICATE UI REGRESSION TESTS PASSED! <<<");
})();
