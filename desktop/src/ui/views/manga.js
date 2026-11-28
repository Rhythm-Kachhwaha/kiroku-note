/**
 * Kiroku Note Desktop — Manga Reader View
 * Bookshelf Library with custom folders + Full-Screen Immersion Reader.
 * Client-side PDF (pdf.js) & CBZ (jszip) rendering with IndexedDB persistence,
 * automatic speech bubble detection, dual-page spread (book style),
 * tactile modals for folders & actions, and rich Migaku-style card mining.
 */

import { apiClient } from '../services/api_client.js';
import { escapeHtml } from '../utils/sanitizer.js';
import { getUniversalAnkiDeck } from '../utils/learner.js';
import {
  storeBookFile,
  getBookFileBuffer,
  deleteBookFile,
  storePageAnnotations,
  getPageAnnotations,
  deletePageAnnotations,
  getAllStoredAnnotations,
  verifyBookStorage,
  requestPersistentStorage,
  getAllStoredBooksMetadata,
  storeBookCover,
  getBookCover,
  deleteBookCover,
  enqueueSyncOutbox,
  peekSyncOutbox,
  removeSyncOutbox,
  updateSyncOutboxItem
} from '../services/manga_storage.js';
import { uploadMangaChunks, downloadMangaChunks } from '../services/manga_transfer.js';
import { fetchOrGenerateQrSvg } from '../utils/qr.js';

const STORAGE_KEY_LIBRARY = 'kiroku.manga.library';
const STORAGE_KEY_FOLDERS = 'kiroku.manga.folders';
const STORAGE_KEY_SPREAD = 'kiroku.manga.spread_mode';
const STORAGE_KEY_AUTO_FOLDER_ZIP = 'kiroku.manga.auto_folder_zip';
const STORAGE_KEY_SYNC_QUEUE = 'kiroku.manga.sync_queue';
const STORAGE_KEY_LAST_SYNC = 'kiroku.manga.last_sync_time';

const ANNOTATION_COLOR_MAP = {
  'vermilion': '#D94B38',
  'var(--vermilion)': '#D94B38',
  'var(--gold-primary)': '#D94B38',
  'cyan': '#4FBBBC',
  'aqua': '#4FBBBC',
  'var(--industrial-aqua)': '#4FBBBC',
  'var(--electric-cyan)': '#4FBBBC',
  'amber': '#F39120',
  'var(--heat-marker)': '#F39120',
  'jade': '#4EBB7B',
  'green': '#4EBB7B',
  'var(--jade)': '#4EBB7B',
  'paper': '#F5F1E8',
  'white': '#F5F1E8',
  'var(--warm-paper)': '#F5F1E8',
  'black': '#141311',
  'var(--ink-black)': '#141311',
  'crimson': '#D94B38',
  'var(--danger)': '#D94B38'
};

function resolveCanvasColor(color) {
  if (!color) return '#D94B38';
  if (ANNOTATION_COLOR_MAP[color]) return ANNOTATION_COLOR_MAP[color];
  if (color.startsWith('#') || color.startsWith('rgb')) return color;
  if (typeof document !== 'undefined') {
    const match = color.match(/var\((--[^,\)]+)\)/);
    if (match) {
      const val = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
      if (val) return val;
    }
  }
  return '#D94B38';
}

function ensurePdfWorker() {
  if (typeof window !== 'undefined' && window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
    try {
      const origin = (typeof window.location !== 'undefined' && window.location.origin) ? window.location.origin : '';
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = origin
        ? `${origin}/ui/vendor/pdf.worker.min.js`
        : '/ui/vendor/pdf.worker.min.js';
    } catch (_) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/ui/vendor/pdf.worker.min.js';
    }
  }
}

function safeArrayBufferToBase64(buffer) {
  if (!buffer) return '';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(chunks.join(''));
}

const PACMAN_LOADING_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" class="pacman3351" viewBox="50 0 500 300">
  <style>
    .pacman3351-dot {
      fill: currentColor;
    }
    .pacman3351-open,
    .pacman3351-mouth-top,
    .pacman3351-mouth-bottom {
      fill: currentColor;
    }
    .pacman3351-mouth-top,
    .pacman3351-mouth-bottom {
      animation-duration: 175ms;
      animation-timing-function: linear;
      animation-direction: alternate;
      animation-iteration-count: infinite;
      transform-origin: calc(300px/2) 150px;
    }
    .pacman3351-mouth-top {
      animation-name: rotate3351-counterclockwise;
    }
    .pacman3351-mouth-bottom {
      animation-name: rotate3351-clockwise;
    }
    @keyframes rotate3351-counterclockwise {
      100% {
        transform: rotate(-30deg);
      }
    }
    @keyframes rotate3351-clockwise {
      100% {
        transform: rotate(30deg);
      }
    }
    .pacman3351-dot {
      animation-name: dot3351-motion;
      animation-duration: 600ms;
      animation-timing-function: linear;
      animation-iteration-count: infinite;
    }
    @keyframes dot3351-motion {
      100% {
        transform: translateX(-100px);
      }
    }
  </style>
  <circle class="pacman3351-dot" cx="250" cy="50%" r="10"/>
  <circle class="pacman3351-dot" cx="350" cy="50%" r="10"/>
  <circle class="pacman3351-dot" cx="450" cy="50%" r="10"/>
  <circle class="pacman3351-dot" cx="550" cy="50%" r="10"/>
  <circle class="pacman3351-dot" cx="650" cy="50%" r="10"/>
  <path class="pacman3351-mouth-bottom" d="
    M 150,150
    L 220.4,221.0
    A 100 100 0 0 0 250,150
    Z"/>
  <path class="pacman3351-mouth-top" d="
    M 150,150 
    L 220.4,79.0
    A 100 100 0 0 1 250,150
    Z"/>
  <path class="pacman3351-open" d="
    M 150,150
    L 236.6,100
    A 100 100 0 1 0 236.6,200
    Z"/>
