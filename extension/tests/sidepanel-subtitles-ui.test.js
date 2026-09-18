const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.join(__dirname, "../sidepanel/sidepanel.css");
const sidepanelHtml = fs.readFileSync(htmlPath, "utf-8");
const sidepanelCss = fs.readFileSync(cssPath, "utf-8");

test("Sidepanel UI - includes subtitle providers scripts and updated file input", () => {
  // Scripts must be present
  assert.ok(sidepanelHtml.includes('src="../lib/subtitle-provider.js"'), "Must include subtitle-provider.js");
  assert.ok(sidepanelHtml.includes('src="../lib/jimaku-provider.js"'), "Must include jimaku-provider.js");

  // File input must accept .ass and .ssa
  assert.ok(
    sidepanelHtml.includes('accept=".srt,.vtt,.ass,.ssa"') ||
    sidepanelHtml.includes('accept=".srt, .vtt, .ass, .ssa"'),
    "File input must accept .srt, .vtt, .ass, and .ssa"
  );

  // Search button and modal
  assert.ok(sidepanelHtml.includes('id="btn-search-subtitles"'), "Search subtitles button must exist");
  assert.ok(sidepanelHtml.includes('id="jimaku-search-modal"'), "Jimaku search modal must exist");
  assert.ok(sidepanelHtml.includes('id="jimaku-api-key-input"'), "Jimaku API key input must exist");
  assert.ok(sidepanelHtml.includes('id="jimaku-search-input"'), "Jimaku search input must exist");
  assert.ok(sidepanelHtml.includes('id="jimaku-results-list"'), "Jimaku results list must exist");
});

test("Sidepanel CSS - contains modal and button styles", () => {
  assert.ok(sidepanelCss.includes(".btn-search-subtitles"), "Must style search subtitles button");
  assert.ok(sidepanelCss.includes(".jimaku-modal"), "Must style Jimaku modal");
  assert.ok(sidepanelCss.includes(".jimaku-results-list"), "Must style Jimaku results list");
});
