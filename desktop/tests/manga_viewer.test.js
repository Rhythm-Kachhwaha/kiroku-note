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

test('manga_viewer: manga.js supports zip bundle auto-folder detection and extraction', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes('analyzeZipContents'), 'must analyze zip contents for nested volumes');
  assert.ok(content.includes('importZipBundle'), 'must import zip bundle into a dedicated folder');
  assert.ok(content.includes('STORAGE_KEY_AUTO_FOLDER_ZIP'), 'must support auto_folder_zip storage key');
  assert.ok(content.includes('btn-toggle-auto-folder-zip'), 'must provide UI toggle for auto-folder on zip');
  assert.ok(content.includes('openFiles'), 'must support multi-file uploads');
});

test('manga_viewer: manga.js supports bookmarks, furigana toggle, and background pre-OCR', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes('manga-card-bookmark-btn'), 'must support bookshelf card bookmark button');
  assert.ok(content.includes('manga-bookmark-svg'), 'must support animated SVG bookmark ribbon');
  assert.ok(content.includes('manga-bookmark-drawer'), 'must provide in-reader bookmarks drawer');
  assert.ok(content.includes('toggleBookmarkCurrentPage'), 'must toggle current page bookmark');
  assert.ok(content.includes('renderBookmarksList'), 'must render bookmark jump list');
  assert.ok(content.includes('btn-toggle-furigana'), 'must support Furigana reading toggle');
  assert.ok(content.includes('manga-ruby'), 'must support ruby/furigana markup');
  assert.ok(content.includes('scheduleNextPagePrefetch'), 'must support next-page background OCR prefetch');
  assert.ok(content.includes('prefetchOcrCache'), 'must maintain in-memory prefetch cache');
});

test('manga_viewer: manga.js supports drag-pan move tool and smooth wheel navigation', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes('btn-tool-move'), 'must provide Move / Pan tool button');
  assert.ok(content.includes('btn-tool-select'), 'must provide Select Text tool button');
  assert.ok(content.includes('setActiveTool'), 'must support switching active tool');
  assert.ok(content.includes('isPanning'), 'must track panning state');
  assert.ok(content.includes('isSpacePressed'), 'must support Spacebar panning shortcut');
  assert.ok(content.includes('updateCursorState'), 'must update cursor between grab and crosshair');
  assert.ok(content.includes('manga-stage-scroll-spacer'), 'must include bottom clearance scroll spacer');
  assert.ok(content.includes('manga-reader-active'), 'must manage active reader class on viewport');
});

test('manga_viewer: manga.css uses design tokens with zero raw hex or emoji', () => {
  const css = fs.readFileSync(mangaCssPath, 'utf8');
  assert.ok(css.includes('.manga-viewer-container'), 'must style container');
  assert.ok(css.includes('.manga-immersion-reader'), 'must style immersion reader');
  assert.ok(css.includes('.manga-reader-topbar'), 'must style topbar');
  assert.ok(css.includes('.manga-topbar-left'), 'must style topbar left');
  assert.ok(css.includes('.manga-topbar-center'), 'must style topbar center');
  assert.ok(css.includes('.manga-topbar-right'), 'must style topbar right');
  assert.ok(css.includes('.manga-reader-hint'), 'must style keyboard hotkey hint badge');
  assert.ok(css.includes('.manga-stage-scroll-spacer'), 'must style bottom stage clearance spacer');
  assert.ok(css.includes('.manga-bubble-hitbox'), 'must style bubble hitboxes');
  assert.ok(css.includes('.manga-floating-popover'), 'must style floating popover');
  assert.ok(css.includes('.manga-loading-overlay'), 'must style loading overlay');
  assert.ok(css.includes('.manga-loading-pacman-wrap'), 'must style pacman wrapper');
  assert.ok(css.includes('.manga-card-bookmark-btn'), 'must style bookmark button');
  assert.ok(css.includes('.manga-bookmark-drawer'), 'must style bookmark drawer');
  assert.ok(css.includes('.manga-ruby'), 'must style furigana ruby');
  assert.ok(css.includes('mangaBookmarkBounce'), 'must include bookmark animation');
  assert.ok(css.includes('.manga-tool-toggle-group'), 'must style tool toggle group');
  assert.ok(css.includes('.manga-tool-toggle-btn'), 'must style tool toggle buttons');
  assert.equal(/#[0-9a-fA-F]{3,6}/.test(css), false, 'no raw hex');
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/u.test(css), false, 'no emoji');
});

test('manga_viewer: manga.js supports direct mobile uploads and PWA share target / launch queue', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes('btn-add-manga'), 'must have explicit button trigger for mobile file picker');
  assert.ok(content.includes('checkSharedMangaPayload'), 'must check for Web Share Target manga payload');
  assert.ok(content.includes('kiroku:pwa-manga-import'), 'must handle launchQueue file handling events');
  assert.ok(content.includes('manga-file-input-hidden'), 'must use off-screen input instead of display:none');
  assert.ok(content.includes('application/x-zip-compressed'), 'must support expanded mobile MIME types');

  const css = fs.readFileSync(mangaCssPath, 'utf8');
  assert.ok(css.includes('.manga-file-input-hidden'), 'must style off-screen input');
  assert.ok(css.includes('@media (max-width: 768px)'), 'must include mobile responsive rules');

  const manifestPath = path.join(__dirname, '..', '..', 'public', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(manifest.share_target, 'manifest must define share_target');
  assert.ok(Array.isArray(manifest.file_handlers), 'manifest must define file_handlers');

  const swPath = path.join(__dirname, '..', '..', 'public', 'service-worker.js');
  const swContent = fs.readFileSync(swPath, 'utf8');
  assert.ok(swContent.includes('kiroku-shared-manga'), 'service worker must handle shared manga cache');
});
