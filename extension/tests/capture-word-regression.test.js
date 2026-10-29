const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const content = fs.readFileSync(path.join(__dirname, "../content/content.js"), "utf8");
test("single-word mouseup capture remains canonical", () => {
  assert.match(content, /document\.addEventListener\("mouseup"/);
  assert.match(content, /captureSelection\(\)/);
  assert.match(content, /captureUtils\.captureMessage/);
  assert.match(content, /captureUtils\.captureMessage\(text\)/);
});

test("Alt+G grammar capture is a sibling keyboard branch", () => {
  const handler = content.match(/document\.addEventListener\("keydown",[\s\S]*?\n\s+\}, true\);/);
  assert.ok(handler, "keyboard handler must exist");
  const source = handler[0];
  assert.match(source, /if \(event\.altKey && .*KeyO/);
  assert.match(source, /if \(event\.altKey && .*KeyG/);
  assert.ok(source.indexOf("KeyG") > source.indexOf("}\n      if (event.altKey"), "Alt+G must not be nested under Alt+O");
});
