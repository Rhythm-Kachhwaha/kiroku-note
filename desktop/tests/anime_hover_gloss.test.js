const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const animeJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(__dirname, '..', 'src', 'ui', 'styles', 'views', 'anime.css');

test('anime_hover_gloss: anime.js renders interactive token spans in live cue box', () => {
  const content = fs.readFileSync(animeJsPath, 'utf8');

  assert.ok(
    content.includes('anime-token-chip'),
    'anime.js must render anime-token-chip in live cue box'
  );
  assert.ok(
    content.includes('anime-hover-gloss'),
    'anime.js must contain anime-hover-gloss element or mechanics'
  );
  assert.ok(
    content.includes('btn-quick-mine'),
    'anime.js must feature a quick-mine action button'
  );
});

test('anime_hover_gloss: anime.css defines .anime-hover-gloss styles with tactile tokens', () => {
  const css = fs.readFileSync(animeCssPath, 'utf8');

  assert.ok(
    css.includes('.anime-hover-gloss'),
    'anime.css must style .anime-hover-gloss'
  );
  assert.ok(
    css.includes('.btn-quick-mine'),
    'anime.css must style .btn-quick-mine'
  );

  // Strictly no emoji
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(css), false, 'anime.css must not contain emoji');
});
