const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const wanakana = require("../lib/wanakana.js");

// Mock Minimal DOM for sidepanel logic
function createMockElement(id, tagName = "div") {
  return {
    id,
    tagName: tagName.toUpperCase(),
    textContent: "",
    value: "",
    hidden: false,
    className: "",
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this.contains(c)) this.remove(c);
          else this.add(c);
        } else if (force) {
          this.add(c);
        } else {
          this.remove(c);
        }
      }
    },
    addEventListener() {},
    append() {},
    setAttribute() {},
    getAttribute() { return null; }
  };
}

test("Hero View - reading, meanings summary, and badges format matching screenshot", (t) => {
  // Read sidepanel.js to extract tested functions
  const sidepanelJs = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");

  // Setup DOM elements
  const mockReading = createMockElement("reading");
  const mockExpression = createMockElement("expression", "h1");
  const mockMeanings = createMockElement("word-meanings-summary");
  const mockJlptBadge = createMockElement("showcase-jlpt-badge", "span");
  const mockPosBadge = createMockElement("showcase-pos-badge", "span");
  const mockPitchBadge = createMockElement("showcase-pitch-badge", "span");

  // Build sandboxed context with wanakana and elements
  const sandbox = {
    reading: mockReading,
    expression: mockExpression,
    wordMeaningsSummary: mockMeanings,
    showcaseJlptBadge: mockJlptBadge,
    showcasePosBadge: mockPosBadge,
    showcasePitchBadge: mockPitchBadge,
    currentDictionaryEntries: [],
    currentKanjiEntries: [],
    currentJlptLevel: null,
    wanakana: wanakana,
    getPitchCircleNumber(position) {
      const circles = ["⓪", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
      if (typeof position === "number" && position >= 0 && position < circles.length) {
        return circles[position];
      }
      return `[${position}]`;
    },
    formatPitchPatternName(patternName) {
      if (!patternName) return "";
      const lower = String(patternName).toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }
  };

  // Evaluate updateHeroReading, updateHeroMeanings, updateHeroBadges inside sandbox
  const fnCode = `
    ${sidepanelJs.slice(sidepanelJs.indexOf("function updateHeroReading"), sidepanelJs.indexOf("function formatKunyomi"))}
    return { updateHeroReading, updateHeroMeanings, updateHeroBadges };
  `;
  const fns = new Function(...Object.keys(sandbox), fnCode)(...Object.values(sandbox));

  // 1. Test updateHeroReading
  t.test("updateHeroReading formats Japanese reading with Romaji using middle dot separator", () => {
    fns.updateHeroReading("のむ", "飲む");
    assert.equal(mockReading.textContent, "のむ · nomu");

    fns.updateHeroReading("たべる", "食べる");
    assert.equal(mockReading.textContent, "たべる · taberu");

    fns.updateHeroReading("きろく", "");
    assert.equal(mockReading.textContent, "きろく · kiroku");

    // Fallback for non-kana text
    fns.updateHeroReading("water", "");
    assert.equal(mockReading.textContent, "water");

    // Empty text
    fns.updateHeroReading("", "");
    assert.equal(mockReading.textContent, "");
  });

  // 2. Test updateHeroMeanings
  t.test("updateHeroMeanings numbers senses and separates with middle dot", () => {
    const meaningData = {
      meaning: "1. to drink\n2. to take; consume\n3. to swallow\n4. to engulf"
    };
    fns.updateHeroMeanings(meaningData);
    assert.equal(mockMeanings.hidden, false);
    assert.equal(mockMeanings.textContent, "1. to drink · 2. to take; consume · 3. to swallow");

    // Semicolon delimited input
    fns.updateHeroMeanings({ meaning: "to eat; to consume; to dine; to have" });
    assert.equal(mockMeanings.textContent, "1. to eat · 2. to consume · 3. to dine");

    // Single sense
    fns.updateHeroMeanings({ meaning: "to drink" });
    assert.equal(mockMeanings.textContent, "1. to drink");

    // Empty
    fns.updateHeroMeanings({ meaning: "" });
    assert.equal(mockMeanings.hidden, true);
    assert.equal(mockMeanings.textContent, "");
  });

  // 3. Test updateHeroBadges for exact screenshot case: 飲む (JLPT N4, verb · godan, ⊚ heiban)
  t.test("updateHeroBadges formats JLPT, verb type, and pitch accent matching screenshot", () => {
    const body = {
      expression: "飲む",
      reading: "のむ",
      jlpt_level: "N4",
      verb_metadata: {
        is_verb: true,
        verb_type: "godan",
        is_transitive: true,
        is_intransitive: false,
        transitivity_label: "他動詞"
      },
      entries: [
        {
          dictionary: "Jitendex",
          pitches: [
            {
              position: 0,
              pattern_name: "heiban"
            }
          ]
        }
      ]
    };

    fns.updateHeroBadges(body);

    // JLPT Badge
    assert.equal(mockJlptBadge.hidden, false);
    assert.equal(mockJlptBadge.textContent, "JLPT N4");

    // POS / Verb Badge
    assert.equal(mockPosBadge.hidden, false);
    assert.equal(mockPosBadge.textContent, "verb · godan");
    assert.equal(mockPosBadge.className, "kn-badge pos");

    // Pitch Badge
    assert.equal(mockPitchBadge.hidden, false);
    assert.equal(mockPitchBadge.textContent, "⊚ heiban");
    assert.equal(mockPitchBadge.className, "kn-badge pitch");
  });

  // 4. Test other verb types & pitch patterns
  t.test("updateHeroBadges handles ichidan, suru, and non-zero pitch positions", () => {
    const body = {
      expression: "食べる",
      reading: "たべる",
      jlpt_level: "5",
      verb_metadata: {
        is_verb: true,
        verb_type: "ichidan",
        is_transitive: true,
        is_intransitive: false,
        transitivity_label: "他動詞"
      },
      entries: [
        {
          dictionary: "Jitendex",
          pitches: [
            {
              position: 2,
              pattern_name: "nakadaka"
            }
          ]
        }
      ]
    };

    fns.updateHeroBadges(body);
    assert.equal(mockJlptBadge.textContent, "JLPT N5");
    assert.equal(mockPosBadge.textContent, "verb · ichidan");
    assert.equal(mockPitchBadge.textContent, "② nakadaka");
  });
});
