const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const animeJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(__dirname, '..', 'src', 'ui', 'styles', 'views', 'anime.css');
const mangaJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'manga.js');
const condensedPyPath = path.join(__dirname, '..', '..', 'backend', 'app', 'services', 'condensed_audio.py');

test('stack_fixes: anime.js persists blur and dual subtitle preferences and supports hotkey D', () => {
  const content = fs.readFileSync(animeJsPath, 'utf8');
  assert.ok(content.includes('kiroku_blur_subtitles_enabled'), 'must persist blur setting');
  assert.ok(content.includes('kiroku_dual_subtitles_enabled'), 'must persist dual setting');
  assert.ok(content.includes('KeyD'), 'must support hotkey D for dual subtitles');
  assert.ok(content.includes('anime-cue-1t-badge'), 'must render live 1T cue badge in status strip');
});

test('stack_fixes: anime.css blurs secondary subtitle when blur mode is enabled', () => {
  const css = fs.readFileSync(animeCssPath, 'utf8');
  assert.ok(css.includes('.anime-secondary-cue-text.is-blurred'), 'must support blurring secondary cue');
});

test('stack_fixes: condensed audio filter supports audio padding margin', () => {
  const py = fs.readFileSync(condensedPyPath, 'utf8');
  assert.ok(py.includes('pad_start') || py.includes('padding') || py.includes('max(0'), 'must support padding buffer');
});

test('stack_fixes: manga.js supports one-click mining from inspector', () => {
  const mangaJs = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(mangaJs.includes('btn-manga-mine-word') || mangaJs.includes('mineWord'), 'manga viewer must support mining');
});
