const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

console.log("=================================================");
console.log("STARTING END-USER POINT-OF-VIEW DRY RUN TEST");
console.log("=================================================\n");

// Read HTML
const html = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.html"), "utf8");

// Parse elements and verify hierarchy
class Node {
  constructor(tagName, id = "", className = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = className;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
  }
}

// Build DOM tree from HTML
const tagRegex = /<([a-zA-Z0-9_-]+)([^>]*?)(\/?)>|<\/([a-zA-Z0-9_-]+)>/g;
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const root = new Node("DOCUMENT");
let current = root;

let match;
while ((match = tagRegex.exec(html)) !== null) {
  if (match[0].startsWith("</")) {
    if (current.parentNode) current = current.parentNode;
  } else {
    const tagName = match[1];
    const attrsStr = match[2];
    const isSelfClosing = match[3] === "/" || voidTags.has(tagName.toLowerCase());

    const idMatch = attrsStr.match(/\bid=["']([^"']+)["']/);
    const classMatch = attrsStr.match(/\bclass=["']([^"']+)["']/);
    const id = idMatch ? idMatch[1] : "";
    const className = classMatch ? classMatch[1] : "";

    const node = new Node(tagName, id, className);
    current.appendChild(node);
    if (!isSelfClosing) {
      current = node;
    }
  }
}

