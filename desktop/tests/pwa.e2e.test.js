/**
 * Kiroku Note — PWA End-to-End & Mobile Integration Test
 * Simulates mobile viewport ergonomics, web platform bridge,
 * op-log queue lifecycle, and Manga OPFS storage contracts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..', '..');

test('PWA E2E: Responsive layout rules support standard mobile viewports', () => {
  const responsiveCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'responsive.css');
  assert.ok(fs.existsSync(responsiveCssPath), 'responsive.css must exist');
  const css = fs.readFileSync(responsiveCssPath, 'utf8');

  // Verify clamp() fluid typography
  assert.ok(css.includes('clamp('), 'responsive.css must define clamp() typography');
  assert.ok(css.includes('--font-size-base'), 'responsive.css must set --font-size-base');
  assert.ok(css.includes('--font-size-sm'), 'responsive.css must set --font-size-sm');
  assert.ok(css.includes('--font-size-lg'), 'responsive.css must set --font-size-lg');

  // Verify safe area insets
  assert.ok(css.includes('safe-area-inset-top'), 'Must support safe-area-inset-top');
  assert.ok(css.includes('safe-area-inset-bottom'), 'Must support safe-area-inset-bottom');

  // Verify mobile touch minimum tap target (44px)
  assert.ok(css.includes('44px'), 'Must enforce minimum 44px tap targets for mobile ergonomics');
  assert.ok(css.includes('touch-action: manipulation'), 'Must optimize touch action for responsiveness');
});

test('PWA E2E: Web platform bridge provides all necessary desktop API fallbacks', async () => {
  const webJsPath = path.join(repoRoot, 'desktop', 'src', 'platform', 'web.js');
  assert.ok(fs.existsSync(webJsPath), 'web.js shim must exist');
  const content = fs.readFileSync(webJsPath, 'utf8');

  // Must export webAPI
  assert.ok(content.includes('export const webAPI'), 'web.js must export webAPI');
  assert.ok(content.includes('isPWA: true'), 'webAPI must identify as isPWA: true');
  assert.ok(content.includes('isDesktop: false'), 'webAPI must identify as isDesktop: false');

  // Tactile Haptics API
  assert.ok(content.includes('haptic:'), 'webAPI must provide haptic sub-object');
  assert.ok(content.includes('vibrate'), 'haptic implementation must call navigator.vibrate');

  // PWA Install prompt integration
  assert.ok(content.includes('beforeinstallprompt'), 'web.js must listen for beforeinstallprompt event');
  assert.ok(content.includes('promptInstall'), 'webAPI.pwa must provide promptInstall method');

  // Gesture swipe to dismiss
  assert.ok(content.includes('touchstart') && content.includes('touchend'),
    'web.js must attach touch event listeners for swipe-to-dismiss gesture');
});

test('PWA E2E: Op-Log queue protocol conforms to durable lease and ack contracts', async () => {
  // Simulate queue data structures used across Worker and Client
  const mockQueue = [];
  const activeLeases = new Map();

  function enqueue(card) {
    const id = 'op_' + Math.random().toString(36).slice(2, 9);
    const item = {
      id,
      payload: card,
      created_at: new Date().toISOString(),
      ack: false,
      lease_id: null,
      attempts: 0
    };
    mockQueue.push(item);
    return id;
  }

  function acquireLease(leaseDurationSec = 60) {
    const now = Date.now();
    const candidate = mockQueue.find(item => !item.ack && (!item.lease_id || item.lease_expires_at < now));
    if (!candidate) return null;

    const leaseId = 'lease_' + Math.random().toString(36).slice(2, 9);
    candidate.lease_id = leaseId;
    candidate.lease_expires_at = now + (leaseDurationSec * 1000);
    candidate.attempts += 1;
    activeLeases.set(leaseId, candidate);
    return { lease_id: leaseId, item: candidate };
  }

  function acknowledge(leaseId) {
    const item = activeLeases.get(leaseId);
    if (!item) return false;
    item.ack = true;
    item.acked_at = new Date().toISOString();
    activeLeases.delete(leaseId);
    return true;
  }

  // 1. Submit card from PWA client
  const cardId = enqueue({ expression: '食べる', reading: 'たべる', meaning: 'to eat' });
  assert.ok(cardId.startsWith('op_'));
  assert.equal(mockQueue.length, 1);

  // 2. Local PC worker leases card
  const lease = acquireLease(60);
  assert.ok(lease !== null);
  assert.equal(lease.item.id, cardId);
  assert.equal(lease.item.attempts, 1);

  // 3. Duplicate lease request while leased returns null
  const secondLease = acquireLease(60);
  assert.equal(secondLease, null);

  // 4. Worker acknowledges card
  const acked = acknowledge(lease.lease_id);
  assert.equal(acked, true);
  assert.equal(mockQueue[0].ack, true);
});

test('PWA E2E: Manga OPFS storage module exports expected async lifecycle', () => {
  const mangaStoragePath = path.join(repoRoot, 'desktop', 'src', 'ui', 'services', 'manga_storage.js');
  assert.ok(fs.existsSync(mangaStoragePath), 'manga_storage.js must exist');
  const code = fs.readFileSync(mangaStoragePath, 'utf8');

  assert.ok(code.includes('export async function storeBookFile'), 'Must export storeBookFile');
  assert.ok(code.includes('export async function getBookFile'), 'Must export getBookFile');
  assert.ok(code.includes('export async function deleteBookFile'), 'Must export deleteBookFile');
  assert.ok(code.includes('navigator.storage.getDirectory'), 'Must reference OPFS navigator.storage.getDirectory');
});

test('PWA E2E: Web shim dispatchFetch contract returns success: true on 200 and success: false on error', async () => {
  const webJsPath = path.join(repoRoot, 'desktop', 'src', 'platform', 'web.js');
  const webModule = await import(pathToFileURL(webJsPath).href);
  const dispatchFetch = webModule.dispatchFetch || ((path, opts) => webModule.webAPI.api.request({ path, ...opts }));

  const originalFetch = globalThis.fetch;
  try {
    // 1. Success 200 response
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'ok', syllabus: ['N5', 'N4'] })
    });
    const successRes = await dispatchFetch('/api/syllabus');
    assert.equal(successRes.success, true, '200 response must have success: true');
    assert.equal(successRes.ok, true, '200 response must have ok: true');
    assert.equal(successRes.status, 200);
    assert.deepEqual(successRes.data, { status: 'ok', syllabus: ['N5', 'N4'] });

    // 2. HTTP error response (e.g. 500)
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => 'application/json' },
      json: async () => ({ detail: 'Syllabus error: Failed to parse' })
    });
    const errorRes = await dispatchFetch('/api/syllabus');
    assert.equal(errorRes.success, false, 'Error response must have success: false');
    assert.equal(errorRes.ok, false, 'Error response must have ok: false');
    assert.equal(errorRes.status, 500);
    assert.deepEqual(errorRes.error, {
      message: 'Syllabus error: Failed to parse',
      detail: 'Syllabus error: Failed to parse'
    });

    // 3. Network rejection / exception
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch');
    };
    const networkErrRes = await dispatchFetch('/api/syllabus');
    assert.equal(networkErrRes.success, false, 'Network error must have success: false');
    assert.equal(networkErrRes.ok, false, 'Network error must have ok: false');
    assert.equal(networkErrRes.status, 0);
    assert.deepEqual(networkErrRes.error, {
      code: 'NETWORK_ERROR',
      message: 'Error: Failed to fetch',
      detail: 'Error: Failed to fetch'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PWA E2E: Service worker implements Network-First caching, build hash stamping, and cache purging', async () => {
  const vm = require('node:vm');
  const os = require('node:os');
  const swPath = path.join(repoRoot, 'public', 'service-worker.js');
  const buildPwaPath = path.join(repoRoot, 'tools', 'build_pwa.js');

  assert.ok(fs.existsSync(swPath), 'public/service-worker.js must exist');
  assert.ok(fs.existsSync(buildPwaPath), 'tools/build_pwa.js must exist');

  // 1. tools/build_pwa.js stamps CACHE_NAME in service-worker.js using deterministic hash
  const buildPwa = require(buildPwaPath);
  assert.equal(typeof buildPwa.stampServiceWorker, 'function', 'build_pwa.js must export stampServiceWorker');
  assert.equal(typeof buildPwa.computeBuildHash, 'function', 'build_pwa.js must export computeBuildHash');

  // Verify determinism of computeBuildHash
  const hash1 = buildPwa.computeBuildHash();
  const hash2 = buildPwa.computeBuildHash();
  assert.equal(hash1, hash2, 'computeBuildHash must be deterministic');
  assert.match(hash1, /^[a-f0-9]{10}$/, 'computeBuildHash must return 10-char hex string');

  // Test stampServiceWorker on a temp file in os.tmpdir() rather than mutating public/service-worker.js
  const tempSwPath = path.join(os.tmpdir(), `test-sw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.js`);
  fs.writeFileSync(tempSwPath, "const CACHE_NAME = 'kiroku-pwa-initial';\nconst MODEL_CACHE_NAME = 'kiroku-model-cache-v1';", 'utf8');

  try {
    const testHash = 'teststamp_' + Math.random().toString(36).slice(2, 8);
    const stampedName = buildPwa.stampServiceWorker(tempSwPath, testHash);
    assert.equal(stampedName, `kiroku-pwa-${testHash}`);

    const updatedSw = fs.readFileSync(tempSwPath, 'utf8');
    assert.ok(
      updatedSw.includes(`const CACHE_NAME = 'kiroku-pwa-${testHash}';`),
      'stamped file must contain expected CACHE_NAME'
    );
  } finally {
    try { fs.unlinkSync(tempSwPath); } catch (_) {}
  }

  // 2. Behavioral verification of Service Worker caching and purging strategies
  const swCode = fs.readFileSync(swPath, 'utf8');

  // Verify static assertions on source code
  assert.ok(swCode.includes("MODEL_CACHE_NAME = 'kiroku-model-cache-v1'"), 'MODEL_CACHE_NAME must remain intact');
  assert.ok(swCode.includes('self.skipWaiting()'), 'Must call skipWaiting in install event');
  assert.ok(swCode.includes('clients.claim()'), 'Must call clients.claim in activate event');
  assert.ok(swCode.includes('status === 200'), 'Must guard cache.put with status === 200 to prevent 206 caching errors');

  // Set up mock Service Worker environment
  const cacheStore = new Map();
  class MockCache {
    constructor(name) {
      this.name = name;
      this.items = new Map();
    }
    async put(req, res) {
      const key = typeof req === 'string' ? req : req.url;
      this.items.set(key, res);
    }
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      if (this.items.has(key)) return this.items.get(key);
      try {
        const u = new URL(key, 'http://localhost');
        if (this.items.has(u.pathname)) return this.items.get(u.pathname);
      } catch (_) {}
      return null;
    }
  }

  function getOrCreateCache(name) {
    if (!cacheStore.has(name)) {
      cacheStore.set(name, new MockCache(name));
    }
    return cacheStore.get(name);
  }

  const mockCaches = {
    open: async (name) => getOrCreateCache(name),
    match: async (req) => {
      const key = typeof req === 'string' ? req : req.url;
      for (const c of cacheStore.values()) {
        const item = await c.match(key);
        if (item) return item;
      }
      return null;
    },
    keys: async () => Array.from(cacheStore.keys()),
    delete: async (name) => {
      const existed = cacheStore.has(name);
      cacheStore.delete(name);
      return existed;
    }
  };

  let claimed = false;
  const listeners = {};
  const mockSelf = {
    addEventListener(event, fn) {
      listeners[event] = fn;
    },
    skipWaiting() {},
    clients: {
      claim: async () => {
        claimed = true;
      }
    },
    location: { href: 'https://app.kiroku.test/' }
  };
  mockSelf.self = mockSelf;

  let currentFetchImpl = null;
  const sandbox = {
    self: mockSelf,
    clients: mockSelf.clients,
    caches: mockCaches,
    fetch: (req, opts) => currentFetchImpl(req, opts),
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    URL: globalThis.URL,
    console: { warn: () => {}, log: () => {} }
  };

  vm.createContext(sandbox);
  const activeCacheName = vm.runInContext(swCode + '; CACHE_NAME;', sandbox);

  assert.ok(activeCacheName.startsWith('kiroku-pwa-'), 'CACHE_NAME must start with kiroku-pwa-');

  // Verify activate event purges old kiroku-pwa-* caches while preserving active & model caches
  cacheStore.set('kiroku-pwa-legacy1', new MockCache('kiroku-pwa-legacy1'));
  cacheStore.set('kiroku-pwa-legacy2', new MockCache('kiroku-pwa-legacy2'));
  cacheStore.set(activeCacheName, new MockCache(activeCacheName));
  cacheStore.set('kiroku-model-cache-v1', new MockCache('kiroku-model-cache-v1'));
  cacheStore.set('kiroku-shared-manga', new MockCache('kiroku-shared-manga'));

  let activateWait = null;
  listeners['activate']({ waitUntil: (p) => { activateWait = p; } });
  await activateWait;

  assert.equal(claimed, true, 'clients.claim() must be called on activate');
  assert.equal(cacheStore.has('kiroku-pwa-legacy1'), false, 'Old cache legacy1 must be purged');
  assert.equal(cacheStore.has('kiroku-pwa-legacy2'), false, 'Old cache legacy2 must be purged');
  assert.equal(cacheStore.has(activeCacheName), true, 'Current CACHE_NAME must be preserved');
  assert.equal(cacheStore.has('kiroku-model-cache-v1'), true, 'Model cache must be preserved');
  assert.equal(cacheStore.has('kiroku-shared-manga'), true, 'Non-pwa cache must be preserved');

  // Verify fetch event bypasses /api/ and /auth/
  let apiResponded = false;
  listeners['fetch']({
    request: { method: 'GET', url: 'https://app.kiroku.test/api/sync' },
    respondWith: () => { apiResponded = true; }
  });
  assert.equal(apiResponded, false, '/api/ requests must bypass service worker');

  let authResponded = false;
  listeners['fetch']({
    request: { method: 'GET', url: 'https://app.kiroku.test/auth/session' },
    respondWith: () => { authResponded = true; }
  });
  assert.equal(authResponded, false, '/auth/ requests must bypass service worker');

  // Verify Cache-First for fonts
  const fontUrl = 'https://app.kiroku.test/ui/assets/fonts/inter-latin-400-normal.woff2';
  const activeCache = cacheStore.get(activeCacheName);
  await activeCache.put(fontUrl, new Response('cached font data'));

  let fontNetworkHit = false;
  currentFetchImpl = async () => {
    fontNetworkHit = true;
    return new Response('network font data');
  };

  let fontPromise = null;
  listeners['fetch']({
    request: { method: 'GET', url: fontUrl },
    respondWith: (p) => { fontPromise = p; }
  });
  const fontRes = await fontPromise;
  assert.equal(await fontRes.text(), 'cached font data');
  assert.equal(fontNetworkHit, false, 'Fonts must be served Cache-First without network hit if cached');

  // Verify uncached font network failure returns 503 instead of throwing
  currentFetchImpl = async () => {
    throw new TypeError('Font fetch network failure');
  };
  let failedFontPromise = null;
  listeners['fetch']({
    request: { method: 'GET', url: 'https://app.kiroku.test/ui/assets/fonts/uncached.woff2' },
    respondWith: (p) => { failedFontPromise = p; }
  });
  const failedFontRes = await failedFontPromise;
  assert.equal(failedFontRes.status, 503, 'Failed font fetch must return 503');

  // Verify Network-First for static web assets (JS/CSS/HTML)
  const cssUrl = 'https://app.kiroku.test/ui/styles/tokens.css';
  // Step A: Online - fetch from network and update cache (using CSS custom property token)
  currentFetchImpl = async () => new Response(':root { --accent: var(--pure-white); }', { status: 200 });
  let cssPromise = null;
  listeners['fetch']({
    request: { method: 'GET', url: cssUrl },
    respondWith: (p) => { cssPromise = p; }
  });
  const cssRes = await cssPromise;
  assert.equal(await cssRes.text(), ':root { --accent: var(--pure-white); }');
  const cachedCss = await activeCache.match(cssUrl);
  assert.ok(cachedCss, 'Network-First must update cache on successful 200 network fetch');

  // Step A2: HTTP 206 Partial Content is NOT cached
  const partialUrl = 'https://app.kiroku.test/ui/large-asset.js';
  currentFetchImpl = async () => new Response('partial content', { status: 206 });
  let partialPromise = null;
  listeners['fetch']({
    request: { method: 'GET', url: partialUrl },
    respondWith: (p) => { partialPromise = p; }
  });
  const partialRes = await partialPromise;
  assert.equal(partialRes.status, 206);
  const cachedPartial = await activeCache.match(partialUrl);
  assert.equal(cachedPartial, null, '206 Partial Content must not be cached');

  // Step B: Offline - fallback to cached asset
  currentFetchImpl = async () => {
    throw new TypeError('Failed to fetch (offline)');
  };
  let offlineCssPromise = null;
  listeners['fetch']({
    request: { method: 'GET', url: cssUrl },
    respondWith: (p) => { offlineCssPromise = p; }
  });
  const offlineCssRes = await offlineCssPromise;
  assert.equal(await offlineCssRes.text(), ':root { --accent: var(--pure-white); }', 'Offline static asset must fall back to cache');

  // Verify Network-First for navigations with fallback to /index.html and /
  await activeCache.put('/index.html', new Response('<!DOCTYPE html><html>App Shell</html>'));
  let navPromise = null;
  listeners['fetch']({
    request: { method: 'GET', url: 'https://app.kiroku.test/decks', mode: 'navigate' },
    respondWith: (p) => { navPromise = p; }
  });
  const navRes = await navPromise;
  assert.equal(await navRes.text(), '<!DOCTYPE html><html>App Shell</html>', 'Offline navigation must fall back to /index.html');

  // Verify navigation fallback to / if /index.html is missing
  cacheStore.delete(activeCacheName);
  const freshCache = getOrCreateCache(activeCacheName);
  await freshCache.put('/', new Response('<!DOCTYPE html><html>Root Shell</html>'));
  let navRootPromise = null;
  listeners['fetch']({
    request: { method: 'GET', url: 'https://app.kiroku.test/review', mode: 'navigate' },
    respondWith: (p) => { navRootPromise = p; }
  });
  const navRootRes = await navRootPromise;
  assert.equal(await navRootRes.text(), '<!DOCTYPE html><html>Root Shell</html>', 'Offline navigation must fall back to / if /index.html missing');
});


