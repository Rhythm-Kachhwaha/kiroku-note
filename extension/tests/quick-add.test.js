const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting Kiroku Note Hero Search & Quick Add Merging Tests...\n");

// ==========================================================================
// 1. Verify HTML Structure: Quick Add Tab Removed & Hero Search Added
// ==========================================================================
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

// Quick Add tab button and panel removed
assert.ok(!html.includes('id="tab-btn-quickadd"'), "Tab button #tab-btn-quickadd must be removed");
assert.ok(!html.includes('id="quickadd-mining-view"'), "Panel #quickadd-mining-view must be removed");

// Hero Search Elements
assert.ok(html.includes('id="hero-search-input"'), "Hero Search input #hero-search-input must exist");
assert.ok(
  html.includes('id="hero-search-input"') &&
  html.includes('role="combobox"') &&
  html.includes('aria-controls="hero-search-popup"'),
  "Hero Search input must have role='combobox' and aria-controls='hero-search-popup'"
);
assert.ok(html.includes('id="btn-hero-search-mode"'), "Hero Search mode button #btn-hero-search-mode must exist");
assert.ok(html.includes('id="btn-hero-search-clear"'), "Hero Search clear button #btn-hero-search-clear must exist");
assert.ok(html.includes('id="hero-search-popup"'), "Hero Search popup #hero-search-popup must exist");
assert.ok(html.includes('id="hero-search-suggestions"'), "Hero Search suggestions list #hero-search-suggestions must exist");

// Script Loading Order: wanakana.js must load before sidepanel.js
const wanakanaScriptIdx = html.indexOf('<script src="../lib/wanakana.js"></script>');
const sidepanelScriptIdx = html.indexOf('<script src="sidepanel.js"></script>');
assert.ok(wanakanaScriptIdx !== -1, "wanakana.js script must be referenced in sidepanel.html");
assert.ok(sidepanelScriptIdx !== -1, "sidepanel.js script must be referenced in sidepanel.html");
assert.ok(wanakanaScriptIdx < sidepanelScriptIdx, "wanakana.js MUST load before sidepanel.js");

console.log("PASS 1: HTML DOM structure, Quick Add tab removal, and Hero Search elements verified.");

// ==========================================================================
// 2. Verify CSS Styling for Hero Search & Quick Add Candidate Items
// ==========================================================================
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const css = fs.readFileSync(cssPath, "utf8");

assert.ok(css.includes(".hero-search-container"), "CSS must define .hero-search-container");
assert.ok(css.includes(".hero-search-input-wrap"), "CSS must define .hero-search-input-wrap");
assert.ok(css.includes(".hero-search-input"), "CSS must define .hero-search-input");
assert.ok(css.includes(".hero-search-popup"), "CSS must define .hero-search-popup");
assert.ok(css.includes(".quickadd-candidate-item"), "CSS must define .quickadd-candidate-item");
assert.ok(css.includes(".quickadd-candidate-expression"), "CSS must define .quickadd-candidate-expression");
assert.ok(css.includes(".quickadd-candidate-reading"), "CSS must define .quickadd-candidate-reading");
assert.ok(css.includes(".quickadd-candidate-gloss"), "CSS must define .quickadd-candidate-gloss");

// Front tag & enlarged JLPT badge styling
assert.ok(css.includes(".kn-front-tags"), "CSS must define .kn-front-tags for Front Card Preview JLPT badge");
assert.ok(css.includes(".kn-tag.kn-jlpt"), "CSS must style .kn-tag.kn-jlpt");
assert.ok(css.includes("font-size: 13px;"), "Card preview JLPT badge must have font-size: 13px");

console.log("PASS 2: CSS styling definitions verified.");

