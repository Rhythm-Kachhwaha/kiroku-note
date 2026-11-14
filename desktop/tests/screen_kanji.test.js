const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const kanjiViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'kanji.js');
const kanjiCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'kanji.css');

test('Kanji View: No hardcoded mock data or fake paths in production templates', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  // Forbidden placeholder mock text
  const forbidden = [
    '静寂<rt>せいじゃく</rt>',
    '<path d="M15 25 Q35 20 50 25" id="stroke-1" />',
    'Frequency Rank #704 · 14 Strokes</h2>',
    'catch (_) {}'
  ];

  for (const str of forbidden) {
    assert.equal(
      content.includes(str),
      false,
      `KanjiView must not contain placeholder string: "${str}"`
    );
  }

  // Uses real dynamic containers
  assert.ok(
    content.includes('id="stroke-canvas"'),
    'KanjiView must include stroke-canvas container'
  );
  assert.ok(
    content.includes('id="compounds-list"'),
    'KanjiView must include compounds-list container'
  );
});

test('Kanji View: Wires real KanjiVG stroke order vector playback', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('apiClient.getKanjiStrokes('),
    'KanjiView must call apiClient.getKanjiStrokes for character vector data'
  );
  assert.ok(
    content.includes('renderStrokeCanvas('),
    'KanjiView must parse real SVG stroke paths from backend'
  );
  assert.ok(
    content.includes('renderStrokeStep('),
    'KanjiView must implement progressive stroke step styling'
  );
  assert.ok(
    content.includes('startStrokePlay(') || content.includes('toggleStrokePlay('),
    'KanjiView must provide animation playback controls'
  );
});

test('Kanji View: Fetches character details and readings from backend', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('apiClient.getKanjiDetails('),
    'KanjiView must call apiClient.getKanjiDetails'
  );
  assert.ok(
    content.includes('renderKanjiDetails('),
    'KanjiView must render onyomi, kunyomi, meanings and level tags'
  );
});

test('Kanji View: Dynamic compound mining via apiClient.saveCard', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('apiClient.getKanjiCompounds('),
    'KanjiView must call apiClient.getKanjiCompounds to fetch real compounds'
  );
  assert.ok(
    content.includes('apiClient.saveCard('),
    'KanjiView 1-click mine must call apiClient.saveCard'
  );
});

test('Kanji View: Working JLPT level pills for kanji browsing', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('apiClient.browseKanji('),
    'KanjiView must call apiClient.browseKanji when browsing by level'
  );
  assert.ok(
    content.includes('kanji-browse-chips'),
    'KanjiView must render browse chips container'
  );
});

test('Kanji View: Error handling is visible with banner (no silent catches)', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('showError('),
    'KanjiView must implement visible showError method'
  );
  assert.ok(
    content.includes('kanji-error-banner'),
    'KanjiView must include visible kanji-error-banner element'
  );
  assert.ok(
    !content.includes('catch (_) {}'),
    'KanjiView must not contain empty silent catch blocks'
  );
});

test('Kanji View: Duolingo-style mastery grid and tactile squircle cards', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('kanji-mastery-grid'),
    'KanjiView must render .kanji-mastery-grid container'
  );
  assert.ok(
    content.includes('kanji-squircle-card'),
    'KanjiView must render .kanji-squircle-card character elements'
  );
  assert.ok(
    content.includes('kanji-progress-bar'),
    'KanjiView must render .kanji-progress-bar mini progress indicator'
  );
});

test('Kanji View: Dynamic target deck resolution for compound mining', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('anki_deck') || content.includes('vocab.selectedDeck'),
    'KanjiView must check user storage for target Anki mining deck'
  );
  assert.ok(
    content.includes('deck_name: targetDeck') || content.includes('deck_name:'),
    'KanjiView must pass resolved deck_name to apiClient.saveCard'
  );
  assert.equal(
    content.includes("deck_name: 'Japanese::Vocab'"),
    false,
    'KanjiView must not hardcode deck_name to Japanese::Vocab'
  );
});

test('Kanji View: Accordion dropdown with view limit selector and view all option', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('btn-toggle-kanji-browse'),
    'KanjiView must include dropdown toggle button #btn-toggle-kanji-browse'
  );
  assert.ok(
    content.includes('kanji-accordion-panel'),
    'KanjiView must include animated accordion panel #kanji-accordion-panel'
  );
  assert.ok(
    content.includes('kanji-limit-select'),
    'KanjiView must include kanji limit selector #kanji-limit-select'
  );
  assert.ok(
    content.includes('value="all"'),
    'KanjiView must include an option to view all kanjis for that level'
  );
  assert.ok(
    content.includes('this.isBrowseOpen = false'),
    'KanjiView must collapse kanji mastery grid by default'
  );
});

