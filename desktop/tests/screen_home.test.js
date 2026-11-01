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

test('Home Screen: Mascot is authentically svg_cat.svg and positioned on left zone with organic backing shape', () => {
  const content = fs.readFileSync(homeJsPath, 'utf8');
  assert.ok(
    content.includes('svg_cat.svg'),
    'Home screen must reference the user mascot svg_cat.svg'
  );
  assert.ok(
    content.includes('home-left-zone'),
    'Home screen must place mascot in the left zone'
  );
  assert.ok(
    content.includes('organic-shape-backing'),
    'Home screen must include organic tilted backing shape'
  );
  assert.ok(
    content.includes('comic-speech-bubble'),
    'Home screen must include comic speech bubble'
  );
  assert.ok(
    content.includes('comic-pointer-tail'),
    'Comic speech bubble must include pointer tail'
  );
  assert.ok(
    content.includes('mousemove'),
    'Home screen must attach mousemove listener for subtle head/pupil tracking'
  );
});

test('Home Screen: Greeting renders dynamically and includes full rotating editorial expressions', () => {
  const content = fs.readFileSync(homeJsPath, 'utf8');
  assert.ok(content.includes('getGreeting('), 'Home screen must implement dynamic getGreeting()');
  assert.ok(content.includes('ohayou'), 'Home greeting includes morning greeting');
  assert.ok(content.includes('konnichiwa'), 'Home greeting includes afternoon greeting');
  assert.ok(content.includes('okaeri'), 'Home greeting includes evening greeting');
  assert.ok(content.includes('今夜も勉強？'), 'Home greeting includes night greeting');
  assert.ok(content.includes('毎日の積み重ね'), 'Home greeting includes daily accumulation greeting');
  assert.ok(content.includes('一歩一歩進もう'), 'Home greeting includes step-by-step greeting');
  assert.ok(!content.includes('apiClient'), 'Home screen mount should not require backend apiClient');
});

test('Home Screen: Curated daily Japanese word is deterministic and links to Vocab desk', async () => {
  const content = fs.readFileSync(homeJsPath, 'utf8');
  assert.ok(content.includes('getDailyWord'), 'Home screen must implement getDailyWord()');
  assert.ok(content.includes('home-daily-word') || content.includes('daily-vocab-stamp'), 'Home screen must include daily word stamp container');
  assert.ok(!content.includes('todays-word-card'), 'Home screen must NOT use forbidden todays-word-card');
  assert.ok(!content.includes('静寂'), 'Home screen must NOT contain forbidden word 静寂');

  // Verify curated words
  const requiredWords = ['木漏れ日', '風情', '一期一会', '雨宿り', '陽だまり', '浮世', '心づくし'];
  for (const word of requiredWords) {
    assert.ok(content.includes(word), `Home screen curated words must include "${word}"`);
  }

  // Verify navigation to Vocab desk
  assert.ok(content.includes("navigateToTab('vocab')"), 'Daily word stamp must navigate to vocab desk');

  // Verify class export and method execution
  const { HomeView } = await import('../src/ui/views/home.js');
  const routerMock = { navigateToTab: () => {} };
  const homeView = new HomeView(routerMock);

  const d1 = new Date('2026-11-01T10:00:00Z');
  const d2 = new Date('2026-11-01T22:00:00Z');
  const word1 = homeView.getDailyWord(d1);
  const word2 = homeView.getDailyWord(d2);
  assert.deepEqual(word1, word2, 'Daily word must return same entry for same calendar day');
  assert.ok(word1.kanji && word1.reading && word1.meaning && word1.jlpt, 'Daily word entry must have kanji, reading, meaning, and jlpt');
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

test('Home Screen Styles: bundle.css styles mascot stage, organic backing, and contains zero forbidden mock selectors', () => {
  const bundleCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'bundle.css');
  const css = fs.readFileSync(bundleCssPath, 'utf8');

  // Forbidden mockup selectors
  const forbiddenSelectors = [
    'todays-word-card',
    'streak-card',
    'continue-card',
    'benchmark-card'
  ];
  for (const sel of forbiddenSelectors) {
    assert.ok(!css.includes(sel), `bundle.css must NOT contain forbidden selector: "${sel}"`);
  }

  assert.ok(css.includes('.organic-shape-backing'), 'bundle.css must style .organic-shape-backing');
  assert.ok(css.includes('.home-daily-word') || css.includes('.daily-vocab-stamp'), 'bundle.css must style daily word stamp');
  assert.ok(css.includes('.home-action-card'), 'bundle.css must style .home-action-card');

  // No legacy chocolate/orange hex codes
  const legacyColors = ['#26170D', '#FF8A1F', '#FFF1DC'];
  for (const col of legacyColors) {
    assert.ok(!css.includes(col), `bundle.css must NOT contain legacy color "${col}"`);
  }
});
