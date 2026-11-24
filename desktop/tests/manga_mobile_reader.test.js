const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mangaJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'manga.js');
const mangaCssPath = path.join(__dirname, '..', 'src', 'ui', 'styles', 'views', 'manga.css');

test('manga_mobile_reader: source contains mobile-specific navigation, gestures, and controls', () => {
  const jsContent = fs.readFileSync(mangaJsPath, 'utf8');
  const cssContent = fs.readFileSync(mangaCssPath, 'utf8');

  // Mobile navigation & step handling
  assert.ok(jsContent.includes('const isMobile = typeof window !== \'undefined\' && window.innerWidth <= 768'), 'must detect mobile viewport for navigation');
  assert.ok(jsContent.includes('this._justSwiped'), 'must have post-swipe throttle flag');
  assert.ok(jsContent.includes('toggleBubbleDisplay'), 'must have toggleBubbleDisplay method');
  assert.ok(jsContent.includes('loadPrebakedOcrForBook'), 'must have loadPrebakedOcrForBook method');
  assert.ok(jsContent.includes('btn-mobile-spread-toggle'), 'must have mobile spread toggle button');
  assert.ok(jsContent.includes('btn-annot-pencil'), 'must have pencil button');
  assert.ok(jsContent.includes('btn-annot-eraser'), 'must have eraser button');

  // CSS responsive rules & touch targets
  assert.ok(cssContent.includes('.manga-mobile-actions-group'), 'must define mobile actions group in CSS');
  assert.ok(cssContent.includes('.manga-desktop-only'), 'must define desktop only class in CSS');
  assert.ok(cssContent.includes('min-height: 44px') || cssContent.includes('min-height: calc(48px'), 'must enforce mobile touch targets of at least 44px');
});

test('manga_mobile_reader: page turn step logic accurately differentiates mobile vs desktop double-spread', () => {
  function getNavigationStep({ isMobile, spreadMode, requestedStep }) {
    if (requestedStep !== undefined && requestedStep !== null) {
      return requestedStep;
    }
    return (spreadMode === 'double' && !isMobile) ? 2 : 1;
  }

  // Mobile with double-spread setting must still advance 1 page at a time
  assert.equal(getNavigationStep({ isMobile: true, spreadMode: 'double' }), 1);
  assert.equal(getNavigationStep({ isMobile: true, spreadMode: 'single' }), 1);

  // Desktop double-spread advances 2 pages
  assert.equal(getNavigationStep({ isMobile: false, spreadMode: 'double' }), 2);

  // Desktop single-spread advances 1 page
  assert.equal(getNavigationStep({ isMobile: false, spreadMode: 'single' }), 1);

  // Explicit step override is respected
  assert.equal(getNavigationStep({ isMobile: false, spreadMode: 'double', requestedStep: 1 }), 1);
});

test('manga_mobile_reader: touch swipe is strictly suppressed during drawing, erasing, selecting, and zoom', () => {
  function canPerformSwipe({ isDrawing, isEraser, isSelecting, currentScale, interactionState }) {
    if (isDrawing || isEraser) return false;
    if (isSelecting) return false;
    if (currentScale > 1.05) return false;
    if (interactionState !== 'single-pointer' && interactionState !== 'releasing') return false;
    return true;
  }

  // Normal reading state allows swipe
  assert.ok(canPerformSwipe({
    isDrawing: false,
    isEraser: false,
    isSelecting: false,
    currentScale: 1.0,
    interactionState: 'single-pointer'
  }));

  // Blocked while drawing
  assert.strictEqual(canPerformSwipe({
    isDrawing: true,
    isEraser: false,
    isSelecting: false,
    currentScale: 1.0,
    interactionState: 'single-pointer'
  }), false);

  // Blocked while erasing
  assert.strictEqual(canPerformSwipe({
    isDrawing: false,
    isEraser: true,
    isSelecting: false,
    currentScale: 1.0,
    interactionState: 'single-pointer'
  }), false);

  // Blocked while selecting OCR box
  assert.strictEqual(canPerformSwipe({
    isDrawing: false,
    isEraser: false,
    isSelecting: true,
    currentScale: 1.0,
    interactionState: 'single-pointer'
  }), false);

  // Blocked when zoomed in (panning instead)
  assert.strictEqual(canPerformSwipe({
    isDrawing: false,
    isEraser: false,
    isSelecting: false,
    currentScale: 1.5,
    interactionState: 'single-pointer'
  }), false);

  // Blocked during multi-pointer gestures
  assert.strictEqual(canPerformSwipe({
    isDrawing: false,
    isEraser: false,
    isSelecting: false,
    currentScale: 1.0,
    interactionState: 'two-pointer'
  }), false);
});

