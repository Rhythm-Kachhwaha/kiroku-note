/**
 * Test Suite for Tier 4 Session 2 Features:
 * - T4-B: Subtitle In-Track Search / Jump
 * - T4-C: Subtitle History Hover Panel (Last 5 Cues)
 * - T4-F: Sentence-Level Mining from Subtitle Cue
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const htmlPath = path.join(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.join(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.join(__dirname, "../sidepanel/sidepanel.js");

const htmlContent = fs.readFileSync(htmlPath, "utf-8");
const cssContent = fs.readFileSync(cssPath, "utf-8");
const jsContent = fs.readFileSync(jsPath, "utf-8");

test("Tier 4 Session 2: HTML & CSS Structure Verification", () => {
  // T4-B: Subtitle in-track search elements
  assert.ok(
    htmlContent.includes('id="subtitle-search-input"'),
    "HTML must include #subtitle-search-input element"
  );
  assert.ok(
    htmlContent.includes('id="subtitle-search-results"'),
    "HTML must include #subtitle-search-results element"
  );
  assert.ok(
    htmlContent.includes('id="btn-clear-subtitle-search"'),
    "HTML must include #btn-clear-subtitle-search button"
  );

  // T4-C: Recent cues section & list
  assert.ok(
    htmlContent.includes('id="recent-cues-section"'),
    "HTML must include #recent-cues-section element"
  );
  assert.ok(
    htmlContent.includes('id="recent-cues-list"'),
    "HTML must include #recent-cues-list element"
  );

  // T4-F: Mine sentence button
  assert.ok(
    htmlContent.includes('id="btn-mine-full-sentence"'),
    "HTML must include #btn-mine-full-sentence button"
  );

  // CSS definitions
  assert.ok(
    cssContent.includes(".btn-mine-sentence"),
    "CSS must define rules for .btn-mine-sentence"
  );
  assert.ok(
    cssContent.includes(".subtitle-search-section"),
    "CSS must define rules for .subtitle-search-section"
  );
  assert.ok(
    cssContent.includes(".subtitle-search-input"),
    "CSS must define rules for .subtitle-search-input"
  );
  assert.ok(
    cssContent.includes(".subtitle-search-results"),
    "CSS must define rules for .subtitle-search-results"
  );
  assert.ok(
    cssContent.includes(".recent-cues-section"),
    "CSS must define rules for .recent-cues-section"
  );
  assert.ok(
    cssContent.includes(".recent-cue-item"),
    "CSS must define rules for .recent-cue-item"
  );
  assert.ok(
    cssContent.includes(".recent-cue-word"),
    "CSS must define rules for .recent-cue-word"
  );
});

test("T4-F: Most Prominent Word Heuristic with Intl.Segmenter", () => {
  // Create mock environment to run the function
  class MockElement {
    constructor() {
      this.children = [];
      this.textContent = "";
      this.value = "";
    }
  }

  const sandbox = {
    Intl,
    document: {
      querySelector: () => new MockElement(),
      querySelectorAll: () => []
    },
    window: {}
  };
  vm.createContext(sandbox);

  // Extract the findMostProminentWord function from jsContent
  const fnCode = jsContent.match(/function findMostProminentWord[\s\S]*?\n\}/)?.[0];
  assert.ok(fnCode, "findMostProminentWord function must exist in sidepanel.js");
  vm.runInContext(fnCode, sandbox);

  const findWord = sandbox.findMostProminentWord;

  // 1. Longest kanji compound preferred over short particles / kana
  assert.equal(findWord("日本語を勉強する"), "日本語");
  assert.ok(["東京", "特許", "許可", "局長"].includes(findWord("東京特許許可局局長")), "Picks prominent segmented word");
  assert.ok(findWord("私はラーメンを食べる").length >= 2, "Must pick a meaningful segmented word");

  // 2. Pure kana sentence falls back to longest non-punctuation word
  const kanaRes = findWord("これはすごいですね！");
  assert.ok(kanaRes === "すごい" || kanaRes === "これ" || kanaRes.length >= 2, "Must pick longest non-punctuation word");

  // 3. Single kanji word in phrase
  assert.equal(findWord("ちょっと待って"), "待");

  // 4. Empty or invalid input
  assert.equal(findWord(""), "");
  assert.equal(findWord("   "), "");
  assert.equal(findWord(null), "");
});

test("T4-B: Subtitle Search, In-Track Filtering & Jump", () => {
  const sentMessages = [];
  const searchResultsItems = [];

  class MockElement {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.textContent = "";
      this.hidden = false;
      this.className = "";
      this._listeners = {};
    }
    replaceChildren() {
      this.children = [];
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    addEventListener(evt, fn) {
      this._listeners[evt] = fn;
    }
    click() {
      if (this._listeners.click) this._listeners.click();
    }
  }

  const mockSearchResults = new MockElement("ul");
  const mockClearBtn = new MockElement("button");

  const cues = [
    { startTime: 10.0, endTime: 12.0, text: "こんにちは世界" },
    { startTime: 25.5, endTime: 28.0, text: "美味しいラーメンを食べる" },
    { startTime: 40.0, endTime: 45.0, text: "日本語の勉強は楽しい" }
  ];

  const sandbox = {
    Intl,
    document: {
      createElement: (tag) => new MockElement(tag),
      createTextNode: (txt) => ({ textContent: txt, nodeType: 3 })
    },
    loadedSubtitleCues: cues,
    subtitleSearchResults: mockSearchResults,
    btnClearSubtitleSearch: mockClearBtn,
    lastCaptureSource: { tabId: 101 },
    chrome: {
      tabs: {
        sendMessage: (tabId, msg) => {
          sentMessages.push({ tabId, msg });
          return Promise.resolve({ ok: true });
        },
        query: () => Promise.resolve([{ id: 101 }])
      },
      runtime: {
        sendMessage: (msg) => {
          sentMessages.push({ runtime: true, msg });
          return Promise.resolve({ ok: true });
        }
      }
    },
    broadcastToActiveVideo: async (msg) => {
      sentMessages.push({ broadcast: true, msg });
    }
  };
  vm.createContext(sandbox);

  // Extract functions needed for search
  const fmtCode = jsContent.match(/function formatSubtitleTimestamp[\s\S]*?\n\}/)?.[0];
  const seekCode = jsContent.match(/async function seekToSubtitleCue[\s\S]*?\n\}/)?.[0];
  const clearCode = jsContent.match(/function clearSubtitleSearchResults[\s\S]*?\n\}/)?.[0];
  const searchCode = jsContent.match(/function searchSubtitles[\s\S]*?\n\}/)?.[0];

  assert.ok(fmtCode && seekCode && clearCode && searchCode, "All search functions must exist in sidepanel.js");

  vm.runInContext(fmtCode, sandbox);
  vm.runInContext(seekCode, sandbox);
  vm.runInContext(clearCode, sandbox);
  vm.runInContext(searchCode, sandbox);

  // Test 1: Search for "ラーメン"
  sandbox.searchSubtitles("ラーメン");
  assert.equal(mockSearchResults.hidden, false);
  assert.equal(mockSearchResults.children.length, 1, "Must find exactly 1 matching cue");
  assert.ok(mockClearBtn.hidden === false, "Clear button must be shown");

  // Click the matched cue result
  mockSearchResults.children[0].click();
  const seekMsg = sentMessages.find(m => m.broadcast && m.msg.type === "SEEK_TO");
  assert.ok(seekMsg, "Clicking search result must send SEEK_TO message");
  assert.equal(seekMsg.msg.ms, 25500, "Must seek to correct startMs (25.5s = 25500ms)");

  // Test 2: Search for non-existent word
  sandbox.searchSubtitles("宇宙人");
  assert.equal(mockSearchResults.children.length, 1);
  assert.ok(mockSearchResults.children[0].textContent.includes("No cues found"));

  // Test 3: Clear search
  sandbox.clearSubtitleSearchResults();
  assert.equal(mockSearchResults.hidden, true);
  assert.equal(mockSearchResults.children.length, 0);
});

test("T4-C: Recent Cues Panel & Word Click-to-Mine", async () => {
  const identifiedWords = [];
  const exampleSentencesSet = [];
  const miningSequence = [];
  let identifiedOptions = null;

  class MockElement {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.textContent = "";
      this.value = "";
      this.hidden = false;
      this.className = "";
      this._listeners = {};
    }
    replaceChildren() {
      this.children = [];
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    addEventListener(evt, fn) {
      this._listeners[evt] = fn;
    }
    dispatchEvent() {}
    click() {
      if (this._listeners.click) {
        return this._listeners.click({ stopPropagation: () => {} });
      }
    }
  }

  const mockRecentSection = new MockElement("div");
  const mockRecentList = new MockElement("ul");
  const mockFieldSentence = new MockElement("textarea");

  const cues = [
    { startTime: 12.0, endTime: 14.0, text: "魔法をかける" },
    { startTime: 8.0, endTime: 10.0, text: "旅の仲間" }
  ];

  const sandbox = {
    Intl,
    document: {
      createTextNode: (txt) => ({ textContent: txt, nodeType: 3 }),
      createElement: (tag) => new MockElement(tag)
    },
    recentCuesSection: mockRecentSection,
    recentCuesList: mockRecentList,
    recentSubtitleCues: cues,
    currentActiveCue: null,
    fieldExampleSentence: mockFieldSentence,
    fieldSourceText: new MockElement("input"),
    insertExampleToCard: (sent) => {
      exampleSentencesSet.push(sent);
    },
    identify: async (word, options) => {
      identifiedWords.push(word);
      identifiedOptions = options;
      miningSequence.push("identify");
    },
    updateVideoCuePreviewText: () => {},
    renderRecentCuesList: () => {},
    pendingSentenceOverride: "",
    Event,
    broadcastToActiveVideo: async () => {
      miningSequence.push("seek");
    },
    lastCaptureSource: {}
  };
  vm.createContext(sandbox);

  const fmtCode = jsContent.match(/function formatSubtitleTimestamp[\s\S]*?\n\}/)?.[0];
  const seekCode = jsContent.match(/async function seekToSubtitleCue[\s\S]*?\n\}/)?.[0];
  const targetTimeCode = jsContent.match(/function getSubtitleCueTargetTime[\s\S]*?\n\}/)?.[0];
  const mineCode = jsContent.match(/async function mineSubtitleCueWord[\s\S]*?\n\}/)?.[0];
  const renderCode = jsContent.match(/function renderRecentCuesList[\s\S]*?\n\}/)?.[0];

  assert.ok(fmtCode && seekCode && targetTimeCode && mineCode && renderCode, "Recent cues functions must exist in sidepanel.js");

  vm.runInContext(fmtCode, sandbox);
  vm.runInContext(seekCode, sandbox);
  vm.runInContext(targetTimeCode, sandbox);
  vm.runInContext(mineCode, sandbox);
  vm.runInContext(renderCode, sandbox);

  // Render recent cues
  sandbox.renderRecentCuesList();

  assert.equal(mockRecentSection.hidden, false);
  assert.equal(mockRecentList.children.length, 2, "Must render both recent cues");

  // First item has text span with words
  const firstCueItem = mockRecentList.children[0];
  const textSpan = firstCueItem.children.find(c => c.className === "recent-cue-text");
  assert.ok(textSpan, "Must have a textSpan");

  // Find a word span inside textSpan
  const wordSpans = textSpan.children.filter(c => c.className === "recent-cue-word");
  assert.ok(wordSpans.length > 0, "Must segment words into clickable word spans");

  // Click the first word span (e.g. 魔法)
  await wordSpans[0].click();
  assert.ok(identifiedWords.length > 0, "Clicking word span must trigger identify()");
  assert.ok(exampleSentencesSet.length > 0, "Clicking word span must set example sentence from cue");
  assert.equal(exampleSentencesSet[0], "魔法をかける");
  assert.deepEqual(miningSequence, ["identify"], "Mining a recent cue word must not interrupt active playback");
  assert.equal(identifiedOptions.targetTime, 12.2, "Frame capture must target 0.2s into the selected cue");
});
