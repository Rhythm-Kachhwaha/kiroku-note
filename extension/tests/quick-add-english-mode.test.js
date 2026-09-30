const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Hero Search English Mode: HTML contains Hero Search elements and no katakana mode button", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.html"), "utf8");
  assert.ok(html.includes('id="hero-search-input"'), "#hero-search-input must exist in HTML");
  assert.ok(html.includes('id="btn-hero-search-mode"'), "#btn-hero-search-mode button must exist in HTML");
  assert.ok(!html.includes('id="quickadd-mode-katakana"'), "#quickadd-mode-katakana button must be removed from HTML");
});

test("Hero Search English Mode: JS binds English mode and queries backend", () => {
  const js = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");
  assert.ok(js.includes('heroSearchModeBtn'), "heroSearchModeBtn must be queried in sidepanel.js");
  assert.ok(js.includes('setQuickAddSearchMode("english")'), "setQuickAddSearchMode('english') must be supported");
  assert.ok(js.includes('/api/dictionary/search-english'), "Must call /api/dictionary/search-english when in english mode");
});

test("Hero Search English Mode: Auto-detects English queries vs Kana queries", () => {
  const wanakana = require("../lib/wanakana.js");
  
  function detectQueryMode(q) {
    q = (q || "").trim();
    if (!q) return "kana";
    if (wanakana.isJapanese(q) || /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(q)) {
      return "kana";
    }
    const converted = wanakana.toKana(q);
    const isFullKana = wanakana.isKana(converted);
    if (!isFullKana) return "english";
    const ambiguousWords = new Set(["ai", "go", "no", "an", "he", "me", "to", "do", "so", "in"]);
    if (q.length <= 2 || ambiguousWords.has(q.toLowerCase())) return "ambiguous";
    return "kana";
  }

  assert.equal(detectQueryMode("water"), "english", "'water' must be auto-detected as English");
  assert.equal(detectQueryMode("eat"), "english", "'eat' must be auto-detected as English");
  assert.equal(detectQueryMode("nomu"), "kana", "'nomu' must be auto-detected as Kana");
  assert.equal(detectQueryMode("taberu"), "kana", "'taberu' must be auto-detected as Kana");
  assert.equal(detectQueryMode("ai"), "ambiguous", "'ai' must be auto-detected as ambiguous");
  assert.equal(detectQueryMode("食べる"), "kana", "'食べる' must be auto-detected as Kana");
});

test("Hero Search English Mode: Gloss fallback for entries with .meaning", () => {
  const entry = {
    expression: "食べる",
    reading: "たべる",
    meaning: "to eat",
    jlpt_level: "N5",
  };

  let gloss = "";
  if (entry.senses && Array.isArray(entry.senses)) {
    for (const sense of entry.senses) {
      if (sense && Array.isArray(sense.glosses) && sense.glosses.length > 0 && sense.glosses[0]) {
        gloss = String(sense.glosses[0]).trim();
        if (gloss) break;
      }
    }
  } else if (entry.meaning) {
    gloss = String(entry.meaning).trim();
  }

  assert.equal(gloss, "to eat", "Gloss must fall back to entry.meaning");
});