test('Kanji View: Segmented view toggle between Grid and List modes', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('kanji-view-toggle'),
    'KanjiView must include .kanji-view-toggle segmented control'
  );
  assert.ok(
    content.includes('btn-view-grid') && content.includes('btn-view-list'),
    'KanjiView must include buttons for Grid and List views'
  );
  assert.ok(
    content.includes('setViewMode('),
    'KanjiView must implement setViewMode handler'
  );
});

test('Kanji View: Full-screen Textbook List View with real-time filter and infinite scroll', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('kanji-textbook-list'),
    'KanjiView must render #kanji-textbook-list container'
  );
  assert.ok(
    content.includes('apiClient.getKanjiStudyList('),
    'KanjiView must call apiClient.getKanjiStudyList for textbook data'
  );
  assert.ok(
    content.includes('kanji-list-search-input'),
    'KanjiView must include subtle real-time filter input'
  );
  assert.ok(
    content.includes('filterList('),
    'KanjiView must implement filterList method'
  );
  assert.ok(
    content.includes('renderListRow('),
    'KanjiView must implement renderListRow method'
  );
});

test('Kanji View: Blur Cover Mode for non-distracting self-testing', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('btn-toggle-cover-mode'),
    'KanjiView must include Cover Mode toggle button'
  );
  assert.ok(
    content.includes('toggleCoverMode('),
    'KanjiView must implement toggleCoverMode method'
  );
  assert.ok(
    content.includes('kanji-reading-blur'),
    'KanjiView must apply .kanji-reading-blur class in cover mode'
  );
});

test('Kanji View: Right-side Card Inspector and custom compound addition', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('kanji-card-inspector'),
    'KanjiView must include #kanji-card-inspector slide-over drawer'
  );
  assert.ok(
    content.includes('openCardInspector('),
    'KanjiView must implement openCardInspector method'
  );
  assert.ok(
    content.includes('kanji-add-popover'),
    'KanjiView must include inline #kanji-add-popover for custom compounds'
  );
  assert.ok(
    content.includes('apiClient.addCustomCompound('),
    'KanjiView must persist custom compounds via apiClient.addCustomCompound'
  );
});

test('Kanji View: List view allows clicking kanji to mark known with green and removed 1-Click Mine text', () => {
  const jsContent = fs.readFileSync(kanjiViewPath, 'utf8');
  const cssContent = fs.readFileSync(kanjiCssPath, 'utf8');

  assert.ok(
    !jsContent.includes('1-Click Mine to Local &amp; Anki') && !jsContent.includes('1-Click Mine to Local & Anki'),
    'KanjiView must remove 1-Click Mine to Local & Anki text'
  );

  assert.ok(
    jsContent.includes('markKnownWord') && jsContent.includes('unmarkKnownWord'),
    'KanjiView must toggle known kanji via markKnownWord/unmarkKnownWord on click'
  );

  assert.ok(
    cssContent.includes('.kanji-list-char.is-known'),
    'kanji.css must style .kanji-list-char.is-known'
  );

  assert.ok(
    cssContent.includes('--kanji-known-green'),
    'kanji.css must style known kanji using light green --kanji-known-green'
  );
});

test('Kanji View: Card Inspector uses hero card layout with Save button', () => {
  const jsContent = fs.readFileSync(kanjiViewPath, 'utf8');
  const cssContent = fs.readFileSync(kanjiCssPath, 'utf8');

  assert.ok(
    jsContent.includes('kanji-insp-hero-expression'),
    'KanjiView must include hero expression element in Card Inspector'
  );

  assert.ok(
    jsContent.includes('kanji-insp-hero-reading'),
    'KanjiView must include hero reading element in Card Inspector'
  );

  assert.ok(
    jsContent.includes('kanji-insp-hero-meaning'),
    'KanjiView must include hero meaning element in Card Inspector'
  );

  assert.ok(
    cssContent.includes('.kanji-insp-hero-card'),
    'kanji.css must style .kanji-insp-hero-card'
  );

  assert.ok(
    /Save\s*<\/button>/i.test(jsContent),
    'KanjiView Card Inspector action button must be labeled "Save"'
  );
});

