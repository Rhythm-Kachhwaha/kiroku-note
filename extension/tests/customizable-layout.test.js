const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting Customizable Card Layout & Section Reordering Tests...\n");

// 1. Verify HTML DOM elements for Layout Settings
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

assert.ok(html.includes('id="btn-layout-settings"'), "Gear/Layout Settings button must exist in HTML");
assert.ok(html.includes('id="layout-settings-popover"'), "Layout Settings popover modal/dialog must exist in HTML");
assert.ok(html.includes('id="btn-close-layout-settings"'), "Close button for Layout Settings popover must exist in HTML");
assert.ok(html.includes('id="layout-sections-list"'), "Reorderable sections list container must exist in HTML");
assert.ok(html.includes('id="btn-reset-layout"'), "Reset to Default button must exist in HTML");
assert.ok(html.includes('id="card-layout-container"'), "Card layout container must exist in HTML");

// Verify all 6 reorderable sections exist with data-layout-section attributes
const expectedSections = ["preview", "fields", "media", "settings", "optional", "dictionary"];
for (const sectionId of expectedSections) {
  assert.ok(
    html.includes(`data-layout-section="${sectionId}"`),
    `Section '${sectionId}' must have data-layout-section="${sectionId}" attribute`
  );
}

// Verify structural sections outside card-layout-container remain fixed
const cardLayoutContainerIdx = html.indexOf('id="card-layout-container"');
const historySectionIdx = html.indexOf('id="history-section"');
assert.ok(cardLayoutContainerIdx !== -1, "Card layout container must exist");
assert.ok(historySectionIdx !== -1, "History section must exist");
assert.ok(cardLayoutContainerIdx < historySectionIdx, "History section must remain outside and below the card layout container");

console.log("PASS 1: HTML markup and data-layout-section attributes verified.");

// 2. Load and verify sidepanel.js layout functions
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

assert.ok(jsContent.includes("STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER"), "Storage key constant must exist in sidepanel.js");
assert.ok(jsContent.includes("DEFAULT_CARD_SECTION_ORDER"), "DEFAULT_CARD_SECTION_ORDER constant must exist in sidepanel.js");
assert.ok(jsContent.includes("SECTION_METADATA"), "SECTION_METADATA constant must exist in sidepanel.js");
assert.ok(jsContent.includes("function resolveValidSectionOrder"), "resolveValidSectionOrder function must exist");
assert.ok(jsContent.includes("async function loadStoredSectionOrder"), "loadStoredSectionOrder function must exist");
assert.ok(jsContent.includes("async function saveStoredSectionOrder"), "saveStoredSectionOrder function must exist");
assert.ok(jsContent.includes("function applySectionOrder"), "applySectionOrder function must exist");
assert.ok(jsContent.includes("function moveSectionByDelta"), "moveSectionByDelta function must exist");
assert.ok(jsContent.includes("function renderLayoutSettingsList"), "renderLayoutSettingsList function must exist");
assert.ok(jsContent.includes("async function resetLayoutSettings"), "resetLayoutSettings function must exist");

console.log("PASS 2: Required layout management functions exist in sidepanel.js.");

// 3. Mock DOM & Storage VM execution for layout unit tests
class MockElement {
  constructor(tagName, id = "", className = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = className;
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this._listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.draggable = false;
    this.type = "button";
    this.classList = {
      add: (...cls) => {
        const set = new Set(this.className.split(" ").filter(Boolean));
        cls.forEach(c => set.add(c));
        this.className = Array.from(set).join(" ");
      },
      remove: (...cls) => {
        const set = new Set(this.className.split(" ").filter(Boolean));
        cls.forEach(c => set.delete(c));
        this.className = Array.from(set).join(" ");
      },
      contains: (c) => this.className.split(" ").filter(Boolean).includes(c),
      toggle: (c) => {
        if (this.classList.contains(c)) this.classList.remove(c);
        else this.classList.add(c);
      }
    };
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  appendChild(child) {
    if (child.parentElement) {
      const p = child.parentElement;
      const idx = p.children.indexOf(child);
      if (idx !== -1) p.children.splice(idx, 1);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...newChildren) {
    this.children.forEach(c => { c.parentElement = null; });
    this.children = [];
    newChildren.forEach(c => this.appendChild(c));
  }

  querySelector(selector) {
    if (selector.startsWith("#")) {
      const targetId = selector.slice(1);
      return this._find(el => el.id === targetId);
    }
    if (selector.startsWith(".")) {
      const cls = selector.slice(1);
      return this._find(el => el.classList.contains(cls));
    }
    if (selector.startsWith("[data-layout-section=\"")) {
      const sectionVal = selector.match(/\[data-layout-section="([^"]+)"\]/)?.[1];
      return this._find(el => el.getAttribute("data-layout-section") === sectionVal);
    }
    return null;
  }


  querySelectorAll(selector) {
    const results = [];
    this._findAll(el => {
      if (selector.startsWith(".")) {
        const cls = selector.slice(1);
        return el.classList.contains(cls);
      }
      return false;
    }, results);
    return results;
  }

  _find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child._find(predicate);
      if (found) return found;
    }
    return null;
  }

