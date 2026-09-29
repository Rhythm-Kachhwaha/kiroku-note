/**
 * Regression tests for Japanese input mode (JP mode / WanaKana IME)
 * Verifies that pre-existing English text in any field is preserved when JP mode is used.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const wanakana = require(path.resolve(__dirname, "../lib/wanakana.js"));

function createMockInput(initialValue = "") {
  const listeners = {};
  return {
    nodeName: "INPUT",
    tagName: "INPUT",
    value: initialValue,
    selectionStart: initialValue.length,
    selectionEnd: initialValue.length,
    attributes: {},
    dataset: {},
    getAttribute(name) { return this.attributes[name]; },
    setAttribute(name, val) { this.attributes[name] = val; },
    removeAttribute(name) { delete this.attributes[name]; },
    hasAttribute(name) { return name in this.attributes; },
    addEventListener(evt, fn) { listeners[evt] = fn; },
    removeEventListener(evt, fn) { delete listeners[evt]; },
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
    
    type(str) {
      for (const char of str) {
        const before = this.value.slice(0, this.selectionStart);
        const after = this.value.slice(this.selectionEnd);
        this.value = before + char + after;
        const newPos = before.length + char.length;
        this.selectionStart = newPos;
        this.selectionEnd = newPos;
        if (listeners["input"]) {
          listeners["input"]({ target: this });
        }
      }
    }
  };
}

test("JP Mode Regression: Typing Japanese in empty input works normally", () => {
  const input = createMockInput("");
  wanakana.bind(input, { IMEMode: true });
  input.type("arigatou");
  assert.equal(input.value, "ありがとう");
});

test("JP Mode Regression: Pre-existing English with colon is preserved", () => {
  const input = createMockInput("The cat: ");
  wanakana.bind(input, { IMEMode: true });
  input.type("neko");
  assert.equal(input.value, "The cat: ねこ", "Pre-existing 'The cat: ' must NOT be converted to Japanese");
});

test("JP Mode Regression: Pre-existing English phrase with space is preserved", () => {
  const input = createMockInput("English note ");
  wanakana.bind(input, { IMEMode: true });
  input.type("taberu");
  assert.equal(input.value, "English note たべる", "Pre-existing 'English note ' must remain in English");
});

test("JP Mode Regression: Pre-existing Japanese followed by English is preserved", () => {
  const input = createMockInput("犬 cat ");
  wanakana.bind(input, { IMEMode: true });
  input.type("inu");
  assert.equal(input.value, "犬 cat いぬ", "Pre-existing '犬 cat ' must remain intact");
});

test("JP Mode Regression: Pre-existing English greeting is preserved", () => {
  const input = createMockInput("Hello ");
  wanakana.bind(input, { IMEMode: true });
  input.type("konnichiwa");
  assert.equal(input.value, "Hello こんいちわ");
});

test("JP Mode Regression: Pre-existing English notes with parentheses is preserved", () => {
  const input = createMockInput("Notes (e.g. cat) ");
  wanakana.bind(input, { IMEMode: true });
  input.type("ringo");
  assert.equal(input.value, "Notes (e.g. cat) りんご");
});

test("JP Mode Regression: Pre-existing mixed greeting with punctuation", () => {
  const input = createMockInput("こんにちは hello ");
  wanakana.bind(input, { IMEMode: true });
  input.type("sayounara");
  assert.equal(input.value, "こんにちは hello さようなら");
});

test("JP Mode Regression: Pre-existing notes with brackets", () => {
  const input = createMockInput("Notes: [important] ");
  wanakana.bind(input, { IMEMode: true });
  input.type("kore wa hon desu");
  assert.equal(input.value, "Notes: [important] これ わ ほn です");
});

test("JP Mode Regression: Pre-existing English word does not convert when letter appended", () => {
  const input = createMockInput("English");
  wanakana.bind(input, { IMEMode: true });
  input.type("k");
  assert.equal(input.value, "Englishk", "Should not convert 'English' to kana");
});

test("JP Mode Regression: Pre-existing Japanese text typing continuation", () => {
  const input = createMockInput("たべ");
  wanakana.bind(input, { IMEMode: true });
  input.type("ta");
  assert.equal(input.value, "たべた");
});

test("JP Mode Regression: Pre-existing sokuon continuation", () => {
  const input = createMockInput("かっ");
  wanakana.bind(input, { IMEMode: true });
  input.type("ta");
  assert.equal(input.value, "かった");
});
