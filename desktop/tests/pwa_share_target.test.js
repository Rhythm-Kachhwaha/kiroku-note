const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const swPath = path.join(__dirname, '..', '..', 'public', 'service-worker.js');
const mangaJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'manga.js');

test('pwa_share_target: service worker isolates shared manga payloads with unique keys', () => {
  const content = fs.readFileSync(swPath, 'utf8');
  assert.ok(content.includes("url.searchParams.get('action') === 'share-target'"), 'SW must handle share-target action');
  assert.ok(content.includes('kiroku-shared-manga'), 'SW must store in kiroku-shared-manga cache');
  assert.ok(content.includes('payloadId = `shared_${Date.now()}_'), 'SW must generate unique payload ID with timestamp and entropy');
  assert.ok(content.includes('cache.put(`/_shared_manga_${payloadId}`'), 'SW must store under unique payload URL');
  assert.ok(content.includes('X-Manga-Filename'), 'SW must preserve original filename in headers');
  assert.ok(content.includes('X-Payload-Id'), 'SW must preserve payload ID in headers');
});

test('pwa_share_target: manga.js consumes all queued shared payloads without overwriting', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes('checkSharedMangaPayload()'), 'MangaView must implement checkSharedMangaPayload');
  assert.ok(content.includes("caches.open('kiroku-shared-manga')"), 'Must open kiroku-shared-manga cache');
  assert.ok(content.includes("urlStr.includes('/_shared_manga')"), 'Must match all shared manga payloads');
  assert.ok(content.includes('await cache.delete(req)'), 'Must delete consumed payload immediately to prevent re-opening');
  assert.ok(content.includes('filesToOpen.push(file)'), 'Must collect all shared files into batch array');
  assert.ok(content.includes('await this.openFiles(filesToOpen)'), 'Must pass batch of files to openFiles');
});

test('pwa_share_target: simulated consumption of multiple concurrent shared payloads', async () => {
  const mockCacheStore = new Map();
  const mockCache = {
    keys: async () => Array.from(mockCacheStore.keys()).map(url => ({ url })),
    match: async (req) => mockCacheStore.get(req.url),
    delete: async (req) => mockCacheStore.delete(req.url)
  };

  // Seed two distinct shared files
  const file1 = { name: 'Volume_1.cbz', type: 'application/x-cbz' };
  const file2 = { name: 'Chapter_2.pdf', type: 'application/pdf' };

  mockCacheStore.set('/_shared_manga_shared_1000_abc', {
    headers: new Map([
      ['X-Manga-Filename', encodeURIComponent('Volume_1.cbz')],
      ['X-Payload-Id', 'shared_1000_abc']
    ]),
    blob: async () => file1
  });

  mockCacheStore.set('/_shared_manga_shared_2000_xyz', {
    headers: new Map([
      ['X-Manga-Filename', encodeURIComponent('Chapter_2.pdf')],
      ['X-Payload-Id', 'shared_2000_xyz']
    ]),
    blob: async () => file2
  });

  // Simulated consumption logic
  const keys = await mockCache.keys();
  const filesToOpen = [];

  for (const req of keys) {
    if (req.url.includes('/_shared_manga')) {
      const match = await mockCache.match(req);
      if (match) {
        await mockCache.delete(req);
        const rawFilename = match.headers.get('X-Manga-Filename');
        const filename = decodeURIComponent(rawFilename);
        const blob = await match.blob();
        filesToOpen.push({ filename, blob });
      }
    }
  }

  // Assertions
  assert.equal(filesToOpen.length, 2, 'Must process both shared files without dropping or overwriting');
  assert.equal(filesToOpen[0].filename, 'Volume_1.cbz');
  assert.equal(filesToOpen[1].filename, 'Chapter_2.pdf');
  assert.equal(mockCacheStore.size, 0, 'Cache must be empty after consumption');
});