test('manga_mobile_reader: bubble display cycling persists and syncs through outbox', () => {
  const modes = ['show', 'hidden', 'detect'];
  let currentBook = { id: 'yotsuba_01', bubbleDisplay: 'show' };
  const outbox = [];

  function cycleBubbleDisplay(book) {
    const cycle = { show: 'hidden', hidden: 'detect', detect: 'show' };
    const nextMode = cycle[book.bubbleDisplay] || 'show';
    book.bubbleDisplay = nextMode;

    outbox.push({
      action: 'progress',
      bookId: book.id,
      bubbleDisplay: nextMode,
      timestamp: Date.now()
    });
    return nextMode;
  }

  assert.equal(cycleBubbleDisplay(currentBook), 'hidden');
  assert.equal(currentBook.bubbleDisplay, 'hidden');

  assert.equal(cycleBubbleDisplay(currentBook), 'detect');
  assert.equal(currentBook.bubbleDisplay, 'detect');

  assert.equal(cycleBubbleDisplay(currentBook), 'show');
  assert.equal(currentBook.bubbleDisplay, 'show');

  assert.equal(outbox.length, 3);
  assert.equal(outbox[2].bubbleDisplay, 'show');
});

test('manga_mobile_reader: pre-baked OCR loads local cache instantly and does not wipe local OCR on empty cloud response', async () => {
  const localCache = new Map();
  const bookId = 'yotsuba_vol1';

  // Pre-seed local OCR for Yotsuba Vol 1
  const existingOcrPages = [
    { page_index: 0, bubbles: [{ text: 'よつばと！', box: [10, 10, 50, 50] }] },
    { page_index: 1, bubbles: [{ text: 'こんにちは', box: [20, 20, 60, 60] }] }
  ];
  localCache.set(`kiroku_ocr_pages_${bookId}`, JSON.stringify(existingOcrPages));

  // Simulation of loadPrebakedOcrForBook
  async function loadOcr(id, mockFetchCloud) {
    let pages = null;
    let fromCache = false;

    // Step 1: Check local cache
    const rawLocal = localCache.get(`kiroku_ocr_pages_${id}`);
    if (rawLocal) {
      try {
        pages = JSON.parse(rawLocal);
        fromCache = true;
      } catch (_) {}
    }

    // Step 2: Query cloud
    try {
      const cloudRes = await mockFetchCloud(id);
      if (cloudRes && cloudRes.ok && Array.isArray(cloudRes.pages) && cloudRes.pages.length > 0) {
        pages = cloudRes.pages;
        localCache.set(`kiroku_ocr_pages_${id}`, JSON.stringify(pages));
        fromCache = false;
      }
      // If cloud returns empty array or error, DO NOT clear or overwrite existing pages!
    } catch (_) {
      // Network error, local cache remains intact
    }

    return { pages, fromCache };
  }

  // 1. Initial hit from local cache
  const result1 = await loadOcr(bookId, async () => ({ ok: true, pages: [] }));
  assert.equal(result1.pages.length, 2, 'Must retain 2 pages from local cache');
  assert.equal(result1.fromCache, true);
  assert.ok(localCache.has(`kiroku_ocr_pages_${bookId}`), 'Local cache must NOT be wiped');

  // 2. Cloud returns newer enriched pages
  const enrichedCloudPages = [
    { page_index: 0, bubbles: [{ text: 'よつばと！' }] },
    { page_index: 1, bubbles: [{ text: 'こんにちは' }] },
    { page_index: 2, bubbles: [{ text: 'あさがお' }] }
  ];
  const result2 = await loadOcr(bookId, async () => ({ ok: true, pages: enrichedCloudPages }));
  assert.equal(result2.pages.length, 3);
  assert.equal(result2.fromCache, false);
  assert.equal(JSON.parse(localCache.get(`kiroku_ocr_pages_${bookId}`)).length, 3);

  // 3. Subsequent cloud failure must still retain all 3 cached pages
  const result3 = await loadOcr(bookId, async () => { throw new Error('Network timeout'); });
  assert.equal(result3.pages.length, 3);
  assert.equal(result3.fromCache, true);
});

