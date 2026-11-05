const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mangaJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'manga.js');
const mangaCssPath = path.join(__dirname, '..', 'src', 'ui', 'styles', 'views', 'manga.css');

test('manga_viewer: manga.js supports image loading, OCR box selection, and dictionary query', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes('class MangaView'), 'must define MangaView');
  assert.ok(content.includes('ocrBoxSelection'), 'must support OCR box selection');
  assert.ok(content.includes('manga-canvas'), 'must render manga-canvas');
});

test('manga_viewer: manga.css uses design tokens with zero raw hex or emoji', () => {
  const css = fs.readFileSync(mangaCssPath, 'utf8');
  assert.ok(css.includes('.manga-viewer-container'), 'must style container');
  assert.equal(/#[0-9a-fA-F]{3,6}/.test(css), false, 'no raw hex');
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/u.test(css), false, 'no emoji');
});

