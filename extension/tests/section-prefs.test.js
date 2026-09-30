const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");

const htmlContent = fs.readFileSync(htmlPath, "utf8");
const cssContent = fs.readFileSync(cssPath, "utf8");
const jsContent = fs.readFileSync(jsPath, "utf8");

function createMockElement(tagName, id = "", className = "") {
  const el = {
    tagName: tagName.toUpperCase(),
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    checked: false,
    className,
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
      _classes: new Set(className ? className.split(" ").filter(Boolean) : []),
      add(...classes) {
        classes.forEach(c => el.classList._classes.add(c));
        el.className = Array.from(el.classList._classes).join(" ");
      },
      remove(...classes) {
        classes.forEach(c => el.classList._classes.delete(c));
        el.className = Array.from(el.classList._classes).join(" ");
      },
      contains(c) { return el.classList._classes.has(c); },
      toggle(c, force) {
        const has = el.classList._classes.has(c);
        const shouldHave = typeof force === "boolean" ? force : !has;
        if (shouldHave) {
          el.classList.add(c);
        } else {
          el.classList.remove(c);
        }
        return shouldHave;
      },
    },
    replaceChildren(...nodes) { this.children = nodes; },
    appendChild(node) { this.children.push(node); return node; },
    append(...nodes) { this.children.push(...nodes); },
    querySelector(selector) {
      if (selector.startsWith("#")) {
        const targetId = selector.slice(1);
        if (this.id === targetId) return this;
        for (const child of this.children) {
          const found = child.querySelector ? child.querySelector(selector) : null;
          if (found) return found;
        }
      }
      if (selector.startsWith(".")) {
        const cls = selector.slice(1);
        if (this.classList.contains(cls)) return this;
        for (const child of this.children) {
          const found = child.querySelector ? child.querySelector(selector) : null;
          if (found) return found;
        }
      }
      return null;
    },
    querySelectorAll(selector) {
      const results = [];
      if (selector.startsWith(".")) {
        const cls = selector.slice(1);
        if (this.classList.contains(cls)) results.push(this);
        for (const child of this.children) {
          if (child.querySelectorAll) results.push(...child.querySelectorAll(selector));
        }
      }
      return results;
    },
    focus() {},
    contains(other) {
      if (this === other) return true;
      for (const child of this.children) {
        if (child.contains && child.contains(other)) return true;
      }
      return false;
    }
  };
  return el;
}

function setupVM() {
  const elementsMap = {};
  function getOrCreate(sel) {
    if (!elementsMap[sel]) {
      const id = sel.startsWith("#") ? sel.slice(1) : "";
      const cls = sel.startsWith(".") ? sel.slice(1) : "";
      elementsMap[sel] = createMockElement("div", id, cls);
    }
    return elementsMap[sel];
  }

  // Pre-seed known elements
  const mockPreview = getOrCreate("#card-preview-section");
  const mockOptional = getOrCreate("#card-optional-section");
  const mockSettings = getOrCreate("#card-settings-section");
  const mockDict = getOrCreate("#dictionary-section");
  const mockMeanings = getOrCreate("#meanings");
  const mockBtnCollapse = getOrCreate("#btn-dict-collapse");
  const mockDictBody = getOrCreate("#dict-body");
  const mockSummary = getOrCreate("#dict-collapsed-summary");
  const mockPopover = getOrCreate("#layout-settings-popover");
  mockPopover.hidden = true;
  mockPopover.style.display = "none";
  elementsMap["#card-settings-popover"] = mockPopover;

  const mockBtnGear = getOrCreate("#btn-layout-settings");
  const mockTabBtnText = getOrCreate("#tab-btn-text");
  const mockTextView = getOrCreate("#text-mining-view");
  const mockEditor = getOrCreate("#card-editor-section");
  const mockHistory = getOrCreate("#history-section");
  mockHistory.hidden = true;
  mockHistory.style.display = "none";
  getOrCreate("#layout-sections-list");
  getOrCreate("#btn-reset-layout");

  getOrCreate("#setting-dict-kanji");
  getOrCreate("#setting-dict-strokes");
  getOrCreate("#setting-dict-examples");
  getOrCreate("#setting-dict-other-dicts");
  getOrCreate("#setting-dict-xrefs");
  getOrCreate("#setting-dict-sense-tags");
  getOrCreate("#btn-preset-minimal");
  getOrCreate("#btn-preset-standard");
  getOrCreate("#btn-preset-full");

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
        set: async (items) => {
          Object.assign(mockStorage, items);
        }
      }
    },
    runtime: {
      sendMessage: async () => ({}),
      onMessage: { addListener() {} }
    }
  };

  const sandbox = {
    document: {
      querySelector: (sel) => {
        if (sel === "#card-settings-popover") return mockPopover;
        return elementsMap[sel] || getOrCreate(sel);
      },
      querySelectorAll: (sel) => {
        const found = [];
        Object.values(elementsMap).forEach(el => {
          if (sel.startsWith(".") && el.classList.contains(sel.slice(1))) found.push(el);
          if (sel.startsWith("#") && el.id === sel.slice(1)) found.push(el);
        });
        return found;
      },
      getElementById: (id) => {
        if (id === "card-settings-popover") return mockPopover;
        return elementsMap[`#${id}`] || getOrCreate(`#${id}`);
      },
      createElement: (tag) => createMockElement(tag),
      createTextNode: (txt) => ({ textContent: txt }),
      addEventListener() {},
      removeEventListener() {}
    },
    window: {
      addEventListener() {},
      location: { href: "" }
    },
    chrome: mockChrome,
    localStorage: {
      _store: mockStorage,
      getItem: (k) => mockStorage[k] || null,
      setItem: (k, v) => { mockStorage[k] = String(v); },
      removeItem: (k) => { delete mockStorage[k]; }
    },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    Event: function(type) { this.type = type; },
    CustomEvent: function(type, detail) { this.type = type; this.detail = detail; },
    module: { exports: {} },
    Set,
    Array,
    Object,
    JSON
  };

  vm.createContext(sandbox);
  vm.runInContext(jsContent, sandbox);

  return {
    exports: sandbox.module.exports,
    elements: elementsMap,
    storage: mockStorage
  };
}

