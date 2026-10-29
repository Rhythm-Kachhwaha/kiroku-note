const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const js = fs.readFileSync(path.join(__dirname, "../sidepanel/sidepanel.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../sidepanel/sidepanel.html"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "../content/content.js"), "utf8");

test("sentence grammar capture has Alt+G without replacing word capture", () => {
  assert.match(content, /ANALYZE_GRAMMAR_SELECTION/);
  assert.match(content, /event\.altKey/);
  assert.match(content, /captureSelection/);
  assert.match(js, /renderTextGrammar/);
});

test("text grammar breakdown has collapsed accessible UI", () => {
  assert.match(html, /id="text-grammar-section"/);
  assert.match(html, /id="text-grammar-toggle"/);
  assert.match(js, /grammar-point-card/);
  assert.match(js, /createGrammarCard\(point, sentence, "text"\)/);
  assert.match(js, /card_kind: currentGrammarCard \? "grammar" : currentCardKind/);
});
