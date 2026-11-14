/**
 * Kiroku Note PWA — Service Worker
 * Handles pre-caching of app shell, offline fonts, and runtime asset caching.
 */

const CACHE_NAME = 'kiroku-pwa-v1';

const STATIC_PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/platform/web.js',
  '/ui/styles/tokens.css',
  '/ui/styles/fonts.css',
  '/ui/styles/tactile.css',
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
      // Use map with catch so individual optional assets don't fail the whole install
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
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Bypass service worker for API calls and non-GET requests
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // Cache-First strategy for static assets (fonts, images, rive, wasm, scripts, styles)
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
        // Fallback for navigation
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