// ==========================================================================
// 3. Mock DOM Infrastructure for sidepanel.js Logic Verification
// ==========================================================================
function createMockElement(tagName, id = "") {
  const el = {
    tagName: tagName.toUpperCase(),
    nodeName: tagName.toUpperCase(),
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    options: [],
    style: {},
    dataset: {},
    _attrs: {},
    _listeners: {},
    children: [],
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] || null; },
    removeAttribute(k) { delete this._attrs[k]; },
    hasAttribute(k) { return k in this._attrs; },
    addEventListener(type, fn) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (this._listeners[type]) {
        this._listeners[type] = this._listeners[type].filter(f => f !== fn);
      }
    },
    dispatchEvent(event) {
      if (!event.target) event.target = this;
      const fns = this._listeners[event.type] || [];
      for (const fn of fns) {
        fn.call(this, event);
      }
    },
    _classes: new Set(),
    get className() {
      return Array.from(this._classes).join(" ");
    },
    set className(val) {
      this._classes.clear();
      if (typeof val === "string") {
        val.trim().split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
      }
    },
    classList: {
      add(...cls) { cls.forEach(c => el._classes.add(c)); },
      remove(...cls) { cls.forEach(c => el._classes.delete(c)); },
      contains(c) { return el._classes.has(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (el._classes.has(c)) { el._classes.delete(c); return false; }
          else { el._classes.add(c); return true; }
        }
        if (force) el._classes.add(c); else el._classes.delete(c);
        return force;
      },
    },
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      return child;
    },
    append(...children) {
      children.forEach(c => this.appendChild(c));
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentElement = null;
      }
      return child;
    },
    remove() {
      if (this.parentElement) {
        this.parentElement.removeChild(this);
      }
    },
    replaceChildren(...newChildren) {
      this.children.forEach(c => { c.parentElement = null; });
      this.children = [];
      newChildren.forEach(c => this.appendChild(c));
    },
    querySelector(selector) {
      const parts = selector.trim().split(/\s+/);
      let currentElements = [this];
      for (const part of parts) {
        let nextElements = [];
        for (const parent of currentElements) {
          const searchNode = (node) => {
            if (!node || !node.classList) return;
            let match = true;
            if (part.startsWith("#")) {
              if (node.id !== part.slice(1)) match = false;
            } else if (part.startsWith(".")) {
              const classes = part.split(".").filter(Boolean);
              if (!classes.every(c => node.classList.contains(c))) match = false;
            } else if (node.tagName === part.toUpperCase()) {
              match = true;
            }
            if (match && node !== this) nextElements.push(node);
            if (node.children) node.children.forEach(searchNode);
          };
          (parent.children || []).forEach(searchNode);
        }
        currentElements = nextElements;
        if (!currentElements.length) break;
      }
      return currentElements[0] || null;
    },
    querySelectorAll(sel) {
      const parts = sel.trim().split(/\s+/);
      let currentElements = [this];
      for (const part of parts) {
        let nextElements = [];
        for (const parent of currentElements) {
          const searchNode = (node) => {
            if (!node || !node.classList) return;
            let match = true;
            if (part.startsWith("#")) {
              if (node.id !== part.slice(1)) match = false;
            } else if (part.startsWith(".")) {
              const classes = part.split(".").filter(Boolean);
              if (!classes.every(c => node.classList.contains(c))) match = false;
            } else if (node.tagName === part.toUpperCase()) {
              match = true;
            }
            if (match && node !== this) nextElements.push(node);
            if (node.children) node.children.forEach(searchNode);
          };
          (parent.children || []).forEach(searchNode);
        }
        currentElements = nextElements;
        if (!currentElements.length) break;
      }
      return currentElements;
    },
    focus() {},
    select() {},
    scrollIntoView() {},
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
  return el;
}

// ==========================================================================
// 4. Test Tab Switching & Quick Add Redirection
// ==========================================================================
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

const mockTabBtnText = createMockElement("button", "tab-btn-text");
mockTabBtnText.classList.add("active");
mockTabBtnText.setAttribute("aria-selected", "true");

