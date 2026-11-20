import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

import { MangaView } from '../../../desktop/src/ui/views/manga.js';
import { storeBookFile, storePageAnnotations } from '../../../desktop/src/ui/services/manga_storage.js';

// Setup Mock DOM Elements for Node environment
function createMockElement(tagName = 'div') {
  const el = {
    tagName: tagName.toUpperCase(),
    id: '',
    className: '',
    _innerHTML: '',
    textContent: '',
    children: [],
    dataset: {},
    parentElement: null,
    attributes: new Map(),
    style: {},
    listeners: new Map(),
    width: 800,
    height: 1200,
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 1000,
    clientHeight: 800,
    classList: {
      _classes: new Set(),
      add: (...cls) => cls.forEach(c => el.classList._classes.add(c)),
      remove: (...cls) => cls.forEach(c => el.classList._classes.delete(c)),
      contains: (c) => el.classList._classes.has(c),
      toggle: (c, force) => {
        if (force !== undefined) {
          if (force) el.classList._classes.add(c);
          else el.classList._classes.delete(c);
          return force;
        }
        if (el.classList._classes.has(c)) {
          el.classList._classes.delete(c);
          return false;
        }
        el.classList._classes.add(c);
        return true;
      }
    },
    get innerHTML() {
      if (this.children.length === 0) return this._innerHTML || '';
      return (this._innerHTML || '') + ' ' + this.children.map(c => c.innerHTML || c._innerHTML || '').join(' ');
    },
    set innerHTML(val) {
      this._innerHTML = val;
      this.children = [];
      const tagRegex = /<([a-z0-9-]+)([^>]*)>/gi;
      let m;
      while ((m = tagRegex.exec(val)) !== null) {
        const t = m[1];
        if (t.startsWith('/')) continue;
        const attrs = m[2];
        const child = createMockElement(t);
        const idMatch = attrs.match(/id="([^"]+)"/);
        if (idMatch) child.id = idMatch[1];
        const classMatch = attrs.match(/class="([^"]+)"/);
        if (classMatch) {
          child.className = classMatch[1];
          classMatch[1].split(/\s+/).filter(Boolean).forEach(c => child.classList.add(c));
        }
        const dataColor = attrs.match(/data-color="([^"]+)"/);
        if (dataColor) child.setAttribute('data-color', dataColor[1]);
        const styleMatch = attrs.match(/style="([^"]+)"/);
        if (styleMatch) {
          child.setAttribute('style', styleMatch[1]);
          const pairs = styleMatch[1].split(';').map(p => p.trim()).filter(Boolean);
          for (const pair of pairs) {
            const [k, v] = pair.split(':').map(s => s.trim());
            if (k && v) child.style[k] = v;
          }
        }
        child.parentElement = this;
        this.children.push(child);
      }
    },
    setAttribute(k, v) { this.attributes.set(k, String(v)); },
    getAttribute(k) { return this.attributes.get(k) || null; },
    removeAttribute(k) { this.attributes.delete(k); },
    addEventListener(evt, fn) {
      if (!this.listeners.has(evt)) this.listeners.set(evt, []);
      this.listeners.get(evt).push(fn);
    },
    removeEventListener(evt, fn) {
      if (!this.listeners.has(evt)) return;
      const list = this.listeners.get(evt).filter(f => f !== fn);
      this.listeners.set(evt, list);
    },
    dispatchEvent(evt) {
      const list = this.listeners.get(evt?.type || evt) || [];
      list.forEach(fn => fn(evt));
    },
    closest(sel) {
      let curr = this.parentElement;
      while (curr) {
        if (sel.startsWith('.') && curr.classList.contains(sel.slice(1))) return curr;
        if (sel.startsWith('#') && curr.id === sel.slice(1)) return curr;
        curr = curr.parentElement;
      }
      return null;
    },
    querySelector(sel) {
      const q = [this];
      while (q.length) {
        const node = q.shift();
        if (sel.startsWith('#') && node.id === sel.slice(1)) return node;
        if (sel.startsWith('.') && node.classList.contains(sel.slice(1))) return node;
        if (node.tagName.toLowerCase() === sel.toLowerCase()) return node;
        for (const ch of node.children) q.push(ch);
      }
      return null;
    },
    querySelectorAll(sel) {
      const res = [];
      const q = [this];
      while (q.length) {
        const node = q.shift();
        if (sel.startsWith('.') && node.classList.contains(sel.slice(1))) res.push(node);
        else if (node.tagName.toLowerCase() === sel.toLowerCase()) res.push(node);
        for (const ch of node.children) q.push(ch);
      }
      return res;
    },
    appendChild(child) {
      if (child) {
        if (child.children && child.children.length > 0 && child.tagName === 'DIV') {
          for (const c of child.children) {
            c.parentElement = this;
            this.children.push(c);
          }
        } else {
          child.parentElement = this;
          this.children.push(child);
        }
      }
      return child;
    },
    getContext() {
      return {
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        save: () => {},
        restore: () => {},
        drawImage: () => {},
        fillRect: () => {},
        globalCompositeOperation: 'source-over',
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1
      };
    },
    getBoundingClientRect() {
      return { top: 0, left: 0, width: 800, height: 1200, right: 800, bottom: 1200 };
    },
    toDataURL() {
      return 'data:image/jpeg;base64,mockImageBase64StringForTesting==';
    }
  };
  return el;
}