  _findAll(predicate, results) {
    for (const child of this.children) {
      if (predicate(child)) results.push(child);
      child._findAll(predicate, results);
    }
  }

  addEventListener(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
  }

  dispatchEvent(event, payload = {}) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(fn => fn({
        target: this,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...payload
      }));
    }
  }

  focus() {
    this._focused = true;
  }

  contains(other) {
    if (this === other) return true;
    for (const child of this.children) {
      if (child.contains(other)) return true;
    }
    return false;
  }
}

// Build mock document hierarchy
const mockContainer = new MockElement("div", "card-layout-container");
for (const sectionId of expectedSections) {
  const secEl = new MockElement("div", `card-${sectionId}-section`);
  secEl.setAttribute("data-layout-section", sectionId);
  mockContainer.appendChild(secEl);
}

const mockBtnLayoutSettings = new MockElement("button", "btn-layout-settings");
const mockLayoutSettingsPopover = new MockElement("div", "layout-settings-popover");
mockLayoutSettingsPopover.hidden = true;
const mockBtnCloseLayoutSettings = new MockElement("button", "btn-close-layout-settings");
const mockLayoutSectionsList = new MockElement("div", "layout-sections-list");
const mockBtnResetLayout = new MockElement("button", "btn-reset-layout");

const mockStorageStore = {};
const mockChromeStorage = {
  local: {
    get: async (key) => {
      if (typeof key === "string") return { [key]: mockStorageStore[key] };
      if (Array.isArray(key)) {
        const res = {};
        key.forEach(k => { res[k] = mockStorageStore[k]; });
        return res;
      }
      return { ...mockStorageStore };
    },
    set: async (items) => {
      Object.assign(mockStorageStore, items);
    }
  }
};

const mockLocalStorage = {
  _store: {},
  getItem: (k) => mockLocalStorage._store[k] || null,
  setItem: (k, v) => { mockLocalStorage._store[k] = String(v); },
  removeItem: (k) => { delete mockLocalStorage._store[k]; },
  clear: () => { mockLocalStorage._store = {}; }
};

const vmContext = {
  document: {
    createElement: (tag) => new MockElement(tag),
    querySelector: (sel) => {
      if (sel === "#card-layout-container") return mockContainer;
      if (sel === "#btn-layout-settings") return mockBtnLayoutSettings;
      if (sel === "#layout-settings-popover") return mockLayoutSettingsPopover;
      if (sel === "#btn-close-layout-settings") return mockBtnCloseLayoutSettings;
      if (sel === "#layout-sections-list") return mockLayoutSectionsList;
      if (sel === "#btn-reset-layout") return mockBtnResetLayout;
      return null;
    },
    addEventListener: () => {}
  },
  chrome: {
    storage: mockChromeStorage,
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: async () => ({})
    }
  },
  localStorage: mockLocalStorage,
  console: console,
  Set: Set,
  Array: Array,
  Object: Object,
  JSON: JSON
};

vm.createContext(vmContext);

// Extract and execute the layout functions in VM
const layoutConstantsSlice = jsContent.slice(
  jsContent.indexOf("const STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER"),
  jsContent.indexOf("// History & Card Library elements")
);
const layoutFunctionsSlice = jsContent.slice(
  jsContent.indexOf("function resolveValidSectionOrder"),
  jsContent.indexOf("if (btnDismissFirstRun)")
);
const layoutSectionSlice = layoutConstantsSlice + "\n" + layoutFunctionsSlice;

vm.runInContext(layoutSectionSlice, vmContext);



const STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER = "kiroku.layout.cardSectionOrder";

const {
  resolveValidSectionOrder,
  getCurrentSectionOrder,
  loadStoredSectionOrder,
  saveStoredSectionOrder,
  applySectionOrder,
  moveSectionByDelta,
  renderLayoutSettingsList,
  openLayoutSettings,
  closeLayoutSettings,
  resetLayoutSettings
} = vmContext;

function assertOrder(actual, expected, message) {
  assert.deepEqual(Array.from(actual), expected, message);
}

// 4. Test resolveValidSectionOrder validation & migration rules
assertOrder(
  resolveValidSectionOrder(null),
  ["preview", "fields", "media", "settings", "optional", "dictionary"],
  "Null storage should resolve to canonical default order"
);

assertOrder(
  resolveValidSectionOrder(undefined),
  ["preview", "fields", "media", "settings", "optional", "dictionary"],
  "Undefined storage should resolve to canonical default order"
);

assertOrder(
  resolveValidSectionOrder("corrupted string"),
  ["preview", "fields", "media", "settings", "optional", "dictionary"],
  "Non-array storage should resolve to canonical default order"
);

