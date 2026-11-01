const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const kanjiViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'kanji.js');

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

