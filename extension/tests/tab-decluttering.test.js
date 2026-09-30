const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");

const htmlContent = fs.readFileSync(htmlPath, "utf8");
const cssContent = fs.readFileSync(cssPath, "utf8");
const jsContent = fs.readFileSync(jsPath, "utf8");

test("Session 10: Video Tab Decluttering DOM & Reordering", () => {
  // 1. Source bar is present
  assert.ok(htmlContent.includes('id="video-source-bar"'), "Must define #video-source-bar");
  assert.ok(htmlContent.includes('id="load-subtitles-btn"'), "Must include #load-subtitles-btn in source bar");
  assert.ok(htmlContent.includes('id="subtitles-file-status"'), "Must include #subtitles-file-status in source bar");
  assert.ok(htmlContent.includes('id="toggle-subtitles-display"'), "Must include #toggle-subtitles-display in source bar");

  // 2. Ordering: Source bar precedes cue preview
  const idxSourceBar = htmlContent.indexOf('id="video-source-bar"');
  const idxCuePreview = htmlContent.indexOf('id="video-current-cue-preview"');
  const idxToolsDetails = htmlContent.indexOf('id="video-tools-details"');
  assert.ok(idxSourceBar < idxCuePreview, "Source bar must precede current cue preview");
  assert.ok(idxCuePreview < idxToolsDetails, "Cue preview must precede tools details");

  // 3. Collapsed tools row contains search, recent cues, folder, offset stepper
  assert.ok(htmlContent.includes('class="video-tools-details"'), "Must define video-tools-details");
  assert.ok(htmlContent.includes('id="subtitle-search-section"'), "Must contain #subtitle-search-section");
  assert.ok(htmlContent.includes('id="recent-cues-section"'), "Must contain #recent-cues-section");
  assert.ok(htmlContent.includes('id="subtitle-folder-bar"'), "Must contain #subtitle-folder-bar");

  // 4. Streamlined offset stepper
  assert.ok(htmlContent.includes('class="video-offset-stepper"'), "Must define .video-offset-stepper");
  assert.ok(htmlContent.includes('id="offset-minus-btn"'), "Must include #offset-minus-btn");
  assert.ok(htmlContent.includes('id="offset-display"'), "Must include #offset-display");
  assert.ok(htmlContent.includes('id="offset-plus-btn"'), "Must include #offset-plus-btn");
  assert.ok(htmlContent.includes('id="offset-reset-btn"'), "Must include #offset-reset-btn");

  // 5. Jimaku API key & download folder are in Settings -> Video (#settings-group-video)
  const idxSettingsVideo = htmlContent.indexOf('id="settings-group-video"');
  const idxJimakuKey = htmlContent.indexOf('id="jimaku-api-key-input"');
  const idxJimakuFolder = htmlContent.indexOf('id="jimaku-download-folder-input"');
  assert.ok(idxSettingsVideo !== -1, "Must have #settings-group-video");
  assert.ok(idxJimakuKey > idxSettingsVideo, "Jimaku API key must be located in #settings-group-video");
  assert.ok(idxJimakuFolder > idxSettingsVideo, "Jimaku download folder must be located in #settings-group-video");
});

test("Session 10: Ask Drawer Streamlining (Unified Chips & Send Icon Button)", () => {
  // 1. Send button is an icon button
  assert.ok(htmlContent.includes('class="btn-ask-submit btn-ask-submit-icon"'), "Send button must have .btn-ask-submit-icon");
  assert.ok(htmlContent.includes('class="send-icon"'), "Send button must contain .send-icon SVG");

  // 2. Unified chips bar exists
  assert.ok(htmlContent.includes('id="ask-prompt-chips-wrap"'), "Must define #ask-prompt-chips-wrap");

  // 3. Context banner action buttons are hidden in favor of unified chips
  const ctxActionsMatch = htmlContent.match(/<div class="ask-context-actions"([^>]*)>/);
  assert.ok(ctxActionsMatch, "Must find ask-context-actions");
  assert.ok(ctxActionsMatch[1].includes('display:none'), "ask-context-actions must be hidden");
});

test("Session 10: Media Status Chips Row in Card Workspace", () => {
  assert.ok(htmlContent.includes('id="media-status-chips"'), "Must define #media-status-chips container");
  assert.ok(htmlContent.includes('id="media-chip-image"'), "Must define #media-chip-image");
  assert.ok(htmlContent.includes('id="media-chip-audio"'), "Must define #media-chip-audio");
  assert.ok(htmlContent.includes('id="btn-media-chip-remove-image"'), "Must define remove button for image chip");
  assert.ok(htmlContent.includes('id="btn-media-chip-remove-audio"'), "Must define remove button for audio chip");
});

