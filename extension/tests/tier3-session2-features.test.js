/**
 * Test Suite for Tier 3 Session 2 Features:
 * - T3-E: Example Sentence Stepper (◀ 1/3 ▶)
 * - T3-H: Furigana Density Control (All / Advanced-only / None)
 * - T3-I: Capture Provenance Tracking
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

test("Tier 3 Session 2: HTML & CSS Structure Verification", () => {
  // T3-H: Furigana density dropdown
  assert.ok(htmlContent.includes('id="setting-furigana-mode"'), "HTML must include #setting-furigana-mode select element");
  assert.ok(htmlContent.includes('value="all"'), "Furigana select must include all option");
  assert.ok(htmlContent.includes('value="advanced_only"'), "Furigana select must include advanced_only option");
  assert.ok(htmlContent.includes('value="none"'), "Furigana select must include none option");

  // T3-E: Stepper CSS
  assert.ok(cssContent.includes(".example-stepper-controls"), "CSS must style .example-stepper-controls");
  assert.ok(cssContent.includes(".btn-example-stepper"), "CSS must style .btn-example-stepper");
  assert.ok(cssContent.includes(".example-stepper-indicator"), "CSS must style .example-stepper-indicator");

  // T3-I: Provenance Badge CSS
  assert.ok(cssContent.includes(".history-item-source"), "CSS must style .history-item-source");
});

// Setup DOM mock element helper
function createMockElement(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    tag,
    _className: "",
    _textContent: "",
    title: "",
    value: "",
    open: false,
    hidden: false,
    style: {},
    children: [],
    dataset: {},
    _listeners: {},
    classList: {
      _classes: new Set(),
      add(...classes) { classes.forEach(c => this._classes.add(c)); },
      remove(...classes) { classes.forEach(c => this._classes.delete(c)); },
      contains(c) { return this._classes.has(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this.contains(c)) { this.remove(c); return false; }
          this.add(c); return true;
        }
        if (force) this.add(c); else this.remove(c);
        return force;
      },
    },
    append(...els) {
      for (const e of els) {
        if (!e) continue;
        if (e.nodeType === 11) {
          this.children.push(...e.children);
        } else {
          this.children.push(e);
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
    },
    removeEventListener(event, fn) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    },
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event?.type;
      const evObj = typeof event === "string" ? { type: event, stopPropagation() {} } : event;
      if (this._listeners[type]) {
        this._listeners[type].forEach(fn => fn(evObj));
      }
      if (this["on" + type] && (!this._listeners[type] || !this._listeners[type].includes(this["on" + type]))) {
        this["on" + type](evObj);
      }
      return true;
    },
    setAttribute(name, val) { this[name] = val; },
    getAttribute(name) { return this[name] || null; },
    hasAttribute(name) { return Boolean(this[name]); },
  };

  Object.defineProperty(el, "className", {
    get() {
      if (this.classList._classes.size > 0) {
        return Array.from(this.classList._classes).join(" ");
      }
      return this._className;
    },
    set(val) {
      this._className = String(val);
      this.classList._classes.clear();
      this._className.split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
    },
  });

  Object.defineProperty(el, "textContent", {
    get() {
      if (this.children.length > 0) {
        return this.children.map(c => (c.textContent !== undefined ? c.textContent : (c.text || ""))).join("");
      }
      return this._textContent;
    },
    set(val) {
      this._textContent = String(val);
      this.children = [];
    },
  });

  return el;
}

function createTextNode(text) {
  return {
    nodeType: 3,
    textContent: String(text),
    text: String(text),
  };
}

function findSelector(root, selector) {
  if (!root || !Array.isArray(root.children)) return null;
  for (const child of root.children) {
    if (matchesSelector(child, selector)) return child;
    const sub = findSelector(child, selector);
    if (sub) return sub;
  }
  return null;
}

function findAllSelector(root, selector) {
  const results = [];
  if (!root || !Array.isArray(root.children)) return results;
  for (const child of root.children) {
    if (matchesSelector(child, selector)) results.push(child);
    results.push(...findAllSelector(child, selector));
  }
  return results;
}

function matchesSelector(el, selector) {
  if (!el || el.nodeType === 3) return false;
  if (selector.startsWith(".")) {
    const cls = selector.slice(1);
    return el.classList && el.classList.contains(cls);
  }
  if (selector.startsWith("#")) {
    return el.id === selector.slice(1);
  }
  return el.tagName === selector.toUpperCase();
}

// Build VM Context with mocks
const mockHistoryCardsList = createMockElement("div");
const mockDocument = {
  createElement(tag) { return createMockElement(tag); },
  createTextNode(text) { return createTextNode(text); },
  querySelector(sel) {
    if (sel === "#history-cards-list") return mockHistoryCardsList;
    return createMockElement(sel.replace(/^[#\.]/, ""));
  },
  querySelectorAll() { return []; },
  addEventListener() {},
  removeEventListener() {},
};

const vmContext = {
  document: mockDocument,
  window: { confirm: () => true },
  historyCardsList: mockHistoryCardsList,
  selectedHistoryCardId: null,
  currentCardTemplateSettings: {
    front: { show_reading: false, show_meaning: false, show_kanji_reading: false, show_hint: false },
    back: { show_reading: true, show_meaning: true, show_hint: true },
    furigana_mode: "all",
    show_jlpt: true,
    show_verb_type: true,
    show_history: true,
  },
  DEFAULT_CARD_TEMPLATE_SETTINGS: {
    furigana_mode: "all",
  },
  lastCaptureSource: { tabId: null, frameId: null, type: "text", url: "", title: "" },
  insertExampleToCard: () => {},
  openSavedCard: () => {},
  retrySyncFromHistory: () => {},
  deleteLocalCard: () => {},
  console,
  URL,
};

vm.createContext(vmContext);

// Execute JLPT set and renderRubyText in VM
const rubySrc = jsContent.slice(
  jsContent.indexOf("// OpenJLPT N4/N5 kanji set"),
  jsContent.indexOf("let isCardDraftDirtyState")
);
vm.runInContext(rubySrc + "\nthis.JLPT_N4_N5_KANJI = JLPT_N4_N5_KANJI;\nthis.isN4N5KanjiString = isN4N5KanjiString;", vmContext);

// Execute renderStudySenseItem in VM
const senseSrc = jsContent.slice(
  jsContent.indexOf("function renderStudySenseItem"),
  jsContent.indexOf("function cleanReadingForInput")
);
vm.runInContext(senseSrc, vmContext);

// Execute renderHistoryCards in VM
const historySrc = jsContent.slice(
  jsContent.indexOf("function renderHistoryCards"),
  jsContent.indexOf("async function openSavedCard")
);
vm.runInContext(historySrc, vmContext);

test("T3-H: Furigana Density Control - Settings, JLPT N4/N5 set & renderRubyText", () => {
  const {
    DEFAULT_CARD_TEMPLATE_SETTINGS,
    JLPT_N4_N5_KANJI,
    isN4N5KanjiString,
    renderRubyText,
  } = vmContext;

  assert.equal(DEFAULT_CARD_TEMPLATE_SETTINGS.furigana_mode, "all", "Default furigana_mode should be 'all'");
  assert.ok(JLPT_N4_N5_KANJI.has("食"), "食 is in N4/N5 kanji set");
  assert.ok(JLPT_N4_N5_KANJI.has("日"), "日 is in N4/N5 kanji set");
  assert.ok(!JLPT_N4_N5_KANJI.has("曖"), "曖 (N1) is not in N4/N5 kanji set");

  assert.equal(isN4N5KanjiString("食べる"), true, "食べる is identified as N4/N5 kanji string");
  assert.equal(isN4N5KanjiString("時間"), true, "時間 is identified as N4/N5 kanji string");
  assert.equal(isN4N5KanjiString("曖昧"), false, "曖昧 is not N4/N5 kanji string");

  // Test renderRubyText with furiganaMode = 'all'
  const containerAll = createMockElement("div");
  renderRubyText(containerAll, "朝[あさ]御[ご]飯[はん]を食[た]べる。", undefined, { furiganaMode: "all" });
  const rubiesAll = findAllSelector(containerAll, "ruby");
  assert.equal(rubiesAll.length, 4, "Under 'all' mode, all 4 bracketed items render as <ruby>");

  // Test renderRubyText with furiganaMode = 'none'
  const containerNone = createMockElement("div");
  renderRubyText(containerNone, "朝[あさ]御[ご]飯[はん]を食[た]べる。", undefined, { furiganaMode: "none" });
  const rubiesNone = findAllSelector(containerNone, "ruby");
  assert.equal(rubiesNone.length, 0, "Under 'none' mode, 0 <ruby> tags render");
  assert.equal(containerNone.textContent, "朝御飯を食べる。", "Plain text is preserved without furigana");

  // Test renderRubyText with furiganaMode = 'advanced_only'
  // '朝' (N4/N5), '御' (N3+), '飯' (N4), '食' (N5) -> '御' should retain ruby, others suppressed
  const containerAdv = createMockElement("div");
  renderRubyText(containerAdv, "朝[あさ]御[ご]飯[はん]を食[た]べる。", undefined, { furiganaMode: "advanced_only" });
  const rubiesAdv = findAllSelector(containerAdv, "ruby");
  assert.equal(rubiesAdv.length, 1, "Under 'advanced_only', only N3+ kanji '御' retains ruby");
  assert.equal(rubiesAdv[0].textContent, "御ご", "Ruby contains base + rt");
});

test("T3-E: Example Sentence Stepper - Navigation & Populating Sentence", () => {
  const { renderStudySenseItem } = vmContext;

  // Single example -> no stepper controls rendered
  const singleExampleSense = {
    index: 1,
    glosses: ["test gloss"],
    examples: [
      { japanese: "映画を見る", translation: "to watch a movie" }
    ]
  };
  const liSingle = renderStudySenseItem(singleExampleSense, 0, {}, 1);
  const stepperSingle = findSelector(liSingle, ".example-stepper-controls");
  assert.equal(stepperSingle, null, "No stepper controls when only 1 example is present");
  const cardSingle = findSelector(liSingle, ".study-example-card");
  assert.ok(cardSingle, "Single example card rendered directly");

  // Multiple examples -> stepper controls rendered (◀ 1/3 ▶)
  const multiExampleSense = {
    index: 1,
    glosses: ["test gloss"],
    examples: [
      { japanese: "本を読む", translation: "to read a book" },
      { japanese: "本を買う", translation: "to buy a book" },
      { japanese: "本を借りる", translation: "to borrow a book" },
    ]
  };
  const liMulti = renderStudySenseItem(multiExampleSense, 0, {}, 1);
  const stepper = findSelector(liMulti, ".example-stepper-controls");
  assert.ok(stepper, "Stepper controls rendered when multiple examples exist");

  const indicator = findSelector(stepper, ".example-stepper-indicator");
  assert.ok(indicator, "Stepper indicator element exists");
  assert.equal(indicator.textContent, "1 / 3", "Initial indicator displays 1 / 3");

  const prevBtn = findSelector(stepper, ".btn-example-prev");
  const nextBtn = findSelector(stepper, ".btn-example-next");
  assert.ok(prevBtn, "Previous button exists");
  assert.ok(nextBtn, "Next button exists");

  const activeJa = findSelector(liMulti, ".study-example-ja");
  assert.equal(activeJa.textContent, "本を読む", "First example active initially");

  // Click Next -> advances to 2 / 3
  nextBtn.dispatchEvent("click");
  assert.equal(indicator.textContent, "2 / 3", "Indicator updates to 2 / 3 after Next click");
  const activeJa2 = findSelector(liMulti, ".study-example-ja");
  assert.equal(activeJa2.textContent, "本を買う", "Second example becomes active");

  // Click Next -> advances to 3 / 3
  nextBtn.dispatchEvent("click");
  assert.equal(indicator.textContent, "3 / 3", "Indicator updates to 3 / 3 after Next click");
  const activeJa3 = findSelector(liMulti, ".study-example-ja");
  assert.equal(activeJa3.textContent, "本を借りる", "Third example becomes active");

  // Click Next -> wraps around to 1 / 3
  nextBtn.dispatchEvent("click");
  assert.equal(indicator.textContent, "1 / 3", "Indicator wraps back to 1 / 3");

  // Click Prev -> wraps around to 3 / 3
  prevBtn.dispatchEvent("click");
  assert.equal(indicator.textContent, "3 / 3", "Indicator wraps to 3 / 3 on Prev from first");
});

test("T3-I: Capture Provenance Tracking - Metadata & History Badge", () => {
  const { renderHistoryCards } = vmContext;

  // Test provenance tracking state
  vmContext.lastCaptureSource = {
    tabId: 1,
    frameId: 0,
    type: "video",
    url: "https://www.youtube.com/watch?v=abc12345",
    title: "Japanese Learning Video"
  };
  assert.equal(vmContext.lastCaptureSource.type, "video", "Capture source type is 'video'");
  assert.equal(vmContext.lastCaptureSource.url, "https://www.youtube.com/watch?v=abc12345", "Capture source url tracked");

  // Test History badge rendering with provenance
  const testCards = [
    {
      id: 101,
      expression: "動画",
      reading: "どうが",
      meaning: "video",
      deck_name: "Japanese",
      sync_status: "synced",
      source_type: "video",
      source_url: "https://www.youtube.com/watch?v=abc12345"
    },
    {
      id: 102,
      expression: "認識",
      reading: "にんしき",
      meaning: "recognition",
      deck_name: "Japanese",
      sync_status: "pending",
      source_type: "ocr",
      source_url: ""
    },
    {
      id: 103,
      expression: "単語",
      reading: "たんご",
      meaning: "vocabulary",
      deck_name: "Japanese",
      sync_status: "synced",
      source_type: "quick_add",
      source_url: ""
    },
    {
      id: 104,
      expression: "文章",
      reading: "ぶんしょう",
      meaning: "sentence",
      deck_name: "Japanese",
      sync_status: "synced",
      source_type: "",
      source_url: ""
    }
  ];

  renderHistoryCards(testCards);

  const historyItems = findAllSelector(mockHistoryCardsList, ".history-item");
  assert.equal(historyItems.length, 4, "Rendered 4 history items");

  // Check card 101 (video source)
  const item101 = historyItems[0];
  const sourceBadge101 = findSelector(item101, ".history-item-source");
  assert.ok(sourceBadge101, "Video card has history-item-source badge");
  assert.ok(sourceBadge101.textContent.includes("🎬"), "Contains video icon");
  assert.ok(sourceBadge101.textContent.includes("youtube.com"), "Contains domain name");

  // Check card 102 (ocr source)
  const item102 = historyItems[1];
  const sourceBadge102 = findSelector(item102, ".history-item-source");
  assert.ok(sourceBadge102, "OCR card has history-item-source badge");
  assert.ok(sourceBadge102.textContent.includes("🔲"), "Contains OCR icon");
  assert.ok(sourceBadge102.textContent.includes("OCR"), "Contains OCR text");

  // Check card 103 (quick_add source)
  const item103 = historyItems[2];
  const sourceBadge103 = findSelector(item103, ".history-item-source");
  assert.ok(sourceBadge103, "Quick Add card has history-item-source badge");
  assert.ok(sourceBadge103.textContent.includes("⚡"), "Contains Quick Add icon");
  assert.ok(sourceBadge103.textContent.includes("Quick Add"), "Contains Quick Add text");

  // Check card 104 (no source)
  const item104 = historyItems[3];
  const sourceBadge104 = findSelector(item104, ".history-item-source");
  assert.equal(sourceBadge104, null, "Card without provenance has no source badge");
});
