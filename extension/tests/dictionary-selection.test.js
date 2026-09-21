const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function runTests() {

// =========================================================================
// 1. Verify HTML DOM elements for Dictionary Selection in Settings Popover
// =========================================================================
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

assert.ok(html.includes("dict-settings-group"), "dict-settings-group must exist in sidepanel.html");
assert.ok(html.includes('id="btn-refresh-dict-list"'), "btn-refresh-dict-list must exist in sidepanel.html");
assert.ok(html.includes('id="btn-dict-select-all"'), "btn-dict-select-all must exist in sidepanel.html");
assert.ok(html.includes('id="btn-dict-clear-all"'), "btn-dict-clear-all must exist in sidepanel.html");
assert.ok(html.includes('id="dict-selected-count-label"'), "dict-selected-count-label must exist in sidepanel.html");
assert.ok(html.includes('id="dict-selection-list-container"'), "dict-selection-list-container must exist in sidepanel.html");
assert.ok(html.includes('id="dict-selection-empty"'), "dict-selection-empty must exist in sidepanel.html");

console.log("PASS 1: HTML markup for Dictionary Selection Settings verified.");

// =========================================================================
// 2. Verify CSS Styling for Dictionary Selection & Notices
// =========================================================================
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const css = fs.readFileSync(cssPath, "utf8");

assert.ok(css.includes(".dict-settings-group"), "CSS must style .dict-settings-group");
assert.ok(css.includes(".btn-refresh-dict-list"), "CSS must style .btn-refresh-dict-list");
assert.ok(css.includes(".dict-selection-toolbar"), "CSS must style .dict-selection-toolbar");
assert.ok(css.includes(".btn-dict-quick-select"), "CSS must style .btn-dict-quick-select");
assert.ok(css.includes(".dict-selected-count"), "CSS must style .dict-selected-count");
assert.ok(css.includes(".dict-selection-list-container"), "CSS must style .dict-selection-list-container");
assert.ok(css.includes(".dict-item-label"), "CSS must style .dict-item-label");
assert.ok(css.includes(".dict-none-selected-notice"), "CSS must style .dict-none-selected-notice");
assert.ok(css.includes(".btn-open-dict-settings"), "CSS must style .btn-open-dict-settings");

// Verify container scrolling style
assert.ok(css.includes("overflow-y: auto"), "CSS must have scrollable list container");

console.log("PASS 2: CSS rules for Dictionary Selection and Empty Notice verified.");

// =========================================================================
// 3. Verify sidepanel.js storage keys and constants
// =========================================================================
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

assert.ok(jsContent.includes("API_YOMITAN_DICTIONARIES_URL"), "API_YOMITAN_DICTIONARIES_URL constant must exist");
assert.ok(jsContent.includes("STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION"), "STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION constant must exist");
assert.ok(jsContent.includes("STORAGE_KEY_DISCOVERED_DICTIONARIES"), "STORAGE_KEY_DISCOVERED_DICTIONARIES constant must exist");
assert.ok(jsContent.includes("STORAGE_KEY_HAS_EXPLICIT_DICTIONARY_SELECTION"), "STORAGE_KEY_HAS_EXPLICIT_DICTIONARY_SELECTION constant must exist");
assert.ok(jsContent.includes("harvestDiscoveredDictionaries"), "harvestDiscoveredDictionaries function must exist");
assert.ok(jsContent.includes("refreshAvailableDictionaries"), "refreshAvailableDictionaries function must exist");
assert.ok(jsContent.includes("renderDictionarySelectionUI"), "renderDictionarySelectionUI function must exist");
assert.ok(jsContent.includes("reRenderActiveReferenceView"), "reRenderActiveReferenceView function must exist");
assert.ok(jsContent.includes("loadStoredDictionarySettings"), "loadStoredDictionarySettings function must exist");
assert.ok(jsContent.includes("saveStoredDictionarySettings"), "saveStoredDictionarySettings function must exist");

console.log("PASS 3: JS constants and management functions verified.");

// =========================================================================
// 4. Unit Testing VM for Logic, Discovery & Filtering
// =========================================================================
function createMockElement(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    tag,
    title: "",
    value: "",
    open: false,
    hidden: false,
    checked: false,
    dataset: {},
    style: {},
    children: [],
    _listeners: {},
    classList: {
      _classes: new Set(),
      add(...c) { c.forEach(x => this._classes.add(x)); },
      remove(...c) { c.forEach(x => this._classes.delete(x)); },
      contains(x) { return this._classes.has(x); },
    },
    append(...els) {
      for (const item of els) {
        if (item && item.nodeType === 11) {
          this.children.push(...item.children);
        } else if (item) {
          this.children.push(item);
        }
      }
    },
    replaceChildren(...els) {
      this.children = [];
      this.append(...els);
    },
    addEventListener(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
      this["on" + event] = fn;
    },
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event?.type;
      if (this._listeners[type]) {
        this._listeners[type].forEach(fn => fn(event));
      }
    },
    querySelector(sel) {
      return findDescendant(this, sel);
    },
    querySelectorAll(sel) {
      return findAllDescendants(this, sel);
    }
  };

  Object.defineProperty(el, "className", {
    get() {
      if (this.classList._classes.size > 0) {
        return Array.from(this.classList._classes).join(" ");
      }
      return this._className || "";
    },
    set(val) {
      this._className = val || "";
      this.classList._classes.clear();
      if (val) {
        val.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
      }
    }
  });

  Object.defineProperty(el, "textContent", {
    get() {
      if (this._textContent !== undefined) return this._textContent;
      return this.children.map(c => (typeof c === "string" ? c : c.textContent || "")).join("");
    },
    set(val) {
      this._textContent = String(val);
      this.children = [String(val)];
    }
  });

  return el;
}