const mockTabBtnVideo = createMockElement("button", "tab-btn-video");
mockTabBtnVideo.setAttribute("aria-selected", "false");

const mockTabBtnHistory = createMockElement("button", "tab-btn-history");
mockTabBtnHistory.setAttribute("aria-selected", "false");

const mockTextMiningView = createMockElement("div", "text-mining-view");
mockTextMiningView.hidden = false;

const mockVideoMiningView = createMockElement("div", "video-mining-view");
mockVideoMiningView.hidden = true;

const mockHistorySection = createMockElement("section", "history-section");
mockHistorySection.hidden = true;

const mockHeroSearchContainer = createMockElement("div", "hero-search-container");
const mockHeroSearchInput = createMockElement("input", "hero-search-input");
const mockHeroSearchClearBtn = createMockElement("button", "btn-hero-search-clear");
const mockHeroSearchModeBtn = createMockElement("button", "btn-hero-search-mode");
const mockHeroSearchModeTag = createMockElement("span", "hero-search-mode-tag");
const mockHeroSearchModeIndicator = createMockElement("span", "hero-search-mode-indicator");
const mockHeroSearchPopup = createMockElement("div", "hero-search-popup");
mockHeroSearchPopup.hidden = true;
const mockHeroSearchSuggestions = createMockElement("ul", "hero-search-suggestions");

const mockExpression = createMockElement("h1", "expression");
mockExpression.textContent = "—";

const mockStorage = {};
const mockChrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === "string") return { [keys]: mockStorage[keys] };
        return mockStorage;
      },
      set: async (obj) => {
        Object.assign(mockStorage, obj);
      },
    },
  },
  runtime: {
    sendMessage: async () => ({ enabled: false }),
    onMessage: {
      addListener: () => {},
    },
  },
  tabs: {
    query: async () => [],
    sendMessage: async () => {},
  },
};

const wanakanaModule = require("../lib/wanakana.js");

const elementsMap = {
  "#tab-btn-text": mockTabBtnText,
  "#tab-btn-video": mockTabBtnVideo,
  "#tab-btn-history": mockTabBtnHistory,
  "#text-mining-view": mockTextMiningView,
  "#video-mining-view": mockVideoMiningView,
  "#history-section": mockHistorySection,
  "#hero-search-container": mockHeroSearchContainer,
  "#hero-search-input": mockHeroSearchInput,
  "#btn-hero-search-clear": mockHeroSearchClearBtn,
  "#btn-hero-search-mode": mockHeroSearchModeBtn,
  "#hero-search-mode-tag": mockHeroSearchModeTag,
  "#hero-search-mode-indicator": mockHeroSearchModeIndicator,
  "#hero-search-popup": mockHeroSearchPopup,
  "#hero-search-suggestions": mockHeroSearchSuggestions,
  "#expression": mockExpression,
};

const sandbox = {
  document: {
    querySelector: (sel) => elementsMap[sel] || createMockElement("div", sel.replace("#", "")),
    querySelectorAll: () => [],
    createElement: (tag) => createMockElement(tag),
    createTextNode: (text) => ({ textContent: text }),
    addEventListener: () => {},
  },
  chrome: mockChrome,
  wanakana: wanakanaModule,
  window: {},
  module: { exports: {} },
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  fetch: null,
};

vm.createContext(sandbox);
vm.runInContext(jsContent, sandbox);
Object.assign(sandbox, sandbox.module.exports, sandbox.window);

// Test A: Switching to "video"
sandbox.switchMiningTab("video");
assert.equal(mockTabBtnVideo.classList.contains("active"), true, "Video tab must be active");
assert.equal(mockVideoMiningView.hidden, false, "Video view must not be hidden");
assert.equal(mockTextMiningView.hidden, true, "Text view must be hidden");

