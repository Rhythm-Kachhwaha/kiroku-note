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

    content.includes('Cat typing.svg') || content.includes('mascot'),

    'Home screen must reference the companion mascot asset'

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

    (content.includes('pointermove') || content.includes('mousemove')),

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

    'benchmark-card',

    'character-tile',

    'character-lineup'

  ];

  for (const sel of forbiddenSelectors) {

    assert.ok(!css.includes(sel), `bundle.css must NOT contain forbidden selector: "${sel}"`);

  }



  assert.ok(css.includes('.organic-shape-backing'), 'bundle.css must style .organic-shape-backing');

  assert.ok(css.includes('.home-daily-word') || css.includes('.daily-vocab-stamp'), 'bundle.css must style daily word stamp');

  assert.ok(css.includes('.home-launcher-card'), 'bundle.css must style .home-launcher-card');

  assert.ok(css.includes('.home-launcher-grid'), 'bundle.css must style .home-launcher-grid');

  assert.ok(css.includes('.speech-header-row') && css.includes('flex-wrap: wrap'), 'Speech heading must wrap inside the bubble');

  assert.ok(css.includes('.speech-greeting-ja') && css.includes('overflow-wrap: anywhere'), 'Speech heading must contain long text');

  assert.ok(css.includes('.comic-speech-inner') && css.includes('min-inline-size: 0'), 'Speech bubble content must be allowed to shrink');



  // No legacy chocolate/orange hex codes

  const legacyColors = ['#26170D', '#FF8A1F', '#FFF1DC'];

  for (const col of legacyColors) {

    assert.ok(!css.includes(col), `bundle.css must NOT contain legacy color "${col}"`);

  }

});



test('Home Screen Launchers: Two launcher cards render with tab ids vocab and kanji, labels, and roles', async () => {

  const { HomeView, LAUNCHER_CARDS } = await import('../src/ui/views/home.js');



  assert.equal(LAUNCHER_CARDS.length, 2, 'Launcher config must define exactly 2 cards (Vocab and Kanji)');



  const expectedCards = [

    { id: 'vocab', tab: 'vocab', title: 'Vocab', descriptor: 'Quick Add, mining, Anki' },

    { id: 'kanji', tab: 'kanji', title: 'Kanji', descriptor: 'Strokes and components' }

  ];



  for (let i = 0; i < expectedCards.length; i++) {

    const exp = expectedCards[i];

    const actual = LAUNCHER_CARDS[i];

    assert.equal(actual.id, exp.id, `Card ${i} id must match ${exp.id}`);

    assert.equal(actual.tab, exp.tab, `Card ${i} tab must match ${exp.tab}`);

    assert.equal(actual.title, exp.title, `Card ${i} title must match ${exp.title}`);

    assert.equal(actual.descriptor, exp.descriptor, `Card ${i} descriptor must match ${exp.descriptor}`);

    assert.ok(actual.glyphSvg, `Card ${i} must supply inlined glyphSvg`);

  }



  const container = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };

  const routerMock = { navigateToTab: () => {} };

  const homeView = new HomeView(routerMock);

  await homeView.mount(container);



  assert.ok(container.innerHTML.includes('class="home-launcher-grid"'), 'Home mounts .home-launcher-grid');

  for (const exp of expectedCards) {

    assert.ok(container.innerHTML.includes(`data-tab="${exp.tab}"`), `Home DOM contains data-tab="${exp.tab}"`);

    assert.ok(container.innerHTML.includes(exp.title), `Home DOM contains title ${exp.title}`);

    assert.ok(container.innerHTML.includes(exp.descriptor), `Home DOM contains descriptor ${exp.descriptor}`);

    assert.ok(container.innerHTML.includes('role="button"'), 'Card must have role="button"');

    assert.ok(container.innerHTML.includes('tabindex="0"'), 'Card must have tabindex="0"');

    assert.ok(container.innerHTML.includes(`aria-label="${exp.title}: ${exp.descriptor}"`), `Card must have aria-label`);

  }

});



