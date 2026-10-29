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