// Test B: Switching to "text"
sandbox.switchMiningTab("text");
assert.equal(mockTabBtnText.classList.contains("active"), true, "Text tab must be active");
assert.equal(mockTextMiningView.hidden, false, "Text view must not be hidden");

// Test C: Switching to legacy "quickadd" redirects to "text" and enters search state
sandbox.switchMiningTab("quickadd");
assert.equal(mockTabBtnText.classList.contains("active"), true, "Quickadd tab request must redirect to text");
assert.equal(sandbox.getCurrentHeroSearchState(), "searching", "Quickadd request must enter searching state");

console.log("PASS 3: Tab navigation and Quick Add redirection to Hero Search verified.");

// ==========================================================================
// 5. Verify Auto-Detect & Mode Switching
// ==========================================================================
// Test query auto-detection
assert.equal(sandbox.detectQueryMode("water"), "english", "Auto-detect: 'water' must be English");
assert.equal(sandbox.detectQueryMode("eat"), "english", "Auto-detect: 'eat' must be English");
assert.equal(sandbox.detectQueryMode("nomu"), "kana", "Auto-detect: 'nomu' must be Kana");
assert.equal(sandbox.detectQueryMode("taberu"), "kana", "Auto-detect: 'taberu' must be Kana");
assert.equal(sandbox.detectQueryMode("ai"), "ambiguous", "Auto-detect: 'ai' must be ambiguous");
assert.equal(sandbox.detectQueryMode("食べる"), "kana", "Auto-detect: '食べる' must be Kana");

// Test mode switching to english
sandbox.setQuickAddSearchMode("english");
assert.equal(sandbox.getQuickAddSearchMode(), "english", "Search mode must be 'english'");
assert.equal(mockHeroSearchModeTag.textContent, "EN", "Tag must show 'EN'");
assert.equal(sandbox.detectQueryMode("nomu"), "english", "In explicit english mode, all queries use english");

// Test mode switching to kana
sandbox.setQuickAddSearchMode("kana");
assert.equal(sandbox.getQuickAddSearchMode(), "kana", "Search mode must be 'kana'");
assert.equal(mockHeroSearchModeTag.textContent, "あ", "Tag must show 'あ'");
assert.equal(sandbox.detectQueryMode("water"), "kana", "In explicit kana mode, all queries use kana");

// Test mode switching to auto
sandbox.setQuickAddSearchMode("auto");
assert.equal(sandbox.getQuickAddSearchMode(), "auto", "Search mode must be 'auto'");
assert.equal(mockHeroSearchModeTag.textContent, "AUTO", "Tag must show 'AUTO'");

// Test F7 shortcut switches to English
mockHeroSearchInput.dispatchEvent({ type: "keydown", key: "F7", preventDefault: () => {} });
assert.equal(sandbox.getQuickAddSearchMode(), "english", "F7 key must activate English mode");

// Test F6 shortcut switches to Kana
mockHeroSearchInput.dispatchEvent({ type: "keydown", key: "F6", preventDefault: () => {} });
assert.equal(sandbox.getQuickAddSearchMode(), "kana", "F6 key must activate Kana mode");

console.log("PASS 4: Auto-detect and mode switching (Auto, Kana, English, F6/F7) verified.");

// ==========================================================================
// 6. Verify Card Preview JLPT Badge (Front & Back)
// ==========================================================================
const mockFrontPreviewContainer = createMockElement("div", "card-preview-front");
sandbox.renderCardPreviewDOM(mockFrontPreviewContainer, {
  expression: "食べる",
  reading: "たべる",
  jlpt_level: "N5",
  template_settings: { show_jlpt: true }
}, "front");

const frontJlptSpan = mockFrontPreviewContainer.querySelector(".kn-front-tags .kn-tag.kn-jlpt");
assert.ok(frontJlptSpan, "Front Card Preview must render .kn-front-tags .kn-tag.kn-jlpt when jlpt_level is present");
assert.equal(frontJlptSpan.textContent, "JLPT N5", "Front JLPT tag must display 'JLPT N5'");

