/**
 * Test Suite: Ask Tab Mode Selector & Short/Detailed Response Controls
 * Verifies compact toolbar, 6 mode options, Short/Detailed toggle, and zero emojis.
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

test("Ask UI: DOM Structure - Mode Selector Dropdown & 6 Modes", () => {
  assert.ok(html.includes('id="ask-mode-toolbar"'), "HTML must define #ask-mode-toolbar");
  assert.ok(html.includes('id="ask-mode-select"'), "HTML must define #ask-mode-select");

  const requiredModes = [
    'value="chat"',
    'value="answer_question"',
    'value="explain_grammar"',
    'value="explain_sense"',
    'value="translate"',
    'value="mnemonic"',
  ];

  for (const mode of requiredModes) {
    assert.ok(
      html.includes(mode),
      `#ask-mode-select must contain option with ${mode}`
    );
  }
});

test("Ask UI: DOM Structure - Short / Detailed Response Mode Control", () => {
  assert.ok(
    html.includes('id="ask-response-mode-toggle"'),
    "HTML must define #ask-response-mode-toggle"
  );
  assert.ok(
    html.includes('id="btn-mode-short"'),
    "HTML must define #btn-mode-short"
  );
  assert.ok(
    html.includes('id="btn-mode-detailed"'),
    "HTML must define #btn-mode-detailed"
  );
  assert.ok(
    html.includes('data-mode="short"'),
    "Short button must have data-mode='short'"
  );
  assert.ok(
    html.includes('data-mode="detailed"'),
    "Detailed button must have data-mode='detailed'"
  );
});

test("Ask UI: Zero Emojis Guardrail", () => {
  const toolbarMatch = html.match(/<div class="ask-mode-toolbar"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(toolbarMatch, "Must find ask-mode-toolbar section in HTML");
  const toolbarHtml = toolbarMatch[0];

  const forbiddenEmojis = ["🎯", "💡", "🔍", "🌐", "🧠", "📋", "📷", "🤖", "⚡", "✨", "✕", "✍", "💬"];
  for (const emoji of forbiddenEmojis) {
    assert.equal(
      toolbarHtml.includes(emoji),
      false,
      `ask-mode-toolbar must not contain emoji '${emoji}'`
    );
  }
});

test("Ask UI: CSS Styling for Toolbar and Controls", () => {
  assert.ok(css.includes(".ask-mode-toolbar"), "CSS must style .ask-mode-toolbar");
  assert.ok(css.includes(".ask-mode-select"), "CSS must style .ask-mode-select");
  assert.ok(css.includes(".ask-response-mode-wrap"), "CSS must style .ask-response-mode-wrap");
  assert.ok(css.includes(".ask-mode-pill"), "CSS must style .ask-mode-pill");
});

test("Ask UI: sidepanel.js Payload Integration", () => {
  assert.ok(
    js.includes("mode: currentAskResponseMode"),
    "sendAskQuery payload must include mode: currentAskResponseMode"
  );
  assert.ok(
    js.includes("jlpt_level:"),
    "sendAskQuery payload must include jlpt_level"
  );
});
