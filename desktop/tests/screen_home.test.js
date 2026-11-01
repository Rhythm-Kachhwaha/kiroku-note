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
  assert.ok(css.includes('.character-tile'), 'bundle.css must style .character-tile');
  assert.ok(css.includes('.character-lineup'), 'bundle.css must style .character-lineup');

  // No legacy chocolate/orange hex codes
  const legacyColors = ['#26170D', '#FF8A1F', '#FFF1DC'];
  for (const col of legacyColors) {
    assert.ok(!css.includes(col), `bundle.css must NOT contain legacy color "${col}"`);
  }
});


test('Home Screen Lineup: Six character tiles render with expected tab ids, labels, and roles', async () => {
  const { HomeView } = await import('../src/ui/views/home.js');
  const { CHARACTER_LINEUP } = await import('../src/ui/rive_character.js');

  assert.equal(CHARACTER_LINEUP.length, 6, 'Lineup must define exactly 6 character modes');

  const expectedModes = [
    { tabId: 'vocab', name: 'Vocab', file: '24603-46108-character-series-of-01.riv' },
    { tabId: 'kanji', name: 'Kanji', file: '24617-46109-character-series-of-02.riv' },
    { tabId: 'grammar', name: 'Grammar', file: '24622-46110-character-series-of-02.riv' },
    { tabId: 'study', name: 'Practice', file: '24718-46207-cat-robot-character-07.riv' },
    { tabId: 'test', name: 'Exam', file: '24719-46209-cat-robot-character-08.riv' },
    { tabId: 'settings', name: 'Settings', file: '24739-46235-cat-robot-character-09.riv' }
  ];

  for (let i = 0; i < expectedModes.length; i++) {
    const exp = expectedModes[i];
    const actual = CHARACTER_LINEUP[i];
    assert.equal(actual.tabId, exp.tabId, `Tile ${i} tabId must match ${exp.tabId}`);
    assert.equal(actual.name, exp.name, `Tile ${i} name must match ${exp.name}`);
    assert.equal(actual.file, exp.file, `Tile ${i} file must match ${exp.file}`);
  }

  const container = { innerHTML: '', querySelectorAll: () => [] };
  const routerMock = { navigateToTab: () => {} };
  const homeView = new HomeView(routerMock);
  await homeView.mount(container);

  assert.ok(container.innerHTML.includes('class="character-lineup"'), 'Home mounts .character-lineup');
  for (const exp of expectedModes) {
    assert.ok(container.innerHTML.includes(`data-tab="${exp.tabId}"`), `Home DOM contains data-tab="${exp.tabId}"`);
    assert.ok(container.innerHTML.includes(exp.name), `Home DOM contains name ${exp.name}`);
  }
});

test('Home Screen Lineup: Click or Enter navigation invokes navigateToTab with correct tabId', async () => {
  const { HomeView } = await import('../src/ui/views/home.js');
  const navigatedTabs = [];
  const routerMock = {
    navigateToTab: (tabId) => {
      navigatedTabs.push(tabId);
    }
  };

  const homeView = new HomeView(routerMock);
  const mockTile = {
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 80, height: 300 }),
    classList: { add: () => {}, remove: () => {} }
  };

  const config = { tabId: 'study', name: 'Practice' };
  homeView.runCircularReveal(mockTile, config.tabId);

  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.ok(navigatedTabs.includes('study'), 'Activating tile must navigate to study tab');
  homeView.unmount();
});

test('Home Screen Lineup: Cleanup is called on unmount for all character instances without leaks', async () => {
  const { HomeView } = await import('../src/ui/views/home.js');
  const homeView = new HomeView({ navigateToTab: () => {} });

  let cleanedUpCount = 0;
  homeView.characterControllers = [
    { cleanup: () => { cleanedUpCount++; } },
    { cleanup: () => { cleanedUpCount++; } },
    { cleanup: () => { cleanedUpCount++; } },
    { cleanup: () => { cleanedUpCount++; } },
    { cleanup: () => { cleanedUpCount++; } },
    { cleanup: () => { cleanedUpCount++; } }
  ];
  homeView.jumpTimeout = setTimeout(() => {}, 5000);

  homeView.unmount();

  assert.equal(cleanedUpCount, 6, 'unmount() must invoke cleanup on all 6 character controllers');
  assert.equal(homeView.jumpTimeout, null, 'unmount() must clear and nullify jumpTimeout');
  assert.equal(homeView.characterControllers.length, 0, 'characterControllers must be reset to empty array');
});

test('Home Screen Lineup: Failed Rive load gracefully degrades to fallback without throwing', async () => {
  const { mountCharacter } = await import('../src/ui/rive_character.js');

  let errorHandled = false;
  const result = await mountCharacter(null, 'non-existent.riv', {
    onError: () => { errorHandled = true; }
  });

  assert.equal(result.instance, null, 'Result instance is null on fallback');
  assert.doesNotThrow(() => {
    result.cleanup();
    result.pause();
    result.resume();
    result.playReaction();
  }, 'Controller fallback methods must be safe no-ops');
});

test('Home Screen Lineup: Hover intent plays only one character at a time and handles transitions smoothly without sticking', async () => {
  const { HomeView } = await import('../src/ui/views/home.js');
  const homeView = new HomeView({ navigateToTab: () => {} });

  const states = [false, false, false, false, false, false];
  homeView.characterControllers = states.map((_, i) => ({
    get isPlaying() { return states[i]; },
    resume: () => { states[i] = true; },
    pause: () => { states[i] = false; },
    cleanup: () => {}
  }));

  const mockTiles = states.map(() => ({
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    }
  }));
  const mockLineup = {
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    }
  };
  homeView.container = {
    querySelectorAll: (sel) => sel === '.character-tile' ? mockTiles : [],
    querySelector: (sel) => sel === '.character-lineup' ? mockLineup : null
  };

  // Hover tile 0
  homeView.applyTileHover(0);
  assert.equal(homeView.activePlayingIndex, 0, 'activePlayingIndex must be 0');
  assert.equal(states[0], true, 'Character 0 must be playing');
  assert.equal(mockTiles[0].classList.contains('is-hovered'), true, 'Tile 0 must have is-hovered');
  assert.equal(mockLineup.classList.contains('has-active-hover'), true, 'Lineup must have has-active-hover');

  // Switch hover to tile 2
  homeView.applyTileHover(2);
  assert.equal(homeView.activePlayingIndex, 2, 'activePlayingIndex must be 2');
  assert.equal(states[0], false, 'Character 0 must be paused');
  assert.equal(states[2], true, 'Character 2 must be playing');
  assert.equal(mockTiles[0].classList.contains('is-hovered'), false, 'Tile 0 must not have is-hovered');
  assert.equal(mockTiles[2].classList.contains('is-hovered'), true, 'Tile 2 must have is-hovered');

  // Exactly one character is playing
  const playingCount = states.filter(Boolean).length;
  assert.equal(playingCount, 1, 'Exactly one character must be playing at any time');

  // Leave tile 2
  homeView.applyTileLeave(2, false);
  assert.equal(homeView.activePlayingIndex, -1, 'activePlayingIndex must reset to -1');
  assert.equal(states[2], false, 'Character 2 must be paused');
  assert.equal(mockTiles[2].classList.contains('is-hovered'), false, 'Tile 2 must not have is-hovered');
  assert.equal(mockLineup.classList.contains('has-active-hover'), false, 'Lineup must remove has-active-hover');

  homeView.unmount();
});
