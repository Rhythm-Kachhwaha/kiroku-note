const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const homeJsPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'home.js');

test('Home Screen: Removed mock data strings and cards are completely absent', () => {
  const content = fs.readFileSync(homeJsPath, 'utf8');

  // Forbidden mockup strings
  const forbiddenStrings = [
    'LV.28',
    '7 DAY STREAK',
    'WEEK GOAL MET',
    '64% MASTERY',
    '静寂',
    '〜わけにはいかない',
    'todays-word-card',
    'streak-card',
    'continue-card',
    'benchmark-card'
  ];

  for (const forbidden of forbiddenStrings) {
    assert.equal(
      content.includes(forbidden),
      false,
      `Home screen must NOT contain forbidden mockup string or card: "${forbidden}"`
    );
  }
});

test('Home Screen: Mascot is authentically svg_cat.svg and positioned on left zone', () => {
  const content = fs.readFileSync(homeJsPath, 'utf8');
  assert.ok(
    content.includes('svg_cat.svg'),
    'Home screen must reference the user mascot svg_cat.svg'
  );
  assert.ok(
    content.includes('home-left-zone'),
    'Home screen must place mascot in the left zone'
  );
});

test('Home Screen: Greeting renders dynamically without backend dependency', () => {
  const content = fs.readFileSync(homeJsPath, 'utf8');
  assert.ok(content.includes('getGreeting()'), 'Home screen must implement dynamic getGreeting()');
  assert.ok(content.includes('ohayou'), 'Home greeting includes morning greeting');
  assert.ok(content.includes('konnichiwa'), 'Home greeting includes afternoon greeting');
  assert.ok(content.includes('okaeri'), 'Home greeting includes evening greeting');
  assert.ok(!content.includes('apiClient'), 'Home screen mount should not require backend apiClient');
});

test('Home Screen Navigation: Bottom dock and Top chrome provide paths to all destinations', () => {
  const bottomDockPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'shell', 'bottom_dock.js');
  const topChromePath = path.join(repoRoot, 'desktop', 'src', 'ui', 'shell', 'top_chrome.js');
  const routerPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'router.js');

  const dockContent = fs.readFileSync(bottomDockPath, 'utf8');
  const chromeContent = fs.readFileSync(topChromePath, 'utf8');
  const routerContent = fs.readFileSync(routerPath, 'utf8');

  // Verify router registers all 8 views
  const expectedRoutes = ['home', 'vocab', 'vocab-history', 'grammar', 'kanji', 'test', 'study', 'settings'];
  for (const route of expectedRoutes) {
    assert.ok(
      routerContent.includes(`'${route}':`) || routerContent.includes(`"${route}":`),
      `Router must register route: ${route}`
    );
  }

  // Verify Bottom dock has primary tabs
  assert.ok(dockContent.includes("id: 'vocab'"), 'Bottom dock has Vocab tab');
  assert.ok(dockContent.includes("id: 'grammar'"), 'Bottom dock has Grammar tab');
  assert.ok(dockContent.includes("id: 'kanji'"), 'Bottom dock has Kanji tab');
  assert.ok(dockContent.includes("id: 'test'"), 'Bottom dock has Test tab');
  assert.ok(dockContent.includes("id: 'study'"), 'Bottom dock has Study tab');

  // Verify Settings in Top Chrome
  assert.ok(chromeContent.includes('btn-chrome-settings'), 'Top chrome has settings navigation button');
});