test('Home Screen Launchers: Click and Enter invoke navigateToTab with correct tabId', async () => {

  const { setupFakeDOM } = require('./helpers/dom.js');

  const fakeDom = setupFakeDOM();

  try {

  const { HomeView } = await import('../src/ui/views/home.js');

  const navigatedTabs = [];

  const routerMock = {

    navigateToTab: (tabId) => {

      navigatedTabs.push(tabId);

    }

  };



  const listeners = new Map();

  const mockCardVocab = {

    addEventListener: (event, fn) => {

      if (!listeners.has('vocab:' + event)) listeners.set('vocab:' + event, []);

      listeners.get('vocab:' + event).push(fn);

    },

    querySelector: () => ({

      pauseAnimations: () => {},

      setCurrentTime: () => {},

      getCurrentTime: () => 0

    }),

    classList: { add: () => {}, remove: () => {} }

  };

  const mockCardKanji = {

    addEventListener: (event, fn) => {

      if (!listeners.has('kanji:' + event)) listeners.set('kanji:' + event, []);

      listeners.get('kanji:' + event).push(fn);

    },

    querySelector: () => ({

      pauseAnimations: () => {},

      setCurrentTime: () => {},

      getCurrentTime: () => 0

    }),

    classList: { add: () => {}, remove: () => {} }

  };



  const container = {

    innerHTML: '',

    querySelector: (sel) => {

      if (sel === '#launcher-card-vocab') return mockCardVocab;

      if (sel === '#launcher-card-kanji') return mockCardKanji;

      return null;

    },

    querySelectorAll: () => []

  };



  const homeView = new HomeView(routerMock);

  await homeView.mount(container);



  // Trigger click on Vocab

  const vocabClickFns = listeners.get('vocab:click') || [];

  vocabClickFns.forEach(fn => fn({ preventDefault: () => {}, stopPropagation: () => {} }));

  assert.ok(navigatedTabs.includes('vocab'), 'Clicking Vocab card must navigate to vocab');



  // Trigger Enter keydown on Kanji

  const kanjiKeyFns = listeners.get('kanji:keydown') || [];

  kanjiKeyFns.forEach(fn => fn({ key: 'Enter', preventDefault: () => {}, stopPropagation: () => {} }));

  assert.ok(navigatedTabs.includes('kanji'), 'Pressing Enter on Kanji card must navigate to kanji');



  homeView.unmount();

  } finally {

    fakeDom.restore();

  }

});



test('Home Screen Stroke Glyphs: Inlined SVGs contain currentColor and neither #333c45 nor #000000', async () => {

  const { HIRAGANA_A_SVG, KANJI_DAI_SVG, HOME_GLYPHS } = await import('../src/ui/assets/home_glyphs.js');



  assert.ok(HIRAGANA_A_SVG.includes('currentColor'), 'Hiragana SVG must use currentColor');

  assert.ok(KANJI_DAI_SVG.includes('currentColor'), 'Kanji SVG must use currentColor');



  assert.ok(!HIRAGANA_A_SVG.toLowerCase().includes('#333c45'), 'Hiragana SVG must not contain #333c45');

  assert.ok(!HIRAGANA_A_SVG.toLowerCase().includes('#000000'), 'Hiragana SVG must not contain #000000');

  assert.ok(!KANJI_DAI_SVG.toLowerCase().includes('#333c45'), 'Kanji SVG must not contain #333c45');

  assert.ok(!KANJI_DAI_SVG.toLowerCase().includes('#000000'), 'Kanji SVG must not contain #000000');



  assert.equal(HOME_GLYPHS.vocab, HIRAGANA_A_SVG, 'HOME_GLYPHS.vocab matches HIRAGANA_A_SVG');

  assert.equal(HOME_GLYPHS.kanji, KANJI_DAI_SVG, 'HOME_GLYPHS.kanji matches KANJI_DAI_SVG');

});



