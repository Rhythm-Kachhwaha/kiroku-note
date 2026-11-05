const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const animeJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(__dirname, '..', 'src', 'ui', 'styles', 'views', 'anime.css');

test('anime_1t_sentence: anime.js identifies 1T cues and adds 1T badge', () => {
  const content = fs.readFileSync(animeJsPath, 'utf8');
  assert.ok(content.includes('badge-1t') || content.includes('is-1t'), 'anime.js must tag 1T cues');
  assert.ok(content.includes('only-1t'), 'anime.js must provide 1T transcript filter option');
});

test('anime_1t_sentence: anime.css styles .badge-1t using gold tactile token', () => {
  const css = fs.readFileSync(animeCssPath, 'utf8');
  assert.ok(css.includes('.badge-1t'), 'anime.css must style .badge-1t');
  assert.ok(css.includes('var(--gold)'), 'anime.css must use --gold token');
});

