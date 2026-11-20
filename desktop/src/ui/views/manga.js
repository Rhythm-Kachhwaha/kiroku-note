/**
 * Kiroku Note Desktop — Manga Reader View
 * Bookshelf Library with custom folders + Full-Screen Immersion Reader.
 * Client-side PDF (pdf.js) & CBZ (jszip) rendering with IndexedDB persistence,
 * automatic speech bubble detection, dual-page spread (book style),
 * tactile modals for folders & actions, and rich Migaku-style card mining.
 */

import { apiClient } from '../services/api_client.js';
import { escapeHtml } from '../utils/sanitizer.js';
import { storeBookFile, getBookFileBuffer, deleteBookFile, storePageAnnotations, getPageAnnotations, deletePageAnnotations, getAllStoredAnnotations } from '../services/manga_storage.js';
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
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = './ui/vendor/pdf.worker.min.js';
    }
  }
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

  // 1. If structured dictionary entries exist with senses
  if (Array.isArray(captureData.entries) && captureData.entries.length > 0) {
    const rows = [];
    let senseCounter = 1;
    captureData.entries.slice(0, 3).forEach((entry) => {
      (entry.senses || []).slice(0, 4).forEach((s) => {
        const glosses = (s.glosses || []).join('; ');
        if (!glosses) return;
        const pos = (s.parts_of_speech || []).join(', ');
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
    this.inspectorMode = 'sidebar'; // 'sidebar' | 'popover'
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

    // PWA manga import event listener (File Handling API & Web Share Target)
    this.boundPwaMangaHandler = async (e) => {
      if (e?.detail?.files?.length) {
        await this.openFiles(e.detail.files);
      }
    };
  }

  loadLibrary() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LIBRARY);
      const list = raw ? JSON.parse(raw) : [];
      return list.map(b => ({
        ...b,
        bookmarks: Array.isArray(b.bookmarks) ? b.bookmarks : []
      }));
    } catch {
      return [];
    }
  }

  saveLibrary(immediate = false) {
    const doSave = () => {
      try {
        const meta = this.books.map(b => ({
          id: b.id,
          title: b.title,
          type: b.type,
          folderId: b.folderId || 'default',
          pageCount: b.pageCount,
          currentPage: b.currentPage || 1,
          coverUrl: b.coverUrl || '',
          coverVersion: b.coverVersion || 1,
          bookmarks: Array.isArray(b.bookmarks) ? b.bookmarks : [],
          updatedAt: b.updatedAt || Date.now()
        }));
        localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify(meta));
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
    window.addEventListener('kiroku:pwa-manga-import', this.boundPwaMangaHandler);
    this.checkSharedMangaPayload();
    this.resumePendingSync();
  }

  onShow() {
    window.removeEventListener('keydown', this.boundKeyHandler);
    window.removeEventListener('keyup', this.boundKeyUpHandler);
    window.removeEventListener('mousemove', this.boundMouseMoveHandler);
    window.removeEventListener('mouseup', this.boundMouseUpHandler);

    window.addEventListener('keydown', this.boundKeyHandler);
    window.addEventListener('keyup', this.boundKeyUpHandler);
    window.addEventListener('mousemove', this.boundMouseMoveHandler);
    window.addEventListener('mouseup', this.boundMouseUpHandler);
    this.checkSharedMangaPayload();
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
    if (typeof window === 'undefined' || !('caches' in window)) return;
    try {
      const cache = await caches.open('kiroku-shared-manga');
      const match = await cache.match('/_shared_manga_payload');
      if (match) {
        await cache.delete('/_shared_manga_payload');
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
        if (window.location.hash === '#manga-shared') {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        await this.openFiles([file]);
      }
    } catch (err) {
      console.warn('[MangaView] checkSharedMangaPayload error:', err);
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

    const activeBooks = this.activeFolderId === 'all'
      ? this.books
      : this.books.filter(b => (b.folderId || 'default') === this.activeFolderId);

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
      return `
        <div class="manga-book-card" data-book-id="${escapeHtml(b.id)}">
          <div class="manga-book-cover-wrap">
            ${b.coverUrl
              ? `<img src="${b.coverUrl}" class="manga-book-cover-img" alt="${escapeHtml(b.title)}">`
              : `<div class="manga-book-cover-placeholder"><span>${escapeHtml(b.title.slice(0, 2).toUpperCase())}</span></div>`}
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
  }

  setupLibraryEvents() {
    const btnSyncAll = this.container.querySelector('#btn-manga-sync-all');
    btnSyncAll?.addEventListener('click', async (e) => {
      e.preventDefault();
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

    this.showModal(`
      <div class="tactile-modal-backdrop" id="manga-modal-backdrop">
        <div class="tactile-modal-card">
          <h3 class="text-base font-bold text-warm-paper">Book Options</h3>
          <div class="mt-3 flex flex-col gap-3">
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
          </div>
          <div class="modal-actions-row mt-4 justify-between">
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm text-red" id="btn-modal-delete-book">Remove Book</button>
            <div class="flex items-center gap-2">
              <button type="button" class="tactile-btn tactile-btn-primary tactile-btn-sm" id="btn-modal-send-to-phone">Send to Phone</button>
              <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-modal-cancel">Cancel</button>
              <button type="button" class="tactile-btn tactile-btn-gold tactile-btn-sm" id="btn-modal-save-book">Save</button>
            </div>
          </div>
        </div>
      </div>
    `, () => {
      this.container.querySelector('#btn-modal-send-to-phone')?.addEventListener('click', () => {
        this.closeModal();
        this.openSendToPhoneModal(bookId);
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
        try {
          const bookBuf = await getBookFileBuffer(bookId);
          if (bookBuf) {
            try {
              await this.apiClient.request(`/api/manga/upload?book_id=${encodeURIComponent(bookId)}&filename=${encodeURIComponent(book.filename || book.title || 'manga.pdf')}&title=${encodeURIComponent(book.title || 'Manga')}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: bookBuf
              });
            } catch (upErr) {
              console.warn('[Manga] Could not pre-upload buffer to backend:', upErr);
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
          const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : 'http://127.0.0.1:8000';
          streamUrl = `${origin}/api/manga/stream/${encodeURIComponent(bookId)}?ticket=${ticket || 'preview_ticket'}`;
        }

        const qrSvg = await fetchOrGenerateQrSvg(streamUrl);
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
    const outdatedBooks = this.books.filter(b => !b.coverUrl || b.coverVersion !== 2);
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

          let dataUrl = '';
          try {
            dataUrl = canvas.toDataURL('image/webp', 0.92);
            if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
              dataUrl = canvas.toDataURL('image/jpeg', 0.92);
            }
          } catch {
            dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          }

          book.coverUrl = dataUrl;
          book.coverVersion = 2;
          this.saveLibrary();
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
              img.onload = () => {
                const canvas = document.createElement('canvas');
                const targetWidth = 720;
                const scale = Math.max(1.0, targetWidth / img.width);
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext('2d', { alpha: false });
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                let dataUrl = '';
                try {
                  dataUrl = canvas.toDataURL('image/webp', 0.92);
                  if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
                    dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                  }
                } catch {
                  dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                }

                book.coverUrl = dataUrl;
                book.coverVersion = 2;
                URL.revokeObjectURL(url);
                this.saveLibrary();
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

        // Live update thumbnail in DOM if visible
        const cardImg = this.container?.querySelector(`.manga-book-card[data-book-id="${book.id}"] .manga-book-cover-img`);
        if (cardImg && book.coverUrl) {
          cardImg.src = book.coverUrl;
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

          <div class="manga-topbar-center">
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

          <div class="manga-topbar-right">
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
            <button type="button" class="manga-nav-btn" id="btn-reader-prev" title="Previous Page (D / ArrowRight)">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
              <span>Prev</span>
              <span class="manga-btn-subkey">D</span>
            </button>

            <div class="manga-page-stepper">
              <input type="number" id="manga-page-input" class="manga-page-input" min="1" max="${this.pageCount}" value="${this.currentPage}">
              <span class="manga-page-total font-mono">/ ${this.pageCount}</span>
            </div>

            <button type="button" class="manga-nav-btn" id="btn-reader-next" title="Next Page (A / ArrowLeft)">
              <span class="manga-btn-subkey">A</span>
              <span>Next</span>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
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

    // Drag-to-Pan & OCR Selection Mousedown
    stageCard?.addEventListener('mousedown', (e) => this.handleMouseDown(e));

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

        const bookId = 'book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        await storeBookFile(bookId, itemBuffer);

        const newBook = {
          id: bookId,
          title: item.title,
          type: item.type === 'pdf' ? 'pdf' : 'cbz',
          folderId: targetFolderId,
          pageCount: 1,
          currentPage: 1,
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

        const existingIdx = this.books.findIndex(b => b.title === newBook.title && b.folderId === targetFolderId);
        if (existingIdx >= 0) {
          newBook.id = this.books[existingIdx].id;
          newBook.currentPage = this.books[existingIdx].currentPage || 1;
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
      const bookId = 'book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const title = file.name.replace(/\.[^/.]+$/, '');

      let type = 'image';
      if (extension === 'pdf') type = 'pdf';
      else if (extension === 'cbz' || extension === 'zip') type = 'cbz';

      this.updateLoadingStatus('Reading file bytes...', file.name);
      await new Promise(r => setTimeout(r, 20));
      const arrayBuffer = await file.arrayBuffer();

      this.updateLoadingStatus('Saving to offline storage...', 'Storing in IndexedDB');
      await storeBookFile(bookId, arrayBuffer);

      const newBook = {
        id: bookId,
        title,
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
    } finally {
      if (shouldRender) {
        this.hideLoading();
      }
    }
  }

  async loadAndOpenBook(bookId, initialPage = null) {
    const book = this.books.find(b => b.id === bookId);
    if (!book) return;

    this.showLoading('Opening Volume...', book.title);

    try {
      this.updateLoadingStatus('Retrieving from storage...', book.title);
      const buffer = await getBookFileBuffer(bookId);
      if (!buffer) {
        this.hideLoading();
        const fileInput = this.container?.querySelector('#manga-library-file-input');
        fileInput?.click();
        return;
      }

      this.updateLoadingStatus('Initializing pages...', 'Parsing volume contents');
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

  async initPdfFromBuffer(book, arrayBuffer) {
    if (typeof window.pdfjsLib === 'undefined') {
      console.warn('[MangaView] pdf.js not loaded on window.');
      return;
    }
    ensurePdfWorker();
    try {
      const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
      this.pdfDoc = await loadingTask.promise;
      book.pageCount = this.pdfDoc.numPages;
    } catch (err) {
      console.error('[MangaView] Failed to load PDF:', err);
    }
  }

  async initCbzFromBuffer(book, arrayBuffer) {
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
    if (!force && book.coverUrl && book.coverVersion === 2) return;
    ensurePdfWorker();

    try {
      const thumbCanvas = document.createElement('canvas');
      const targetWidth = 720; // High-resolution retina thumbnail width

      if (book.type === 'pdf' && this.pdfDoc) {
        const page1 = await this.pdfDoc.getPage(1);
        const vp = page1.getViewport({ scale: 1.0 });
        const scale = Math.max(1.5, targetWidth / vp.width);
        const scaledVp = page1.getViewport({ scale });
        thumbCanvas.width = Math.round(scaledVp.width);
        thumbCanvas.height = Math.round(scaledVp.height);
        const ctx = thumbCanvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        await page1.render({ canvasContext: ctx, viewport: scaledVp }).promise;

        let dataUrl = '';
        try {
          dataUrl = thumbCanvas.toDataURL('image/webp', 0.92);
          if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
            dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.92);
          }
        } catch {
          dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.92);
        }

        book.coverUrl = dataUrl;
        book.coverVersion = 2;
        this.saveLibrary();
      } else if (book.type === 'cbz' && this.cbzImageEntries.length > 0) {
        const entry = this.cbzImageEntries[0];
        const blob = await entry.async('blob');
        const url = URL.createObjectURL(blob);
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const scale = Math.max(1.0, targetWidth / img.width);
            thumbCanvas.width = Math.round(img.width * scale);
            thumbCanvas.height = Math.round(img.height * scale);
            const ctx = thumbCanvas.getContext('2d', { alpha: false });
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);

            let dataUrl = '';
            try {
              dataUrl = thumbCanvas.toDataURL('image/webp', 0.92);
              if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
                dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.92);
              }
            } catch {
              dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.92);
            }

            book.coverUrl = dataUrl;
            book.coverVersion = 2;
            URL.revokeObjectURL(url);
            this.saveLibrary();
            resolve();
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
  nextPage() {
    const step = this.spreadMode === 'double' ? 2 : 1;
    if (this.currentPage + step <= this.pageCount) {
      this.goToPage(this.currentPage + step);
    } else if (this.currentPage < this.pageCount) {
      this.goToPage(this.pageCount);
    }
  }

  prevPage() {
    const step = this.spreadMode === 'double' ? 2 : 1;
    if (this.currentPage - step >= 1) {
      this.goToPage(this.currentPage - step);
    } else if (this.currentPage > 1) {
      this.goToPage(1);
    }
  }

  goToPage(pageNum) {
    this.currentPage = Math.max(1, Math.min(this.pageCount, pageNum));
    if (this.currentBook) {
      this.currentBook.currentPage = this.currentPage;
      this.currentBook.lastRead = Date.now();
      this.saveLibrary();
      // Sync reading progress to cloud per user
      if (this.apiClient) {
        try {
          this.apiClient.request('/api/user/progress/manga', {
            method: 'POST',
            body: {
              manga_id: this.currentBook.id,
              chapter_number: 1.0,
              page_number: this.currentPage,
              completed: this.currentPage >= this.pageCount ? 1 : 0
            }
          }).catch(() => {});
        } catch (_) {}
      }
    }
    this.clearBubbleOverlays();
    this.closePopover();

    const pageInput = this.container?.querySelector('#manga-page-input');
    if (pageInput) pageInput.value = this.currentPage;

    // Check prefetch and bubble cache for instant hit
    const cacheKey = this.currentBook ? `${this.currentBook.id}_${this.currentPage}_${this.spreadMode}` : null;
    if (cacheKey && (this.bubbleCache.has(cacheKey) || this.prefetchOcrCache.has(cacheKey))) {
      this.detectedBubbles = this.bubbleCache.get(cacheKey) || this.prefetchOcrCache.get(cacheKey) || [];
    }

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

    if (this.detectedBubbles && this.detectedBubbles.length > 0) {
      this.renderBubbleOverlays();
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
        const blob = await entry.async('blob');
        const url = URL.createObjectURL(blob);
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
          };
          img.onerror = reject;
          img.src = url;
        });
      };

      if (!isDouble) {
        const img = await loadImgFromEntry(this.cbzImageEntries[pageNumber - 1]);
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const isMainCanvas = !this.container || canvas === this.container?.querySelector('#manga-canvas');
        if (isMainCanvas) this.currentImage = img;
      } else {
        const imgRight = await loadImgFromEntry(this.cbzImageEntries[pageNumber - 1]);
        const imgLeft = await loadImgFromEntry(this.cbzImageEntries[pageNumber]);

        const totalWidth = imgLeft.width + imgRight.width;
        const maxHeight = Math.max(imgLeft.height, imgRight.height);

        canvas.width = totalWidth;
        canvas.height = maxHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.drawImage(imgLeft, 0, 0);
        ctx.drawImage(imgRight, imgLeft.width, 0);

        const isMainCanvas = !this.container || canvas === this.container?.querySelector('#manga-canvas');
        if (isMainCanvas) this.currentImage = canvas;
      }
    } catch (err) {
      console.error('[MangaView] Failed to render CBZ spread:', err);
    }
  }

  async renderSingleImageFile(file, canvas) {
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
   * Mouse & Touch Interaction: Smooth Canvas Drag-Pan, Selection, Annotations
   * ------------------------------------------------------------------------- */
  handleMouseDown(e) {
    if (!this.currentImage) return;
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
  async performOcrBoxSelection(startX, startY, endX, endY, anchor) {
    this.ocrBoxSelection = { startX, startY, endX, endY };
    this.lastAnchor = anchor;
    const canvas = this.container?.querySelector('#manga-canvas');
    if (!canvas) return;

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

      let res = null;
      if (window.desktopAPI?.ocr?.recognize) {
        try {
          const onDevice = await window.desktopAPI.ocr.recognize({ image: base64Data });
          if (onDevice && !onDevice.fallback && onDevice.text) {
            res = { text: onDevice.text };
          }
        } catch (onDevErr) {
          console.info('[MangaView] On-device OCR skipped, falling back to server:', onDevErr);
        }
      }

      if (!res) {
        res = await this.apiClient.request('/api/ocr/recognize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64Data })
        });
      }

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

    // Tokenize sentence using Subtitle Annotator API (Sudachi / MeCab / OpenJLPT)
    let tokens = [];
    try {
      const annotateRes = await this.apiClient.annotateText(sentence);
      if (annotateRes && annotateRes.cues && annotateRes.cues[0] && Array.isArray(annotateRes.cues[0].tokens)) {
        tokens = annotateRes.cues[0].tokens;
      }
    } catch (err) {
      console.debug('[MangaView] annotateText fallback to regex:', err);
    }

    // Fallback: if backend annotation is empty or fails, use regex tokenizer
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
        if (captureData.entries && captureData.entries.length > 0) {
          const renderedSenses = [];
          captureData.entries.slice(0, 4).forEach((entry) => {
            (entry.senses || []).forEach((s, sIdx) => {
              const glosses = (s.glosses || []).join('; ');
              const pos = (s.parts_of_speech || []).join(', ');
              renderedSenses.push(`
                <div class="manga-definition-row">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-mono text-gold font-bold">${sIdx + 1}.</span>
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
            <div class="text-xs mt-2 line-height-relaxed">${escapeHtml(meaning || 'No definitions found')}</div>
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
      deck_name: 'Default',
      tags: 'kiroku,manga'
    };

    try {
      if (typeof this.apiClient.saveCard === 'function') {
        await this.apiClient.saveCard(cardPayload);
      } else {
        await this.apiClient.request('/api/cards/save', {
          method: 'POST',
          body: cardPayload
        });
      }

      // Mark word as known in background
      try {
        if (typeof this.apiClient.markKnownWord === 'function') {
          await this.apiClient.markKnownWord(word);
        }
      } catch (err) {
        console.debug('[MangaView] Mark known fallback:', err);
      }

      if (mineBtn) {
        mineBtn.classList.add('is-mined');
        mineBtn.disabled = true;
        if (mineLabel) mineLabel.textContent = '✓ Saved';
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
    if (this.bubbleCache.has(cacheKey)) {
      this.detectedBubbles = this.bubbleCache.get(cacheKey) || [];
      this.renderBubbleOverlays();
      if (label) {
        label.textContent = this.detectedBubbles.length > 0 ? `${this.detectedBubbles.length} Bubbles Found` : 'No Bubbles Found';
      }
      return;
    }

    this.isAutoDetecting = true;
    if (label) label.textContent = 'Detecting...';
    if (btn) btn.disabled = true;

    try {
      const fullPageB64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      let res = null;
      if (window.desktopAPI?.ocr?.detect) {
        try {
          const onDevice = await window.desktopAPI.ocr.detect({ image: fullPageB64, conf_threshold: 0.35 });
          if (onDevice && !onDevice.fallback && Array.isArray(onDevice.bubbles)) {
            res = { boxes: onDevice.bubbles };
          }
        } catch (onDevErr) {
          console.info('[MangaView] On-device bubble detection skipped, falling back to server:', onDevErr);
        }
      }

      if (!res) {
        res = await this.apiClient.request('/api/ocr/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: fullPageB64, conf_threshold: 0.35 })
        });
      }

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
      const left = x1 * scaleX;
      const top = y1 * scaleY;
      const width = (x2 - x1) * scaleX;
      const height = (y2 - y1) * scaleY;

      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'manga-bubble-hitbox';
      if (this.selectedBubbleIndex === idx) {
        bubbleEl.classList.add('is-selected');
      }
      bubbleEl.style.left = `${left}px`;
      bubbleEl.style.top = `${top}px`;
      bubbleEl.style.width = `${width}px`;
      bubbleEl.style.height = `${height}px`;
      bubbleEl.title = `Bubble ${idx + 1} (${Math.round(bubble.score * 100)}%) — Click to OCR`;

      bubbleEl.innerHTML = `<span class="manga-bubble-tag">${idx + 1}</span>`;

      bubbleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedBubbleIndex = idx;
        overlayLayer.querySelectorAll('.manga-bubble-hitbox').forEach(b => b.classList.remove('is-selected'));
        bubbleEl.classList.add('is-selected');

        const anchor = {
          x: left + rect.left,
          y: top + height + rect.top + 8
        };
        this.performOcrBoxSelection(x1, y1, x2, y2, anchor);
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

    const popWidth = 390;
    const popHeight = 300;
    let posX = Math.max(16, Math.min(window.innerWidth - popWidth - 16, anchor ? anchor.x : 50));
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

    const onMouseDown = (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      header.style.cursor = 'grabbing';
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = popover.offsetLeft;
      initialTop = popover.offsetTop;

      const onMouseMove = (ev) => {
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

      const onMouseUp = () => {
        isDragging = false;
        header.style.cursor = 'grab';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    };

    header.addEventListener('mousedown', onMouseDown);
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
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg><span>Saved</span>`;
    }

    try {
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
        deck_name: 'Default',
        tags: 'kiroku,manga'
      };

      if (typeof this.apiClient.saveCard === 'function') {
        await this.apiClient.saveCard(cardPayload);
      } else {
        await this.apiClient.request('/api/cards/save', {
          method: 'POST',
          body: cardPayload
        });
      }

      try {
        if (typeof this.apiClient.markKnownWord === 'function') {
          await this.apiClient.markKnownWord(word);
        }
      } catch (err) {
        console.debug('[MangaView] Mark known fallback:', err);
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
    const step = this.spreadMode === 'double' ? 2 : 1;
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

      let res = null;
      if (window.desktopAPI?.ocr?.detect) {
        try {
          const onDevice = await window.desktopAPI.ocr.detect({ image: fullPageB64, conf_threshold: 0.35 });
          if (onDevice && !onDevice.fallback && Array.isArray(onDevice.bubbles)) {
            res = { boxes: onDevice.bubbles };
          }
        } catch {
          // fallback to server
        }
      }

      if (!res) {
        res = await this.apiClient.request('/api/ocr/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: fullPageB64, conf_threshold: 0.35 })
        });
      }

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

    this.isDrawing = true;
    this.currentStroke = {
      tool: this.activeTool,
      color: this.activeTool === 'eraser' ? 'rgba(0,0,0,1)' : this.annotationColor,
      width: this.activeTool === 'eraser' ? Math.max(24, this.annotationLineWidth * 3) : this.annotationLineWidth,
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
    const key = `${this.currentBook?.id}_p${this.currentPage}`;
    let pageStrokes = this.pageAnnotationsMap.get(key) || [];
    pageStrokes.push(this.currentStroke);
    this.pageAnnotationsMap.set(key, pageStrokes);
    this.currentStroke = null;

    // Clear redo history on new stroke
    this.annotationRedoMap.delete(key);
    this.updateUndoRedoButtonState();

    if (this.currentBook?.id) {
      try {
        await storePageAnnotations(this.currentBook.id, this.currentPage, pageStrokes);
      } catch (_) {}

      if (this.apiClient) {
        try {
          this.apiClient.request('/api/user/manga/annotations', {
            method: 'POST',
            body: {
              book_id: this.currentBook.id,
              page_number: this.currentPage,
              data_json: JSON.stringify(pageStrokes)
            }
          }).catch(() => {});
        } catch (_) {}
      }
    }
  }

  async undoAnnotationStroke() {
    if (!this.currentBook) return;
    const key = `${this.currentBook.id}_p${this.currentPage}`;
    const pageStrokes = this.pageAnnotationsMap.get(key) || [];
    if (!pageStrokes.length) return;

    const popped = pageStrokes.pop();
    let redoList = this.annotationRedoMap.get(key);
    if (!redoList) {
      redoList = [];
      this.annotationRedoMap.set(key, redoList);
    }
    redoList.push(popped);

    await this.saveAndRedrawAnnotations(key, pageStrokes);
    this.updateUndoRedoButtonState();
  }

  async redoAnnotationStroke() {
    if (!this.currentBook) return;
    const key = `${this.currentBook.id}_p${this.currentPage}`;
    const redoList = this.annotationRedoMap.get(key);
    if (!redoList || !redoList.length) return;

    const restored = redoList.pop();
    let pageStrokes = this.pageAnnotationsMap.get(key) || [];
    pageStrokes.push(restored);

    await this.saveAndRedrawAnnotations(key, pageStrokes);
    this.updateUndoRedoButtonState();
  }

  async saveAndRedrawAnnotations(key, pageStrokes) {
    this.pageAnnotationsMap.set(key, pageStrokes);
    this.redrawAnnotationCanvas(pageStrokes);

    if (this.currentBook?.id) {
      try {
        await storePageAnnotations(this.currentBook.id, this.currentPage, pageStrokes);
      } catch (_) {}

      if (this.apiClient) {
        try {
          this.apiClient.request('/api/user/manga/annotations', {
            method: 'POST',
            body: {
              book_id: this.currentBook.id,
              page_number: this.currentPage,
              data_json: JSON.stringify(pageStrokes)
            }
          }).catch(() => {});
        } catch (_) {}
      }
    }
  }

  redrawAnnotationCanvas(strokes) {
    const annotCanvas = this.container?.querySelector('#manga-annotation-canvas');
    if (!annotCanvas) return;
    const ctx = annotCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
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
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x, s.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  updateUndoRedoButtonState() {
    if (!this.currentBook) return;
    const key = `${this.currentBook.id}_p${this.currentPage}`;
    const pageStrokes = this.pageAnnotationsMap.get(key) || [];
    const redoList = this.annotationRedoMap.get(key) || [];

    const btnUndo = this.container?.querySelector('#btn-annotation-undo');
    const btnRedo = this.container?.querySelector('#btn-annotation-redo');
    if (btnUndo) {
      btnUndo.disabled = pageStrokes.length === 0;
      btnUndo.classList.toggle('is-disabled', pageStrokes.length === 0);
    }
    if (btnRedo) {
      btnRedo.disabled = redoList.length === 0;
      btnRedo.classList.toggle('is-disabled', redoList.length === 0);
    }
  }

  async loadAndRenderPageAnnotations() {
    const annotCanvas = this.container?.querySelector('#manga-annotation-canvas');
    if (!annotCanvas) return;
    const ctx = annotCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);

    if (!this.currentBook) return;
    const key = `${this.currentBook.id}_p${this.currentPage}`;
    let strokes = this.pageAnnotationsMap.get(key);
    if (!strokes) {
      try {
        strokes = await getPageAnnotations(this.currentBook.id, this.currentPage);
        if (strokes && strokes.length) {
          this.pageAnnotationsMap.set(key, strokes);
        }
      } catch (_) {}
    }

    if (strokes && strokes.length) {
      this.redrawAnnotationCanvas(strokes);
    }
    this.updateUndoRedoButtonState();
  }

  async clearCurrentPageAnnotations() {
    if (!this.currentBook) return;
    const key = `${this.currentBook.id}_p${this.currentPage}`;
    const previous = this.pageAnnotationsMap.get(key);
    if (previous && previous.length) {
      let redoList = this.annotationRedoMap.get(key) || [];
      redoList.push(...previous);
      this.annotationRedoMap.set(key, redoList);
    }
    this.pageAnnotationsMap.delete(key);
    try {
      await deletePageAnnotations(this.currentBook.id, this.currentPage);
    } catch (_) {}
    const annotCanvas = this.container?.querySelector('#manga-annotation-canvas');
    if (annotCanvas) {
      const ctx = annotCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
    }
    this.updateUndoRedoButtonState();
    if (this.apiClient) {
      try {
        this.apiClient.request(`/api/user/manga/annotations/${encodeURIComponent(this.currentBook.id)}/${this.currentPage}`, {
          method: 'DELETE'
        }).catch(() => {});
      } catch (_) {}
    }
  }

  /* -------------------------------------------------------------------------
   * Cloud Manga Storage & Remote Sync
   * ------------------------------------------------------------------------- */
  async uploadBookToCloud(bookId) {
    const book = this.library.find(b => b.id === bookId);
    if (!book) return false;
    const buffer = await getBookFileBuffer(bookId);
    if (!buffer) return false;

    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const fileData = (typeof btoa === 'function') ? btoa(binary) : Buffer.from(buffer).toString('base64');

    const res = await this.apiClient.request('/api/user/manga/upload', {
      method: 'POST',
      body: {
        book_id: book.id,
        title: book.title,
        filename: book.filename || `${book.id}.pdf`,
        file_type: book.type || 'pdf',
        size: book.size || buffer.byteLength,
        total_pages: book.totalPages || 1,
        file_data: fileData
      }
    });
    return Boolean(res && res.ok);
  }

  async fetchCloudBooks() {
    try {
      const res = await this.apiClient.request('/api/user/manga/list', { method: 'GET' });
      if (res && Array.isArray(res.books)) {
        this.cloudBooks = res.books;
        return res.books;
      }
    } catch (err) {
      console.warn('[Manga] Fetch cloud books error:', err);
    }
    return [];
  }

  async downloadAndOpenCloudBook(bookId) {
    try {
      const res = await this.apiClient.request(`/api/user/manga/${encodeURIComponent(bookId)}/file`, { method: 'GET' });
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
        await storeBookFile(bookId, buffer, { title: res.title, filename: res.filename, type: res.file_type });
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
          this.saveLibrary();
        }
        await this.openReader(existing);
        return true;
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
            cloudBooksMap.set(cb.book_id, Number(cb.size || 0));
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
        const cloudSize = cloudBooksMap.get(book.id);
        const localSize = Number(book.size || 0);
        // Only queue upload if not on cloud or size differs significantly
        if (cloudSize === undefined || (localSize > 0 && Math.abs(cloudSize - localSize) > 4)) {
          tasks.push({
            type: 'book_file',
            bookId: book.id,
            title: book.title || 'Untitled Manga',
            filename: book.filename || `${book.id}.pdf`,
            fileType: book.type || 'pdf',
            size: localSize,
            totalPages: book.totalPages || 1
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

    while (queue.tasks.length > 0) {
      const task = queue.tasks[0];
      try {
        if (task.type === 'library_state') {
          if (this.apiClient) {
            await this.apiClient.request('/api/user/manga/library-state', {
              method: 'POST',
              body: {
                folders: task.folders,
                bookmarks: task.bookmarks
              }
            });
          }
        } else if (task.type === 'book_file') {
          const buffer = await getBookFileBuffer(task.bookId);
          if (buffer && this.apiClient) {
            let binary = '';
            const bytes = new Uint8Array(buffer);
            const len = bytes.byteLength;
            for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const fileData = (typeof btoa === 'function') ? btoa(binary) : Buffer.from(buffer).toString('base64');
            await this.apiClient.request('/api/user/manga/upload', {
              method: 'POST',
              body: {
                book_id: task.bookId,
                title: task.title,
                filename: task.filename,
                file_type: task.fileType,
                size: task.size || buffer.byteLength,
                total_pages: task.totalPages || 1,
                file_data: fileData
              }
            });
          }
        } else if (task.type === 'progress') {
          if (this.apiClient) {
            await this.apiClient.request('/api/user/progress/manga', {
              method: 'POST',
              body: {
                manga_id: task.bookId,
                chapter_number: task.chapterNumber || 1,
                page_number: task.pageNumber || 1,
                completed: task.completed || 0
              }
            });
          }
        } else if (task.type === 'annotation') {
          if (this.apiClient) {
            await this.apiClient.request('/api/user/manga/annotations', {
              method: 'POST',
              body: {
                book_id: task.bookId,
                page_number: task.pageNumber,
                data_json: task.dataJson
              }
            });
          }
        }
      } catch (taskErr) {
        console.warn(`[MangaSync] Task ${task.type} failed, will proceed:`, taskErr);
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

    // All tasks completed
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
