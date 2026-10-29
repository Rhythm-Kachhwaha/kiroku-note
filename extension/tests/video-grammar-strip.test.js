const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "../sidepanel/sidepanel.html"), "utf8");
const js = fs.readFileSync(path.join(__dirname, "../sidepanel/sidepanel.js"), "utf8");
test("video grammar mounts in reserved slot and has session drawer", () => {
  assert.match(html, /id="active-sub-grammar-slot"/);
  assert.match(html, /id="video-grammar-session-drawer"/);
  assert.match(js, /renderVideoGrammar/);
  assert.match(js, /grammarCueCache/);
});