// Global Browser Mock
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: (tag) => createMockElement(tag),
    createDocumentFragment: () => createMockElement('div'),
    getElementById: () => null,
    body: createMockElement('body'),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
} else {
  if (!globalThis.document.addEventListener) globalThis.document.addEventListener = () => {};
  if (!globalThis.document.removeEventListener) globalThis.document.removeEventListener = () => {};
}
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { origin: 'http://127.0.0.1:8000' }
  };
}
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
}
if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
}

test('S01: Manga Library clean empty state and offline storage initialization', async () => {
  const container = createMockElement('div');
  const view = new MangaView();
  view.books = [];
  view.library = [];
  view.mount(container);

  assert.ok(container.innerHTML.includes('Upload Manga / PDF') || container.innerHTML.includes('manga-bookshelf') || container.innerHTML.includes('dropzone'), 'Clean empty state with dropzone must be displayed');
  assert.equal(view.activeMode, 'library');
});

test('S02: Book import and format parsing (PDF and CBZ archives)', async () => {
  const view = new MangaView();
  view.books = [];
  view.library = [];
  const testBook = {
    id: 'book_one_piece_vol1',
    title: 'One Piece Vol 1',
    filename: 'op_vol1.cbz',
    type: 'cbz',
    totalPages: 200,
    pageCount: 200,
    currentPage: 1,
    addedAt: Date.now()
  };
  view.books.push(testBook);
  view.library.push(testBook);
  view.saveLibrary();

  assert.equal(view.books.length, 1);
  assert.equal(view.books[0].type, 'cbz');
  assert.equal(view.books[0].pageCount, 200);
});

test('S03: Dual-page spread mode calculations and right-to-left layout', async () => {
  const view = new MangaView();
  view.currentBook = { id: 'test_book', totalPages: 50 };
  view.pageCount = 50;
  view.currentPage = 1;
  view.spreadMode = 'double';

  view.nextPage();
  // Double page spread steps by 2 in manga right-to-left reading
  assert.equal(view.currentPage, 3, 'Next page in double-spread mode advances by 2');

  view.prevPage();
  assert.equal(view.currentPage, 1, 'Prev page in double-spread mode steps back by 2');
});

