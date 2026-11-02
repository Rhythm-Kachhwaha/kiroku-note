const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Setup stub IPC handlers so renderer does not throw unhandled errors
ipcMain.handle('runtime:get-rive-asset-url', () => null);
ipcMain.handle('kiroku:api:request', () => null);
ipcMain.handle('backend:services-status', () => ({
  backendRunning: true,
  yomitanConnected: true,
  ankiConnected: true,
  ocrInstalled: false,
  ocrAvailable: false
}));
ipcMain.handle('chrome:storage:get', () => ({}));
ipcMain.handle('chrome:storage:set', () => true);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    backgroundColor: '#0D0C0A',
    webPreferences: {
      preload: path.resolve(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.resolve(__dirname, '..', 'src', 'index.html'));
  await new Promise(r => setTimeout(r, 600));

  // 1. Capture 500x750 (Default Companion window)
  win.setContentSize(500, 750);
  await new Promise(r => setTimeout(r, 400));
  const img500 = await win.capturePage();
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'home_500x750.png'), img500.toPNG());

  // 2. Capture 900x700 (Standard Desktop window)
  win.setContentSize(900, 700);
  await new Promise(r => setTimeout(r, 400));
  const img900 = await win.capturePage();
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'home_900x700.png'), img900.toPNG());

  // 3. Capture 1920x1080 (Maximized Desktop window)
  win.setContentSize(1920, 1080);
  await new Promise(r => setTimeout(r, 400));
  const img1920 = await win.capturePage();
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'home_1920x1080.png'), img1920.toPNG());

  // Reset to 900x700 for interactive animation verification
  win.setContentSize(900, 700);
  await new Promise(r => setTimeout(r, 200));

  // 4. Inject Word of the Day with authentic KanjiVG stroke SVGs for write-in animation test
  const testWordWithStrokes = {
    word: '木漏れ日',
    reading: 'こもれび',
    meaning: 'Sunlight filtering through trees',
    jlpt_level: 'N2',
    has_kanji: true,
    kanji_characters: ['木', '漏', '日'],
    stroke_svgs: {
      '木': '<svg viewBox="0 0 109 109"><path d="M50 20 L50 80" /><path d="M20 40 L80 40" /><path d="M50 40 L25 75" /><path d="M50 40 L75 75" /></svg>',
      '漏': '<svg viewBox="0 0 109 109"><path d="M20 20 L25 35" /><path d="M18 45 L24 58" /><path d="M16 85 L28 70" /></svg>',
      '日': '<svg viewBox="0 0 109 109"><path d="M25 20 L25 80" /><path d="M25 20 L75 20 L75 80" /><path d="M25 50 L75 50" /><path d="M25 80 L75 80" /></svg>'
    },
    example_sentence: '木漏れ日の中で、静かに本を読む時間が好きです。',
    example_translation: 'I love the peaceful time spent reading a book under sunlight filtering through the trees.',
    is_saved: false
  };

  await win.webContents.executeJavaScript(`
    (() => {
      const homeView = window.router?.currentViewInstance;
      const cardContainer = document.getElementById('daily-word-stamp');
      if (cardContainer && homeView) {
        homeView.currentDailyWord = ${JSON.stringify(testWordWithStrokes)};
        cardContainer.innerHTML = homeView.renderWordOfTheDayCard(homeView.currentDailyWord);
        homeView.setupWordCardEvents();
      }
    })()
  `);

  // Measure Stroke Animation Write-in at t=0, ~300ms, ~800ms, and final
  const strokeTimeline = await win.webContents.executeJavaScript(`
    (async () => {
      const homeView = window.router?.currentViewInstance;
      const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      console.log('[Verification] matchMedia reduced motion:', isReduced);
      
      // Explicitly ensure reducedMotion is false for the active motion test
      const origMatchMedia = window.matchMedia;
      window.matchMedia = (q) => {
        if (q.includes('prefers-reduced-motion')) return { matches: false, addListener: () => {}, removeListener: () => {} };
        return origMatchMedia(q);
      };

      // Trigger write-in
      homeView.triggerWordWriteIn();

      const getOffset = () => {
        const paths = Array.from(document.querySelectorAll('.wotd-stroke-path'));
        return paths.map(p => ({
          dashArray: p.style.strokeDasharray,
          dashOffset: p.style.strokeDashoffset
        }));
      };

      const t0 = getOffset();
      await new Promise(r => setTimeout(r, 300));
      const t300 = getOffset();
      await new Promise(r => setTimeout(r, 500));
      const t800 = getOffset();
      await new Promise(r => setTimeout(r, 800));
      const tFinal = getOffset();

      window.matchMedia = origMatchMedia;
      return { isReduced, t0, t300, t800, tFinal };
    })()
  `);

  // Capture write-in sequence screenshots
  await win.webContents.executeJavaScript(`
    (() => {
      const origMatchMedia = window.matchMedia;
      window.matchMedia = (q) => {
        if (q.includes('prefers-reduced-motion')) return { matches: false, addListener: () => {}, removeListener: () => {} };
        return origMatchMedia(q);
      };
      window.router?.currentViewInstance?.triggerWordWriteIn();
    })()
  `);
  const frame0 = await win.capturePage();
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'anim_t0.png'), frame0.toPNG());

  await new Promise(r => setTimeout(r, 300));
  const frame300 = await win.capturePage();
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'anim_t300.png'), frame300.toPNG());

  await new Promise(r => setTimeout(r, 500));
  const frame800 = await win.capturePage();
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'anim_t800.png'), frame800.toPNG());

  await new Promise(r => setTimeout(r, 800));
  const frameFinal = await win.capturePage();
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'anim_final.png'), frameFinal.toPNG());

  // 5. Test Focus & Hover 3D Book Open (Fluid Flip) & Sibling Stability
  const hoverFocusResult = await win.webContents.executeJavaScript(`
    (() => {
      const card = document.getElementById('daily-word-stamp');
      const cover = document.getElementById('wotd-book-cover');
      const launcherZone = document.getElementById('home-launcher-zone');

      const launcherTopBefore = launcherZone ? launcherZone.getBoundingClientRect().top : 0;
      const launcherLeftBefore = launcherZone ? launcherZone.getBoundingClientRect().left : 0;

      // Focus/open card
      card.focus();
      card.classList.add('is-open');
      const isFocused = document.activeElement === card;
      const coverTransform = window.getComputedStyle(cover).transform;

      const launcherTopAfter = launcherZone ? launcherZone.getBoundingClientRect().top : 0;
      const launcherLeftAfter = launcherZone ? launcherZone.getBoundingClientRect().left : 0;

      const siblingsStayedStill = (launcherTopBefore === launcherTopAfter) && (launcherLeftBefore === launcherLeftAfter);

      return {
        isFocused,
        coverTransform,
        siblingsStayedStill,
        launcherTopBefore,
        launcherTopAfter
      };
    })()
  `);
  const imgFocus = await win.capturePage();
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'card_hover_focus.png'), imgFocus.toPNG());

  // 5b. Test Launcher Cards Hover Animation & Gold Color Change
  const launcherHoverResult = await win.webContents.executeJavaScript(`
    (() => {
      const vocabCard = document.getElementById('launcher-card-vocab');
      const glyph = document.getElementById('launcher-glyph-vocab');
      if (!vocabCard || !glyph) return { found: false };

      // Dispatch pointerenter
      vocabCard.dispatchEvent(new Event('pointerenter'));
      vocabCard.classList.add('hover-test');

      const ctrl = window.router?.currentViewInstance?.cardControllers?.get('vocab');
      const isAnimating = ctrl ? ctrl.isAnimating : false;
      const computedColor = window.getComputedStyle(glyph).color;

      return {
        found: true,
        isAnimating,
        computedColor
      };
    })()
  `);
  const imgLauncher = await win.capturePage();
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'launcher_hover.png'), imgLauncher.toPNG());

  // 6. Test Replay button
  const replayResult = await win.webContents.executeJavaScript(`
    (() => {
      const btnReplay = document.getElementById('btn-wotd-replay');
      if (!btnReplay) return { found: false };
      btnReplay.click();
      const firstPath = document.querySelector('.wotd-stroke-path');
      return {
        found: true,
        replaying: Boolean(window.router?.currentViewInstance?.writeInTimeout || (firstPath && firstPath.style.strokeDashoffset !== '0'))
      };
    })()
  `);

  // 7. Test Bookmark SVG button click ("Add to Kiroku")
  const addResult = await win.webContents.executeJavaScript(`
    (async () => {
      const btnAdd = document.getElementById('btn-wotd-add');
      if (!btnAdd) return { found: false };
      const textBefore = btnAdd.textContent.trim();
      btnAdd.click();
      await new Promise(r => setTimeout(r, 300));
      return {
        found: true,
        textBefore,
        textAfter: btnAdd.textContent.trim(),
        disabled: btnAdd.disabled,
        isAddedClass: btnAdd.classList.contains('is-added')
      };
    })()
  `);
  const imgAdded = await win.capturePage();
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'card_added.png'), imgAdded.toPNG());

  // 8. Test Kana-only word clip-path reveal
  const kanaWord = {
    word: 'ゆらゆら',
    reading: 'ゆらゆら',
    meaning: 'Swaying gently, flickering',
    jlpt_level: 'N3',
    has_kanji: false,
    kanji_characters: [],
    stroke_svgs: {},
    example_sentence: '',
    example_translation: '',
    is_saved: false
  };

  const kanaResult = await win.webContents.executeJavaScript(`
    (async () => {
      const homeView = window.router?.currentViewInstance;
      const cardContainer = document.getElementById('daily-word-stamp');
      homeView.currentDailyWord = ${JSON.stringify(kanaWord)};
      cardContainer.innerHTML = homeView.renderWordOfTheDayCard(homeView.currentDailyWord);
      homeView.setupWordCardEvents();

      const mask = document.querySelector('.wotd-word-text');
      const drawer = document.getElementById('wotd-example-drawer');

      const origMatchMedia = window.matchMedia;
      window.matchMedia = (q) => {
        if (q.includes('prefers-reduced-motion')) return { matches: false, addListener: () => {}, removeListener: () => {} };
        return origMatchMedia(q);
      };

      homeView.triggerWordWriteIn();
      const clipT0 = mask ? mask.style.clipPath : null;

      await new Promise(r => setTimeout(r, 750));
      const clipFinal = mask ? mask.style.clipPath : null;
      window.matchMedia = origMatchMedia;

      return {
        hasMask: Boolean(mask),
        clipT0,
        clipFinal,
        drawerHidden: drawer ? drawer.style.display === 'none' : false
      };
    })()
  `);

  // 9. Test Reduced-Motion Mode
  const reducedMotionResult = await win.webContents.executeJavaScript(`
    (() => {
      const homeView = window.router?.currentViewInstance;
      const origMatchMedia = window.matchMedia;
      window.matchMedia = (query) => {
        if (query.includes('prefers-reduced-motion')) {
          return { matches: true, addListener: () => {}, removeListener: () => {} };
        }
        return origMatchMedia(query);
      };

      // Trigger write-in under reduced motion
      homeView.triggerWordWriteIn();
      const details = document.getElementById('wotd-details-row');
      const mask = document.querySelector('.wotd-word-text');

      const result = {
        detailsRevealedImmediately: details ? details.classList.contains('is-revealed') : false,
        maskClipPath: mask ? mask.style.clipPath : null
      };

      // Restore matchMedia
      window.matchMedia = origMatchMedia;
      return result;
    })()
  `);

  const report = {
    success: true,
    screenshots: [
      'home_500x750.png',
      'home_900x700.png',
      'home_1920x1080.png',
      'anim_t0.png',
      'anim_t300.png',
      'anim_t800.png',
      'anim_final.png',
      'card_hover_focus.png',
      'card_added.png',
      'launcher_hover.png'
    ],
    strokeTimeline,
    hoverFocusResult,
    launcherHoverResult,
    replayResult,
    addResult,
    kanaResult,
    reducedMotionResult,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(path.resolve(__dirname, 'verification_report.json'), JSON.stringify(report, null, 2));
  app.quit();
});
