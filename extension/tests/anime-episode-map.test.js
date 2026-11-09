const test = require("node:test");
const assert = require("node:assert/strict");
const { AnimeEpisodeMap } = require("../sidepanel/anime/episode-map.js");

function createMockDom() {
  const container = {
    innerHTML: "",
    querySelector(sel) {
      if (sel === ".anime-episode-map-wrap") return this._wrap;
      if (sel === ".anime-map-refresh-btn") return this._refreshBtn;
      if (sel === ".anime-map-loading") return this._loading;
      if (sel === ".anime-map-error") return this._error;
      if (sel === ".anime-map-content") return this._content;
      if (sel === "#anime-stat-known-pct") return this._knownPct;
      if (sel === "#anime-stat-unique-vocab") return this._uniqueVocab;
      if (sel === "#anime-stat-gap-words") return this._gapWords;
      if (sel === ".anime-jlpt-seg.n5") return this._n5;
      if (sel === ".anime-jlpt-seg.n4") return this._n4;
      if (sel === ".anime-jlpt-seg.n3") return this._n3;
      if (sel === ".anime-jlpt-seg.n2") return this._n2;
      if (sel === ".anime-jlpt-seg.n1") return this._n1;
      if (sel === ".anime-jlpt-seg.unranked") return this._unranked;
      if (sel === "#anime-gap-chips") return this._gapChips;
      if (sel === "#anime-grammar-list") return this._grammarList;
      return null;
    }
  };

  container._wrap = { className: "anime-episode-map-wrap" };
  container._refreshBtn = { addEventListener() {} };
  container._loading = { hidden: true };
  container._error = { hidden: true, textContent: "" };
  container._content = { hidden: true };
  container._knownPct = { textContent: "" };
  container._uniqueVocab = { textContent: "" };
  container._gapWords = { textContent: "" };
  container._n5 = { style: {} };
  container._n4 = { style: {} };
  container._n3 = { style: {} };
  container._n2 = { style: {} };
  container._n1 = { style: {} };
  container._unranked = { style: {} };
  container._gapChips = { children: [], replaceChildren() { this.children = []; }, appendChild(c) { this.children.push(c); } };
  container._grammarList = { children: [], replaceChildren() { this.children = []; }, appendChild(c) { this.children.push(c); } };

  global.document = {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        className: "",
        textContent: "",
        style: {},
        children: [],
        appendChild(child) { this.children.push(child); },
        addEventListener() {}
      };
    }
  };

  return container;
}

test("AnimeEpisodeMap - aggregates cue tokens into stats, JLPT distribution, and gap words", () => {
  const container = createMockDom();
  const map = new AnimeEpisodeMap({ container });

  const sampleAnnotatedCues = [
    {
      i: 0,
      text: "こんにちは世界",
      tokens: [
        { surface: "こんにちは", lemma: "こんにちは", pos: "感動詞", status: "known", level: "N5" },
        { surface: "世界", lemma: "世界", pos: "名詞", status: "gap", level: "N4" }
      ]
    },
    {
      i: 1,
      text: "魔法を使う",
      tokens: [
        { surface: "魔法", lemma: "魔法", pos: "名詞", status: "should_know", level: "N3" },
        { surface: "を", lemma: "を", pos: "助詞", status: "known", level: "N5" },
        { surface: "使う", lemma: "使う", pos: "動詞", status: "known", level: "N5" }
      ]
    }
  ];

  const aggregated = map.aggregateCuesData(sampleAnnotatedCues);

  assert.equal(aggregated.totalCues, 2);
  assert.equal(aggregated.totalTokens, 5);
  assert.equal(aggregated.knownTokens, 3);
  assert.equal(aggregated.knownPct, 60.0);
  assert.equal(aggregated.uniqueVocabCount, 5);

  assert.equal(aggregated.jlptCounts.N5, 3);
  assert.equal(aggregated.jlptCounts.N4, 1);
  assert.equal(aggregated.jlptCounts.N3, 1);

  assert.equal(aggregated.gapWords.length, 2);
  assert.equal(aggregated.gapWords[0].word, "世界");
  assert.equal(aggregated.gapWords[1].word, "魔法");
});

test("AnimeEpisodeMap - renders data correctly into DOM components", () => {
  const container = createMockDom();
  const map = new AnimeEpisodeMap({ container });

  const testData = {
    knownPct: 82.5,
    uniqueVocabCount: 142,
    gapWords: [
      { word: "葬送", count: 3 },
      { word: "勇者", count: 2 }
    ],
    jlptCounts: { N5: 50, N4: 30, N3: 15, N2: 5, N1: 0, unranked: 0 },
    grammarPoints: [
      {
        pattern: "〜てたまらない",
        level: "N3",
        meaning: "can't help but...",
        cueText: "気になってたまらない",
        startSec: 12.5
      }
    ]
  };

  map.renderData(testData);

  assert.equal(container._knownPct.textContent, "82.5%");
  assert.equal(container._uniqueVocab.textContent, "142");
  assert.equal(container._gapWords.textContent, "2");

  assert.equal(container._gapChips.children.length, 2);
  assert.equal(container._gapChips.children[0].textContent, "葬送 (3)");
  assert.equal(container._grammarList.children.length, 1);
});

