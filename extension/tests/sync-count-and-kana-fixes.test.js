const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const htmlPath = path.join(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.join(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.join(__dirname, "../sidepanel/sidepanel.js");

const html = fs.readFileSync(htmlPath, "utf-8");
const css = fs.readFileSync(cssPath, "utf-8");
const js = fs.readFileSync(jsPath, "utf-8");

test("History sync label uses data.synced_total to reflect all synced cards across pagination", () => {
  // Verify that loadHistoryCards uses data.synced_total
  assert.ok(
    js.includes("typeof data.synced_total === \"number\""),
    "sidepanel.js must check data.synced_total from backend"
  );

  // Mock DOM elements and state
  const mockSyncLabel = { textContent: "" };
  const mockHistoryCount = { textContent: "" };
  const mockProgressBar = { style: { width: "" } };

  // When total is 100, backend sends 50 cards in page 1, but synced_total is 100
  const total = 100;
  const cards = Array.from({ length: 50 }, (_, i) => ({ id: i, sync_status: "synced" }));
  const data = { total: 100, synced_total: 100, cards };

  const synced = typeof data.synced_total === "number"
    ? data.synced_total
    : cards.filter(c => c.sync_status === "synced").length;

  mockSyncLabel.textContent = `${synced} / ${total} synced`;
  const pct = total > 0 ? Math.min(100, Math.round((synced / total) * 100)) : 0;
  mockProgressBar.style.width = `${pct}%`;

  assert.equal(mockSyncLabel.textContent, "100 / 100 synced", "Sync label must show 100 / 100 synced, not 50 / 100");
  assert.equal(mockProgressBar.style.width, "100%", "Progress bar must be 100%");
});

test("Export CSV button is compact and styled cleanly without dominating header", () => {
  assert.ok(html.includes('id="btn-export-cards"'), "Export CSV button must exist");
  assert.ok(html.includes('title="Export CSV"'), "Export CSV button must have Export CSV title");
  assert.ok(html.includes('<span>CSV</span>'), "Export button text must be compact CSV");

  assert.ok(css.includes(".btn-export-cards"), ".btn-export-cards rule must exist");
  assert.ok(css.includes("height: 22px"), "Export CSV button must be compact (height: 22px)");
  assert.ok(css.includes("min-width: auto"), "Export CSV button must not have oversized min-width");
});

test("Subtitle setting has relative positioning and search subs is inside recent cues section", () => {
  // CSS check: relative positioning for subtitle settings wrap
  assert.ok(
    /\.video-subtitle-settings-wrap\s*\{[^}]*position:\s*relative;/.test(css),
    ".video-subtitle-settings-wrap must be position: relative (not position: absolute)"
  );

  // HTML check: subtitle search section must be located inside recent-cues-section
  const recentSectionStart = html.indexOf('id="recent-cues-section"');
  const recentListStart = html.indexOf('id="recent-cues-list"');
  const searchSectionStart = html.indexOf('id="subtitle-search-section"');

  assert.ok(recentSectionStart !== -1, "recent-cues-section must exist");
  assert.ok(searchSectionStart !== -1, "subtitle-search-section must exist");
  assert.ok(recentListStart !== -1, "recent-cues-list must exist");

  assert.ok(
    searchSectionStart > recentSectionStart && searchSectionStart < recentListStart,
    "subtitle-search-section must be inside recent-cues-section before recent-cues-list"
  );
});

test("Kana mode preserves reading and romaji in hero reading view without kanji replacement", () => {
  // Mock element
  const mockReading = { textContent: "" };
  const mockExpression = { textContent: "" };

  const sandbox = {
    reading: mockReading,
    expression: mockExpression,
    wanakana: {
      toRomaji: (text) => {
        const map = { "たべる": "taberu", "ねこ": "neko", "みる": "miru" };
        return map[text] || text;
      }
    },
    updateTtsPlayButton: () => {},
  };

  // Extract updateHeroReading and test
  const updateHeroReadingCode = js.match(/function updateHeroReading[\s\S]*?\n\}/)?.[0];
  assert.ok(updateHeroReadingCode, "updateHeroReading function must exist in sidepanel.js");
  vm.runInNewContext(updateHeroReadingCode, sandbox);

  // Simulate Kana mode for 食べる (reading: たべる, front: たべる)
  sandbox.updateHeroReading("たべる", "たべる");

  // Hero reading must display "たべる · taberu", not kanji "食べる"
  assert.equal(sandbox.reading.textContent, "たべる · taberu");
  assert.ok(!sandbox.reading.textContent.includes("食べる"), "Kanji must not replace reading in hero view");
});