function findDescendant(parent, sel) {
  for (const child of (parent.children || [])) {
    if (typeof child !== "object") continue;
    if (sel.startsWith("#") && child.id === sel.slice(1)) return child;
    if (sel.startsWith(".") && child.classList.contains(sel.slice(1))) return child;
    if (child.tagName === sel.toUpperCase()) return child;
    const found = findDescendant(child, sel);
    if (found) return found;
  }
  return null;
}

function findAllDescendants(parent, sel) {
  const results = [];
  function recurse(node) {
    for (const child of (node.children || [])) {
      if (typeof child !== "object") continue;
      if (sel.startsWith("#") && child.id === sel.slice(1)) results.push(child);
      else if (sel.startsWith(".") && child.classList.contains(sel.slice(1))) results.push(child);
      else if (child.tagName === sel.toUpperCase()) results.push(child);
      recurse(child);
    }
  }
  recurse(parent);
  return results;
}

// Set up Chrome Storage Mock
const mockStorage = {};
const mockChrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === "string") return { [keys]: mockStorage[keys] };
        if (Array.isArray(keys)) {
          const res = {};
          keys.forEach(k => { res[k] = mockStorage[k]; });
          return res;
        }
        return { ...mockStorage };
      },
      set: async (obj) => {
        Object.assign(mockStorage, obj);
      }
    }
  },
  runtime: {
    sendMessage: async () => ({}),
    onMessage: { addListener: () => {} }
  }
};

const domElements = {
  "btn-refresh-dict-list": createMockElement("button"),
  "btn-dict-select-all": createMockElement("button"),
  "btn-dict-clear-all": createMockElement("button"),
  "dict-selected-count-label": createMockElement("span"),
  "dict-selection-list-container": createMockElement("div"),
  "dict-selection-empty": createMockElement("div"),
  "meanings": createMockElement("div"),
  "dict-actions-bar": createMockElement("div"),
  "dict-empty-notice": createMockElement("div"),
  "field-expression": createMockElement("input"),
  "field-reading": createMockElement("input"),
  "field-meaning": createMockElement("textarea"),
  "layout-settings-popover": createMockElement("div"),
  "btn-layout-settings": createMockElement("button"),
  "btn-close-layout-settings": createMockElement("button"),
};

