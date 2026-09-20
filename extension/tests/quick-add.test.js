const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting Kiroku Note Quick Add (Third Input Mode) Tests...\n");

// ==========================================================================
// 1. Verify HTML Structure & Tab Markup
// ==========================================================================
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

// Tab Button
assert.ok(html.includes('id="tab-btn-quickadd"'), "Tab button #tab-btn-quickadd must exist");
assert.ok(
  html.includes('id="tab-btn-quickadd"') &&
  html.includes('role="tab"') &&
  html.includes('aria-controls="quickadd-mining-view"'),
  "Quick Add tab button must have role='tab' and aria-controls='quickadd-mining-view'"
);

// Tab Panel View
assert.ok(html.includes('id="quickadd-mining-view"'), "Quick Add view #quickadd-mining-view must exist");
assert.ok(
  html.includes('id="quickadd-mining-view"') &&
  html.includes('role="tabpanel"') &&
  html.includes('aria-labelledby="tab-btn-quickadd"'),
  "Quick Add view panel must have role='tabpanel' and aria-labelledby='tab-btn-quickadd'"
);

// Quick Add View Content: input, clear button, kana mode toggle, suggestions container
assert.ok(html.includes('id="quickadd-input"'), "Quick Add input element #quickadd-input must exist");
assert.ok(html.includes('id="quickadd-clear-btn"'), "Quick Add clear button #quickadd-clear-btn must exist");
assert.ok(html.includes('id="quickadd-mode-hiragana"'), "Hiragana mode button #quickadd-mode-hiragana must exist");
assert.ok(html.includes('id="quickadd-mode-katakana"'), "Katakana mode button #quickadd-mode-katakana must exist");
assert.ok(html.includes('id="quickadd-suggestions-container"'), "Quick Add suggestions container #quickadd-suggestions-container must exist");
assert.ok(html.includes('id="quickadd-suggestions-list"'), "Quick Add suggestions list #quickadd-suggestions-list must exist");

// Script Loading Order: wanakana.js must load before sidepanel.js
const wanakanaScriptIdx = html.indexOf('<script src="../lib/wanakana.js"></script>');
const sidepanelScriptIdx = html.indexOf('<script src="sidepanel.js"></script>');
assert.ok(wanakanaScriptIdx !== -1, "wanakana.js script must be referenced in sidepanel.html");
assert.ok(sidepanelScriptIdx !== -1, "sidepanel.js script must be referenced in sidepanel.html");
assert.ok(wanakanaScriptIdx < sidepanelScriptIdx, "wanakana.js MUST load before sidepanel.js");

console.log("PASS 1: HTML DOM structure, role/aria attributes, and script loading order verified.");

// ==========================================================================
// 2. Verify CSS Styling for Quick Add & JLPT Card Preview
// ==========================================================================
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const css = fs.readFileSync(cssPath, "utf8");

assert.ok(css.includes(".quickadd-container"), "CSS must define .quickadd-container");
assert.ok(css.includes(".quickadd-input-row"), "CSS must define .quickadd-input-row");
assert.ok(css.includes(".quickadd-kana-mode-group"), "CSS must define .quickadd-kana-mode-group");
assert.ok(css.includes(".quickadd-mode-btn"), "CSS must define .quickadd-mode-btn");
assert.ok(css.includes(".quickadd-input"), "CSS must define .quickadd-input");
assert.ok(css.includes(".quickadd-suggestions-container"), "CSS must define .quickadd-suggestions-container");
assert.ok(css.includes(".quickadd-candidate-item"), "CSS must define .quickadd-candidate-item");
assert.ok(css.includes(".quickadd-candidate-expression"), "CSS must define .quickadd-candidate-expression");
assert.ok(css.includes(".quickadd-candidate-reading"), "CSS must define .quickadd-candidate-reading");
assert.ok(css.includes(".quickadd-candidate-gloss"), "CSS must define .quickadd-candidate-gloss");

