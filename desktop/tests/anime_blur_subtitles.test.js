const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const animeJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(__dirname, '..', 'src', 'ui', 'styles', 'views', 'anime.css');

test('anime_blur_subtitles: anime.js renders blur toggle and handles hotkey B', () => {
  const content = fs.readFileSync(animeJsPath, 'utf8');
  assert.ok(content.includes('blurSubtitlesEnabled'), 'anime.js must define blurSubtitlesEnabled state');
  assert.ok(content.includes('btn-anime-toggle-blur'), 'anime.js must render #btn-anime-toggle-blur');
  assert.ok(content.includes('KeyB'), 'anime.js must support hotkey B for toggling blur');
});

test('anime_blur_subtitles: anime.css provides .is-blurred and hover unblur without raw hex or emoji', () => {
  const css = fs.readFileSync(animeCssPath, 'utf8');
  assert.ok(css.includes('.anime-live-cue-text.is-blurred'), 'anime.css must define .is-blurred on cue text');
  assert.ok(css.includes('filter: blur('), 'anime.css must use blur filter');
  assert.equal(/#[0-9a-fA-F]{3,6}/.test(css), false, 'anime.css must contain no raw hex');
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/u.test(css), false, 'no emoji');
});

