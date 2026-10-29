const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.join(__dirname, "../sidepanel/sidepanel.css");

const sidepanelHtml = fs.readFileSync(htmlPath, "utf-8");
const sidepanelCss = fs.readFileSync(cssPath, "utf-8");

// Emoji regex covering standard Unicode emoji presentation sequences
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

test("Sidepanel DOM: #active-sub-grammar-slot is present, has class active-sub-grammar-slot, within or directly after cue container, initially empty", () => {
  // Presence and class check
  assert.ok(
    sidepanelHtml.includes('id="active-sub-grammar-slot"'),
    "Must contain #active-sub-grammar-slot"
  );
  assert.match(
    sidepanelHtml,
    /<div[^>]*id="active-sub-grammar-slot"[^>]*class="[^"]*active-sub-grammar-slot[^"]*"[^>]*>/,
    "#active-sub-grammar-slot must have class active-sub-grammar-slot"
  );

  // Directly after or within active subtitle container (.video-cue-preview-container)
  const cueContainerStart = sidepanelHtml.indexOf('class="video-cue-preview-container');
  const grammarSlotIndex = sidepanelHtml.indexOf('id="active-sub-grammar-slot"');
  const recentCuesStart = sidepanelHtml.indexOf('id="recent-cues-section"');

  assert.ok(
    cueContainerStart > 0 && grammarSlotIndex > cueContainerStart,
    "#active-sub-grammar-slot must appear within or directly after the active subtitle container"
  );
  assert.ok(
    grammarSlotIndex < recentCuesStart,
    "#active-sub-grammar-slot must appear before recent-cues-section"
  );

  // Initially empty check (Part 2 owns content; Part 1 must leave empty)
  assert.match(
    sidepanelHtml,
    /<div[^>]*id="active-sub-grammar-slot"[^>]*>\s*<\/div>/,
    "#active-sub-grammar-slot must be initially empty for Part 2"
  );
});

test("Sidepanel DOM: Active subtitle font sizing controls (small, medium, large, xlarge) with large (22px) as default", () => {
  // Check font size controls container or buttons exist
  assert.ok(
    sidepanelHtml.includes('id="active-sub-size-controls"') ||
    sidepanelHtml.includes('class="active-sub-size-controls"'),
    "Must have font sizing controls for active subtitle"
  );

  // Controls for small, medium, large, xlarge
  assert.ok(
    sidepanelHtml.includes('data-size="small"') || sidepanelHtml.includes('btn-sub-size-small'),
    "Must have small font size control"
  );
  assert.ok(
    sidepanelHtml.includes('data-size="medium"') || sidepanelHtml.includes('btn-sub-size-medium'),
    "Must have medium font size control"
  );
  assert.ok(
    sidepanelHtml.includes('data-size="large"') || sidepanelHtml.includes('btn-sub-size-large'),
    "Must have large font size control"
  );
  assert.ok(
    sidepanelHtml.includes('data-size="xlarge"') || sidepanelHtml.includes('btn-sub-size-xlarge'),
    "Must have xlarge font size control"
  );

  // Large must be default (marked active or aria-pressed)
  assert.match(
    sidepanelHtml,
    /<button[^>]*data-size="large"[^>]*class="[^"]*active[^"]*"|<button[^>]*class="[^"]*active[^"]*"[^>]*data-size="large"|<button[^>]*id="btn-sub-size-large"[^>]*class="[^"]*active[^"]*"/,
    "Large font size control must be active by default"
  );
});

test("Sidepanel DOM: #video-collapsed-card-chip 1-line chip element exists without duplicating shared card workspace", () => {
  assert.ok(
    sidepanelHtml.includes('id="video-collapsed-card-chip"'),
    "Must contain #video-collapsed-card-chip 1-line chip element"
  );

  // Shared Card Workspace DOM must remain singular (not duplicated)
  const cardEditorMatches = sidepanelHtml.match(/id="card-editor"/g);
  const cardLayoutMatches = sidepanelHtml.match(/id="card-layout-container"/g);
  assert.equal(
    cardEditorMatches?.length,
    1,
    "Shared Card Workspace #card-editor must remain singular and not duplicated"
  );
  assert.equal(
    cardLayoutMatches?.length,
    1,
    "Shared Card Workspace #card-layout-container must remain singular and not duplicated"
  );
});

test("Sidepanel DOM: #video-missed-words-drawer exists with header, count badge, and body container", () => {
  assert.ok(
    sidepanelHtml.includes('id="video-missed-words-drawer"'),
    "Must contain #video-missed-words-drawer"
  );

  // Header
  assert.ok(
    sidepanelHtml.includes('id="video-missed-words-header"') ||
    sidepanelHtml.includes('class="missed-words-header"'),
    "Must contain missed words drawer header"
  );

  // Count badge
  assert.ok(
    sidepanelHtml.includes('id="video-missed-words-badge"') ||
    sidepanelHtml.includes('class="missed-words-count-badge"'),
    "Must contain missed words count badge"
  );

  // Body container
  assert.ok(
    sidepanelHtml.includes('id="video-missed-words-body"') ||
    sidepanelHtml.includes('class="missed-words-body"'),
    "Must contain missed words body container"
  );
});

