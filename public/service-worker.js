/**
 * Kiroku Note PWA — Service Worker
 * Handles pre-caching of app shell, offline fonts, and runtime asset caching.
 * Supports GitHub Release asset streaming and CacheStorage versioning for MangaOCR models.
 */

const CACHE_NAME = 'kiroku-pwa-v1';
const MODEL_CACHE_NAME = 'kiroku-model-cache-v1';
const MODEL_VERSION = 'v1.0.0';
const MODEL_RELEASE_CDN = 'https://github.com/rhythmb/KirokuNote/releases/download/v1.0.0-models/manga-ocr-int8.onnx';

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
  '/ui/vendor/jszip.min.js',
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
  '/ui/assets/fonts/zen-old-mincho-japanese-400-normal.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_PRECACHE.map((url) =>
          fetch(url).then((response) => {
            if (response.ok) {
              return cache.put(url, response);
            }
          }).catch((err) => {
            console.warn('[SW] Precache skipped for:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      const allowed = [CACHE_NAME, MODEL_CACHE_NAME];
      return Promise.all(
        keys.filter((key) => !allowed.includes(key)).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Bypass service worker for API calls and non-GET requests
  if (request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  // Specialized Model Streamer for MangaOCR models
  if (url.pathname.includes('/ui/models/manga-ocr-int8.onnx')) {
    event.respondWith(
      caches.open(MODEL_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;

        // Try local server first
        try {
          const localResp = await fetch(request);
          if (localResp && localResp.ok) {
            const respToCache = new Response(localResp.body, {
              status: localResp.status,
              statusText: localResp.statusText,
              headers: new Headers({
                ...Object.fromEntries(localResp.headers.entries()),
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Model-Version': MODEL_VERSION
              })
            });
            cache.put(request, respToCache.clone());
            return respToCache;
          }
        } catch {}

        // Fallback to GitHub Release CDN
        try {
          const cdnResp = await fetch(MODEL_RELEASE_CDN, { mode: 'cors' });
          if (cdnResp && cdnResp.ok) {
            const respToCache = new Response(cdnResp.body, {
              status: cdnResp.status,
              statusText: cdnResp.statusText,
              headers: new Headers({
                ...Object.fromEntries(cdnResp.headers.entries()),
                'Content-Type': 'application/octet-stream',
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Model-Version': MODEL_VERSION
              })
            });
            cache.put(request, respToCache.clone());
            return respToCache;
          }
        } catch (cdnErr) {
          console.warn('[SW] Model CDN stream failed:', cdnErr);
        }

        return new Response('Model asset unavailable', { status: 503 });
      })
    );
    return;
  }

  // Cache-First strategy for static assets
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
