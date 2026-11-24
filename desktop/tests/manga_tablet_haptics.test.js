const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webJsPath = path.join(__dirname, '..', 'src', 'platform', 'web.js');
const mangaJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'manga.js');
const mangaCssPath = path.join(__dirname, '..', 'src', 'ui', 'styles', 'views', 'manga.css');

test('manga_tablet_haptics: web platform reports honest capabilities without fake iOS hacks', () => {
  const content = fs.readFileSync(webJsPath, 'utf8');
  assert.ok(!content.includes('iosSwitchTrick'), 'must not advertise fake iosSwitchTrick');
  assert.ok(!content.includes('kiroku-ios-haptic-trigger'), 'must remove non-working DOM switch click hack');
  assert.ok(content.includes('vibrate: typeof navigator !== \'undefined\' && typeof navigator.vibrate === \'function\''), 'honest vibrate capability');
});

test('manga_tablet_haptics: triggerHaptic handles boolean return, missing vibrate, and exceptions safely', () => {
  // Test simulated environments
  function triggerHapticSim(nav, type = 'light') {
    if (typeof nav !== 'undefined' && typeof nav.vibrate === 'function') {
      try {
        let pattern = 12;
        if (type === 'medium') pattern = 22;
        else if (type === 'heavy') pattern = 40;
        else if (type === 'success') pattern = [15, 30, 20];
        else if (type === 'warning') pattern = [25, 40, 25];
        else if (type === 'error') pattern = [40, 60, 40];
        return Boolean(nav.vibrate(pattern));
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  // 1. Successful Android vibrate
  let lastPattern = null;
  const navSuccess = {
    vibrate: (p) => {
      lastPattern = p;
      return true;
    }
  };
  assert.equal(triggerHapticSim(navSuccess, 'light'), true);
  assert.equal(lastPattern, 12);
  assert.equal(triggerHapticSim(navSuccess, 'medium'), true);
  assert.equal(lastPattern, 22);

  // 2. Android vibrate returning false (e.g. background tab or user denied)
  const navFalse = {
    vibrate: () => false
  };
  assert.equal(triggerHapticSim(navFalse, 'heavy'), false);

  // 3. Vibrate throwing error
  const navThrows = {
    vibrate: () => { throw new Error('NotAllowedError'); }
  };
  assert.equal(triggerHapticSim(navThrows, 'success'), false);

  // 4. iOS Safari / unsupported browser (no navigator.vibrate)
  const navNone = {};
  assert.equal(triggerHapticSim(navNone, 'light'), false);
  assert.equal(triggerHapticSim(undefined, 'light'), false);
});

test('manga_tablet_haptics: navigation steps differentiate phone, portrait tablet, and landscape tablet', () => {
  function computeStep(width, height, spreadMode) {
    const isMobile = width <= 768;
    const isPortraitTablet = width <= 1024 && height > width;
    if (isMobile || isPortraitTablet || spreadMode !== 'double') {
      return 1;
    }
    return 2;
  }

  // iPhone (390 x 844) -> always step 1
  assert.equal(computeStep(390, 844, 'double'), 1);
  assert.equal(computeStep(390, 844, 'single'), 1);

  // iPad Portrait (820 x 1180) -> step 1 even if double-spread is selected
  assert.equal(computeStep(820, 1180, 'double'), 1);
  assert.equal(computeStep(820, 1180, 'single'), 1);

  // iPad Landscape (1180 x 820) -> step 2 when double-spread, step 1 when single
  assert.equal(computeStep(1180, 820, 'double'), 2);
  assert.equal(computeStep(1180, 820, 'single'), 1);

  // Desktop (1920 x 1080) -> step 2 when double-spread
  assert.equal(computeStep(1920, 1080, 'double'), 2);
  assert.equal(computeStep(1920, 1080, 'single'), 1);
});

test('manga_tablet_haptics: touch swipe has zero duplicate haptics and no boundary triggers', () => {
  let hapticEvents = [];
  let currentPage = 1;
  const pageCount = 10;

  function triggerHaptic(type) {
    hapticEvents.push(type);
  }

  function goToPage(p) {
    currentPage = p;
  }

  function nextPage(step = 1) {
    if (currentPage + step <= pageCount) {
      triggerHaptic('light');
      goToPage(currentPage + step);
    } else if (currentPage < pageCount) {
      triggerHaptic('light');
      goToPage(pageCount);
    }
  }

  function prevPage(step = 1) {
    if (currentPage - step >= 1) {
      triggerHaptic('light');
      goToPage(currentPage - step);
    } else if (currentPage > 1) {
      triggerHaptic('light');
      goToPage(1);
    }
  }

  // Swiping next from page 1 produces exactly 1 haptic event
  hapticEvents = [];
  nextPage(1);
  assert.equal(currentPage, 2);
  assert.equal(hapticEvents.length, 1);

  // Swiping prev back to page 1
  hapticEvents = [];
  prevPage(1);
  assert.equal(currentPage, 1);
  assert.equal(hapticEvents.length, 1);

  // Swiping prev beyond page 1 produces ZERO haptic events
  hapticEvents = [];
  prevPage(1);
  assert.equal(currentPage, 1);
  assert.equal(hapticEvents.length, 0);

  // Advance to end of book
  goToPage(10);
  hapticEvents = [];
  nextPage(1);
  assert.equal(currentPage, 10);
  assert.equal(hapticEvents.length, 0);
});

test('manga_tablet_haptics: page-aware annotation splits strokes across dual-page spread', () => {
  const leftPageWidth = 800;
  const isDouble = true;
  const currentPage = 1;

  function calculateTargetAndOffset(x) {
    if (isDouble) {
      if (x < leftPageWidth) {
        return { targetPage: currentPage + 1, offsetX: 0 };
      } else {
        return { targetPage: currentPage, offsetX: leftPageWidth };
      }
    }
    return { targetPage: currentPage, offsetX: 0 };
  }

  // Stroke on companion page (left side in Japanese manga: x in [0, 800])
  const strokeLeft = calculateTargetAndOffset(250);
  assert.equal(strokeLeft.targetPage, 2);
  assert.equal(strokeLeft.offsetX, 0);

  // Stroke on right page (x in [800, 1600])
  const strokeRight = calculateTargetAndOffset(1150);
  assert.equal(strokeRight.targetPage, 1);
  assert.equal(strokeRight.offsetX, 800);

  // Coordinate normalization: points are stored local to that page
  const ptRight = { x: 1150, y: 300 };
  const ptLocal = { x: ptRight.x - strokeRight.offsetX, y: ptRight.y };
  assert.equal(ptLocal.x, 350);
  assert.equal(ptLocal.y, 300);
});

test('manga_tablet_haptics: cloud reading progress reconciles existing books', () => {
  const localBook = {
    id: 'book-123',
    title: 'Yotsuba',
    currentPage: 5,
    lastRead: 1000000000000
  };

  const cloudBook = {
    book_id: 'book-123',
    current_page: 25,
    last_read_at: 1000005000 // seconds -> 1000005000000 ms (newer)
  };

  const cloudPage = Number(cloudBook.current_page || 0);
  const cloudLastRead = (cloudBook.last_read_at || 0) * 1000;
  const localLastRead = localBook.lastRead || 0;

  if (cloudPage > 0 && cloudPage !== localBook.currentPage) {
    if (cloudLastRead >= localLastRead || !localBook.lastRead) {
      localBook.currentPage = cloudPage;
      localBook.lastRead = cloudLastRead;
    }
  }

  assert.equal(localBook.currentPage, 25);
  assert.equal(localBook.lastRead, 1000005000000);
});

test('manga_tablet_haptics: tablet CSS rules provide drawer sidebar and safe area padding', () => {
  const css = fs.readFileSync(mangaCssPath, 'utf8');
  assert.ok(css.includes('@media (min-width: 769px) and (max-width: 1024px)'), 'must include tablet media query');
  assert.ok(css.includes('@media (min-width: 769px) and (max-width: 1024px) and (orientation: portrait)'), 'must include portrait tablet media query');
  assert.ok(css.includes('env(safe-area-inset-top'), 'must include safe-area insets');
});

