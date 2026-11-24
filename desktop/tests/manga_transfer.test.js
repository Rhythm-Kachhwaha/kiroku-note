const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const transferJsPath = path.join(__dirname, '..', 'src', 'ui', 'services', 'manga_transfer.js');

test('manga_transfer: exports resumable upload, download, and manifest verification APIs', () => {
  const content = fs.readFileSync(transferJsPath, 'utf8');
  assert.ok(content.includes('export async function uploadMangaChunks'), 'must export uploadMangaChunks');
  assert.ok(content.includes('export async function downloadMangaChunks'), 'must export downloadMangaChunks');
  assert.ok(content.includes('export function createUploadManifest'), 'must export createUploadManifest');
  assert.ok(content.includes('MAX_CONCURRENT_CHUNKS'), 'must define bounded concurrency');
  assert.ok(content.includes('retry'), 'must include retry mechanism');
  assert.ok(content.includes('verifyBookStorage'), 'must verify storage upon download completion');
});

