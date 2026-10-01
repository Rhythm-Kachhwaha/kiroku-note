const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "sidepanel/sidepanel.html"), "utf8");
const css = fs.readFileSync(path.join(root, "sidepanel/sidepanel.css"), "utf8");
const js = fs.readFileSync(path.join(root, "sidepanel/sidepanel.js"), "utf8");

test("Text action row exposes compact Save, Send to Anki, and Ask actions", () => {
  const actionRow = html.match(/<div class="primary-actions-row editor-actions-bottom">([\s\S]*?)<\/div>/)?.[1] || "";
  assert.match(actionRow, /id="save-card-btn"[\s\S]*?>[\s\S]*?Save/);
  assert.match(actionRow, /id="sync-anki-btn"[\s\S]*?>[\s\S]*?Send to Anki/);
  assert.match(actionRow, /id="btn-ask-from-text"[^>]*>Ask<\/button>/);
  assert.match(css, /\.primary-actions-row\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*center[^}]*flex-wrap:\s*nowrap/);
  assert.match(css, /#save-card-btn,\s*#sync-anki-btn,\s*#btn-ask-from-text\s*\{[^}]*height:\s*33px/);
  assert.match(css, /padding:\s*5px 12px/);
  assert.match(css, /#save-card-btn:focus-visible,[\s\S]*?outline: 2px solid var\(--text-muted\)/);
});

test("Text capture context includes available card and source details", () => {
  const helper = js.match(/function buildTextAskContext\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, "buildTextAskContext must exist");

  const context = {
    fieldExpression: { value: "合" },
    fieldReading: { value: "ごう" },
    fieldMeaning: { value: "fit; match" },
    fieldSourceText: { value: "話が合う" },
    fieldExampleSentence: { value: "話が合う" },
  };
  vm.runInNewContext(`${helper}\nthis.result = buildTextAskContext();`, context);

  assert.equal(context.result, "Word: 合\nReading: ごう\nCurrent meaning: fit; match\nCaptured text: 話が合う");
});

test("Ask action prefills the editable composer and navigates without submitting", () => {
  const handler = js.match(/if \(btnAskFromText\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(handler, /clearAskContext\(\)/);
  assert.match(handler, /currentAskTask = "chat"/);
  assert.match(handler, /askInputBox\.value = `Explain this mined word and how it is used:/);
  assert.match(handler, /resizeAskInputBox\(\)/);
  assert.match(handler, /updateAskCharCount\(\)/);
  assert.match(handler, /switchMiningTab\("ask"\)/);
  assert.equal(handler.includes("sendAskQuery"), false);
  assert.equal(handler.includes("setAskContext"), false);
});