// Front tag & enlarged JLPT badge styling
assert.ok(css.includes(".kn-front-tags"), "CSS must define .kn-front-tags for Front Card Preview JLPT badge");
assert.ok(css.includes(".kn-tag.kn-jlpt"), "CSS must style .kn-tag.kn-jlpt");
assert.ok(css.includes("font-size: 13px;"), "Card preview JLPT badge must have font-size: 13px (larger than 11px dictionary badge)");

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
      const type = typeof event === "string" ? event : event.type || "click";
      if (this._listeners[type]) {
        this._listeners[type].forEach(fn => fn(event));
      }
      return true;
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
      add(c) { el._classes.add(c); },
      remove(c) { el._classes.delete(c); },
      contains(c) { return el._classes.has(c); },
      toggle(c, force) {
        const has = el._classes.has(c);
        const next = typeof force === "boolean" ? force : !has;
        if (next) el._classes.add(c);
        else el._classes.delete(c);
      },
    },
    remove() {
      if (this.parentNode && this.parentNode.children) {
        this.parentNode.children = this.parentNode.children.filter(c => c !== this);
      }
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
      this.children.forEach(n => { if (n) n.parentNode = this; });
    },
    appendChild(node) {
      if (node) node.parentNode = this;
      this.children.push(node);
      return node;
    },
    append(...nodes) {
      nodes.forEach(n => {
        if (n) {
          n.parentNode = this;
          this.children.push(n);
        }
      });
    },
    prepend(...nodes) {
      nodes.forEach(n => { if (n) n.parentNode = this; });
      this.children.unshift(...nodes);
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
    focus() {},
    scrollIntoView() {},
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
  return el;
}

// ==========================================================================
// 4. Test Tab Switching Generalization (text, video, quickadd)
// ==========================================================================
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

const mockTabBtnText = createMockElement("button", "tab-btn-text");
mockTabBtnText.classList.add("active");
mockTabBtnText.setAttribute("aria-selected", "true");

const mockTabBtnVideo = createMockElement("button", "tab-btn-video");
mockTabBtnVideo.setAttribute("aria-selected", "false");

const mockTabBtnQuickAdd = createMockElement("button", "tab-btn-quickadd");
mockTabBtnQuickAdd.setAttribute("aria-selected", "false");

const mockTextMiningView = createMockElement("div", "text-mining-view");
mockTextMiningView.hidden = false;

const mockVideoMiningView = createMockElement("div", "video-mining-view");
mockVideoMiningView.hidden = true;

const mockQuickAddMiningView = createMockElement("div", "quickadd-mining-view");
mockQuickAddMiningView.hidden = true;

const mockQuickAddInput = createMockElement("input", "quickadd-input");
const mockQuickAddClearBtn = createMockElement("button", "quickadd-clear-btn");
const mockQuickAddSuggestionsContainer = createMockElement("div", "quickadd-suggestions-container");
mockQuickAddSuggestionsContainer.hidden = true;
const mockQuickAddSuggestionsList = createMockElement("ul", "quickadd-suggestions-list");

const mockQuickAddModeHiragana = createMockElement("button", "quickadd-mode-hiragana");
mockQuickAddModeHiragana.classList.add("active");
mockQuickAddModeHiragana.setAttribute("aria-checked", "true");

const mockQuickAddModeKatakana = createMockElement("button", "quickadd-mode-katakana");
mockQuickAddModeKatakana.setAttribute("aria-checked", "false");

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

// Set up sandbox
const wanakanaModule = require("../lib/wanakana.js");

const sandbox = {
  document: {
    querySelector: (sel) => {
      switch (sel) {
        case "#tab-btn-text": return mockTabBtnText;
        case "#tab-btn-video": return mockTabBtnVideo;
        case "#tab-btn-quickadd": return mockTabBtnQuickAdd;
        case "#text-mining-view": return mockTextMiningView;
        case "#video-mining-view": return mockVideoMiningView;
        case "#quickadd-mining-view": return mockQuickAddMiningView;
        case "#quickadd-input": return mockQuickAddInput;
        case "#quickadd-clear-btn": return mockQuickAddClearBtn;
        case "#quickadd-suggestions-container": return mockQuickAddSuggestionsContainer;
        case "#quickadd-suggestions-list": return mockQuickAddSuggestionsList;
        case "#quickadd-mode-hiragana": return mockQuickAddModeHiragana;
        case "#quickadd-mode-katakana": return mockQuickAddModeKatakana;
        default: return createMockElement("div");
      }
    },
    createElement: (tag) => createMockElement(tag),
    createTextNode: (text) => ({ textContent: text }),
    addEventListener: () => {},
  },
  chrome: mockChrome,
  wanakana: wanakanaModule,
  window: {},
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  fetch: null, // Will mock per test
};