test("Session 10: History Tab Overflow Action Menu & Consolidated Summary", () => {
  // 1. Overflow action menu
  assert.ok(htmlContent.includes('id="btn-history-overflow"'), "Must define #btn-history-overflow");
  assert.ok(htmlContent.includes('id="history-overflow-menu"'), "Must define #history-overflow-menu");
  assert.ok(htmlContent.includes('id="btn-toggle-bulk-select"'), "Must define #btn-toggle-bulk-select");

  // 2. Consolidated summary line
  assert.ok(htmlContent.includes('id="history-stats-summary-line"'), "Must define #history-stats-summary-line");
});

test("Session 10: CSS Styling Rules for Decluttered Tabs", () => {
  assert.ok(cssContent.includes(".video-source-bar"), "CSS must style .video-source-bar");
  assert.ok(cssContent.includes(".video-tools-details"), "CSS must style .video-tools-details");
  assert.ok(cssContent.includes(".video-offset-stepper"), "CSS must style .video-offset-stepper");
  assert.ok(cssContent.includes(".btn-ask-submit-icon"), "CSS must style .btn-ask-submit-icon");
  assert.ok(cssContent.includes(".media-status-chips"), "CSS must style .media-status-chips");
  assert.ok(cssContent.includes(".media-chip"), "CSS must style .media-chip");
  assert.ok(cssContent.includes(".btn-history-overflow"), "CSS must style .btn-history-overflow");
  assert.ok(cssContent.includes(".history-overflow-menu"), "CSS must style .history-overflow-menu");
  assert.ok(cssContent.includes(".history-stats-summary-line"), "CSS must style .history-stats-summary-line");
  assert.ok(cssContent.includes(".history-pagination-wrap"), "CSS must style .history-pagination-wrap");
});

test("Session 10: History Pagination Logic for 500 Cards", () => {
  function createMockElement(tagName = "div", id = "", className = "") {
    return {
      tagName: tagName.toUpperCase(),
      id,
      className,
      children: [],
      dataset: {},
      _listeners: {},
      style: {},
      hidden: false,
      replaceChildren(...nodes) { this.children = nodes; },
      append(...nodes) { this.children.push(...nodes); },
      querySelector(sel) {
        if (sel.startsWith("#")) {
          const targetId = sel.slice(1);
          return this.children.find(c => c.id === targetId) || null;
        }
        return null;
      },
      querySelectorAll() { return []; },
      addEventListener(type, fn) {
        if (!this._listeners[type]) this._listeners[type] = [];
        this._listeners[type].push(fn);
      },
      setAttribute() {},
      classList: {
        add(c) { if (!this._classes) this._classes = new Set(); this._classes.add(c); },
        remove(c) { if (this._classes) this._classes.delete(c); },
        has(c) { return this._classes ? this._classes.has(c) : false; }
      }
    };
  }

  // Generate 120 cards to test chunking
  const mockCards = Array.from({ length: 120 }, (_, i) => ({
    id: i + 1,
    expression: `単語${i + 1}`,
    reading: `たんご${i + 1}`,
    meaning: `Meaning ${i + 1}`,
    deck_name: "Default",
    sync_status: i % 2 === 0 ? "synced" : "pending"
  }));

  // Mock DOM
  global.document = {
    createElement: (tag) => createMockElement(tag),
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  global.historyCardsList = createMockElement("div", "history-cards-list");
  global.selectedHistoryCardIds = new Set();
  global.selectedHistoryCardId = null;
  global.currentRenderedCardIds = [];

  const sidepanel = require("../sidepanel/sidepanel.js");

  // Render cards
  sidepanel.renderHistoryCards(mockCards);

  // First page should render 50 cards + 1 pagination wrap
  const renderedItems = global.historyCardsList.children.filter(c => c.className && c.className.includes("history-item"));
  assert.equal(renderedItems.length, 50, "First chunk should render exactly 50 cards");

  const paginationWrap = global.historyCardsList.children.find(c => c.id === "history-pagination-wrap");
  assert.ok(paginationWrap, "Must append #history-pagination-wrap when >50 cards exist");

  const loadMoreBtn = paginationWrap.children.find(c => c.id === "btn-history-load-more");
  assert.ok(loadMoreBtn, "Must include #btn-history-load-more button");
  assert.ok(loadMoreBtn.textContent.includes("70 remaining"), "Must indicate 70 cards remaining");

  // Simulate click on load more
  if (loadMoreBtn._listeners["click"]) {
    loadMoreBtn._listeners["click"].forEach(fn => fn());
  }

  // Second page should now have 100 cards
  const renderedItemsAfterLoad = global.historyCardsList.children.filter(c => c.className && c.className.includes("history-item"));
  assert.equal(renderedItemsAfterLoad.length, 100, "Second chunk should now have 100 cards");
  assert.equal(sidepanel.getCurrentRenderedHistoryPage(), 2, "Page index should advance to 2");
});
