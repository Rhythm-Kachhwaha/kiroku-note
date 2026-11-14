const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

test('Contract Guard: Critical locked selectors exist across shell and tactile styles', () => {
  const shellCss = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'ui', 'shell', 'shell.css'), 'utf8');
  const tactileCss = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'tactile.css'), 'utf8');
  const topChromeJs = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'ui', 'shell', 'top_chrome.js'), 'utf8');
  const bottomDockJs = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'ui', 'shell', 'bottom_dock.js'), 'utf8');

  // Verify container IDs and tactile classes
  assert.ok(bottomDockJs.includes('bottom-dock-container') || shellCss.includes('#bottom-dock-container'),
    'Must define or reference #bottom-dock-container');
  assert.ok(topChromeJs.includes('top-chrome-container') || shellCss.includes('#top-chrome-container'),
    'Must define or reference #top-chrome-container');
  assert.ok(tactileCss.includes('.tactile-pill'),
    'Must define .tactile-pill in tactile.css');
  assert.ok(tactileCss.includes('.tactile-card'),
    'Must define .tactile-card in tactile.css');
  assert.ok(topChromeJs.includes('brand-wordmark') || topChromeJs.includes('brand-title') || shellCss.includes('.brand-title'),
    'Must reference or define brand wordmark / title');
});

test('Contract Guard: Typography matches final.md offline contracts without CDN leaks', () => {
  const fontsCss = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'fonts.css'), 'utf8');
  const tokensCss = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'tokens.css'), 'utf8');

  // Zero Google Fonts or external CDN links
  const forbiddenCdns = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'use.typekit.net'];
  for (const cdn of forbiddenCdns) {
    assert.ok(!fontsCss.includes(cdn), `fonts.css must not load external CDN: ${cdn}`);
    assert.ok(!tokensCss.includes(cdn), `tokens.css must not load external CDN: ${cdn}`);
  }

  // Core typography families from final.md
  const requiredFamilies = [
    'Noto Sans JP',
    'Zen Kaku Gothic New',
    'Inter',
    'Ranchers',
    'Mochiy Pop One',
    'Lilita One',
    'Hina Mincho'
  ];

  for (const family of requiredFamilies) {
    assert.ok(fontsCss.includes(family) || tokensCss.includes(family),
      `Expected font family "${family}" defined according to final.md`);
  }
});

test('Contract Guard: Zero emojis in responsive styles, web platform shim, and PWA shell', () => {
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

  const filesToCheck = [
    path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'responsive.css'),
    path.join(repoRoot, 'desktop', 'src', 'platform', 'web.js'),
    path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'settings.js'),
    path.join(repoRoot, 'worker', 'index.js'),
    path.join(repoRoot, 'worker', 'auth.js')
  ];

  for (const filePath of filesToCheck) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(!emojiRegex.test(content), `File must contain zero emojis: ${filePath}`);
    }
  }
});