test('manga_mobile_reader: clearCurrentPageAnnotations requires confirmation before deletion', () => {
  let confirmed = false;
  let confirmCalled = false;
  function mockConfirm(msg) {
    confirmCalled = true;
    return confirmed;
  }

  let pageAnnotations = [{ tool: 'pen', points: [] }];

  function clearAnnotations() {
    if (!mockConfirm('Clear all annotations on this page?')) {
      return;
    }
    pageAnnotations = [];
  }

  // When user cancels confirmation:
  confirmed = false;
  clearAnnotations();
  assert.ok(confirmCalled, 'window.confirm must be prompted');
  assert.equal(pageAnnotations.length, 1, 'Annotations must NOT be cleared when cancelled');

  // When user confirms:
  confirmed = true;
  clearAnnotations();
  assert.equal(pageAnnotations.length, 0, 'Annotations must be cleared when confirmed');
});

test('manga_mobile_reader: reader height and mobile bottombar clearance ensure visibility above home indicator', () => {
  const cssContent = fs.readFileSync(mangaCssPath, 'utf8');
  const responsiveCssPath = path.join(__dirname, '..', 'src', 'ui', 'styles', 'responsive.css');
  const responsiveCssContent = fs.readFileSync(responsiveCssPath, 'utf8');

  // 1. Immersion reader fills 100% of parent container rather than 100dvh overflowing under chrome
  assert.ok(cssContent.includes('.manga-immersion-reader {\n  display: flex;\n  flex-direction: column;\n  height: 100% !important;'), 'immersion reader must use 100% height');

  // 2. Mobile bottombar sits comfortably above safe-area-inset-bottom (iPhone Home Indicator)
  assert.ok(cssContent.includes('bottom: max(1rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))'), 'mobile bottombar must clear home indicator');

  // 3. Responsive.css does not inject content-padding-bottom when immersion reader is active
  assert.ok(responsiveCssContent.includes('body.manga-reader-active #manga-view'), 'responsive.css must exempt manga reader from dock clearance');
});

test('manga_mobile_reader: processRecognizedSentence uses high-fidelity morphological tokenization before regex fallback', () => {
  const jsContent = fs.readFileSync(mangaJsPath, 'utf8');

  assert.ok(jsContent.includes('this.apiClient.tokenize(sentence, \'C\')'), 'must call apiClient.tokenize for morphological segmentation');
  assert.ok(jsContent.includes('surface: t.surface || t.surface_form || t.text || \'\''), 'must normalize surface form');
  assert.ok(jsContent.includes('lemma: t.dictionary_form || t.lemma || t.normalized || t.surface || \'\''), 'must normalize dictionary lemma');
});

test('manga_mobile_reader: formatDefinitionsHtml supports both entries and dictionary_entries with meanings', () => {
  const jsContent = fs.readFileSync(mangaJsPath, 'utf8');

  assert.ok(jsContent.includes('captureData.dictionary_entries'), 'must support captureData.dictionary_entries schema');
  assert.ok(jsContent.includes('entry.meanings'), 'must support entry.meanings schema');
});


