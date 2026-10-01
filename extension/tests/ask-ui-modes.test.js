/**
 * Test Suite: Ask Tab @ Mode Picker & Short/Detailed Response Controls
 * Verifies the compact picker, Short/Detailed toggle, and zero emojis.
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

test("Ask UI: DOM Structure - @ Picker & 6 Modes", () => {
  assert.ok(html.includes('id="ask-mode-toolbar"'), "HTML must define #ask-mode-toolbar");
  assert.ok(html.includes('id="ask-mode-picker"'), "HTML must define #ask-mode-picker");
  assert.equal(html.includes('id="ask-mode-select"'), false, "Ask mode dropdown must be removed");
  assert.ok(html.includes('placeholder="Type a question..."'), "Ask placeholder must stay minimal");
  assert.equal(html.includes("Ask anything about Japanese, paste an MCQ or sentence..."), false);

  const requiredModes = [
    'data-task="chat">Ask / Chat',
    'data-task="answer_question">Answer MCQ / JLPT',
    'data-task="explain_grammar">Explain Grammar',
    'data-task="explain_sense">Sense in Context',
    'data-task="translate">Translate',
    'data-task="mnemonic">Mnemonic Hook',
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
  assert.ok(css.includes(".ask-mode-picker"), "CSS must style .ask-mode-picker");
  assert.ok(css.includes(".ask-response-mode-wrap"), "CSS must style .ask-response-mode-wrap");
  assert.ok(css.includes(".ask-mode-pill"), "CSS must style .ask-mode-pill");
  assert.match(css, /\.ask-mode-pill\.active\s*\{[^}]*rgba\(255, 255, 255/);
});

test("Ask UI: @ picker uses keyboard navigation and existing task state", () => {
  assert.match(js, /function updateAskModePicker\(\)/);
  assert.match(js, /function selectAskMode\(option\)/);
  assert.match(js, /allOptions\.forEach\(option => \{ option\.hidden = true; \}\)/);
  assert.match(js, /currentAskTask = option\.getAttribute\("data-task"\)/);
  assert.match(js, /askModePickerOptions\[askModePickerIndex\]/);
  assert.match(js, /askInputBox\.value\.slice\(askModePickerEnd\)/);
  assert.match(js, /mode: currentAskResponseMode/);
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
