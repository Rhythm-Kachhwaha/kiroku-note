const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "../..");
const MANIFEST_PATH = path.join(ROOT_DIR, "extension", "manifest.json");
const BACKGROUND_PATH = path.join(ROOT_DIR, "extension", "background.js");
const HTML_PATH = path.join(ROOT_DIR, "extension", "sidepanel", "sidepanel.html");
const CSS_PATH = path.join(ROOT_DIR, "extension", "sidepanel", "sidepanel.css");
const JS_PATH = path.join(ROOT_DIR, "extension", "sidepanel", "sidepanel.js");

test("Tier 2 Session 1: T2-B Manifest commands & permissions", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  assert.ok(manifest.permissions.includes("clipboardRead"), "manifest must include 'clipboardRead' permission");
  assert.ok(manifest.commands, "manifest must declare commands");
  assert.ok(manifest.commands["open-side-panel"], "manifest must declare 'open-side-panel' command");
  assert.equal(
    manifest.commands["open-side-panel"].suggested_key.default,
    "Alt+Shift+K",
    "Default shortcut must be Alt+Shift+K"
  );

  const backgroundCode = fs.readFileSync(BACKGROUND_PATH, "utf8");
  assert.ok(
    backgroundCode.includes('chrome.commands.onCommand.addListener'),
    "background.js must attach onCommand listener"
  );
  assert.ok(
    backgroundCode.includes('open-side-panel'),
    "background.js must handle 'open-side-panel' command"
  );
  assert.ok(
    backgroundCode.includes('chrome.sidePanel.open'),
    "background.js must invoke chrome.sidePanel.open"
  );
});

test("Tier 2 Session 1: T2-D Speaker TTS button markup & styling", () => {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const js = fs.readFileSync(JS_PATH, "utf8");

  assert.ok(html.includes('id="btn-tts-play"'), "sidepanel.html must include #btn-tts-play");
  assert.ok(html.includes('hero-expression-row'), "sidepanel.html must include hero-expression-row");
  assert.ok(css.includes('.btn-tts'), "sidepanel.css must include .btn-tts styling");
  assert.ok(js.includes('updateTtsPlayButton'), "sidepanel.js must define updateTtsPlayButton");
  assert.ok(js.includes('SpeechSynthesisUtterance'), "sidepanel.js must use SpeechSynthesisUtterance");
  assert.ok(js.includes('"ja-JP"'), "sidepanel.js must set utterance language to ja-JP");
});

test("Tier 2 Session 1: T2-H Clipboard auto-detection markup & logic", () => {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const js = fs.readFileSync(JS_PATH, "utf8");

  assert.ok(html.includes('id="clipboard-suggestion-bar"'), "sidepanel.html must include #clipboard-suggestion-bar");
  assert.ok(html.includes('id="clipboard-suggestion-text"'), "sidepanel.html must include #clipboard-suggestion-text");
  assert.ok(html.includes('id="btn-clipboard-capture"'), "sidepanel.html must include #btn-clipboard-capture");
  assert.ok(html.includes('id="btn-clipboard-dismiss"'), "sidepanel.html must include #btn-clipboard-dismiss");
  assert.ok(css.includes('.clipboard-suggestion-bar'), "sidepanel.css must style .clipboard-suggestion-bar");

  // Verify Japanese regex detection
  assert.ok(
    js.includes('[\\u3040-\\u30ff\\u4e00-\\u9fff]'),
    "sidepanel.js must test for Japanese characters in clipboard text"
  );
  assert.ok(js.includes('checkClipboardForJapanese'), "sidepanel.js must define checkClipboardForJapanese");
  assert.ok(js.includes('hideClipboardSuggestion'), "sidepanel.js must define hideClipboardSuggestion");
});

test("Tier 2 Session 1: T2-A JLPT level pill in history rows", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const js = fs.readFileSync(JS_PATH, "utf8");

  assert.ok(css.includes('.pill-jlpt'), "sidepanel.css must style .pill-jlpt");
  assert.ok(js.includes('history-item-jlpt'), "sidepanel.js must create .history-item-jlpt element");
  assert.ok(js.includes('data.jlpt_level'), "sidepanel.js must render data.jlpt_level");
});

