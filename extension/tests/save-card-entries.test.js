const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

function createMockEl(tag = "div") {
  const el = {
    tag,
    tagName: tag.toUpperCase(),
    value: "",
    textContent: "",
    className: "",
    style: {},
    disabled: false,
    hidden: false,
    children: [],
    _listeners: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; },
    addEventListener(evt, fn) {
      if (!this._listeners[evt]) this._listeners[evt] = [];
      this._listeners[evt].push(fn);
      this["on" + evt] = fn;
    },
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event?.type;
      if (this._listeners[type]) {
        this._listeners[type].forEach(fn => fn(event));
      }
      return true;
    },
    classList: {
      add() {},
      remove() {},
      contains() { return false; },
    },
  };
  return el;
}

// Extract submit event handler from cardEditor listener block
const submitStart = jsContent.indexOf("// Card save form submission");
assert.ok(submitStart !== -1, "Card save form submission marker must exist in sidepanel.js");
const submitEnd = jsContent.indexOf("async function triggerAnkiSync");
assert.ok(submitEnd !== -1, "triggerAnkiSync function must exist in sidepanel.js");

let capturedPayload = null;
const mockFetch = async (url, options) => {
  if (options && options.body) {
    capturedPayload = JSON.parse(options.body);
  }
  return {
    ok: true,
    json: async () => ({
      id: 101,
      expression: "食べる",
      reading: "たべる",
      meaning: "1. to eat\n2. to live on",
      entries: capturedPayload ? capturedPayload.entries : [],
      status: "saved",
      sync_status: "pending",
      is_duplicate: false,
      is_new: true,
      is_updated: false,
    }),
  };
};

const cardEditorMock = createMockEl("form");
const testContext = {
  fetch: mockFetch,
  API_SAVE_URL: "http://127.0.0.1:21828/api/cards/save",
  cardEditor: cardEditorMock,
  fieldCardId: { value: "" },
  fieldExpression: { value: "食べる" },
  fieldReading: { value: "たべる" },
  fieldMeaning: { value: "1. to eat\n2. to live on" },
  fieldDeckSelect: { value: "Default" },
  fieldDeckName: { value: "Default" },
  fieldModelSelect: { value: "Basic" },
  fieldModelName: { value: "Basic" },
  fieldHint: { value: "" },
  fieldExampleSentence: { value: "ご飯を食べる。" },
  fieldExampleTranslation: { value: "Eat a meal." },
  fieldImage: { value: "" },
  fieldAudio: { value: "" },
  fieldTags: { value: "" },
  fieldNotes: { value: "" },
  fieldSourceText: { value: "食べる" },
  fieldDeinflectedText: { value: "食べる" },
  saveCardBtn: createMockEl("button"),
  saveBadge: createMockEl("span"),
  expression: createMockEl("h1"),
  reading: createMockEl("p"),
  currentDraftMedia: {},
  updateMediaPreviews: () => {},
  updateSyncUI: () => {},
  setStatus: () => {},
  loadHistory: async () => {},
  formatErrorMessage: (e) => String(e),
  currentDictionaryEntries: [
    {
      dictionary: "Jitendex",
      is_primary: true,
      term: "食べる",
      reading: "たべる",
      senses: [
        { index: 1, glosses: ["to eat"], parts_of_speech: ["1-dan", "vt"] },
        { index: 2, glosses: ["to live on"], parts_of_speech: ["1-dan"] },
      ],
    },
  ],
  currentKanjiEntries: [
    {
      character: "食",
      dictionary: "KANJIDIC",
      onyomi: ["ショク"],
      kunyomi: ["た.べる"],
      meanings: ["eat"],
      stats: { strokes: "9" },
    },
  ],
};

const submitSrc = jsContent.slice(submitStart, submitEnd);
vm.runInNewContext(submitSrc, testContext);

(async () => {
  // Trigger submit event
  const submitHandler = cardEditorMock._listeners["submit"][0];
  assert.ok(typeof submitHandler === "function", "Submit handler must be registered on cardEditor");

  await submitHandler({ preventDefault() {} });

  assert.ok(capturedPayload !== null, "cardEditor submit must issue fetch request to API_SAVE_URL");
  assert.ok("entries" in capturedPayload, "Save Card payload must include 'entries' property");
  assert.equal(Array.isArray(capturedPayload.entries), true, "entries must be an array");
  assert.equal(capturedPayload.entries.length, 1, "entries should contain the 1 captured dictionary entry");
  assert.equal(capturedPayload.entries[0].dictionary, "Jitendex");
  assert.equal(capturedPayload.entries[0].term, "食べる");

  assert.ok("kanji_entries" in capturedPayload, "Save Card payload must include 'kanji_entries' property");
  assert.equal(Array.isArray(capturedPayload.kanji_entries), true, "kanji_entries must be an array");
  assert.equal(capturedPayload.kanji_entries.length, 1, "kanji_entries should contain the 1 captured kanji entry");
  assert.equal(capturedPayload.kanji_entries[0].character, "食");

  console.log("PASS: Save Card payload includes currentDictionaryEntries and currentKanjiEntries verified.");

  // Test empty currentDictionaryEntries defaults to []
  testContext.currentDictionaryEntries = [];
  testContext.currentKanjiEntries = [];
  capturedPayload = null;
  await submitHandler({ preventDefault() {} });
  assert.ok(capturedPayload !== null);
  assert.ok("entries" in capturedPayload, "Save Card payload must include 'entries' property even when empty");
  assert.deepEqual(capturedPayload.entries, [], "empty currentDictionaryEntries should result in entries: []");
  assert.deepEqual(capturedPayload.kanji_entries, [], "empty currentKanjiEntries should result in kanji_entries: []");

  console.log("PASS: empty currentDictionaryEntries and currentKanjiEntries handled cleanly as [].");
})();
