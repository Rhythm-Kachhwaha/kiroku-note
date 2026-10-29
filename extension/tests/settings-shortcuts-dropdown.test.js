const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../sidepanel/sidepanel.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../sidepanel/sidepanel.css"), "utf8");

test("Keyboard shortcuts reference dropdown exists in Settings", () => {
  assert.ok(html.includes('id="shortcuts-settings-group"'), "#shortcuts-settings-group must exist in sidepanel.html");
  assert.ok(html.includes("Keyboard Shortcuts"), "Keyboard Shortcuts summary must be present");
  assert.ok(html.includes("Global &amp; Page Capture"), "Global capture category must exist");
  assert.ok(html.includes("Card Editor &amp; Mining"), "Card editor category must exist");
  assert.ok(html.includes("Video &amp; Subtitles"), "Video & Subtitles category must exist");
  assert.ok(html.includes("Quick Add &amp; Ask Tab"), "Quick Add category must exist");

  assert.ok(html.includes("Alt</kbd>+<kbd>Shift</kbd>+<kbd>K"), "Alt+Shift+K shortcut must be present");
  assert.ok(html.includes("Alt</kbd>+<kbd>O"), "Alt+O OCR shortcut must be present");
  assert.ok(html.includes("Alt</kbd>+<kbd>G"), "Alt+G grammar shortcut must be present");
  assert.ok(html.includes("Smart Save"), "Smart save shortcut description must be present");

  assert.ok(css.includes(".shortcuts-settings-details"), "CSS must style .shortcuts-settings-details");
  assert.ok(css.includes(".shortcuts-keys kbd"), "CSS must style .shortcuts-keys kbd");

  // Zero emojis guardrail
  const sectionStart = html.indexOf('id="shortcuts-settings-group"');
  const sectionEnd = html.indexOf('<!-- Card Template Settings', sectionStart);
  const section = html.slice(sectionStart, sectionEnd);
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(section), false, "Zero OS emojis permitted in shortcuts section");
});

