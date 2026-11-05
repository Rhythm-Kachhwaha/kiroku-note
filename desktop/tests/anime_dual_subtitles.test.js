const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const animeJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(__dirname, '..', 'src', 'ui', 'styles', 'views', 'anime.css');

test('anime_dual_subtitles: anime.js renders secondary translation track', () => {
  const content = fs.readFileSync(animeJsPath, 'utf8');
  assert.ok(content.includes('anime-secondary-cue-text'), 'anime.js must render secondary cue container');
  assert.ok(content.includes('btn-anime-toggle-dual'), 'anime.js must render dual subtitle toggle');
});

test('anime_dual_subtitles: anime.css styles secondary subtitle with muted tokens', () => {
  const css = fs.readFileSync(animeCssPath, 'utf8');
  assert.ok(css.includes('.anime-secondary-cue-text'), 'anime.css must style secondary cue');
  assert.ok(css.includes('var(--text-muted)'), 'anime.css must style secondary text in muted color');
});