</svg>
`;

function katakanaToHiragana(str) {
  if (!str) return '';
  return str.replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function shouldShowReading(word, reading) {
  if (!reading || !word) return false;
  const cleanWord = String(word).trim();
  const cleanReading = String(reading).trim();
  if (!cleanReading || cleanWord === cleanReading) return false;
  if (katakanaToHiragana(cleanWord) === katakanaToHiragana(cleanReading)) return false;
  // Only show separate pronunciation reading if the word contains Kanji characters
  const hasKanji = /[\u4e00-\u9faf]/.test(cleanWord);
  return hasKanji;
}

function formatDefinitionsHtml(captureData) {
  if (!captureData) return '<span class="text-xs text-muted">No definitions found</span>';

  const rawEntries = Array.isArray(captureData.entries) && captureData.entries.length > 0
    ? captureData.entries
    : (Array.isArray(captureData.dictionary_entries) && captureData.dictionary_entries.length > 0 ? captureData.dictionary_entries : []);

  // 1. If structured dictionary entries exist with senses or meanings
  if (rawEntries.length > 0) {
    const rows = [];
    let senseCounter = 1;
    rawEntries.slice(0, 3).forEach((entry) => {
      const senses = Array.isArray(entry.senses) && entry.senses.length > 0
        ? entry.senses
        : (Array.isArray(entry.meanings) ? entry.meanings.map(m => ({ glosses: [m], parts_of_speech: [] })) : []);

      senses.slice(0, 4).forEach((s) => {
        const glossList = Array.isArray(s.glosses) ? s.glosses : (s.gloss ? [s.gloss] : []);
        const glosses = glossList.join('; ');
        if (!glosses) return;
        const pos = Array.isArray(s.parts_of_speech) ? s.parts_of_speech.join(', ') : (s.parts_of_speech || '');
        rows.push(`
          <div class="manga-popover-def-row">
            <div class="manga-popover-def-meta">
              <span class="manga-popover-def-num font-mono">${senseCounter++}.</span>
              ${pos ? `<span class="manga-popover-def-pos">(${escapeHtml(pos)})</span>` : ''}
            </div>
            <div class="manga-popover-def-text">${escapeHtml(glosses)}</div>
          </div>
        `);
      });
    });
    if (rows.length > 0) {
      return `<div class="manga-popover-defs-list">${rows.join('')}</div>`;
    }
  }

  // 2. Fallback to parsing meaning string by newlines or numbered lines (e.g. "1. ...\n2. ..." or "1. ... 2. ...")
  const meaning = captureData.meaning || '';
  if (meaning) {
    const lines = meaning.split(/(?:\n|\s*(?=\b\d+\.\s+))/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      const rows = lines.map((line) => {
        const match = line.match(/^(\d+)\.\s*(.*)$/);
        if (match) {
          return `
            <div class="manga-popover-def-row">
              <div class="manga-popover-def-meta">
                <span class="manga-popover-def-num font-mono">${match[1]}.</span>
              </div>
              <div class="manga-popover-def-text">${escapeHtml(match[2])}</div>
            </div>
          `;
        }
        return `
          <div class="manga-popover-def-row">
            <div class="manga-popover-def-text">${escapeHtml(line)}</div>
          </div>
        `;
      });
      return `<div class="manga-popover-defs-list">${rows.join('')}</div>`;
    }
    return `
      <div class="manga-popover-defs-list">
        <div class="manga-popover-def-row">
          <div class="manga-popover-def-text">${escapeHtml(meaning)}</div>
        </div>
      </div>
    `;
  }

  return '<span class="text-xs text-muted">No definitions found</span>';
}

export class MangaView {
  constructor(router, options = {}) {
    this.router = router;
    this.options = options;
    this.apiClient = options.apiClient || apiClient;
    this.container = null;

    // keepAlive flag so switching tabs does not destroy memory / active open books
    this.keepAlive = true;

    // View state: 'library' or 'reader'
    this.activeMode = 'library';

    // Library & Folders State
    this.books = this.loadLibrary();
    this.library = this.books;
    this.folders = this.loadFolders();
    this.activeFolderId = 'all';

    // Cloud Background Sync State & Queue
    this.isSyncing = false;
    this.syncStatus = 'idle'; // 'idle' | 'syncing' | 'synced' | 'error'
    this.syncProgress = { completed: 0, total: 0 };

    // Modal State
    this.activeModal = null; // 'create_folder' | 'rename_folder' | 'delete_folder' | 'book_menu'
    this.modalContext = null;

    // Spread mode: 'single' or 'double' (like actual manga books)
    this.spreadMode = localStorage.getItem(STORAGE_KEY_SPREAD) === 'double' ? 'double' : 'single';

    // Auto-folder on ZIP upload: auto creates a folder named after the zip and unpacks all volumes inside it
    this.autoFolderZip = localStorage.getItem(STORAGE_KEY_AUTO_FOLDER_ZIP) !== 'false'; // default true

    // Current Book State
    this.currentBook = null;
    this.currentPage = 1;
    this.pageCount = 1;
    this.pdfDoc = null;
    this.cbzZip = null;
    this.cbzImageEntries = [];

    // Canvas & Stage State
    this.currentImage = null;
    this.ocrBoxSelection = null;
    this.isSelecting = false;
    this.selectionStart = null;
    this.isAutoDetecting = false;
    this.detectedBubbles = [];
    this.activeCropDataUrl = null;

    // Study Inspector State (Migaku-Style)
    this.inspectorMode = (typeof window !== 'undefined' && window.innerWidth <= 768) ? 'popover' : 'sidebar'; // 'sidebar' | 'popover'
    this.sidebarVisible = false;
    this.recognizedTokens = [];
    this.activeToken = null;
    this.activeCaptureData = null;

    // Floating Popover State
    this.popoverVisible = false;
    this.popoverAnchor = { x: 0, y: 0 };
    this.recognizedText = '';
    this.lastMinedWord = null;

    // Zoom & Inspection State
    this.zoomScale = 1.0;
    this.zoomMode = 'fit'; // 'fit' | 'width' | 'custom'
    this.selectedBubbleIndex = -1;
    this.isFullscreenFocus = false;
    this._detectTimeoutId = null;

    // Bookmarks & Drawer State
    this.bookmarkDrawerOpen = false;

    // Furigana reading toggle (persisted)
    this.furiganaEnabled = localStorage.getItem('manga_furigana_enabled') !== 'false';

    // Pre-Baked OCR Cloud Cache (key: `${bookId}_p${pageNum}` -> Array<Bubble {box, text}>)
    this.prebakedOcrMap = new Map();
    this.isBakingOcr = false;
    this.cancelBakeRequested = false;

    // Auto-OCR Next-Page Pre-fetching Cache & State
    this.prefetchOcrCache = new Map(); // key: `${bookId}_${pageNum}_${spreadMode}` -> boxes
    this.bubbleCache = new Map(); // key: `${bookId}_p${pageNum}_${spreadMode}` -> boxes
    this.ocrTextCache = new Map(); // key: cropKey -> recognized text
    this.prefetchTimeout = null;
    this.isPrefetching = false;
    this._saveLibraryDebounceTimer = null;
    this._panRafId = null;

    // Active Interaction Tool: 'move' (pan) | 'select' (OCR box) | 'draw' (pencil) | 'eraser'
    this.activeTool = 'move';
    this.annotationColor = 'var(--vermilion)';
    this.annotationLineWidth = 4;
    this.isDrawing = false;
    this.currentStroke = null;
    this.pageAnnotationsMap = new Map(); // key: `${bookId}_p${pageNum}` -> strokes array
    this.annotationRedoMap = new Map(); // key: `${bookId}_p${pageNum}` -> undone strokes array
    this.cloudBooks = [];
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.panStartScrollLeft = 0;
    this.panStartScrollTop = 0;
    this.isSpacePressed = false;
    this.lastWheelPageTurnTime = 0;
    this.lastWheelZoomTime = 0;

    // Key & Mouse event bindings
    this.boundKeyHandler = (e) => this.handleKeyDown(e);
    this.boundKeyUpHandler = (e) => this.handleKeyUp(e);
    this.boundMouseMoveHandler = (e) => this.handleMouseMove(e);
    this.boundMouseUpHandler = (e) => this.handleMouseUp(e);
    this.activePointers = new Map();
    this.pinchInitialDistance = null;
    this.pinchInitialZoom = null;
    this.boundPointerMoveHandler = (e) => this.handlePointerMove(e);
    this.boundPointerUpHandler = (e) => this.handlePointerUp(e);
    this.boundPointerCancelHandler = (e) => this.handlePointerCancel(e);
    this.interactionState = 'idle';
    this.pointerEventSupported = false;
    this._isFlushingOutbox = false;

    // Background offline outbox triggers
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => this.flushSyncOutbox());
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.flushSyncOutbox();
        }
      });
    }
    this.flushSyncOutbox();

    // PWA manga import event listener (File Handling API & Web Share Target)
    this.boundPwaMangaHandler = async (e) => {
      if (e?.detail?.files?.length) {
        await this.openFiles(e.detail.files);
      }
    };
  }

  triggerHaptic(type = 'light') {
    if (typeof window === 'undefined') return false;
    try {
      if (window.webAPI?.haptic?.trigger) {
        return Boolean(window.webAPI.haptic.trigger(type));
      }
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        let pattern = 12;
        if (type === 'medium') pattern = 22;
        else if (type === 'heavy') pattern = 40;
        else if (type === 'success') pattern = [15, 30, 20];
        return Boolean(navigator.vibrate(pattern));
      }
      if (window.desktopAPI?.haptic?.trigger) {
        return Boolean(window.desktopAPI.haptic.trigger(type));
      }
    } catch (_) {}
    return false;
  }

  loadLibrary() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LIBRARY);
      const list = raw ? JSON.parse(raw) : [];
      const books = list.map(b => ({
        ...b,
        ocrCached: Boolean(b.ocrCached),
        ocrPageCount: Number(b.ocrPageCount || 0),
        bubbleDisplay: b.bubbleDisplay || 'show',
        bookmarks: Array.isArray(b.bookmarks) ? b.bookmarks : []
      }));
      this._coversLoadPromise = Promise.resolve().then(() => this.loadBookCoversFromStorage(books));
      return books;
    } catch {
      return [];
    }
  }

  _applyBookCoverToDom(book) {
    if (!this.container || !book?.id || !book?.coverUrl) return;
    const card = this.container.querySelector(`.manga-book-card[data-book-id="${book.id}"]`);
    if (!card) return;
    const existingImg = card.querySelector('.manga-book-cover-img');
    if (existingImg) {
      existingImg.src = book.coverUrl;
      return;
    }
    const placeholder = card.querySelector('.manga-book-cover-placeholder');
    if (placeholder) {
      const img = document.createElement('img');
      img.src = book.coverUrl;
      img.className = `manga-book-cover-img${book.isCloudOnly ? ' manga-book-cover-grayscale' : ''}`;
      img.alt = book.title || '';
      placeholder.replaceWith(img);
    }
  }

  async _persistGeneratedCover(book, canvas, coverVersion = 2) {
    if (!book || !canvas) return;
    if (typeof canvas.toBlob === 'function') {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
      if (blob) {
        await storeBookCover(book.id, blob);
        if (book._objectCoverUrl) URL.revokeObjectURL(book._objectCoverUrl);
        book._objectCoverUrl = URL.createObjectURL(blob);
        book.coverUrl = book._objectCoverUrl;
        book.coverVersion = coverVersion;
        this.saveLibrary();
        this._applyBookCoverToDom(book);
        return;
      }
    }
    let dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/webp', 0.9);
      if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      }
    } catch {
      dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    }
    await storeBookCover(book.id, dataUrl);
    book.coverUrl = dataUrl;
    book.coverVersion = coverVersion;
    this.saveLibrary();
    this._applyBookCoverToDom(book);
  }

  async loadBookCoversFromStorage(targetBooks = this.books) {
    const list = Array.isArray(targetBooks) ? targetBooks : (this.books || []);
    await Promise.all(list.map(async (b) => {
      if (!b?.id) return;
      const hasLiveCover = Boolean(b.coverUrl) && (!b.coverUrl.startsWith('blob:') || Boolean(b._objectCoverUrl));
      if (hasLiveCover) return;
      try {
        const cover = await getBookCover(b.id);
        if (cover) {
          if (cover instanceof Blob) {
            if (b._objectCoverUrl) URL.revokeObjectURL(b._objectCoverUrl);
            b._objectCoverUrl = URL.createObjectURL(cover);
            b.coverUrl = b._objectCoverUrl;
          } else if (typeof cover === 'string') {
            b.coverUrl = cover;
          }
          this._applyBookCoverToDom(b);
        }
      } catch (_) {}
    }));
  }

  async rehydrateLibraryFromStorage() {
    try {
      const stored = await getAllStoredBooksMetadata();
      if (!Array.isArray(stored) || stored.length === 0) return;

      let changed = false;
      for (const item of stored) {
        const bookId = item.bookId || item.id;
        if (!bookId) continue;
        const exists = this.books.some(b => b.id === bookId);
        if (!exists) {
          this.books.push({
            id: bookId,
            title: item.title || item.fileName || 'Imported Manga',
            type: item.type || (String(item.fileName).endsWith('.cbz') ? 'cbz' : 'pdf'),
            folderId: item.folderId || 'default',
            pageCount: item.pageCount || 1,
            currentPage: item.currentPage || 1,
            coverUrl: item.coverUrl || '',
            coverVersion: 1,
            bookmarks: [],
            updatedAt: item.updatedAt || Date.now()
          });
          changed = true;
        }
      }

      if (changed) {
        this.saveLibrary(true);
        if (this.activeMode === 'library') {
          this.render();
        }
      }
    } catch (err) {
      console.warn('[MangaView] Rehydrate library notice:', err);
    }
  }

  saveLibrary(immediate = false) {
    const doSave = () => {
      try {
        const meta = this.books.map(b => {
          // Do not persist large base64 or blob: URLs into localStorage
          const safeCover = (b.coverUrl && !b.coverUrl.startsWith('blob:') && b.coverUrl.length < 5000) ? b.coverUrl : '';
          return {
            id: b.id,
            title: b.title,
            type: b.type,
            folderId: b.folderId || 'default',
            pageCount: b.pageCount,
            currentPage: b.currentPage || 1,
            coverUrl: safeCover,
            coverVersion: b.coverVersion || 1,
            ocrCached: Boolean(b.ocrCached),
            ocrPageCount: Number(b.ocrPageCount || 0),
            bubbleDisplay: b.bubbleDisplay || 'show',
            bookmarks: Array.isArray(b.bookmarks) ? b.bookmarks : [],
            updatedAt: b.updatedAt || Date.now()
          };
        });
        try {
          localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify(meta));
        } catch (quotaErr) {
          if (quotaErr && (quotaErr.name === 'QuotaExceededError' || quotaErr.code === 22)) {
            // Omit heavy data URL covers to ensure vital book index, reading progress & bookmarks persist
            const safeMeta = meta.map(b => ({ ...b, coverUrl: '' }));
            localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify(safeMeta));
          } else {
            throw quotaErr;
          }
        }
      } catch (e) {
        console.warn('[MangaView] Failed to save library to storage:', e);
      }
    };

    if (immediate) {
      if (this._saveLibraryDebounceTimer) {
        clearTimeout(this._saveLibraryDebounceTimer);
        this._saveLibraryDebounceTimer = null;
      }
      doSave();
      return;
    }

    if (this._saveLibraryDebounceTimer) clearTimeout(this._saveLibraryDebounceTimer);
    this._saveLibraryDebounceTimer = setTimeout(() => {
      this._saveLibraryDebounceTimer = null;
      doSave();
    }, 400);
  }

  loadFolders() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_FOLDERS);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return [
      { id: 'default', name: 'Textbooks' },
      { id: 'manga', name: 'Manga & Comics' },
      { id: 'stories', name: 'Short Stories' }
    ];
  }

  saveFolders() {
    try {
      localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(this.folders));
    } catch (e) {
      console.warn('[MangaView] Failed to save folders:', e);
    }
  }

  async mount(container) {
    this.container = container;
    this.render();
    window.addEventListener('keydown', this.boundKeyHandler);
    window.addEventListener('keyup', this.boundKeyUpHandler);
    window.addEventListener('mousemove', this.boundMouseMoveHandler);
    window.addEventListener('mouseup', this.boundMouseUpHandler);
    window.addEventListener('pointermove', this.boundPointerMoveHandler);
    window.addEventListener('pointerup', this.boundPointerUpHandler);
    window.addEventListener('pointercancel', this.boundPointerCancelHandler);
    window.addEventListener('kiroku:pwa-manga-import', this.boundPwaMangaHandler);
    requestPersistentStorage().catch(() => {});
    this.rehydrateLibraryFromStorage().catch(() => {});
    this.checkSharedMangaPayload();
    this.resumePendingSync();
    this.fetchCloudBooks().catch(() => {});
  }

  onShow() {
    window.removeEventListener('keydown', this.boundKeyHandler);
    window.removeEventListener('keyup', this.boundKeyUpHandler);
    window.removeEventListener('mousemove', this.boundMouseMoveHandler);
    window.removeEventListener('mouseup', this.boundMouseUpHandler);
    window.removeEventListener('pointermove', this.boundPointerMoveHandler);
    window.removeEventListener('pointerup', this.boundPointerUpHandler);
    window.removeEventListener('pointercancel', this.boundPointerCancelHandler);

    window.addEventListener('keydown', this.boundKeyHandler);
    window.addEventListener('keyup', this.boundKeyUpHandler);
    window.addEventListener('mousemove', this.boundMouseMoveHandler);
    window.addEventListener('mouseup', this.boundMouseUpHandler);
    window.addEventListener('pointermove', this.boundPointerMoveHandler);
    window.addEventListener('pointerup', this.boundPointerUpHandler);
    window.addEventListener('pointercancel', this.boundPointerCancelHandler);
    this.checkSharedMangaPayload();
    this.fetchCloudBooks().catch(() => {});
    if (this.activeMode === 'reader' && this.currentBook) {
      this.renderCurrentPage();
    }
  }

  onHide() {
    this.closePopover();
    this.closeModal();
    if (this.isFullscreenFocus) {
      this.toggleFullscreenFocus(false);
    }
    if (this.activeMode === 'reader') {
      this.exitReaderToLibrary();
    }
    window.removeEventListener('keydown', this.boundKeyHandler);
    window.removeEventListener('keyup', this.boundKeyUpHandler);
    window.removeEventListener('mousemove', this.boundMouseMoveHandler);
    window.removeEventListener('mouseup', this.boundMouseUpHandler);
    window.removeEventListener('pointermove', this.boundPointerMoveHandler);
    window.removeEventListener('pointerup', this.boundPointerUpHandler);
    window.removeEventListener('pointercancel', this.boundPointerCancelHandler);
    if (this._panRafId) {
      cancelAnimationFrame(this._panRafId);
      this._panRafId = null;
    }
    if (this._detectTimeoutId) {
      clearTimeout(this._detectTimeoutId);
      this._detectTimeoutId = null;
    }
    const viewContainer = this.container?.closest('#view-container') || document.getElementById('view-container');
    if (viewContainer) {
      viewContainer.classList.remove('manga-reader-active');
    }
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('manga-reader-active');
      document.body.classList.remove('manga-fullscreen-active');
    }
  }

  unmount() {
    if (this.isFullscreenFocus) {
      this.toggleFullscreenFocus(false);
    }
    if (this._fullScreenCleanup) {
      this._fullScreenCleanup();
      this._fullScreenCleanup = null;
    }
    if (this._saveLibraryDebounceTimer) {
      clearTimeout(this._saveLibraryDebounceTimer);
      this._saveLibraryDebounceTimer = null;
    }
    if (this._panRafId) {
      cancelAnimationFrame(this._panRafId);
      this._panRafId = null;
    }
    if (this._detectTimeoutId) {
      clearTimeout(this._detectTimeoutId);
      this._detectTimeoutId = null;
    }
    window.removeEventListener('keydown', this.boundKeyHandler);
    window.removeEventListener('keyup', this.boundKeyUpHandler);
    window.removeEventListener('mousemove', this.boundMouseMoveHandler);
    window.removeEventListener('mouseup', this.boundMouseUpHandler);
    window.removeEventListener('pointermove', this.boundPointerMoveHandler);
    window.removeEventListener('pointerup', this.boundPointerUpHandler);
    window.removeEventListener('pointercancel', this.boundPointerCancelHandler);
    if (this.boundMouseBackHandler) {
      window.removeEventListener('mouseup', this.boundMouseBackHandler);
      window.removeEventListener('auxclick', this.boundMouseBackHandler);
      this.boundMouseBackHandler = null;
    }
    if (this.boundPopStateHandler) {
      window.removeEventListener('popstate', this.boundPopStateHandler);
      this.boundPopStateHandler = null;
    }
    window.removeEventListener('kiroku:pwa-manga-import', this.boundPwaMangaHandler);
    const viewContainer = this.container?.closest('#view-container') || document.getElementById('view-container');
    if (viewContainer) {
      viewContainer.classList.remove('manga-reader-active');
    }
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('manga-reader-active');
      document.body.classList.remove('manga-fullscreen-active');
    }
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }

  /**
   * Check for manga files received via PWA Web Share Target (POST /?action=share-target)
   * which are cached in CacheStorage by service-worker.js.
   */
  async checkSharedMangaPayload() {
    if (typeof window === 'undefined') return;

    // Check for share error in URL parameters
    try {
      const url = new URL(window.location.href);
      const shareErr = url.searchParams.get('share_error');
      if (shareErr) {
        this.showToast(`Import error: ${decodeURIComponent(shareErr)}`, 5000);
        url.searchParams.delete('share_error');
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
    } catch (_) {}

    if (!('caches' in window)) return;
    try {
      const cache = await caches.open('kiroku-shared-manga');
      const keys = await cache.keys();
      const filesToOpen = [];

      for (const req of keys) {
        const urlStr = req.url || '';
        if (urlStr.includes('/_shared_manga')) {
          const match = await cache.match(req);
          if (match) {
            await cache.delete(req);
            const blob = await match.blob();
            const rawFilename = match.headers.get('X-Manga-Filename');
            const filename = rawFilename ? decodeURIComponent(rawFilename) : 'shared_manga.pdf';
            let file;
            if (typeof File !== 'undefined') {
              file = new File([blob], filename, { type: blob.type || 'application/pdf' });
            } else {
              file = blob;
              file.name = filename;
            }
            filesToOpen.push(file);
          }
        }
      }

      if (filesToOpen.length > 0) {
        if (window.location.hash === '#manga-shared') {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        await this.openFiles(filesToOpen);
      }
    } catch (err) {
      console.warn('[MangaView] checkSharedMangaPayload error:', err);
      this.showToast(`Failed to open shared manga file: ${err?.message || err}`, 5000);
    }
  }

  render() {
    if (!this.container) return;
    if (this.activeMode === 'library') {
      this.renderLibraryView();
    } else {
      this.renderReaderView();
    }
  }

  /* -------------------------------------------------------------------------
   * Library / Bookshelf View with Folders & Management
   * ------------------------------------------------------------------------- */
  renderLibraryView() {
    const viewContainer = this.container?.closest('#view-container') || document.getElementById('view-container');
    if (viewContainer) {
      viewContainer.classList.remove('manga-reader-active');
    }
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('manga-reader-active');
      document.body.classList.remove('manga-fullscreen-active');
    }

    let activeBooks = this.activeFolderId === 'all'
      ? this.books
      : this.books.filter(b => (b.folderId || 'default') === this.activeFolderId);

    // Natural alphanumerical sort by title so Volume 1 comes before Volume 15
    activeBooks = [...activeBooks].sort((a, b) => {
      const tA = a.title || a.filename || '';
      const tB = b.title || b.filename || '';
      return tA.localeCompare(tB, undefined, { numeric: true, sensitivity: 'base' });
    });

    const allCount = this.books.length;
    const folderPills = [
      { id: 'all', name: 'All Books', count: allCount },
      ...this.folders.map(f => ({
        id: f.id,
        name: f.name,
        count: this.books.filter(b => (b.folderId || 'default') === f.id).length
      }))
    ].map(f => `
      <div class="manga-folder-pill ${this.activeFolderId === f.id ? 'is-active' : ''}" data-folder-id="${escapeHtml(f.id)}">
        <span class="manga-folder-name">${escapeHtml(f.name)}</span>
        <span class="manga-folder-count">(${f.count})</span>
        ${f.id !== 'all' ? `
          <button type="button" class="manga-folder-action-btn btn-folder-rename" data-folder-id="${escapeHtml(f.id)}" title="Rename Folder">
            <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button type="button" class="manga-folder-action-btn btn-folder-delete" data-folder-id="${escapeHtml(f.id)}" title="Delete Folder">
            <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        ` : ''}
      </div>
    `).join('');

    const bookCards = activeBooks.map(b => {
      const percent = b.pageCount > 0 ? Math.round((b.currentPage / b.pageCount) * 100) : 0;
      const bookmarks = Array.isArray(b.bookmarks) ? b.bookmarks : [];
      const latestBookmark = bookmarks.length > 0 ? bookmarks[bookmarks.length - 1] : null;
      const isCloudOnly = Boolean(b.isCloudOnly);
      return `
        <div class="manga-book-card ${isCloudOnly ? 'is-cloud-only' : ''}" data-book-id="${escapeHtml(b.id)}">
          <div class="manga-book-cover-wrap">
            ${b.coverUrl
              ? `<img src="${b.coverUrl}" class="manga-book-cover-img ${isCloudOnly ? 'manga-book-cover-grayscale' : ''}" alt="${escapeHtml(b.title)}">`
              : `<div class="manga-book-cover-placeholder manga-book-cover-grey-cloud">
                   <div class="manga-grey-cloud-icon">
                     <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                       <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
                     </svg>
                   </div>
                   <div class="manga-grey-cloud-title">${escapeHtml(b.title)}</div>
                   <div class="manga-grey-cloud-type">${escapeHtml((b.type || 'PDF').toUpperCase())}</div>
                 </div>`}
            ${isCloudOnly ? `
              <div class="manga-book-cloud-badge" title="Stored in Cloud (Tap to open or download)">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
                </svg>
                <span>Cloud</span>
              </div>
            ` : (b.syncedAt ? `
              <div class="manga-book-synced-badge" title="Synced to Cloud">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 17l-3.5-3.5 1.41-1.41L10 14.17l5.09-5.09L16.5 10.5 10 17z"/>
                </svg>
              </div>
            ` : '')}
            ${b.ocrCached ? `
              <div class="manga-book-ocr-badge" title="OCR Pre-baked & Ready">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
                </svg>
                OCR
              </div>
            ` : ''}
            <button type="button" class="manga-card-bookmark-btn ${latestBookmark ? 'has-bookmark is-active' : ''}" data-book-id="${escapeHtml(b.id)}" title="${latestBookmark ? `Jump to Bookmark (Page ${latestBookmark.page})` : `Resume from Page ${b.currentPage || 1}`}">
              <svg class="manga-bookmark-svg" viewBox="0 0 24 24" width="15" height="15">
                <path class="manga-bookmark-ribbon" d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            <div class="manga-book-progress-badge">${percent}%</div>
          </div>
          <div class="manga-book-info">
            <div class="manga-book-title-row">
              <div class="manga-book-title" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</div>
              <button type="button" class="manga-book-more-btn" data-book-id="${escapeHtml(b.id)}" title="Book Options">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
              </button>
            </div>
            <div class="manga-book-meta">Page ${b.currentPage || 1} of ${b.pageCount || '?'}</div>
          </div>
        </div>
      `;
    }).join('');

    // Dropzone card inside grid
    const dropzoneCard = `
      <div class="manga-library-dropzone-card" id="manga-library-dropzone" role="button" tabindex="0" title="Tap to select from device or drop files">
        <div class="manga-dropzone-label cursor-pointer">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" class="manga-dropzone-icon">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
          </svg>
          <div class="text-xs font-bold mt-2 text-center text-warm-paper">Upload Manga / PDF</div>
          <div class="text-xs text-muted text-center mt-1">Tap to select or drop files (PDF, CBZ, ZIP)</div>
        </div>
        <input type="file" id="manga-library-file-input" class="manga-file-input-hidden" accept=".pdf,.cbz,.zip,.cbr,application/pdf,application/zip,application/x-zip-compressed,application/x-cbz,application/x-cbr,application/octet-stream,image/*" multiple />
      </div>
    `;

    this.container.innerHTML = `
      <div class="manga-viewer-container">
        <div class="manga-header-row grammar-header-row">
          <div class="grammar-brand-header" aria-label="Manga マンガ">
            <h1 class="grammar-word-title">
              <span class="hero-letter">M</span><span class="hero-letter">A</span><span class="hero-letter">N</span><span class="hero-letter">G</span><span class="hero-letter">A</span>
            </h1>
            <span class="grammar-word-kanji">
              <span class="hero-letter">マ</span><span class="hero-letter">ン</span><span class="hero-letter">ガ</span>
            </span>
          </div>
          <div class="manga-toolbar">
            <button type="button" class="tactile-btn ${this.autoFolderZip ? 'tactile-btn-gold' : 'tactile-btn-ghost'} tactile-btn-sm" id="btn-toggle-auto-folder-zip" title="Auto-create folder for ZIP archives containing multiple volumes">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
              </svg>
              <span id="label-toggle-auto-folder-zip">Auto-folder ZIPs: ${this.autoFolderZip ? 'ON' : 'OFF'}</span>
            </button>
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-add-folder" title="Create New Folder">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10zm-7-1h2v-3h3v-2h-3V9h-2v3h-3v2h3z"/></svg>
              <span>New Folder</span>
            </button>
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-receive-from-pc" title="Receive Manga from PC over local Wi-Fi">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
              </svg>
              <span>Receive from PC</span>
            </button>
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm ${this.isSyncing ? 'is-syncing' : ''}" id="btn-manga-sync-all" title="Sync all manga, folders, bookmarks & annotations to cloud">
              <svg class="manga-sync-icon ${this.isSyncing ? 'is-spinning' : ''}" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
              </svg>
              <span id="label-manga-sync">${this.isSyncing ? `Syncing (${this.syncProgress.completed}/${this.syncProgress.total})` : (this.syncStatus === 'synced' ? 'Synced' : 'Sync Cloud')}</span>
            </button>
            <button type="button" class="tactile-btn tactile-btn-primary tactile-btn-sm cursor-pointer manga-add-btn" id="btn-add-manga" title="Upload manga or PDF from this device">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              <span>Upload Manga</span>
            </button>
          </div>
        </div>

        <div class="manga-library-stage">
          <!-- Folder Filter Strip -->
          <div class="manga-folders-strip" id="manga-folders-strip">
            ${folderPills}
          </div>

          <!-- Bookshelf Grid: Real Books + Compact Dropzone on the Right -->
          <div class="manga-bookshelf-section mt-2">
            <div class="manga-section-title">
              <span>Books</span>
              <span class="manga-book-count">(${activeBooks.length})</span>
            </div>
            <div class="manga-bookshelf-grid">
              ${bookCards}
              ${dropzoneCard}
            </div>
          </div>
        </div>

        <!-- Custom Tactile Modal Host -->
        <div id="manga-modal-host" style="display: none;"></div>

        <!-- Pacman Loading Overlay -->
        <div class="manga-loading-overlay" id="manga-loading-overlay" style="display: none;">
          <div class="manga-loading-card">
            <div class="manga-loading-pacman-wrap">
              ${PACMAN_LOADING_SVG}
            </div>
            <div class="manga-loading-text" id="manga-loading-status-text">Loading manga volume...</div>
            <div class="manga-loading-subtext" id="manga-loading-subtext">Reading pages into memory</div>
          </div>
        </div>
      </div>
    `;

    this.setupLibraryEvents();
    this.refreshLibraryCoversIfNeeded();

    if (this.bakeModalMinimized && this.isBakingOcr) {
      const activeBook = this.books.find(b => b.id === this.activeBakeBookId);
      this.renderBakeTopBar(activeBook);
    }
  }

  setupLibraryEvents() {
    const btnSyncAll = this.container.querySelector('#btn-manga-sync-all');
    btnSyncAll?.addEventListener('click', async (e) => {
      e.preventDefault();
      if (this.isSyncing) {
        this.cancelSync();
        return;
      }
      await this.syncAllToCloud();
    });

    const btnToggleZip = this.container.querySelector('#btn-toggle-auto-folder-zip');
    btnToggleZip?.addEventListener('click', () => {
      this.autoFolderZip = !this.autoFolderZip;
      localStorage.setItem(STORAGE_KEY_AUTO_FOLDER_ZIP, this.autoFolderZip ? 'true' : 'false');
      this.render();
    });

    const fileInput = this.container.querySelector('#manga-library-file-input');
    fileInput?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        await this.openFiles(files);
        fileInput.value = '';
      }
    });

    const btnAddManga = this.container.querySelector('#btn-add-manga');
    btnAddManga?.addEventListener('click', (e) => {
      e.preventDefault();
      fileInput?.click();
    });

    const dropzone = this.container.querySelector('#manga-library-dropzone');
    dropzone?.addEventListener('click', (e) => {
      if (e.target !== fileInput) {
        fileInput?.click();
      }
    });
    dropzone?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput?.click();
      }
    });
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    });
    dropzone?.addEventListener('dragleave', () => {
      dropzone.classList.remove('is-dragover');
    });
    dropzone?.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('is-dragover');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0) await this.openFiles(files);
    });

    // Whole view drop listener: dropping anywhere in Manga view opens the file safely
    this.container.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    this.container.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0) await this.openFiles(files);
    });

    // Folder navigation & actions
    const foldersStrip = this.container.querySelector('#manga-folders-strip');
    foldersStrip?.addEventListener('click', (e) => {
      const renameBtn = e.target.closest('.btn-folder-rename');
      if (renameBtn && renameBtn.dataset.folderId) {
        e.stopPropagation();
        this.openRenameFolderModal(renameBtn.dataset.folderId);
        return;
      }

      const deleteBtn = e.target.closest('.btn-folder-delete');
      if (deleteBtn && deleteBtn.dataset.folderId) {
        e.stopPropagation();
        this.handleDeleteFolder(deleteBtn.dataset.folderId);
        return;
      }

      const pill = e.target.closest('.manga-folder-pill');
      if (pill && pill.dataset.folderId) {
        this.activeFolderId = pill.dataset.folderId;
        this.render();
      }
    });

    // Create New Folder
    const btnAddFolder = this.container.querySelector('#btn-add-folder');
    btnAddFolder?.addEventListener('click', () => {
      this.openCreateFolderModal();
    });

    // Receive from PC over Wi-Fi
    const btnReceiveFromPc = this.container.querySelector('#btn-receive-from-pc');
    btnReceiveFromPc?.addEventListener('click', () => {
      this.openReceiveFromPcModal();
    });

    // Bookshelf card clicks and book options
    const grid = this.container.querySelector('.manga-bookshelf-grid');
    grid?.addEventListener('click', async (e) => {
      const bookmarkBtn = e.target.closest('.manga-card-bookmark-btn');
      if (bookmarkBtn && bookmarkBtn.dataset.bookId) {
        e.stopPropagation();
        const bookId = bookmarkBtn.dataset.bookId;
        const book = this.books.find(b => b.id === bookId);
        const bookmarks = Array.isArray(book?.bookmarks) ? book.bookmarks : [];
        const targetPage = bookmarks.length > 0
          ? bookmarks[bookmarks.length - 1].page
          : (book?.currentPage || 1);
        await this.loadAndOpenBook(bookId, targetPage);
        return;
      }

      const moreBtn = e.target.closest('.manga-book-more-btn');
      if (moreBtn && moreBtn.dataset.bookId) {
        e.stopPropagation();
        this.openBookMenuModal(moreBtn.dataset.bookId);
        return;
      }

      const card = e.target.closest('.manga-book-card');
      if (card && card.dataset.bookId) {
        await this.loadAndOpenBook(card.dataset.bookId);
      }
    });
  }

  /* -------------------------------------------------------------------------
   * Tactile Modal Dialogs (Pure DOM, zero window.prompt issues)
   * ------------------------------------------------------------------------- */
  openCreateFolderModal() {
    this.showModal(`
      <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
        <div class="tactile-modal-card">
          <h3 class="text-base font-bold text-warm-paper">New Study Folder</h3>
          <p class="text-xs text-muted mt-1">Organize your textbooks, manga series, and readers.</p>
          <div class="mt-3">
            <input type="text" id="modal-folder-name" class="tactile-input-text w-full" placeholder="e.g. Genki Study, JLPT N3, Shonen Jump" autofocus />
          </div>
          <div class="modal-actions-row mt-4">
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-modal-cancel">Cancel</button>
            <button type="button" class="tactile-btn tactile-btn-primary tactile-btn-sm" id="btn-modal-save">Create</button>
          </div>
        </div>
      </div>
    `, () => {
      const saveBtn = this.container.querySelector('#btn-modal-save');
      const input = this.container.querySelector('#modal-folder-name');
      const doSave = () => {
        const name = input?.value?.trim();
        if (name) {
          const newFolder = { id: 'folder_' + Date.now(), name };
          this.folders.push(newFolder);
          this.saveFolders();
          this.activeFolderId = newFolder.id;
          this.closeModal();
          this.render();
        }
      };
      saveBtn?.addEventListener('click', doSave);
      input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
    });
  }

  openRenameFolderModal(folderId) {
    const folder = this.folders.find(f => f.id === folderId);
    if (!folder) return;

    this.showModal(`
      <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
        <div class="tactile-modal-card">
          <h3 class="text-base font-bold text-warm-paper">Rename Folder</h3>
          <div class="mt-3">
            <input type="text" id="modal-rename-input" class="tactile-input-text w-full" value="${escapeHtml(folder.name)}" autofocus />
          </div>
          <div class="modal-actions-row mt-4">
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-modal-cancel">Cancel</button>
            <button type="button" class="tactile-btn tactile-btn-gold tactile-btn-sm" id="btn-modal-save">Rename</button>
          </div>
        </div>
      </div>
    `, () => {
      const saveBtn = this.container.querySelector('#btn-modal-save');
      const input = this.container.querySelector('#modal-rename-input');
      const doSave = () => {
        const name = input?.value?.trim();
        if (name) {
          folder.name = name;
          this.saveFolders();
          this.closeModal();
          this.render();
        }
      };
      saveBtn?.addEventListener('click', doSave);
      input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
    });
  }

  handleDeleteFolder(folderId) {
    const folder = this.folders.find(f => f.id === folderId);
    if (!folder) return;

    const booksInFolder = this.books.filter(b => (b.folderId || 'default') === folderId);

    // If folder has books, confirm with user
    if (booksInFolder.length > 0) {
      this.showModal(`
        <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
          <div class="tactile-modal-card">
            <h3 class="text-base font-bold text-warm-paper">Delete "${escapeHtml(folder.name)}"?</h3>
            <p class="text-xs text-muted mt-2">
              This folder contains <strong>${booksInFolder.length}</strong> book(s). Deleting the folder will move them to All Books.
            </p>
            <div class="modal-actions-row mt-4">
              <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-modal-cancel">Cancel</button>
              <button type="button" class="tactile-btn tactile-btn-primary tactile-btn-sm" id="btn-modal-confirm-delete">Delete Folder</button>
            </div>
          </div>
        </div>
      `, () => {
        this.container.querySelector('#btn-modal-confirm-delete')?.addEventListener('click', () => {
          booksInFolder.forEach(b => { b.folderId = 'default'; });
          this.folders = this.folders.filter(f => f.id !== folderId);
          this.saveFolders();
          this.saveLibrary();
          if (this.activeFolderId === folderId) this.activeFolderId = 'all';
          this.closeModal();
          this.render();
        });
      });
    } else {
      // Empty folder: instant 1-click delete
      this.folders = this.folders.filter(f => f.id !== folderId);
      this.saveFolders();
      if (this.activeFolderId === folderId) this.activeFolderId = 'all';
      this.render();
    }
  }

  openBookMenuModal(bookId) {
    const book = this.books.find(b => b.id === bookId);
    if (!book) return;

    const folderOptions = this.folders.map(f => `
      <option value="${escapeHtml(f.id)}" ${(book.folderId || 'default') === f.id ? 'selected' : ''}>
        ${escapeHtml(f.name)}
      </option>
    `).join('');

    let prebakeLabel = 'Pre-bake OCR';
    if (this.isBakingOcr && this.activeBakeBookId === book.id) {
      prebakeLabel = 'Baking in Progress...';
    } else if (book.ocrPageCount && book.ocrPageCount > 0 && book.ocrPageCount < (book.pageCount || book.totalPages || 1)) {
      prebakeLabel = `Resume OCR (${book.ocrPageCount}/${book.pageCount || book.totalPages || 1})`;
    } else if (book.ocrCached) {
      prebakeLabel = 'Re-bake OCR';
    }

    this.showModal(`
      <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
        <div class="tactile-modal-card" style="max-width: 460px;">
          <h3 class="text-base font-bold text-warm-paper mb-3">Book Options</h3>
          <div class="flex flex-col gap-3">
            <div>
              <label class="text-xs text-muted font-bold block mb-1">Title</label>
              <input type="text" id="modal-book-title" class="tactile-input-text w-full" value="${escapeHtml(book.title)}" />
            </div>
            <div>
              <label class="text-xs text-muted font-bold block mb-1">Move to Folder</label>
              <select id="modal-book-folder" class="tactile-select w-full">
                ${folderOptions}
              </select>
            </div>
            <div class="pt-3 border-t border-tactile">
              <label class="text-xs text-muted font-bold block mb-2">Cloud & Mobile Sync</label>
              <div class="grid grid-cols-2 gap-2">
                <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm justify-center w-full" id="btn-modal-sync-book" title="Sync this manga and reading progress to cloud">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" class="inline-block mr-1">
                    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
                  </svg>
                  <span id="label-modal-sync-book">${book.syncedAt ? 'Re-sync Cloud' : 'Sync to Cloud'}</span>
                </button>
                <button type="button" class="tactile-btn tactile-btn-primary tactile-btn-sm justify-center w-full" id="btn-modal-send-to-phone">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" class="inline-block mr-1">
                    <path d="M16 1H8C6.34 1 5 2.34 5 4v16c0 1.66 1.34 3 3 3h8c1.66 0 3-1.34 3-3V4c0-1.66-1.34-3-3-3zm-2 20h-4v-1h4v1zm3.25-3H6.75V4h10.5v14z"/>
                  </svg>
                  <span>Send to Phone</span>
                </button>
                <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm text-gold justify-center w-full" id="btn-modal-prebake-ocr" title="Pre-bake speech bubbles and text on PC for instant 0ms reading on mobile">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" class="inline-block mr-1">
                    <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
                  </svg>
                  <span id="label-modal-prebake-ocr">${prebakeLabel}</span>
                </button>
                ${book.ocrCached || (book.ocrPageCount && book.ocrPageCount > 0) ? `
                  <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm text-muted justify-center w-full" id="btn-modal-flush-ocr" title="Flush cached OCR from local and cloud">
                    Flush OCR (${book.ocrPageCount || 0}p)
                  </button>
                ` : `<div class="hidden"></div>`}
              </div>
              ${this.isBakingOcr ? `
                <div class="manga-ocr-active-banner">
                  <span class="manga-ocr-pulse-dot"></span>
                  <span>OCR background job active (${this.activeBakeBookId === bookId ? 'this book' : 'another volume'})</span>
                </div>
              ` : ''}
            </div>
          </div>
          <div class="modal-actions-row mt-4 pt-3 border-t border-tactile justify-between">
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm text-red" id="btn-modal-delete-book">Remove Book</button>
            <div class="flex items-center gap-2">
              <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-modal-cancel">Cancel</button>
              <button type="button" class="tactile-btn tactile-btn-gold tactile-btn-sm" id="btn-modal-save-book">Save</button>
            </div>
          </div>
        </div>
      </div>
    `, () => {
      this.container.querySelector('#btn-modal-sync-book')?.addEventListener('click', async () => {
        const syncBtn = this.container.querySelector('#btn-modal-sync-book');
        const syncLabel = this.container.querySelector('#label-modal-sync-book');
        if (syncBtn) syncBtn.disabled = true;
        if (syncLabel) syncLabel.textContent = 'Syncing...';
        const ok = await this.syncSingleBookToCloud(bookId);
        if (syncLabel) syncLabel.textContent = ok ? 'Synced!' : 'Sync Failed';
        setTimeout(() => {
          this.closeModal();
          this.render();
        }, 700);
      });

      this.container.querySelector('#btn-modal-send-to-phone')?.addEventListener('click', () => {
        this.closeModal();
        this.openSendToPhoneModal(bookId);
      });

      this.container.querySelector('#btn-modal-prebake-ocr')?.addEventListener('click', () => {
        this.closeModal();
        if (this.isBakingOcr) {
          if (this.activeBakeBookId === bookId) {
            this.showBakeProgressModal(bookId);
            return;
          }
          this.showModal(`
            <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
              <div class="tactile-modal-card" style="max-width: 380px;">
                <h3 class="text-base font-bold text-warm-paper">OCR Job Active</h3>
                <p class="text-xs text-muted mt-2">Another OCR job is currently running in the background. Please stop the active job before starting a new one.</p>
                <div class="modal-actions-row mt-4 justify-end">
                  <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-modal-close-alert">OK</button>
                </div>
              </div>
            </div>
          `, () => {
            this.container.querySelector('#btn-modal-close-alert')?.addEventListener('click', () => this.closeModal());
          });
          return;
        }
        this.prebakeBookOcr(bookId);
      });

      this.container.querySelector('#btn-modal-flush-ocr')?.addEventListener('click', () => {
        this.flushBookOcr(bookId);
      });

      this.container.querySelector('#btn-modal-save-book')?.addEventListener('click', () => {
        const titleInput = this.container.querySelector('#modal-book-title');
        const folderSelect = this.container.querySelector('#modal-book-folder');
        if (titleInput?.value?.trim()) {
          book.title = titleInput.value.trim();
        }
        if (folderSelect) {
          book.folderId = folderSelect.value;
        }
        this.saveLibrary();
        this.closeModal();
        this.render();
      });

      this.container.querySelector('#btn-modal-delete-book')?.addEventListener('click', async () => {
        this.books = this.books.filter(b => b.id !== bookId);
        await deleteBookFile(bookId);
        await deleteBookCover(bookId);
        this.saveLibrary();
        this.closeModal();
        this.render();
      });
    });
  }

  async showModal(html, onMount) {
    const host = this.container?.querySelector('#manga-modal-host');
    if (!host) return;
    host.innerHTML = html;
    host.style.display = 'block';

    const cancelBtn = host.querySelector('#btn-modal-cancel');
    cancelBtn?.addEventListener('click', () => this.closeModal());

    const backdrop = host.querySelector('#manga-modal-backdrop');
    backdrop?.addEventListener('click', (e) => {
      if (e.target === backdrop) this.closeModal();
    });

    if (onMount) {
      return await onMount();
    }
  }

  closeModal() {
    const host = this.container?.querySelector('#manga-modal-host');
    if (host) {
      host.innerHTML = '';
      host.style.display = 'none';
    }
  }

  showConfirmModal({ title = 'Confirm Action', message = 'Are you sure?', confirmText = 'Confirm', cancelText = 'Cancel', isDanger = false } = {}) {
    return new Promise((resolve) => {
      this.showModal(`
        <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
          <div class="tactile-modal-card" style="max-width: 380px;">
            <h3 class="text-base font-bold text-warm-paper">${escapeHtml(title)}</h3>
            <p class="text-xs text-muted mt-2">${escapeHtml(message)}</p>
            <div class="modal-actions-row mt-4 flex justify-end gap-2">
              <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-modal-cancel">${escapeHtml(cancelText)}</button>
              <button type="button" class="tactile-btn ${isDanger ? 'tactile-btn-primary' : 'tactile-btn-secondary'} tactile-btn-sm" id="btn-modal-confirm">${escapeHtml(confirmText)}</button>
            </div>
          </div>
        </div>
      `, () => {
        const host = this.container?.querySelector('#manga-modal-host');
        const confirmBtn = host?.querySelector('#btn-modal-confirm');
        const cancelBtn = host?.querySelector('#btn-modal-cancel');
        confirmBtn?.addEventListener('click', () => {
          this.closeModal();
          resolve(true);
        });
        cancelBtn?.addEventListener('click', () => {
          this.closeModal();
          resolve(false);
        });
      });
    });
  }

  async openSendToPhoneModal(bookId) {
    const book = this.books.find(b => b.id === bookId);
    if (!book) return;

    return await this.showModal(`
      <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
        <div class="tactile-modal-card text-center" style="max-width: 360px;">
          <h3 class="text-base font-bold text-warm-paper">Send to Phone</h3>
          <p class="text-xs text-muted mt-1">Generating direct Wi-Fi transfer ticket for <strong>${escapeHtml(book.title)}</strong>...</p>
          <div class="manga-qr-container my-3 p-3 bg-surface-lowest border border-tactile rounded flex justify-center items-center" id="manga-qr-target" style="min-height: 220px;">
            <span class="text-xs text-muted font-mono">Generating QR code...</span>
          </div>
          <div class="modal-actions-row mt-4 justify-end">
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-modal-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `, async () => {
      try {
        let streamUrl = '';
        let ticket = '';
        const isRemoteWeb = typeof window !== 'undefined' &&
          window.location &&
          typeof window.location.protocol === 'string' &&
          window.location.protocol.startsWith('http') &&
          window.location.origin &&
          window.location.hostname !== 'localhost' &&
          window.location.hostname !== '127.0.0.1';
        try {
          if (!isRemoteWeb) {
            const info = (this.apiClient && typeof this.apiClient.getBackendInfo === 'function')
              ? await this.apiClient.getBackendInfo()
              : { host: '127.0.0.1', port: 21828 };
            const host = info?.host || '127.0.0.1';
            const port = info?.port || 21828;
            const bookBuf = await getBookFileBuffer(bookId);

            if (bookBuf) {
              try {
                const uploadUrl = `http://${host}:${port}/api/manga/upload?book_id=${encodeURIComponent(bookId)}&filename=${encodeURIComponent(book.filename || book.title || 'manga.pdf')}&title=${encodeURIComponent(book.title || 'Manga')}`;
                await fetch(uploadUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/octet-stream' },
                  body: bookBuf
                });
              } catch (upErr) {
                console.warn('[Manga] Could not pre-upload buffer to backend:', upErr);
              }
            }
          }

          const res = await this.apiClient.request('/api/manga/ticket', {
            method: 'POST',
            body: { book_id: bookId }
          });
          ticket = res?.data?.ticket || res?.ticket || '';
          streamUrl = res?.data?.stream_url || res?.stream_url || '';
        } catch (ticketErr) {
          console.warn('[Manga] Could not issue companion ticket:', ticketErr);
        }

        if (!streamUrl) {
          let lanBase = '';
          try {
            const lanInfo = await this.apiClient.request('/api/manga/lan-info');
            lanBase = lanInfo?.base_url || '';
          } catch (_) {}
          if (!lanBase) {
            if (isRemoteWeb) {
              lanBase = window.location.origin;
            } else {
              const info = await this.apiClient.getBackendInfo();
              lanBase = `http://${info?.host || '127.0.0.1'}:${info?.port || 21828}`;
            }
          }
          streamUrl = `${lanBase}/api/manga/stream/${encodeURIComponent(bookId)}?ticket=${ticket || 'preview_ticket'}`;
        }

        const qrSvg = await fetchOrGenerateQrSvg(streamUrl, this.apiClient);
        const qrTarget = this.container?.querySelector('#manga-qr-target');
        if (qrTarget) {
          qrTarget.innerHTML = qrSvg;
        }

        const modalDesc = this.container?.querySelector('.tactile-modal-card p');
        if (modalDesc) {
          modalDesc.innerHTML = `Scan with your phone camera or inside Kiroku PWA to download <strong>${escapeHtml(book.title)}</strong> directly over local Wi-Fi.`;
        }

        const actionsRow = this.container?.querySelector('.modal-actions-row');
        if (actionsRow) {
          actionsRow.innerHTML = `
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-copy-stream-url">Copy Link</button>
            <button type="button" class="tactile-btn tactile-btn-primary tactile-btn-sm" id="btn-modal-done">Done</button>
          `;
          actionsRow.querySelector('#btn-copy-stream-url')?.addEventListener('click', async (e) => {
            const btn = e.target;
            try {
              if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(streamUrl);
              }
              const prev = btn.textContent;
              btn.textContent = 'Copied!';
              setTimeout(() => { btn.textContent = prev; }, 1500);
            } catch (err) {
              console.warn('[Manga] Copy link failed:', err);
            }
          });
          actionsRow.querySelector('#btn-modal-done')?.addEventListener('click', () => {
            this.closeModal();
          });
        }
      } catch (err) {
        console.warn('[Manga] Send to phone error:', err);
      }
    });
  }

  openReceiveFromPcModal() {
    this.showModal(`
      <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
        <div class="tactile-modal-card" style="max-width: 420px;">
          <h3 class="text-base font-bold text-warm-paper">Receive Manga from PC</h3>
          <p class="text-xs text-muted mt-1">Paste the transfer URL from your desktop companion to stream directly into phone storage (OPFS).</p>
          <div class="mt-3">
            <label class="text-xs text-muted block mb-1">Transfer URL</label>
            <input type="text" id="manga-receive-url-input" class="tactile-input-text font-mono text-xs w-full" placeholder="http://192.168.1.X:8000/api/manga/stream/... ?ticket=..." autofocus />
          </div>
          <div class="mt-3" id="manga-receive-progress-container" style="display: none;">
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="text-muted" id="manga-receive-status-label">Downloading stream...</span>
              <span class="font-mono text-gold" id="manga-receive-percent-label">0%</span>
            </div>
            <div class="w-full bg-surface-lowest border border-tactile rounded h-2 overflow-hidden">
              <div class="bg-gold h-full transition-all" id="manga-receive-progress-bar" style="width: 0%;"></div>
            </div>
          </div>
          <div class="modal-actions-row mt-4 justify-between">
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-modal-cancel">Cancel</button>
            <button type="button" class="tactile-btn tactile-btn-primary tactile-btn-sm" id="btn-start-receive">Download to OPFS</button>
          </div>
        </div>
      </div>
    `, () => {
      const startBtn = this.container?.querySelector('#btn-start-receive');
      const input = this.container?.querySelector('#manga-receive-url-input');
      const progressContainer = this.container?.querySelector('#manga-receive-progress-container');
      const progressBar = this.container?.querySelector('#manga-receive-progress-bar');
      const percentLabel = this.container?.querySelector('#manga-receive-percent-label');
      const statusLabel = this.container?.querySelector('#manga-receive-status-label');

      startBtn?.addEventListener('click', async () => {
        const rawUrl = input?.value?.trim();
        if (!rawUrl) return;

        startBtn.disabled = true;
        startBtn.textContent = 'Connecting...';
        if (progressContainer) progressContainer.style.display = 'block';

        try {
          const resp = await fetch(rawUrl);
          if (!resp.ok) {
            throw new Error(`Transfer failed: HTTP ${resp.status}`);
          }

          const contentLength = Number(resp.headers.get('content-length') || 0);
          const reader = resp.body?.getReader();
          const chunks = [];
          let received = 0;

          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              received += value.length;
              if (contentLength > 0 && progressBar && percentLabel) {
                const pct = Math.min(100, Math.round((received / contentLength) * 100));
                progressBar.style.width = `${pct}%`;
                percentLabel.textContent = `${pct}%`;
              }
            }
          } else {
            const buf = await resp.arrayBuffer();
            chunks.push(new Uint8Array(buf));
            received = buf.byteLength;
          }

          if (statusLabel) statusLabel.textContent = 'Saving to OPFS storage...';

          let bookId = 'stream_' + Date.now();
          let title = 'Streamed Manga';
          try {
            const parsed = new URL(rawUrl);
            const segments = parsed.pathname.split('/').filter(Boolean);
            const lastSeg = segments[segments.length - 1];
            if (lastSeg) {
              bookId = decodeURIComponent(lastSeg);
              title = bookId.replace(/\.(pdf|cbz|zip)$/i, '');
            }
          } catch {}

          const blob = new Blob(chunks, { type: 'application/octet-stream' });
          const isPdf = rawUrl.toLowerCase().includes('.pdf') || (resp.headers.get('content-type') || '').includes('pdf');
          const bookType = isPdf ? 'pdf' : 'cbz';

          await storeBookFile(bookId, blob, { title, type: bookType });

          const existing = this.books.find(b => b.id === bookId);
          if (existing) {
            existing.updatedAt = Date.now();
          } else {
            this.books.push({
              id: bookId,
              title: title,
              type: bookType,
              folderId: this.activeFolderId === 'all' ? 'default' : this.activeFolderId,
              pageCount: 1,
              currentPage: 1,
              coverUrl: '',
              coverVersion: 1,
              updatedAt: Date.now()
            });
          }
          this.saveLibrary();

          this.closeModal();
          this.render();
        } catch (err) {
          console.warn('[Manga] Receive stream error:', err);
          if (statusLabel) statusLabel.textContent = `Error: ${err.message}`;
          startBtn.disabled = false;
          startBtn.textContent = 'Retry';
        }
      });
    });
  }

  showLoading(title = 'Loading volume...', subtext = 'Please wait a moment') {
    const overlay = this.container?.querySelector('#manga-loading-overlay');
    if (!overlay) return;
    const titleEl = overlay.querySelector('#manga-loading-status-text');
    const subtextEl = overlay.querySelector('#manga-loading-subtext');
    if (titleEl) titleEl.textContent = title;
    if (subtextEl) subtextEl.textContent = subtext;
    overlay.style.display = 'flex';
  }

  updateLoadingStatus(title, subtext) {
    const overlay = this.container?.querySelector('#manga-loading-overlay');
    if (!overlay) return;
    const titleEl = overlay.querySelector('#manga-loading-status-text');
    const subtextEl = overlay.querySelector('#manga-loading-subtext');
    if (titleEl && title) titleEl.textContent = title;
    if (subtextEl && subtext !== undefined) subtextEl.textContent = subtext;
  }

  hideLoading() {
    const overlay = this.container?.querySelector('#manga-loading-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  async refreshLibraryCoversIfNeeded() {
    if (this._coversLoadPromise) {
      try {
        await this._coversLoadPromise;
      } catch (_) {}
    }
    const outdatedBooks = this.books.filter(b => !b.isCloudOnly && (!b.coverUrl || (b.coverVersion || 0) < 2));
    if (outdatedBooks.length === 0) return;

    for (const book of outdatedBooks) {
      try {
        const buffer = await getBookFileBuffer(book.id);
        if (!buffer) continue;

        if (book.type === 'pdf') {
          ensurePdfWorker();
          if (typeof window.pdfjsLib === 'undefined') continue;
          const loadingTask = window.pdfjsLib.getDocument({ data: buffer });
          const doc = await loadingTask.promise;
          const page1 = await doc.getPage(1);
          const vp = page1.getViewport({ scale: 1.0 });
          const targetWidth = 720;
          const scale = Math.max(1.5, targetWidth / vp.width);
          const scaledVp = page1.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(scaledVp.width);
          canvas.height = Math.round(scaledVp.height);
          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          await page1.render({ canvasContext: ctx, viewport: scaledVp }).promise;

          await this._persistGeneratedCover(book, canvas, 2);
        } else if (book.type === 'cbz') {
          if (typeof window.JSZip === 'undefined') continue;
          const zip = new window.JSZip();
          const cbzZip = await zip.loadAsync(buffer);
          const validExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'];
          const imageEntries = [];
          cbzZip.forEach((relPath, entry) => {
            if (!entry.dir && validExts.some(ext => relPath.toLowerCase().endsWith(ext))) {
              imageEntries.push(entry);
            }
          });
          imageEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
          if (imageEntries.length > 0) {
            const blob = await imageEntries[0].async('blob');
            const url = URL.createObjectURL(blob);
            await new Promise((resolve) => {
              const img = new Image();
              img.onload = async () => {
                const canvas = document.createElement('canvas');
                const targetWidth = 720;
                const scale = Math.max(1.0, targetWidth / img.width);
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext('2d', { alpha: false });
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                URL.revokeObjectURL(url);
                try {
                  await this._persistGeneratedCover(book, canvas, 2);
                } catch (_) {}
                resolve();
              };
              img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve();
              };
              img.src = url;
            });
          }
        }
      } catch (err) {
        console.warn('[MangaView] Cover background upgrade error:', book.title, err);
      }
    }
  }

  /* -------------------------------------------------------------------------
   * Full-Screen Immersion Reader View
   * ------------------------------------------------------------------------- */
  renderReaderView() {
    const bookTitle = this.currentBook?.title || 'Manga Reader';
    const isDouble = this.spreadMode === 'double';
    const displayMode = this.currentBook?.bubbleDisplay || 'show';
    const bookmarks = Array.isArray(this.currentBook?.bookmarks) ? this.currentBook.bookmarks : [];
    const isCurrentPageBookmarked = bookmarks.some(b => b.page === this.currentPage);
    const bookmarksCount = bookmarks.length;

    const viewContainer = this.container?.closest('#view-container') || document.getElementById('view-container');
    if (viewContainer) {
      viewContainer.scrollTop = 0;
      viewContainer.classList.add('manga-reader-active');
    }
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.add('manga-reader-active');
    }

    this.container.innerHTML = `
      <div class="manga-immersion-reader" id="manga-immersion-reader">
        <!-- Reader Navigation Top Bar -->
        <header class="manga-reader-topbar">
          <div class="manga-topbar-left">
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-reader-back-library" title="Back to Bookshelf">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
              <span>Bookshelf</span>
            </button>
            <div class="manga-topbar-divider"></div>
            <div class="manga-reader-book-title" title="${escapeHtml(bookTitle)}">${escapeHtml(bookTitle)}</div>
          </div>

          <!-- Mobile Compact Touch Actions Bar -->
          <div class="manga-mobile-actions-group">
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm manga-mobile-btn ${isDouble ? 'is-active' : ''}" id="btn-mobile-spread-toggle" title="Toggle 1-Page / 2-Page View">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm-1 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/></svg>
              <span>${isDouble ? '2-Page' : '1-Page'}</span>
            </button>

            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm manga-mobile-btn ${displayMode === 'show' ? 'tactile-btn-gold is-active' : ''}" id="btn-toggle-bubble-display" title="Speech Bubbles Display Mode (Show / Hidden / Detect)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
              <span id="label-bubble-display-mode">${displayMode === 'show' ? 'Bubbles: ON' : (displayMode === 'hidden' ? 'Bubbles: OFF' : 'Bubbles: DETECT')}</span>
            </button>

            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm manga-mobile-btn ${this.activeTool === 'draw' || this.activeTool === 'eraser' ? 'tactile-btn-gold is-active' : ''}" id="btn-mobile-toggle-draw" title="Annotate / Drawing Toolbar">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              <span>Draw</span>
            </button>

            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm manga-mobile-btn ${this.sidebarVisible ? 'is-active' : ''}" id="btn-toggle-study-sidebar-mobile" title="Toggle Study Inspector">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H14V5h5v14z"/></svg>
              <span>Study</span>
            </button>
          </div>

          <div class="manga-topbar-center manga-desktop-only">
            <!-- Spread Mode Toggle (Single vs Double Book View) -->
            <div class="manga-spread-toggle-group">
              <button type="button" class="manga-spread-btn ${!isDouble ? 'is-active' : ''}" id="btn-spread-single" title="Single Page View">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/></svg>
                <span>Single</span>
              </button>
              <button type="button" class="manga-spread-btn ${isDouble ? 'is-active' : ''}" id="btn-spread-double" title="2-Page Book Spread View">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm-1 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/></svg>
                <span>2-Page</span>
              </button>
            </div>

            <div class="manga-topbar-divider"></div>

            <!-- Zoom Controls Group -->
            <div class="manga-zoom-controls">
              <button type="button" class="manga-zoom-btn" id="btn-zoom-out" title="Zoom Out (-)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>
              </button>
              <button type="button" class="manga-zoom-btn manga-zoom-val" id="btn-zoom-reset" title="Reset Zoom (0)">
                <span id="label-zoom-percent">100%</span>
              </button>
              <button type="button" class="manga-zoom-btn" id="btn-zoom-in" title="Zoom In (+)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              </button>
              <button type="button" class="manga-zoom-btn" id="btn-zoom-fit-width" title="Fit to Width">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/></svg>
              </button>
            </div>

            <div class="manga-topbar-divider"></div>

            <!-- Interaction Tool Toggle Group (Move/Pan vs Select/OCR vs Draw/Pencil vs Eraser) -->
            <div class="manga-tool-toggle-group">
              <button type="button" class="manga-tool-toggle-btn ${this.activeTool === 'move' ? 'is-active' : ''}" id="btn-tool-move" title="Pan / Move Tool (Hold Space or press H)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z"/></svg>
                <span>Move</span>
              </button>
              <button type="button" class="manga-tool-toggle-btn ${this.activeTool === 'select' ? 'is-active' : ''}" id="btn-tool-select" title="OCR Box Selection Tool (Press S / Shift+Drag)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M3 5v4h2V5h4V3H5c-1.1 0-2 .9-2 2zm2 10H3v4c0 1.1.9 2 2 2h4v-2H5v-4zm14 4h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zm0-16h-4v2h4v4h2V5c0-1.1-.9-2-2-2z"/></svg>
                <span>Select</span>
              </button>
              <button type="button" class="manga-tool-toggle-btn ${this.activeTool === 'draw' ? 'is-active' : ''}" id="btn-tool-draw" title="Pencil / Annotation Tool (Press P)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                <span>Pencil</span>
              </button>
              <button type="button" class="manga-tool-toggle-btn ${this.activeTool === 'eraser' ? 'is-active' : ''}" id="btn-tool-eraser" title="Eraser Tool (Press E)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M15.14 3c-.51 0-1.02.2-1.41.59L2.59 14.73c-.78.78-.78 2.05 0 2.83L5.03 20H2v2h8.97l8.44-8.44c.78-.78.78-2.05 0-2.83l-2.86-2.86c-.39-.39-.9-.59-1.41-.59zm-1.41 3.41l2.86 2.86-2.03 2.03-2.86-2.86 2.03-2.03z"/></svg>
                <span>Eraser</span>
              </button>
            </div>
          </div>

          <div class="manga-topbar-right manga-desktop-only">
            <!-- Tactile Bubble Detection Controls -->
            <button type="button" class="tactile-btn tactile-btn-gold tactile-btn-sm" id="btn-detect-bubbles" title="Detect Speech Bubbles via AI">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
              <span id="label-detect-bubbles">AI Bubbles</span>
            </button>

            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-clear-bubbles" title="Clear Bubble Overlays">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              <span>Clear</span>
            </button>

            <div class="manga-topbar-divider"></div>

            <!-- Bookmarks Drawer Toggle Button -->
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm manga-reader-bookmark-btn ${isCurrentPageBookmarked ? 'is-active' : ''}" id="btn-reader-bookmarks" title="Bookmarks & Page Notes">
              <svg class="manga-bookmark-svg ${isCurrentPageBookmarked ? 'is-active' : ''}" viewBox="0 0 24 24" width="14" height="14">
                <path class="manga-bookmark-ribbon" d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
              <span id="label-bookmarks-count">${bookmarksCount > 0 ? `Bookmarks (${bookmarksCount})` : 'Bookmarks'}</span>
            </button>

            <!-- Study Sidebar Toggle Button -->
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-toggle-study-sidebar" title="Toggle Study Inspector Sidebar">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H14V5h5v14z"/></svg>
              <span>Sidebar</span>
            </button>

            <!-- Fullscreen Focus Mode Button -->
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm ${this.isFullscreenFocus ? 'is-active' : ''}" id="btn-reader-fullscreen" title="Toggle Fullscreen Focus Mode (F)">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
              <span id="label-reader-fullscreen">${this.isFullscreenFocus ? 'Exit Focus' : 'Focus'}</span>
            </button>
          </div>
        </header>

        <!-- Bookmark Slide-out Drawer -->
        <div class="manga-bookmark-drawer" id="manga-bookmark-drawer" style="display: ${this.bookmarkDrawerOpen ? 'flex' : 'none'};">
          <div class="manga-bookmark-drawer-header">
            <div class="flex items-center gap-2">
              <svg class="manga-bookmark-svg is-active" viewBox="0 0 24 24" width="14" height="14">
                <path class="manga-bookmark-ribbon" d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
              <span class="text-xs font-bold text-warm-paper">Bookmarks (${bookmarksCount})</span>
            </div>
            <button type="button" class="manga-drawer-close-btn" id="btn-close-bookmark-drawer" title="Close Drawer">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
          <div class="manga-bookmark-drawer-actions">
            <button type="button" class="tactile-btn tactile-btn-sm w-full ${isCurrentPageBookmarked ? 'tactile-btn-gold is-active' : 'tactile-btn-primary'}" id="btn-toggle-bookmark-page">
              <svg class="manga-bookmark-svg ${isCurrentPageBookmarked ? 'is-active' : ''}" viewBox="0 0 24 24" width="13" height="13">
                <path class="manga-bookmark-ribbon" d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
              <span id="label-toggle-bookmark">${isCurrentPageBookmarked ? `Remove Bookmark (Page ${this.currentPage})` : `Bookmark Page ${this.currentPage}`}</span>
            </button>
          </div>
          <div class="manga-bookmarks-list" id="manga-bookmarks-list">
            <!-- Rendered by renderBookmarksList() -->
          </div>
        </div>

        <!-- Reader Workspace (Canvas Stage + Study Inspector Sidebar) -->
        <div class="manga-reader-workspace" id="manga-reader-workspace">
          <!-- Floating Tactile Annotation Toolbar -->
          <div class="manga-annotation-toolbar" id="manga-annotation-toolbar" style="display: ${this.activeTool === 'draw' || this.activeTool === 'eraser' ? 'inline-flex' : 'none'};">
            <!-- Mode Switch: Pencil vs Eraser -->
            <div class="manga-annot-group manga-annot-tools">
              <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm ${this.activeTool === 'draw' ? 'tactile-btn-gold is-active' : ''}" id="btn-annot-pencil" title="Pencil Mode">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                <span>Pencil</span>
              </button>
              <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm ${this.activeTool === 'eraser' ? 'tactile-btn-gold is-active' : ''}" id="btn-annot-eraser" title="Eraser Mode">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M15.14 3c-.51 0-1.02.2-1.41.59L2.59 14.73c-.78.78-.78 2.05 0 2.83L5.03 20H2v2h8.97l8.44-8.44c.78-.78.78-2.05 0-2.83l-2.86-2.86c-.39-.39-.9-.59-1.41-.59zm-1.41 3.41l2.86 2.86-2.03 2.03-2.86-2.86 2.03-2.03z"/></svg>
                <span>Eraser</span>
              </button>
            </div>

            <div class="manga-topbar-divider"></div>

            <!-- Color Swatches & Custom Color Picker -->
            <div class="manga-annot-group manga-annot-colors" id="manga-draw-palette">
              <button type="button" class="manga-color-swatch ${this.annotationColor === 'var(--vermilion)' ? 'is-active' : ''}" data-color="var(--vermilion)" style="background: var(--vermilion);" title="Vermilion Red"></button>
              <button type="button" class="manga-color-swatch ${this.annotationColor === 'var(--industrial-aqua)' ? 'is-active' : ''}" data-color="var(--industrial-aqua)" style="background: var(--industrial-aqua);" title="Cyan Blue"></button>
              <button type="button" class="manga-color-swatch ${this.annotationColor === 'var(--heat-marker)' ? 'is-active' : ''}" data-color="var(--heat-marker)" style="background: var(--heat-marker);" title="Amber Orange"></button>
              <button type="button" class="manga-color-swatch ${this.annotationColor === 'var(--jade)' ? 'is-active' : ''}" data-color="var(--jade)" style="background: var(--jade);" title="Jade Green"></button>
              <button type="button" class="manga-color-swatch ${this.annotationColor === 'var(--warm-paper)' ? 'is-active' : ''}" data-color="var(--warm-paper)" style="background: var(--warm-paper);" title="Cream White"></button>
              <button type="button" class="manga-color-swatch ${this.annotationColor === 'var(--ink-black)' ? 'is-active' : ''}" data-color="var(--ink-black)" style="background: var(--ink-black);" title="Ink Black"></button>

              <!-- Custom Color Picker -->
              <label class="manga-color-picker-label" title="Custom Color Picker">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0l1.9-1.9C9.23 19.64 10.57 20 12 20c4.97 0 9-4.03 9-9s-4.03-9-9-9zm0 2c3.87 0 7 3.13 7 7s-3.13 7-7 7c-1.15 0-2.23-.28-3.18-.77l3.47-3.47c.39-.39.39-1.02 0-1.41-.39-.39-1.02-.39-1.41 0l-3.47 3.47C6.91 16.87 6.5 15.5 6.5 14c0-3.87 3.13-7 7-7z"/></svg>
                <input type="color" id="manga-color-picker-input" class="manga-hidden-color-input" />
              </label>
            </div>

            <div class="manga-topbar-divider"></div>

            <!-- Pencil Stroke Width Size Picker -->
            <div class="manga-annot-group manga-annot-sizes" id="manga-size-picker">
              <button type="button" class="manga-size-btn ${this.annotationLineWidth === 2 ? 'is-active' : ''}" data-size="2" title="Fine Stroke (2px)">
                <span class="manga-size-dot manga-size-dot-sm"></span>
              </button>
              <button type="button" class="manga-size-btn ${this.annotationLineWidth === 4 ? 'is-active' : ''}" data-size="4" title="Medium Stroke (4px)">
                <span class="manga-size-dot manga-size-dot-md"></span>
              </button>
              <button type="button" class="manga-size-btn ${this.annotationLineWidth === 8 ? 'is-active' : ''}" data-size="8" title="Bold Stroke (8px)">
                <span class="manga-size-dot manga-size-dot-lg"></span>
              </button>
              <button type="button" class="manga-size-btn ${this.annotationLineWidth === 14 ? 'is-active' : ''}" data-size="14" title="Marker / Highlighter (14px)">
                <span class="manga-size-dot manga-size-dot-xl"></span>
              </button>
            </div>

            <div class="manga-topbar-divider"></div>

            <!-- Undo & Redo (SVG ONLY, NO TEXT) -->
            <div class="manga-annot-group manga-annot-history">
              <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm manga-icon-only-btn" id="btn-annotation-undo" title="Undo Stroke (Ctrl+Z)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.2 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
              </button>
              <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm manga-icon-only-btn" id="btn-annotation-redo" title="Redo Stroke (Ctrl+Y)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.68 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
              </button>
            </div>

            <div class="manga-topbar-divider"></div>

            <!-- Clear Notes Button -->
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm text-danger" id="btn-clear-annotations" title="Clear page annotations">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z"/></svg>
              <span>Clear</span>
            </button>

            <!-- Done / Close Annotations Button -->
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm text-gold" id="btn-close-annotation-toolbar" title="Done Annotating">
              <span>Done</span>
            </button>
          </div>

          <!-- Canvas Stage -->
          <div class="manga-stage-card" id="manga-stage-card">
            <div class="manga-canvas-wrapper ${this.activeTool === 'select' ? 'is-selecting-mode' : (this.activeTool === 'draw' ? 'is-drawing-mode' : (this.activeTool === 'eraser' ? 'is-eraser-mode' : ''))}" id="manga-canvas-wrapper">
              <canvas class="manga-canvas" id="manga-canvas"></canvas>
              <canvas class="manga-annotation-canvas" id="manga-annotation-canvas"></canvas>
              <div class="manga-bubble-overlay-layer" id="manga-bubble-overlay-layer"></div>
              <div class="manga-selection-box" id="manga-selection-box" style="display: none;"></div>
            </div>
            <div class="manga-stage-scroll-spacer" aria-hidden="true"></div>
          </div>

          <!-- Tactile Study Inspector Sidebar (Migaku-Style) -->
          <aside class="manga-study-sidebar" id="manga-study-sidebar" style="${this.sidebarVisible ? '' : 'display: none;'}">
            <div class="manga-sidebar-header">
              <div class="flex items-center gap-2">
                <span class="manga-sidebar-badge font-mono text-gold">STUDY INSPECTOR</span>
              </div>
              <div class="flex items-center gap-1">
                <button type="button" class="manga-sidebar-tool-btn" id="btn-switch-inspector-mode" title="Switch between Sidebar and Floating Popover">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/></svg>
                </button>
                <button type="button" class="manga-sidebar-tool-btn" id="btn-close-study-sidebar" title="Close Sidebar">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
              </div>
            </div>

            <!-- Plain Bubble Dialogue Card (Interactive Words, Matches Popover SS2) -->
            <div class="manga-sidebar-sentence-card" id="manga-sidebar-sentence-card">
              <div class="manga-sidebar-sentence-header">
                <span class="text-xs text-gold font-bold">Bubble Dialogue</span>
                <div class="flex items-center gap-1">
                  <button type="button" class="manga-tool-btn ${this.furiganaEnabled ? 'is-active' : ''}" id="btn-toggle-furigana" title="Toggle Furigana Readings">
                    <span>振仮名</span>
                    <span class="manga-furigana-state text-gold">${this.furiganaEnabled ? 'ON' : 'OFF'}</span>
                  </button>
                  <button type="button" class="manga-tool-btn" id="btn-edit-sentence" title="Edit Japanese text if OCR misread a character">
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    <span>Edit</span>
                  </button>
                  <button type="button" class="manga-tool-btn" id="btn-copy-sentence" title="Copy Japanese Sentence">
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                    <span>Copy</span>
                  </button>
                </div>
              </div>
              <div class="manga-sentence-words-flow font-japanese ${!this.furiganaEnabled ? 'hide-furigana' : ''}" id="manga-sidebar-sentence-text">
                <span class="text-xs text-muted">Click any speech bubble or drag-select on manga to inspect</span>
              </div>
            </div>

            <!-- Hero Target Word Card (Shows Word instead of OCR image) -->
            <div class="manga-sidebar-hero-word-wrap" id="manga-sidebar-hero-word-wrap">
              <span class="manga-hero-word-reading font-japanese" id="manga-target-reading"></span>
              <span class="manga-hero-word-expression font-japanese" id="manga-target-expression">—</span>
              <div class="manga-hero-word-meta">
                <span class="manga-jlpt-badge" id="manga-target-jlpt" style="display: none;">N5</span>
              </div>
            </div>

            <!-- 1-Click Save Flashcard Button -->
            <button type="button" class="tactile-btn tactile-btn-gold w-full manga-mine-btn" id="btn-sidebar-mine-card">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              <span id="label-sidebar-mine-card">Save</span>
            </button>

            <div class="manga-sidebar-body">
              <!-- Definitions / Glosses -->
              <div class="manga-sidebar-section" id="manga-definitions-section" style="display: none;">
                <div class="manga-section-subhead">
                  <span>Definitions</span>
                </div>
                <div class="manga-definitions-list" id="manga-definitions-list"></div>
              </div>

              <!-- Kanji Breakdown -->
              <div class="manga-sidebar-section" id="manga-kanji-section" style="display: none;">
                <div class="manga-section-subhead">
                  <span>Kanji Breakdown</span>
                </div>
                <div class="manga-kanji-cards-grid" id="manga-kanji-cards-grid"></div>
              </div>
            </div>
          </aside>
        </div>

        <!-- Floating Tactile Popover (Solid Ink Surface, Draggable) -->
        <div class="manga-floating-popover" id="manga-floating-popover" style="display: none;">
          <div class="manga-popover-header" id="manga-popover-header" title="Drag to move popover">
            <div class="manga-popover-drag-title">
              <svg class="manga-popover-drag-icon" viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M9 3H7v2h2V3zm4 0h-2v2h2V3zm4 0h-2v2h2V3zM9 7H7v2h2V7zm4 0h-2v2h2V7zm4 0h-2v2h2V7zM9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/></svg>
              <span class="manga-popover-badge font-mono text-gold">INSPECTOR</span>
            </div>
            <div class="flex items-center gap-1">
              <button type="button" class="manga-sidebar-tool-btn" id="btn-switch-popover-mode" title="Switch to Docked Sidebar">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H14V5h5v14z"/></svg>
              </button>
              <button type="button" class="manga-popover-close-btn" id="btn-close-popover" aria-label="Close Popover">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>
          </div>
          <div class="manga-popover-sentence ${!this.furiganaEnabled ? 'hide-furigana' : ''}" id="manga-popover-sentence">
            <span class="text-xs text-muted">Running OCR...</span>
          </div>
          <div class="manga-popover-divider"></div>
          <div class="manga-popover-lookup" id="manga-popover-lookup">
            <span class="text-xs text-muted">Looking up dictionary...</span>
          </div>
        </div>

        <!-- Floating Reader Bottom Navigation Bar -->
        <footer class="manga-reader-bottombar">
          <div class="manga-nav-pill-container">
            <button type="button" class="manga-nav-btn" id="btn-reader-prev" title="Previous Page" aria-label="Previous Page">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>

            <div class="manga-page-stepper">
              <input type="number" id="manga-page-input" class="manga-page-input" min="1" max="${this.pageCount}" value="${this.currentPage}">
              <span class="manga-page-total font-mono">/ ${this.pageCount}</span>
            </div>

            <button type="button" class="manga-nav-btn" id="btn-reader-next" title="Next Page" aria-label="Next Page">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
            </button>
          </div>
        </footer>

        <!-- Pacman Loading Overlay -->
        <div class="manga-loading-overlay" id="manga-loading-overlay" style="display: none;">
          <div class="manga-loading-card">
            <div class="manga-loading-pacman-wrap">
              ${PACMAN_LOADING_SVG}
            </div>
            <div class="manga-loading-text" id="manga-loading-status-text">Loading volume...</div>
            <div class="manga-loading-subtext" id="manga-loading-subtext">Reading pages into memory</div>
          </div>
        </div>
      </div>
    `;

    this.setupReaderEvents();
    this.renderCurrentPage();
  }

  exitReaderToLibrary() {
    if (this.activeMode !== 'reader') return;
    if (this.isFullscreenFocus) {
      this.toggleFullscreenFocus(false);
    }
    const viewContainer = this.container?.closest('#view-container') || document.getElementById('view-container');
    if (viewContainer) {
      viewContainer.classList.remove('manga-reader-active');
    }
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('manga-reader-active');
      document.body.classList.remove('manga-fullscreen-active');
    }
    this.closePopover();
    this.closeSidebar();
    this.clearBubbleOverlays();
    this.resetZoom();
    this.bookmarkDrawerOpen = false;
    clearTimeout(this.prefetchTimeout);
    this.prefetchOcrCache.clear();
    this.activeMode = 'library';
    this.render();
  }

  setupReaderEvents() {
    const btnBackLib = this.container.querySelector('#btn-reader-back-library');
    btnBackLib?.addEventListener('click', () => {
      this.exitReaderToLibrary();
    });

    if (!this.boundMouseBackHandler) {
      this.boundMouseBackHandler = (e) => {
        if (e.button === 3 && this.activeMode === 'reader') {
          e.preventDefault();
          e.stopPropagation();
          this.exitReaderToLibrary();
        }
      };
      window.addEventListener('mouseup', this.boundMouseBackHandler);
      window.addEventListener('auxclick', this.boundMouseBackHandler);
    }

    if (!this.boundPopStateHandler) {
      this.boundPopStateHandler = () => {
        if (this.activeMode === 'reader') {
          this.exitReaderToLibrary();
        }
      };
      window.addEventListener('popstate', this.boundPopStateHandler);
    }

    const btnFullscreen = this.container.querySelector('#btn-reader-fullscreen');
    btnFullscreen?.addEventListener('click', () => {
      this.toggleFullscreenFocus();
    });

    if (!this._fullScreenCleanup) {
      const handleFs = (isFull) => {
        if (this.activeMode === 'reader' && this.isFullscreenFocus !== isFull) {
          this.isFullscreenFocus = isFull;
          this._syncFullscreenFocusUI();
        }
      };
      if (window.desktopAPI?.onFullScreenChange) {
        this._fullScreenCleanup = window.desktopAPI.onFullScreenChange(handleFs);
      } else if (typeof document !== 'undefined') {
        const handler = () => handleFs(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', handler);
        this._fullScreenCleanup = () => document.removeEventListener('fullscreenchange', handler);
      }
    }

    const btnNext = this.container.querySelector('#btn-reader-next');
    btnNext?.addEventListener('click', () => this.nextPage());

    const btnPrev = this.container.querySelector('#btn-reader-prev');
    btnPrev?.addEventListener('click', () => this.prevPage());

    const pageInput = this.container.querySelector('#manga-page-input');
    pageInput?.addEventListener('change', (e) => {
      const pageNum = parseInt(e.target.value, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= this.pageCount) {
        this.goToPage(pageNum);
      }
    });
    pageInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const pageNum = parseInt(e.target.value, 10);
        if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= this.pageCount) {
          this.goToPage(pageNum);
          pageInput.blur();
        }
      }
    });

    // Bookmarks Drawer & Toggle
    const btnBookmarks = this.container.querySelector('#btn-reader-bookmarks');
    btnBookmarks?.addEventListener('click', () => {
      this.bookmarkDrawerOpen = !this.bookmarkDrawerOpen;
      const drawer = this.container.querySelector('#manga-bookmark-drawer');
      if (drawer) {
        drawer.style.display = this.bookmarkDrawerOpen ? 'flex' : 'none';
        if (this.bookmarkDrawerOpen) {
          this.renderBookmarksList();
        }
      }
    });

    const btnCloseDrawer = this.container.querySelector('#btn-close-bookmark-drawer');
    btnCloseDrawer?.addEventListener('click', () => {
      this.bookmarkDrawerOpen = false;
      const drawer = this.container.querySelector('#manga-bookmark-drawer');
      if (drawer) drawer.style.display = 'none';
    });

    const btnToggleBmPage = this.container.querySelector('#btn-toggle-bookmark-page');
    btnToggleBmPage?.addEventListener('click', () => {
      this.toggleBookmarkCurrentPage();
    });

    // Furigana Readings Toggle
    const btnFurigana = this.container.querySelector('#btn-toggle-furigana');
    btnFurigana?.addEventListener('click', () => {
      this.furiganaEnabled = !this.furiganaEnabled;
      localStorage.setItem('manga_furigana_enabled', this.furiganaEnabled ? 'true' : 'false');
      this.updateFuriganaUI();
    });

    const btnSingle = this.container.querySelector('#btn-spread-single');
    const btnDouble = this.container.querySelector('#btn-spread-double');

    btnSingle?.addEventListener('click', () => {
      if (this.spreadMode !== 'single') {
        this.spreadMode = 'single';
        localStorage.setItem(STORAGE_KEY_SPREAD, 'single');
        this.render();
      }
    });

    btnDouble?.addEventListener('click', () => {
      if (this.spreadMode !== 'double') {
        this.spreadMode = 'double';
        localStorage.setItem(STORAGE_KEY_SPREAD, 'double');
        this.render();
      }
    });

    const btnMobileSpread = this.container.querySelector('#btn-mobile-spread-toggle');
    btnMobileSpread?.addEventListener('click', () => {
      this.spreadMode = this.spreadMode === 'double' ? 'single' : 'double';
      localStorage.setItem(STORAGE_KEY_SPREAD, this.spreadMode);
      this.render();
    });

    const btnBubbleToggle = this.container.querySelector('#btn-toggle-bubble-display');
    btnBubbleToggle?.addEventListener('click', () => this.toggleBubbleDisplay());

    const btnMobileDraw = this.container.querySelector('#btn-mobile-toggle-draw');
    btnMobileDraw?.addEventListener('click', () => {
      if (this.activeTool === 'draw' || this.activeTool === 'eraser') {
        this.setActiveTool('move');
      } else {
        this.setActiveTool('draw');
      }
    });

    const btnToggleSidebarMobile = this.container.querySelector('#btn-toggle-study-sidebar-mobile');
    btnToggleSidebarMobile?.addEventListener('click', () => this.toggleSidebar());

    const btnAnnotPencil = this.container.querySelector('#btn-annot-pencil');
    btnAnnotPencil?.addEventListener('click', () => this.setActiveTool('draw'));

    const btnAnnotEraser = this.container.querySelector('#btn-annot-eraser');
    btnAnnotEraser?.addEventListener('click', () => this.setActiveTool('eraser'));

    const btnCloseAnnot = this.container.querySelector('#btn-close-annotation-toolbar');
    btnCloseAnnot?.addEventListener('click', () => this.setActiveTool('move'));

    const btnZoomIn = this.container.querySelector('#btn-zoom-in');
    btnZoomIn?.addEventListener('click', () => this.zoomIn());

    const btnZoomOut = this.container.querySelector('#btn-zoom-out');
    btnZoomOut?.addEventListener('click', () => this.zoomOut());

    const btnZoomReset = this.container.querySelector('#btn-zoom-reset');
    btnZoomReset?.addEventListener('click', () => this.resetZoom());

    const btnZoomFitWidth = this.container.querySelector('#btn-zoom-fit-width');
    btnZoomFitWidth?.addEventListener('click', () => this.fitWidth());

    // Move vs Select vs Draw vs Eraser Interaction Tools
    const btnToolMove = this.container.querySelector('#btn-tool-move');
    btnToolMove?.addEventListener('click', () => this.setActiveTool('move'));

    const btnToolSelect = this.container.querySelector('#btn-tool-select');
    btnToolSelect?.addEventListener('click', () => this.setActiveTool('select'));

    const btnToolDraw = this.container.querySelector('#btn-tool-draw');
    btnToolDraw?.addEventListener('click', () => this.setActiveTool('draw'));

    const btnToolEraser = this.container.querySelector('#btn-tool-eraser');
    btnToolEraser?.addEventListener('click', () => this.setActiveTool('eraser'));

    // Color Swatches, Color Picker & Size Controls
    const colorSwatches = this.container.querySelectorAll('.manga-color-swatch');
    colorSwatches?.forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.getAttribute('data-color');
        if (color) {
          this.annotationColor = color;
          colorSwatches.forEach(b => b.classList.toggle('is-active', b === btn));
          const pickerInput = this.container?.querySelector('#manga-color-picker-input');
          if (pickerInput) {
            pickerInput.value = resolveCanvasColor(color);
          }
          const pickerLabel = this.container?.querySelector('.manga-color-picker-label');
          if (pickerLabel) {
            pickerLabel.style.borderColor = 'var(--tactile-stroke)';
          }
          if (this.activeTool !== 'draw' && this.activeTool !== 'eraser') {
            this.setActiveTool('draw');
          }
        }
      });
    });

    const colorPickerInput = this.container.querySelector('#manga-color-picker-input');
    colorPickerInput?.addEventListener('input', (e) => {
      const customHex = e.target.value;
      if (customHex) {
        this.annotationColor = customHex;
        colorSwatches.forEach(b => b.classList.remove('is-active'));
        const pickerLabel = this.container?.querySelector('.manga-color-picker-label');
        if (pickerLabel) {
          pickerLabel.style.borderColor = customHex;
        }
        if (this.activeTool !== 'draw' && this.activeTool !== 'eraser') {
          this.setActiveTool('draw');
        }
      }
    });

    const sizeBtns = this.container.querySelectorAll('.manga-size-btn');
    sizeBtns?.forEach(btn => {
      btn.addEventListener('click', () => {
        const size = parseInt(btn.getAttribute('data-size'), 10) || 4;
        this.annotationLineWidth = size;
        sizeBtns.forEach(b => b.classList.toggle('is-active', b === btn));
      });
    });

    // Undo & Redo (SVG icon only, no text)
    const btnUndo = this.container.querySelector('#btn-annotation-undo');
    btnUndo?.addEventListener('click', () => this.undoAnnotationStroke());

    const btnRedo = this.container.querySelector('#btn-annotation-redo');
    btnRedo?.addEventListener('click', () => this.redoAnnotationStroke());

    const btnClearNotes = this.container.querySelector('#btn-clear-annotations');
    btnClearNotes?.addEventListener('click', () => this.clearCurrentPageAnnotations());

    const stageCard = this.container.querySelector('#manga-stage-card');
    stageCard?.addEventListener('wheel', (e) => {
      // 1. Ctrl / Meta + Wheel: Zooming with smooth throttle
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const now = Date.now();
        if (now - this.lastWheelZoomTime > 50) {
          this.lastWheelZoomTime = now;
          if (e.deltaY < 0) {
            this.zoomIn();
          } else {
            this.zoomOut();
          }
        }
        return;
      }

      // 2. Normal Wheel Scrolling
      const canScrollVertically = stageCard.scrollHeight > stageCard.clientHeight + 10;
      const canScrollHorizontally = stageCard.scrollWidth > stageCard.clientWidth + 10;

      if (canScrollVertically || canScrollHorizontally) {
        // Content overflows: allow natural smooth scroll throughout the page without interruption!
        // Never hijack scrolling to prematurely turn the page while reading!
        return;
      }

      // 3. Page fits in window (no scrollbars): wheel down = Next Page, wheel up = Prev Page
      if (Math.abs(e.deltaY) > 25) {
        e.preventDefault();
        const now = Date.now();
        if (now - this.lastWheelPageTurnTime > 350) {
          this.lastWheelPageTurnTime = now;
          if (e.deltaY > 0) {
            this.nextPage();
          } else {
            this.prevPage();
          }
        }
      }
    }, { passive: false });

    // Drag-to-Pan & OCR Selection Pointer Events (with fallback)
    if (typeof window !== 'undefined' && 'PointerEvent' in window) {
      stageCard?.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
      stageCard?.addEventListener('pointercancel', (e) => this.handlePointerCancel(e));
    } else {
      stageCard?.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    }

    const btnEditSentence = this.container.querySelector('#btn-edit-sentence');
    btnEditSentence?.addEventListener('click', () => this.openEditSentenceModal());

    const btnDetect = this.container.querySelector('#btn-detect-bubbles');
    btnDetect?.addEventListener('click', () => this.detectBubblesOnCurrentPage());

    const btnClear = this.container.querySelector('#btn-clear-bubbles');
    btnClear?.addEventListener('click', () => this.clearBubbleOverlays());

    const btnToggleSidebar = this.container.querySelector('#btn-toggle-study-sidebar');
    btnToggleSidebar?.addEventListener('click', () => this.toggleSidebar());

    const btnCloseSidebar = this.container.querySelector('#btn-close-study-sidebar');
    btnCloseSidebar?.addEventListener('click', () => this.closeSidebar());

    const btnSwitchInspector = this.container.querySelector('#btn-switch-inspector-mode');
    btnSwitchInspector?.addEventListener('click', () => this.switchInspectorMode());

    const btnSwitchPopover = this.container.querySelector('#btn-switch-popover-mode');
    btnSwitchPopover?.addEventListener('click', () => this.switchInspectorMode());

    const btnClosePop = this.container.querySelector('#btn-close-popover');
    btnClosePop?.addEventListener('click', () => this.closePopover());

    const btnCopySentence = this.container.querySelector('#btn-copy-sentence');
    btnCopySentence?.addEventListener('click', () => this.copySentence());

    const btnMineCard = this.container.querySelector('#btn-sidebar-mine-card');
    btnMineCard?.addEventListener('click', () => this.mineActiveWord());

    const kanjiGrid = this.container.querySelector('#manga-kanji-cards-grid');
    kanjiGrid?.addEventListener('click', (e) => {
      const card = e.target.closest('.manga-kanji-card');
      if (card && card.dataset.character) {
        this.openKanjiInTab(card.dataset.character);
      }
    });

    this.setupPopoverDrag();

    const wrapper = this.container.querySelector('#manga-canvas-wrapper');
    wrapper?.addEventListener('dragover', (e) => e.preventDefault());
    wrapper?.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0) await this.openFiles(files);
    });

    const popoverLookup = this.container.querySelector('#manga-popover-lookup');
    popoverLookup?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-manga-mine-word');
      if (btn && btn.dataset.word) {
        this.mineWord(btn.dataset.word, btn.dataset.reading, btn.dataset.meaning, btn);
      }
    });

    this.updateCursorState();
  }

  /* -------------------------------------------------------------------------
   * File Loading & IndexedDB Persistence
   * ------------------------------------------------------------------------- */
  async openFiles(files) {
    if (!files || files.length === 0) return;
    if (files.length === 1) {
      await this.openFile(files[0], true, true);
      return;
    }

    this.showLoading('Adding Manga to Library...', `${files.length} volumes selected`);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      this.updateLoadingStatus(`Processing ${file.name}...`, `Volume ${i + 1} of ${files.length}`);
      await new Promise(r => setTimeout(r, 25));
      await this.openFile(file, false, false);
    }
    this.hideLoading();
    this.activeMode = 'library';
    this.render();
  }

  /**
   * Inspect a ZIP archive to detect whether it contains multiple manga volumes
   * (nested PDFs, CBZs, or chapter/volume image directories).
   */
  async analyzeZipContents(arrayBuffer) {
    if (typeof window.JSZip === 'undefined') {
      return { isBundle: false, isMultiVolume: false, items: [] };
    }

    try {
      const zip = new window.JSZip();
      const loadedZip = await zip.loadAsync(arrayBuffer);

      const validMangaExts = ['.pdf', '.cbz', '.cbr', '.zip'];
      const validImgExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'];

      const nestedMangaFiles = [];
      const imageEntries = [];

      loadedZip.forEach((relPath, entry) => {
        if (entry.dir) return;
        // Skip Mac metadata and hidden dot-files
        if (relPath.startsWith('__MACOSX/') || relPath.includes('/.') || relPath.startsWith('.')) return;

        const lower = relPath.toLowerCase();
        if (validMangaExts.some(ext => lower.endsWith(ext))) {
          nestedMangaFiles.push({ relPath, entry });
        } else if (validImgExts.some(ext => lower.endsWith(ext))) {
          imageEntries.push({ relPath, entry });
        }
      });

      // 1. If the ZIP contains nested manga documents (.pdf, .cbz, .zip)
      if (nestedMangaFiles.length > 0) {
        nestedMangaFiles.sort((a, b) => a.relPath.localeCompare(b.relPath, undefined, { numeric: true, sensitivity: 'base' }));
        const items = nestedMangaFiles.map(f => {
          const parts = f.relPath.split('/');
          const filename = parts[parts.length - 1];
          const title = filename.replace(/\.[^/.]+$/, '').trim();
          const ext = filename.split('.').pop()?.toLowerCase();
          return {
            type: ext === 'pdf' ? 'pdf' : 'cbz',
            title,
            entry: f.entry,
            isNestedFile: true
          };
        });

        return {
          isBundle: true,
          isMultiVolume: items.length > 1,
          items
        };
      }

      // 2. If the ZIP contains images, check if they are organized into multiple subdirectories
      if (imageEntries.length > 0) {
        const pathPartsList = imageEntries.map(e => e.relPath.split('/'));
        let commonPrefixLength = 0;
        if (pathPartsList.length > 0 && pathPartsList[0].length > 2) {
          const firstParts = pathPartsList[0];
          for (let i = 0; i < firstParts.length - 1; i++) {
            const seg = firstParts[i];
            if (pathPartsList.every(parts => parts.length > i + 1 && parts[i] === seg)) {
              commonPrefixLength = i + 1;
            } else {
              break;
            }
          }
        }

        const volumeMap = new Map();
        for (const img of imageEntries) {
          const parts = img.relPath.split('/');
          const relativeParts = parts.slice(commonPrefixLength);
          let volName = 'Root';
          if (relativeParts.length > 1) {
            volName = relativeParts[0].trim();
          }

          if (!volumeMap.has(volName)) {
            volumeMap.set(volName, []);
          }
          volumeMap.get(volName).push({
            relPath: img.relPath,
            entry: img.entry,
            localName: relativeParts.slice(1).join('/') || parts[parts.length - 1]
          });
        }

        const volumeNames = Array.from(volumeMap.keys()).filter(k => k !== 'Root' || volumeMap.size === 1);
        if (volumeMap.size > 1 && !volumeMap.has('Root')) {
          const items = [];
          volumeNames.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
          for (const volName of volumeNames) {
            const imgs = volumeMap.get(volName) || [];
            imgs.sort((a, b) => a.localName.localeCompare(b.localName, undefined, { numeric: true, sensitivity: 'base' }));
            items.push({
              type: 'cbz_folder',
              title: volName,
              images: imgs,
              isNestedFile: false
            });
          }

          return {
            isBundle: true,
            isMultiVolume: true,
            items
          };
        }
      }
    } catch (err) {
      console.warn('[MangaView] Error during zip analysis:', err);
    }

    return { isBundle: false, isMultiVolume: false, items: [] };
  }

  async importZipBundle(file, arrayBuffer, analysis, createFolder = true) {
    const rawName = file.name.replace(/\.[^/.]+$/, '').trim();
    const folderName = rawName || 'Manga Bundle';

    let targetFolderId = this.activeFolderId === 'all' ? 'default' : this.activeFolderId;

    if (createFolder) {
      let targetFolder = this.folders.find(f => f.name.toLowerCase() === folderName.toLowerCase());
      if (!targetFolder) {
        targetFolder = {
          id: 'folder_' + Date.now(),
          name: folderName
        };
        this.folders.push(targetFolder);
        this.saveFolders();
      }
      targetFolderId = targetFolder.id;
    }

    const totalItems = analysis.items.length;
    this.showLoading(`Unpacking ${escapeHtml(folderName)}...`, `Found ${totalItems} manga volumes`);

    try {
      for (let i = 0; i < totalItems; i++) {
        const item = analysis.items[i];
        this.updateLoadingStatus(
          `Extracting ${item.title}...`,
          `Volume ${i + 1} of ${totalItems}`
        );
        await new Promise(r => setTimeout(r, 25));

        let itemBuffer;
        if (item.isNestedFile) {
          itemBuffer = await item.entry.async('arraybuffer');
        } else if (item.type === 'cbz_folder') {
          const volZip = new window.JSZip();
          for (const img of item.images) {
            const bytes = await img.entry.async('uint8array');
            volZip.file(img.localName, bytes);
          }
          itemBuffer = await volZip.generateAsync({ type: 'arraybuffer' });
        }

        if (!itemBuffer) continue;

        const volType = item.type === 'pdf' ? 'pdf' : 'cbz';
        const existingIdx = this.books.findIndex(b => b.title === item.title && (b.folderId || 'default') === targetFolderId);
        const bookId = existingIdx >= 0
          ? this.books[existingIdx].id
          : ('book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));

        const stored = await storeBookFile(bookId, itemBuffer, {
          title: item.title,
          filename: `${item.title}.${volType}`,
          type: volType
        });
        if (!stored) {
          throw new Error(`Failed to save "${item.title}" to persistent storage.`);
        }
        const verifyStatus = await verifyBookStorage(bookId);
        if (!verifyStatus || !verifyStatus.verified) {
          await deleteBookFile(bookId);
          throw new Error(`Storage verification failed for "${item.title}".`);
        }

        const newBook = {
          id: bookId,
          title: item.title,
          filename: `${item.title}.${volType}`,
          size: itemBuffer.byteLength,
          type: volType,
          folderId: targetFolderId,
          pageCount: 1,
          currentPage: existingIdx >= 0 ? (this.books[existingIdx].currentPage || 1) : 1,
          coverUrl: '',
          coverVersion: 2,
          updatedAt: Date.now() + (totalItems - i) * 1000
        };

        if (newBook.type === 'pdf') {
          await this.initPdfFromBuffer(newBook, itemBuffer);
        } else {
          await this.initCbzFromBuffer(newBook, itemBuffer);
        }

        await this.generateCrispCover(newBook, true);
        await new Promise(r => setTimeout(r, 20));

        if (existingIdx >= 0) {
          this.books[existingIdx] = newBook;
        } else {
          this.books.push(newBook);
        }
      }

      this.books.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      this.saveLibrary();

      // Free parsing memory so unread volumes are not held in RAM
      this.pdfDoc = null;
      this.cbzZip = null;
      this.cbzImageEntries = [];

      if (createFolder) {
        this.activeFolderId = targetFolderId;
      }
      this.activeMode = 'library';
      this.render();
    } catch (err) {
      console.error('[MangaView] Failed to import zip bundle:', err);
      this.showToast(`Failed to import ZIP bundle: ${err?.message || err}`);
    } finally {
      this.pdfDoc = null;
      this.cbzZip = null;
      this.cbzImageEntries = [];
      this.hideLoading();
    }
  }

  showZipImportModal(file, arrayBuffer, analysis) {
    const rawName = file.name.replace(/\.[^/.]+$/, '').trim();
    const folderName = rawName || 'Manga Bundle';

    this.showModal(`
      <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
        <div class="tactile-modal-card">
          <h3 class="text-base font-bold text-warm-paper">ZIP Bundle Detected</h3>
          <p class="text-xs text-muted mt-2">
            "<strong>${escapeHtml(file.name)}</strong>" contains <strong>${analysis.items.length}</strong> manga volume(s).
          </p>
          <p class="text-xs text-muted mt-1">
            Would you like to auto-create folder "<strong>${escapeHtml(folderName)}</strong>" with all volumes inside?
          </p>
          <div class="modal-actions-row mt-4">
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-modal-import-current">Import to Current Folder</button>
            <button type="button" class="tactile-btn tactile-btn-primary tactile-btn-sm" id="btn-modal-create-folder">Create Folder & Import All</button>
          </div>
        </div>
      </div>
    `, () => {
      const btnCreate = this.container.querySelector('#btn-modal-create-folder');
      const btnCurrent = this.container.querySelector('#btn-modal-import-current');

      btnCreate?.addEventListener('click', () => {
        this.closeModal();
        this.importZipBundle(file, arrayBuffer, analysis, true);
      });

      btnCurrent?.addEventListener('click', () => {
        this.closeModal();
        this.importZipBundle(file, arrayBuffer, analysis, false);
      });
    });
  }

  async openFile(file, autoOpen = true, shouldRender = true) {
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLowerCase();

    // Check if uploaded file is a ZIP bundle containing multiple mangas or manga files
    if (extension === 'zip') {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const analysis = await this.analyzeZipContents(arrayBuffer);

        if (analysis.isBundle) {
          if (this.autoFolderZip) {
            await this.importZipBundle(file, arrayBuffer, analysis, true);
            return;
          } else {
            this.showZipImportModal(file, arrayBuffer, analysis);
            return;
          }
        }
      } catch (err) {
        console.warn('[MangaView] ZIP bundle analysis fallback to normal:', err);
      }
    }

    if (shouldRender) {
      this.showLoading('Adding Manga to Library...', file.name);
    }

    try {
      const title = file.name.replace(/\.[^/.]+$/, '');
      const targetFolderId = this.activeFolderId === 'all' ? 'default' : this.activeFolderId;
      const existingBook = this.books.find(b => b.title === title && (b.folderId || 'default') === targetFolderId);
      const bookId = existingBook ? existingBook.id : ('book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));

      let type = 'image';
      if (extension === 'pdf') type = 'pdf';
      else if (extension === 'cbz' || extension === 'zip') type = 'cbz';

      this.updateLoadingStatus('Reading file bytes...', file.name);
      await new Promise(r => setTimeout(r, 20));
      const arrayBuffer = await file.arrayBuffer();

      this.updateLoadingStatus('Saving to offline storage...', 'Storing in persistent storage');
      const stored = await storeBookFile(bookId, arrayBuffer, { title, filename: file.name, type });
      if (!stored) {
        throw new Error('Failed to save book to persistent storage. Storage quota may be exceeded.');
      }

      const verifyStatus = await verifyBookStorage(bookId);
      if (!verifyStatus || !verifyStatus.verified) {
        await deleteBookFile(bookId);
        throw new Error('Storage verification failed. The book could not be safely verified on disk.');
      }

      const newBook = {
        id: bookId,
        title,
        filename: file.name,
        size: arrayBuffer.byteLength,
        type,
        folderId: this.activeFolderId === 'all' ? 'default' : this.activeFolderId,
        pageCount: 1,
        currentPage: 1,
        coverUrl: '',
        coverVersion: 2,
        updatedAt: Date.now()
      };

      this.updateLoadingStatus('Preparing pages...', 'Reading document structure');
      await new Promise(r => setTimeout(r, 20));
      if (type === 'pdf') {
        await this.initPdfFromBuffer(newBook, arrayBuffer);
      } else if (type === 'cbz') {
        await this.initCbzFromBuffer(newBook, arrayBuffer);
      } else {
        newBook.pageCount = 1;
        newBook.currentPage = 1;
      }

      const existingIdx = this.books.findIndex(b => b.title === title && b.folderId === newBook.folderId);
      if (existingIdx >= 0) {
        newBook.id = this.books[existingIdx].id;
        newBook.currentPage = this.books[existingIdx].currentPage || 1;
        newBook.folderId = this.books[existingIdx].folderId || newBook.folderId;
        this.books[existingIdx] = newBook;
      } else {
        this.books.unshift(newBook);
      }

      this.currentBook = newBook;
      this.currentPage = newBook.currentPage || 1;
      this.pageCount = newBook.pageCount || 1;

      this.updateLoadingStatus('Generating crisp cover...', 'Rendering high-resolution thumbnail');
      await new Promise(r => setTimeout(r, 20));
      await this.generateCrispCover(newBook, true);

      this.saveLibrary();

      if (shouldRender) {
        if (autoOpen) {
          this.activeMode = 'reader';
        } else {
          this.activeMode = 'library';
        }
        this.render();
      }
    } catch (err) {
      console.error('[MangaView] Failed to open file:', err);
      this.showToast(`Failed to import ${file.name}: ${err?.message || err}`);
    } finally {
      if (shouldRender) {
        this.hideLoading();
      }
    }
  }

  async loadAndOpenBook(bookId, initialPage = null) {
    const book = this.books.find(b => b.id === bookId);
    if (!book) return;

    let buffer = this._memoryBookBuffers?.get(bookId) || null;
    if (!buffer) {
      buffer = await getBookFileBuffer(bookId);
    }
    if (!buffer || buffer.byteLength === 0) {
      if (buffer && buffer.byteLength === 0) {
        await deleteBookFile(bookId);
      }
      // Cloud book: immediately present transfer options without showing/flashing downloading spinner
      this.showCloudBookHelpModal(book);
      return;
    } else {
      this.showLoading('Opening Volume...', book.title);
    }

    try {
      this.updateLoadingStatus('Initializing pages...', 'Parsing volume contents');
      // Sniff magic bytes to guarantee cbz vs pdf detection
      if (buffer && buffer.byteLength >= 4) {
        const header = new Uint8Array(buffer, 0, 4);
        if (header[0] === 0x50 && header[1] === 0x4B && header[2] === 0x03 && header[3] === 0x04) {
          book.type = 'cbz';
        } else if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
          book.type = 'pdf';
        }
      }
      if (book.type === 'pdf') {
        await this.initPdfFromBuffer(book, buffer);
      } else if (book.type === 'cbz') {
        await this.initCbzFromBuffer(book, buffer);
      }

      // Upgrade cover thumbnail if missing or older low-res version
      if (!book.coverUrl || book.coverVersion !== 2) {
        this.updateLoadingStatus('Rendering crisp cover...', 'Updating thumbnail');
        await this.generateCrispCover(book, true);
      }

      this.currentBook = book;
      this.loadPrebakedOcrForBook(book.id).catch(() => {});
      if (!Array.isArray(this.currentBook.bookmarks)) {
        this.currentBook.bookmarks = [];
      }
      this.currentPage = (initialPage !== null && !isNaN(initialPage)) ? initialPage : (book.currentPage || 1);
      this.pageCount = book.pageCount || 1;
      this.activeMode = 'reader';
      try {
        if (typeof window !== 'undefined' && window.history?.pushState) {
          window.history.pushState({ kirokuMode: 'manga-reader', bookId: book.id }, '', window.location.href);
        }
      } catch (_) {}
      this.render();
    } catch (err) {
      console.error('[MangaView] Failed to load book:', err);
    } finally {
      this.hideLoading();
    }
  }

  showToast(msg) {
    if (!this.container) return;
    let toast = this.container.querySelector('#manga-toast-notice');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'manga-toast-notice';
      toast.className = 'manga-toast-notice';
      this.container.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = 'block';
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      if (toast) toast.style.display = 'none';
    }, 4000);
  }

  async downloadBookToFile(book, buffer, customSaver = null) {
    try {
      const filename = book.filename || `${book.title || 'manga'}.${book.type || 'cbz'}`;
      const mime = (book.type === 'pdf' || filename.endsWith('.pdf')) ? 'application/pdf' : 'application/zip';
      const blob = new Blob([buffer], { type: mime });

      if (typeof customSaver === 'function') {
        customSaver(blob, filename);
        return true;
      }

      // 1. Check for File System Access API (Desktop / Chromium browsers)
      if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
        try {
          const ext = filename.includes('.') ? '.' + filename.split('.').pop() : (book.type === 'pdf' ? '.pdf' : '.cbz');
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{
              description: 'Manga Volume',
              accept: { [mime]: [ext] }
            }]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return true;
        } catch (pickerErr) {
          if (pickerErr?.name === 'AbortError') {
            return false; // User cancelled the picker dialog
          }
          // Otherwise fall through to standard anchor download
        }
      }

      // 2. Fallback: standard DOM download anchor for iPhone Safari, iOS Chrome, Android and all browsers
      if (typeof document !== 'undefined') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch (_) {}
        }, 1500);
        return true;
      }
    } catch (err) {
      console.warn('[Manga] downloadBookToFile error:', err);
    }
    return false;
  }

  showCloudBookHelpModal(book) {
    const isCloudOnly = Boolean(book.isCloudOnly);
    const hasCloudFile = book.has_file !== false;
    const sizeMb = book.size ? (book.size / (1024 * 1024)).toFixed(1) + ' MB' : '';

    this.showModal(`
      <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
        <div class="tactile-modal-card manga-cloud-book-modal" style="max-width: 440px; padding: 1.5rem;">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="var(--gold)">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
              </svg>
              <h3 class="text-base font-bold text-warm-paper">Cloud Manga Library</h3>
            </div>
            <button type="button" class="manga-modal-close-btn" id="btn-modal-header-close" aria-label="Close">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>

          <div class="mb-3">
            <div class="font-bold text-sm text-warm-paper mb-1">${escapeHtml(book.title)}</div>
            <div class="text-xs text-muted flex items-center gap-2">
              <span>${book.totalPages || book.pageCount || 1} pages</span>
              ${sizeMb ? `<span>• ${sizeMb}</span>` : ''}
              ${hasCloudFile ? '<span class="manga-pill-badge manga-pill-badge-gold">Cloud File</span>' : '<span class="manga-pill-badge">Metadata Synced</span>'}
            </div>
          </div>

          <div class="bg-surface-lowest border border-tactile rounded p-3 mb-4 text-xs text-muted leading-relaxed">
            ${!hasCloudFile ? `
              <div class="text-warm-paper font-semibold mb-1">Pages Not in Cloud</div>
              <div>Your reading progress, bookmarks, and cover are synced, but book pages are not stored on the cloud server.</div>
              <div class="mt-2 text-warm-paper font-medium">To read on this device:</div>
              <div class="mt-1">• <strong>Wi-Fi Transfer:</strong> On your PC, click this book's <strong>⋮ &gt; Send to Phone</strong>, then tap Wi-Fi Transfer below.</div>
              <div class="mt-1">• <strong>Local File:</strong> Tap Select File to open the PDF/CBZ from disk.</div>
            ` : `
              <div class="text-warm-paper font-semibold mb-1">To view on this device:</div>
              <div>• <strong>Download:</strong> Fetch this book directly from cloud storage.</div>
              <div class="mt-1">• <strong>Wi-Fi Transfer:</strong> Fast direct transfer from your PC over local Wi-Fi.</div>
              <div class="mt-1">• <strong>Local File:</strong> Select the PDF/CBZ file from your device files.</div>
            `}
          </div>

          <div class="manga-cloud-actions flex flex-col gap-2">
            ${hasCloudFile ? `
              <button type="button" class="tactile-btn tactile-btn-primary w-full py-2 flex items-center justify-center gap-2" id="btn-cloud-download-now">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
                Download from Cloud
              </button>
            ` : ''}
            <button type="button" class="tactile-btn ${hasCloudFile ? 'tactile-btn-secondary' : 'tactile-btn-primary'} w-full py-2 flex items-center justify-center gap-2" id="btn-cloud-receive-pc">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>
              Wi-Fi Transfer from PC
            </button>
            <button type="button" class="tactile-btn tactile-btn-ghost w-full py-2 flex items-center justify-center gap-2" id="btn-cloud-pick-file">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Select File from Device
            </button>
            <button type="button" class="tactile-btn tactile-btn-ghost w-full py-2 text-muted text-xs mt-1" id="btn-modal-cancel">
              Cancel
            </button>
          </div>
        </div>
      </div>
    `);

    this.container?.querySelector('#btn-modal-header-close')?.addEventListener('click', () => {
      this.closeModal();
    });
    this.container?.querySelector('#btn-modal-cancel')?.addEventListener('click', () => {
      this.closeModal();
    });

    this.container?.querySelector('#btn-cloud-download-now')?.addEventListener('click', async () => {
      const btn = this.container?.querySelector('#btn-cloud-download-now');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Downloading (0%)...';
      }
      const res = await this.downloadAndOpenCloudBook(book.id, (current, total) => {
        if (btn) {
          const safeCurrent = Math.min(current, total);
          const pct = Math.min(100, Math.round((safeCurrent / total) * 100));
          btn.textContent = `Downloading ${pct}% (${safeCurrent}/${total})...`;
        }
      });
      if (res && (res === true || res.success)) {
        const buffer = (res && res.buffer) ? res.buffer : (this._memoryBookBuffers?.get(book.id));
        if (buffer) {
          await this.downloadBookToFile(book, buffer);
        }
        this.closeModal();
        await this.loadAndOpenBook(book.id);
      } else {
        book.has_file = false;
        this.saveLibrary();
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Download from Cloud';
        }
        this.showToast('Book pages are not stored in cloud (metadata only). Transfer via Wi-Fi or select file.');
        this.showCloudBookHelpModal(book);
      }
    });
    this.container?.querySelector('#btn-cloud-receive-pc')?.addEventListener('click', () => {
      this.closeModal();
      this.openReceiveFromPcModal();
    });
    this.container?.querySelector('#btn-cloud-pick-file')?.addEventListener('click', () => {
      this.closeModal();
      const fileInput = this.container?.querySelector('#manga-library-file-input');
      fileInput?.click();
    });
  }

  async ensurePdfJsLoaded() {
    if (typeof window !== 'undefined' && window.pdfjsLib) {
      ensurePdfWorker();
      return true;
    }
    if (typeof document !== 'undefined') {
      let attempts = 0;
      while (!window.pdfjsLib && attempts < 30) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }
      if (!window.pdfjsLib) {
        await new Promise((resolve) => {
          const script = document.createElement('script');
          const origin = window.location.origin || '';
          script.src = origin ? `${origin}/ui/vendor/pdf.min.js` : '/ui/vendor/pdf.min.js';
          script.onload = () => resolve();
          script.onerror = () => resolve();
          document.head.appendChild(script);
        });
      }
    }
    ensurePdfWorker();
    return Boolean(window.pdfjsLib);
  }

  async initPdfFromBuffer(book, arrayBuffer) {
    await this.ensurePdfJsLoaded();
    if (typeof window.pdfjsLib === 'undefined') {
      console.warn('[MangaView] pdf.js not loaded on window.');
      return;
    }
    ensurePdfWorker();
    try {
      const dataCopy = arrayBuffer.slice ? arrayBuffer.slice(0) : new Uint8Array(arrayBuffer).buffer;
      try {
        const loadingTask = window.pdfjsLib.getDocument({
          data: dataCopy,
          cMapUrl: '/ui/vendor/cmaps/',
          cMapPacked: true
        });
        this.pdfDoc = await loadingTask.promise;
      } catch (workerErr) {
        console.warn('[MangaView] Worker load failed, trying fallback without worker:', workerErr);
        const fallbackTask = window.pdfjsLib.getDocument({
          data: dataCopy,
          disableWorker: true
        });
        this.pdfDoc = await fallbackTask.promise;
      }
      book.pageCount = this.pdfDoc.numPages;
    } catch (err) {
      console.error('[MangaView] Failed to load PDF:', err);
    }
  }

  async ensureJSZipLoaded() {
    if (typeof window !== 'undefined' && window.JSZip) {
      return true;
    }
    if (typeof document !== 'undefined') {
      let attempts = 0;
      while (!window.JSZip && attempts < 30) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }
      if (!window.JSZip) {
        await new Promise((resolve) => {
          const script = document.createElement('script');
          const origin = window.location.origin || '';
          script.src = origin ? `${origin}/ui/vendor/jszip.min.js` : '/ui/vendor/jszip.min.js';
          script.onload = () => resolve();
          script.onerror = () => resolve();
          document.head.appendChild(script);
        });
      }
    }
    return Boolean(window.JSZip);
  }

  async initCbzFromBuffer(book, arrayBuffer) {
    await this.ensureJSZipLoaded();
    if (typeof window.JSZip === 'undefined') {
      console.warn('[MangaView] JSZip not loaded on window.');
      return;
    }
    try {
      const zip = new window.JSZip();
      this.cbzZip = await zip.loadAsync(arrayBuffer);

      const validExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'];
      const imageEntries = [];

      this.cbzZip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) {
          const lower = relativePath.toLowerCase();
          if (validExts.some(ext => lower.endsWith(ext))) {
            imageEntries.push(zipEntry);
          }
        }
      });

      imageEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      this.cbzImageEntries = imageEntries;
      book.pageCount = Math.max(1, imageEntries.length);
    } catch (err) {
      console.error('[MangaView] Failed to load CBZ:', err);
    }
  }

  async generateCrispCover(book, force = false) {
    if (!force && book.coverUrl && book.coverVersion === 3) return;
    ensurePdfWorker();

    try {
      const thumbCanvas = document.createElement('canvas');
      const MAX_THUMB_DIM = 200; // Fixed maximum 200px dimension to eliminate quota issues

      if (book.type === 'pdf' && this.pdfDoc) {
        const page1 = await this.pdfDoc.getPage(1);
        const vp = page1.getViewport({ scale: 1.0 });
        const scale = Math.min(MAX_THUMB_DIM / vp.width, MAX_THUMB_DIM / vp.height);
        const scaledVp = page1.getViewport({ scale });
        thumbCanvas.width = Math.round(scaledVp.width);
        thumbCanvas.height = Math.round(scaledVp.height);
        const ctx = thumbCanvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        await page1.render({ canvasContext: ctx, viewport: scaledVp }).promise;

        // Store as Blob in IndexedDB
        if (typeof thumbCanvas.toBlob === 'function') {
          thumbCanvas.toBlob(async (blob) => {
            if (blob) {
              await storeBookCover(book.id, blob);
              if (book._objectCoverUrl) URL.revokeObjectURL(book._objectCoverUrl);
              book._objectCoverUrl = URL.createObjectURL(blob);
              book.coverUrl = book._objectCoverUrl;
              book.coverVersion = 3;
              this.saveLibrary();
              const cardImg = this.container?.querySelector(`[data-book-id="${book.id}"] .manga-book-cover-img`);
              if (cardImg && book.coverUrl) cardImg.src = book.coverUrl;
            }
          }, 'image/webp', 0.85);
        } else {
          const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.85);
          await storeBookCover(book.id, dataUrl);
          book.coverUrl = dataUrl;
          book.coverVersion = 3;
          this.saveLibrary();
        }
      } else if (book.type === 'cbz' && this.cbzImageEntries.length > 0) {
        const entry = this.cbzImageEntries[0];
        const blob = await entry.async('blob');
        const url = URL.createObjectURL(blob);
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const scale = Math.min(MAX_THUMB_DIM / img.width, MAX_THUMB_DIM / img.height);
            thumbCanvas.width = Math.round(img.width * scale);
            thumbCanvas.height = Math.round(img.height * scale);
            const ctx = thumbCanvas.getContext('2d', { alpha: false });
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);

            if (typeof thumbCanvas.toBlob === 'function') {
              thumbCanvas.toBlob(async (coverBlob) => {
                if (coverBlob) {
                  await storeBookCover(book.id, coverBlob);
                  if (book._objectCoverUrl) URL.revokeObjectURL(book._objectCoverUrl);
                  book._objectCoverUrl = URL.createObjectURL(coverBlob);
                  book.coverUrl = book._objectCoverUrl;
                  book.coverVersion = 3;
                  this.saveLibrary();
                  const cardImg = this.container?.querySelector(`[data-book-id="${book.id}"] .manga-book-cover-img`);
                  if (cardImg && book.coverUrl) cardImg.src = book.coverUrl;
                }
                URL.revokeObjectURL(url);
                resolve();
              }, 'image/webp', 0.85);
            } else {
              const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.85);
              storeBookCover(book.id, dataUrl).then(() => {
                book.coverUrl = dataUrl;
                book.coverVersion = 3;
                this.saveLibrary();
                URL.revokeObjectURL(url);
                resolve();
              });
            }
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          img.src = url;
        });
      }
    } catch (e) {
      console.warn('[MangaView] Crisp cover generation error:', e);
    }
  }

  /* -------------------------------------------------------------------------
   * Page Navigation & Rendering (Supporting 2-Page Book Spreads)
   * ------------------------------------------------------------------------- */
  getNavigationStep() {
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    const isPortraitTablet = typeof window !== 'undefined' && window.innerWidth <= 1024 && window.innerHeight > window.innerWidth;
    if (isMobile || isPortraitTablet || this.spreadMode !== 'double') {
      return 1;
    }
    return 2;
  }

  nextPage(step = null) {
    if (step === null) {
      step = this.getNavigationStep();
    }
    if (this.currentPage + step <= this.pageCount) {
      this.triggerHaptic('light');
      this.goToPage(this.currentPage + step);
    } else if (this.currentPage < this.pageCount) {
      this.triggerHaptic('light');
      this.goToPage(this.pageCount);
    }
  }

  prevPage(step = null) {
    if (step === null) {
      step = this.getNavigationStep();
    }
    if (this.currentPage - step >= 1) {
      this.triggerHaptic('light');
      this.goToPage(this.currentPage - step);
    } else if (this.currentPage > 1) {
      this.triggerHaptic('light');
      this.goToPage(1);
    }
  }

  goToPage(pageNum) {
    this.currentPage = Math.max(1, Math.min(this.pageCount, pageNum));
    if (this.currentBook) {
      this.currentBook.currentPage = this.currentPage;
      this.currentBook.lastRead = Date.now();
      this.saveLibrary();
      // Enqueue to durable sync outbox & attempt immediate flush
      enqueueSyncOutbox({
        type: 'reading_progress',
        bookId: this.currentBook.id,
        payload: {
          manga_id: this.currentBook.id,
          chapter_number: 1.0,
          page_number: this.currentPage,
          completed: this.currentPage >= this.pageCount ? 1 : 0,
          last_read_at: Math.floor(Date.now() / 1000)
        }
      }).then(() => this.flushSyncOutbox()).catch(() => {});
    }
    this.clearBubbleOverlays();
    this.closePopover();

    const pageInput = this.container?.querySelector('#manga-page-input');
    if (pageInput) pageInput.value = this.currentPage;

    this.renderCurrentPage();
    this.updateBookmarkButtonState();
  }

  async renderCurrentPage() {
    const canvas = this.container?.querySelector('#manga-canvas');
    if (!canvas) return;

    if (this.currentBook?.type === 'pdf' && this.pdfDoc) {
      await this.renderPdfPages(this.currentPage, canvas);
    } else if (this.currentBook?.type === 'cbz' && this.cbzImageEntries.length > 0) {
      await this.renderCbzPages(this.currentPage, canvas);
    } else if (this.currentBook?.file) {
      await this.renderSingleImageFile(this.currentBook.file, canvas);
    }
    this.applyZoom();

    // Resolve prebaked OCR or cached bubbles for current spread (handles both single & 2-page spreads)
    this.detectedBubbles = this.resolveBubblesForCurrentPage(canvas);

    if (this.detectedBubbles && this.detectedBubbles.length > 0) {
      const cacheKey = `${this.currentBook?.id}_p${this.currentPage}_${this.spreadMode}`;
      this.bubbleCache.set(cacheKey, this.detectedBubbles);
      this.renderBubbleOverlays();
    } else {
      this.clearBubbleOverlays();
    }

    // Sync and render in-viewer annotations
    const annotCanvas = this.container?.querySelector('#manga-annotation-canvas');
    if (annotCanvas && canvas) {
      annotCanvas.width = canvas.width;
      annotCanvas.height = canvas.height;
      annotCanvas.style.width = canvas.style.width;
      annotCanvas.style.height = canvas.style.height;
      await this.loadAndRenderPageAnnotations();
    }

    this.scheduleNextPagePrefetch();
  }

  zoomIn() {
    this.zoomMode = 'custom';
    this.zoomScale = Math.min(3.0, Math.round((this.zoomScale + 0.15) * 100) / 100);
    this.applyZoom();
    this.updateCursorState();
  }

  zoomOut() {
    this.zoomMode = 'custom';
    this.zoomScale = Math.max(0.4, Math.round((this.zoomScale - 0.15) * 100) / 100);
    this.applyZoom();
    this.updateCursorState();
  }

  resetZoom() {
    this.zoomMode = 'fit';
    this.zoomScale = 1.0;
    this.applyZoom();
    this.updateCursorState();
  }

  fitWidth() {
    this.zoomMode = 'width';
    this.applyZoom();
    this.updateCursorState();
  }

  applyZoom() {
    const canvas = this.container?.querySelector('#manga-canvas');
    const label = this.container?.querySelector('#label-zoom-percent');
    if (!canvas) return;

    if (this.zoomMode === 'width') {
      const stage = this.container?.querySelector('#manga-stage-card');
      const availWidth = stage ? (stage.clientWidth - 48) : window.innerWidth;
      canvas.style.width = `${Math.max(300, availWidth)}px`;
      canvas.style.height = 'auto';
      canvas.style.maxWidth = 'none';
      canvas.style.maxHeight = 'none';
      if (label) label.textContent = 'Width';
    } else if (this.zoomMode === 'fit' && this.zoomScale === 1.0) {
      canvas.style.width = 'auto';
      canvas.style.height = 'auto';
      canvas.style.maxWidth = '100%';
      canvas.style.maxHeight = 'calc(100vh - 180px)';
      if (label) label.textContent = '100%';
    } else {
      const stage = this.container?.querySelector('#manga-stage-card');
      const stageH = stage ? (stage.clientHeight - 80) : (window.innerHeight - 180);
      const baseH = Math.max(300, stageH);
      const targetH = Math.round(baseH * this.zoomScale);
      canvas.style.height = `${targetH}px`;
      canvas.style.width = 'auto';
      canvas.style.maxWidth = 'none';
      canvas.style.maxHeight = 'none';
      if (label) label.textContent = `${Math.round(this.zoomScale * 100)}%`;
    }

    this.renderBubbleOverlays();
  }

  /* PDF Rendering (Single or 2-Page Book Spread) */
  async renderPdfPages(pageNumber, canvas) {
    const isDouble = this.spreadMode === 'double' && pageNumber < this.pageCount;

    try {
      if (!isDouble) {
        // Single Page
        this._currentSpreadLeftPageWidth = 0;
        const page = await this.pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 2.0 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const isMainCanvas = !this.container || canvas === this.container?.querySelector('#manga-canvas');
        if (isMainCanvas) this.currentImage = canvas;
      } else {
        const rightPage = await this.pdfDoc.getPage(pageNumber);
        const leftPage = await this.pdfDoc.getPage(pageNumber + 1);

        const vpR = rightPage.getViewport({ scale: 2.0 });
        const vpL = leftPage.getViewport({ scale: 2.0 });

        const totalWidth = vpR.width + vpL.width;
        const maxHeight = Math.max(vpR.height, vpL.height);
        this._currentSpreadLeftPageWidth = vpL.width;

        canvas.width = totalWidth;
        canvas.height = maxHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const offCanvasL = document.createElement('canvas');
        offCanvasL.width = vpL.width;
        offCanvasL.height = vpL.height;
        const offCtxL = offCanvasL.getContext('2d');
        await leftPage.render({ canvasContext: offCtxL, viewport: vpL }).promise;
        ctx.drawImage(offCanvasL, 0, 0);

        const offCanvasR = document.createElement('canvas');
        offCanvasR.width = vpR.width;
        offCanvasR.height = vpR.height;
        const offCtxR = offCanvasR.getContext('2d');
        await rightPage.render({ canvasContext: offCtxR, viewport: vpR }).promise;
        ctx.drawImage(offCanvasR, vpL.width, 0);

        const isMainCanvas = !this.container || canvas === this.container?.querySelector('#manga-canvas');
        if (isMainCanvas) this.currentImage = canvas;
      }
    } catch (err) {
      console.error('[MangaView] Failed to render PDF spread:', err);
    }
  }

  /* CBZ Rendering (Single or 2-Page Book Spread) */
  async renderCbzPages(pageNumber, canvas) {
    const isDouble = this.spreadMode === 'double' && pageNumber < this.cbzImageEntries.length;

    try {
      const loadImgFromEntry = async (entry) => {
        if (!entry) throw new Error('No zip entry provided');
        const ext = (entry.name || '').split('.').pop().toLowerCase();
        let mime = 'image/jpeg';
        if (ext === 'png') mime = 'image/png';
        else if (ext === 'webp') mime = 'image/webp';
        else if (ext === 'avif') mime = 'image/avif';
        else if (ext === 'gif') mime = 'image/gif';

        // 1. Try Blob first
        let blobUrl = null;
        try {
          const u8 = await entry.async('uint8array');
          const blob = new Blob([u8], { type: mime });
          blobUrl = URL.createObjectURL(blob);
          const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = blobUrl;
          });
          return {
            img,
            cleanup: () => {
              if (blobUrl) {
                setTimeout(() => {
                  try { URL.revokeObjectURL(blobUrl); } catch (_) {}
                }, 5000);
              }
            }
          };
        } catch (blobErr) {
          if (blobUrl) {
            try { URL.revokeObjectURL(blobUrl); } catch (_) {}
            blobUrl = null;
          }
          // 2. Fallback to base64 Data URL (100% reliable on iOS WebKit)
          const b64 = await entry.async('base64');
          const dataUrl = `data:${mime};base64,${b64}`;
          const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = dataUrl;
          });
          return { img, cleanup: () => {} };
        }
      };

      if (!isDouble) {
        this._currentSpreadLeftPageWidth = 0;
        const entry = this.cbzImageEntries[pageNumber - 1];
        if (!entry) throw new Error(`Page ${pageNumber} entry not found in CBZ`);
        const { img, cleanup } = await loadImgFromEntry(entry);
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        cleanup();
        const isMainCanvas = !this.container || canvas === this.container?.querySelector('#manga-canvas');
        if (isMainCanvas) this.currentImage = img;
      } else {
        const entryR = this.cbzImageEntries[pageNumber - 1];
        const entryL = this.cbzImageEntries[pageNumber];
        const [{ img: imgRight, cleanup: cleanR }, { img: imgLeft, cleanup: cleanL }] = await Promise.all([
          loadImgFromEntry(entryR),
          loadImgFromEntry(entryL)
        ]);

        const wR = imgRight.naturalWidth || imgRight.width;
        const hR = imgRight.naturalHeight || imgRight.height;
        const wL = imgLeft.naturalWidth || imgLeft.width;
        const hL = imgLeft.naturalHeight || imgLeft.height;

        const totalWidth = wL + wR;
        const maxHeight = Math.max(hL, hR);
        this._currentSpreadLeftPageWidth = wL;

        canvas.width = totalWidth;
        canvas.height = maxHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.drawImage(imgLeft, 0, 0);
        ctx.drawImage(imgRight, wL, 0);
        cleanR();
        cleanL();

        const isMainCanvas = !this.container || canvas === this.container?.querySelector('#manga-canvas');
        if (isMainCanvas) this.currentImage = canvas;
      }
    } catch (err) {
      console.error('[MangaView] Failed to render CBZ spread:', err);
    }
  }

  async renderSingleImageFile(file, canvas) {
    this._currentSpreadLeftPageWidth = 0;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        this.currentImage = img;
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  handleKeyDown(e) {
    if (this.activeMode !== 'reader') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space' && !this.isSpacePressed) {
      this.isSpacePressed = true;
      this.updateCursorState();
      e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) {
        this.redoAnnotationStroke();
      } else {
        this.undoAnnotationStroke();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      this.redoAnnotationStroke();
      return;
    }

    if (e.key === 'h' || e.key === 'H' || e.key === 'm' || e.key === 'M') {
      this.setActiveTool('move');
    } else if (e.key === 's' || e.key === 'S' || e.key === 'o' || e.key === 'O') {
      this.setActiveTool('select');
    } else if (e.key === 'p' || e.key === 'P') {
      this.setActiveTool('draw');
    } else if (e.key === 'e' || e.key === 'E') {
      this.setActiveTool('eraser');
    } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      this.nextPage();
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      this.prevPage();
    } else if (e.key === '+' || e.key === '=') {
      this.zoomIn();
    } else if (e.key === '-' || e.key === '_') {
      this.zoomOut();
    } else if (e.key === '0') {
      this.resetZoom();
    } else if (e.key === 'f' || e.key === 'F') {
      this.toggleFullscreenFocus();
    } else if (e.key === 'Meta' || e.key === 'OS' || e.code === 'MetaLeft' || e.code === 'MetaRight') {
      if (this.isFullscreenFocus) {
        this.toggleFullscreenFocus(false);
      }
    } else if (e.key === 'Escape') {
      if (this.isFullscreenFocus) {
        this.toggleFullscreenFocus(false);
      }
      this.closePopover();
      this.closeModal();
    }
  }

  async toggleFullscreenFocus(force) {
    const target = typeof force === 'boolean' ? force : !this.isFullscreenFocus;
    this.isFullscreenFocus = target;

    let success = false;
    if (window.desktopAPI?.setFullScreen) {
      try {
        await window.desktopAPI.setFullScreen(target);
        success = true;
      } catch (err) {
        console.warn('[MangaView] setFullScreen IPC error, falling back to HTML5 requestFullscreen:', err);
      }
    }
    if (!success && typeof document !== 'undefined') {
      try {
        if (target && !document.fullscreenElement) {
          await document.documentElement.requestFullscreen?.().catch(() => {});
        } else if (!target && document.fullscreenElement) {
          await document.exitFullscreen?.().catch(() => {});
        }
      } catch (e) {
        console.debug('[MangaView] HTML5 fullscreen fallback:', e);
      }
    }

    this._syncFullscreenFocusUI();
  }

  _syncFullscreenFocusUI() {
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('manga-fullscreen-active', this.isFullscreenFocus);
    }
    const label = this.container?.querySelector('#label-reader-fullscreen');
    if (label) {
      label.textContent = this.isFullscreenFocus ? 'Exit Focus' : 'Focus';
    }
    const btn = this.container?.querySelector('#btn-reader-fullscreen');
    if (btn) {
      btn.classList.toggle('is-active', this.isFullscreenFocus);
      btn.title = this.isFullscreenFocus ? 'Exit Fullscreen Focus Mode (Esc, F, or Win)' : 'Toggle Fullscreen Focus Mode (F)';
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        this.renderCurrentPage();
      });
    }
  }

  handleKeyUp(e) {
    if (e.code === 'Space') {
      this.isSpacePressed = false;
      this.updateCursorState();
    }
  }

  setActiveTool(tool) {
    this.activeTool = tool;
    const btnMove = this.container?.querySelector('#btn-tool-move');
    const btnSelect = this.container?.querySelector('#btn-tool-select');
    const btnDraw = this.container?.querySelector('#btn-tool-draw');
    const btnEraser = this.container?.querySelector('#btn-tool-eraser');
    if (btnMove) btnMove.classList.toggle('is-active', tool === 'move');
    if (btnSelect) btnSelect.classList.toggle('is-active', tool === 'select');
    if (btnDraw) btnDraw.classList.toggle('is-active', tool === 'draw');
    if (btnEraser) btnEraser.classList.toggle('is-active', tool === 'eraser');

    const btnMobileDraw = this.container?.querySelector('#btn-mobile-toggle-draw');
    if (btnMobileDraw) {
      btnMobileDraw.classList.toggle('is-active', tool === 'draw' || tool === 'eraser');
    }
    const btnAnnotPencil = this.container?.querySelector('#btn-annot-pencil');
    const btnAnnotEraser = this.container?.querySelector('#btn-annot-eraser');
    if (btnAnnotPencil) btnAnnotPencil.classList.toggle('is-active', tool === 'draw');
    if (btnAnnotEraser) btnAnnotEraser.classList.toggle('is-active', tool === 'eraser');

    const annotToolbar = this.container?.querySelector('#manga-annotation-toolbar');
    if (annotToolbar) {
      annotToolbar.style.display = (tool === 'draw' || tool === 'eraser') ? 'inline-flex' : 'none';
    }

    this.updateCursorState();
    this.updateUndoRedoButtonState();
  }

  updateCursorState() {
    const wrapper = this.container?.querySelector('#manga-canvas-wrapper');
    if (!wrapper) return;
    wrapper.classList.toggle('is-selecting-mode', this.activeTool === 'select');
    wrapper.classList.toggle('is-drawing-mode', this.activeTool === 'draw');
    wrapper.classList.toggle('is-eraser-mode', this.activeTool === 'eraser');
    const isMove = this.isSpacePressed || this.activeTool === 'move';
    if (isMove) {
      wrapper.style.cursor = this.isPanning ? 'grabbing' : 'grab';
    } else if (this.activeTool === 'draw') {
      wrapper.style.cursor = 'crosshair';
    } else if (this.activeTool === 'eraser') {
      wrapper.style.cursor = 'cell';
    } else {
      wrapper.style.cursor = 'crosshair';
    }
  }

  /* -------------------------------------------------------------------------
   * Pointer & Touch Gestures: State Machine, Pinch-to-Zoom
   * ------------------------------------------------------------------------- */
  handlePointerDown(e) {
    if (!this.currentImage) return;
    if (e.target.closest('.manga-bubble-hitbox') || e.target.closest('button') || e.target.closest('input') || e.target.closest('.manga-annotation-toolbar') || e.target.closest('.manga-mobile-actions-group')) {
      return;
    }

    this.pointerEventSupported = true;
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.activePointers.size === 1) {
      this.interactionState = 'single-pointer';
      try {
        e.target.setPointerCapture?.(e.pointerId);
      } catch (_) {}
      this.handleMouseDown(e);
    } else if (this.activePointers.size === 2) {
      this.interactionState = 'two-pointer';
      // When a second finger arrives, safely finish any in-progress drawing stroke so it is preserved!
      if (this.isDrawing) {
        this.finishAnnotationStroke();
      }
      if (this.isSelecting) {
        this.isSelecting = false;
        const box = this.container?.querySelector('#manga-selection-box');
        if (box) box.style.display = 'none';
      }
      if (this.isPanning) {
        this.isPanning = false;
        const wrapper = this.container?.querySelector('#manga-canvas-wrapper');
        wrapper?.classList.remove('is-grabbing');
        if (typeof document !== 'undefined') document.body.style.cursor = 'default';
      }
      const pts = Array.from(this.activePointers.values());
      this.pinchInitialDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.pinchInitialZoom = this.zoomScale || 1.0;
      this.pinchLastMidX = (pts[0].x + pts[1].x) / 2;
      this.pinchLastMidY = (pts[0].y + pts[1].y) / 2;
    }
  }

  handlePointerMove(e) {
    if (!this.activePointers.has(e.pointerId)) return;
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.interactionState === 'two-pointer' || this.activePointers.size === 2) {
      this.handlePinchZoom(e);
      const pts = Array.from(this.activePointers.values());
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      if (this.pinchLastMidX !== undefined && this.pinchLastMidY !== undefined) {
        const dMidX = midX - this.pinchLastMidX;
        const dMidY = midY - this.pinchLastMidY;
        const stage = this.container?.querySelector('#manga-stage-card');
        if (stage) {
          stage.scrollLeft -= dMidX;
          stage.scrollTop -= dMidY;
        }
      }
      this.pinchLastMidX = midX;
      this.pinchLastMidY = midY;
      if (e.cancelable) e.preventDefault();
    } else if (this.interactionState === 'single-pointer') {
      this.handleMouseMove(e);
    }
  }

  async handlePointerUp(e) {
    if (!this.activePointers.has(e.pointerId)) return;
    try {
      e.target.releasePointerCapture?.(e.pointerId);
    } catch (_) {}

    const wasTwoPointer = this.interactionState === 'two-pointer' || this.activePointers.size >= 2;
    this.activePointers.delete(e.pointerId);

    if (wasTwoPointer) {
      this.interactionState = 'releasing';
      if (this.pinchInitialDistance) {
        const wrapper = this.container?.querySelector('#manga-canvas-wrapper');
        if (wrapper) wrapper.style.transform = '';
        this.applyZoom();
        this.pinchInitialDistance = null;
        this.pinchInitialZoom = null;
        this.pinchLastMidX = undefined;
        this.pinchLastMidY = undefined;
      }
      if (this.activePointers.size === 0) {
        this.interactionState = 'idle';
      }
      return;
    }

    if (this.interactionState === 'single-pointer') {
      await this.handleMouseUp(e);
    }

    if (this.activePointers.size === 0) {
      this.interactionState = 'idle';
    }
  }

  handlePointerCancel(e) {
    if (this.isDrawing) {
      this.finishAnnotationStroke();
    }
    if (this.isPanning) {
      this.isPanning = false;
      const wrapper = this.container?.querySelector('#manga-canvas-wrapper');
      wrapper?.classList.remove('is-grabbing');
      if (typeof document !== 'undefined') document.body.style.cursor = 'default';
    }
    if (this.isSelecting) {
      this.isSelecting = false;
      const box = this.container?.querySelector('#manga-selection-box');
      if (box) box.style.display = 'none';
    }

    this.activePointers.clear();
    this.pinchInitialDistance = null;
    this.pinchInitialZoom = null;
    this.pinchLastMidX = undefined;
    this.pinchLastMidY = undefined;
    this.interactionState = 'idle';
    const wrapper = this.container?.querySelector('#manga-canvas-wrapper');
    if (wrapper) wrapper.style.transform = '';
  }

  handlePinchZoom(e) {
    if (!this.pinchInitialDistance) return;
    const pts = Array.from(this.activePointers.values());
    if (pts.length < 2) return;
    const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (currentDist > 10) {
      const factor = currentDist / this.pinchInitialDistance;
      const targetZoom = Math.max(0.5, Math.min(4.0, this.pinchInitialZoom * factor));
      this.zoomScale = Math.round(targetZoom * 100) / 100;
      this.zoomMode = 'custom';
      const wrapper = this.container?.querySelector('#manga-canvas-wrapper');
      if (wrapper) {
        wrapper.style.transform = `scale(${this.zoomScale})`;
      }
      this.updateZoomDisplay();
    }
  }

  /* -------------------------------------------------------------------------
   * Mouse & Touch Interaction: Smooth Canvas Drag-Pan, Selection, Annotations
   * ------------------------------------------------------------------------- */
  handleMouseDown(e) {
    if (!this.currentImage) return;
    // Prevent duplicate processing if triggered via native mousedown when pointer events handled it
    if (e.type === 'mousedown' && this.pointerEventSupported && this.activePointers.size > 0) {
      return;
    }
    const stage = this.container?.querySelector('#manga-stage-card');
    const wrapper = this.container?.querySelector('#manga-canvas-wrapper');
    if (!stage || !wrapper) return;

    if (e.target.closest('.manga-bubble-hitbox') || e.target.closest('button') || e.target.closest('input')) {
      return;
    }

    const clickedOnCanvas = e.target.closest('#manga-canvas-wrapper');

    // In-viewer Drawing Annotation
    if (clickedOnCanvas && (this.activeTool === 'draw' || this.activeTool === 'eraser') && (e.button === 0 || e.touches)) {
      this.startAnnotationStroke(e);
      e.preventDefault();
      return;
    }

    const shouldPan = e.button === 1 || this.isSpacePressed || (this.activeTool === 'move' && !e.shiftKey) || !clickedOnCanvas;

    if (shouldPan) {
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.panStartScrollLeft = stage.scrollLeft;
      this.panStartScrollTop = stage.scrollTop;
      wrapper.classList.add('is-grabbing');
      document.body.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    // OCR Marquee Selection (in 'select' tool or Shift+Drag)
    const wrapRect = wrapper.getBoundingClientRect();
    const x = e.clientX - wrapRect.left;
    const y = e.clientY - wrapRect.top;

    this.isSelecting = true;
    this.selectionStart = { x, y, clientX: e.clientX, clientY: e.clientY };
  }

  handleMouseMove(e) {
    if (this.isDrawing) {
      this.continueAnnotationStroke(e);
      return;
    }

    if (this.isPanning) {
      if (!this._panRafId) {
        const clientX = e.clientX;
        const clientY = e.clientY;
        this._panRafId = requestAnimationFrame(() => {
          this._panRafId = null;
          const stage = this.container?.querySelector('#manga-stage-card');
          if (stage) {
            const dx = clientX - this.panStartX;
            const dy = clientY - this.panStartY;
            stage.scrollLeft = this.panStartScrollLeft - dx;
            stage.scrollTop = this.panStartScrollTop - dy;
          }
        });
      }
      return;
    }

    if (!this.isSelecting || !this.selectionStart) return;
    const wrapper = this.container?.querySelector('#manga-canvas-wrapper');
    const box = this.container?.querySelector('#manga-selection-box');
    if (!wrapper || !box) return;

    const wrapRect = wrapper.getBoundingClientRect();
    const curX = e.clientX - wrapRect.left;
    const curY = e.clientY - wrapRect.top;

    const left = Math.min(this.selectionStart.x, curX);
    const top = Math.min(this.selectionStart.y, curY);
    const width = Math.abs(curX - this.selectionStart.x);
    const height = Math.abs(curY - this.selectionStart.y);

    box.style.display = 'block';
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
  }

  async handleMouseUp(e) {
    if (this.isDrawing) {
      await this.finishAnnotationStroke();
      return;
    }

    if (this._panRafId) {
      cancelAnimationFrame(this._panRafId);
      this._panRafId = null;
    }
    if (this.isPanning) {
      this.isPanning = false;
      const wrapper = this.container?.querySelector('#manga-canvas-wrapper');
      wrapper?.classList.remove('is-grabbing');
      document.body.style.cursor = '';
      this.updateCursorState();
      return;
    }

    if (!this.isSelecting || !this.selectionStart) return;
    this.isSelecting = false;

    const canvas = this.container?.querySelector('#manga-canvas');
    const wrapper = this.container?.querySelector('#manga-canvas-wrapper');
    const box = this.container?.querySelector('#manga-selection-box');
    if (box) box.style.display = 'none';
    if (!canvas || !wrapper) return;

    const canvasRect = canvas.getBoundingClientRect();

    const startClientX = this.selectionStart.clientX;
    const startClientY = this.selectionStart.clientY;
    const endClientX = e.clientX;
    const endClientY = e.clientY;

    const scaleX = canvas.width / canvasRect.width;
    const scaleY = canvas.height / canvasRect.height;

    const relStartX = Math.min(startClientX, endClientX) - canvasRect.left;
    const relStartY = Math.min(startClientY, endClientY) - canvasRect.top;
    const relEndX = Math.max(startClientX, endClientX) - canvasRect.left;
    const relEndY = Math.max(startClientY, endClientY) - canvasRect.top;

    const startX = Math.max(0, Math.min(canvas.width, relStartX * scaleX));
    const startY = Math.max(0, Math.min(canvas.height, relStartY * scaleY));
    const endX = Math.max(0, Math.min(canvas.width, relEndX * scaleX));
    const endY = Math.max(0, Math.min(canvas.height, relEndY * scaleY));

    if (endX - startX > 10 && endY - startY > 10) {
      const anchor = {
        x: Math.max(startClientX, endClientX),
        y: Math.max(startClientY, endClientY) + 8
      };
      await this.performOcrBoxSelection(startX, startY, endX, endY, anchor);
    }
  }

  /* -------------------------------------------------------------------------
   * OCR Box Crop & Recognition
   * ------------------------------------------------------------------------- */
  async performOcrBoxSelection(startX, startY, endX, endY, anchor, prebakedText = null) {
    this.ocrBoxSelection = { startX, startY, endX, endY };
    this.lastAnchor = anchor;

    const canvas = this.container?.querySelector('#manga-canvas');
    if (canvas) {
      // Add 8% adaptive padding around crop (clamped to 10-14px) for clean OCR margins
      const rawW = Math.round(endX - startX);
      const rawH = Math.round(endY - startY);
      const padX = Math.round(Math.min(rawW * 0.08, 14));
      const padY = Math.round(Math.min(rawH * 0.08, 14));

      const cropX1 = Math.max(0, startX - padX);
      const cropY1 = Math.max(0, startY - padY);
      const cropX2 = Math.min(canvas.width, endX + padX);
      const cropY2 = Math.min(canvas.height, endY + padY);

      const width = Math.round(cropX2 - cropX1);
      const height = Math.round(cropY2 - cropY1);

      // Upscale small crops so MangaOCR receives crisp, readable strokes
      const minDim = Math.min(width, height);
      let scale = 1.0;
      if (minDim < 140) {
        scale = Math.min(3.0, 180 / Math.max(1, minDim));
      }
      const targetW = Math.round(width * scale);
      const targetH = Math.round(height * scale);

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = targetW;
      cropCanvas.height = targetH;
      const cropCtx = cropCanvas.getContext('2d');
      cropCtx.fillStyle = '#FFFFFF';
      cropCtx.fillRect(0, 0, targetW, targetH);
      cropCtx.imageSmoothingEnabled = true;
      cropCtx.imageSmoothingQuality = 'high';
      cropCtx.drawImage(canvas, cropX1, cropY1, width, height, 0, 0, targetW, targetH);

      this.activeCropDataUrl = cropCanvas.toDataURL('image/png');
    }

    if (prebakedText && typeof prebakedText === 'string' && prebakedText.trim()) {
      if (this.inspectorMode === 'popover') {
        this.openPopover(anchor);
      } else {
        this.openSidebar();
      }
      await this.processRecognizedSentence(prebakedText.trim(), anchor);
      return;
    }

    if (!canvas || !this.activeCropDataUrl) return;
    const base64Data = this.activeCropDataUrl.split(',')[1];

    if (this.inspectorMode === 'sidebar') {
      this.openSidebar();
      const expEl = this.container?.querySelector('#manga-target-expression');
      if (expEl) expEl.textContent = '...';
      const sidebarSentenceEl = this.container?.querySelector('#manga-sidebar-sentence-text');
      if (sidebarSentenceEl) {
        sidebarSentenceEl.innerHTML = `<span class="text-xs text-muted">Running OCR recognition...</span>`;
      }
    } else {
      this.openPopover(anchor);
      const sentenceEl = this.container?.querySelector('#manga-popover-sentence');
      if (sentenceEl) {
        sentenceEl.innerHTML = `<span class="text-xs text-muted">Running OCR recognition...</span>`;
      }
    }

    try {
      const cropKey = `${this.currentBook?.id}_p${this.currentPage}_${base64Data.slice(0, 48)}_${base64Data.length}`;
      if (this.ocrTextCache.has(cropKey)) {
        this.recognizedText = this.ocrTextCache.get(cropKey);
        await this.processRecognizedSentence(this.recognizedText, anchor);
        return;
      }

      const res = await this.apiClient.request('/api/ocr/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Data })
      });

      if (res && res.text) {
        this.recognizedText = res.text.trim();
        this.ocrTextCache.set(cropKey, this.recognizedText);
        await this.processRecognizedSentence(this.recognizedText, anchor);
      } else {
        this.renderOcrError('No text detected in selected region');
      }
    } catch (err) {
      console.warn('[MangaView] OCR recognition failed:', err);
      this.renderOcrError('OCR recognition failed');
    }
  }

  async processRecognizedSentence(sentence, anchor) {
    if (!sentence) return;
    this.recognizedText = sentence;

    // 1. Tokenize sentence using Subtitle Annotator API (Sudachi / MeCab / OpenJLPT)
    let tokens = [];
    try {
      const annotateRes = await this.apiClient.annotateText(sentence);
      if (annotateRes && annotateRes.cues && annotateRes.cues[0] && Array.isArray(annotateRes.cues[0].tokens)) {
        tokens = annotateRes.cues[0].tokens;
      }
    } catch (err) {
      console.debug('[MangaView] annotateText fallback to tokenize:', err);
    }

    // 2. High-fidelity Morphological Tokenizer (Offline WASM Sudachi / desktopAPI / Cloud /api/tokenize)
    if (!tokens || tokens.length === 0) {
      try {
        const tokRes = await this.apiClient.tokenize(sentence, 'C');
        if (tokRes && Array.isArray(tokRes.tokens) && tokRes.tokens.length > 0) {
          tokens = tokRes.tokens.map(t => ({
            surface: t.surface || t.surface_form || t.text || '',
            lemma: t.dictionary_form || t.lemma || t.normalized || t.surface || '',
            reading: t.reading || t.reading_form || '',
            pos: Array.isArray(t.part_of_speech) ? t.part_of_speech.join(', ') : (t.part_of_speech || t.pos || '')
          }));
        }
      } catch (tokErr) {
        console.debug('[MangaView] tokenize fallback to regex:', tokErr);
      }
    }

    // 3. Fallback: if tokenization is completely unavailable, use regex tokenizer
    if (!tokens || tokens.length === 0) {
      const matches = sentence.match(/[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]+|[^\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff\s]+/g) || [sentence];
      tokens = matches.map(word => ({
        surface: word,
        lemma: word,
        reading: '',
        pos: ''
      }));
    }

    this.recognizedTokens = tokens;
    this.renderSentenceWords(tokens, sentence);

    // Auto-inspect primary word: prefer first token with kanji or length > 1, otherwise tokens[0]
    let primaryToken = tokens.find(t => {
      const surface = t.surface || t.text || '';
      return /[\u4e00-\u9faf]/.test(surface) && surface.length > 0;
    }) || tokens.find(t => {
      const surface = t.surface || t.text || '';
      return surface.trim().length > 1;
    }) || tokens[0];

    if (primaryToken) {
      await this.inspectToken(primaryToken);
    }
  }

  renderSentenceWords(tokens, fullSentence) {
    const sidebarSentenceEl = this.container?.querySelector('#manga-sidebar-sentence-text');
    const popSentenceEl = this.container?.querySelector('#manga-popover-sentence');

    const renderTo = (container) => {
      if (!container) return;
      container.innerHTML = '';
      if (!tokens || tokens.length === 0) {
        container.textContent = fullSentence;
        return;
      }

      tokens.forEach((token, idx) => {
        const surface = (token.surface || token.text || '').trim();
        if (!surface) return;

        const span = document.createElement('span');
        span.className = 'manga-clickable-word';
        if (!span.dataset) span.dataset = {};
        span.dataset.tokenIndex = idx;
        span.title = `Click to inspect "${surface}"`;

        const hasKanji = /[\u4e00-\u9faf]/.test(surface);
        const rawReading = token.reading || '';
        const hiraganaReading = rawReading ? katakanaToHiragana(rawReading) : '';

        if (hasKanji && hiraganaReading && hiraganaReading !== surface) {
          span.innerHTML = `<ruby class="manga-ruby">${escapeHtml(surface)}<rt class="manga-ruby-rt">${escapeHtml(hiraganaReading)}</rt></ruby>`;
        } else {
          span.textContent = surface;
        }

        span.addEventListener('click', (e) => {
          e.stopPropagation();
          this.inspectToken(token, span);
        });

        container.appendChild(span);
      });
    };

    renderTo(sidebarSentenceEl);
    renderTo(popSentenceEl);
    this.updateFuriganaUI();
  }

  openEditSentenceModal() {
    if (!this.recognizedText) return;

    this.showModal(`
      <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
        <div class="tactile-modal-card">
          <h3 class="text-base font-bold text-warm-paper">Edit Bubble Text</h3>
          <p class="text-xs text-muted mt-1">
            Fix any OCR character misrecognitions or customize the sentence:
          </p>
          <div class="mt-3">
            <textarea id="modal-sentence-input" class="tactile-input-text w-full font-japanese" rows="3" autofocus>${escapeHtml(this.recognizedText)}</textarea>
          </div>
          <div class="modal-actions-row mt-4 justify-between">
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-modal-cancel">Cancel</button>
            <button type="button" class="tactile-btn tactile-btn-gold tactile-btn-sm" id="btn-modal-save-sentence">Update Text</button>
          </div>
        </div>
      </div>
    `, () => {
      const saveBtn = this.container.querySelector('#btn-modal-save-sentence');
      const input = this.container.querySelector('#modal-sentence-input');
      const doSave = async () => {
        const text = input?.value?.trim();
        if (text) {
          this.recognizedText = text;
          this.closeModal();
          await this.processRecognizedSentence(this.recognizedText, this.lastAnchor);
        }
      };
      saveBtn?.addEventListener('click', doSave);
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doSave();
      });
    });
  }

  async inspectToken(token, chipEl = null) {
    if (!token) return;
    this.activeToken = token;

    const targetWord = (token.lemma || token.surface || token.text || '').trim();
    if (!targetWord) return;

    // Highlight all matching clickable word spans in both sidebar and popover
    const allWords = this.container?.querySelectorAll('.manga-clickable-word') || [];
    allWords.forEach(w => {
      const isMatch = w.textContent.trim() === (token.surface || token.text || '').trim();
      w.classList.toggle('is-active', isMatch);
    });

    // Show Word and Definitions sections in Sidebar
    const wordSection = this.container?.querySelector('#manga-word-section');
    const defSection = this.container?.querySelector('#manga-definitions-section');
    const kanjiSection = this.container?.querySelector('#manga-kanji-section');
    const expEl = this.container?.querySelector('#manga-target-expression');
    const readEl = this.container?.querySelector('#manga-target-reading');
    const jlptEl = this.container?.querySelector('#manga-target-jlpt');
    const defsList = this.container?.querySelector('#manga-definitions-list');
    const kanjiGrid = this.container?.querySelector('#manga-kanji-cards-grid');
    const mineBtn = this.container?.querySelector('#btn-sidebar-mine-card');
    const mineLabel = this.container?.querySelector('#label-sidebar-mine-card');

    if (wordSection) wordSection.style.display = 'flex';
    if (defSection) defSection.style.display = 'flex';
    if (expEl) expEl.textContent = targetWord;
    if (readEl) {
      if (shouldShowReading(targetWord, token.reading)) {
        readEl.textContent = token.reading;
        readEl.style.display = 'block';
      } else {
        readEl.textContent = '';
        readEl.style.display = 'none';
      }
    }
    if (jlptEl) {
      if (token.jlpt_level) {
        jlptEl.textContent = token.jlpt_level;
        jlptEl.style.display = 'inline-block';
      } else {
        jlptEl.style.display = 'none';
      }
    }

    if (mineBtn) {
      mineBtn.classList.remove('is-mined');
      mineBtn.disabled = false;
      if (mineLabel) mineLabel.textContent = `Save`;
    }

    if (defsList) {
      defsList.innerHTML = `<span class="text-xs text-muted">Looking up dictionary senses...</span>`;
    }
    if (kanjiGrid && kanjiSection) {
      kanjiSection.style.display = 'none';
      kanjiGrid.innerHTML = '';
    }

    // Also update popover if in popover mode
    const popoverLookup = this.container?.querySelector('#manga-popover-lookup');
    if (popoverLookup) {
      popoverLookup.innerHTML = `<span class="text-xs text-muted">Looking up ${escapeHtml(targetWord)}...</span>`;
    }

    try {
      const captureData = await this.apiClient.captureText(targetWord);
      this.activeCaptureData = captureData;

      const reading = captureData.reading || token.reading || '';
      const meaning = captureData.meaning || '';
      const jlpt = captureData.jlpt_level || token.jlpt_level;

      if (readEl) {
        if (shouldShowReading(targetWord, reading)) {
          readEl.textContent = reading;
          readEl.style.display = 'block';
        } else {
          readEl.textContent = '';
          readEl.style.display = 'none';
        }
      }
      if (jlptEl && jlpt) {
        jlptEl.textContent = jlpt;
        jlptEl.style.display = 'inline-block';
      }

      // Render definitions in Sidebar
      if (defsList) {
        const rawEntries = (Array.isArray(captureData.entries) && captureData.entries.length > 0)
          ? captureData.entries
          : (Array.isArray(captureData.dictionary_entries) && captureData.dictionary_entries.length > 0 ? captureData.dictionary_entries : []);

        if (rawEntries.length > 0) {
          const renderedSenses = [];
          rawEntries.slice(0, 4).forEach((entry) => {
            const senses = (Array.isArray(entry.senses) && entry.senses.length > 0)
              ? entry.senses
              : (Array.isArray(entry.meanings) ? entry.meanings.map(m => ({ glosses: [m], parts_of_speech: [] })) : []);

            senses.forEach((s, sIdx) => {
              const glossList = Array.isArray(s.glosses) ? s.glosses : (s.gloss ? [s.gloss] : []);
              const glosses = glossList.join('; ');
              if (!glosses) return;
              const pos = Array.isArray(s.parts_of_speech) ? s.parts_of_speech.join(', ') : (s.parts_of_speech || '');
              renderedSenses.push(`
                <div class="manga-definition-row">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-mono text-gold font-bold">${renderedSenses.length + 1}.</span>
                    ${pos ? `<span class="text-xs text-muted">(${escapeHtml(pos)})</span>` : ''}
                  </div>
                  <div class="manga-def-text">${escapeHtml(glosses)}</div>
                </div>
              `);
            });
          });

          defsList.innerHTML = renderedSenses.length > 0
            ? renderedSenses.join('')
            : `<div class="text-xs text-muted">${escapeHtml(meaning || 'No definitions found')}</div>`;
        } else if (meaning) {
          const lines = meaning.split(/(?:\n|\s*(?=\b\d+\.\s+))/).map(l => l.trim()).filter(Boolean);
          defsList.innerHTML = lines.map((l) => {
            const match = l.match(/^(\d+)\.\s*(.*)$/);
            if (match) {
              return `
                <div class="manga-definition-row">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-mono text-gold font-bold">${match[1]}.</span>
                  </div>
                  <div class="manga-def-text">${escapeHtml(match[2])}</div>
                </div>
              `;
            }
            return `
              <div class="manga-definition-row">
                <div class="manga-def-text">${escapeHtml(l)}</div>
              </div>
            `;
          }).join('');
        } else {
          defsList.innerHTML = `<span class="text-xs text-muted">No dictionary definitions found for "${escapeHtml(targetWord)}"</span>`;
        }
      }

      // Render Kanji Breakdown in Sidebar (Clickable to open Kanji tab without closing reader)
      if (kanjiGrid && kanjiSection && captureData.kanji_entries && captureData.kanji_entries.length > 0) {
        kanjiSection.style.display = 'flex';
        kanjiGrid.innerHTML = captureData.kanji_entries.map(k => `
          <button type="button" class="manga-kanji-card" data-character="${escapeHtml(k.character)}" title="Open ${escapeHtml(k.character)} in Kanji Tab">
            <div class="manga-kanji-char font-japanese">${escapeHtml(k.character)}</div>
            <div class="manga-kanji-meaning">${escapeHtml((k.meanings || []).slice(0, 3).join(', '))}</div>
            <div class="manga-kanji-readings font-japanese">${escapeHtml([...(k.onyomi || []), ...(k.kunyomi || [])].slice(0, 3).join(' • '))}</div>
          </button>
        `).join('');
      }

      // Render into floating popover
      if (popoverLookup) {
        const defsHtml = formatDefinitionsHtml(captureData);
        popoverLookup.innerHTML = `
          <div class="manga-dict-entry">
            <div class="flex items-center justify-between">
              <div class="flex flex-col">
                <span class="text-xs text-gold font-japanese">${escapeHtml(reading)}</span>
                <span class="font-bold text-accent text-base font-japanese">${escapeHtml(targetWord)}</span>
              </div>
              <button type="button" 
                class="tactile-btn tactile-btn-gold tactile-btn-sm btn-manga-mine-word" 
                data-word="${escapeHtml(targetWord)}" 
                data-reading="${escapeHtml(reading)}" 
                data-meaning="${escapeHtml(meaning)}">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                <span>Save</span>
              </button>
            </div>
            ${defsHtml}
          </div>
        `;
      }
    } catch (err) {
      console.warn('[MangaView] captureText error:', err);
      if (defsList) {
        defsList.innerHTML = `<span class="text-xs text-muted">Definitions unavailable</span>`;
      }
      if (popoverLookup) {
        popoverLookup.innerHTML = `<span class="text-xs text-muted">Dictionary lookup unavailable</span>`;
      }
    }
  }

  async mineActiveWord() {
    if (!this.activeToken) return;
    const word = (this.activeToken.lemma || this.activeToken.surface || this.activeToken.text || '').trim();
    if (!word) return;

    const reading = this.activeCaptureData?.reading || this.activeToken.reading || '';
    const meaning = this.activeCaptureData?.meaning || '';
    const sentence = this.recognizedText || '';

    const mineBtn = this.container?.querySelector('#btn-sidebar-mine-card');
    const mineLabel = this.container?.querySelector('#label-sidebar-mine-card');
    if (mineBtn) {
      mineBtn.disabled = true;
      if (mineLabel) mineLabel.textContent = 'Saving...';
    }

    try {
      const targetDeck = await getUniversalAnkiDeck();
      if (!targetDeck) {
        throw new Error('No Anki deck selected. Please choose a deck in Settings.');
      }

      const cardPayload = {
        expression: word,
        reading: reading || word,
        meaning: meaning,
        example_sentence: sentence,
        sentence: sentence,
        image_url: this.activeCropDataUrl || '',
        image_data: this.activeCropDataUrl || '',
        source: 'manga',
        source_type: 'manga',
        source_title: this.currentBook?.title || 'Manga',
        deck_name: targetDeck,
        tags: 'kiroku,manga'
      };

      let saveRes = null;
      if (typeof this.apiClient.saveAndSyncCard === 'function') {
        saveRes = await this.apiClient.saveAndSyncCard(cardPayload);
      } else if (typeof this.apiClient.saveCard === 'function') {
        saveRes = await this.apiClient.saveCard(cardPayload);
      } else {
        saveRes = await this.apiClient.request('/api/cards/save', {
          method: 'POST',
          body: cardPayload
        });
      }

      if (!this.knownWordsSet) this.knownWordsSet = new Set();
      this.knownWordsSet.add(word);

      // Mark word as known in background
      try {
        if (typeof this.apiClient.markKnownWord === 'function') {
          await this.apiClient.markKnownWord(word);
        }
      } catch (err) {
        console.debug('[MangaView] Mark known fallback:', err);
      }

      const isDup = Boolean(saveRes?.is_duplicate || saveRes?.status === 'already_saved');
      if (mineBtn) {
        mineBtn.classList.add('is-mined');
        mineBtn.disabled = true;
        if (mineLabel) mineLabel.textContent = isDup ? 'Already Saved' : '✓ Saved';
      }
      this.lastMinedWord = word;
    } catch (err) {
      console.warn('[MangaView] Mining failed:', err);
      if (mineBtn) {
        mineBtn.disabled = false;
        if (mineLabel) mineLabel.textContent = 'Retry Save';
      }
    }
  }

  speakWord(text = null) {
    const word = text || (this.activeToken?.lemma || this.activeToken?.surface || this.activeToken?.text || '');
    if (!word || typeof window === 'undefined' || !window.speechSynthesis) return;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = 'ja-JP';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.debug('[MangaView] Speech synthesis error:', err);
    }
  }

  async copySentence() {
    const text = this.recognizedText;
    if (!text) return;
    const btn = this.container?.querySelector('#btn-copy-sentence');
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span>Copied!</span>`;
        setTimeout(() => { btn.innerHTML = originalText; }, 1500);
      }
    } catch (err) {
      console.debug('[MangaView] Clipboard error:', err);
    }
  }

  openSidebar() {
    this.sidebarVisible = true;
    const sidebar = this.container?.querySelector('#manga-study-sidebar');
    if (sidebar) sidebar.style.display = 'flex';
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
    raf(() => {
      this.applyZoom();
      this.renderBubbleOverlays();
    });
  }

  closeSidebar() {
    this.sidebarVisible = false;
    const sidebar = this.container?.querySelector('#manga-study-sidebar');
    if (sidebar) sidebar.style.display = 'none';
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
    raf(() => {
      this.applyZoom();
      this.renderBubbleOverlays();
    });
  }

  toggleSidebar() {
    if (this.sidebarVisible) {
      this.closeSidebar();
    } else {
      this.openSidebar();
    }
  }

  switchInspectorMode() {
    if (this.inspectorMode === 'sidebar') {
      this.inspectorMode = 'popover';
      this.closeSidebar();
      if (this.lastAnchor) {
        this.openPopover(this.lastAnchor);
      }
    } else {
      this.inspectorMode = 'sidebar';
      this.closePopover();
      this.openSidebar();
      if (this.recognizedText) {
        const sidebarSentenceEl = this.container?.querySelector('#manga-sidebar-sentence-text');
        if (sidebarSentenceEl && (!sidebarSentenceEl.children.length || sidebarSentenceEl.querySelector('.text-muted'))) {
          this.renderSentenceWords(this.recognizedTokens, this.recognizedText);
        }
      }
      if (this.activeToken) {
        const activeWordSpan = this.container?.querySelector(`.manga-clickable-word[data-token-index="${this.activeTokenIndex}"]`);
        this.lookupSidebarWord(this.activeToken, activeWordSpan);
      }
    }
  }

  renderOcrError(msg) {
    const sentenceEl = this.container?.querySelector('#manga-popover-sentence');
    if (sentenceEl) sentenceEl.innerHTML = `<span class="text-xs text-danger">${escapeHtml(msg)}</span>`;
    const tokenContainer = this.container?.querySelector('#manga-sentence-tokens-container');
    if (tokenContainer) tokenContainer.innerHTML = `<span class="text-xs text-danger">${escapeHtml(msg)}</span>`;
  }

  /* -------------------------------------------------------------------------
   * Automatic Speech Bubble Detection (AI)
   * ------------------------------------------------------------------------- */
  async detectBubblesOnCurrentPage() {
    const canvas = this.container?.querySelector('#manga-canvas');
    const btn = this.container?.querySelector('#btn-detect-bubbles');
    const label = this.container?.querySelector('#label-detect-bubbles');
    if (!canvas || this.isAutoDetecting) return;

    const cacheKey = `${this.currentBook?.id}_p${this.currentPage}_${this.spreadMode}`;

    // 1. If bubbles are in bubbleCache, prefetchOcrCache, or prebakedOcrMap, restore them immediately
    let candidateBubbles = [];
    if (this.bubbleCache.has(cacheKey) && (this.bubbleCache.get(cacheKey) || []).length > 0) {
      candidateBubbles = this.bubbleCache.get(cacheKey);
    } else {
      candidateBubbles = this.resolveBubblesForCurrentPage(canvas) || [];
    }

    if (candidateBubbles && candidateBubbles.length > 0) {
      this.detectedBubbles = candidateBubbles;
      this.bubbleCache.set(cacheKey, candidateBubbles);
      this.renderBubbleOverlays();
      if (label) {
        label.textContent = `${this.detectedBubbles.length} Bubbles Found`;
      }
      return;
    }

    const isCloud = typeof window !== 'undefined' && Boolean(
      window.location?.hostname?.includes('workers.dev') ||
      window.location?.hostname?.includes('pages.dev') ||
      (!window.desktopAPI?.isDesktop && window.location?.protocol === 'https:')
    );

    // 2. On Cloud / Web PWA: There is no local MangaOCR engine running.
    // Try fetching pre-baked OCR for this book from cloud server if not yet loaded.
    if (isCloud) {
      if (label) label.textContent = 'Checking Cloud...';
      try {
        await this.loadPrebakedOcrForBook(this.currentBook?.id);
        const resolved = this.resolveBubblesForCurrentPage(canvas);
        if (resolved && resolved.length > 0) {
          this.detectedBubbles = resolved;
          this.bubbleCache.set(cacheKey, resolved);
          this.renderBubbleOverlays();
          if (label) label.textContent = `${resolved.length} Bubbles Found`;
          return;
        }
      } catch (_) {}

      if (label) label.textContent = 'No Bubbles Pre-baked';
      this.showToast('No pre-baked OCR bubbles found for this page. Bake OCR on Desktop to view on Cloud.');
      if (this._detectTimeoutId) clearTimeout(this._detectTimeoutId);
      this._detectTimeoutId = setTimeout(() => {
        if (label && !this.isAutoDetecting) label.textContent = 'Detect Bubbles (AI)';
        this._detectTimeoutId = null;
      }, 3000);
      return;
    }

    // 3. On Desktop: Run live OCR bubble detection via local Python backend
    this.isAutoDetecting = true;
    if (label) label.textContent = 'Detecting...';
    if (btn) btn.disabled = true;

    try {
      const fullPageB64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      const res = await this.apiClient.request('/api/ocr/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: fullPageB64, conf_threshold: 0.35 })
      });

      if (res && Array.isArray(res.boxes)) {
        this.detectedBubbles = res.boxes;
        this.bubbleCache.set(cacheKey, res.boxes);
        this.prefetchOcrCache.set(cacheKey, res.boxes);
        this.renderBubbleOverlays();
        if (label) {
          label.textContent = res.boxes.length > 0 ? `${res.boxes.length} Bubbles Found` : 'No Bubbles Found';
        }
      } else {
        if (label) label.textContent = 'No Bubbles Found';
      }
    } catch (err) {
      console.warn('[MangaView] Bubble detection failed:', err);
      if (label) label.textContent = 'Detection Failed';
    } finally {
      this.isAutoDetecting = false;
      if (btn) btn.disabled = false;
      if (this._detectTimeoutId) {
        clearTimeout(this._detectTimeoutId);
      }
      this._detectTimeoutId = setTimeout(() => {
        if (label && !this.isAutoDetecting) {
          label.textContent = 'Detect Bubbles (AI)';
        }
        this._detectTimeoutId = null;
      }, 3000);
    }
  }

  resolveBubblesForCurrentPage(canvas) {
    if (!this.currentBook) return [];

    const bookId = this.currentBook.id;
    const isDouble = this.spreadMode === 'double' && this.currentPage < this.pageCount;
    const spreadCacheKey = `${bookId}_p${this.currentPage}_${this.spreadMode}`;

    // 1. If dynamic detection exists for this exact spread mode, prefer it
    if (this.bubbleCache.has(spreadCacheKey)) {
      return this.bubbleCache.get(spreadCacheKey) || [];
    }
    if (this.prefetchOcrCache.has(spreadCacheKey)) {
      return this.prefetchOcrCache.get(spreadCacheKey) || [];
    }

    // 2. Single page mode (or last remaining page of a volume)
    if (!isDouble) {
      const singleKey = `${bookId}_p${this.currentPage}`;
      return this.prebakedOcrMap.get(singleKey) || [];
    }

    // 3. Double page mode (2-Page Spread)
    // In Japanese manga (RTL):
    // Right page is currentPage (read 1st)
    // Left page is currentPage + 1 (read 2nd)
    const rightKey = `${bookId}_p${this.currentPage}`;
    const leftKey = `${bookId}_p${this.currentPage + 1}`;
    const rightBubbles = this.prebakedOcrMap.get(rightKey) || [];
    const leftBubbles = this.prebakedOcrMap.get(leftKey) || [];

    if (rightBubbles.length === 0 && leftBubbles.length === 0) {
      return [];
    }

    const leftPageWidth = this._currentSpreadLeftPageWidth || (canvas ? Math.round(canvas.width / 2) : 0);
    const canvasWidth = canvas?.width || (leftPageWidth * 2);
    const canvasHeight = canvas?.height || 0;

    const mappedBubbles = [];

    // Right page bubbles (read 1st in Japanese manga, offset by leftPageWidth on canvas)
    rightBubbles.forEach(b => {
      const box = Array.isArray(b.box)
        ? b.box
        : (b.box ? [b.box.x, b.box.y, b.box.x + (b.box.w || b.box.width || 0), b.box.y + (b.box.h || b.box.height || 0)]
                 : [b.x || 0, b.y || 0, (b.x || 0) + (b.w || b.width || 0), (b.y || 0) + (b.h || b.height || 0)]);
      const [x1, y1, x2, y2] = box;
      const baseW = b.page_width || (canvasWidth - leftPageWidth);
      const baseH = b.page_height || canvasHeight;

      const rightPageRenderWidth = canvasWidth - leftPageWidth;
      const scaleX = (baseW > 0 && rightPageRenderWidth > 0) ? (rightPageRenderWidth / baseW) : 1;
      const scaleY = (baseH > 0 && canvasHeight > 0) ? (canvasHeight / baseH) : 1;

      mappedBubbles.push({
        ...b,
        box: [
          Math.round(x1 * scaleX + leftPageWidth),
          Math.round(y1 * scaleY),
          Math.round(x2 * scaleX + leftPageWidth),
          Math.round(y2 * scaleY)
        ],
        page_width: canvasWidth,
        page_height: canvasHeight
      });
    });

    // Left page bubbles (read 2nd in Japanese manga, x starts at 0)
    leftBubbles.forEach(b => {
      const box = Array.isArray(b.box)
        ? b.box
        : (b.box ? [b.box.x, b.box.y, b.box.x + (b.box.w || b.box.width || 0), b.box.y + (b.box.h || b.box.height || 0)]
                 : [b.x || 0, b.y || 0, (b.x || 0) + (b.w || b.width || 0), (b.y || 0) + (b.h || b.height || 0)]);
      const [x1, y1, x2, y2] = box;
      const baseW = b.page_width || leftPageWidth;
      const baseH = b.page_height || canvasHeight;

      const scaleX = (baseW > 0 && leftPageWidth > 0) ? (leftPageWidth / baseW) : 1;
      const scaleY = (baseH > 0 && canvasHeight > 0) ? (canvasHeight / baseH) : 1;

      mappedBubbles.push({
        ...b,
        box: [
          Math.round(x1 * scaleX),
          Math.round(y1 * scaleY),
          Math.round(x2 * scaleX),
          Math.round(y2 * scaleY)
        ],
        page_width: canvasWidth,
        page_height: canvasHeight
      });
    });

    return mappedBubbles;
  }

  renderBubbleOverlays() {
    const overlayLayer = this.container?.querySelector('#manga-bubble-overlay-layer');
    const canvas = this.container?.querySelector('#manga-canvas');
    if (!overlayLayer || !canvas) return;

    overlayLayer.innerHTML = '';
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    const fragment = document.createDocumentFragment();

    this.detectedBubbles.forEach((bubble, idx) => {
      const box = Array.isArray(bubble.box)
        ? bubble.box
        : (bubble.box
          ? [bubble.box.x, bubble.box.y, bubble.box.x + (bubble.box.w || bubble.box.width || 0), bubble.box.y + (bubble.box.h || bubble.box.height || 0)]
          : [bubble.x || 0, bubble.y || 0, (bubble.x || 0) + (bubble.w || bubble.width || 0), (bubble.y || 0) + (bubble.h || bubble.height || 0)]);
      const [x1, y1, x2, y2] = box;

      const baseW = bubble.page_width || canvas.width;
      const baseH = bubble.page_height || canvas.height;
      const itemScaleX = rect.width / baseW;
      const itemScaleY = rect.height / baseH;

      const left = x1 * itemScaleX;
      const top = y1 * itemScaleY;
      const width = (x2 - x1) * itemScaleX;
      const height = (y2 - y1) * itemScaleY;

      // Visual UI-only padding: expands the visual overlay box so the border breathes
      // around the speech bubble and does not collide with Japanese text.
      // OCR crop coordinates (cropX1, cropY1, cropX2, cropY2) remain exact and unchanged.
      const uiPadX = Math.max(5, Math.min(10, Math.round(width * 0.06)));
      const uiPadY = Math.max(5, Math.min(10, Math.round(height * 0.05)));

      const displayLeft = Math.max(0, left - uiPadX);
      const displayTop = Math.max(0, top - uiPadY);
      const displayWidth = Math.min(rect.width - displayLeft, width + (uiPadX * 2));
      const displayHeight = Math.min(rect.height - displayTop, height + (uiPadY * 2));

      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'manga-bubble-hitbox';
      if (this.selectedBubbleIndex === idx) {
        bubbleEl.classList.add('is-selected');
      }
      bubbleEl.style.left = `${displayLeft}px`;
      bubbleEl.style.top = `${displayTop}px`;
      bubbleEl.style.width = `${displayWidth}px`;
      bubbleEl.style.height = `${displayHeight}px`;
      bubbleEl.title = `Bubble ${idx + 1} (${Math.round((bubble.score || 0.95) * 100)}%) — Click to OCR`;

      bubbleEl.innerHTML = `<span class="manga-bubble-tag">${idx + 1}</span>`;

      bubbleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.triggerHaptic('medium');
        this.selectedBubbleIndex = idx;
        overlayLayer.querySelectorAll('.manga-bubble-hitbox').forEach(b => b.classList.remove('is-selected'));
        bubbleEl.classList.add('is-selected');

        const anchor = {
          x: displayLeft + rect.left,
          y: displayTop + displayHeight + rect.top + 8
        };
        const cropX1 = (x1 / baseW) * canvas.width;
        const cropY1 = (y1 / baseH) * canvas.height;
        const cropX2 = (x2 / baseW) * canvas.width;
        const cropY2 = (y2 / baseH) * canvas.height;
        this.performOcrBoxSelection(cropX1, cropY1, cropX2, cropY2, anchor, bubble.text);
      });

      fragment.appendChild(bubbleEl);
    });

    overlayLayer.appendChild(fragment);
  }

  clearBubbleOverlays() {
    if (this._detectTimeoutId) {
      clearTimeout(this._detectTimeoutId);
      this._detectTimeoutId = null;
    }
    const label = this.container?.querySelector('#label-detect-bubbles');
    if (label) {
      label.textContent = 'Detect Bubbles (AI)';
    }
    const btn = this.container?.querySelector('#btn-detect-bubbles');
    if (btn && !this.isAutoDetecting) {
      btn.disabled = false;
    }
    this.detectedBubbles = [];
    this.selectedBubbleIndex = -1;
    const overlayLayer = this.container?.querySelector('#manga-bubble-overlay-layer');
    if (overlayLayer) overlayLayer.innerHTML = '';
  }

  /* -------------------------------------------------------------------------
   * Floating Popover & Yomitan Dictionary Lookup
   * ------------------------------------------------------------------------- */
  openPopover(anchor) {
    const popover = this.container?.querySelector('#manga-floating-popover');
    if (!popover) return;

    this.popoverVisible = true;
    popover.style.display = 'flex';

    const popWidth = Math.min(350, window.innerWidth - 24);
    const popHeight = 300;
    popover.style.width = `${popWidth}px`;
    let posX = Math.max(12, Math.min(window.innerWidth - popWidth - 12, anchor ? anchor.x : 50));
    let posY = Math.max(50, Math.min(window.innerHeight - popHeight - 60, anchor ? anchor.y : 100));

    popover.style.left = `${posX}px`;
    popover.style.top = `${posY}px`;
  }

  closePopover() {
    this.popoverVisible = false;
    const popover = this.container?.querySelector('#manga-floating-popover');
    if (popover) popover.style.display = 'none';
  }

  setupPopoverDrag() {
    const popover = this.container?.querySelector('#manga-floating-popover');
    const header = this.container?.querySelector('#manga-popover-header');
    if (!popover || !header) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onPointerDown = (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      header.style.cursor = 'grabbing';
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = popover.offsetLeft;
      initialTop = popover.offsetTop;

      const onPointerMove = (ev) => {
        if (!isDragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        const maxLeft = Math.max(10, window.innerWidth - popover.offsetWidth - 10);
        const maxTop = Math.max(10, window.innerHeight - popover.offsetHeight - 10);

        const newLeft = Math.max(10, Math.min(maxLeft, initialLeft + dx));
        const newTop = Math.max(10, Math.min(maxTop, initialTop + dy));

        popover.style.left = `${newLeft}px`;
        popover.style.top = `${newTop}px`;
      };

      const onPointerUp = () => {
        isDragging = false;
        header.style.cursor = 'grab';
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);
      if (e.cancelable) e.preventDefault();
    };

    header.addEventListener('mousedown', onPointerDown);
    header.addEventListener('pointerdown', onPointerDown);
  }

  async openKanjiInTab(char) {
    if (!char) return;
    const cleanChar = char.trim()[0];
    if (!cleanChar) return;

    const router = this.router || (typeof window !== 'undefined' && (window.router || window.__desktopApp?.router));
    if (router && typeof router.navigateToTab === 'function') {
      await router.navigateToTab('kanji');
      const kanjiView = router.viewInstances?.get('kanji');
      if (kanjiView && typeof kanjiView.loadKanji === 'function') {
        kanjiView.loadKanji(cleanChar);
      }
    }
  }

  async lookupDictionary(text) {
    const lookupEl = this.container?.querySelector('#manga-popover-lookup');
    if (!lookupEl || !text) return;

    try {
      const res = await this.apiClient.captureText(text);
      if (res && (res.meaning || (res.entries && res.entries.length > 0))) {
        const word = res.expression || text;
        const reading = res.reading || '';
        const glossary = res.meaning || '';
        const showReading = shouldShowReading(word, reading);
        const defsHtml = formatDefinitionsHtml(res);

        lookupEl.innerHTML = `
          <div class="manga-dict-entry mb-2">
            <div class="manga-dict-entry-header">
              <div class="manga-dict-word-group">
                ${showReading ? `<span class="manga-dict-reading font-japanese">${escapeHtml(reading)}</span>` : ''}
                <span class="manga-dict-expression font-japanese">${escapeHtml(word)}</span>
              </div>
              <button type="button" 
                class="tactile-btn tactile-btn-gold tactile-btn-sm btn-manga-mine-word" 
                data-word="${escapeHtml(word)}" 
                data-reading="${escapeHtml(reading || word)}" 
                data-meaning="${escapeHtml(glossary)}">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                <span>Save</span>
              </button>
            </div>
            ${defsHtml}
          </div>
        `;
      } else {
        lookupEl.innerHTML = `<span class="text-xs text-muted">No dictionary entries found for "${escapeHtml(text)}"</span>`;
      }
    } catch (err) {
      console.debug('[MangaView] Dictionary lookup fallback:', err);
    }
  }

  /* -------------------------------------------------------------------------
   * Rich Card Mining (Migaku-Style with Cropped Bubble Image)
   * ------------------------------------------------------------------------- */
  async mineWord(word, reading = '', meaning = '', btn = null) {
    if (!word) return;
    this.triggerHaptic('heavy');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg><span>Saved</span>`;
    }

    try {
      const targetDeck = await getUniversalAnkiDeck();
      if (!targetDeck) {
        throw new Error('No Anki deck selected. Please choose a deck in Settings.');
      }

      const cardPayload = {
        expression: word,
        reading: reading || word,
        meaning: meaning,
        example_sentence: this.recognizedText,
        sentence: this.recognizedText,
        image_url: this.activeCropDataUrl || '',
        image_data: this.activeCropDataUrl || '',
        source: 'manga',
        source_type: 'manga',
        source_title: this.currentBook?.title || 'Manga',
        deck_name: targetDeck,
        tags: 'kiroku,manga'
      };

      let saveRes = null;
      if (typeof this.apiClient.saveAndSyncCard === 'function') {
        saveRes = await this.apiClient.saveAndSyncCard(cardPayload);
      } else if (typeof this.apiClient.saveCard === 'function') {
        saveRes = await this.apiClient.saveCard(cardPayload);
      } else {
        saveRes = await this.apiClient.request('/api/cards/save', {
          method: 'POST',
          body: cardPayload
        });
      }

      if (!this.knownWordsSet) this.knownWordsSet = new Set();
      this.knownWordsSet.add(word);

      try {
        if (typeof this.apiClient.markKnownWord === 'function') {
          await this.apiClient.markKnownWord(word);
        }
      } catch (err) {
        console.debug('[MangaView] Mark known fallback:', err);
      }

      if (btn && (saveRes?.is_duplicate || saveRes?.status === 'already_saved')) {
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg><span>Already Saved</span>`;
      }

      this.lastMinedWord = word;
    } catch (err) {
      console.warn('[MangaView] Mine word failed:', err);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span>Retry Save</span>`;
      }
    }
  }

  /* -------------------------------------------------------------------------
   * Bookmark Management & Drawer Interactions
   * ------------------------------------------------------------------------- */
  toggleBookmarkCurrentPage() {
    if (!this.currentBook) return;
    if (!Array.isArray(this.currentBook.bookmarks)) {
      this.currentBook.bookmarks = [];
    }

    const existingIdx = this.currentBook.bookmarks.findIndex(b => b.page === this.currentPage);
    if (existingIdx >= 0) {
      this.currentBook.bookmarks.splice(existingIdx, 1);
    } else {
      this.currentBook.bookmarks.push({
        id: 'bm_' + Date.now(),
        page: this.currentPage,
        createdAt: Date.now()
      });
      this.currentBook.bookmarks.sort((a, b) => a.page - b.page);
    }

    this.saveLibrary();
    this.updateBookmarkButtonState();
    this.renderBookmarksList();
  }

  updateBookmarkButtonState() {
    const bookmarks = Array.isArray(this.currentBook?.bookmarks) ? this.currentBook.bookmarks : [];
    const isBookmarked = bookmarks.some(b => b.page === this.currentPage);
    const count = bookmarks.length;

    const topBtn = this.container?.querySelector('#btn-reader-bookmarks');
    const labelCount = this.container?.querySelector('#label-bookmarks-count');
    if (topBtn) {
      topBtn.classList.toggle('is-active', isBookmarked);
      const svg = topBtn.querySelector('.manga-bookmark-svg');
      if (svg) svg.classList.toggle('is-active', isBookmarked);
    }
    if (labelCount) {
      labelCount.textContent = count > 0 ? `Bookmarks (${count})` : 'Bookmarks';
    }

    const drawerBtn = this.container?.querySelector('#btn-toggle-bookmark-page');
    const drawerLabel = this.container?.querySelector('#label-toggle-bookmark');
    if (drawerBtn) {
      drawerBtn.className = `tactile-btn tactile-btn-sm w-full ${isBookmarked ? 'tactile-btn-gold is-active' : 'tactile-btn-primary'}`;
      const svg = drawerBtn.querySelector('.manga-bookmark-svg');
      if (svg) svg.classList.toggle('is-active', isBookmarked);
    }
    if (drawerLabel) {
      drawerLabel.textContent = isBookmarked ? `Remove Bookmark (Page ${this.currentPage})` : `Bookmark Page ${this.currentPage}`;
    }
  }

  renderBookmarksList() {
    const listEl = this.container?.querySelector('#manga-bookmarks-list');
    if (!listEl) return;

    const bookmarks = Array.isArray(this.currentBook?.bookmarks) ? this.currentBook.bookmarks : [];
    if (bookmarks.length === 0) {
      listEl.innerHTML = `<div class="manga-bookmarks-empty text-xs text-muted text-center py-4">No bookmarks saved yet.<br>Click above to bookmark Page ${this.currentPage}.</div>`;
      return;
    }

    listEl.innerHTML = bookmarks.map(bm => `
      <div class="manga-bookmark-item ${bm.page === this.currentPage ? 'is-current-page' : ''}" data-bookmark-id="${escapeHtml(bm.id)}" data-page="${bm.page}">
        <div class="flex items-center gap-2">
          <svg class="manga-bookmark-svg is-active" viewBox="0 0 24 24" width="12" height="12">
            <path class="manga-bookmark-ribbon" d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
          <span class="manga-bookmark-page-label">Page ${bm.page}</span>
          ${bm.page === this.currentPage ? '<span class="manga-bookmark-current-tag">Current</span>' : ''}
        </div>
        <div class="flex items-center gap-1">
          <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-xs btn-jump-bookmark" data-page="${bm.page}" title="Jump to Page ${bm.page}">
            <span>Jump</span>
          </button>
          <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-xs text-red btn-delete-bookmark" data-bookmark-id="${escapeHtml(bm.id)}" title="Delete Bookmark">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.btn-jump-bookmark').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = parseInt(btn.dataset.page, 10);
        if (!isNaN(p)) {
          this.goToPage(p);
          this.updateBookmarkButtonState();
          this.renderBookmarksList();
        }
      });
    });

    listEl.querySelectorAll('.btn-delete-bookmark').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const bmId = btn.dataset.bookmarkId;
        if (this.currentBook && Array.isArray(this.currentBook.bookmarks)) {
          this.currentBook.bookmarks = this.currentBook.bookmarks.filter(b => b.id !== bmId);
          this.saveLibrary();
          this.updateBookmarkButtonState();
          this.renderBookmarksList();
        }
      });
    });
  }

  /* -------------------------------------------------------------------------
   * Furigana Visibility Controls
   * ------------------------------------------------------------------------- */
  updateFuriganaUI() {
    const btn = this.container?.querySelector('#btn-toggle-furigana');
    const stateEl = btn?.querySelector('.manga-furigana-state');
    if (btn) btn.classList.toggle('is-active', this.furiganaEnabled);
    if (stateEl) stateEl.textContent = this.furiganaEnabled ? 'ON' : 'OFF';

    const sidebarFlow = this.container?.querySelector('#manga-sidebar-sentence-text');
    const popFlow = this.container?.querySelector('#manga-popover-sentence');
    sidebarFlow?.classList.toggle('hide-furigana', !this.furiganaEnabled);
    popFlow?.classList.toggle('hide-furigana', !this.furiganaEnabled);
  }

  /* -------------------------------------------------------------------------
   * Next-Page Auto-OCR Pre-fetching Engine
   * ------------------------------------------------------------------------- */
  scheduleNextPagePrefetch() {
    if (!this.currentBook || this.isPrefetching) return;
    const step = this.getNavigationStep();
    const targetPage = this.currentPage + step;
    if (targetPage > this.pageCount) return;

    const cacheKey = `${this.currentBook.id}_${targetPage}_${this.spreadMode}`;
    if (this.prefetchOcrCache.has(cacheKey)) return;

    clearTimeout(this.prefetchTimeout);
    this.prefetchTimeout = setTimeout(() => {
      this.runNextPagePrefetch(targetPage, cacheKey);
    }, 600);
  }

  async runNextPagePrefetch(targetPage, cacheKey) {
    if (this.isPrefetching || !this.currentBook) return;
    this.isPrefetching = true;

    try {
      const offscreenCanvas = document.createElement('canvas');
      if (this.currentBook.type === 'pdf' && this.pdfDoc) {
        await this.renderPdfPages(targetPage, offscreenCanvas);
      } else if (this.currentBook.type === 'cbz' && this.cbzImageEntries.length > 0) {
        await this.renderCbzPages(targetPage, offscreenCanvas);
      } else {
        return;
      }

      if (!offscreenCanvas.width || !offscreenCanvas.height) return;
      const fullPageB64 = offscreenCanvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      if (!fullPageB64) return;

      const res = await this.apiClient.request('/api/ocr/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: fullPageB64, conf_threshold: 0.35 })
      });

      if (res && Array.isArray(res.boxes)) {
        this.prefetchOcrCache.set(cacheKey, res.boxes);
        this.bubbleCache.set(cacheKey, res.boxes);
        const altKey = `${this.currentBook.id}_p${targetPage}_${this.spreadMode}`;
        this.bubbleCache.set(altKey, res.boxes);
        // If the user arrived at targetPage while prefetch was in-flight, display immediately!
        if (this.currentPage === targetPage && this.detectedBubbles.length === 0) {
          this.detectedBubbles = res.boxes;
          this.renderBubbleOverlays();
        }
      }
    } catch (err) {
      console.debug('[MangaView] Next-page background prefetch skipped:', err);
    } finally {
      this.isPrefetching = false;
    }
  }

  /* -------------------------------------------------------------------------
   * In-Viewer Canvas Annotations & Cloud Sync
   * ------------------------------------------------------------------------- */
  startAnnotationStroke(e) {
    if (this.activeTool !== 'draw' && this.activeTool !== 'eraser') return;
    const annotCanvas = this.container?.querySelector('#manga-annotation-canvas');
    if (!annotCanvas) return;
    const rect = annotCanvas.getBoundingClientRect();
    const scaleX = annotCanvas.width / (rect.width || 1);
    const scaleY = annotCanvas.height / (rect.height || 1);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = Math.round((clientX - rect.left) * scaleX);
    const y = Math.round((clientY - rect.top) * scaleY);

    const isDouble = this.spreadMode === 'double' && this.currentPage < this.pageCount && (this._currentSpreadLeftPageWidth || 0) > 0;
    let targetPage = this.currentPage;
    let offsetX = 0;
    if (isDouble) {
      if (x < this._currentSpreadLeftPageWidth) {
        targetPage = this.currentPage + 1;
        offsetX = 0;
      } else {
        targetPage = this.currentPage;
        offsetX = this._currentSpreadLeftPageWidth;
      }
    }

    this.isDrawing = true;
    this.currentStroke = {
      tool: this.activeTool,
      color: this.activeTool === 'eraser' ? 'rgba(0,0,0,1)' : this.annotationColor,
      width: this.activeTool === 'eraser' ? Math.max(24, this.annotationLineWidth * 3) : this.annotationLineWidth,
      targetPage,
      offsetX,
      points: [{ x, y }]
    };
  }

  continueAnnotationStroke(e) {
    if (!this.isDrawing || !this.currentStroke) return;
    const annotCanvas = this.container?.querySelector('#manga-annotation-canvas');
    if (!annotCanvas) return;
    const rect = annotCanvas.getBoundingClientRect();
    const scaleX = annotCanvas.width / (rect.width || 1);
    const scaleY = annotCanvas.height / (rect.height || 1);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = Math.round((clientX - rect.left) * scaleX);
    const y = Math.round((clientY - rect.top) * scaleY);

    const pts = this.currentStroke.points;
    const prev = pts[pts.length - 1];
    pts.push({ x, y });

    const ctx = annotCanvas.getContext('2d');
    if (ctx && prev) {
      ctx.save();
      if (this.currentStroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = resolveCanvasColor(this.currentStroke.color);
      }
      ctx.lineWidth = this.currentStroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
    }
  }

  async finishAnnotationStroke() {
    if (!this.isDrawing || !this.currentStroke) return;
    this.isDrawing = false;
    const stroke = this.currentStroke;
    this.currentStroke = null;

    const targetPage = stroke.targetPage || this.currentPage;
    const offsetX = stroke.offsetX || 0;

    // Convert stroke points to page-local coordinates for storage
    const localStroke = {
      tool: stroke.tool,
      color: stroke.color,
      width: stroke.width,
      points: stroke.points.map(pt => ({
        x: Math.round(pt.x - offsetX),
        y: Math.round(pt.y)
      }))
    };

    const key = `${this.currentBook?.id}_p${targetPage}`;
    let pageStrokes = this.pageAnnotationsMap.get(key) || [];
    pageStrokes.push(localStroke);
    this.pageAnnotationsMap.set(key, pageStrokes);

    if (!this._visibleSpreadStrokesHistory) {
      this._visibleSpreadStrokesHistory = [];
    }
    this._visibleSpreadStrokesHistory.push({ targetPage, stroke: localStroke });

    // Clear redo history on new stroke
    this.annotationRedoMap.delete(key);
    this.updateUndoRedoButtonState();

    if (this.currentBook?.id) {
      try {
        await storePageAnnotations(this.currentBook.id, targetPage, pageStrokes);
      } catch (err) {
        console.warn('[MangaView] Failed to save annotation locally:', err);
      }

      enqueueSyncOutbox({
        type: 'annotations',
        bookId: this.currentBook.id,
        payload: {
          book_id: this.currentBook.id,
          page_number: targetPage,
          data_json: JSON.stringify(pageStrokes),
          updated_at: Math.floor(Date.now() / 1000)
        }
      }).then(() => this.flushSyncOutbox()).catch(() => {});
    }
  }

  drawStrokesToCanvas(ctx, strokes, offsetX = 0) {
    if (!strokes || !strokes.length) return;
    for (const s of strokes) {
      if (!s.points || s.points.length < 2) continue;
      ctx.save();
      if (s.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = resolveCanvasColor(s.color);
      }
      ctx.lineWidth = s.width || 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(s.points[0].x + offsetX, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x + offsetX, s.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  async undoAnnotationStroke() {
    if (!this.currentBook) return;
    let targetPage = this.currentPage;
    let popped = null;

    if (this._visibleSpreadStrokesHistory && this._visibleSpreadStrokesHistory.length > 0) {
      const lastAction = this._visibleSpreadStrokesHistory.pop();
      targetPage = lastAction.targetPage;
      const key = `${this.currentBook.id}_p${targetPage}`;
      let pageStrokes = this.pageAnnotationsMap.get(key) || [];
      const idx = pageStrokes.lastIndexOf(lastAction.stroke);
      if (idx !== -1) {
        popped = pageStrokes.splice(idx, 1)[0];
      } else {
        popped = pageStrokes.pop();
      }
      this.pageAnnotationsMap.set(key, pageStrokes);
    } else {
      const key = `${this.currentBook.id}_p${this.currentPage}`;
      let pageStrokes = this.pageAnnotationsMap.get(key) || [];
      popped = pageStrokes.pop();
      this.pageAnnotationsMap.set(key, pageStrokes);
    }

    if (!popped) return;

    const redoKey = `${this.currentBook.id}_p${targetPage}`;
    let redoList = this.annotationRedoMap.get(redoKey) || [];
    redoList.push(popped);
    this.annotationRedoMap.set(redoKey, redoList);

    const pageStrokes = this.pageAnnotationsMap.get(`${this.currentBook.id}_p${targetPage}`) || [];
    try {
      await storePageAnnotations(this.currentBook.id, targetPage, pageStrokes);
    } catch (_) {}

    enqueueSyncOutbox({
      type: 'annotations',
      bookId: this.currentBook.id,
      payload: {
        book_id: this.currentBook.id,
        page_number: targetPage,
        data_json: JSON.stringify(pageStrokes),
        updated_at: Math.floor(Date.now() / 1000)
      }
    }).then(() => this.flushSyncOutbox()).catch(() => {});

    await this.loadAndRenderPageAnnotations();
  }

  async redoAnnotationStroke() {
    if (!this.currentBook) return;
    const isDouble = this.spreadMode === 'double' && this.currentPage < this.pageCount && (this._currentSpreadLeftPageWidth || 0) > 0;
    const candidatePages = isDouble ? [this.currentPage, this.currentPage + 1] : [this.currentPage];

    let targetPage = null;
    let restored = null;
    for (const p of candidatePages) {
      const redoKey = `${this.currentBook.id}_p${p}`;
      const redoList = this.annotationRedoMap.get(redoKey);
      if (redoList && redoList.length > 0) {
        targetPage = p;
        restored = redoList.pop();
        break;
      }
    }

    if (!restored || targetPage === null) return;

    const key = `${this.currentBook.id}_p${targetPage}`;
    let pageStrokes = this.pageAnnotationsMap.get(key) || [];
    pageStrokes.push(restored);
    this.pageAnnotationsMap.set(key, pageStrokes);

    if (!this._visibleSpreadStrokesHistory) {
      this._visibleSpreadStrokesHistory = [];
    }
    this._visibleSpreadStrokesHistory.push({ targetPage, stroke: restored });

    try {
      await storePageAnnotations(this.currentBook.id, targetPage, pageStrokes);
    } catch (_) {}

    enqueueSyncOutbox({
      type: 'annotations',
      bookId: this.currentBook.id,
      payload: {
        book_id: this.currentBook.id,
        page_number: targetPage,
        data_json: JSON.stringify(pageStrokes),
        updated_at: Math.floor(Date.now() / 1000)
      }
    }).then(() => this.flushSyncOutbox()).catch(() => {});

    await this.loadAndRenderPageAnnotations();
  }

  redrawAnnotationCanvas(strokes) {
    this.loadAndRenderPageAnnotations();
  }

  updateUndoRedoButtonState() {
    if (!this.currentBook) return;
    const isDouble = this.spreadMode === 'double' && this.currentPage < this.pageCount && (this._currentSpreadLeftPageWidth || 0) > 0;
    const pagesToCheck = isDouble ? [this.currentPage, this.currentPage + 1] : [this.currentPage];

    let hasStrokes = false;
    let hasRedo = false;
    for (const p of pagesToCheck) {
      const pageStrokes = this.pageAnnotationsMap.get(`${this.currentBook.id}_p${p}`) || [];
      if (pageStrokes.length > 0) hasStrokes = true;
      const redoList = this.annotationRedoMap.get(`${this.currentBook.id}_p${p}`) || [];
      if (redoList.length > 0) hasRedo = true;
    }

    const btnUndo = this.container?.querySelector('#btn-annotation-undo');
    const btnRedo = this.container?.querySelector('#btn-annotation-redo');
    if (btnUndo) {
      btnUndo.disabled = !hasStrokes;
      btnUndo.classList.toggle('is-disabled', !hasStrokes);
    }
    if (btnRedo) {
      btnRedo.disabled = !hasRedo;
      btnRedo.classList.toggle('is-disabled', !hasRedo);
    }
  }

  async loadAndRenderPageAnnotations() {
    const annotCanvas = this.container?.querySelector('#manga-annotation-canvas');
    if (!annotCanvas) return;
    const ctx = annotCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);

    if (!this.currentBook) return;

    const isDouble = this.spreadMode === 'double' && this.currentPage < this.pageCount && (this._currentSpreadLeftPageWidth || 0) > 0;

    // 1. Right page (currentPage)
    const rightKey = `${this.currentBook.id}_p${this.currentPage}`;
    let rightStrokes = this.pageAnnotationsMap.get(rightKey);
    if (!rightStrokes) {
      try {
        rightStrokes = await getPageAnnotations(this.currentBook.id, this.currentPage);
        if (rightStrokes && rightStrokes.length) {
          this.pageAnnotationsMap.set(rightKey, rightStrokes);
        }
      } catch (_) {}
    }

    // 2. Left page (currentPage + 1) if double-page spread
    let leftStrokes = null;
    if (isDouble) {
      const leftKey = `${this.currentBook.id}_p${this.currentPage + 1}`;
      leftStrokes = this.pageAnnotationsMap.get(leftKey);
      if (!leftStrokes) {
        try {
          leftStrokes = await getPageAnnotations(this.currentBook.id, this.currentPage + 1);
          if (leftStrokes && leftStrokes.length) {
            this.pageAnnotationsMap.set(leftKey, leftStrokes);
          }
        } catch (_) {}
      }
    }

    // 3. Render strokes with page offsets
    if (leftStrokes && leftStrokes.length) {
      this.drawStrokesToCanvas(ctx, leftStrokes, 0);
    }
    if (rightStrokes && rightStrokes.length) {
      const offsetX = isDouble ? this._currentSpreadLeftPageWidth : 0;
      this.drawStrokesToCanvas(ctx, rightStrokes, offsetX);
    }

    this.updateUndoRedoButtonState();
  }

  async clearCurrentPageAnnotations() {
    if (!this.currentBook) return;
    const isDouble = this.spreadMode === 'double' && this.currentPage < this.pageCount && (this._currentSpreadLeftPageWidth || 0) > 0;
    const pagesToClear = isDouble ? [this.currentPage, this.currentPage + 1] : [this.currentPage];

    let hasAnyAnnotations = false;
    for (const p of pagesToClear) {
      const strokes = this.pageAnnotationsMap.get(`${this.currentBook.id}_p${p}`);
      if (strokes && strokes.length > 0) {
        hasAnyAnnotations = true;
        break;
      }
    }
    if (!hasAnyAnnotations) return;

    const confirmed = await this.showConfirmModal({
      title: 'Clear Annotations',
      message: isDouble ? 'Clear all annotations on this 2-page spread?' : 'Clear all annotations on this page?',
      confirmText: 'Clear',
      cancelText: 'Cancel',
      isDanger: true
    });
    if (!confirmed) return;

    let allDeleted = true;
    for (const p of pagesToClear) {
      try {
        const ok = await deletePageAnnotations(this.currentBook.id, p);
        if (!ok) allDeleted = false;
      } catch (err) {
        allDeleted = false;
      }
    }

    if (!allDeleted) {
      this.showToast('Failed to delete some annotations from storage');
      return;
    }

    for (const p of pagesToClear) {
      const key = `${this.currentBook.id}_p${p}`;
      const previous = this.pageAnnotationsMap.get(key) || [];
      let redoList = this.annotationRedoMap.get(key) || [];
      redoList.push(...previous);
      this.annotationRedoMap.set(key, redoList);
      this.pageAnnotationsMap.delete(key);

      enqueueSyncOutbox({
        type: 'delete_annotations',
        bookId: this.currentBook.id,
        payload: {
          pageNum: p
        }
      }).then(() => this.flushSyncOutbox()).catch(() => {});
    }

    this._visibleSpreadStrokesHistory = [];
    const annotCanvas = this.container?.querySelector('#manga-annotation-canvas');
    if (annotCanvas) {
      const ctx = annotCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
    }
    this.updateUndoRedoButtonState();
    this.showToast('Annotations cleared');
  }

  toggleBubbleDisplay() {
    if (!this.currentBook) return;
    const current = this.currentBook.bubbleDisplay || 'show';
    const next = current === 'show' ? 'hidden' : (current === 'hidden' ? 'detect' : 'show');
    this.currentBook.bubbleDisplay = next;
    this.saveLibrary();

    enqueueSyncOutbox({
      type: 'reading_progress',
      bookId: this.currentBook.id,
      payload: {
        manga_id: this.currentBook.id,
        chapter_number: 1.0,
        page_number: this.currentPage,
        completed: this.currentPage >= this.pageCount ? 1 : 0,
        last_read_at: Math.floor(Date.now() / 1000),
        bubble_display: next
      }
    }).then(() => this.flushSyncOutbox()).catch(() => {});

    this.updateBubbleDisplayUI();
    const canvas = this.container?.querySelector('#manga-canvas');
    if (next === 'show') {
      this.detectedBubbles = this.resolveBubblesForCurrentPage(canvas);
      if (this.detectedBubbles && this.detectedBubbles.length > 0) {
        this.renderBubbleOverlays();
      }
      this.showToast('Speech bubbles: SHOW');
    } else if (next === 'hidden') {
      this.clearBubbleOverlays();
      this.showToast('Speech bubbles: HIDDEN');
    } else if (next === 'detect') {
      this.clearBubbleOverlays();
      this.showToast('Speech bubbles: DETECT ONLY');
    }
    this.triggerHaptic('light');
  }

  updateBubbleDisplayUI() {
    const mode = this.currentBook?.bubbleDisplay || 'show';
    const label = this.container?.querySelector('#label-bubble-display-mode');
    const btn = this.container?.querySelector('#btn-toggle-bubble-display');
    if (label) {
      label.textContent = mode === 'show' ? 'Bubbles: ON' : (mode === 'hidden' ? 'Bubbles: OFF' : 'Bubbles: DETECT');
    }
    if (btn) {
      btn.classList.toggle('is-active', mode === 'show');
      btn.title = `Bubble Mode: ${mode.toUpperCase()} (Click to toggle)`;
    }
  }

  async flushSyncOutbox() {
    if (this._isFlushingOutbox) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (!this.apiClient) return;
    this._isFlushingOutbox = true;
    try {
      const items = await peekSyncOutbox(25);
      for (const item of items) {
        try {
          let responseData = null;
          if (item.type === 'reading_progress') {
            responseData = await this.requestCloudApi(`/api/user/manga/${encodeURIComponent(item.bookId)}/progress`, {
              method: 'POST',
              body: item.payload
            });
          } else if (item.type === 'annotations') {
            responseData = await this.requestCloudApi(`/api/user/manga/${encodeURIComponent(item.bookId)}/annotations`, {
              method: 'POST',
              body: item.payload
            });
          } else if (item.type === 'delete_annotations') {
            try {
              responseData = await this.requestCloudApi(`/api/user/manga/${encodeURIComponent(item.bookId)}/annotations/${item.payload.pageNum}`, {
                method: 'DELETE'
              });
            } catch (delErr) {
              // Deletions are idempotent: if server already returned 404 (already deleted), treat as success
              if (delErr?.status === 404) {
                responseData = { ok: true, deleted: true, idempotent: true };
              } else {
                throw delErr;
              }
            }
          }

          // Validate server confirmed acknowledgement
          if (responseData && (responseData.ok === true || responseData.success === true || item.type === 'delete_annotations')) {
            await removeSyncOutbox(item.id);
          } else {
            throw new Error(`Server returned unacknowledged payload: ${JSON.stringify(responseData || {})}`);
          }
        } catch (err) {
          const status = err?.status || err?.data?.status;
          // HTTP 400 series error (e.g. invalid payload format): keep record with failure details, do not drop silently
          await updateSyncOutboxItem(item.id, {
            attempts: (item.attempts || 0) + 1,
            lastError: String(err?.message || err),
            lastStatus: status || null,
            updatedAt: Date.now()
          });

          // If network failure or 5xx server error, break batch to retry on next cycle
          if (!status || status >= 500) {
            break;
          }
        }
      }
    } catch (_) {}
    finally {
      this._isFlushingOutbox = false;
    }
  }

  /* -------------------------------------------------------------------------
   * Cloud Manga Storage & Remote Sync
   * ------------------------------------------------------------------------- */
  async requestCloudApi(endpoint, options = {}) {
    const isDesktop = typeof window !== 'undefined' && Boolean(window.desktopAPI?.isDesktop);

    if (!isDesktop && this.apiClient && typeof this.apiClient.request === 'function') {
      return await this.apiClient.request(endpoint, options);
    }

    const method = (options.method || 'GET').toUpperCase();

    const workerHost = (typeof window !== 'undefined' &&
      window.location &&
      typeof window.location.protocol === 'string' &&
      window.location.protocol.startsWith('http') &&
      window.location.origin &&
      !window.location.hostname?.includes('localhost') &&
      !window.location.hostname?.includes('127.0.0.1'))
      ? window.location.origin
      : ((typeof process !== 'undefined' && process.env?.WORKER_URL) || 'https://kiroku-note.rhythmkach.workers.dev');

    let token = '';
    if (typeof window !== 'undefined' && window.desktopAPI?.auth?.getSession) {
      try {
        const s = await window.desktopAPI.auth.getSession();
        token = s?.token || '';
      } catch (_) {}
    }
    if (!token && typeof localStorage !== 'undefined') {
      try {
        token = localStorage.getItem('kiroku_auth_token') || '';
        if (!token) {
          const rawUser = localStorage.getItem('kiroku:auth-user') || localStorage.getItem('kiroku_auth_user');
          if (rawUser) {
            const u = JSON.parse(rawUser);
            token = u?.token || '';
          }
        }
      } catch (_) {}
    }

    const url = `${workerHost}${endpoint}`;
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    const controller = new AbortController();
    const timeoutMs = options.timeout || 25000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let resp;
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const err = new Error(`Cloud request failed: ${resp.status} ${errText}`);
      err.status = resp.status;
      throw err;
    }
    return await resp.json().catch(() => ({ ok: true }));
  }

  async uploadBookToCloud(bookId, onProgress = null) {
    const bookList = this.books || this.library || [];
    const book = bookList.find(b => b.id === bookId);
    if (!book) return false;
    const buffer = await getBookFileBuffer(bookId);
    const size = buffer ? buffer.byteLength : (book.size || 0);

    try {
      // 1. Upload book metadata first
      const res = await this.requestCloudApi('/api/user/manga/upload', {
        method: 'POST',
        body: {
          book_id: book.id,
          title: book.title,
          filename: book.filename || `${book.id}.${book.type || 'cbz'}`,
          file_type: book.type || 'cbz',
          size: size,
          total_pages: book.pageCount || book.totalPages || 1,
          cover_url: book.coverUrl || '',
          file_data: ''
        }
      });

      if (!buffer) {
        book.syncStatus = 'local_only';
        this.saveLibrary();
        return Boolean(res && (res.ok || res.book_id));
      }

      // 2. Upload binary chunks to Turso with resumable transfer service
      await uploadMangaChunks(book.id, buffer, {
        requestFn: (ep, opts) => this.requestCloudApi(ep, opts),
        onProgress: (p) => {
          if (typeof onProgress === 'function') onProgress(p.current, p.total);
        }
      });

      book.has_file = true;
      book.syncStatus = 'verified';
      book.syncedAt = Date.now();
      this.saveLibrary();
      return true;
    } catch (err) {
      console.warn('[CloudManga] Upload book error:', err);
      book.syncStatus = 'local_only';
      return false;
    }
  }

  async syncSingleBookToCloud(bookId) {
    const bookList = this.books || this.library || [];
    const book = bookList.find(b => b.id === bookId);
    if (!book) return false;

    try {
      // 1. Upload book file / metadata
      const ok = await this.uploadBookToCloud(bookId);

      // 2. Upload reading progress only if file upload succeeded or metadata registered
      if (ok) {
        await this.requestCloudApi('/api/user/progress/manga', {
          method: 'POST',
          body: {
            manga_id: book.id,
            chapter_number: 1,
            page_number: book.currentPage || 1,
            completed: (book.currentPage && book.pageCount && book.currentPage >= book.pageCount) ? 1 : 0
          }
        }).catch(() => {});

        book.syncedAt = Date.now();
        book.syncStatus = 'verified';
        this.saveLibrary();
      }
      return ok;
    } catch (err) {
      console.warn('[Manga] Single book sync error:', err);
      return false;
    }
  }

  async loadPrebakedOcrForBook(bookId) {
    if (!bookId) return { ok: false, count: 0 };

    let loadedCount = 0;
    // 1. Try local cache first for instant 0ms hit
    try {
      const localData = localStorage.getItem(`kiroku_ocr_pages_${bookId}`);
      if (localData) {
        const parsed = JSON.parse(localData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach(p => {
            const pageNum = Number(p.page_number ?? p.page ?? 1);
            this.prebakedOcrMap.set(`${bookId}_p${pageNum}`, p.bubbles || []);
          });
          loadedCount = parsed.length;
          const targetBook = this.books?.find(b => b.id === bookId) || this.currentBook;
          if (targetBook) {
            targetBook.ocrCached = true;
            targetBook.ocrPageCount = loadedCount;
          }
        }
      }
    } catch (_) {}

    // Refresh overlays from local cache immediately if this book is already visible
    if (this.currentBook?.id === bookId && (this.currentBook.bubbleDisplay || 'show') !== 'hidden') {
      const canvas = this.container?.querySelector('#manga-canvas');
      if (canvas) {
        this.detectedBubbles = this.resolveBubblesForCurrentPage(canvas);
        if (this.detectedBubbles.length > 0) {
          this.renderBubbleOverlays();
        }
      }
    }

    // 2. Fetch fresh pre-baked OCR pages from Cloudflare/Turso
    try {
      const res = await this.requestCloudApi(`/api/user/manga/ocr/${bookId}`);
      if (res && res.ok && Array.isArray(res.pages) && res.pages.length > 0) {
        res.pages.forEach(p => {
          const pageNum = Number(p.page_number ?? p.page ?? 1);
          this.prebakedOcrMap.set(`${bookId}_p${pageNum}`, p.bubbles || []);
        });
        loadedCount = res.pages.length;
        try {
          localStorage.setItem(`kiroku_ocr_pages_${bookId}`, JSON.stringify(res.pages));
        } catch (_) {}

        const targetBook = this.books?.find(b => b.id === bookId) || this.currentBook;
        if (targetBook) {
          targetBook.ocrCached = true;
          targetBook.ocrPageCount = loadedCount;
          this.saveLibrary();
        }

        // If currently open on this book, refresh bubble overlays for current page
        if (this.currentBook?.id === bookId && (this.currentBook.bubbleDisplay || 'show') !== 'hidden') {
          const canvas = this.container?.querySelector('#manga-canvas');
          if (canvas) {
            this.detectedBubbles = this.resolveBubblesForCurrentPage(canvas);
            if (this.detectedBubbles.length > 0) {
              this.renderBubbleOverlays();
            }
          }
        }
        return { ok: true, count: loadedCount, fromCloud: true };
      }
    } catch (err) {
      console.debug('[MangaView] Fetch prebaked OCR skipped:', err);
    }
    return { ok: loadedCount > 0, count: loadedCount, fromLocal: loadedCount > 0 };
  }

  showBakeProgressModal(bookId) {
    const book = this.books.find(b => b.id === bookId);
    if (!book) return;
    this.bakeModalMinimized = false;
    this.hideBakeTopBar();

    const currentPct = this.lastBakePct || 0;
    const currentStatus = this.lastBakeStatus || 'Preparing volume...';

    this.showModal(`
      <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
        <div class="tactile-modal-card" style="max-width: 450px;">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-bold text-warm-paper">Pre-bake & Sync OCR</h3>
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-xs" id="btn-minimize-bake" title="Run in background and monitor via top bar">Minimize</button>
          </div>
          <p class="text-xs text-muted mt-1">Scanning speech bubbles and transcribing Japanese text on PC. Once synced, reading on iPhone is instantaneous with 0ms delay.</p>
          <div class="ocr-progress-container mt-4">
            <div class="ocr-progress-bar-track" style="height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
              <div id="ocr-bake-progress-fill" class="ocr-progress-fill" style="width: ${currentPct}%;"></div>
            </div>
            <div class="flex justify-between text-xs text-muted mt-2">
              <span id="ocr-bake-status-text">${currentStatus}</span>
              <span id="ocr-bake-pct-text">${currentPct}%</span>
            </div>
          </div>
          <div class="modal-actions-row mt-4 justify-between">
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-minimize-bake-bottom">Run in Background</button>
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm text-red" id="btn-cancel-bake">Stop & Save Progress</button>
          </div>
        </div>
      </div>
    `, () => {
      const doMinimize = () => {
        this.bakeModalMinimized = true;
        this.closeModal();
        this.renderBakeTopBar(book);
      };
      this.container.querySelector('#btn-minimize-bake')?.addEventListener('click', doMinimize);
      this.container.querySelector('#btn-minimize-bake-bottom')?.addEventListener('click', doMinimize);
      this.container.querySelector('#btn-cancel-bake')?.addEventListener('click', () => {
        this.cancelBakeRequested = true;
        const statusEl = this.container.querySelector('#ocr-bake-status-text');
        if (statusEl) statusEl.textContent = 'Stopping safely and saving progress...';
      });
    });
  }

  renderBakeTopBar(book) {
    if (!this.container || !this.isBakingOcr) return;
    let bar = this.container.querySelector('#manga-bake-top-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'manga-bake-top-bar';
      bar.className = 'manga-bake-top-bar';
      const mainContainer = this.container.querySelector('.manga-viewer-container') || this.container.querySelector('#manga-library-container') || this.container.firstElementChild;
      if (mainContainer) {
        mainContainer.prepend(bar);
      }
    }
    const pct = this.lastBakePct || 0;
    const status = this.lastBakeStatus || 'Processing...';
    bar.innerHTML = `
      <div class="manga-bake-info-group">
        <svg class="manga-bake-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10"/>
        </svg>
        <div class="manga-bake-text-wrap">
          <div class="manga-bake-book-title">${escapeHtml(book?.title || 'Manga Volume')}</div>
          <div id="top-bar-bake-status" class="manga-bake-status-label">${escapeHtml(status)}</div>
        </div>
      </div>
      <div class="manga-bake-controls-group">
        <div class="manga-bake-progress-track">
          <div id="top-bar-bake-fill" class="manga-bake-progress-fill" style="width: ${pct}%;"></div>
        </div>
        <span id="top-bar-bake-pct" class="manga-bake-pct-text">${pct}%</span>
        <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-xs" id="btn-top-bar-maximize">View</button>
        <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-xs text-red" id="btn-top-bar-stop">Stop</button>
      </div>
    `;
    bar.querySelector('#btn-top-bar-maximize')?.addEventListener('click', () => {
      this.showBakeProgressModal(book.id);
    });
    bar.querySelector('#btn-top-bar-stop')?.addEventListener('click', () => {
      this.cancelBakeRequested = true;
      const statusText = bar.querySelector('#top-bar-bake-status');
      if (statusText) statusText.textContent = 'Stopping safely...';
    });
  }

  hideBakeTopBar() {
    const bar = this.container?.querySelector('#manga-bake-top-bar');
    if (bar) bar.remove();
  }

  updateBakeProgressUI(pct, statusText, book) {
    this.lastBakePct = pct;
    this.lastBakeStatus = statusText;

    const modalFill = this.container?.querySelector('#ocr-bake-progress-fill');
    const modalPct = this.container?.querySelector('#ocr-bake-pct-text');
    const modalStatus = this.container?.querySelector('#ocr-bake-status-text');
    if (modalFill) modalFill.style.width = `${pct}%`;
    if (modalPct) modalPct.textContent = `${pct}%`;
    if (modalStatus) modalStatus.textContent = statusText;

    const topFill = this.container?.querySelector('#top-bar-bake-fill');
    const topPct = this.container?.querySelector('#top-bar-bake-pct');
    const topStatus = this.container?.querySelector('#top-bar-bake-status');
    if (topFill) topFill.style.width = `${pct}%`;
    if (topPct) topPct.textContent = `${pct}%`;
    if (topStatus) topStatus.textContent = statusText;
  }

  async prebakeBookOcr(bookId) {
    const book = this.books.find(b => b.id === bookId);
    if (!book) return;

    if (this.isBakingOcr) {
      this.showBakeProgressModal(bookId);
      return;
    }

    this.isBakingOcr = true;
    this.activeBakeBookId = bookId;
    this.cancelBakeRequested = false;
    this.bakeModalMinimized = false;
    this.lastBakePct = 0;
    this.lastBakeStatus = 'Loading volume...';

    this.showBakeProgressModal(bookId);

    try {
      const buffer = await getBookFileBuffer(bookId);
      if (!buffer) {
        this.updateBakeProgressUI(0, 'Error: Volume file not found in local storage.', book);
        return;
      }

      let doc = null;
      let totalPages = book.pageCount || 1;
      let cbzEntries = [];

      if (book.type === 'pdf') {
        if (typeof window.pdfjsLib === 'undefined') {
          throw new Error('PDF.js engine is not ready.');
        }
        ensurePdfWorker();
        const loadingTask = window.pdfjsLib.getDocument({ data: buffer });
        doc = await loadingTask.promise;
        totalPages = doc.numPages;
      } else if (book.type === 'cbz') {
        if (typeof window.JSZip === 'undefined') {
          throw new Error('JSZip engine is not ready.');
        }
        const zip = new window.JSZip();
        const zipContent = await zip.loadAsync(buffer);
        const validExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'];
        zipContent.forEach((path, entry) => {
          if (!entry.dir && validExts.some(ext => path.toLowerCase().endsWith(ext))) {
            cbzEntries.push(entry);
          }
        });
        cbzEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        totalPages = cbzEntries.length;
      }

      // Check existing cached pages to resume seamlessly
      let existingPages = [];
      try {
        const raw = localStorage.getItem(`kiroku_ocr_pages_${bookId}`);
        if (raw) existingPages = JSON.parse(raw);
        if (!Array.isArray(existingPages)) existingPages = [];
      } catch (_) {
        existingPages = [];
      }

      const existingPageMap = new Map();
      existingPages.forEach(ep => {
        if (ep && typeof ep.page_number === 'number') {
          existingPageMap.set(ep.page_number, ep);
          this.prebakedOcrMap.set(`${bookId}_p${ep.page_number}`, ep.bubbles || []);
        }
      });

      const allPageResults = [];
      for (const [_, ep] of existingPageMap) {
        allPageResults.push(ep);
      }
      allPageResults.sort((a, b) => a.page_number - b.page_number);

      let pendingBatch = [];

      for (let p = 1; p <= totalPages; p++) {
        if (this.cancelBakeRequested) {
          allPageResults.sort((a, b) => a.page_number - b.page_number);
          try {
            localStorage.setItem(`kiroku_ocr_pages_${bookId}`, JSON.stringify(allPageResults));
            book.ocrPageCount = allPageResults.length;
            this.saveLibrary();
          } catch (_) {}
          this.updateBakeProgressUI(this.lastBakePct || 0, 'Stopped safely by user. Progress saved.', book);
          break;
        }

        // Auto-continue: skip pages that already have cached OCR
        if (existingPageMap.has(p)) {
          continue;
        }

        const completedCount = allPageResults.length;
        const pct = Math.round((completedCount / totalPages) * 100);
        this.updateBakeProgressUI(pct, `Scanning page ${p} of ${totalPages}...`, book);

        // Render page to offscreen canvas
        // Scale 2.0 matches reader view canvas resolution for 100% exact bubble coordinates
        const offCanvas = document.createElement('canvas');
        if (book.type === 'pdf' && doc) {
          const page = await doc.getPage(p);
          const viewport = page.getViewport({ scale: 2.0 });
          offCanvas.width = viewport.width;
          offCanvas.height = viewport.height;
          const ctx = offCanvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
        } else if (book.type === 'cbz' && cbzEntries[p - 1]) {
          const blob = await cbzEntries[p - 1].async('blob');
          const imgUrl = URL.createObjectURL(blob);
          const img = new Image();
          await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = rej;
            img.src = imgUrl;
          });
          offCanvas.width = img.width;
          offCanvas.height = img.height;
          const ctx = offCanvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(imgUrl);
        }

        const fullPageB64 = offCanvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        if (!fullPageB64) continue;

        // Detect bubbles on page
        let bubbles = [];
        try {
          const detectRes = await this.apiClient.request('/api/ocr/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: fullPageB64, conf_threshold: 0.35 })
          });
          if (detectRes && Array.isArray(detectRes.boxes)) {
            bubbles = detectRes.boxes;
          }
        } catch (detErr) {
          console.debug(`[Prebake] Page ${p} detect error:`, detErr);
        }

        // Crop all speech bubbles for accelerated batched recognition
        const cropB64List = [];
        const validBubbles = [];
        for (const bubble of bubbles) {
          if (this.cancelBakeRequested) break;
          const box = Array.isArray(bubble.box)
            ? bubble.box
            : [bubble.x || 0, bubble.y || 0, (bubble.x || 0) + (bubble.w || 0), (bubble.y || 0) + (bubble.h || 0)];
          const [bx1, by1, bx2, by2] = box;
          const bw = bx2 - bx1;
          const bh = by2 - by1;
          if (bw <= 0 || bh <= 0) continue;

          const padX = Math.round(Math.min(bw * 0.08, 14));
          const padY = Math.round(Math.min(bh * 0.08, 14));
          const cropX1 = Math.max(0, bx1 - padX);
          const cropY1 = Math.max(0, by1 - padY);
          const cropX2 = Math.min(offCanvas.width, bx2 + padX);
          const cropY2 = Math.min(offCanvas.height, by2 + padY);

          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = Math.max(1, cropX2 - cropX1);
          cropCanvas.height = Math.max(1, cropY2 - cropY1);
          const cropCtx = cropCanvas.getContext('2d');
          cropCtx.drawImage(offCanvas, cropX1, cropY1, cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height);

          const cropB64 = cropCanvas.toDataURL('image/jpeg', 0.88).split(',')[1];
          if (cropB64) {
            cropB64List.push(cropB64);
            validBubbles.push(bubble);
          }
        }

        // Fast Vectorized Batched GPU Recognition on CUDA (with max_new_tokens=64)
        if (cropB64List.length > 0 && !this.cancelBakeRequested) {
          try {
            const batchRes = await this.apiClient.request('/api/ocr/recognize_batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ images: cropB64List, max_new_tokens: 64 })
            });
            if (batchRes && Array.isArray(batchRes.results)) {
              batchRes.results.forEach((r, idx) => {
                if (validBubbles[idx] && r && r.text) {
                  validBubbles[idx].text = r.text.trim();
                }
              });
            }
          } catch (batchErr) {
            console.debug(`[Prebake] Batch recognize fallback to sequential for page ${p}:`, batchErr);
            for (let i = 0; i < cropB64List.length; i++) {
              if (this.cancelBakeRequested) break;
              try {
                const recRes = await this.apiClient.request('/api/ocr/recognize', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ image: cropB64List[i] })
                });
                if (recRes && recRes.text) {
                  validBubbles[i].text = recRes.text.trim();
                }
              } catch (_) {}
            }
          }
        }

        // Attach reference page resolution to each bubble for bulletproof scaling on any device
        bubbles.forEach(b => {
          b.page_width = offCanvas.width;
          b.page_height = offCanvas.height;
        });

        const pageData = {
          page_number: p,
          page_width: offCanvas.width,
          page_height: offCanvas.height,
          bubbles
        };
        allPageResults.push(pageData);
        existingPageMap.set(p, pageData);
        pendingBatch.push(pageData);
        this.prebakedOcrMap.set(`${bookId}_p${p}`, bubbles);

        // Upload in batches of 10 pages to Turso (matching pipelined double-buffered throughput)
        if (pendingBatch.length >= 10 || p === totalPages) {
          // Always commit to persistent local storage BEFORE sending to the cloud
          allPageResults.sort((a, b) => a.page_number - b.page_number);
          try {
            localStorage.setItem(`kiroku_ocr_pages_${bookId}`, JSON.stringify(allPageResults));
            book.ocrPageCount = allPageResults.length;
            this.saveLibrary();
          } catch (_) {}

          try {
            await this.requestCloudApi('/api/user/manga/ocr/batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ book_id: bookId, pages: pendingBatch })
            });
            pendingBatch = [];
          } catch (batchErr) {
            console.warn('[Prebake] Cloud sync batch failed:', batchErr);
          }
        }
      }

      // Flush remaining batch on cancellation or completion
      if (pendingBatch.length > 0) {
        try {
          await this.requestCloudApi('/api/user/manga/ocr/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ book_id: bookId, pages: pendingBatch })
          });
          pendingBatch = [];
        } catch (_) {}
      }

      // Save local cache with exact page sorting
      allPageResults.sort((a, b) => a.page_number - b.page_number);
      try {
        localStorage.setItem(`kiroku_ocr_pages_${bookId}`, JSON.stringify(allPageResults));
      } catch (_) {}

      book.ocrCached = allPageResults.length >= totalPages;
      book.ocrPageCount = allPageResults.length;
      this.saveLibrary();

      if (!this.cancelBakeRequested) {
        this.updateBakeProgressUI(100, 'Pre-bake complete! All pages synced to cloud.', book);
        setTimeout(() => {
          this.hideBakeTopBar();
          this.closeModal();
          this.render();
        }, 1200);
      } else {
        setTimeout(() => {
          this.hideBakeTopBar();
          this.closeModal();
          this.render();
        }, 1500);
      }
    } catch (err) {
      console.error('[Prebake] Error during pre-bake:', err);
      this.updateBakeProgressUI(this.lastBakePct || 0, 'Pre-bake error: ' + err.message, book);
    } finally {
      this.isBakingOcr = false;
      this.activeBakeBookId = null;
      this.cancelBakeRequested = false;
    }
  }

  async flushBookOcr(bookId) {
    const book = this.books.find(b => b.id === bookId);
    if (!book) return;

    const confirmed = await this.showConfirmModal({
      title: 'Flush Cached OCR',
      message: `Flush cached OCR for "${book.title}"? This clears pre-baked bubbles from local storage and the cloud.`,
      confirmText: 'Flush OCR',
      isDanger: true
    });
    if (!confirmed) return;

    try {
      localStorage.removeItem(`kiroku_ocr_pages_${bookId}`);
      for (const k of this.prebakedOcrMap.keys()) {
        if (k.startsWith(`${bookId}_`)) {
          this.prebakedOcrMap.delete(k);
        }
      }
      book.ocrCached = false;
      book.ocrPageCount = 0;
      this.saveLibrary();

      await this.requestCloudApi(`/api/user/manga/ocr/${bookId}`, {
        method: 'DELETE'
      });

      this.clearBubbleOverlays();
      this.closeModal();
      this.render();
    } catch (err) {
      console.warn('[MangaView] Flush OCR error:', err);
      this.closeModal();
      this.render();
    }
  }

  async fetchCloudBooks() {
    try {
      // Sync cloud library folders & state
      try {
        const stateRes = await this.requestCloudApi('/api/user/manga/library-state', { method: 'GET' });
        if (stateRes && stateRes.ok && Array.isArray(stateRes.folders) && stateRes.folders.length > 0) {
          const folderMap = new Map((this.folders || []).map(f => [f.id, f]));
          for (const f of stateRes.folders) {
            if (f && f.id) folderMap.set(f.id, f);
          }
          this.folders = Array.from(folderMap.values());
          this.saveFolders();
        }
      } catch (_) {}

      const res = await this.requestCloudApi('/api/user/manga/list', { method: 'GET' });
      if (res && Array.isArray(res.books)) {
        this.cloudBooks = res.books;
        const bookList = this.books || this.library || [];
        const localMap = new Map(bookList.map(b => [b.id, b]));
        let changed = false;

        for (const cb of res.books) {
          if (!cb || !cb.book_id) continue;
          if (localMap.has(cb.book_id)) {
            const b = localMap.get(cb.book_id);
            if (!b.syncedAt) {
              b.syncedAt = (cb.uploaded_at || cb.last_read_at || 0) * 1000 || Date.now();
              changed = true;
            }
            if (!b.coverUrl && cb.cover_url) {
              b.coverUrl = cb.cover_url;
              changed = true;
            }
            if (cb.has_file !== undefined && b.has_file !== Boolean(cb.has_file)) {
              b.has_file = Boolean(cb.has_file);
              changed = true;
            }
            if ((!b.pageCount || b.pageCount <= 1) && (cb.page_count || cb.total_pages)) {
              b.pageCount = Number(cb.page_count || cb.total_pages);
              b.totalPages = b.pageCount;
              changed = true;
            }
            if (!b.type && (cb.file_type || cb.type)) {
              b.type = cb.file_type || cb.type;
              changed = true;
            }
            if (cb.ocr_page_count !== undefined && (!b.ocrPageCount || b.ocrPageCount === 0)) {
              b.ocrPageCount = Number(cb.ocr_page_count || 0);
              b.ocrCached = b.ocrPageCount > 0;
              changed = true;
            }
            if (cb.bubble_display && (!b.bubbleDisplay || b.bubbleDisplay === 'show')) {
              b.bubbleDisplay = cb.bubble_display;
              changed = true;
            }
            const cloudPage = Number(cb.current_page || 0);
            const cloudLastRead = (cb.last_read_at || 0) * 1000;
            const localLastRead = b.lastRead || 0;
            if (cloudPage > 0 && cloudPage !== b.currentPage) {
              if (cloudLastRead >= localLastRead || !b.lastRead) {
                b.currentPage = cloudPage;
                b.lastRead = cloudLastRead || Date.now();
                changed = true;
              }
            }
          } else {
            // New book from cloud that is not yet in this local browser / PWA!
            const newBook = {
              id: cb.book_id,
              title: cb.title || 'Untitled Manga',
              filename: cb.filename || cb.file_name || `${cb.book_id}.${cb.file_type || cb.type || 'cbz'}`,
              type: cb.file_type || cb.type || ((cb.file_name || cb.filename || '').endsWith('.pdf') ? 'pdf' : 'cbz'),
              size: Number(cb.size || cb.file_size || 0),
              pageCount: Number(cb.page_count || cb.total_pages || 1),
              totalPages: Number(cb.page_count || cb.total_pages || 1),
              currentPage: Number(cb.current_page || 1),
              coverUrl: cb.cover_url || '',
              syncedAt: (cb.uploaded_at || cb.last_read_at || 0) * 1000 || Date.now(),
              ocrCached: Boolean(cb.ocr_cached || (cb.ocr_page_count && cb.ocr_page_count > 0)),
              ocrPageCount: Number(cb.ocr_page_count || 0),
              bubbleDisplay: cb.bubble_display || 'show',
              isCloudOnly: true,
              has_file: cb.has_file !== undefined ? Boolean(cb.has_file) : undefined,
              folderId: 'default',
              bookmarks: []
            };
            bookList.push(newBook);
            localMap.set(newBook.id, newBook);
            changed = true;
          }
        }

        if (changed) {
          this.books = bookList;
          this.library = bookList;
          this.saveLibrary();
          this.render();
        }
        return res.books;
      }
    } catch (err) {
      console.debug('[Manga] Fetch cloud books notice:', err?.message || err);
    }
    return [];
  }

  async downloadAndOpenCloudBook(bookId, onProgress = null) {
    try {
      // 1. Resumable chunk download via MangaTransferService
      let downloadSuccess = false;
      try {
        const transferRes = await downloadMangaChunks(bookId, {
          requestFn: (ep, opts) => this.requestCloudApi(ep, opts),
          onProgress: (p) => {
            if (typeof onProgress === 'function') onProgress(p.current, p.total);
          }
        });
        downloadSuccess = Boolean(transferRes && transferRes.verified);
      } catch (chunkErr) {
        console.warn('[MangaTransfer] Chunk transfer error, checking legacy fallback:', chunkErr);
      }

      if (downloadSuccess) {
        const buffer = await getBookFileBuffer(bookId);
        let existing = (this.books || this.library || []).find(b => b.id === bookId);
        if (!existing) {
          const cb = (this.cloudBooks || []).find(b => (b.book_id || b.id) === bookId) || {};
          existing = {
            id: bookId,
            title: cb.title || 'Manga',
            filename: cb.filename || cb.file_name || `${bookId}.${cb.file_type || cb.type || 'pdf'}`,
            type: cb.file_type || cb.type || 'pdf',
            pageCount: Number(cb.page_count || cb.total_pages || 1),
            totalPages: Number(cb.page_count || cb.total_pages || 1),
            currentPage: Number(cb.current_page || 1),
            folderId: 'default',
            bookmarks: [],
            coverUrl: cb.cover_url || ''
          };
          (this.books || this.library).push(existing);
        }

        existing.isCloudOnly = false;
        existing.has_file = true;
        existing.syncStatus = 'verified';
        this.saveLibrary();
        return { success: true, buffer, book: existing };
      }

      // 2. Fallback to legacy single file_data in user_manga_books
      const res = await this.requestCloudApi(`/api/user/manga/${encodeURIComponent(bookId)}/file`, { method: 'GET' });
      if (res && res.file_data) {
        let buffer;
        if (typeof atob === 'function') {
          const bin = atob(res.file_data);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          buffer = u8.buffer;
        } else {
          buffer = Buffer.from(res.file_data, 'base64').buffer;
        }
        if (!this._memoryBookBuffers) this._memoryBookBuffers = new Map();
        this._memoryBookBuffers.set(bookId, buffer);

        try {
          await storeBookFile(bookId, buffer, { title: res.title, filename: res.filename, type: res.file_type });
        } catch (e) {
          console.warn('[Manga] storeBookFile fallback error:', e);
        }
        let existing = this.library.find(b => b.id === bookId);
        if (!existing) {
          existing = {
            id: bookId,
            title: res.title,
            filename: res.filename,
            type: res.file_type,
            totalPages: res.total_pages || 1,
            currentPage: 1,
            addedAt: Date.now()
          };
          this.library.unshift(existing);
        }
        existing.isCloudOnly = false;
        existing.has_file = true;
        this.saveLibrary();
        return { success: true, buffer, book: existing };
      }
    } catch (err) {
      console.warn('[Manga] Download cloud book error:', err);
    }
    return false;
  }

  /* -------------------------------------------------------------------------
   * Full Background Cloud Sync & Resumable Queue
   * ------------------------------------------------------------------------- */
  async syncAllToCloud() {
    if (this.isSyncing) return;
    if (!this.apiClient) return;

    this.isSyncing = true;
    this.syncStatus = 'syncing';
    this.updateSyncButtonUI();

    try {
      // 1. Fetch cloud books to deduplicate uploads
      const cloudBooksMap = new Map();
      try {
        const cloudList = await this.fetchCloudBooks();
        if (Array.isArray(cloudList)) {
          for (const cb of cloudList) {
            cloudBooksMap.set(cb.book_id, {
              size: Number(cb.size || 0),
              hasFile: Boolean(cb.has_file)
            });
          }
        }
      } catch (err) {
        console.warn('[MangaSync] fetchCloudBooks warning:', err);
      }

      // 2. Build aggregated bookmarks per book
      const bookList = this.books || this.library || [];
      const bookmarksMap = {};
      for (const b of bookList) {
        if (Array.isArray(b.bookmarks) && b.bookmarks.length > 0) {
          bookmarksMap[b.id] = b.bookmarks;
        }
      }

      // 3. Fetch all stored annotations
      let storedAnnotations = [];
      try {
        storedAnnotations = await getAllStoredAnnotations();
      } catch (err) {
        console.warn('[MangaSync] getAllStoredAnnotations warning:', err);
      }

      // 4. Construct pending task queue
      const tasks = [];

      // Task: library state (folders and bookmarks)
      tasks.push({
        type: 'library_state',
        folders: this.folders || [],
        bookmarks: bookmarksMap
      });

      // Tasks: book file uploads & reading progress
      for (const book of bookList) {
        const cloudInfo = cloudBooksMap.get(book.id);
        const localSize = Number(book.size || 0);
        // Queue upload if not on cloud, cloud has no file binary, or size differs significantly
        if (!cloudInfo || !cloudInfo.hasFile || (localSize > 0 && Math.abs(cloudInfo.size - localSize) > 4)) {
          tasks.push({
            type: 'book_file',
            bookId: book.id,
            title: book.title || 'Untitled Manga',
            filename: book.filename || `${book.id}.pdf`,
            fileType: book.type || 'pdf',
            size: localSize,
            totalPages: book.totalPages || 1,
            coverUrl: book.coverUrl || ''
          });
        }

        // Reading progress task
        tasks.push({
          type: 'progress',
          bookId: book.id,
          chapterNumber: 1,
          pageNumber: book.currentPage || 1,
          completed: (book.currentPage && book.totalPages && book.currentPage >= book.totalPages) ? 1 : 0
        });
      }

      // Tasks: annotations
      for (const annot of storedAnnotations) {
        if (annot.strokes && annot.strokes.length > 0) {
          tasks.push({
            type: 'annotation',
            bookId: annot.bookId,
            pageNumber: annot.pageNum,
            dataJson: JSON.stringify(annot.strokes)
          });
        }
      }

      const queueState = {
        id: `sync_${Date.now()}`,
        startedAt: Date.now(),
        total: tasks.length,
        completed: 0,
        tasks
      };

      localStorage.setItem(STORAGE_KEY_SYNC_QUEUE, JSON.stringify(queueState));
      this.syncProgress = { completed: 0, total: tasks.length };
      this.updateSyncButtonUI();

      await this.processSyncQueue();
    } catch (err) {
      console.warn('[MangaSync] Sync initialization error:', err);
      this.isSyncing = false;
      this.syncStatus = 'error';
      this.updateSyncButtonUI();
    }
  }

  cancelSync() {
    localStorage.removeItem(STORAGE_KEY_SYNC_QUEUE);
    this.isSyncing = false;
    this.syncStatus = 'idle';
    this.updateSyncButtonUI();
  }

  async processSyncQueue() {
    let rawQueue = localStorage.getItem(STORAGE_KEY_SYNC_QUEUE);
    if (!rawQueue) {
      this.isSyncing = false;
      this.syncStatus = 'idle';
      this.updateSyncButtonUI();
      return;
    }

    let queue;
    try {
      queue = JSON.parse(rawQueue);
    } catch (_) {
      localStorage.removeItem(STORAGE_KEY_SYNC_QUEUE);
      this.isSyncing = false;
      return;
    }

    // Auto-clear stale queue if older than 90 seconds to prevent getting stuck
    if (queue && queue.startedAt && Date.now() - queue.startedAt > 90000) {
      console.warn('[MangaSync] Clearing stale sync queue');
      localStorage.removeItem(STORAGE_KEY_SYNC_QUEUE);
      this.isSyncing = false;
      this.syncStatus = 'idle';
      this.updateSyncButtonUI();
      return;
    }

    if (!queue || !Array.isArray(queue.tasks) || queue.tasks.length === 0) {
      localStorage.removeItem(STORAGE_KEY_SYNC_QUEUE);
      localStorage.setItem(STORAGE_KEY_LAST_SYNC, String(Date.now()));
      this.isSyncing = false;
      this.syncStatus = 'synced';
      this.updateSyncButtonUI();
      setTimeout(() => {
        if (this.syncStatus === 'synced') {
          this.syncStatus = 'idle';
          this.updateSyncButtonUI();
        }
      }, 3000);
      return;
    }

    this.isSyncing = true;
    this.syncProgress = { completed: queue.completed || 0, total: queue.total || queue.tasks.length };
    this.updateSyncButtonUI();

    let hasFailures = false;
    while (queue.tasks.length > 0) {
      const task = queue.tasks[0];
      try {
        if (task.type === 'library_state') {
          await this.requestCloudApi('/api/user/manga/library-state', {
            method: 'POST',
            body: {
              folders: task.folders,
              bookmarks: task.bookmarks
            }
          });
        } else if (task.type === 'book_file') {
          const buffer = await getBookFileBuffer(task.bookId);
          const size = buffer ? buffer.byteLength : (task.size || 0);
          await this.requestCloudApi('/api/user/manga/upload', {
            method: 'POST',
            body: {
              book_id: task.bookId,
              title: task.title,
              filename: task.filename,
              file_type: task.fileType,
              size: size,
              total_pages: task.totalPages || 1,
              cover_url: task.coverUrl || '',
              file_data: ''
            }
          });

          if (buffer) {
            await uploadMangaChunks(task.bookId, buffer, {
              requestFn: (ep, opts) => this.requestCloudApi(ep, opts)
            });
            const localB = (this.books || this.library || []).find(b => b.id === task.bookId);
            if (localB) {
              localB.has_file = true;
              localB.syncStatus = 'verified';
              localB.syncedAt = Date.now();
              this.saveLibrary();
            }
          }
        } else if (task.type === 'progress') {
          await this.requestCloudApi('/api/user/progress/manga', {
            method: 'POST',
            body: {
              manga_id: task.bookId,
              chapter_number: task.chapterNumber || 1,
              page_number: task.pageNumber || 1,
              completed: task.completed || 0
            }
          });
        } else if (task.type === 'annotation') {
          await this.requestCloudApi('/api/user/manga/annotations', {
            method: 'POST',
            body: {
              book_id: task.bookId,
              page_number: task.pageNumber,
              data_json: task.dataJson
            }
          });
        }
      } catch (taskErr) {
        console.warn(`[MangaSync] Task ${task.type} failed:`, taskErr);
        task.retries = (task.retries || 0) + 1;
        if (task.retries < 3) {
          hasFailures = true;
          localStorage.setItem(STORAGE_KEY_SYNC_QUEUE, JSON.stringify(queue));
          break;
        } else {
          hasFailures = true;
          let failed = [];
          try {
            failed = JSON.parse(localStorage.getItem('kiroku.manga.failed_sync_tasks') || '[]');
          } catch (_) {}
          failed.push({ ...task, failedAt: Date.now(), error: String(taskErr?.message || taskErr) });
          localStorage.setItem('kiroku.manga.failed_sync_tasks', JSON.stringify(failed));
        }
      }

      // Dequeue task and persist immediately for crash resilience
      queue.tasks.shift();
      queue.completed = (queue.completed || 0) + 1;
      this.syncProgress = { completed: queue.completed, total: queue.total };
      localStorage.setItem(STORAGE_KEY_SYNC_QUEUE, JSON.stringify(queue));
      this.updateSyncButtonUI();

      // Non-blocking micro-delay yielding the main thread
      await new Promise(resolve => setTimeout(resolve, 40));
    }

    if (queue.tasks.length === 0 && !hasFailures) {
      localStorage.removeItem(STORAGE_KEY_SYNC_QUEUE);
      localStorage.setItem(STORAGE_KEY_LAST_SYNC, String(Date.now()));
      this.isSyncing = false;
      this.syncStatus = 'synced';
      this.updateSyncButtonUI();
      setTimeout(() => {
        if (this.syncStatus === 'synced') {
          this.syncStatus = 'idle';
          this.updateSyncButtonUI();
        }
      }, 3000);
    } else {
      this.isSyncing = false;
      this.syncStatus = 'error';
      this.updateSyncButtonUI();
    }
  }

  resumePendingSync() {
    const rawQueue = localStorage.getItem(STORAGE_KEY_SYNC_QUEUE);
    if (!rawQueue) return;
    try {
      const queue = JSON.parse(rawQueue);
      if (queue && Array.isArray(queue.tasks) && queue.tasks.length > 0) {
        // Automatically resume in background without UI interruption
        this.processSyncQueue();
      }
    } catch (_) {}
  }

  updateSyncButtonUI() {
    const btn = this.container?.querySelector('#btn-manga-sync-all');
    const label = this.container?.querySelector('#label-manga-sync');
    const icon = btn?.querySelector('.manga-sync-icon');
    if (!btn || !label) return;

    if (this.isSyncing) {
      btn.classList.add('is-syncing');
      icon?.classList.add('is-spinning');
      label.textContent = `Syncing (${this.syncProgress.completed}/${this.syncProgress.total})`;
      btn.title = `Syncing manga to cloud in background (${this.syncProgress.completed}/${this.syncProgress.total})`;
    } else if (this.syncStatus === 'synced') {
      btn.classList.remove('is-syncing');
      icon?.classList.remove('is-spinning');
      label.textContent = 'Synced';
      btn.title = 'All manga, folders, bookmarks and annotations synced to cloud';
    } else if (this.syncStatus === 'error') {
      btn.classList.remove('is-syncing');
      icon?.classList.remove('is-spinning');
      label.textContent = 'Sync Retry';
      btn.title = 'Sync interrupted. Click to retry';
    } else {
      btn.classList.remove('is-syncing');
      icon?.classList.remove('is-spinning');
      label.textContent = 'Sync Cloud';
      btn.title = 'Sync all manga, folders, bookmarks & annotations to cloud';
    }
  }
}