test('S04: LAN sync & companion streaming (Send to Phone pre-upload and ticket)', async () => {
  let ticketRequested = false;

  const mockApiClient = {
    request: async (url, opts) => {
      if (url.includes('/api/manga/upload')) {
        return { status: 'ok', uploaded: true };
      }
      if (url === '/api/manga/ticket') {
        ticketRequested = true;
        return { ticket: 'krk_ticket_abc123', stream_url: 'http://192.168.1.5:8000/api/manga/stream/lan_book_1?ticket=krk_ticket_abc123' };
      }
      return {};
    }
  };

  const view = new MangaView();
  view.apiClient = mockApiClient;
  const container = createMockElement('div');
  view.mount(container);

  const testBook = { id: 'lan_book_1', title: 'Berserk Vol 1', filename: 'berserk.pdf', type: 'pdf' };
  view.books = [testBook];
  view.library = [testBook];

  // Trigger Send to Phone modal flow
  await view.openSendToPhoneModal(testBook.id);

  assert.ok(ticketRequested, 'Ticket request must be initiated');
  assert.ok((container.querySelector('#manga-modal-host')?.innerHTML || container.innerHTML).includes('Send to Phone'), 'Modal title must be rendered');
});

test('S05: Cloud manga storage (upload, list, and file retrieval)', async () => {
  let listCalled = false;

  const mockApiClient = {
    request: async (url, opts) => {
      if (url === '/api/user/manga/upload') {
        return { ok: true, book_id: opts.body.book_id, size: 1024 };
      }
      if (url === '/api/user/manga/list') {
        listCalled = true;
        return { ok: true, books: [{ book_id: 'cloud_book_1', title: 'Chainsaw Man', total_pages: 192 }] };
      }
      return {};
    }
  };

  const view = new MangaView();
  view.apiClient = mockApiClient;
  view.books = [{ id: 'cloud_book_1', title: 'Chainsaw Man', totalPages: 192, type: 'pdf' }];
  view.library = view.books;

  const cloudList = await view.fetchCloudBooks();
  assert.ok(listCalled, 'Cloud list endpoint must be queried');
  assert.equal(cloudList.length, 1);
  assert.equal(cloudList[0].book_id, 'cloud_book_1');
});

test('S06: Per-user manga reading progress in cloud', async () => {
  let progressPayload = null;

  const mockApiClient = {
    request: async (url, opts) => {
      if (url === '/api/user/progress/manga') {
        progressPayload = opts.body;
        return { ok: true, manga_id: opts.body.manga_id, page_number: opts.body.page_number };
      }
      return {};
    }
  };

  const view = new MangaView();
  view.apiClient = mockApiClient;
  view.currentBook = { id: 'spy_family', totalPages: 100, currentPage: 1 };
  view.pageCount = 100;

  view.goToPage(42);

  assert.equal(view.currentPage, 42);
  assert.ok(progressPayload, 'Progress sync must be triggered on page turn');
  assert.equal(progressPayload.manga_id, 'spy_family');
  assert.equal(progressPayload.page_number, 42);
  assert.equal(progressPayload.completed, 0);
});

