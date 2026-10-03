const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting Front Toggle and Editing Mode Tests...");

// 1. Static HTML Checks
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

assert.ok(html.includes('id="front-toggle-row"'), "#front-toggle-row element must exist in sidepanel.html");
assert.ok(html.includes('id="btn-front-kanji"'), "#btn-front-kanji button must exist in sidepanel.html");
assert.ok(html.includes('id="btn-front-kana"'), "#btn-front-kana button must exist in sidepanel.html");

// Card Fields Section must NOT be hardcoded hidden
assert.ok(!html.includes('id="card-fields-section" hidden'), "#card-fields-section must NOT have hardcoded hidden attribute");
assert.ok(!html.includes('id="card-fields-section" style="display: none;"'), "#card-fields-section must NOT have display: none");
assert.ok(!html.includes('class="form-row-compact" hidden style="display: none;"'), ".form-row-compact must NOT be hidden");
assert.ok(!html.includes('class="meaning-form-group" hidden style="display: none;"'), ".meaning-form-group must NOT be hidden");
assert.ok(!html.includes('class="field-group" hidden style="display: none;"'), ".field-group must NOT be hidden");

console.log("PASS 1: HTML DOM structure and unhidden card-fields-section verified.");

// 2. CSS Rules Checks
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const css = fs.readFileSync(cssPath, "utf8");

assert.ok(css.includes(".front-toggle-row"), ".front-toggle-row rule must exist in sidepanel.css");
assert.ok(css.includes(".btn-front-toggle"), ".btn-front-toggle rule must exist in sidepanel.css");
assert.ok(css.includes(".btn-front-toggle.active"), ".btn-front-toggle.active rule must exist in sidepanel.css");
assert.ok(css.includes(".qa-front-choice-group"), ".qa-front-choice-group rule must exist in sidepanel.css");
assert.ok(css.includes(".qa-choice-pill"), ".qa-choice-pill rule must exist in sidepanel.css");

console.log("PASS 2: CSS styling for front-toggle and quick-add choices verified.");

// 3. Functional Logic Tests via VM sandbox
function createMockElement(tag = "div") {
  const listeners = {};
  const classes = new Set();
  const attrs = {};
  return {
    tagName: tag.toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    value: "",
    _textContent: "",
    get textContent() {
      if (this.children.length > 0) {
        return this.children.map(c => (c.textContent !== undefined ? c.textContent : "")).join("");
      }
      return this._textContent;
    },
    set textContent(val) {
      this._textContent = String(val);
      this.children = [];
    },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classes.has(c)) { classes.delete(c); return false; }
          classes.add(c); return true;
        }
        if (force) { classes.add(c); return true; }
        classes.delete(c); return false;
      },
      contains: (c) => classes.has(c),
    },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return attrs[k] || null; },
    removeAttribute(k) { delete attrs[k]; },
    addEventListener(evt, fn) {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    dispatchEvent(evt) {
      const type = typeof evt === "string" ? evt : evt?.type;
      if (listeners[type]) {
        listeners[type].forEach(fn => fn(evt));
      }
    },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
  };
}

const mockElements = {
  "#front-toggle-row": createMockElement("div"),
  "#btn-front-kanji": createMockElement("button"),
  "#btn-front-kana": createMockElement("button"),
  "#expression": createMockElement("span"),
  "#reading": createMockElement("span"),
  "#field-expression": createMockElement("input"),
  "#field-reading": createMockElement("input"),
  "#field-meaning": createMockElement("textarea"),
  "#field-hint": createMockElement("input"),
  "#field-notes": createMockElement("textarea"),
  "#field-example-sentence": createMockElement("input"),
  "#field-example-translation": createMockElement("input"),
  "#card-preview-card": createMockElement("div"),
  "#preview-edit-toggle": createMockElement("button"),
  "#card-fields-section": createMockElement("section"),
};

const sandbox = {
  document: {
    querySelector: (sel) => mockElements[sel] || createMockElement("div"),
    querySelectorAll: () => [],
    createElement: (tag) => createMockElement(tag),
  },
  window: {},
  console,
  setTimeout: (fn) => fn(),
  clearTimeout: () => {},
  fieldExpression: mockElements["#field-expression"],
  fieldReading: mockElements["#field-reading"],
  expression: mockElements["#expression"],
  wanakana: {
    isKana: (s) => /^[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9f\u30fc\u30fb\s]+$/.test(s),
  },
};

const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

// Slice the helper functions & front toggle logic to test in VM
const codeSlice = jsContent.slice(
  jsContent.indexOf("// 1-Click Card Front Toggle (Kanji vs. Kana)"),
  jsContent.indexOf("// Card preview elements")
);

vm.runInNewContext(codeSlice, sandbox);

const { isKanaOnly, hasKanji, updateFrontToggleUI, setCardFrontPreference } = sandbox;

