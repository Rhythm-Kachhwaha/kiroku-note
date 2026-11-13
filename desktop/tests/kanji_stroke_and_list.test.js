const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const kanjiViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'kanji.js');
const kanjiCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'kanji.css');

test('Kanji View: Stroke player controls use pure SVG icon buttons and no text labels', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  // Should have SVG inside btn-stroke-replay and btn-stroke-play
  assert.ok(
    content.includes('id="btn-stroke-replay" title="Replay from start" aria-label="Replay stroke order"') &&
    content.includes('<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">'),
    'Replay button must contain SVG icon'
  );
  assert.ok(
    content.includes('id="btn-stroke-play" title="Play animation" aria-label="Play stroke order"') &&
    content.includes('M8 5v14l11-7z'),
    'Play button must contain Play SVG icon path'
  );

  // Must not set textContent = 'Play' or 'Pause' on buttons
  assert.equal(
    content.includes("btn.textContent = 'Play'"),
    false,
    'Must not set textContent Play'
  );
  assert.equal(
    content.includes("btn.textContent = 'Pause'"),
    false,
    'Must not set textContent Pause'
  );

  // updateHeroPlayButton must be defined
  assert.ok(
    content.includes('updateHeroPlayButton()'),
    'Must define updateHeroPlayButton method'
  );
});

test('Kanji View: Stroke animation does not bypass playback on reduced motion', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.equal(
    content.includes("prefers-reduced-motion: reduce"),
    false,
    'Must not early-exit stroke order video animation on prefers-reduced-motion'
  );
});

test('Kanji View: Stroke step renders current stroke visibly when static', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('isAnimating ? `${length}px` : \'0px\''),
    'renderStrokeStep must display current stroke statically at 0px offset'
  );
});

test('Kanji View: List view row removes 画 kanji with stroke count', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.equal(
    content.includes('画'),
    false,
    'kanji.js must not contain "画" kanji label'
  );
  assert.equal(
    content.includes('kanji-list-strokes'),
    false,
    'kanji.js must not render kanji-list-strokes element'
  );
});

test('Kanji View: List limit allows full scroll across all JLPT kanji', () => {
  const content = fs.readFileSync(kanjiViewPath, 'utf8');

  assert.ok(
    content.includes('this.listLimit = 2500'),
    'this.listLimit must be 2500 to fetch all kanji in the level'
  );
});

test('Kanji View & CSS: Zero emojis', () => {
  const jsContent = fs.readFileSync(kanjiViewPath, 'utf8');
  const cssContent = fs.readFileSync(kanjiCssPath, 'utf8');
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;

  assert.equal(emojiRegex.test(jsContent), false, 'kanji.js must contain no emojis');
  assert.equal(emojiRegex.test(cssContent), false, 'kanji.css must contain no emojis');
});