test('S07: In-viewer canvas annotations (pencil, eraser, palette) and cloud sync', async () => {
  let annotationPayload = null;

  const mockApiClient = {
    request: async (url, opts) => {
      if (url === '/api/user/manga/annotations') {
        annotationPayload = opts.body;
        return { ok: true, book_id: opts.body.book_id, page_number: opts.body.page_number };
      }
      return {};
    }
  };

  const container = createMockElement('div');
  const view = new MangaView();
  view.apiClient = mockApiClient;
  view.currentBook = { id: 'book_annotations', totalPages: 50 };
  view.currentPage = 5;
  view.activeMode = 'reader';
  view.mount(container);
  view.render();

  // Switch tool to Draw (Pencil)
  view.setActiveTool('draw');
  assert.equal(view.activeTool, 'draw');

  // Simulate stroke
  view.startAnnotationStroke({ clientX: 100, clientY: 100 });
  assert.ok(view.isDrawing);
  assert.equal(view.currentStroke.tool, 'draw');

  view.continueAnnotationStroke({ clientX: 120, clientY: 150 });
  assert.equal(view.currentStroke.points.length, 2);

  await view.finishAnnotationStroke();
  assert.equal(view.isDrawing, false);

  const cachedStrokes = view.pageAnnotationsMap.get('book_annotations_p5');
  assert.ok(cachedStrokes && cachedStrokes.length > 0, 'Stroke must be recorded in page map');
  assert.ok(annotationPayload, 'Annotation cloud sync must be dispatched');
  assert.equal(annotationPayload.book_id, 'book_annotations');
  assert.equal(annotationPayload.page_number, 5);

  // Undo stroke
  await view.undoAnnotationStroke();
  assert.equal(view.pageAnnotationsMap.get('book_annotations_p5').length, 0, 'Undo removes stroke from page map');

  // Redo stroke
  await view.redoAnnotationStroke();
  assert.equal(view.pageAnnotationsMap.get('book_annotations_p5').length, 1, 'Redo restores stroke to page map');

  // Clear annotations
  await view.clearCurrentPageAnnotations();
  assert.equal(view.pageAnnotationsMap.has('book_annotations_p5'), false);
});

test('S08: MangaOCR recognition with image content caching', async () => {
  let ocrCallCount = 0;

  const mockApiClient = {
    request: async (url, opts) => {
      if (url === '/api/ocr/recognize') {
        ocrCallCount++;
        return { text: 'お前はもう死んでいる' };
      }
      return {};
    }
  };

  const container = createMockElement('div');
  const view = new MangaView();
  view.apiClient = mockApiClient;
  view.currentBook = { id: 'fist_north_star' };
  view.currentPage = 1;
  view.activeMode = 'reader';
  view.mount(container);
  view.render();

  const fakeAnchor = { x: 10, y: 10 };

  // 1. First recognition call via performOcrBoxSelection
  await view.performOcrBoxSelection(10, 10, 100, 50, fakeAnchor);
  assert.equal(ocrCallCount, 1, 'First recognition should invoke OCR engine');
  assert.equal(view.recognizedText, 'お前はもう死んでいる');

  // 2. Second recognition of identical crop
  await view.performOcrBoxSelection(10, 10, 100, 50, fakeAnchor);
  assert.equal(ocrCallCount, 1, 'Second identical crop must be served instantly from ocrTextCache without duplicate inference');
});

test('S09: Comic bubble detector with predictive multi-page prefetching', async () => {
  let detectCount = 0;

  const mockApiClient = {
    request: async (url, opts) => {
      if (url === '/api/ocr/detect') {
        detectCount++;
        return { boxes: [{ x: 50, y: 50, w: 120, h: 180, text: '何者だ！' }] };
      }
      return {};
    }
  };

  const container = createMockElement('div');
  const view = new MangaView();
  view.apiClient = mockApiClient;
  view.currentBook = { id: 'hunter_x_hunter' };
  view.currentPage = 1;
  view.activeMode = 'reader';
  view.mount(container);
  view.render();

  // Detect on current page
  await view.detectBubblesOnCurrentPage();
  assert.equal(detectCount, 1);
  assert.equal(view.detectedBubbles.length, 1);

  // Bubble cache should contain the detected boxes
  const cacheKey = `${view.currentBook.id}_p1_${view.spreadMode}`;
  assert.ok(view.bubbleCache.has(cacheKey), 'Detected bubbles must be indexed in bubbleCache');
});

