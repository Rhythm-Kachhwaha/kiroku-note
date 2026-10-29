const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const js = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");
const html = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.html"), "utf8");

test("Ask notes pipeline exposes the condenser and removes boilerplate", () => {
  assert.match(js, /function condenseNotes\(rawText, options = \{\}\)/);
  assert.match(js, /here is the explanation/i);
  assert.match(js, /break this down/);
});

test("Ask notes pipeline supports section filtering and a bounded preview", () => {
  assert.match(js, /sectionFilter/);
  assert.match(js, /maxChars/);
  assert.match(js, /…/);
});

test("Ask notes UI provides an editable preview and both insertion actions", () => {
  for (const id of ["ask-notes-composer", "ask-notes-preview", "ask-notes-insert", "ask-hint-insert", "ask-notes-counter"]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.match(js, /openNotesComposer\(aiResult, btnAddNotes\)/);
  assert.match(js, /fieldHint/);
  assert.match(js, /fieldNotes/);
});

test("Ask notes UI contains no OS emoji", () => {
  assert.equal(/[🎯💡🔍🌐🧠📋📷🤖⚡✨]/u.test(html), false);
});
