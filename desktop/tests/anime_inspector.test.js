const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const animeJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(__dirname, '..', 'src', 'ui', 'styles', 'views', 'anime.css');

test('anime_inspector: anime.js renders collapsible inspector with vocab and grammar cards', () => {
  const content = fs.readFileSync(animeJsPath, 'utf8');

  assert.ok(
    content.includes('anime-inspector-panel'),
    'anime.js must render anime-inspector-panel'
  );
  assert.ok(
    content.includes('anime-inspector-vocab'),
    'anime.js must render anime-inspector-vocab card'
  );
  assert.ok(
    content.includes('anime-inspector-grammar'),
    'anime.js must render anime-inspector-grammar card'
  );
  assert.ok(
    content.includes('btn-anime-toggle-inspector'),
    'anime.js must provide toggle inspector button'
  );
});

test('anime_inspector: anime.css styles inspector panel with push layout and design tokens', () => {
  const css = fs.readFileSync(animeCssPath, 'utf8');

  assert.ok(
    css.includes('.anime-inspector-panel'),
    'anime.css must style .anime-inspector-panel'
  );
  assert.ok(
    css.includes('.anime-inspector-vocab'),
    'anime.css must style .anime-inspector-vocab'
  );
  assert.ok(
    css.includes('.anime-inspector-grammar'),
    'anime.css must style .anime-inspector-grammar'
  );

  // Zero emoji
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(css), false, 'anime.css must not contain emoji');
});