test("Session 6: Section Visibility, Collapse Prefs & Collapsible Dictionary", async (t) => {
  await t.test("1. HTML markup validation", () => {
    assert.ok(htmlContent.includes('id="btn-dict-collapse"'), "#btn-dict-collapse must exist in sidepanel.html");
    assert.ok(htmlContent.includes('id="dict-body"'), "#dict-body wrapper must exist in sidepanel.html");
    assert.ok(htmlContent.includes('id="dict-collapsed-summary"'), "#dict-collapsed-summary must exist in sidepanel.html");
    assert.ok(htmlContent.includes('id="btn-preset-minimal"'), "#btn-preset-minimal must exist in sidepanel.html");
    assert.ok(htmlContent.includes('id="btn-preset-standard"'), "#btn-preset-standard must exist in sidepanel.html");
    assert.ok(htmlContent.includes('id="btn-preset-full"'), "#btn-preset-full must exist in sidepanel.html");
    assert.ok(htmlContent.includes('id="setting-dict-kanji"'), "#setting-dict-kanji checkbox must exist in sidepanel.html");
    assert.ok(htmlContent.includes('id="setting-dict-strokes"'), "#setting-dict-strokes checkbox must exist in sidepanel.html");
    assert.ok(htmlContent.includes('id="setting-dict-examples"'), "#setting-dict-examples checkbox must exist in sidepanel.html");
    assert.ok(htmlContent.includes('id="setting-dict-other-dicts"'), "#setting-dict-other-dicts checkbox must exist in sidepanel.html");
    assert.ok(htmlContent.includes('id="setting-dict-xrefs"'), "#setting-dict-xrefs checkbox must exist in sidepanel.html");
    assert.ok(htmlContent.includes('id="setting-dict-sense-tags"'), "#setting-dict-sense-tags checkbox must exist in sidepanel.html");
    assert.ok(htmlContent.includes('role="tabpanel" aria-labelledby="btn-layout-settings"'), "Settings container must be configured with role=tabpanel");
  });

  await t.test("2. CSS classes and token rules validation", () => {
    assert.ok(cssContent.includes(".is-user-hidden"), "CSS must contain .is-user-hidden rule");
    assert.ok(cssContent.includes(".dict-section-wrap.is-collapsed #dict-body"), "CSS must hide dict-body when collapsed");
    assert.ok(cssContent.includes("#meanings.hide-kanji"), "CSS must contain #meanings.hide-kanji rule");
    assert.ok(cssContent.includes("#meanings.hide-strokes"), "CSS must contain #meanings.hide-strokes rule");
    assert.ok(cssContent.includes("#meanings.hide-examples"), "CSS must contain #meanings.hide-examples rule");
    assert.ok(cssContent.includes("#meanings.hide-other-dicts"), "CSS must contain #meanings.hide-other-dicts rule");
    assert.ok(cssContent.includes("#meanings.hide-xrefs"), "CSS must contain #meanings.hide-xrefs rule");
    assert.ok(cssContent.includes("#meanings.hide-sense-tags"), "CSS must contain #meanings.hide-sense-tags rule");
    assert.ok(cssContent.includes(".settings-tab-view"), "CSS must contain .settings-tab-view styles for tab presentation");
  });

  await t.test("3. Pure helper functions: defaultSectionPrefs & normalizeSectionPrefs", () => {
    const { exports } = setupVM();
    const defaults = exports.defaultSectionPrefs();
    assert.equal(defaults.sections.preview.visible, true);
    assert.equal(defaults.sections.preview.collapsed, false);
    assert.equal(defaults.sections.optional.visible, true);
    assert.equal(defaults.sections.optional.collapsed, false);
    assert.equal(defaults.sections.settings.visible, true);
    assert.equal(defaults.sections.settings.collapsed, false);
    assert.equal(defaults.sections.dictionary.visible, true);
    assert.equal(defaults.sections.dictionary.collapsed, false);
    assert.equal(defaults.dictContents.kanji, true);
    assert.equal(defaults.dictContents.strokes, true);
    assert.equal(defaults.dictContents.examples, true);
    assert.equal(defaults.dictContents.otherDicts, true);
    assert.equal(defaults.dictContents.xrefs, true);
    assert.equal(defaults.dictContents.senseTags, true);

    // Normalization with null / undefined / corrupted inputs
    assert.deepEqual(JSON.parse(JSON.stringify(exports.normalizeSectionPrefs(null))), JSON.parse(JSON.stringify(defaults)));
    assert.deepEqual(JSON.parse(JSON.stringify(exports.normalizeSectionPrefs(undefined))), JSON.parse(JSON.stringify(defaults)));
    assert.deepEqual(JSON.parse(JSON.stringify(exports.normalizeSectionPrefs("invalid string"))), JSON.parse(JSON.stringify(defaults)));
    assert.deepEqual(JSON.parse(JSON.stringify(exports.normalizeSectionPrefs({}))), JSON.parse(JSON.stringify(defaults)));

    // Partial input normalization
    const custom = {
      sections: {
        preview: { visible: false, collapsed: true },
        dictionary: { visible: true, collapsed: true }
      },
      dictContents: {
        kanji: false,
        strokes: false
      }
    };
    const normalized = exports.normalizeSectionPrefs(custom);
    assert.equal(normalized.sections.preview.visible, false);
    assert.equal(normalized.sections.preview.collapsed, true);
    assert.equal(normalized.sections.optional.visible, true);
    assert.equal(normalized.sections.dictionary.collapsed, true);
    assert.equal(normalized.dictContents.kanji, false);
    assert.equal(normalized.dictContents.strokes, false);
    assert.equal(normalized.dictContents.examples, true);
  });

  await t.test("4. Storage roundtrip for section prefs", async () => {
    const { exports, storage } = setupVM();

    const target = {
      sections: {
        preview: { visible: false, collapsed: false },
        optional: { visible: true, collapsed: true },
        settings: { visible: true, collapsed: false },
        dictionary: { visible: true, collapsed: true }
      },
      dictContents: {
        kanji: false,
        strokes: false,
        examples: true,
        otherDicts: false,
        xrefs: true,
        senseTags: false
      }
    };

    await exports.saveStoredSectionPrefs(target);
    assert.ok(storage[exports.STORAGE_KEY_CARD_SECTION_PREFS], "Storage must have saved prefs");
    const loaded = await exports.loadStoredSectionPrefs();
    assert.deepEqual(JSON.parse(JSON.stringify(loaded)), JSON.parse(JSON.stringify(exports.normalizeSectionPrefs(target))));
  });

  await t.test("5. DOM application of section preferences", () => {
    const { exports, elements } = setupVM();
    const mockPreview = elements["#card-preview-section"];
    const mockDict = elements["#dictionary-section"];
    const mockMeanings = elements["#meanings"];
    const mockBtnCollapse = elements["#btn-dict-collapse"];
    const mockDictBody = elements["#dict-body"];
    const mockSummary = elements["#dict-collapsed-summary"];
    mockSummary.textContent = "• to eat";

    // Apply prefs with preview hidden, dictionary collapsed, and kanji/strokes disabled
    exports.applySectionPrefs({
      sections: {
        preview: { visible: false, collapsed: false },
        optional: { visible: true, collapsed: false },
        settings: { visible: true, collapsed: false },
        dictionary: { visible: true, collapsed: true }
      },
      dictContents: {
        kanji: false,
        strokes: false,
        examples: true,
        otherDicts: true,
        xrefs: true,
        senseTags: true
      }
    });

    assert.ok(mockPreview.classList.contains("is-user-hidden"), "Preview section must have .is-user-hidden");
    assert.equal(mockPreview.getAttribute("aria-hidden"), "true", "Preview must have aria-hidden=true");
    assert.ok(mockDict.classList.contains("is-collapsed"), "Dictionary section must have .is-collapsed");
    assert.equal(mockBtnCollapse.getAttribute("aria-expanded"), "false", "Dict collapse button must have aria-expanded=false");
    assert.equal(mockDictBody.hidden, true, "Dict body must be hidden when collapsed");
    assert.equal(mockSummary.hidden, false, "Dict summary must be visible when collapsed with text");

    assert.ok(mockMeanings.classList.contains("hide-kanji"), "Meanings must have .hide-kanji");
    assert.ok(mockMeanings.classList.contains("hide-strokes"), "Meanings must have .hide-strokes");
    assert.equal(mockMeanings.classList.contains("hide-examples"), false, "Meanings must not have .hide-examples");

    // Re-apply with all visible and expanded
    exports.applySectionPrefs(exports.defaultSectionPrefs());
    assert.equal(mockPreview.classList.contains("is-user-hidden"), false, "Preview must not have .is-user-hidden");
    assert.equal(mockPreview.getAttribute("aria-hidden"), null, "Preview aria-hidden must be removed");
    assert.equal(mockDict.classList.contains("is-collapsed"), false, "Dictionary must not have .is-collapsed");
    assert.equal(mockBtnCollapse.getAttribute("aria-expanded"), "true", "Dict collapse button must have aria-expanded=true");
    assert.equal(mockDictBody.hidden, false, "Dict body must be unhidden");
    assert.equal(mockSummary.hidden, true, "Dict summary must be hidden when expanded");
  });

  await t.test("6. Presets functionality", () => {
    const { exports } = setupVM();

    // Minimal preset
    exports.applyPreset("minimal");
    let current = exports.getCurrentSectionPrefs();
    assert.equal(current.sections.preview.visible, false);
    assert.equal(current.dictContents.kanji, false);
    assert.equal(current.dictContents.strokes, false);
    assert.equal(current.dictContents.examples, false);

    // Full preset
    exports.applyPreset("full");
    current = exports.getCurrentSectionPrefs();
    assert.equal(current.sections.preview.visible, true);
    assert.equal(current.dictContents.kanji, true);
    assert.equal(current.dictContents.strokes, true);
    assert.equal(current.dictContents.examples, true);

    // Standard preset
    exports.applyPreset("standard");
    current = exports.getCurrentSectionPrefs();
    assert.equal(current.sections.preview.visible, true);
    assert.equal(current.dictContents.kanji, true);
  });

  await t.test("7. Settings view tab navigation", () => {
    const { exports, elements } = setupVM();
    const mockPopover = elements["#layout-settings-popover"];
    const mockBtnGear = elements["#btn-layout-settings"];
    const mockTextView = elements["#text-mining-view"];
    const mockEditor = elements["#card-editor-section"];

    // Switch to settings
    exports.switchMiningTab("settings");
    assert.equal(mockPopover.hidden, false, "Settings popover must be unhidden on settings tab");
    assert.equal(mockBtnGear.classList.contains("active"), true, "Gear button must have active class");
    assert.equal(mockEditor.hidden, true, "Card editor must be hidden in settings view");
    assert.equal(mockTextView.hidden, true, "Text view must be hidden in settings view");

    // Close settings returns to previous tab (text)
    exports.closeLayoutSettings();
    assert.equal(mockPopover.hidden, true, "Settings must be hidden when closed");
    assert.equal(mockBtnGear.classList.contains("active"), false, "Gear button active class must be removed");
    assert.equal(mockTextView.hidden, false, "Text view must be unhidden when returning to text tab");
    assert.equal(mockEditor.hidden, false, "Card editor must be unhidden in text view");
  });

  await t.test("8. Strict emoji elimination across Session 6 files", () => {
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
    const testFileContent = fs.readFileSync(__filename, "utf8");

    const htmlMatches = (htmlContent.match(emojiRegex) || []);
    const cssMatches = (cssContent.match(emojiRegex) || []);
    const testMatches = (testFileContent.match(emojiRegex) || []);

    assert.equal(htmlMatches.length, 0, `HTML must not contain emojis. Found: ${htmlMatches.join(",")}`);
    assert.equal(cssMatches.length, 0, `CSS must not contain emojis. Found: ${cssMatches.join(",")}`);
    assert.equal(testMatches.length, 0, `Test suite must not contain emojis. Found: ${testMatches.join(",")}`);
  });
});
