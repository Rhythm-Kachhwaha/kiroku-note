const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mangaJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'manga.js');
const mangaCssPath = path.join(__dirname, '..', 'src', 'ui', 'styles', 'views', 'manga.css');

test('manga_viewer: manga.js supports library, reader, bubble detection and rich mining', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes('class MangaView'), 'must define MangaView');
  assert.ok(content.includes('renderLibraryView'), 'must support library bookshelf');
  assert.ok(content.includes('renderReaderView'), 'must support full-screen immersion reader');
  assert.ok(content.includes('initPdfFromBuffer'), 'must support PDF document loading');
  assert.ok(content.includes('initCbzFromBuffer'), 'must support CBZ document loading');
  assert.ok(content.includes('detectBubblesOnCurrentPage'), 'must support bubble detection');
  assert.ok(content.includes('manga-bubble-overlay-layer'), 'must render bubble overlay layer');
  assert.ok(content.includes('openPopover'), 'must support floating popover');
  assert.ok(content.includes('image_url: this.activeCropDataUrl'), 'must send cropped image screenshot with mined card');
  assert.ok(content.includes('pacman3351'), 'must include animated pacman loading SVG');
  assert.ok(content.includes('showLoading'), 'must support in-view loading overlay');
  assert.ok(content.includes('refreshLibraryCoversIfNeeded'), 'must automatically upgrade blurry covers in background');
});

test('manga_viewer: manga.css uses design tokens with zero raw hex or emoji', () => {
  const css = fs.readFileSync(mangaCssPath, 'utf8');
  assert.ok(css.includes('.manga-viewer-container'), 'must style container');
  assert.ok(css.includes('.manga-immersion-reader'), 'must style immersion reader');
  assert.ok(css.includes('.manga-bubble-hitbox'), 'must style bubble hitboxes');
  assert.ok(css.includes('.manga-floating-popover'), 'must style floating popover');
  assert.ok(css.includes('.manga-loading-overlay'), 'must style loading overlay');
  assert.ok(css.includes('.manga-loading-pacman-wrap'), 'must style pacman wrapper');
  assert.equal(/#[0-9a-fA-F]{3,6}/.test(css), false, 'no raw hex');
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/u.test(css), false, 'no emoji');
});
