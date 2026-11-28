import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mangaJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'manga.js');
const transferJsPath = path.join(__dirname, '..', 'src', 'ui', 'services', 'manga_transfer.js');

test('manga_import_audit: openFile avoids double-reading File and records size/filename', () => {
  const src = fs.readFileSync(mangaJsPath, 'utf8');
  const openFileStart = src.indexOf('async openFile(file, autoOpen = true, shouldRender = true)');
  const openFileEnd = src.indexOf('async loadAndOpenBook(', openFileStart);
  assert.ok(openFileStart !== -1 && openFileEnd !== -1, 'openFile must exist');
  const openFileBody = src.slice(openFileStart, openFileEnd);

  assert.ok(
    openFileBody.includes('storeBookFile(bookId, arrayBuffer'),
    'openFile must pass already-read arrayBuffer to storeBookFile to avoid double-reading File on iOS'
  );
  assert.ok(
    openFileBody.includes('size: arrayBuffer.byteLength'),
    'openFile must record size on newBook for cloud sync deduplication'
  );
  assert.ok(
    openFileBody.includes('filename: file.name'),
    'openFile must record filename on newBook'
  );
  assert.ok(
    openFileBody.includes('this.showToast('),
    'openFile must surface import failures to user via showToast'
  );
});

test('manga_import_audit: importZipBundle resolves existing bookId before storeBookFile and verifies storage', () => {
  const src = fs.readFileSync(mangaJsPath, 'utf8');
  const zipStart = src.indexOf('async importZipBundle(file, arrayBuffer, analysis, createFolder = true)');
  const zipEnd = src.indexOf('showZipImportModal(', zipStart);
  assert.ok(zipStart !== -1 && zipEnd !== -1, 'importZipBundle must exist');
  const zipBody = src.slice(zipStart, zipEnd);

  const existingCheckIdx = zipBody.indexOf('this.books.findIndex(b => b.title === item.title');
  const storeCallIdx = zipBody.indexOf('await storeBookFile(bookId, itemBuffer');
  assert.ok(existingCheckIdx !== -1, 'importZipBundle must check existing book by title before storing');
  assert.ok(storeCallIdx !== -1 && existingCheckIdx < storeCallIdx, 'existing bookId must be resolved before storeBookFile');
  assert.ok(zipBody.includes('verifyBookStorage(bookId)'), 'importZipBundle must verify stored book via verifyBookStorage');
});

test('manga_sync_audit: processSyncQueue uses uploadMangaChunks and flushSyncOutbox uses requestCloudApi', () => {
  const src = fs.readFileSync(mangaJsPath, 'utf8');

  const outboxStart = src.indexOf('async flushSyncOutbox()');
  const outboxEnd = src.indexOf('async requestCloudApi(', outboxStart);
  const outboxBody = src.slice(outboxStart, outboxEnd);
  assert.ok(outboxBody.includes('this.requestCloudApi('), 'flushSyncOutbox must route via requestCloudApi so Desktop syncs to cloud worker');

  const queueStart = src.indexOf('async processSyncQueue()');
  const queueBody = src.slice(queueStart);
  assert.ok(queueBody.includes('uploadMangaChunks('), 'processSyncQueue must use uploadMangaChunks for manifest-verified uploads');
});

test('manga_sync_audit: uploadMangaChunks supports custom requestFn for Desktop cloud routing', async () => {
  const src = fs.readFileSync(transferJsPath, 'utf8');
  assert.ok(src.includes('requestFn'), 'manga_transfer.js must support requestFn / cloud routing');
});