test("Sidepanel UI: Zero OS emojis across added markup and CSS (strictly vector SVGs)", () => {
  // Extract video tab section and card chip markup
  const videoTabStart = sidepanelHtml.indexOf('id="video-mining-view"');
  const videoTabEnd = sidepanelHtml.indexOf('id="quickadd-mining-view"');
  const videoTabMarkup = sidepanelHtml.slice(videoTabStart, videoTabEnd);

  const cardSectionStart = sidepanelHtml.indexOf('id="card-editor-section"');
  const cardSectionEnd = sidepanelHtml.indexOf('id="history-section"');
  const cardSectionMarkup = sidepanelHtml.slice(cardSectionStart, cardSectionEnd);

  assert.equal(
    EMOJI_REGEX.test(videoTabMarkup),
    false,
    "Video tab markup must not contain any raw OS emojis"
  );

  // Find collapsed card chip in the document and ensure no emojis
  const chipIndex = sidepanelHtml.indexOf('id="video-collapsed-card-chip"');
  if (chipIndex !== -1) {
    const chipMarkup = sidepanelHtml.slice(chipIndex, chipIndex + 600);
    assert.equal(
      EMOJI_REGEX.test(chipMarkup),
      false,
      "Collapsed card chip markup must not contain raw OS emojis"
    );
  }

  // CSS must have zero emojis
  assert.equal(
    EMOJI_REGEX.test(sidepanelCss),
    false,
    "sidepanel.css must not contain raw OS emojis"
  );
});

test("Sidepanel CSS: Active subtitle font sizes (.active-sub-size-small: 14px, .active-sub-size-medium: 18px, .active-sub-size-large: 22px, .active-sub-size-xlarge: 26px)", () => {
  // Small (14px)
  assert.match(
    sidepanelCss,
    /\.active-sub-size-small\b[^{]*\{[^}]*font-size:\s*14px/s,
    ".active-sub-size-small must set font-size: 14px"
  );

  // Medium (18px)
  assert.match(
    sidepanelCss,
    /\.active-sub-size-medium\b[^{]*\{[^}]*font-size:\s*18px/s,
    ".active-sub-size-medium must set font-size: 18px"
  );

  // Large (22px)
  assert.match(
    sidepanelCss,
    /\.active-sub-size-large\b[^{]*\{[^}]*font-size:\s*22px/s,
    ".active-sub-size-large must set font-size: 22px"
  );

  // XLarge (26px)
  assert.match(
    sidepanelCss,
    /\.active-sub-size-xlarge\b[^{]*\{[^}]*font-size:\s*26px/s,
    ".active-sub-size-xlarge must set font-size: 26px"
  );
});

test("Sidepanel CSS: Word status tokens (.sub-token.mined #d4884f, .sub-token.should-know #5db872, .sub-token.unstyled)", () => {
  // .sub-token.mined (orange #d4884f + subtle underline)
  assert.match(
    sidepanelCss,
    /\.sub-token\.mined\b[^{]*\{[^}]*color:\s*#d4884f/i,
    ".sub-token.mined must set color: #d4884f"
  );
  assert.match(
    sidepanelCss,
    /\.sub-token\.mined\b[^{]*\{[^}]*text-decoration:\s*underline/i,
    ".sub-token.mined must have underline decoration"
  );

  // .sub-token.should-know (green #5db872 + subtle underline)
  assert.match(
    sidepanelCss,
    /\.sub-token\.should-know\b[^{]*\{[^}]*color:\s*#5db872/i,
    ".sub-token.should-know must set color: #5db872"
  );
  assert.match(
    sidepanelCss,
    /\.sub-token\.should-know\b[^{]*\{[^}]*text-decoration:\s*underline/i,
    ".sub-token.should-know must have underline decoration"
  );

  // .sub-token.unstyled
  assert.ok(
    sidepanelCss.includes(".sub-token.unstyled"),
    ".sub-token.unstyled must be defined"
  );
});

test("Sidepanel CSS: Collapsed card chip styles and missed words drawer styles", () => {
  // Collapsed card chip styles
  assert.ok(
    sidepanelCss.includes(".video-collapsed-card-chip"),
    "Must include .video-collapsed-card-chip styles"
  );
  assert.match(
    sidepanelCss,
    /\.card-editor-section\.video-collapsed|\.video-collapsed-card-chip/,
    "Must have rules supporting collapsed card chip state"
  );

  // Missed words drawer styles
  assert.ok(
    sidepanelCss.includes(".video-missed-words-drawer"),
    "Must include .video-missed-words-drawer styles"
  );
  assert.ok(
    sidepanelCss.includes(".missed-words-header"),
    "Must style .missed-words-header"
  );
  assert.ok(
    sidepanelCss.includes(".missed-words-count-badge"),
    "Must style .missed-words-count-badge"
  );
  assert.ok(
    sidepanelCss.includes(".missed-words-body"),
    "Must style .missed-words-body"
  );
});