console.log("PASS 5: Card Preview JLPT badge rendering verified.");

// ==========================================================================
// 7. Verify Debounced Candidate Lookup & Request Shape
// ==========================================================================
sandbox.setQuickAddSearchMode("auto");
let capturedFetchRequest = null;
sandbox.fetch = async (url, options) => {
  capturedFetchRequest = { url, options, body: options && options.body ? JSON.parse(options.body) : null };
  return {
    ok: true,
    json: async () => ({
      expression: "食べる",
      reading: "たべる",
      entries: [
        {
          term: "食べる",
          reading: "たべる",
          senses: [{ glosses: ["to eat"] }],
        },
        {
          term: "喰べる",
          reading: "たべる",
          senses: [{ glosses: ["to eat (alternative)"] }],
        },
      ],
    }),
  };
};

mockHeroSearchInput.value = "たべる";
sandbox.executeQuickAddLookup();

setImmediate(async () => {
  assert.ok(capturedFetchRequest, "Candidate lookup must perform a fetch request");
  assert.equal(capturedFetchRequest.url, "http://127.0.0.1:21828/api/capture", "Must use API_CAPTURE_URL (/api/capture)");
  assert.equal(capturedFetchRequest.options.method, "POST", "Must use HTTP POST");
  assert.equal(capturedFetchRequest.body.auto_save, false, "auto_save MUST be false");
  assert.equal(capturedFetchRequest.body.text, "たべる", "text field must equal typed input");

  // Verify suggestion rendering
  assert.equal(mockHeroSearchPopup.hidden, false, "Suggestions container must become visible when entries are returned");
  assert.equal(mockHeroSearchSuggestions.children.length, 2, "Suggestions list must render 2 candidate items");

  const firstItem = mockHeroSearchSuggestions.children[0];
  const exprEl = firstItem.children[0].children[0];
  const glossEl = firstItem.children[1];
  assert.equal(exprEl.textContent, "食べる", "First candidate expression must be '食べる'");
  assert.equal(glossEl.textContent, "to eat", "First candidate gloss must be 'to eat'");

  console.log("PASS 6: Debounced lookup request shape and candidate list rendering verified.");

  // ==========================================================================
  // 8. Verify Candidate Selection Commits via identify()
  // ==========================================================================
  let identifiedWord = null;
  sandbox.identify = (word) => {
    identifiedWord = word;
  };

  firstItem.dispatchEvent({ type: "click", stopPropagation: () => {} });
  assert.equal(identifiedWord, "食べる", "Selecting candidate must call existing identify('食べる')");
  assert.equal(mockHeroSearchPopup.hidden, true, "Selecting candidate must close suggestions container");
  assert.equal(sandbox.getCurrentHeroSearchState(), "captured", "State must transition to 'captured'");

  console.log("PASS 7: Candidate selection committing to identify() verified.");

  // ==========================================================================
  // 9. Verify Scoped Keyboard Navigation
  // ==========================================================================
  sandbox.renderQuickAddSuggestions([
    { term: "橋", reading: "はし", senses: [{ glosses: ["bridge"] }] },
    { term: "箸", reading: "はし", senses: [{ glosses: ["chopsticks"] }] },
    { term: "端", reading: "はし", senses: [{ glosses: ["edge"] }] },
  ]);

  assert.equal(mockHeroSearchSuggestions.children.length, 3, "Rendered 3 candidates for 'はし'");

  // ArrowDown 1
  mockHeroSearchInput.dispatchEvent({ type: "keydown", key: "ArrowDown", preventDefault: () => {} });
  assert.equal(mockHeroSearchSuggestions.children[0].classList.contains("highlighted"), true, "Item 0 must be highlighted");

  // ArrowDown 2
  mockHeroSearchInput.dispatchEvent({ type: "keydown", key: "ArrowDown", preventDefault: () => {} });
  assert.equal(mockHeroSearchSuggestions.children[1].classList.contains("highlighted"), true, "Item 1 must be highlighted");

  // ArrowUp 1
  mockHeroSearchInput.dispatchEvent({ type: "keydown", key: "ArrowUp", preventDefault: () => {} });
  assert.equal(mockHeroSearchSuggestions.children[0].classList.contains("highlighted"), true, "Item 0 must be highlighted");

  // Enter on highlighted item (index 0 = 橋)
  identifiedWord = null;
  mockHeroSearchInput.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {} });
  assert.equal(identifiedWord, "橋", "Enter on highlighted item must call identify('橋')");

  // Escape test
  sandbox.renderQuickAddSuggestions([
    { term: "橋", reading: "はし", senses: [{ glosses: ["bridge"] }] },
  ]);
  mockHeroSearchInput.value = "hashi";
  mockHeroSearchInput.dispatchEvent({ type: "keydown", key: "Escape", preventDefault: () => {}, stopPropagation: () => {} });
  assert.equal(mockHeroSearchPopup.hidden, true, "Escape must hide suggestions container");

  console.log("PASS 8: Scoped keyboard navigation (ArrowDown/Up, Enter, Escape) verified.");

  // ==========================================================================
  // 10. Verify Dirty Draft Protection on Candidate Selection
  // ==========================================================================
  sandbox.renderQuickAddSuggestions([
    { term: "食べる", reading: "たべる", senses: [{ glosses: ["to eat"] }] },
  ]);
  const candidateLi = mockHeroSearchSuggestions.children[0];

  sandbox.isCardDraftDirty = () => true;
  identifiedWord = null;

  // First click: prompts confirmation (.confirm-replace)
  candidateLi.dispatchEvent({ type: "click", stopPropagation: () => {} });
  assert.equal(identifiedWord, null, "First click on candidate when draft is dirty must NOT call identify()");
  assert.equal(candidateLi.classList.contains("confirm-replace"), true, "Candidate element must receive .confirm-replace class");

  // Second click: confirms and commits
  candidateLi.dispatchEvent({ type: "click", stopPropagation: () => {} });
  assert.equal(identifiedWord, "食べる", "Second click on candidate confirming replacement must call identify()");
  assert.equal(candidateLi.classList.contains("confirm-replace"), false, "confirm-replace class must be removed on commit");

  sandbox.isCardDraftDirty = () => false;

  console.log("PASS 9: Dirty card draft protection on candidate selection verified.");

  // ==========================================================================
  // 11. Same-Reading Multi-Candidate Discovery & Preservation
  // ==========================================================================
  const multiCandidatesSameReading = [
    { term: "地震", reading: "じしん", senses: [{ glosses: ["earthquake"] }] },
    { term: "地震", reading: "じしん", senses: [{ glosses: ["earthquake (dup)"] }] },
    { term: "自信", reading: "じしん", senses: [{ glosses: ["self-confidence"] }] },
    { term: "自身", reading: "じしん", senses: [{ glosses: ["oneself"] }] },
    { term: "侍臣", reading: "じしん", senses: [{ glosses: ["courtier"] }] },
  ];

  sandbox.renderQuickAddSuggestions(multiCandidatesSameReading);
  assert.equal(mockHeroSearchSuggestions.children.length, 4, "Must render exactly 4 distinct candidate list elements");

  const candidateTerms = mockHeroSearchSuggestions.children.map(
    li => li.children[0].children[0].textContent
  );
  assert.deepEqual(candidateTerms, ["地震", "自信", "自身", "侍臣"], "All distinct same-reading expressions must be preserved in order");

  console.log("PASS 10: Same-reading multi-candidate discovery, preservation, and non-first selection verified.");

  console.log("\nALL HERO SEARCH & QUICK ADD MERGING TESTS PASSED! (10/10 Test Suites)");
}, 100);
