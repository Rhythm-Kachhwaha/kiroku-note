const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Quick Add English Mode: HTML contains English mode button", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.html"), "utf8");
  assert.ok(html.includes('id="quickadd-mode-english"'), "#quickadd-mode-english button must exist in HTML");
  assert.ok(!html.includes('id="quickadd-mode-katakana"'), "#quickadd-mode-katakana button must be removed from HTML");
});

test("Quick Add English Mode: JS binds English mode and updates search mode", () => {
  const js = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");
  assert.ok(js.includes('quickAddModeEnglish'), "quickAddModeEnglish must be queried in sidepanel.js");
  assert.ok(js.includes('setQuickAddSearchMode("english")'), "setQuickAddSearchMode('english') must be called on click");
  assert.ok(js.includes('/api/dictionary/search-english'), "Must call /api/dictionary/search-english when in english mode");
});

test("Quick Add English Mode: Gloss fallback for entries with .meaning", () => {
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
