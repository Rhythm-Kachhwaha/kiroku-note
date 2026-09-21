const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 1. Verify HTML DOM elements
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

assert.ok(html.includes('id="dict-actions-bar"'), "dict-actions-bar element must exist in sidepanel.html");
assert.ok(html.includes('id="btn-copy-raw-dict"'), "btn-copy-raw-dict button must exist in sidepanel.html");
assert.ok(!html.includes('id="btn-toggle-full-dict"'), "btn-toggle-full-dict button retired from sidepanel.html");
assert.ok(!html.includes('id="dict-raw-view"'), "dict-raw-view container retired from sidepanel.html");
assert.ok(html.includes('id="meanings"'), "meanings container must exist in sidepanel.html");

console.log("PASS: Dictionary HTML DOM structure verified.");

// 2. DOM Mocking Infrastructure
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
    _listeners: {},
    classList: {
      _classes: new Set(),
      add(...classes) { classes.forEach(c => this._classes.add(c)); },
      remove(...classes) { classes.forEach(c => this._classes.delete(c)); },
      contains(c) { return this._classes.has(c); },
    },
    append(...els) {
      for (const el of els) {
        if (el && el.nodeType === 11) {
          this.children.push(...el.children);
        } else if (el) {
          this.children.push(el);
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

function findAllByTag(el, tagName) {
  return findAll(el, c => c.tagName === tagName.toUpperCase());
}

const mockMeanings = createMockElement("div");
const mockDictRawView = createMockElement("div");
const mockDictActionsBar = createMockElement("div");
const mockBtnCopy = createMockElement("button");
const mockBtnToggle = createMockElement("button");
const mockExamples = createMockElement("div");

// Editor field mocks
const mockFieldMeaning = createMockElement("textarea");
const mockFieldExampleSentence = createMockElement("textarea");
const mockFieldExampleTranslation = createMockElement("textarea");
const mockFieldExpression = createMockElement("input");
const mockFieldCardId = createMockElement("input");
const mockSaveBadge = createMockElement("span");
const mockOptionalFields = createMockElement("div");
mockOptionalFields.hidden = true;
const mockToggleOptionalBtn = createMockElement("button");
const identifiedCalls = [];

let mockConfirmResponse = true;
let mockConfirmCalls = [];
const mockWindow = {
  confirm(msg) {
    mockConfirmCalls.push(msg);
    return mockConfirmResponse;
  },
};

const mockDocument = {
  createElement(tag) {
    return createMockElement(tag);
  },
  createTextNode(text) {
    return createTextNode(text);
  },
  createDocumentFragment() {
    return {
      nodeType: 11,
      children: [],
      append(...nodes) {
        for (const node of nodes) {
          if (node && node.nodeType === 11) {
            this.children.push(...node.children);
          } else if (node) {
            this.children.push(node);
          }
        }
      },
    };
  },
  querySelector(selector) {
    if (selector === "#meanings") return mockMeanings;
    if (selector === "#dict-raw-view") return mockDictRawView;
    if (selector === "#dict-actions-bar") return mockDictActionsBar;
    if (selector === "#btn-copy-raw-dict") return mockBtnCopy;
    if (selector === "#btn-toggle-full-dict") return mockBtnToggle;
    if (selector === "#examples") return mockExamples;
    if (selector === "#field-meaning") return mockFieldMeaning;
    if (selector === "#field-example-sentence") return mockFieldExampleSentence;
    if (selector === "#field-example-translation") return mockFieldExampleTranslation;
    if (selector === "#optional-fields") return mockOptionalFields;
    if (selector === "#toggle-optional") return mockToggleOptionalBtn;
    return createMockElement("div");
  },
};

global.document = mockDocument;

let copiedClipboardText = "";
const mockNavigator = {
  clipboard: {
    writeText: async (text) => {
      copiedClipboardText = text;
      return true;
    },
  },
};

class MockEvent {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles || false;
  }
}

const sandbox = {
  document: mockDocument,
  window: mockWindow,
  navigator: mockNavigator,
  Event: MockEvent,
  meanings: mockMeanings,
  dictRawView: mockDictRawView,
  dictActionsBar: mockDictActionsBar,
  btnCopyRawDict: mockBtnCopy,
  btnToggleFullDict: mockBtnToggle,
  examples: mockExamples,
  fieldMeaning: mockFieldMeaning,
  fieldExampleSentence: mockFieldExampleSentence,
  fieldExampleTranslation: mockFieldExampleTranslation,
  fieldExpression: mockFieldExpression,
  fieldCardId: mockFieldCardId,
  saveBadge: mockSaveBadge,
  identify: (text) => { identifiedCalls.push(text); },
  optionalFields: mockOptionalFields,
  toggleOptionalBtn: mockToggleOptionalBtn,
  currentDictionaryEntries: [],
  YomitanReferenceRenderer: require("../lib/yomitan-reference-renderer.js"),
  setTimeout: (fn, ms) => {},
  console,
};
mockWindow.YomitanReferenceRenderer = sandbox.YomitanReferenceRenderer;

// Load dictionary logic functions from sidepanel.js
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

const dictCodeSlice = jsContent.slice(
  jsContent.indexOf("function add(parent"),
  jsContent.indexOf("async function identify(text)")
);

vm.runInNewContext(dictCodeSlice, sandbox);

const { formatRawDictionaryText, renderDetails, clearDictionaryView } = sandbox;

// ==========================================
// 3. Stage 3B.3.1a Baseline Tests
// ==========================================

console.log("Testing Single-Sense Entry...");
renderDetails({
  entries: [
    {
      dictionary: "Jitendex",
      is_primary: true,
      term: "映画",
      reading: "えいが",
      parts_of_speech: ["noun"],
      tags: ["common"],
      senses: [
        {
          index: 1,
          glosses: ["movie", "film"],
          parts_of_speech: ["noun"],
          tags: ["common"],
          notes: ["standard term"],
          examples: [],
        },
      ],
    },
  ],
});

const header1 = findByClass(mockMeanings, "study-dict-header");
assert.ok(header1, "Header should exist for single-sense entry");
const dictPill1 = findByClass(header1, "dict-source-pill");
assert.equal(dictPill1.textContent, "Jitendex", "Dict source pill should show Jitendex");
const sensesList1 = findByClass(mockMeanings, "study-senses-list");
assert.ok(sensesList1, "Senses list should exist");
assert.equal(sensesList1.children.length, 1, "Should have exactly 1 sense item");
const glosses1 = findByClass(sensesList1, "study-glosses");
assert.equal(glosses1.textContent, "movie; film", "Glosses should be joined with semicolon");
console.log("PASS: Single-sense entry verified.");

console.log("Testing Multi-Sense Entry & Sense Ordering...");
renderDetails({
  entries: [
    {
      dictionary: "Jitendex",
      is_primary: true,
      term: "食べる",
      reading: "たべる",
      senses: [
        { index: 1, glosses: ["to eat", "to consume"], parts_of_speech: ["1-dan verb", "transitive"], tags: [] },
        { index: 2, glosses: ["to live on", "to make a living"], parts_of_speech: ["1-dan verb", "transitive"], tags: [] },
        { index: 3, glosses: ["to bite"], parts_of_speech: ["1-dan verb"], tags: ["colloquial"] },
      ],
    },
  ],
});

const sensesList2 = findByClass(mockMeanings, "study-senses-list");
assert.ok(sensesList2, "Senses list should exist");
assert.equal(sensesList2.children.length, 3, "Should render all 3 senses");
const glossesList2 = findAllByClass(sensesList2, "study-glosses");
assert.equal(glossesList2[0].textContent, "to eat; to consume", "Sense 1 gloss preserved");
assert.equal(glossesList2[1].textContent, "to live on; to make a living", "Sense 2 gloss preserved");
assert.equal(glossesList2[2].textContent, "to bite", "Sense 3 gloss preserved");
const numList2 = findAllByClass(sensesList2, "study-sense-num");
assert.equal(numList2[0].textContent, "1.", "Sense 1 number");
assert.equal(numList2[1].textContent, "2.", "Sense 2 number");
assert.equal(numList2[2].textContent, "3.", "Sense 3 number");
console.log("PASS: Multi-sense entry & ordering verified.");

console.log("Testing Sense-Bound POS & Tags...");
renderDetails({
  entries: [
    {
      dictionary: "Jitendex",
      term: "掛ける",
      senses: [
        { index: 1, glosses: ["to hang up"], parts_of_speech: ["1-dan verb", "transitive"], tags: ["common"] },
        { index: 2, glosses: ["to multiply"], parts_of_speech: ["1-dan verb", "transitive"], tags: ["math"] },
        { index: 3, glosses: ["suffix meaning to start"], parts_of_speech: ["suffix"], tags: [] },
      ],
    },
  ],
});

const senseItems3 = findAllByClass(mockMeanings, "study-sense-item");
assert.equal(senseItems3.length, 3);
const sense1Pos = findAllByClass(senseItems3[0], "study-sense-pos");
assert.ok(sense1Pos.some(p => p.textContent === "1-dan verb"), "Sense 1 has 1-dan verb POS");
assert.ok(sense1Pos.some(p => p.textContent === "transitive"), "Sense 1 has transitive POS");
const sense3Pos = findAllByClass(senseItems3[2], "study-sense-pos");
assert.ok(sense3Pos.some(p => p.textContent === "suffix"), "Sense 3 has suffix POS");
assert.ok(!sense3Pos.some(p => p.textContent === "1-dan verb"), "Sense 3 does NOT have 1-dan verb POS");
const sense2Tags = findAllByClass(senseItems3[1], "study-sense-tag");
assert.ok(sense2Tags.some(t => t.textContent === "math"), "Sense 2 has math tag");
console.log("PASS: Sense-bound POS and tags verified.");

console.log("Testing Linguistic Metadata (Pitch, Frequency, JLPT)...");
renderDetails({
  jlpt_level: "N5",
  entries: [
    {
      dictionary: "Jitendex",
      term: "食べる",
      reading: "たべる",
      pitches: [{ reading: "たべる", position: 2, pattern_name: "nakadaka" }],
      frequencies: [{ dictionary: "Netflix", rank: 180 }, { dictionary: "BCCWJ", display_value: "320" }],
      senses: [{ index: 1, glosses: ["to eat"] }],
    },
  ],
});

const pitchPills = findAllByClass(mockMeanings, "pill-pitch");
assert.equal(pitchPills.length, 1);
assert.equal(pitchPills[0].textContent, "② Nakadaka");

const freqPills = findAllByClass(mockMeanings, "pill-freq");
assert.equal(freqPills.length, 2);
assert.equal(freqPills[0].textContent, "Netflix #180");
assert.equal(freqPills[1].textContent, "BCCWJ #320");

const jlptPills = findAllByClass(mockMeanings, "pill-jlpt");
assert.equal(jlptPills.length, 1);
assert.equal(jlptPills[0].textContent, "JLPT N5");
console.log("PASS: Linguistic metadata verified.");

console.log("Testing Ruby Furigana DOM Construction...");
renderDetails({
  entries: [
    {
      dictionary: "Jitendex",
      term: "食べる",
      senses: [
        {
          index: 1,
          glosses: ["to eat"],
          examples: [
            {
              japanese: "朝ご飯を食べる。",
              reading: "朝[あさ]御[ご]飯[はん]を食[た]べる。",
              translation: "To eat breakfast.",
            },
          ],
        },
      ],
    },
  ],
});

const rubyJaEl = findByClass(mockMeanings, "study-example-ja");
assert.ok(rubyJaEl, "Example Japanese element should exist");
const rubyTags = findAllByTag(rubyJaEl, "ruby");
assert.equal(rubyTags.length, 4, "Should create 4 <ruby> elements for 朝, 御, 飯, 食");
const rtTags = findAllByTag(rubyJaEl, "rt");
assert.equal(rtTags.length, 4, "Should create 4 <rt> elements");
assert.equal(rtTags[0].textContent, "あさ");
assert.equal(rtTags[1].textContent, "ご");
assert.equal(rtTags[2].textContent, "はん");
assert.equal(rtTags[3].textContent, "た");
console.log("PASS: Ruby furigana DOM construction verified.");

// ==========================================
// 4. Stage 3B.3.1b Quick-Insert Actions Tests
// ==========================================

console.log("Testing Quick-Insert Sense Action...");
renderDetails({
  entries: [
    {
      dictionary: "Jitendex",
      term: "食べる",
      senses: [
        { index: 1, glosses: ["to eat", "to consume"] },
        { index: 2, glosses: ["to live on", "to make a living"] },
      ],
    },
  ],
});

const senseItemsInsert = findAllByClass(mockMeanings, "study-sense-item");
const insertBtnSense1 = findByClass(senseItemsInsert[0], "btn-sense-insert");
assert.ok(insertBtnSense1, "Sense 1 must have an insert button");
const insertBtnSense2 = findByClass(senseItemsInsert[1], "btn-sense-insert");
assert.ok(insertBtnSense2, "Sense 2 must have an insert button");

// 1. Insert into empty meaning field
mockFieldMeaning.value = "";
insertBtnSense1.onclick();
assert.equal(mockFieldMeaning.value, "to eat; to consume", "Clicking Insert on Sense 1 populates #field-meaning");

// 2. Insert Sense 2 into populated meaning field with inline confirmation
insertBtnSense2.onclick();
assert.equal(insertBtnSense2.classList.contains("confirm-replace"), true, "First click activates confirm-replace state");
assert.equal(mockFieldMeaning.value, "to eat; to consume", "Meaning field not modified until confirmed");

insertBtnSense2.onclick();
assert.equal(insertBtnSense2.classList.contains("confirm-replace"), false, "Second click clears confirm-replace state");
assert.equal(mockFieldMeaning.value, "to live on; to make a living", "Sense 2 glosses replace meaning when confirmed");

// 3. User does not confirm (single click on another button) - meaning should remain unchanged
insertBtnSense1.onclick();
assert.equal(insertBtnSense1.classList.contains("confirm-replace"), true, "First click enters confirm-replace state");
assert.equal(mockFieldMeaning.value, "to live on; to make a living", "Meaning was preserved without second confirming click");
insertBtnSense1.classList.remove("confirm-replace");
console.log("PASS: Quick-Insert Sense action & overwrite protection verified.");

console.log("Testing Quick-Insert Example Action...");
renderDetails({
  entries: [
    {
      dictionary: "Jitendex",
      term: "映画",
      senses: [
        {
          index: 1,
          glosses: ["movie"],
          examples: [
            { japanese: "映画を見る", translation: "to watch a movie" },
          ],
        },
      ],
    },
  ],
});

const exampleCard = findByClass(mockMeanings, "study-example-card");
assert.ok(exampleCard, "Example card should exist");
const insertBtnExample = findByClass(exampleCard, "btn-example-insert");
assert.ok(insertBtnExample, "Example must have an insert button");

mockFieldExampleSentence.value = "";
mockFieldExampleTranslation.value = "";
mockOptionalFields.hidden = true;

insertBtnExample.onclick();
assert.equal(mockFieldExampleSentence.value, "映画を見る", "Example sentence populated in #field-example-sentence");
assert.equal(mockFieldExampleTranslation.value, "to watch a movie", "Example translation populated in #field-example-translation");
assert.equal(mockOptionalFields.hidden, false, "Optional fields expanded after example insert");

// Example overwrite protection test
mockFieldExampleSentence.value = "User custom sentence";
insertBtnExample.onclick();
assert.equal(insertBtnExample.classList.contains("confirm-replace"), true, "First click enters confirm-replace state");
assert.equal(mockFieldExampleSentence.value, "User custom sentence", "Sentence preserved before second confirming click");

insertBtnExample.onclick();
assert.equal(insertBtnExample.classList.contains("confirm-replace"), false, "Second click clears confirm-replace state");
assert.equal(mockFieldExampleSentence.value, "映画を見る", "Sentence updated when user confirmed with second click");
console.log("PASS: Quick-Insert Example action & overwrite protection verified.");

// ==========================================
// 5. Stage 3B.3.1b Progressive Disclosure Tests
// ==========================================

console.log("Testing Progressive Disclosure: <= 4 senses (No Accordion)...");
renderDetails({
  entries: [
    {
      dictionary: "Jitendex",
      term: "テスト",
      senses: [
        { index: 1, glosses: ["sense 1"] },
        { index: 2, glosses: ["sense 2"] },
        { index: 3, glosses: ["sense 3"] },
        { index: 4, glosses: ["sense 4"] },
      ],
    },
  ],
});

const overflowAccordion4 = findByClass(mockMeanings, "senses-overflow-accordion");
assert.equal(overflowAccordion4, null, "Words with <= 4 senses should NOT have an overflow accordion");
const renderedItems4 = findAllByClass(mockMeanings, "study-sense-item");
assert.equal(renderedItems4.length, 4, "All 4 senses rendered directly in primary list");
console.log("PASS: <= 4 senses render directly without accordion.");

console.log("Testing Progressive Disclosure: > 4 senses (e.g. 5 senses & 25 senses)...");
// Test 5 senses (boundary condition: 4 primary + 1 overflow)
renderDetails({
  entries: [
    {
      dictionary: "Jitendex",
      term: "五",
      senses: [
        { index: 1, glosses: ["sense 1"] },
        { index: 2, glosses: ["sense 2"] },
        { index: 3, glosses: ["sense 3"] },
        { index: 4, glosses: ["sense 4"] },
        { index: 5, glosses: ["sense 5"] },
      ],
    },
  ],
});

const overflowAccordion5 = findByClass(mockMeanings, "senses-overflow-accordion");
assert.ok(overflowAccordion5, "Words with > 4 senses must have an overflow accordion");
const summary5 = findByClass(overflowAccordion5, "senses-overflow-summary");
assert.ok(summary5, "Overflow summary must exist");
assert.equal(summary5.textContent, "Show 1 more sense...", "Singular '1 more sense' formatted correctly");

// Test 25 senses (掛ける benchmark)
const polysemousSenses = Array.from({ length: 25 }, (_, i) => ({
  index: i + 1,
  glosses: [`meaning ${i + 1}`],
  parts_of_speech: i % 2 === 0 ? ["1-dan verb", "transitive"] : ["noun"],
  tags: i === 7 ? ["math"] : [],
}));

renderDetails({
  entries: [
    {
      dictionary: "Jitendex",
      is_primary: true,
      term: "掛ける",
      reading: "かける",
      senses: polysemousSenses,
    },
  ],
});

const primaryList25 = findByClass(mockMeanings, "study-senses-list");
assert.equal(primaryList25.children.length, 4, "First 4 senses in primary list");

const overflowAccordion25 = findByClass(mockMeanings, "senses-overflow-accordion");
assert.ok(overflowAccordion25, "Overflow accordion exists for 25 senses");
const summary25 = findByClass(overflowAccordion25, "senses-overflow-summary");
assert.equal(summary25.textContent, "Show 21 more senses...", "Summary communicates 21 remaining senses");

const overflowList25 = findByClass(overflowAccordion25, "senses-overflow-list");
assert.ok(overflowList25, "Overflow list exists inside accordion");
assert.equal(overflowList25.children.length, 21, "Remaining 21 senses are in overflow list");

// Verify sense numbers and order in both lists
const allSenseItems = findAllByClass(mockMeanings, "study-sense-item");
assert.equal(allSenseItems.length, 25, "Total 25 sense items rendered across primary and overflow lists");
allSenseItems.forEach((sEl, idx) => {
  const numEl = findByClass(sEl, "study-sense-num");
  assert.equal(numEl.textContent, `${idx + 1}.`, `Sense ${idx + 1} numbering preserved`);
  const glossEl = findByClass(sEl, "study-glosses");
  assert.equal(glossEl.textContent, `meaning ${idx + 1}`, `Sense ${idx + 1} gloss preserved`);
  const insertBtn = findByClass(sEl, "btn-sense-insert");
  assert.ok(insertBtn, `Sense ${idx + 1} has insert button`);
});

// Test expand/collapse toggle interaction
overflowAccordion25.open = true;
overflowAccordion25.dispatchEvent(new MockEvent("toggle"));
assert.equal(summary25.textContent, "Show fewer senses", "Summary updates to 'Show fewer senses' when expanded");

overflowAccordion25.open = false;
overflowAccordion25.dispatchEvent(new MockEvent("toggle"));
assert.equal(summary25.textContent, "Show 21 more senses...", "Summary reverts to 'Show 21 more senses...' when collapsed");

console.log("PASS: Progressive disclosure (> 4 senses) and expand/collapse verified.");

// ==========================================
// 6. Raw View Preservation & Actions
// ==========================================

console.log("Testing Raw View Preservation...");
const sampleEntries = [
  {
    dictionary: "Jitendex",
    is_primary: true,
    term: "映画",
    reading: "えいが",
    parts_of_speech: ["noun"],
    tags: ["common"],
    senses: [
      {
        glosses: ["movie", "film"],
        tags: [],
        notes: ["standard term"],
        examples: [
          { japanese: "映画を見る", translation: "to watch a movie" },
        ],
      },
    ],
  },
  {
    dictionary: "JMdict",
    is_primary: false,
    term: "映画",
    reading: "えいが",
    parts_of_speech: ["noun"],
    tags: [],
    senses: [
      {
        glosses: ["motion picture", "picture"],
        tags: [],
        notes: [],
        examples: [],
      },
    ],
  },
];

const formatted = formatRawDictionaryText(sampleEntries);
assert.ok(formatted.includes("=== Jitendex (Primary) ==="), "Formatted text must include primary dictionary header");
assert.ok(formatted.includes("Term: 映画 [えいが]"), "Formatted text must include term and reading");
assert.ok(formatted.includes("POS: noun"), "Formatted text must include POS");
assert.ok(formatted.includes("1. movie; film"), "Formatted text must include glosses");
assert.ok(formatted.includes("映画を見る : to watch a movie"), "Formatted text must include example sentence");
assert.ok(formatted.includes("=== JMdict ==="), "Formatted text must include second dictionary");

renderDetails({ entries: sampleEntries });
assert.equal(mockDictActionsBar.style.display, "flex", "dict-actions-bar displayed");

// Test copy button (preserves access to raw dictionary text without dedicated raw view)
mockBtnCopy.onclick();
assert.ok(copiedClipboardText.includes("=== Jitendex (Primary) ==="), "Copy button wrote raw text to clipboard");

// Test clear
clearDictionaryView();
assert.equal(mockMeanings.children.length, 0, "meanings empty after clear");
assert.equal(mockDictActionsBar.style.display, "none", "dictActionsBar hidden after clear");
console.log("PASS: Raw text copy action & clear verified.");

// ==========================================
// Test Cross-Reference Chips & Draft Safety
// ==========================================
console.log("Testing Cross-Reference Chips & Draft Safety...");
identifiedCalls.length = 0;
mockFieldExpression.value = "";
mockFieldCardId.value = "";
mockSaveBadge.hidden = true;
mockSaveBadge.textContent = "";

const xrefEntries = [
  {
    dictionary: "Jitendex",
    is_primary: true,
    term: "合",
    reading: "ごう",
    parts_of_speech: ["noun"],
    tags: [],
    senses: [
      {
        glosses: ["conjunction (astronomy)"],
        tags: [],
        notes: [],
        examples: [],
        cross_references: [
          {
            target_term: "衝",
            target_reading: "しょう",
            label: "See also",
            gloss_summary: "③ opposition",
            display_text: "See also 衝 (しょう) ③ opposition",
          },
        ],
      },
    ],
  },
];

renderDetails({ entries: xrefEntries });
const xrefContainer = findByClass(mockMeanings, "study-sense-xrefs");
assert.ok(xrefContainer, "study-sense-xrefs container must be rendered");
const xrefChips = findAllByClass(mockMeanings, "study-xref-chip");
assert.equal(xrefChips.length, 1, "Must render exactly 1 cross-reference chip");
assert.equal(xrefChips[0].textContent, "See also 衝 (しょう) ③ opposition");
assert.equal(xrefChips[0].title, "Look up: 衝");

// Case 1: Clean draft (no card expression in editor) -> immediate lookup
xrefChips[0].onclick();
assert.equal(identifiedCalls.length, 1, "Immediate identify call when draft is clean");
assert.equal(identifiedCalls[0], "衝", "Identified target term must be 衝");
assert.ok(!xrefChips[0].classList.contains("confirm-replace"), "confirm-replace not added on clean draft");

// Case 2: Dirty draft (expression present, card unsaved) -> requires confirmation
identifiedCalls.length = 0;
mockFieldExpression.value = "合";
mockFieldCardId.value = ""; // unsaved
mockSaveBadge.hidden = true;

// 1st click on dirty draft -> prompts for replacement confirmation
xrefChips[0].onclick();
assert.equal(identifiedCalls.length, 0, "Must NOT call identify on first click when draft is dirty");
assert.ok(xrefChips[0].classList.contains("confirm-replace"), "Must add confirm-replace class");
assert.equal(xrefChips[0].textContent, "Replace?");

// 2nd click while confirm-replace is active -> confirms replacement and triggers identify
xrefChips[0].onclick();
assert.equal(identifiedCalls.length, 1, "Must call identify on second click");
assert.equal(identifiedCalls[0], "衝");
assert.ok(!xrefChips[0].classList.contains("confirm-replace"), "confirm-replace removed after confirmed action");

console.log("PASS: Cross-reference chips & draft safety verified.");

// 12. Multi-Dictionary Separate Display & Preserved Order
console.log("Testing Multi-Dictionary Separate Display & Order...");
clearDictionaryView();

const multiDictPayload = {
  expression: "食べる",
  reading: "たべる",
  entries: [
    {
      dictionary: "Jitendex.org",
      is_primary: true,
      term: "食べる",
      reading: "たべる",
      parts_of_speech: ["v1", "transitive"],
      senses: [{ index: 1, glosses: ["to eat"] }],
      raw_content: [
        {
          type: "structured-content",
          content: [
            { tag: "div", content: "1. to eat (Jitendex definition)" },
          ],
        },
      ],
    },
    {
      dictionary: "Daijirin",
      is_primary: false,
      term: "食べる",
      reading: "たべる",
      parts_of_speech: ["他下一"],
      senses: [{ index: 1, glosses: ["食物を口から体内に入れる。"] }],
      raw_content: [
        {
          type: "structured-content",
          content: [
            { tag: "div", content: "食物を口から体内に入れる。(Daijirin monolingual)" },
          ],
        },
      ],
    },
    {
      dictionary: "JMdict (English)",
      is_primary: false,
      term: "食べる",
      reading: "たべる",
      parts_of_speech: ["Ichidan verb"],
      senses: [{ index: 1, glosses: ["to eat; to consume"] }],
      raw_content: [
        {
          type: "structured-content",
          content: [
            { tag: "div", content: "to eat; to consume (JMdict)" },
          ],
        },
      ],
    },
  ],
};

renderDetails(multiDictPayload);

const allDictEntries = findAll(mockMeanings, (el) => el.classList && el.classList.contains("study-entry"));
assert.equal(allDictEntries.length, 3, "All 3 dictionaries must be rendered separately");

// Verify dictionary sources and order preserved
const dictPills = findAll(mockMeanings, (el) => el.classList && el.classList.contains("dict-source-pill"));
assert.equal(dictPills.length, 3, "Exactly 3 dictionary source pills rendered");
assert.equal(dictPills[0].textContent, "Jitendex.org", "First dictionary must be Jitendex.org");
assert.equal(dictPills[1].textContent, "Daijirin", "Second dictionary must be Daijirin");
assert.equal(dictPills[2].textContent, "JMdict (English)", "Third dictionary must be JMdict (English)");

// Verify primary dictionary is open, secondary dictionaries are collapsible accordions
assert.ok(!allDictEntries[0].classList.contains("dict-entry-accordion"), "Primary entry is standard open card");
assert.ok(allDictEntries[1].classList.contains("dict-entry-accordion"), "Secondary entry 1 is collapsible accordion");
assert.ok(allDictEntries[2].classList.contains("dict-entry-accordion"), "Secondary entry 2 is collapsible accordion");

// Verify structured content rendered
const refContents = findAll(mockMeanings, (el) => el.classList && el.classList.contains("yomitan-reference-content"));
assert.equal(refContents.length, 3, "All 3 entries render rich structured content");
assert.ok(refContents[0].textContent.includes("Jitendex definition"));
assert.ok(refContents[1].textContent.includes("Daijirin monolingual"));

// Verify Word Class / POS labels displayed directly from dictionary
const posBadges = findAll(mockMeanings, (el) => el.classList && el.classList.contains("study-pos-badge"));
const posTexts = posBadges.map(b => b.textContent);
assert.ok(posTexts.includes("v1"), "Jitendex v1 POS badge rendered");
assert.ok(posTexts.includes("transitive"), "Jitendex transitive POS badge rendered");
assert.ok(posTexts.includes("他下一"), "Daijirin 他下一 POS badge rendered without Kiroku POS alteration");

console.log("PASS: Multi-dictionary separate display, ordering & POS labels verified.");

// 13. Independent Scrolling Verification in CSS
console.log("Testing Independent Scrolling CSS tokens...");
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const cssContent = fs.readFileSync(cssPath, "utf8");

assert.ok(cssContent.includes(".dict-study-view {"), ".dict-study-view rule exists in sidepanel.css");
assert.ok(cssContent.includes("max-height: 440px;"), "max-height set for dictionary view");
assert.ok(cssContent.includes("overflow-y: auto;"), "overflow-y auto set for independent scrolling");
assert.ok(cssContent.includes("overscroll-behavior: contain;"), "overscroll-behavior contain set to isolate scrolling");
console.log("PASS: Independent scrolling CSS rules verified.");

console.log("\n>>> ALL DICTIONARY STUDY VIEW TESTS PASSED! <<<");