vm.createContext(sandbox);

// Execute sidepanel.js in sandbox
vm.runInContext(jsContent, sandbox);

// Test A: Switch to "quickadd"
sandbox.switchMiningTab("quickadd");

assert.equal(mockTabBtnQuickAdd.classList.contains("active"), true, "Quick Add tab button must be active");
assert.equal(mockTabBtnQuickAdd.getAttribute("aria-selected"), "true", "Quick Add tab aria-selected must be true");
assert.equal(mockQuickAddMiningView.hidden, false, "Quick Add mining view must not be hidden");

assert.equal(mockTabBtnText.classList.contains("active"), false, "Text Mining tab button must be inactive");
assert.equal(mockTabBtnText.getAttribute("aria-selected"), "false", "Text Mining tab aria-selected must be false");
assert.equal(mockTextMiningView.hidden, true, "Text Mining view must be hidden");

assert.equal(mockTabBtnVideo.classList.contains("active"), false, "Video Mining tab button must be inactive");
assert.equal(mockTabBtnVideo.getAttribute("aria-selected"), "false", "Video Mining tab aria-selected must be false");
assert.equal(mockVideoMiningView.hidden, true, "Video Mining view must be hidden");

assert.equal(mockStorage.active_mining_tab, "quickadd", "Storage must record active_mining_tab='quickadd'");
assert.equal(sandbox.isVideoMiningActive(), false, "isVideoMiningActive() must return false during quickadd tab");

// Test B: Switch to "video" (regression)
sandbox.switchMiningTab("video");
assert.equal(mockTabBtnVideo.classList.contains("active"), true, "Video tab button must be active");
assert.equal(mockVideoMiningView.hidden, false, "Video mining view must not be hidden");
assert.equal(mockQuickAddMiningView.hidden, true, "Quick Add mining view must be hidden");
assert.equal(mockTextMiningView.hidden, true, "Text mining view must be hidden");
assert.equal(mockStorage.active_mining_tab, "video", "Storage must record active_mining_tab='video'");
assert.equal(sandbox.isVideoMiningActive(), true, "isVideoMiningActive() must return true during video tab");

// Test C: Switch to "text" (regression)
sandbox.switchMiningTab("text");
assert.equal(mockTabBtnText.classList.contains("active"), true, "Text tab button must be active");
assert.equal(mockTextMiningView.hidden, false, "Text mining view must not be hidden");
assert.equal(mockQuickAddMiningView.hidden, true, "Quick Add mining view must be hidden");
assert.equal(mockVideoMiningView.hidden, true, "Video mining view must be hidden");
assert.equal(mockStorage.active_mining_tab, "text", "Storage must record active_mining_tab='text'");
assert.equal(sandbox.isVideoMiningActive(), false, "isVideoMiningActive() must return false during text tab");

console.log("PASS 3: switchMiningTab generalization and isVideoMiningActive() verified.");

// ==========================================================================
// 5. Verify WanaKana IME Binding & Hiragana / Katakana Mode Switching
// ==========================================================================
// Verify that wanakana bound the input
assert.ok(mockQuickAddInput.hasAttribute("data-wanakana-id"), "Quick Add input must be bound with WanaKana data-wanakana-id");

// Verify romaji progressive conversion (default Hiragana)
mockQuickAddInput.value = "taberu";
mockQuickAddInput.selectionEnd = 6;
mockQuickAddInput.dispatchEvent({ type: "input", target: mockQuickAddInput });
assert.equal(mockQuickAddInput.value, "たべる", "WanaKana IME must convert 'taberu' to 'たべる'");

mockQuickAddInput.value = "hashi";
mockQuickAddInput.selectionEnd = 5;
mockQuickAddInput.dispatchEvent({ type: "input", target: mockQuickAddInput });
assert.equal(mockQuickAddInput.value, "はし", "WanaKana IME must convert 'hashi' to 'はし'");