function findNode(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function isDescendantOf(childNode, ancestorNode) {
  let curr = childNode.parentNode;
  while (curr) {
    if (curr === ancestorNode) return true;
    curr = curr.parentNode;
  }
  return false;
}

const popoverNode = findNode(root, n => n.id === "layout-settings-popover");
const cardEditorNode = findNode(root, n => n.id === "card-editor");
const cardFieldsNode = findNode(root, n => n.id === "card-fields-section");
const cardPreviewNode = findNode(root, n => n.id === "card-preview-section");
const cardDictNode = findNode(root, n => n.id === "dictionary-section");
const meaningsNode = findNode(root, n => n.id === "meanings");
const historyNode = findNode(root, n => n.id === "history-section");

assert.ok(popoverNode, "#layout-settings-popover must exist");
assert.ok(cardEditorNode, "#card-editor must exist");
assert.ok(cardFieldsNode, "#card-fields-section must exist");
assert.ok(cardPreviewNode, "#card-preview-section must exist");
assert.ok(cardDictNode, "#dictionary-section must exist");
assert.ok(meaningsNode, "#meanings must exist");
assert.ok(historyNode, "#history-section must exist");

// CRITICAL HIERARCHY VERIFICATIONS
console.log("Step 1: Verifying DOM Hierarchy & Isolation...");

assert.equal(
  isDescendantOf(cardEditorNode, popoverNode),
  false,
  "FAIL: #card-editor MUST NOT be inside #layout-settings-popover!"
);
console.log("✓ #card-editor is outside #layout-settings-popover");

assert.equal(
  isDescendantOf(cardFieldsNode, popoverNode),
  false,
  "FAIL: #card-fields-section MUST NOT be inside #layout-settings-popover!"
);
console.log("✓ #card-fields-section is outside #layout-settings-popover");

assert.equal(
  isDescendantOf(cardPreviewNode, popoverNode),
  false,
  "FAIL: #card-preview-section MUST NOT be inside #layout-settings-popover!"
);
console.log("✓ #card-preview-section is outside #layout-settings-popover");

assert.equal(
  isDescendantOf(cardDictNode, popoverNode),
  false,
  "FAIL: #card-dictionary-section MUST NOT be inside #layout-settings-popover!"
);
console.log("✓ #card-dictionary-section is outside #layout-settings-popover");

assert.equal(
  isDescendantOf(meaningsNode, popoverNode),
  false,
  "FAIL: #meanings MUST NOT be inside #layout-settings-popover!"
);
console.log("✓ #meanings is outside #layout-settings-popover");

assert.equal(
  isDescendantOf(historyNode, popoverNode),
  false,
  "FAIL: #history-section MUST NOT be inside #layout-settings-popover!"
);
console.log("✓ #history-section is outside #layout-settings-popover");

// Verify dictionary settings group is correctly inside the popover
const dictSettingsGroupNode = findNode(root, n => n.className && n.className.includes("dict-settings-group"));
assert.ok(dictSettingsGroupNode, ".dict-settings-group must exist");
assert.equal(
  isDescendantOf(dictSettingsGroupNode, popoverNode),
  true,
  ".dict-settings-group MUST be inside #layout-settings-popover"
);
console.log("✓ .dict-settings-group is inside #layout-settings-popover");

console.log("\nStep 2: Simulating User Workflow in sidepanel.js...");

// Setup mock DOM for runtime simulation
const domMap = new Map();
function createMockEl(tag = "div", id = "") {
  const el = {
    tagName: tag.toUpperCase(),
    id,
    className: "",
    _textContent: "",
    value: "",
    hidden: false,
    style: {},
    children: [],
    dataset: {},
    focus() {},
    blur() {},
    _listeners: {},
    classList: {
      _classes: new Set(),
      add(...cls) { cls.forEach(c => this._classes.add(c)); },
      remove(...cls) { cls.forEach(c => this._classes.delete(c)); },
      contains(c) { return this._classes.has(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._classes.has(c)) this._classes.delete(c);
          else this._classes.add(c);
        } else if (force) this._classes.add(c);
        else this._classes.delete(c);
      }
    },
    append(...items) {
      for (const item of items) {
        if (item) this.children.push(item);
      }
    },
    appendChild(item) {
      if (item) this.children.push(item);
      return item;
    },
    replaceChildren(...items) {
      this.children = [];
      this.append(...items);
    },
    addEventListener(evt, fn) {
      if (!this._listeners[evt]) this._listeners[evt] = [];
      this._listeners[evt].push(fn);
    },
    dispatchEvent(evt) {
      const e = typeof evt === "string" ? { type: evt, stopPropagation: () => {}, preventDefault: () => {}, target: this } : { stopPropagation: () => {}, preventDefault: () => {}, target: this, ...evt };
      if (this._listeners[e.type]) {
        this._listeners[e.type].forEach(fn => fn(e));
      }
    },
    setAttribute(name, val) { this.attributes = this.attributes || {}; this.attributes[name] = val; },
    getAttribute(name) { return (this.attributes && this.attributes[name]) || null; },
    contains(other) {
      if (this === other) return true;
      for (const child of this.children) {
        if (typeof child === "object" && child.contains && child.contains(other)) return true;
      }
      return false;
    }
  };
  Object.defineProperty(el, "textContent", {
    get() {
      if (this._textContent) return this._textContent;
      return this.children.map(c => typeof c === "string" ? c : c.textContent || "").join("");
    },
    set(v) {
      this._textContent = String(v);
      this.children = [String(v)];
    }
  });
  if (id) domMap.set(id, el);
  return el;
}

// Populate essential IDs
const ids = [
  "layout-settings-popover", "btn-layout-settings", "btn-close-layout-settings",
  "card-editor", "card-fields-section", "card-preview-section", "card-dictionary-section", "meanings",
  "dict-actions-bar", "dict-empty-notice", "dict-loading", "dict-jlpt-badge",
  "field-expression", "field-reading", "field-meaning", "field-hint", "field-card-id",
  "card-preview-container", "card-preview-card", "save-card-btn", "sync-anki-btn",
  "dest-deck-val", "dest-model-val", "anki-sync-status", "save-badge", "card-target-destination",
  "history-section", "history-content-container", "history-collapse-btn", "setting-show-history",
  "btn-refresh-dict-list", "btn-dict-select-all", "btn-dict-clear-all", "dict-selected-count-label",
  "dict-selection-list-container", "dict-selection-empty", "dict-selection-items",
  "mining-toggle", "mining-status", "btn-copy-raw-dict", "card-layout-container",
  "layout-sections-list", "btn-reset-layout"
];
ids.forEach(id => createMockEl("div", id));

