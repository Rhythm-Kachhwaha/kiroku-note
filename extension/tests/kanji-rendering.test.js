const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 1. Verify CSS rules in sidepanel.css
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const css = fs.readFileSync(cssPath, "utf8");

assert.ok(css.includes(".study-kanji-card"), "study-kanji-card class must exist in sidepanel.css");
assert.ok(css.includes(".pill-onyomi"), "pill-onyomi class must exist in sidepanel.css");
assert.ok(css.includes(".pill-kunyomi"), "pill-kunyomi class must exist in sidepanel.css");
assert.ok(css.includes(".study-kanji-accordion"), "study-kanji-accordion class must exist in sidepanel.css");

console.log("PASS: Kanji CSS classes verified in sidepanel.css.");

// 2. Mock DOM environment for sidepanel.js
function createMockElement(tag = "div") {
  const classes = new Set();
  const el = {
    tagName: tag.toUpperCase(),
    tag,
    _textContent: "",
    title: "",
    value: "",
    open: false,
    hidden: false,
    style: {},
    children: [],
    _listeners: {},
    classList: {
      add(...cs) { cs.forEach(c => classes.add(c)); },
      remove(...cs) { cs.forEach(c => classes.delete(c)); },
      contains(c) { return classes.has(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (classes.has(c)) { classes.delete(c); return false; }
          else { classes.add(c); return true; }
        } else if (force) {
          classes.add(c); return true;
        } else {
          classes.delete(c); return false;
        }
      },
    },
    append(...els) {
      this.children.push(...els);
    },
    replaceChildren(...els) {
      this.children = [...els];
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
      if (this["on" + type]) {
        this["on" + type](event);
      }
      return true;
    },
    setAttribute(name, val) {
      this[name] = val;
    },
    getAttribute(name) {
      return this[name] || null;
    },
  };

  Object.defineProperty(el, "className", {
    get() {
      return Array.from(classes).join(" ");
    },
    set(val) {
      classes.clear();
      if (val) {
        String(val).split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
      }
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

function findAll(el, predicate) {
  const results = [];
  if (!el || !Array.isArray(el.children)) return results;
  for (const child of el.children) {
    if (predicate(child)) {
      results.push(child);
    }
    results.push(...findAll(child, predicate));
  }
  return results;
}

function findByClass(el, className) {
  return findAll(el, c => c.className && (c.className === className || c.className.split(" ").includes(className)))[0] || null;
}

function findAllByClass(el, className) {
  return findAll(el, c => c.className && (c.className === className || c.className.split(" ").includes(className)));
}

// Elements needed by sidepanel.js
const mockElements = {
  "#btn-capture": createMockElement("button"),
  "#btn-save-card": createMockElement("button"),
  "#btn-sync-anki": createMockElement("button"),
  "#field-expression": createMockElement("input"),
  "#field-reading": createMockElement("input"),
  "#field-meaning": createMockElement("textarea"),
  "#field-definition": createMockElement("textarea"),
  "#field-sentence": createMockElement("textarea"),
  "#field-translation": createMockElement("textarea"),
  "#field-notes": createMockElement("textarea"),
  "#field-tags": createMockElement("input"),
  "#field-status": createMockElement("select"),
  "#meanings": createMockElement("div"),
  "#examples": createMockElement("div"),
  "#dict-raw-view": createMockElement("div"),
  "#dict-actions-bar": createMockElement("div"),
  "#btn-copy-raw-dict": createMockElement("button"),
  "#btn-toggle-full-dict": createMockElement("button"),
  "#card-preview-section": createMockElement("div"),
  "#card-preview-container": createMockElement("div"),
  "#card-preview-card": createMockElement("div"),
  "#preview-tab-front": createMockElement("button"),
  "#preview-tab-back": createMockElement("button"),
  "#status": createMockElement("div"),
  "#detailsSection": createMockElement("div"),
};

const mockDocument = {
  addEventListener: () => {},
  querySelector(selector) {
    if (mockElements[selector]) return mockElements[selector];
    const el = createMockElement("div");
    mockElements[selector] = el;
    return el;
  },
  querySelectorAll(selector) {
    return [this.querySelector(selector)];
  },
  getElementById(id) {
    return this.querySelector("#" + id);
  },
  createElement(tag) {
    return createMockElement(tag);
  },
  createTextNode(text) {
    return createTextNode(text);
  },
  documentElement: {
    style: {
      setProperty: () => {},
    },
  },
};

const mockWindow = {
  document: mockDocument,
  navigator: {
    clipboard: {
      writeText: async () => {},
    },
  },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  confirm: () => true,
};

class MockEvent {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles || false;
  }
}

const context = vm.createContext({
  window: mockWindow,
  document: mockDocument,
  navigator: mockWindow.navigator,
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Event: MockEvent,
  CustomEvent: MockEvent,
  URL: global.URL,
  chrome: {
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: async () => ({}),
    },
    storage: {
      local: {
        get: (_k, cb) => cb({}),
        set: (_d, cb) => cb && cb(),
      },
    },
  },
});

const sidepanelCode = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");
vm.runInContext(sidepanelCode, context);

console.log("PASS: sidepanel.js loaded in test context.");

// 3. Test formatKunyomi
{
  const formatKunyomi = context.formatKunyomi;
  assert.equal(formatKunyomi("あ.う"), "あ(う)", "formatKunyomi should format okurigana dot to parentheses");
  assert.equal(formatKunyomi("-あ.わせる"), "-あ(わせる)", "formatKunyomi should preserve prefix hyphen");
  assert.equal(formatKunyomi("あう"), "あう", "formatKunyomi without dot should remain unchanged");
  console.log("PASS: formatKunyomi test passed.");
}

// 4. Test cleanReadingForInput
{
  const cleanReadingForInput = context.cleanReadingForInput;
  assert.equal(cleanReadingForInput("あ(う)"), "あう", "cleanReadingForInput should remove parentheses");
  assert.equal(cleanReadingForInput("-あ(わせる)"), "あわせる", "cleanReadingForInput should remove prefix hyphen and parentheses");
  assert.equal(cleanReadingForInput("ゴウ"), "ゴウ", "cleanReadingForInput katakana should remain intact");
  console.log("PASS: cleanReadingForInput test passed.");
}

// 5. Test renderKanjiCard for isolated kanji (合)
{
  const renderKanjiCard = context.renderKanjiCard;
  const kanjiSample = {
    character: "合",
    dictionary: "KANJIDIC",
    onyomi: ["ゴウ", "ガッ", "カッ"],
    kunyomi: ["あ.う", "-あ.わせる"],
    nanori: ["あい"],
    meanings: ["fit", "suit", "join"],
    tags: ["常用", "jlpt-n4"],
    stats: { strokes: "6", grade: "2", jlpt: "N4", freq: "41" },
  };

  const card = renderKanjiCard(kanjiSample, true);
  assert.ok(card.classList.contains("study-kanji-card"), "card has study-kanji-card class");
  assert.ok(card.classList.contains("prominent"), "prominent class added when isProminent=true");

  const charEl = findByClass(card, "study-kanji-character");
  assert.equal(charEl.textContent, "合", "Kanji character rendered");

  const dictEl = findByClass(card, "study-kanji-dict");
  assert.equal(dictEl.textContent, "KANJIDIC", "Dictionary name rendered");

  const onyomiPills = findAllByClass(card, "pill-onyomi");
  assert.equal(onyomiPills.length, 3, "3 onyomi pills rendered");
  assert.equal(onyomiPills[0].textContent, "ゴウ");
  assert.equal(onyomiPills[1].textContent, "ガッ");
  assert.equal(onyomiPills[2].textContent, "カッ");

  const kunyomiPills = findAllByClass(card, "pill-kunyomi");
  assert.equal(kunyomiPills.length, 2, "2 kunyomi pills rendered");
  assert.equal(kunyomiPills[0].textContent, "あ(う)");
  assert.equal(kunyomiPills[1].textContent, "-あ(わせる)");

  const statBadges = findAllByClass(card, "kanji-stat-badge");
  assert.ok(statBadges.some(b => b.textContent.includes("6 strokes")), "Strokes stat rendered");
  assert.ok(statBadges.some(b => b.textContent.includes("JLPT N4")), "Modern JLPT stat rendered from tags");

  // Verify historical KANJIDIC level 4 renders as 'Old JLPT 4' when modern tags absent
  const oldKanjiSample = {
    character: "合",
    dictionary: "KANJIDIC",
    stats: { strokes: "6", jlpt: "4" },
  };
  const oldCard = renderKanjiCard(oldKanjiSample, false);
  const oldBadges = findAllByClass(oldCard, "kanji-stat-badge");
  assert.ok(oldBadges.some(b => b.textContent === "Old JLPT 4"), "Historical KANJIDIC level 4 must be rendered as Old JLPT 4");
  assert.ok(!oldBadges.some(b => b.textContent === "JLPT N4"), "Must NOT render old JLPT 4 as modern JLPT N4");

  // Test reading pill click
  const readingField = mockElements["#field-reading"];
  onyomiPills[0].dispatchEvent("click");
  assert.equal(readingField.value, "ゴウ", "Clicking Onyomi pill sets #field-reading");

  kunyomiPills[0].dispatchEvent("click");
  assert.equal(readingField.value, "あう", "Clicking Kunyomi pill sets #field-reading with clean reading");

  // Test Quick-Insert Meaning button
  const meaningField = mockElements["#field-meaning"];
  meaningField.value = "";
  const insertBtn = findByClass(card, "btn-kanji-insert");
  assert.ok(insertBtn, "Insert button exists");
  insertBtn.dispatchEvent("click");
  assert.equal(meaningField.value, "fit, suit, join", "Insert button copies glosses into card meaning");

  // Test consolidated options parameter
  const compactCard = renderKanjiCard(kanjiSample, { mode: "compact" });
  assert.ok(compactCard.classList.contains("kn-kanji-card"), "compact mode renders kn-kanji-card");
  assert.equal(findByClass(compactCard, "kn-kanji-char").textContent, "合");
  assert.equal(findByClass(compactCard, "kn-onyomi").textContent, "ゴウ, ガッ, カッ");
  assert.equal(findByClass(compactCard, "kn-kunyomi").textContent, "あ(う), -あ(わせる)");

  const fullProminentCard = renderKanjiCard(kanjiSample, { mode: "full", isProminent: true });
  assert.ok(fullProminentCard.classList.contains("study-kanji-card"));
  assert.ok(fullProminentCard.classList.contains("prominent"));

  const renderPreviewKanjiCard = context.renderPreviewKanjiCard;
  assert.ok(typeof renderPreviewKanjiCard === "function", "renderPreviewKanjiCard alias exists");
  const aliasCard = renderPreviewKanjiCard(kanjiSample);
  assert.ok(aliasCard.classList.contains("kn-kanji-card"), "renderPreviewKanjiCard alias produces compact card");

  console.log("PASS: renderKanjiCard isolated test passed.");
}

// 6. Test renderDetails with isolated kanji vs multi-kanji vocabulary
{
  const renderDetails = context.renderDetails;
  const meaningsContainer = mockElements["#meanings"];

  // Case A: Isolated Kanji '合'
  const isolatedKanjiPayload = {
    term: {
      expression: "合",
      reading: "ごう",
      meaning: "volume unit; 0.18 liters",
      entries: [
        {
          dictionary: "Jitendex",
          reading: "ごう",
          glosses: ["0.18 liters"],
          senses: [{ glosses: ["0.18 liters"] }],
        }
      ],
      kanji_entries: [
        {
          character: "合",
          dictionary: "KANJIDIC",
          onyomi: ["ゴウ", "ガッ", "カッ"],
          kunyomi: ["あ.う", "-あ.わせる"],
          meanings: ["fit", "suit", "join"],
          stats: { strokes: "6", jlpt: "N4" }
        }
      ]
    }
  };

  renderDetails(isolatedKanjiPayload);
  const prominentCard = findByClass(meaningsContainer, "study-kanji-card");
  assert.ok(prominentCard, "Isolated kanji renders prominent kanji card in details container");

  // Case B: Multi-character vocabulary '食べる'
  const vocabPayload = {
    term: {
      expression: "食べる",
      reading: "たべる",
      meaning: "to eat",
      entries: [
        {
          dictionary: "Jitendex",
          reading: "たべる",
          glosses: ["to eat"],
          senses: [{ glosses: ["to eat"] }],
        }
      ],
      kanji_entries: [
        {
          character: "食",
          dictionary: "KANJIDIC",
          onyomi: ["ショク", "ジキ"],
          kunyomi: ["く.う", "た.べる", "は.む"],
          meanings: ["eat", "food"],
          stats: { strokes: "9", jlpt: "N5" }
        }
      ]
    }
  };

  renderDetails(vocabPayload);
  const accordion = findByClass(meaningsContainer, "study-kanji-accordion");
  assert.ok(accordion, "Multi-character vocabulary renders progressive disclosure accordion");
  const accordionSummary = findByClass(accordion, "study-kanji-summary");
  assert.ok(accordionSummary.textContent.includes("Kanji in this word (1)"), "Accordion displays kanji count");

  console.log("PASS: renderDetails isolated and vocabulary tests passed.");
}

// 7. Test formatRawDictionaryText with kanji entries
{
  const formatRawDictionaryText = context.formatRawDictionaryText;
  const entries = [
    {
      dictionary: "Jitendex",
      reading: "ごう",
      glosses: ["0.18 liters"],
    }
  ];
  const kanjiEntries = [
    {
      character: "合",
      dictionary: "KANJIDIC",
      onyomi: ["ゴウ", "ガッ"],
      kunyomi: ["あ.う"],
      meanings: ["fit", "suit"],
      stats: { strokes: "6" }
    }
  ];

  const rawText = formatRawDictionaryText(entries, kanjiEntries);
  assert.ok(rawText.includes("=== Kanji: 合 [KANJIDIC] ==="), "Raw text includes kanji section header");
  assert.ok(rawText.includes("Onyomi: ゴウ, ガッ"), "Raw text includes Onyomi readings");
  assert.ok(rawText.includes("Kunyomi: あ(う)"), "Raw text includes Kunyomi readings");
  assert.ok(rawText.includes("Meanings: fit, suit"), "Raw text includes Kanji meanings");
  assert.ok(rawText.includes("=== Jitendex ==="), "Raw text preserves vocabulary entries");

  console.log("PASS: formatRawDictionaryText test passed.");
}

console.log("\nALL KANJI RENDERING EXTENSION TESTS PASSED SUCCESSFULLY!");