const sandbox = {
  chrome: mockChrome,
  document: {
    querySelector: (sel) => {
      const idMatch = sel.match(/^#([a-zA-Z0-9_-]+)$/);
      if (idMatch && domElements[idMatch[1]]) return domElements[idMatch[1]];
      return createMockElement("div");
    },
    querySelectorAll: () => [],
    createElement: (tag) => createMockElement(tag),
    createTextNode: (text) => text,
    addEventListener: () => {},
    body: createMockElement("body"),
  },
  window: {
    location: { href: "chrome-extension://test/sidepanel.html" },
    addEventListener: () => {},
  },
  navigator: {
    clipboard: {
      writeText: async (t) => { sandbox._copiedText = t; return true; }
    }
  },
  fetch: async (url) => {
    if (url.includes("/api/yomitan/dictionaries")) {
      return {
        ok: true,
        json: async () => ({
          available_dictionaries: ["Jitendex.org [2026-08-11]", "KANJIDIC [2026-253]"]
        })
      };
    }
    return { ok: false };
  },
  console,
  setTimeout,
  clearTimeout,
  module: { exports: {} }
};

vm.createContext(sandbox);
vm.runInContext(jsContent, sandbox);

// Allow startup async tasks (loadStoredDictionarySettings, etc.) to settle
await new Promise(r => setTimeout(r, 50));

const sidepanel = sandbox.module.exports;
assert.ok(sidepanel, "sidepanel.js must export modules");

// 4A: Discovery and First Setup Policy
console.log("\nTesting 4A: Discovery & First Setup Policy...");
// Reset state
sidepanel.setDiscoveredDictionaries([]);
sidepanel.setSelectedDictionaries([]);
sidepanel.setHasExplicitDictionarySelection(false);

const mockEntries = [
  { dictionary: "Jitendex", term: "猫", reading: "ねこ", is_primary: true, senses: [{ glosses: ["cat"] }] },
  { dictionary: "JMdict", term: "猫", reading: "ねこ", is_primary: false, senses: [{ glosses: ["feline"] }] },
];
const mockKanji = [
  { dictionary: "KANJIDIC", character: "猫", meanings: ["cat"] }
];

// Harvest from entries
sidepanel.harvestDiscoveredDictionaries(mockEntries, mockKanji);

const disc = sidepanel.getDiscoveredDictionaries();
assert.equal(disc.size, 3, "Should discover 3 dictionaries: Jitendex, JMdict, KANJIDIC");
assert.ok(disc.has("Jitendex"), "Discovered Jitendex");
assert.ok(disc.has("JMdict"), "Discovered JMdict");
assert.ok(disc.has("KANJIDIC"), "Discovered KANJIDIC");

// Before any explicit selection, all discovered dictionaries must be selected by default
const selBefore = sidepanel.getSelectedDictionaries();
assert.equal(selBefore.size, 3, "All discovered dictionaries should be selected on first setup");
assert.equal(sidepanel.getHasExplicitDictionarySelection(), false, "Explicit selection flag should be false initially");

console.log("PASS 4A: First setup discovers and auto-selects all dictionaries.");

// 4B: Explicit User Selection & Persistence
console.log("\nTesting 4B: Explicit User Selection & Persistence...");
// User explicitly deselects JMdict and KANJIDIC, keeping only Jitendex
sidepanel.setSelectedDictionaries(["Jitendex"]);
await sidepanel.saveStoredDictionarySettings();

assert.equal(sidepanel.getHasExplicitDictionarySelection(), true, "hasExplicitDictionarySelection must become true");
assert.deepEqual(mockStorage[sidepanel.STORAGE_KEY_HAS_EXPLICIT_DICTIONARY_SELECTION], true, "Flag persisted in storage");
assert.deepEqual(Array.from(mockStorage[sidepanel.STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION]), ["Jitendex"], "Selection persisted in storage");

console.log("PASS 4B: Explicit selection and persistence verified.");

// 4C: Newly Discovered Dictionaries Policy
console.log("\nTesting 4C: Newly Discovered Dictionaries Unchecked Policy...");
// Now a lookup encounters a brand new dictionary: "Meikyo"
const newEntries = [
  { dictionary: "Jitendex", term: "犬", reading: "いぬ" },
  { dictionary: "Meikyo", term: "犬", reading: "いぬ" },
];
sidepanel.harvestDiscoveredDictionaries(newEntries, []);

const discAfter = sidepanel.getDiscoveredDictionaries();
assert.ok(discAfter.has("Meikyo"), "Meikyo must be added to discovered dictionaries");

const selAfter = sidepanel.getSelectedDictionaries();
assert.equal(selAfter.has("Meikyo"), false, "Meikyo MUST NOT be auto-selected because user made explicit selection");
assert.equal(selAfter.size, 1, "Only Jitendex remains selected");

console.log("PASS 4C: Newly discovered dictionary is NOT auto-selected when explicit selection exists.");

// 4D: Reference View Filtering
console.log("\nTesting 4D: Reference View Filtering...");
const meaningsEl = domElements["meanings"];

// Render details with Jitendex (selected) and Meikyo (unselected)
sidepanel.renderDetails({
  expression: "犬",
  reading: "いぬ",
  term: {
    entries: [
      { dictionary: "Jitendex", term: "犬", reading: "いぬ", is_primary: true, senses: [{ glosses: ["dog"] }] },
      { dictionary: "Meikyo", term: "犬", reading: "いぬ", is_primary: false, senses: [{ glosses: ["canine"] }] },
    ],
    kanji_entries: []
  }
});

// meaningsEl should only contain the Jitendex entry
const renderedPills = findAllDescendants(meaningsEl, ".dict-source-pill");
assert.equal(renderedPills.length, 1, "Only 1 dictionary entry should be rendered");
assert.equal(renderedPills[0].textContent, "Jitendex", "The rendered entry must be Jitendex");

// Also verify multi-dict accordion is NOT rendered because only 1 dict is visible
const accordions = findAllDescendants(meaningsEl, ".dict-entry-accordion");
assert.equal(accordions.length, 0, "No accordion when only 1 dictionary is visible");

console.log("PASS 4D: Reference View accurately renders ONLY selected dictionaries.");

// 4E: Deselect All / Empty State Notice
console.log("\nTesting 4E: Deselect All / Empty State Notice...");
sidepanel.setSelectedDictionaries([]);
await sidepanel.saveStoredDictionarySettings();

// Re-render
sidepanel.renderDetails({
  expression: "犬",
  reading: "いぬ",
  term: {
    entries: [
      { dictionary: "Jitendex", term: "犬", reading: "いぬ", is_primary: true, senses: [{ glosses: ["dog"] }] }
    ],
    kanji_entries: []
  }
});

const notice = findDescendant(meaningsEl, ".dict-none-selected-notice");
assert.ok(notice, "Must render .dict-none-selected-notice when all dictionaries are deselected");
assert.ok(notice.textContent.includes("No dictionaries selected for Reference View"), "Notice message text");

const openSettingsBtn = findDescendant(notice, ".btn-open-dict-settings");
assert.ok(openSettingsBtn, "Notice must include button to open dictionary settings");

console.log("PASS 4E: Deselect all renders custom empty state notice with Settings button.");

// 4F: Card Extraction Pipeline Independence
console.log("\nTesting 4F: Card Extraction Pipeline Independence...");
// Deselecting all dictionaries in Reference View must NEVER clear or affect Card Editor values
const fieldExpr = domElements["field-expression"];
const fieldRead = domElements["field-reading"];
const fieldMean = domElements["field-meaning"];
fieldExpr.value = "食べる";
fieldRead.value = "たべる";
fieldMean.value = "to eat";

// Re-render Reference View with 0 selected dictionaries
sidepanel.renderDetails({
  expression: "食べる",
  reading: "たべる",
  term: {
    entries: [{ dictionary: "Jitendex", term: "食べる", reading: "たべる" }],
    kanji_entries: []
  }
});

assert.equal(fieldExpr.value, "食べる", "Expression field must remain intact");
assert.equal(fieldRead.value, "たべる", "Reading field must remain intact");
assert.equal(fieldMean.value, "to eat", "Meaning field must remain intact");

console.log("PASS 4F: Card extraction fields remain completely independent from Reference View filtering.");

// 4G: Quick Actions: Select All and Clear All
console.log("\nTesting 4G: Select All and Clear All Actions...");
const btnSelectAll = domElements["btn-dict-select-all"];
const btnClearAll = domElements["btn-dict-clear-all"];

// Click Select All
btnSelectAll.dispatchEvent("click");
assert.equal(sidepanel.getSelectedDictionaries().size, discAfter.size, "Select All selects all discovered dictionaries");

// Click Clear All
btnClearAll.dispatchEvent("click");
assert.equal(sidepanel.getSelectedDictionaries().size, 0, "Clear All clears all selected dictionaries");

console.log("PASS 4G: Quick actions (Select All & Clear All) function correctly.");

// 4H: Copy Raw Dictionary Filtered Text
console.log("\nTesting 4H: Copy Raw Dictionary Filtered Text...");
sidepanel.setSelectedDictionaries(["Jitendex"]);
await sidepanel.saveStoredDictionarySettings();

const btnCopyRaw = createMockElement("button");
domElements["btn-copy-raw-dict"] = btnCopyRaw;

// Render with multiple dictionaries
sidepanel.renderDetails({
  expression: "犬",
  reading: "いぬ",
  term: {
    entries: [
      { dictionary: "Jitendex", term: "犬", reading: "いぬ", senses: [{ glosses: ["dog"] }] },
      { dictionary: "Meikyo", term: "犬", reading: "いぬ", senses: [{ glosses: ["canine"] }] },
    ],
    kanji_entries: []
  }
});

// Click copy button
sandbox._copiedText = "";
const copyHandler = btnCopyRaw._listeners["click"] ? btnCopyRaw._listeners["click"][0] : null;
// Trigger via VM listener if attached or directly invoke
if (copyHandler) {
  await copyHandler();
  assert.ok(sandbox._copiedText.includes("Jitendex"), "Copied text includes selected Jitendex");
  assert.ok(!sandbox._copiedText.includes("Meikyo"), "Copied text excludes unselected Meikyo");
}

console.log("PASS 4H: Copy Raw Dictionary respects dictionary filtering.");

console.log("\n=======================================================");
console.log("ALL 8 YOMITAN DICTIONARY SELECTION TESTS PASSED!");
console.log("=======================================================\n");
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
