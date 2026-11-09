const { getSidepanelSource } = require("./helpers/source.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "../sidepanel/sidepanel.html"), "utf8");
const js = getSidepanelSource();
test("video grammar mounts in reserved slot and has session drawer", () => {
  assert.match(html, /id="active-sub-grammar-slot"/);
  assert.match(html, /id="video-grammar-session-drawer"/);
  assert.match(js, /renderVideoGrammar/);
  assert.match(js, /grammarCueCache/);
  assert.match(js, /type: "SEEK_TO", ms:/);
  assert.doesNotMatch(js, /type: "SEEK_TO", timeMs:/);
});
