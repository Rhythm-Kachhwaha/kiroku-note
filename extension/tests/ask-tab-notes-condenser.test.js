const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const js = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");
const html = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.html"), "utf8");

function createElement() {
  return {
    value: "",
    hidden: true,
    textContent: "",
    focus() { this.focused = true; },
    dispatchEvent(event) { this.lastEvent = event; },
  };
}

const elements = new Map([
  ["#ask-notes-composer", createElement()],
  ["#ask-notes-preview", createElement()],
  ["#ask-notes-counter", createElement()],
  ["#ask-notes-insert", createElement()],
  ["#ask-hint-insert", createElement()],
  ["#ask-notes-cancel", createElement()],
]);
const fieldNotes = createElement();
const fieldHint = createElement();
const statuses = [];
const askSource = js.slice(js.indexOf("function condenseNotes"), js.indexOf("function setAskResponseMode"));
const askContext = {
  document: { querySelector: selector => elements.get(selector) || null },
  Event: class Event { constructor(type, init) { this.type = type; Object.assign(this, init); } },
  fieldNotes,
  fieldHint,
  setStatus: message => statuses.push(message),
  setTimeout: fn => { fn(); return 1; },
};
vm.createContext(askContext);
vm.runInContext(askSource, askContext);

test("Ask notes condenser removes boilerplate and preserves selected sections", () => {
  const condensed = askContext.condenseNotes(
    "Here is the explanation:\nMeaning:\n**to eat**\nUsage:\nOften used with meals.",
    { sectionFilter: ["meaning"] },
  );
  assert.equal(condensed, "Meaning:\n**to eat**");
});

test("Ask notes condenser applies a bounded preview", () => {
  const condensed = askContext.condenseNotes("a".repeat(20), { maxChars: 10 });
  assert.equal(condensed, `${"a".repeat(9)}…`);
});

test("Ask notes UI provides an editable preview and both insertion actions", () => {
  for (const id of ["ask-notes-composer", "ask-notes-preview", "ask-notes-insert", "ask-hint-insert", "ask-notes-counter"]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.match(js, /openNotesComposer\(aiResult, btnAddNotes\)/);
  assert.match(js, /fieldHint/);
  assert.match(js, /fieldNotes/);
});

test("Ask notes composer wires preview input and Add as Notes action", () => {
  const dialog = elements.get("#ask-notes-composer");
  const preview = elements.get("#ask-notes-preview");
  askContext.openNotesComposer("Here is the explanation:\n**Remember** this.", { textContent: "Add to Notes" });
  assert.equal(dialog.hidden, false);
  assert.equal(preview.value, "**Remember** this.");
  assert.equal(elements.get("#ask-notes-counter").textContent, "18/600");
  preview.value = "Edited note";
  preview.oninput();
  assert.equal(elements.get("#ask-notes-counter").textContent, "11/600");
  elements.get("#ask-notes-insert").onclick();
  assert.equal(fieldNotes.value, "Edited note");
  assert.equal(dialog.hidden, true);
  assert.equal(fieldNotes.lastEvent.type, "input");
  assert.match(statuses.at(-1), /notes/i);
});

test("Ask notes composer wires Add as Hint action", () => {
  askContext.openNotesComposer("A hint.", null);
  elements.get("#ask-hint-insert").onclick();
  assert.equal(fieldHint.value, "A hint.");
  assert.equal(fieldHint.lastEvent.type, "input");
});

test("Ask notes UI contains no OS emoji", () => {
  assert.equal(/[🎯💡🔍🌐🧠📋📷🤖⚡✨]/u.test(html), false);
});