// Direct Japanese input and paste
mockQuickAddInput.value = "食べる";
mockQuickAddInput.selectionEnd = 3;
mockQuickAddInput.dispatchEvent({ type: "input", target: mockQuickAddInput });
assert.equal(mockQuickAddInput.value, "食べる", "Direct Japanese / pasted kanji must pass through without corruption");

// Switch to Katakana mode via button click
mockQuickAddModeKatakana.dispatchEvent({ type: "click" });
assert.equal(mockQuickAddModeKatakana.classList.contains("active"), true, "Katakana button must be active");
assert.equal(mockQuickAddModeHiragana.classList.contains("active"), false, "Hiragana button must be inactive");
assert.equal(mockQuickAddModeKatakana.getAttribute("aria-checked"), "true", "Katakana button aria-checked must be true");
assert.equal(mockQuickAddModeHiragana.getAttribute("aria-checked"), "false", "Hiragana button aria-checked must be false");

// Typing romaji in Katakana mode converts to Katakana
mockQuickAddInput.value = "taberu";
mockQuickAddInput.selectionEnd = 6;
mockQuickAddInput.dispatchEvent({ type: "input", target: mockQuickAddInput });
assert.equal(mockQuickAddInput.value, "タベル", "Katakana mode must convert 'taberu' to 'タベル'");

// Toggling back to Hiragana mode converts existing input to Hiragana
mockQuickAddModeHiragana.dispatchEvent({ type: "click" });
assert.equal(mockQuickAddModeHiragana.classList.contains("active"), true, "Hiragana button must be active");
assert.equal(mockQuickAddModeKatakana.classList.contains("active"), false, "Katakana button must be inactive");
assert.equal(mockQuickAddInput.value, "たべる", "Switching to Hiragana mode must convert existing text 'タベル' to 'たべる'");

// Test F7 shortcut key switches to Katakana
mockQuickAddInput.dispatchEvent({ type: "keydown", key: "F7", preventDefault: () => {} });
assert.equal(mockQuickAddModeKatakana.classList.contains("active"), true, "F7 key must activate Katakana mode");
assert.equal(mockQuickAddInput.value, "タベル", "F7 key must convert existing text to Katakana");

// Test F6 shortcut key switches to Hiragana
mockQuickAddInput.dispatchEvent({ type: "keydown", key: "F6", preventDefault: () => {} });
assert.equal(mockQuickAddModeHiragana.classList.contains("active"), true, "F6 key must activate Hiragana mode");
assert.equal(mockQuickAddInput.value, "たべる", "F6 key must convert existing text to Hiragana");

console.log("PASS 4: WanaKana incremental romaji->kana and Hiragana/Katakana mode switching verified.");

// ==========================================================================
// 6. Verify Card Preview JLPT Badge (Front & Back)
// ==========================================================================
// Front side preview with JLPT level
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

// Front side preview when show_jlpt is disabled
const mockFrontPreviewNoJlpt = createMockElement("div", "card-preview-front-no-jlpt");
sandbox.renderCardPreviewDOM(mockFrontPreviewNoJlpt, {
  expression: "食べる",
  reading: "たべる",
  jlpt_level: "N5",
  template_settings: { show_jlpt: false }
}, "front");
const frontNoJlptTags = mockFrontPreviewNoJlpt.querySelector(".kn-front-tags");
assert.equal(frontNoJlptTags, null, "Front Card Preview must not render JLPT badge when show_jlpt is false");

// Back side preview with JLPT level
const mockBackPreviewContainer = createMockElement("div", "card-preview-back");
sandbox.renderCardPreviewDOM(mockBackPreviewContainer, {
  expression: "食べる",
  reading: "たべる",
  jlpt_level: "N5",
  template_settings: { show_jlpt: true }
}, "back");
const backJlptSpan = mockBackPreviewContainer.querySelector(".kn-reading .kn-tag.kn-jlpt");
assert.ok(backJlptSpan, "Back Card Preview must render .kn-reading .kn-tag.kn-jlpt when jlpt_level is present");
assert.equal(backJlptSpan.textContent, "JLPT N5", "Back JLPT tag must display 'JLPT N5'");

