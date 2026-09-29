const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");

const html = fs.readFileSync(htmlPath, "utf-8");
const css = fs.readFileSync(cssPath, "utf-8");
const js = fs.readFileSync(jsPath, "utf-8");

test("Tier 1 - T1-A: Status Dot Hover Tooltips", () => {
  // Check markup has initial tooltips
  assert.ok(html.includes('id="indicator-yomitan"'), "indicator-yomitan must exist");
  assert.ok(html.includes('id="indicator-anki"'), "indicator-anki must exist");
  assert.ok(html.includes('id="indicator-ocr"'), "indicator-ocr must exist");

  assert.ok(html.includes('id="indicator-yomitan"') && html.includes('title="Yomitan: Ready"'), "indicator-yomitan has initial title");
  assert.ok(html.includes('id="indicator-anki"') && html.includes('title="Anki: Checking…"'), "indicator-anki has initial title");
  assert.ok(html.includes('id="indicator-ocr"') && html.includes('title="OCR: Checking…"'), "indicator-ocr has initial title");

  // Check setIndicatorStatus sets title
  assert.ok(js.includes("function setIndicatorStatus(indicatorEl, state, titleText)"), "setIndicatorStatus function exists");
  assert.ok(js.includes("if (titleText) indicatorEl.title = titleText;"), "setIndicatorStatus dynamically updates title");
});

test("Tier 1 - T1-B: History Progress Bar and Sync Label", () => {
  // Markup checks
  assert.ok(html.includes('id="history-sync-label"'), "history-sync-label must exist in markup");
  assert.ok(html.includes('id="history-progress-bar"'), "history-progress-bar must exist in markup");

  // CSS checks
  assert.ok(css.includes(".history-sync-progress-group"), ".history-sync-progress-group styles exist");
  assert.ok(css.includes(".history-progress-bar"), ".history-progress-bar styles exist");
  assert.ok(css.includes(".history-sync-label"), ".history-sync-label styles exist");

  // JS checks
  assert.ok(js.includes('document.querySelector("#history-sync-label")'), "historySyncLabel element queried");
  assert.ok(js.includes("${synced} / ${total} synced"), "historySyncLabel set to synced / total synced");
});

test("Tier 1 - T1-C: Empty State Illustrations and Messages", () => {
  // CSS styles
  assert.ok(css.includes(".empty-state"), ".empty-state styles exist");
  assert.ok(css.includes(".empty-state-icon"), ".empty-state-icon styles exist");
  assert.ok(css.includes(".empty-state-text"), ".empty-state-text styles exist");

  // Inline SVG icons in JS
  assert.ok(js.includes("empty-state history-empty-state"), "history empty state class used");
  assert.ok(js.includes("empty-state quickadd-empty-state"), "quickadd empty state class used");
  assert.ok(js.includes("empty-state dict-empty-state"), "dictionary empty state class used");

  assert.ok(js.includes("No cards mined yet."), "History empty state copy present");
  assert.ok(js.includes("No matches found."), "Quick Add empty state copy present");
  assert.ok(js.includes("Yomitan is offline."), "Dictionary offline copy present");
});

test("Tier 1 - T1-D: Dictionary Forms Table Blank Row Cleanup", () => {
  // CSS safety fallback
  assert.ok(css.includes(".dict-forms-section:empty"), ".dict-forms-section:empty rule exists in CSS");
  assert.ok(css.includes(".forms-section:empty"), ".forms-section:empty rule exists in CSS");

  // JS post-render pass checking table cell emptiness > 50%
  assert.ok(js.includes('querySelectorAll("table")'), "meanings queries tables for post-render check");
  assert.ok(js.includes("empty / cells.length > 0.5"), "removes tables where >50% cells are empty");
});

test("Tier 1 - T1-E: '→ Sentence' Button on Dictionary Examples", () => {
  // Markup / JS checks
  assert.ok(js.includes("btn-insert-sentence"), "btn-insert-sentence class assigned to example insert button");
  assert.ok(js.includes('"→ Sentence"'), "→ Sentence button text assigned");
  assert.ok(js.includes("insertExampleToCard"), "insertExampleToCard function called on click");

  // CSS checks
  assert.ok(css.includes(".btn-insert-sentence"), ".btn-insert-sentence styles exist in CSS");
});