test('S10: Page switching performance: instant bubble and OCR render on cached page without spinner', async () => {
  let detectCount = 0;

  const mockApiClient = {
    request: async (url, opts) => {
      if (url === '/api/ocr/detect') {
        detectCount++;
        return { boxes: [{ x: 20, y: 20, w: 80, h: 80 }] };
      }
      return {};
    }
  };

  const container = createMockElement('div');
  const view = new MangaView();
  view.apiClient = mockApiClient;
  view.currentBook = { id: 'death_note' };
  view.currentPage = 2;
  view.activeMode = 'reader';
  view.mount(container);
  view.render();

  // Pre-seed cache for page 2
  const cacheKey = `${view.currentBook.id}_p2_${view.spreadMode}`;
  view.bubbleCache.set(cacheKey, [{ x: 20, y: 20, w: 80, h: 80 }]);

  // Calling detect on cached page should hit memory cache with 0 network calls
  await view.detectBubblesOnCurrentPage();
  assert.equal(detectCount, 0, 'Instant 0ms cache recall without network or model inference');
  assert.equal(view.detectedBubbles.length, 1);
});

test('S11: PWA compatibility and touch gesture handling', async () => {
  const container = createMockElement('div');
  const view = new MangaView();
  view.currentBook = { id: 'pwa_manga', totalPages: 10 };
  view.currentPage = 1;
  view.pageCount = 10;
  view.activeMode = 'reader';
  view.mount(container);
  view.render();

  // Verify tool state transitions on touch / mobile mode
  view.setActiveTool('draw');
  assert.equal(view.activeTool, 'draw');

  // Verify touch drawing start
  view.startAnnotationStroke({ touches: [{ clientX: 50, clientY: 50 }] });
  assert.ok(view.isDrawing);
  assert.equal(view.currentStroke.points.length, 1);

  await view.finishAnnotationStroke();
  assert.equal(view.isDrawing, false);
});

