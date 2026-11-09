const { getSidepanelSource } = require("./helpers/source.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "../sidepanel/sidepanel.html"), "utf8");
const js = getSidepanelSource();
test("grammar settings expose persisted particle and card style controls", () => {
  assert.match(html, /id="grammar-settings-group"/);
  assert.match(html, /id="setting-grammar-particles"/);
  assert.match(html, /id="setting-grammar-front-style"/);
  assert.match(html, /id="btn-test-grammar-setup"/);
  assert.match(js, /GRAMMAR_SETTINGS_KEY/);
  assert.match(js, /API_GRAMMAR_SETUP_URL/);
  assert.match(js, /function initGrammarUI\(\)/);
  assert.match(js, /initGrammarUI\(\);\s*loadAutoCapturePreferences/);
});