console.log("PASS 5: Card Preview JLPT badge rendering on Front and Back verified.");

// ==========================================================================
// 7. Verify Debounced Candidate Lookup & Request Shape
// ==========================================================================
let capturedFetchRequest = null;
sandbox.fetch = async (url, options) => {
  capturedFetchRequest = { url, options, body: JSON.parse(options.body) };
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

mockQuickAddInput.value = "たべる";
sandbox.executeQuickAddLookup();

// Wait microtask
setImmediate(async () => {
  assert.ok(capturedFetchRequest, "Candidate lookup must perform a fetch request");
  assert.equal(capturedFetchRequest.url, "http://127.0.0.1:21828/api/capture", "Must use API_CAPTURE_URL (/api/capture)");
  assert.equal(capturedFetchRequest.options.method, "POST", "Must use HTTP POST");
  assert.equal(capturedFetchRequest.body.auto_save, false, "auto_save MUST be false");
  assert.equal(capturedFetchRequest.body.text, "たべる", "text field must equal typed input");
  assert.equal(typeof capturedFetchRequest.body.deck_name, "string", "deck_name field must be included");

  // Verify suggestion rendering
  assert.equal(mockQuickAddSuggestionsContainer.hidden, false, "Suggestions container must become visible when entries are returned");
  assert.equal(mockQuickAddSuggestionsList.children.length, 2, "Suggestions list must render 2 candidate items");

  const firstItem = mockQuickAddSuggestionsList.children[0];
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

  // Click on first candidate
  firstItem.dispatchEvent({ type: "click", stopPropagation: () => {} });
  assert.equal(identifiedWord, "食べる", "Selecting candidate must call existing identify('食べる')");
  assert.equal(mockQuickAddSuggestionsContainer.hidden, true, "Selecting candidate must close suggestions container");

  // Fallback test: Enter with empty candidates
  identifiedWord = null;
  mockQuickAddSuggestionsList.replaceChildren(); // empty candidates
  sandbox.quickAddCandidates = [];
  sandbox.quickAddHighlightedIndex = -1;
  mockQuickAddInput.value = "謎の単語";

  // Simulate Enter on input
  mockQuickAddInput.dispatchEvent({
    type: "keydown",
    key: "Enter",
    preventDefault: () => {},
  });

  assert.equal(identifiedWord, "謎の単語", "Pressing Enter with no candidates must call identify(currentInputValue)");

  console.log("PASS 7: Candidate selection and fallback Enter committing to identify() verified.");

  // ==========================================================================
  // 9. Verify Scoped Keyboard Navigation
  // ==========================================================================
  // Re-render candidates
  sandbox.renderQuickAddSuggestions([
    { term: "橋", reading: "はし", senses: [{ glosses: ["bridge"] }] },
    { term: "箸", reading: "はし", senses: [{ glosses: ["chopsticks"] }] },
    { term: "端", reading: "はし", senses: [{ glosses: ["edge"] }] },
  ]);

  assert.equal(mockQuickAddSuggestionsList.children.length, 3, "Rendered 3 candidates for 'はし'");

  // ArrowDown 1
  mockQuickAddInput.dispatchEvent({ type: "keydown", key: "ArrowDown", preventDefault: () => {} });
  assert.equal(mockQuickAddSuggestionsList.children[0].classList.contains("highlighted"), true, "Item 0 must be highlighted");
  assert.equal(mockQuickAddInput.getAttribute("aria-activedescendant"), "quickadd-candidate-0", "aria-activedescendant must point to candidate-0");

  // ArrowDown 2
  mockQuickAddInput.dispatchEvent({ type: "keydown", key: "ArrowDown", preventDefault: () => {} });
  assert.equal(mockQuickAddSuggestionsList.children[1].classList.contains("highlighted"), true, "Item 1 must be highlighted");
  assert.equal(mockQuickAddInput.getAttribute("aria-activedescendant"), "quickadd-candidate-1", "aria-activedescendant must point to candidate-1");

  // ArrowUp 1
  mockQuickAddInput.dispatchEvent({ type: "keydown", key: "ArrowUp", preventDefault: () => {} });
  assert.equal(mockQuickAddSuggestionsList.children[0].classList.contains("highlighted"), true, "Item 0 must be highlighted");
  assert.equal(mockQuickAddInput.getAttribute("aria-activedescendant"), "quickadd-candidate-0", "aria-activedescendant must retreat to candidate-0");

  // Enter on highlighted item (index 0 = 橋)
  identifiedWord = null;
  mockQuickAddInput.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {} });
  assert.equal(identifiedWord, "橋", "Enter on highlighted item must call identify('橋')");

  // Escape test: dismisses suggestions without clearing typed input text
  sandbox.renderQuickAddSuggestions([
    { term: "橋", reading: "はし", senses: [{ glosses: ["bridge"] }] },
  ]);
  mockQuickAddInput.value = "hashi";
  mockQuickAddInput.dispatchEvent({ type: "keydown", key: "Escape", preventDefault: () => {}, stopPropagation: () => {} });
  assert.equal(mockQuickAddSuggestionsContainer.hidden, true, "Escape must hide suggestions container");
  assert.equal(mockQuickAddInput.value, "hashi", "Escape MUST NOT clear the typed input text");

  console.log("PASS 8: Scoped keyboard navigation (ArrowDown/Up, Enter, Escape) verified.");

  // ==========================================================================
  // 10. Verify Dirty Draft Protection on Candidate Selection
  // ==========================================================================
  sandbox.renderQuickAddSuggestions([
    { term: "食べる", reading: "たべる", senses: [{ glosses: ["to eat"] }] },
  ]);
  const candidateLi = mockQuickAddSuggestionsList.children[0];

  // Mock isCardDraftDirty to return true
  sandbox.isCardDraftDirtyState = true;
  const originalIsDirty = sandbox.isCardDraftDirty;
  sandbox.isCardDraftDirty = () => true;

  identifiedWord = null;
  // First click: should prompt confirmation (.confirm-replace) and NOT commit
  candidateLi.dispatchEvent({ type: "click", stopPropagation: () => {} });
  assert.equal(identifiedWord, null, "First click on candidate when draft is dirty must NOT call identify()");
  assert.equal(candidateLi.classList.contains("confirm-replace"), true, "Candidate element must receive .confirm-replace class");

  // Second click: should confirm and commit
  candidateLi.dispatchEvent({ type: "click", stopPropagation: () => {} });
  assert.equal(identifiedWord, "食べる", "Second click on candidate confirming replacement must call identify()");
  assert.equal(candidateLi.classList.contains("confirm-replace"), false, "confirm-replace class must be removed on commit");

  // Restore dirty check
  sandbox.isCardDraftDirty = originalIsDirty;
  sandbox.isCardDraftDirtyState = false;

  console.log("PASS 9: Dirty card draft protection on candidate selection verified.");

  // ==========================================================================
  // 11. Stale Response & Race Protection
  // ==========================================================================
  sandbox.clearQuickAddSuggestions();
  let callCount = 0;
  sandbox.fetch = async (url, options) => {
    callCount++;
    const currentCall = callCount;
    // Delay first call longer than second call
    if (currentCall === 1) {
      await new Promise(r => setTimeout(r, 100));
      return {
        ok: true,
        json: async () => ({ entries: [{ term: "た", reading: "た", senses: [{ glosses: ["old"] }] }] }),
      };
    } else {
      return {
        ok: true,
        json: async () => ({ entries: [{ term: "食べる", reading: "たべる", senses: [{ glosses: ["new"] }] }] }),
      };
    }
  };

  mockQuickAddInput.value = "た";
  sandbox.executeQuickAddLookup(); // Request 1

  mockQuickAddInput.value = "たべる";
  sandbox.executeQuickAddLookup(); // Request 2

  setTimeout(() => {
    // Only Request 2 should be rendered
    assert.equal(mockQuickAddSuggestionsList.children.length, 1);
    const displayed = mockQuickAddSuggestionsList.children[0].children[0].children[0].textContent;
    assert.equal(displayed, "食べる", "Older request must not overwrite newer lookup results");
    console.log("PASS 10: Stale lookup response sequence protection verified.");

    console.log("\nALL QUICK ADD TESTS PASSED! (10/10 Test Suites)");
  }, 150);
});