// 4. Test isKanaOnly & hasKanji
assert.equal(isKanaOnly("たべる"), true, "Hiragana must be kana only");
assert.equal(isKanaOnly("タベル"), true, "Katakana must be kana only");
assert.equal(isKanaOnly("食べる"), false, "Kanji mixed must not be kana only");
assert.equal(isKanaOnly("食"), false, "Single kanji must not be kana only");
assert.equal(isKanaOnly(""), false, "Empty string is not kana only");

assert.equal(hasKanji("食べる"), true, "食べる has kanji");
assert.equal(hasKanji("たべる"), false, "たべる has no kanji");
assert.equal(hasKanji("猫"), true, "猫 has kanji");

console.log("PASS 3: isKanaOnly and hasKanji helpers verified.");

// 5. Test updateFrontToggleUI
const frontRow = mockElements["#front-toggle-row"];
const btnKanji = mockElements["#btn-front-kanji"];
const btnKana = mockElements["#btn-front-kana"];

// When word has Kanji and differing Kana reading, toggle row must be visible
updateFrontToggleUI("食べる", "たべる", "kanji");
assert.equal(frontRow.hidden, false, "Front toggle row must be visible when word has both kanji and kana");
assert.equal(btnKanji.textContent, "漢字 食べる");
assert.equal(btnKana.textContent, "かな たべる");
assert.equal(btnKanji.classList.contains("active"), true);
assert.equal(btnKana.classList.contains("active"), false);

// When word is Kana-only (no Kanji), toggle row must be hidden
updateFrontToggleUI("たべる", "たべる", "kana");
assert.equal(frontRow.hidden, true, "Front toggle row must be hidden when word has no distinct kanji form");

console.log("PASS 4: updateFrontToggleUI visibility and active pill states verified.");

// 6. Test setCardFrontPreference
updateFrontToggleUI("食べる", "たべる", "kanji");
setCardFrontPreference("kana");

const fieldExpr = mockElements["#field-expression"];
const fieldRead = mockElements["#field-reading"];
const heroExpr = mockElements["#expression"];

assert.equal(fieldExpr.value, "たべる", "Switching preference to kana must set fieldExpression to 'たべる'");
assert.equal(fieldRead.value, "たべる", "fieldReading must be 'たべる'");
assert.equal(heroExpr.textContent, "たべる", "Hero expression must be 'たべる'");
assert.equal(btnKana.classList.contains("active"), true, "Kana button must become active");
assert.equal(btnKanji.classList.contains("active"), false, "Kanji button must become inactive");

// Switch back to kanji
setCardFrontPreference("kanji");
assert.equal(fieldExpr.value, "食べる", "Switching preference to kanji must set fieldExpression to '食べる'");
assert.equal(heroExpr.textContent, "食べる", "Hero expression must be '食べる'");
assert.equal(btnKanji.classList.contains("active"), true, "Kanji button must become active");
assert.equal(btnKana.classList.contains("active"), false, "Kana button must become inactive");

console.log("PASS 5: setCardFrontPreference 1-click toggling verified.");

// 7. Test Preview Inline Editing Two-Way Synchronization
const previewEditSlice = jsContent.slice(
  jsContent.indexOf("function handlePreviewInlineEdit(event)"),
  jsContent.indexOf("function reorderPreviewBlocks")
);

const fullContext = {
  ...sandbox,
  isPreviewEditing: true,
  currentPreviewSide: "front",
  currentPreviewPresentation: { front: { text: {} }, back: { text: {} } },
  ensurePreviewContext: () => {},
  getPreviewContextKey: () => "draft:test",
  fieldExpression: mockElements["#field-expression"],
  fieldReading: mockElements["#field-reading"],
  fieldMeaning: mockElements["#field-meaning"],
  fieldHint: mockElements["#field-hint"],
  fieldNotes: mockElements["#field-notes"],
  fieldExampleSentence: mockElements["#field-example-sentence"],
  fieldExampleTranslation: mockElements["#field-example-translation"],
  expression: mockElements["#expression"],
  updateHeroReading: (reading, expr) => {},
};

vm.runInNewContext(previewEditSlice, fullContext);
const { handlePreviewInlineEdit } = fullContext;

// Edit expression in preview
handlePreviewInlineEdit({
  target: {
    getAttribute: (attr) => attr === "data-preview-edit-key" ? "expression" : null,
    innerText: "走る",
  },
});
assert.equal(mockElements["#field-expression"].value, "走る", "Preview edit must sync to fieldExpression.value");
assert.equal(mockElements["#expression"].textContent, "走る", "Preview edit must sync to hero expression textContent");

// Switch to back side and edit meaning
fullContext.currentPreviewSide = "back";
handlePreviewInlineEdit({
  target: {
    getAttribute: (attr) => attr === "data-preview-edit-key" ? "meaning" : null,
    innerText: "to sprint, to run fast",
  },
});
assert.equal(mockElements["#field-meaning"].value, "to sprint, to run fast", "Preview edit must sync to fieldMeaning.value");

console.log("PASS 6: Preview inline editing two-way synchronization to form fields verified.");

console.log("\n>>> ALL FRONT TOGGLE AND EDITING TESTS PASSED SUCCESSFULLY! <<<\n");
