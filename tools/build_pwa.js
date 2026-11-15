/**
 * Kiroku Note — PWA Build Script
 * Bundles the desktop web assets into public/ for Cloudflare Workers / PWA serving.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DESKTOP_SRC = path.join(ROOT_DIR, 'desktop', 'src');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const MAX_ASSET_SIZE_BYTES = 25 * 1024 * 1024; // Cloudflare Workers 25 MiB asset limit

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      const stat = fs.statSync(srcPath);
      if (stat.size > MAX_ASSET_SIZE_BYTES) {
        console.warn(`[build-pwa] Skipping oversized asset (>25MB for Cloudflare): ${entry.name} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
        continue;
      }
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function build() {
  console.log('[build-pwa] Starting PWA build...');

  // 1. Ensure public directory exists
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  // 2. Copy ui directory from desktop/src/ui to public/ui
  console.log('[build-pwa] Copying UI assets, views, and styles...');
  copyDirRecursive(path.join(DESKTOP_SRC, 'ui'), path.join(PUBLIC_DIR, 'ui'));

  // 3. Copy platform shim to public/platform/web.js
  console.log('[build-pwa] Copying platform web shim...');
  fs.mkdirSync(path.join(PUBLIC_DIR, 'platform'), { recursive: true });
  fs.copyFileSync(
    path.join(DESKTOP_SRC, 'platform', 'web.js'),
    path.join(PUBLIC_DIR, 'platform', 'web.js')
  );

  // 3b. Copy OCR worker to public/ocr/
  console.log('[build-pwa] Copying OCR worker...');
  fs.mkdirSync(path.join(PUBLIC_DIR, 'ocr'), { recursive: true });
  if (fs.existsSync(path.join(DESKTOP_SRC, 'ocr'))) {
    copyDirRecursive(path.join(DESKTOP_SRC, 'ocr'), path.join(PUBLIC_DIR, 'ocr'));
  }

  // 3c. Copy login.html if present
  const loginSrc = path.join(DESKTOP_SRC, 'login.html');
  if (fs.existsSync(loginSrc)) {
    fs.copyFileSync(loginSrc, path.join(PUBLIC_DIR, 'login.html'));
  }

  // 3d. Copy icons to public/icons/ and favicon.ico
  console.log('[build-pwa] Copying app icons...');
  const iconsSrc = path.join(ROOT_DIR, 'assets', 'icons');
  if (fs.existsSync(iconsSrc)) {
    copyDirRecursive(iconsSrc, path.join(PUBLIC_DIR, 'icons'));
    const faviconSrc = path.join(iconsSrc, 'favicon.ico');
    if (fs.existsSync(faviconSrc)) {
      fs.copyFileSync(faviconSrc, path.join(PUBLIC_DIR, 'favicon.ico'));
    }
  }

  // 4. Adapt desktop/src/index.html into public/index.html
  console.log('[build-pwa] Generating public/index.html...');
  const srcHtmlPath = path.join(DESKTOP_SRC, 'index.html');
  let html = fs.readFileSync(srcHtmlPath, 'utf8');

  // Allow web connect-src for trusted PWA APIs (Cloudflare, Render, Neon, Turso)
  html = html.replace(
    "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*;",
    "connect-src 'self' https://*.neon.tech https://kiroku-cloud-queue.onrender.com https://*.turso.io http://127.0.0.1:* ws://127.0.0.1:*;"
  );

  // Inject PWA manifest and mobile tags
  const pwaHeadTags = `
  <!-- PWA Metadata & Icons -->
  <link rel="manifest" href="/manifest.json">
  <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <meta name="theme-color" content="#0f1115">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <script type="module" src="./platform/web.js"></script>
`;
  html = html.replace('</head>', `${pwaHeadTags}\n</head>`);

  // Inject Service Worker registration before </body>
  const swScript = `
  <!-- PWA Service Worker Registration -->
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch((err) => {
          console.warn('[PWA] ServiceWorker registration failed:', err);
        });
      });
    }
  </script>
</body>`;
  html = html.replace('</body>', swScript);

  fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), html, 'utf8');

  // 5. Stamp Service Worker CACHE_NAME with build timestamp/hash
  console.log('[build-pwa] Stamping service-worker.js with build hash...');
  const swPath = path.join(PUBLIC_DIR, 'service-worker.js');
  stampServiceWorker(swPath);

  console.log('[build-pwa] PWA build complete. Assets ready in public/.');
}

function stampServiceWorker(swPath, buildHash = Date.now().toString(36)) {
  if (!fs.existsSync(swPath)) return null;
  let swContent = fs.readFileSync(swPath, 'utf8');
  const stampedCacheName = `kiroku-pwa-${buildHash}`;
  swContent = swContent.replace(
    /const CACHE_NAME = ['"][^'"]+['"];/,
    `const CACHE_NAME = '${stampedCacheName}';`
  );
  fs.writeFileSync(swPath, swContent, 'utf8');
  console.log(`[build-pwa] Stamped service worker CACHE_NAME: ${stampedCacheName}`);
  return stampedCacheName;
}

if (require.main === module) {
  build();
}

module.exports = { build, stampServiceWorker };
