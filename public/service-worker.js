/**
 * Kiroku Note PWA — Service Worker
 * Handles pre-caching of app shell, offline fonts, and runtime asset caching.
 * Supports GitHub Release asset streaming and CacheStorage versioning for MangaOCR models.
 */

const CACHE_NAME = 'kiroku-pwa-aa88597d99';

const STATIC_PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/platform/web.js',
  '/ui/styles/tokens.css',
  '/ui/styles/fonts.css',
  '/ui/styles/tactile.css',
  '/ui/styles/responsive.css',
  '/ui/shell/shell.css',
  '/ui/styles/bundle.css',
  '/ui/vendor/lottie.min.js',
  '/ui/vendor/rive.js',
  '/ui/vendor/pdf.min.js',
  '/ui/vendor/pdf.worker.min.js',
  '/ui/vendor/jszip.min.js',
  '/ui/styles/views/manga.css',
  '/ui/services/manga_storage.js',
  '/ui/services/manga_transfer.js',
  '/ui/assets/fonts/noto-sans-jp-vf.ttf',
  '/ui/assets/fonts/zen-kaku-gothic-new-japanese-400-normal.woff2',
  '/ui/assets/fonts/zen-kaku-gothic-new-japanese-500-normal.woff2',
  '/ui/assets/fonts/inter-latin-400-normal.woff2',
  '/ui/assets/fonts/inter-latin-500-normal.woff2',
  '/ui/assets/fonts/inter-latin-600-normal.woff2',
  '/ui/assets/fonts/inter-latin-700-normal.woff2',
  '/ui/assets/fonts/ranchers-latin-400-normal.woff2',
  '/ui/assets/fonts/ranchers.ttf',
  '/ui/assets/fonts/mochiy-pop-one-japanese-400-normal.woff2',
  '/ui/assets/fonts/lilita-one.ttf',
  '/ui/assets/fonts/hina-mincho.ttf',
  '/ui/assets/fonts/zen-old-mincho-japanese-400-normal.woff2',
  '/ui/router.js',
  '/ui/shell/top_chrome.js',
  '/ui/shell/bottom_dock.js',
  '/ui/components/auth_modal.js',
  '/ui/components/sync_loader.js',
  '/ui/views/home.js',
  '/ui/views/manga.js',
  '/ui/views/anime.js',
  '/ui/views/grammar.js',
  '/ui/views/kanji.js',
  '/ui/views/review_player.js',
  '/ui/views/settings.js'
];

const MANDATORY_PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/platform/web.js',
  '/ui/vendor/pdf.min.js',
  '/ui/vendor/pdf.worker.min.js',
  '/ui/vendor/jszip.min.js',
  '/ui/styles/views/manga.css',
  '/ui/services/manga_storage.js',
  '/ui/services/manga_transfer.js',
  '/ui/views/manga.js',
  '/ui/router.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 1. Mandatory assets must succeed or install fails
      await Promise.all(
        MANDATORY_PRECACHE.map(async (url) => {
          const res = await fetch(url);
          if (!res || !res.ok) {
            throw new Error(`[SW] Mandatory asset precache failed for: ${url} (status: ${res?.status})`);
          }
          await cache.put(url, res);
        })
      );

      // 2. Optional assets (fonts, icons, other views) can settle gracefully
      const optionalAssets = STATIC_PRECACHE.filter(u => !MANDATORY_PRECACHE.includes(u));
      await Promise.allSettled(
        optionalAssets.map(async (url) => {
          try {
            const res = await fetch(url);
            if (res && res.ok) {
              await cache.put(url, res);
            }
          } catch (err) {
            console.warn('[SW] Optional precache skipped for:', url);
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('kiroku-pwa-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url, typeof self !== 'undefined' && self.location ? self.location.href : 'http://localhost');

  // Handle PWA Web Share Target for direct mobile manga/PDF sharing with unique payload IDs
  if (request.method === 'POST' && url.searchParams.get('action') === 'share-target') {
    event.respondWith((async () => {
      try {
        const formData = await request.formData();
        const mangaFile = formData.get('manga_file');
        if (mangaFile) {
          const cache = await caches.open('kiroku-shared-manga');
          const payloadId = `shared_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          await cache.put(`/_shared_manga_${payloadId}`, new Response(mangaFile, {
            headers: {
              'Content-Type': mangaFile.type || 'application/octet-stream',
              'X-Manga-Filename': encodeURIComponent(mangaFile.name || 'shared_manga.pdf'),
              'X-Payload-Id': payloadId
            }
          }));
        }
      } catch (err) {
        console.warn('[SW] Share target processing error:', err);
      }
      const targetUrl = new URL('/#manga', (typeof self !== 'undefined' && self.location) ? self.location.origin : 'http://localhost').href;
      return Response.redirect(targetUrl, 303);
    })());
    return;
  }

  // Bypass service worker for API calls and non-GET requests
  if (request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return;
  }


  // Cache-First strategy for fonts (/ui/assets/fonts/)
  if (url.pathname.includes('/ui/assets/fonts/')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(request, responseToCache))
                .catch((err) => console.warn('[SW] Cache put failed:', err));
            }
            return networkResponse;
          })
          .catch(() => {
            return new Response('Font unavailable', { status: 503 });
          });
      })
    );
    return;
  }

  // Network-First strategy for navigations and static web assets (HTML, JS, CSS, etc.)
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, responseToCache))
            .catch((err) => console.warn('[SW] Cache put failed:', err));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        if (request.mode === 'navigate') {
          const shell = (await caches.match('/index.html')) || (await caches.match('/'));
          if (shell) return shell;
        }
        return new Response('Offline resource unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' }
        });
      })
  );
});
