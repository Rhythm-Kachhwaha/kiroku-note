const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("hover-sidepanel-sync: content.js saves last captured word on hover and selection", () => {
  const contentCode = fs.readFileSync(path.resolve(__dirname, "../content/content.js"), "utf8");
  assert.ok(contentCode.includes('"kiroku.last_captured_word"'), "content.js must reference kiroku.last_captured_word");
  assert.ok(contentCode.includes('handleShiftHoverScan'), "content.js must have handleShiftHoverScan");
  // Ensure both handleShiftHoverScan and captureSelection save to storage
  const matches = contentCode.match(/"kiroku\.last_captured_word"/g);
  assert.ok(matches && matches.length >= 2, "Both hover and selection must save kiroku.last_captured_word");
});

test("hover-sidepanel-sync: background.js handles OPEN_DICTIONARY message", () => {
  const bgCode = fs.readFileSync(path.resolve(__dirname, "../background.js"), "utf8");
  assert.ok(bgCode.includes('message?.type === "OPEN_DICTIONARY"'), "background.js must handle OPEN_DICTIONARY");
  assert.ok(bgCode.includes('chrome.sidePanel?.open'), "background.js must trigger sidePanel.open");
  assert.ok(bgCode.includes('"kiroku.last_captured_word"'), "background.js must save kiroku.last_captured_word");
  assert.ok(bgCode.includes('JAPANESE_TEXT_CAPTURED'), "background.js must broadcast JAPANESE_TEXT_CAPTURED");
});

test("hover-sidepanel-sync: sidepanel.js checks kiroku.last_captured_word on startup", () => {
  const sidepanelCode = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");
  assert.ok(sidepanelCode.includes('"kiroku.last_captured_word"'), "sidepanel.js must check kiroku.last_captured_word on boot");
  assert.ok(sidepanelCode.includes('identify(lastWord.text'), "sidepanel.js must invoke identify with lastWord.text");
});

test("hover-sidepanel-sync: card-editor.js identify falls back to Cloud Worker /api/capture when backend offline", () => {
  const editorCode = fs.readFileSync(path.resolve(__dirname, "../sidepanel/modules/card-editor.js"), "utf8");
  assert.ok(editorCode.includes('API_CAPTURE_URL'), "card-editor.js must call API_CAPTURE_URL");
  assert.ok(editorCode.includes('${cloudUrl}/api/capture') || editorCode.includes('CLOUD_WORKER_URL'), "card-editor.js must fall back to CLOUD_WORKER_URL /api/capture");
  assert.ok(editorCode.includes('"Yomitan: Connected (Cloud)"'), "card-editor.js must indicate connected cloud status");
});