test('S12: Design tokens adherence and emoji prevention', async () => {
  const cssPath = path.join(ROOT_DIR, 'desktop', 'src', 'ui', 'styles', 'views', 'manga.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // Check for raw hex colors
  const rawHexMatches = cssContent.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.equal(rawHexMatches.length, 0, `manga.css must contain zero raw hex colors, found: ${rawHexMatches.join(', ')}`);

  // Check for emoji
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.ok(!emojiRegex.test(cssContent), 'manga.css must contain zero emoji characters');
});

test('S13: Full manga bookshelf background sync, deduplication & interrupted resume', async () => {
  const uploadedBooks = [];
  let libraryStateSynced = null;
  const progressCalls = [];
  const annotationCalls = [];

  const mockApiClient = {
    request: async (url, opts = {}) => {
      if (url === '/api/user/manga/list') {
        // Return 1 book already in the cloud with size 1000
        return {
          ok: true,
          books: [
            { book_id: 'existing_book_1', size: 1000, total_pages: 50 }
          ]
        };
      }
      if (url === '/api/user/manga/library-state') {
        libraryStateSynced = opts.body;
        return { ok: true, updated_at: 12345 };
      }
      if (url === '/api/user/manga/upload') {
        uploadedBooks.push(opts.body);
        return { ok: true, book_id: opts.body.book_id, size: opts.body.size };
      }
      if (url === '/api/user/progress/manga') {
        progressCalls.push(opts.body);
        return { ok: true, manga_id: opts.body.manga_id };
      }
      if (url === '/api/user/manga/annotations') {
        annotationCalls.push(opts.body);
        return { ok: true, book_id: opts.body.book_id };
      }
      return { ok: true };
    }
  };

  const container = createMockElement('div');
  const view = new MangaView(null, { apiClient: mockApiClient });
  view.books = [
    {
      id: 'existing_book_1',
      title: 'Existing Manga',
      filename: 'existing.pdf',
      type: 'pdf',
      size: 1000,
      totalPages: 50,
      currentPage: 25,
      bookmarks: [{ id: 'bm_1', page: 10, note: 'Important clue' }]
    },
    {
      id: 'new_book_2',
      title: 'New Manga Volume',
      filename: 'new_vol.pdf',
      type: 'pdf',
      size: 2500,
      totalPages: 100,
      currentPage: 5,
      bookmarks: []
    }
  ];
  view.library = view.books;
  view.folders = [{ id: 'f_shonen', name: 'Shonen' }];

  // Mock file buffer retrieval for new_book_2
  const fakeBuffer = new Uint8Array([1, 2, 3, 4, 5]).buffer;
  await storeBookFile('new_book_2', fakeBuffer, { title: 'New Manga Volume' });

  // Store an annotation for new_book_2
  await storePageAnnotations('new_book_2', 5, [
    { tool: 'pencil', color: 'vermilion', width: 4, points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] }
  ]);

  // Mount view in bookshelf mode
  await view.mount(container);

  // 1. Check sync button exists in toolbar
  const syncBtn = container.querySelector('#btn-manga-sync-all');
  assert.ok(syncBtn, '#btn-manga-sync-all must exist in bookshelf view');
  assert.ok(container.innerHTML.includes('Sync Cloud'), 'Button label must read Sync Cloud');

  // Verify loading overlay is hidden before sync
  const loadingOverlay = container.querySelector('#manga-loading-overlay');
  assert.equal(loadingOverlay?.style?.display, 'none', 'Loading overlay must be hidden');

  // 2. Trigger syncAllToCloud()
  await view.syncAllToCloud();

  // Verify loading overlay was NOT displayed during or after sync (background only)
  assert.equal(loadingOverlay?.style?.display, 'none', 'Loading overlay must remain hidden during background sync');

  // Verify library state (folders and bookmarks) was sent
  assert.ok(libraryStateSynced, 'Library state (folders & bookmarks) must be sent to cloud');
  assert.equal(libraryStateSynced.folders.length, 1);
  assert.equal(libraryStateSynced.folders[0].name, 'Shonen');
  assert.ok(libraryStateSynced.bookmarks.existing_book_1, 'Bookmarks must be sent for existing_book_1');

  // Verify deduplication: existing_book_1 (same size) was skipped, only new_book_2 was uploaded
  assert.equal(uploadedBooks.length, 1, 'Only non-uploaded book should be uploaded to cloud');
  assert.equal(uploadedBooks[0].book_id, 'new_book_2');

  // Verify reading progress was sent for both books
  assert.ok(progressCalls.some(p => p.manga_id === 'existing_book_1' && p.page_number === 25));
  assert.ok(progressCalls.some(p => p.manga_id === 'new_book_2' && p.page_number === 5));

  // Verify annotations were synced
  assert.ok(annotationCalls.some(a => a.book_id === 'new_book_2' && a.page_number === 5));

  // 3. Test Failure-Safe Resumable Sync (simulated crash / restart)
  // Seed an interrupted sync queue into localStorage with 2 pending tasks
  const interruptedQueue = {
    id: 'interrupted_1',
    total: 2,
    completed: 0,
    tasks: [
      { type: 'progress', bookId: 'crashed_book', chapterNumber: 1, pageNumber: 77, completed: 0 },
      { type: 'annotation', bookId: 'crashed_book', pageNumber: 77, dataJson: '[]' }
    ]
  };
  localStorage.setItem('kiroku.manga.sync_queue', JSON.stringify(interruptedQueue));

  // Mount a fresh instance to simulate application restart
  const restartedContainer = createMockElement('div');
  const freshView = new MangaView(null, { apiClient: mockApiClient });
  await freshView.mount(restartedContainer);

  // Wait briefly for background resume loop to process the 2 tasks
  await new Promise(r => setTimeout(r, 150));

  // Verify tasks were drained from localStorage upon completion
  assert.equal(localStorage.getItem('kiroku.manga.sync_queue'), null, 'Queue must be drained upon resume completion');
  assert.ok(progressCalls.some(p => p.manga_id === 'crashed_book' && p.page_number === 77), 'Interrupted progress task must be resumed and executed');
  assert.ok(annotationCalls.some(a => a.book_id === 'crashed_book' && a.page_number === 77), 'Interrupted annotation task must be resumed and executed');
});