test('Home Screen Stroke Glyphs: IDs and references are unique across both SVGs after inlining', async () => {

  const { HIRAGANA_A_SVG, KANJI_DAI_SVG } = await import('../src/ui/assets/home_glyphs.js');



  const hiraIds = Array.from(HIRAGANA_A_SVG.matchAll(/id="([^"]+)"/g)).map(m => m[1]);

  const kanjiIds = Array.from(KANJI_DAI_SVG.matchAll(/id="([^"]+)"/g)).map(m => m[1]);



  assert.ok(hiraIds.length > 0, 'Hiragana must have elements with IDs');

  assert.ok(kanjiIds.length > 0, 'Kanji must have elements with IDs');



  const allIds = [...hiraIds, ...kanjiIds];

  const uniqueIds = new Set(allIds);



  assert.equal(

    allIds.length,

    uniqueIds.size,

    `All IDs across both inlined SVGs must be strictly unique! Duplicates: ${allIds.filter((item, index) => allIds.indexOf(item) !== index)}`

  );



  // Every url(#...) reference in Kanji must resolve to an existing ID

  const kanjiUrls = Array.from(KANJI_DAI_SVG.matchAll(/url\(#([^)]+)\)/g)).map(m => m[1]);

  assert.ok(kanjiUrls.length > 0, 'Kanji SVG uses clip-path url references');

  for (const ref of kanjiUrls) {

    assert.ok(kanjiIds.includes(ref), `Kanji clipPath reference url(#${ref}) must exist in Kanji IDs`);

  }

});



test('Home Screen: Home loads no character .riv file and no character tiles', () => {

  const content = fs.readFileSync(homeJsPath, 'utf8');



  // Verify removed elements & lineup references

  assert.ok(!content.includes('character-tile'), 'home.js must NOT contain .character-tile');

  assert.ok(!content.includes('character-lineup'), 'home.js must NOT contain .character-lineup');

  assert.ok(!content.includes('CHARACTER_LINEUP'), 'home.js must NOT import or use CHARACTER_LINEUP');

  assert.ok(!content.includes('runCircularReveal'), 'home.js must NOT contain runCircularReveal');

  assert.ok(!content.includes('mountCharacter'), 'home.js must NOT call mountCharacter');



  // Forbidden character .riv files

  const forbiddenRivFiles = [

    '24603-46108-character-series-of-01.riv',

    '24617-46109-character-series-of-02.riv',

    '24622-46110-character-series-of-02.riv',

    '24718-46207-cat-robot-character-07.riv',

    '24719-46209-cat-robot-character-08.riv',

    '24739-46235-cat-robot-character-09.riv'

  ];



  for (const riv of forbiddenRivFiles) {

    assert.ok(!content.includes(riv), `home.js must NOT load character .riv file: "${riv}"`);

  }

});



test('Home Screen Lifecycle: Unmount leaves no listeners or timers', async () => {

  const { setupFakeDOM } = require('./helpers/dom.js');

  const fakeDom = setupFakeDOM();

  try {

  const { HomeView } = await import('../src/ui/views/home.js');

  const homeView = new HomeView({ navigateToTab: () => {} });



  homeView.jumpTimeout = setTimeout(() => {}, 5000);

  homeView.bubbleFallbackTimer = setTimeout(() => {}, 5000);

  homeView.mouseMoveHandler = () => {};

  homeView.mouseLeaveHandler = () => {};

  homeView.visibilityHandler = () => {};

  homeView.escapeHandler = () => {};



  let cleanedUpMascot = false;

  homeView.riveMascot = { cleanup: () => { cleanedUpMascot = true; } };



  let cardTimerCleared = false;

  homeView.cardControllers.set('vocab', {

    resetToRest: () => { cardTimerCleared = true; }

  });



  homeView.unmount();



  assert.equal(homeView.jumpTimeout, null, 'unmount() must clear jumpTimeout');

  assert.equal(homeView.bubbleFallbackTimer, null, 'unmount() must clear bubbleFallbackTimer');

  assert.equal(homeView.mouseMoveHandler, null, 'unmount() must remove mouseMoveHandler');

  assert.equal(homeView.mouseLeaveHandler, null, 'unmount() must reset mouseLeaveHandler');

  assert.equal(homeView.visibilityHandler, null, 'unmount() must remove visibilityHandler');

  assert.equal(homeView.escapeHandler, null, 'unmount() must remove escapeHandler');

  assert.equal(homeView.riveMascot, null, 'unmount() must nullify riveMascot');

  assert.equal(homeView.riveMascot, null, 'unmount() must nullify riveMascot');

  assert.equal(cardTimerCleared, true, 'unmount() must reset card controllers');

  assert.equal(homeView.cardControllers.size, 0, 'unmount() must clear cardControllers map');

  } finally {

    fakeDom.restore();

  }

});



test('Mascot Companion: Runtime and riv prefetch are started once and shared', async () => {

  const { prefetchRiveAssets } = await import('../src/ui/rive_mascot.js');



  const firstCall = prefetchRiveAssets();

  const secondCall = prefetchRiveAssets();



  assert.equal(

    firstCall.wasmInitPromise,

    secondCall.wasmInitPromise,

    'wasmInitPromise must be cached and identical across calls'

  );

  assert.equal(

    firstCall.rivBufferPromise,

    secondCall.rivBufferPromise,

    'rivBufferPromise must be cached and identical across calls'

  );

});



test('Mascot Companion: Cat canvas stays hidden until onLoad and load failure shows static fallback', async () => {

  const content = fs.readFileSync(homeJsPath, 'utf8');

  assert.ok(

    content.includes('showFallbackCat') && content.includes('Cat typing.svg'),

    'Home screen must show static fallback mascot on load failure'

  );

  assert.ok(

    content.includes('mascot-fallback-svg'),

    'Home screen fallback image must carry mascot-fallback-svg class'

  );

});