assertOrder(
  resolveValidSectionOrder({ bad: "object" }),
  ["preview", "fields", "media", "settings", "optional", "dictionary"],
  "Object storage should resolve to canonical default order"
);

// Corrupted array with duplicates, invalid keys, and missing keys
const sampleCorrupted = ["dictionary", "preview", "garbage", "preview", 123, null];
const resolvedCorrupted = resolveValidSectionOrder(sampleCorrupted);
assertOrder(
  resolvedCorrupted,
  ["dictionary", "preview", "fields", "media", "settings", "optional"],
  "Should deduplicate, drop unknown IDs, and append missing sections in canonical order"
);

// Partial custom order
const partialOrder = ["media", "fields"];
const resolvedPartial = resolveValidSectionOrder(partialOrder);
assertOrder(
  resolvedPartial,
  ["media", "fields", "preview", "settings", "optional", "dictionary"],
  "Partial order should preserve specified order and append remaining in canonical order"
);

console.log("PASS 3: resolveValidSectionOrder robustness and migration verified.");

// 5. Test DOM application and reordering
const testOrder = ["dictionary", "media", "fields", "settings", "preview", "optional"];
applySectionOrder(testOrder);

const actualDomOrder = mockContainer.children.map(c => c.getAttribute("data-layout-section"));
assertOrder(actualDomOrder, testOrder, "DOM container child order must match applied section order");

console.log("PASS 4: applySectionOrder correctly re-parents DOM elements.");

// 6. Test Move Up and Move Down accessibility reordering
renderLayoutSettingsList(getCurrentSectionOrder());

assert.equal(mockLayoutSectionsList.children.length, 6, "Must render 6 section items in popover list");

// Check first item buttons
const firstItem = mockLayoutSectionsList.children[0];
const firstUpBtn = firstItem.querySelector(".btn-move-up");
const firstDownBtn = firstItem.querySelector(".btn-move-down");
assert.equal(firstUpBtn.disabled, true, "First item Move Up button must be disabled");
assert.equal(firstDownBtn.disabled, false, "First item Move Down button must be enabled");

// Move first item down (index 0 -> index 1)
moveSectionByDelta(0, 1);
const orderAfterDown = getCurrentSectionOrder();
assert.equal(orderAfterDown[0], "media", "Item 0 should now be media");
assert.equal(orderAfterDown[1], "dictionary", "Item 1 should now be dictionary");

// Move last item up (index 5 -> index 4)
const lastIdx = orderAfterDown.length - 1;
const lastItemName = orderAfterDown[lastIdx];
moveSectionByDelta(lastIdx, -1);
const orderAfterUp = getCurrentSectionOrder();
assert.equal(orderAfterUp[lastIdx - 1], lastItemName, "Last item should have moved up by 1");

console.log("PASS 5: Accessible moveSectionByDelta (Move Up / Move Down) verified.");

// 7. Test Popover open/close & reset to default
openLayoutSettings();
assert.equal(mockLayoutSettingsPopover.hidden, false, "Popover must be visible when opened");
assert.equal(mockBtnLayoutSettings.getAttribute("aria-expanded"), "true", "Gear button aria-expanded must be true");

closeLayoutSettings();
assert.equal(mockLayoutSettingsPopover.hidden, true, "Popover must be hidden when closed");
assert.equal(mockBtnLayoutSettings.getAttribute("aria-expanded"), "false", "Gear button aria-expanded must be false");

// Test Reset to default
(async () => {
  await resetLayoutSettings();
  assertOrder(
    getCurrentSectionOrder(),
    ["preview", "fields", "media", "settings", "optional", "dictionary"],
    "Reset must restore canonical default order in memory"
  );
  const resetDomOrder = mockContainer.children.map(c => c.getAttribute("data-layout-section"));
  assertOrder(
    resetDomOrder,
    ["preview", "fields", "media", "settings", "optional", "dictionary"],
    "Reset must immediately restore canonical default order in DOM"
  );
  assertOrder(
    mockStorageStore[STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER],
    ["preview", "fields", "media", "settings", "optional", "dictionary"],
    "Reset must persist canonical default order to chrome.storage.local"
  );
  console.log("PASS 6: Reset to Default and storage persistence verified.");

  // Test storage load/save cycle
  const customSave = ["optional", "media", "preview", "settings", "fields", "dictionary"];
  await saveStoredSectionOrder(customSave);
  assertOrder(mockStorageStore[STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER], customSave, "Custom order saved");

  const loaded = await loadStoredSectionOrder();
  assertOrder(loaded, customSave, "Custom order loaded correctly");

  console.log("PASS 7: Storage load & save roundtrip verified.");
  console.log("\n>>> ALL CUSTOMIZABLE CARD LAYOUT TESTS PASSED SUCCESSFULLY! <<<\n");
})();



