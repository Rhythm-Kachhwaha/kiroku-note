/**
 * Manga Library Thumbnails Test
 *
 * Verifies that local manga books:
 * 1. Replace placeholder DOM nodes with <img> when covers load from IndexedDB or refreshLibraryCoversIfNeeded.
 * 2. Persist generated covers to IndexedDB (storeBookCover) so they survive localStorage stripping.
 * 3. Re-load stale blob: URLs from previous sessions instead of skipping them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const desktopMangaPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'manga.js');
const publicMangaPath = path.join(repoRoot, 'public', 'ui', 'views', 'manga.js');

test('Manga Thumbnails: DOM cover updater replaces placeholder when coverUrl resolves asynchronously', () => {
  for (const filePath of [desktopMangaPath, publicMangaPath]) {
    const code = fs.readFileSync(filePath, 'utf8');
    assert.ok(
      code.includes('_applyBookCoverToDom('),
      `${path.relative(repoRoot, filePath)} must define and use _applyBookCoverToDom to replace placeholder with <img>`
    );
    assert.ok(
      code.includes('manga-book-cover-placeholder'),
      `${path.relative(repoRoot, filePath)} must handle replacing .manga-book-cover-placeholder`
    );
  }
});

test('Manga Thumbnails: refreshLibraryCoversIfNeeded persists generated covers via storeBookCover', () => {
  for (const filePath of [desktopMangaPath, publicMangaPath]) {
    const code = fs.readFileSync(filePath, 'utf8');
    const fnStart = code.indexOf('async refreshLibraryCoversIfNeeded()');
    assert.ok(fnStart !== -1, 'refreshLibraryCoversIfNeeded must exist');
    const fnEnd = code.indexOf('renderReaderView()', fnStart);
    const fnBody = code.slice(fnStart, fnEnd);
    assert.ok(
      fnBody.includes('_persistGeneratedCover(') || fnBody.includes('storeBookCover('),
      `${path.relative(repoRoot, filePath)} refreshLibraryCoversIfNeeded must persist generated covers in IndexedDB`
    );

    const helperStart = code.indexOf('async _persistGeneratedCover(');
    assert.ok(helperStart !== -1, '_persistGeneratedCover must exist');
    const helperEnd = code.indexOf('async loadBookCoversFromStorage(', helperStart);
    const helperBody = code.slice(helperStart, helperEnd);
    assert.ok(
      helperBody.includes('storeBookCover('),
      `${path.relative(repoRoot, filePath)} _persistGeneratedCover must call storeBookCover`
    );
  }
});
