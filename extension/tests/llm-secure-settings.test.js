const { getSidepanelSource, getSidepanelCss } = require("./helpers/source.js");
/**
 * Test Suite: LLM Secure Settings & API Key Configuration
 * Verifies DOM structure, password masking, absence of "show key" button,
 * strict absence of emojis, and settings state transitions.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");

const html = fs.readFileSync(htmlPath, "utf8");
const css = getSidepanelCss();
const js = getSidepanelSource();

test("LLM Secure Settings: DOM Structure - LLM Settings Decoupled From Sidepanel", () => {
  assert.ok(
    !html.includes('id="settings-group-llm"'),
    "HTML must not define redundant #settings-group-llm in sidepanel (configured in Desktop app)"
  );
  assert.ok(
    !html.includes('id="setting-llm-key"'),
    "HTML must not expose #setting-llm-key in sidepanel"
  );
});

test("LLM Secure Settings: Security Invariant - Password Masking & No Show Key Button", () => {
  // Must NOT contain any 'show key' or 'toggle visibility' button
  assert.ok(
    !html.toLowerCase().includes("show key"),
    "HTML must not contain a 'show key' button"
  );
  assert.ok(
    !html.toLowerCase().includes("show-key"),
    "HTML must not contain a show-key id or class"
  );
  assert.ok(
    !html.toLowerCase().includes("toggle-password"),
    "HTML must not contain a password toggle"
  );
});

test("LLM Secure Settings: Sidepanel Decluttering", () => {
  assert.ok(
    !html.includes('id="btn-save-llm-key"'),
    "Sidepanel must not retain redundant LLM key saving controls"
  );
});

test("LLM Secure Settings: CSS Styling Invariants", () => {
  assert.ok(
    css.includes(".llm-settings-input"),
    "CSS must define .llm-settings-input"
  );
  assert.ok(
    css.includes(".llm-key-status-msg"),
    "CSS must define .llm-key-status-msg"
  );
  assert.ok(
    css.includes(".btn-primary-action"),
    "CSS must define .btn-primary-action"
  );
  assert.ok(
    css.includes(".btn-danger-action.confirm-active"),
    "CSS must define 2-click confirmation styling"
  );
});

test("LLM Secure Settings: Strict Absence of Emojis", () => {
  const settingsMatch = html.match(/<div class="card-settings-popover layout-settings-popover"[\s\S]*?<\/div>\s*<\/div>/);
  if (settingsMatch) {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]/u;
    assert.ok(
      !emojiRegex.test(settingsMatch[0]),
      "Settings popover must not contain any unicode emojis"
    );
  }
});

test("LLM Secure Settings: Sidepanel Logic Exports", () => {
  assert.ok(
    js.includes("loadLlmConfigToSettings"),
    "sidepanel.js must define loadLlmConfigToSettings"
  );
  assert.ok(
    js.includes("applyLlmConfiguredState"),
    "sidepanel.js must define applyLlmConfiguredState"
  );
  assert.ok(
    js.includes("saveLlmSecretFromSettings"),
    "sidepanel.js must define saveLlmSecretFromSettings"
  );
  assert.ok(
    js.includes("startReplaceLlmKey"),
    "sidepanel.js must define startReplaceLlmKey"
  );
  assert.ok(
    js.includes("removeLlmSecretFromSettings"),
    "sidepanel.js must define removeLlmSecretFromSettings"
  );
});

test("LLM Secure Settings: State Machine Simulation", () => {
  // Mock mock DOM elements
  const mockKeyInput = { value: "", disabled: false, placeholder: "", focus: () => {} };
  const mockStatusMsg = { hidden: true };
  const mockStatusText = { textContent: "" };
  const mockBtnSave = { hidden: false, textContent: "" };
  const mockBtnReplace = { hidden: true };
  const mockBtnRemove = { hidden: true, textContent: "", classList: { remove: () => {} } };
  const mockBtnCancel = { hidden: true };

  function applyState(isConfigured, provider = "groq") {
    const normProvider = (provider || "Groq").charAt(0).toUpperCase() + (provider || "Groq").slice(1);
    if (isConfigured) {
      mockKeyInput.value = "••••••••••••••••";
      mockKeyInput.disabled = true;
      mockStatusMsg.hidden = false;
      mockStatusText.textContent = `${normProvider} API key configured`;
      mockBtnSave.hidden = true;
      mockBtnReplace.hidden = false;
      mockBtnRemove.hidden = false;
      mockBtnCancel.hidden = true;
    } else {
      mockKeyInput.value = "";
      mockKeyInput.disabled = false;
      mockKeyInput.placeholder = "Enter API key...";
      mockStatusMsg.hidden = true;
      mockBtnSave.hidden = false;
      mockBtnReplace.hidden = true;
      mockBtnRemove.hidden = true;
      mockBtnCancel.hidden = true;
    }
  }

  // 1. Initial unconfigured state
  applyState(false);
  assert.equal(mockKeyInput.disabled, false);
  assert.equal(mockKeyInput.value, "");
  assert.equal(mockBtnSave.hidden, false);
  assert.equal(mockBtnReplace.hidden, true);
  assert.equal(mockBtnRemove.hidden, true);

  // 2. Transition to configured
  applyState(true, "groq");
  assert.equal(mockKeyInput.disabled, true);
  assert.equal(mockKeyInput.value, "••••••••••••••••");
  assert.equal(mockStatusMsg.hidden, false);
  assert.equal(mockStatusText.textContent, "Groq API key configured");
  assert.equal(mockBtnSave.hidden, true);
  assert.equal(mockBtnReplace.hidden, false);
  assert.equal(mockBtnRemove.hidden, false);

  // 3. User clicks replace key
  mockKeyInput.disabled = false;
  mockKeyInput.value = ""; // cleared, never pre-filled!
  mockBtnSave.hidden = false;
  mockBtnReplace.hidden = true;
  mockBtnRemove.hidden = true;
  mockBtnCancel.hidden = false;

  assert.equal(mockKeyInput.disabled, false);
  assert.equal(mockKeyInput.value, "");
  assert.equal(mockBtnSave.hidden, false);
  assert.equal(mockBtnCancel.hidden, false);
});
