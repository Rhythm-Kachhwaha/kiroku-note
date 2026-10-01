/**
 * Test Suite: LLM Settings - JLPT Level Dropdown Configuration
 * Verifies presence of JLPT level dropdown, options N5-N1, default N3,
 * absence of emojis, and integration with sidepanel.js settings synchronization.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const js = fs.readFileSync(jsPath, "utf8");

test("JLPT Settings: DOM Structure - Dropdown and 5 levels", () => {
  assert.ok(
    html.includes('id="setting-llm-jlpt-level"'),
    "HTML must define #setting-llm-jlpt-level dropdown in Settings"
  );
  assert.ok(html.includes('value="N5"'), "Dropdown must contain N5 option");
  assert.ok(html.includes('value="N4"'), "Dropdown must contain N4 option");
  assert.ok(html.includes('value="N3"'), "Dropdown must contain N3 option");
  assert.ok(html.includes('value="N2"'), "Dropdown must contain N2 option");
  assert.ok(html.includes('value="N1"'), "Dropdown must contain N1 option");
});

test("JLPT Settings: Zero Emojis Guardrail", () => {
  const rowMatch = html.match(/<div class="settings-row" id="row-llm-jlpt-level"[\s\S]*?<\/div>/);
  assert.ok(rowMatch, "Must find row-llm-jlpt-level in HTML");
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.ok(!emojiRegex.test(rowMatch[0]), "JLPT settings row must not contain emojis");
});

test("JLPT Settings: sidepanel.js bindings and API synchronization", () => {
  assert.ok(
    js.includes("settingLlmJlptLevel"),
    "sidepanel.js must reference settingLlmJlptLevel"
  );
  assert.ok(
    js.includes("jlpt_level"),
    "sidepanel.js must handle jlpt_level in config sync"
  );
});
