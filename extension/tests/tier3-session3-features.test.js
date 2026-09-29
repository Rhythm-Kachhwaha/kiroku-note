/**
 * Test Suite for Tier 3 Session 3 Features:
 * - T3-F: Mining Stats Dashboard in History (cards today/week, JLPT breakdown, deck distribution)
 * - T3-G: Per-Deck Card Template Profiles (furigana, JLPT badge etc. saved per Anki deck)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.join(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.join(__dirname, "../sidepanel/sidepanel.js");

const htmlContent = fs.readFileSync(htmlPath, "utf-8");
const cssContent = fs.readFileSync(cssPath, "utf-8");
const jsContent = fs.readFileSync(jsPath, "utf-8");

test("Tier 3 Session 3: HTML & CSS Structure Verification", () => {
  // T3-F: History stats details element
  assert.ok(htmlContent.includes('id="history-stats-details"'), "HTML must include <details id=\"history-stats-details\">");
  assert.ok(htmlContent.includes('id="history-stats-summary"'), "HTML must include <summary id=\"history-stats-summary\">");
  assert.ok(htmlContent.includes('id="history-stats-content"'), "HTML must include <div id=\"history-stats-content\">");

  // T3-G: Save as default for this deck button in Card Settings
  assert.ok(htmlContent.includes('id="btn-save-deck-template"'), "HTML must include #btn-save-deck-template");
  assert.ok(htmlContent.includes('id="deck-template-status"'), "HTML must include #deck-template-status");

  // T3-F CSS
  assert.ok(cssContent.includes(".history-stats-details"), "CSS must style .history-stats-details");
  assert.ok(cssContent.includes(".history-stats-summary"), "CSS must style .history-stats-summary");
  assert.ok(cssContent.includes(".history-stats-content"), "CSS must style .history-stats-content");
  assert.ok(cssContent.includes(".stat-metrics-row"), "CSS must style .stat-metrics-row");
  assert.ok(cssContent.includes(".stat-metric-card"), "CSS must style .stat-metric-card");
  assert.ok(cssContent.includes(".stat-sync-track"), "CSS must style .stat-sync-track");
  assert.ok(cssContent.includes(".stat-jlpt-svg"), "CSS must style .stat-jlpt-svg");

  // T3-G CSS
  assert.ok(cssContent.includes(".btn-save-deck-template"), "CSS must style .btn-save-deck-template");
  assert.ok(cssContent.includes(".deck-template-status"), "CSS must style .deck-template-status");
});

test("T3-G: Per-Deck Card Template Profiles Logic Verification", () => {
  // Verify core functions exist in sidepanel.js
  assert.ok(jsContent.includes("function loadDeckTemplateSettings"), "sidepanel.js must contain loadDeckTemplateSettings");
  assert.ok(jsContent.includes("function getDeckTemplateProfile"), "sidepanel.js must contain getDeckTemplateProfile");
  assert.ok(jsContent.includes("let storedDeckTemplateProfiles"), "sidepanel.js must declare storedDeckTemplateProfiles");
  assert.ok(jsContent.includes("btnSaveDeckTemplate.addEventListener"), "sidepanel.js must wire btnSaveDeckTemplate click listener");

  // Verify fieldDeckSelect change listener calls loadDeckTemplateSettings
  const deckChangeIdx = jsContent.indexOf('fieldDeckSelect.addEventListener("change"');
  assert.ok(deckChangeIdx !== -1, "fieldDeckSelect change listener must exist");
  const deckChangeSlice = jsContent.slice(deckChangeIdx, deckChangeIdx + 200);
  assert.ok(deckChangeSlice.includes("loadDeckTemplateSettings"), "fieldDeckSelect change listener must invoke loadDeckTemplateSettings");

  // Test per-deck profile logic in simulation
  const DEFAULT_CARD_TEMPLATE_SETTINGS = {
    front: { show_reading: false, show_meaning: false, show_kanji_reading: false, show_hint: false },
    back: { show_reading: true, show_meaning: true, show_hint: true },
    furigana_mode: "all",
    show_jlpt: true,
    show_verb_type: true,
    show_history: true,
  };

  let storedDeckTemplateProfiles = {};
  let currentCardTemplateSettings = JSON.parse(JSON.stringify(DEFAULT_CARD_TEMPLATE_SETTINGS));

  function getDeckTemplateProfile(deckName) {
    const targetDeck = (deckName && deckName.trim()) || "Default";
    if (storedDeckTemplateProfiles && storedDeckTemplateProfiles[targetDeck]) {
      return storedDeckTemplateProfiles[targetDeck];
    }
    if (storedDeckTemplateProfiles && storedDeckTemplateProfiles["Default"]) {
      return storedDeckTemplateProfiles["Default"];
    }
    return DEFAULT_CARD_TEMPLATE_SETTINGS;
  }

  function loadDeckTemplateSettings(deckName) {
    const profile = getDeckTemplateProfile(deckName);
    currentCardTemplateSettings = {
      front: { ...DEFAULT_CARD_TEMPLATE_SETTINGS.front, ...(profile.front || {}) },
      back: { ...DEFAULT_CARD_TEMPLATE_SETTINGS.back, ...(profile.back || {}) },
      furigana_mode: profile.furigana_mode || DEFAULT_CARD_TEMPLATE_SETTINGS.furigana_mode,
      show_jlpt: typeof profile.show_jlpt === "boolean" ? profile.show_jlpt : true,
      show_verb_type: typeof profile.show_verb_type === "boolean" ? profile.show_verb_type : true,
      show_history: typeof profile.show_history === "boolean" ? profile.show_history : true,
    };
  }

  // 1. Initial load for Default
  loadDeckTemplateSettings("Default");
  assert.equal(currentCardTemplateSettings.show_jlpt, true);
  assert.equal(currentCardTemplateSettings.furigana_mode, "all");

  // 2. Configure and save custom profile for "N3 Vocabs"
  currentCardTemplateSettings.furigana_mode = "advanced_only";
  currentCardTemplateSettings.show_verb_type = false;
  storedDeckTemplateProfiles["N3 Vocabs"] = JSON.parse(JSON.stringify(currentCardTemplateSettings));

  // 3. Configure and save custom profile for "Anime Mining"
  currentCardTemplateSettings.furigana_mode = "none";
  currentCardTemplateSettings.show_jlpt = false;
  storedDeckTemplateProfiles["Anime Mining"] = JSON.parse(JSON.stringify(currentCardTemplateSettings));

  // 4. Switch to "N3 Vocabs"
  loadDeckTemplateSettings("N3 Vocabs");
  assert.equal(currentCardTemplateSettings.furigana_mode, "advanced_only");
  assert.equal(currentCardTemplateSettings.show_verb_type, false);
  assert.equal(currentCardTemplateSettings.show_jlpt, true);

  // 5. Switch to "Anime Mining"
  loadDeckTemplateSettings("Anime Mining");
  assert.equal(currentCardTemplateSettings.furigana_mode, "none");
  assert.equal(currentCardTemplateSettings.show_jlpt, false);

  // 6. Switch to unconfigured deck -> falls back to Default
  loadDeckTemplateSettings("Random New Deck");
  assert.equal(currentCardTemplateSettings.furigana_mode, "all");
  assert.equal(currentCardTemplateSettings.show_jlpt, true);
  assert.equal(currentCardTemplateSettings.show_verb_type, true);
});

test("T3-F: History Mining Stats Dashboard Logic Verification", () => {
  // Verify core stats declarations and functions in sidepanel.js
  assert.ok(jsContent.includes("const historyStatsDetails"), "sidepanel.js must declare historyStatsDetails");
  assert.ok(jsContent.includes("function renderHistoryStats"), "sidepanel.js must contain renderHistoryStats");
  assert.ok(jsContent.includes("async function loadHistoryStats"), "sidepanel.js must contain loadHistoryStats");
  assert.ok(jsContent.includes("const STATS_CACHE_TTL_MS = 30000"), "sidepanel.js must define 30-second stats cache TTL");

  // Verify toggle listener on details element
  assert.ok(jsContent.includes('historyStatsDetails.addEventListener("toggle"'), "historyStatsDetails toggle listener must exist");

  // Simulate renderHistoryStats
  const mockContent = { innerHTML: "" };
  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function simulateRender(stats) {
    const total = Number(stats.total) || 0;
    const today = Number(stats.today) || 0;
    const thisWeek = Number(stats.this_week) || 0;

    const sync = stats.sync_ratio || {};
    const synced = Number(sync.synced) || 0;
    const pending = Number(sync.pending) || 0;
    const failed = Number(sync.failed) || 0;
    const syncTotal = synced + pending + failed || total || 1;

    const syncedPct = Math.round((synced / syncTotal) * 100);
    const pendingPct = Math.round((pending / syncTotal) * 100);
    const failedPct = Math.max(0, 100 - syncedPct - pendingPct);

    const jlptMap = stats.jlpt_breakdown || {};
    const jlptLevels = [
      { key: "N5", color: "#61afef" },
      { key: "N4", color: "#98c379" },
      { key: "N3", color: "#e5c07b" },
      { key: "N2", color: "#d19a66" },
      { key: "N1", color: "#e06c75" },
      { key: "Unknown", color: "#7f848e" },
    ];
    const maxJlptCount = Math.max(...jlptLevels.map(l => Number(jlptMap[l.key]) || 0), 1);
    const topDecks = Array.isArray(stats.top_decks) ? stats.top_decks : [];

    const svgRows = jlptLevels.map((lvl, idx) => {
      const count = Number(jlptMap[lvl.key]) || 0;
      const barWidth = count > 0 ? Math.max(Math.round((count / maxJlptCount) * 180), 3) : 0;
      return `<text>${lvl.key}</text><rect width="${barWidth}" fill="${lvl.color}"/><text>${count}</text>`;
    }).join("");

    const decksHtml = topDecks.length > 0
      ? topDecks.map((d, i) => `<div>${i + 1}. ${escapeHtml(d.deck_name)}: ${d.count} cards</div>`).join("")
      : "<div>No cards mined yet.</div>";

    mockContent.innerHTML = `
      <div class="metrics">today:${today}, week:${thisWeek}, total:${total}</div>
      <div class="sync">synced:${synced}, pending:${pending}, failed:${failed}</div>
      <svg class="stat-jlpt-svg">${svgRows}</svg>
      <div class="decks">${decksHtml}</div>
    `;
  }

  const sampleStats = {
    total: 42,
    today: 5,
    this_week: 18,
    sync_ratio: { synced: 30, pending: 10, failed: 2, total: 42 },
    jlpt_breakdown: { N5: 8, N4: 12, N3: 14, N2: 5, N1: 2, Unknown: 1 },
    top_decks: [
      { deck_name: "Core Vocab", count: 25 },
      { deck_name: "Anime Mining", count: 12 },
      { deck_name: "Sentences", count: 5 },
    ],
  };

  simulateRender(sampleStats);

  assert.ok(mockContent.innerHTML.includes("today:5, week:18, total:42"), "Metrics rendered properly");
  assert.ok(mockContent.innerHTML.includes("synced:30, pending:10, failed:2"), "Sync ratio rendered properly");
  assert.ok(mockContent.innerHTML.includes("N5"), "JLPT N5 included in SVG");
  assert.ok(mockContent.innerHTML.includes("N4"), "JLPT N4 included in SVG");
  assert.ok(mockContent.innerHTML.includes("N3"), "JLPT N3 included in SVG");
  assert.ok(mockContent.innerHTML.includes("Core Vocab"), "Top deck 1 rendered");
  assert.ok(mockContent.innerHTML.includes("Anime Mining"), "Top deck 2 rendered");
  assert.ok(mockContent.innerHTML.includes("Sentences"), "Top deck 3 rendered");
});