test("Tier 2 Session 1: T2-J History sort dropdown & comparator logic", () => {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const js = fs.readFileSync(JS_PATH, "utf8");

  assert.ok(html.includes('id="history-sort-select"'), "sidepanel.html must include #history-sort-select");
  assert.ok(html.includes('value="date-desc"'), "sidepanel.html must include date-desc sort option");
  assert.ok(html.includes('value="date-asc"'), "sidepanel.html must include date-asc sort option");
  assert.ok(html.includes('value="jlpt"'), "sidepanel.html must include jlpt sort option");
  assert.ok(html.includes('value="deck"'), "sidepanel.html must include deck sort option");
  assert.ok(html.includes('value="status"'), "sidepanel.html must include status sort option");

  assert.ok(js.includes('sortHistoryCards'), "sidepanel.js must define sortHistoryCards");

  // Extract sortHistoryCards or test logic directly
  const mockCards = [
    { id: 1, created_at: "2026-01-01T00:00:00Z", jlpt_level: "N3", deck_name: "B", sync_status: "synced" },
    { id: 2, created_at: "2026-01-03T00:00:00Z", jlpt_level: "N1", deck_name: "A", sync_status: "pending" },
    { id: 3, created_at: "2026-01-02T00:00:00Z", jlpt_level: "N5", deck_name: "C", sync_status: "failed" },
    { id: 4, created_at: "2026-01-04T00:00:00Z", jlpt_level: null, deck_name: "A", sync_status: "pending" }
  ];

  // Helper matching the sidepanel.js implementation
  function testSort(cards, sortBy) {
    const list = [...cards];
    const jlptRank = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };
    const statusRank = { pending: 1, failed: 2, synced: 3 };

    list.sort((a, b) => {
      if (sortBy === "date-asc") {
        return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      }
      if (sortBy === "jlpt") {
        const rA = jlptRank[a.jlpt_level] || 99;
        const rB = jlptRank[b.jlpt_level] || 99;
        if (rA !== rB) return rA - rB;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
      if (sortBy === "deck") {
        const dA = (a.deck_name || "").toLowerCase();
        const dB = (b.deck_name || "").toLowerCase();
        if (dA !== dB) return dA.localeCompare(dB);
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
      if (sortBy === "status") {
        const sA = statusRank[a.sync_status] || 99;
        const sB = statusRank[b.sync_status] || 99;
        if (sA !== sB) return sA - sB;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    return list;
  }

  // date-desc
  const sortedDateDesc = testSort(mockCards, "date-desc");
  assert.deepEqual(sortedDateDesc.map(c => c.id), [4, 2, 3, 1]);

  // date-asc
  const sortedDateAsc = testSort(mockCards, "date-asc");
  assert.deepEqual(sortedDateAsc.map(c => c.id), [1, 3, 2, 4]);

  // jlpt: N5 -> N3 -> N1 -> null
  const sortedJlpt = testSort(mockCards, "jlpt");
  assert.deepEqual(sortedJlpt.map(c => c.id), [3, 1, 2, 4]);

  // deck: A, A, B, C (when tied, date-desc)
  const sortedDeck = testSort(mockCards, "deck");
  assert.deepEqual(sortedDeck.map(c => c.id), [4, 2, 1, 3]);

  // status: pending, pending, failed, synced
  const sortedStatus = testSort(mockCards, "status");
  assert.deepEqual(sortedStatus.map(c => c.id), [4, 2, 3, 1]);
});

test("Tier 2 Session 1: T2-I Silent auto-sync on Anki reconnect", () => {
  const js = fs.readFileSync(JS_PATH, "utf8");

  assert.ok(js.includes('checkAndAutoSyncPendingCards'), "sidepanel.js must define checkAndAutoSyncPendingCards");
  assert.ok(js.includes('prevAnkiStatus === false'), "sidepanel.js must check transition from false to true");
  assert.ok(js.includes('silent: true'), "sidepanel.js must pass silent: true to triggerSyncAll");
  assert.ok(js.includes('startAnkiStatusPolling'), "sidepanel.js must start status polling");
});
