const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const buildPwaPath = path.join(ROOT_DIR, 'tools', 'build_pwa.js');
const swPath = path.join(ROOT_DIR, 'public', 'service-worker.js');

test('build_pwa: includes all manga runtime dependencies in static asset build hash', () => {
  const content = fs.readFileSync(buildPwaPath, 'utf8');
  assert.ok(content.includes('manga.js'), 'KEY_STATIC_ASSET_FILES must include manga.js');
  assert.ok(content.includes('manga.css'), 'KEY_STATIC_ASSET_FILES must include manga.css');
  assert.ok(content.includes('manga_storage.js'), 'KEY_STATIC_ASSET_FILES must include manga_storage.js');
  assert.ok(content.includes('manga_transfer.js'), 'KEY_STATIC_ASSET_FILES must include manga_transfer.js');
});

test('service_worker: precaches pdf.worker.min.js, manga.css, and transfer services for offline reading', () => {
  const content = fs.readFileSync(swPath, 'utf8');
  assert.ok(content.includes('/ui/vendor/pdf.worker.min.js'), 'must precache pdf.worker.min.js');
  assert.ok(content.includes('/ui/styles/views/manga.css'), 'must precache manga.css');
  assert.ok(content.includes('/ui/services/manga_storage.js'), 'must precache manga_storage.js');
  assert.ok(content.includes('/ui/services/manga_transfer.js'), 'must precache manga_transfer.js');
});
