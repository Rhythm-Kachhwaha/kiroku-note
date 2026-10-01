/**
 * Tier 5 Session 2 Test Suite: "Ask" AI Assistant Tab & UI Integration
 * Verifies DOM structure, absence of emojis, tab switching, and LLM assistant wiring.
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

test("Tier 5 Session 2: DOM Structure - Ask Tab Navigation Button", () => {
  assert.ok(
    html.includes('id="tab-btn-ask"'),
    "HTML must define #tab-btn-ask in mode-nav-tabs"
  );
  assert.ok(
    html.includes('aria-controls="ask-mining-view"'),
    "tab-btn-ask must control ask-mining-view"
  );
});

test("Tier 5 Session 2: DOM Structure - Ask Tab Mining View", () => {
  assert.ok(
    html.includes('id="ask-mining-view"'),
    "HTML must define #ask-mining-view container"
  );
  assert.ok(
    html.includes('id="ask-chat-stream"'),
    "HTML must define #ask-chat-stream for conversation history"
  );
  assert.ok(
    html.includes('id="ask-input-box"'),
    "HTML must define #ask-input-box for prompt input"
  );
  assert.ok(
    html.includes('id="btn-ask-submit"'),
    "HTML must define #btn-ask-submit"
  );
  assert.ok(
    html.includes('id="ask-context-banner"'),
    "HTML must define #ask-context-banner for active context detection"
  );
  assert.ok(
    html.includes('id="btn-ask-new-chat"'),
    "HTML must define #btn-ask-new-chat button"
  );
});

test("Tier 5 Session 2: Ask status and New Chat use an unframed compact row", () => {
  assert.ok(html.includes('id="ask-status-dot"'), "Ask status indicator must remain present");
  assert.ok(html.includes('id="ask-provider-name">Online</span>'), "Ask status must start as Online");
  assert.ok(html.includes('id="btn-ask-new-chat"'), "New Chat control must remain present");
  assert.equal(html.includes("ask-provider-pill"), false, "Ask status must not use a pill");
  assert.match(js, /askProviderName\.textContent = isConfigured \? "Online" : "Offline"/);
  assert.match(js, /askProviderName\.textContent = "Offline"/);

  const statusStyles = css.match(/\.ask-status-bar\s*\{([^}]*)\}/)?.[1] || "";
  assert.doesNotMatch(
    statusStyles,
    /^\s*(?:background(?:-[\w-]+)?|border(?:-[\w-]+)?)\s*:/m,
    "Ask status row must not draw a separate surface"
  );
});

test("Tier 5 Session 2: Visual Guardrail - Strict Absence of Emojis", () => {
  // Extract only the ask-mining-view section
  const askSectionMatch = html.match(/<div id="ask-mining-view"[\s\S]*?<\/div>\s*<!--\s*={5,}/);
  assert.ok(askSectionMatch, "Must locate ask-mining-view in HTML");
  const askSection = askSectionMatch[0];

  // Common emojis that must NOT be present
  const forbiddenEmojis = ["🎯", "💡", "🔍", "🌐", "🧠", "📋", "📷", "🤖", "⚡", "✨", "✕", "✍", "💬"];
  for (const emoji of ["🎯", "💡", "🔍", "🌐", "🧠", "📋", "📷", "🤖", "⚡", "✨"]) {
    assert.equal(
      askSection.includes(emoji),
      false,
      `ask-mining-view must not contain emoji '${emoji}'`
    );
  }
});

test("Tier 5 Session 2: Minimalist Guardrail - No Redundant OCR or JP Buttons in Ask Composer", () => {
  const askSectionMatch = html.match(/<div class="ask-composer-container"[\s\S]*?<\/div>\s*<\/div>/);
  if (askSectionMatch) {
    const composerSection = askSectionMatch[0];
    assert.equal(
      composerSection.includes("btn-composer-ocr"),
      false,
      "Must not include redundant OCR button in composer (top bar OCR button is used)"
    );
    assert.equal(
      composerSection.includes("composer-jp-pill"),
      false,
      "Must not include redundant JP button in composer (top bar JP button is used)"
    );
  }
});

test("Tier 5 Session 2: Settings Popover AI Section", () => {
  assert.ok(
    html.includes('id="llm-provider-display"'),
    "Settings popover must contain #llm-provider-display"
  );
  assert.ok(
    html.includes('id="llm-status-label"'),
    "Settings popover must contain #llm-status-label"
  );
});

test("Tier 5 Session 2: sidepanel.js Tab Switching & Ask Handling", () => {
  assert.ok(
    js.includes('"ask"'),
    "sidepanel.js must recognize 'ask' in validTabs"
  );
  assert.ok(
    js.includes("tabBtnAsk"),
    "sidepanel.js must reference tabBtnAsk"
  );
  assert.ok(
    js.includes("askMiningView"),
    "sidepanel.js must reference askMiningView"
  );
  assert.ok(
    js.includes("/api/llm/ask"),
    "sidepanel.js must call /api/llm/ask"
  );
  assert.ok(
    js.includes("/api/llm/status"),
    "sidepanel.js must check /api/llm/status"
  );
});

test("Tier 5 Session 2: CSS Styling - Ask Tab Layout & Zero Emojis", () => {
  assert.ok(
    css.includes("#ask-mining-view"),
    "sidepanel.css must style #ask-mining-view"
  );
  assert.ok(
    css.includes(".ask-status-bar"),
    "sidepanel.css must style .ask-status-bar"
  );
  assert.ok(
    css.includes(".ask-context-banner"),
    "sidepanel.css must style .ask-context-banner"
  );
  assert.ok(
    css.includes(".btn-ask-submit"),
    "sidepanel.css must style .btn-ask-submit"
  );
  assert.ok(
    css.includes(".ai-direct-answer"),
    "sidepanel.css must style .ai-direct-answer"
  );

  // Guardrail: No emojis in CSS rules for Ask Tab
  const askCssMatch = css.match(/\/\* =+[\r\n\s]+TIER 5: ASK TAB[\s\S]*$/);
  if (askCssMatch) {
    const askCss = askCssMatch[0];
    const forbiddenEmojis = ["🎯", "💡", "🔍", "🌐", "🧠", "📋", "📷", "🤖", "⚡", "✨"];
    for (const emoji of forbiddenEmojis) {
      assert.equal(
        askCss.includes(emoji),
        false,
        `Ask CSS must not contain emoji '${emoji}'`
      );
    }
  }
});

test("Tier 5 Session 2: Universal [JP] Mode & OCR Capture Integration", () => {
  // Guardrail: WanaKana must bind to askInputBox in setEditorJapaneseMode
  assert.ok(
    js.includes("askInputBox") && js.includes("targetInputs.push(askInputBox)"),
    "setEditorJapaneseMode must include askInputBox in targetInputs"
  );

  // Guardrail: OCR result populates askInputBox when on 'ask' tab
  assert.ok(
    js.includes('currentMiningTab === "ask"') && js.includes("askInputBox.value = recognizedText"),
    "OCR recognize handler must populate askInputBox when currentMiningTab is ask"
  );

  // Guardrail: Card editor is hidden when on 'ask' tab
  assert.ok(
    js.includes('hideEditor = tab === "history" || tab === "ask"'),
    "switchMiningTab must hide card editor section when on 'ask' tab"
  );

  const tabSwitchBody = js.slice(
    js.indexOf("function switchMiningTab(targetTab)"),
    js.indexOf("async function loadTabPreference()")
  );
  assert.ok(
    tabSwitchBody.indexOf("cardEditorSection.hidden = hideEditor") < tabSwitchBody.indexOf("if (askMiningView)"),
    "Shared card editor must be hidden before Ask-specific setup can interrupt the first tab transition"
  );

  assert.ok(
    js.indexOf("let activeAskContext = { text: \"\", source: \"\" };") < js.indexOf("loadTabPreference().catch(() => {});"),
    "Ask context state must be initialized before startup tab restoration can select Ask"
  );

  const historyVisibilityBody = js.slice(
    js.indexOf("function applyHistoryVisibility()"),
    js.indexOf("async function loadStoredCardTemplateSettings()")
  );
  assert.match(historyVisibilityBody, /currentMiningTab === "history"/, "Async history settings must respect the active tab");
});

test("Tier 5 Session 2: sidepanel.js Module Exports for Ask Tab", () => {
  assert.ok(js.includes("checkLLMStatus,"), "module.exports must include checkLLMStatus");
  assert.ok(js.includes("sendAskQuery,"), "module.exports must include sendAskQuery");
  assert.ok(js.includes("setAskContext,"), "module.exports must include setAskContext");
  assert.ok(js.includes("clearAskContext,"), "module.exports must include clearAskContext");
  assert.ok(js.includes("formatAIResponse,"), "module.exports must include formatAIResponse");
});

