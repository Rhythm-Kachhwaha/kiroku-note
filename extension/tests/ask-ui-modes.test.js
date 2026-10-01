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

test("Ask UI: Composer is a neutral floating input", () => {
  assert.ok(html.includes('<div class="ask-input-shell">'), "Composer must use a single input shell");
  assert.ok(html.includes('id="btn-ask-submit" aria-label="Send question"'), "Send control must stay accessible");
  assert.ok(html.includes('stroke="currentColor"'), "Send control must use a monochrome outline icon");
  assert.ok(html.includes('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>'), "Send control must use a simple upward arrow");
  assert.equal(html.includes("Ask AI"), false, "Composer must not show the Ask AI label");
  assert.equal(html.includes("<kbd>Enter</kbd>"), false, "Composer must not show an Enter badge");

  const composerStyles = css.slice(css.indexOf(".ask-composer-container {"), css.indexOf("/* LLM API Key"));
  assert.ok(composerStyles.includes(".ask-input-shell:focus-within"), "Input shell must own neutral focus styling");
  assert.ok(composerStyles.includes("border-radius: 28px"), "Input shell must be pill-shaped");
  assert.ok(composerStyles.includes("padding: 10px 8px 10px 6px"), "Textarea text must have comfortable left padding");
  assert.ok(composerStyles.includes("resize: none"), "Textarea must not expose a native resize handle");
  assert.ok(composerStyles.includes("max-height: 220px"), "Textarea must cap growth at 220px");
  assert.ok(composerStyles.includes("flex: 0 0 32px"), "Send button must remain a fixed 32px circle");
  assert.equal(composerStyles.includes("#d4884f"), false, "Composer styles must not use orange");
  assert.equal(composerStyles.includes("#b84632"), false, "Composer styles must not use red");

  assert.match(js, /function resizeAskInputBox\(\)/, "Textarea must have an autosize helper");
  assert.match(js, /askInputBox\.style\.height = "auto"/, "Autosizing must recalculate from content height");
  assert.match(js, /contentHeight > maxHeight \? "auto" : "hidden"/, "Long prompts must scroll at the maximum height");
  assert.match(js, /askInputBox\.addEventListener\("input", \(\) => \{\s*resizeAskInputBox\(\);/, "Typing must resize the textarea");
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