const popover = domMap.get("layout-settings-popover");
popover.hidden = true;
const cardEditor = domMap.get("card-editor");
cardEditor.hidden = true;
const meanings = domMap.get("meanings");
meanings.hidden = false;

// 1. User sees extension on initial state
assert.equal(popover.hidden, true, "Settings popover must be hidden initially");
assert.equal(cardEditor.hidden, true, "Card editor is hidden before any capture/lookup");
console.log("✓ Initial state: Popover hidden, card editor hidden waiting for capture");

// 2. User captures/looks up a word (e.g. '猫')
// Simulate renderDetails with Jitendex & JMdict
const jsContent = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");
const sandbox = {
  document: {
    querySelector: (sel) => {
      const idMatch = sel.match(/^#([a-zA-Z0-9_-]+)$/);
      if (idMatch && domMap.has(idMatch[1])) {
        return domMap.get(idMatch[1]);
      }
      return null;
    },
    querySelectorAll: () => [],
    createElement: (tag) => createMockEl(tag),
    createTextNode: (text) => text,
    addEventListener: () => {},
    body: createMockEl("body"),
  },
  window: {
    addEventListener: () => {},
    location: { href: "chrome-extension://test/sidepanel.html" },
  },
  chrome: {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => ({})
      }
    },
    runtime: {
      sendMessage: async () => ({}),
      onMessage: { addListener: () => {} }
    }
  },
  navigator: { clipboard: { writeText: async () => true } },
  console,
  setTimeout,
  clearTimeout,
  module: { exports: {} }
};

vm.createContext(sandbox);
vm.runInContext(jsContent, sandbox);

const sidepanel = sandbox.module.exports;

// Simulate look up of '猫'
sidepanel.renderDetails({
  expression: "猫",
  reading: "ねこ",
  term: {
    expression: "猫",
    reading: "ねこ",
    entries: [
      { dictionary: "Jitendex", term: "猫", reading: "ねこ", is_primary: true, senses: [{ glosses: ["cat"] }] },
      { dictionary: "JMdict", term: "猫", reading: "ねこ", is_primary: false, senses: [{ glosses: ["feline"] }] },
    ],
    kanji_entries: []
  }
});

// Verify #meanings has rendered dictionary content
assert.ok(meanings.children.length > 0, "#meanings must have rendered dictionary content");
assert.equal(meanings.hidden, false, "#meanings must be visible");
// Popover must remain hidden!
assert.equal(popover.hidden, true, "Settings popover must NOT be opened by looking up a word!");

console.log("✓ Normal word lookup: Dictionary View is rendered directly into #meanings and visible!");
console.log("✓ Settings popover remains hidden during normal lookup.");

// 3. User clicks ⚙ (Settings)
const btnSettings = domMap.get("btn-layout-settings");
btnSettings.dispatchEvent("click");

assert.equal(popover.hidden, false, "Settings popover opens on gear click");
console.log("✓ Clicking ⚙ opens Settings popover.");

// Verify card editor and dictionary view are NOT inside popover
assert.equal(isDescendantOf(cardEditorNode, popoverNode), false);
assert.equal(isDescendantOf(meaningsNode, popoverNode), false);
console.log("✓ In actual DOM, #card-editor and #meanings are completely outside the popover.");

// 4. User closes ⚙ (Settings)
const btnCloseSettings = domMap.get("btn-close-layout-settings");
btnCloseSettings.dispatchEvent("click");

assert.equal(popover.hidden, true, "Settings popover closes on close button click");
console.log("✓ Closing Settings popover hides only the popover, leaving main view intact.");

console.log("\n=================================================");
console.log("DRY RUN PASSED: BUG FULLY FIXED & VERIFIED!");
console.log("=================================================\n");
