const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const kanjiDrawerJsPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'kanji_drawer.js');
const kanjiDrawerCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'kanji-drawer.css');

test('Kanji Drawer: Exposes window.kirokuUi.openKanji and exports functions', () => {
  const content = fs.readFileSync(kanjiDrawerJsPath, 'utf8');

  assert.ok(
    content.includes('window.kirokuUi.openKanji = openKanjiDrawer'),
    'kanji_drawer.js must register openKanji on window.kirokuUi'
  );
  assert.ok(
    content.includes('export function openKanjiDrawer('),
    'kanji_drawer.js must export openKanjiDrawer function'
  );
  assert.ok(
    content.includes('export function closeKanjiDrawer('),
    'kanji_drawer.js must export closeKanjiDrawer function'
  );
});

test('Kanji Drawer: Wires stroke vector animation, readings, level, and compounds', () => {
  const content = fs.readFileSync(kanjiDrawerJsPath, 'utf8');

  // API calls
  assert.ok(
    content.includes('apiClient.getKanjiDetails('),
    'kanji_drawer.js must query kanji details'
  );
  assert.ok(
    content.includes('apiClient.getKanjiStrokes('),
    'kanji_drawer.js must query kanji stroke vectors'
  );
  assert.ok(
    content.includes('apiClient.getKanjiCompounds('),
    'kanji_drawer.js must query kanji compounds'
  );

  // Stroke order animation
  assert.ok(
    content.includes('animateCurrentStroke('),
    'kanji_drawer.js must implement progressive stroke animation'
  );
  assert.ok(
    content.includes('strokePaths'),
    'kanji_drawer.js must parse stroke paths from vector'
  );
});

test('Kanji Drawer: Wires Weak kanji row reading from Study mistakes history', () => {
  const content = fs.readFileSync(kanjiDrawerJsPath, 'utf8');

  assert.ok(
    content.includes('studyClient.getIncorrectHistory(') || content.includes('/api/study/v1/history/incorrect'),
    'kanji_drawer.js must read mistakes history from study API'
  );
  assert.ok(
    content.includes('drawer-weak-section') || content.includes('drawer-weak-list'),
    'kanji_drawer.js must render weak kanji section'
  );
  assert.ok(
    content.includes('kanji-weak-pill'),
    'kanji_drawer.js must render weak kanji pills'
  );
});

test('Kanji Drawer: CSS styles drawer with Planetoño tactile physics and pure black surfaces', () => {
  const css = fs.readFileSync(kanjiDrawerCssPath, 'utf8');

  // Planetoño tactile border & pure black
  assert.ok(
    css.includes('2px solid var(--tactile-stroke)'),
    'kanji-drawer.css must use 2px tactile stroke border'
  );
  assert.ok(
    css.includes('var(--pure-black)'),
    'kanji-drawer.css must use pure black background'
  );
  assert.ok(
    css.includes('var(--duration-fast)') && css.includes('var(--spring-snappy)'),
    'kanji-drawer.css must use design token transitions'
  );
});

test('Kanji Drawer: Zero emojis across code and styles', () => {
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

  for (const filePath of [kanjiDrawerJsPath, kanjiDrawerCssPath]) {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(emojiRegex);
    assert.equal(
      match,
      null,
      `Found forbidden emoji in ${path.basename(filePath)}: ${match?.[0]}`
    );
  }
});
