/**
 * Kiroku Note Desktop — Manga Reader View
 * Bookshelf Library with custom folders + Full-Screen Immersion Reader.
 * Client-side PDF (pdf.js) & CBZ (jszip) rendering with IndexedDB persistence,
 * automatic speech bubble detection, dual-page spread (book style),
 * tactile modals for folders & actions, and rich Migaku-style card mining.
 */

import { apiClient } from '../services/api_client.js';
import { escapeHtml } from '../utils/sanitizer.js';
import { storeBookFile, getBookFileBuffer, deleteBookFile } from '../services/manga_storage.js';

const STORAGE_KEY_LIBRARY = 'kiroku.manga.library';
const STORAGE_KEY_FOLDERS = 'kiroku.manga.folders';
const STORAGE_KEY_SPREAD = 'kiroku.manga.spread_mode';

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
    this.folders = this.loadFolders();
    this.activeFolderId = 'all';

    // Modal State
    this.activeModal = null; // 'create_folder' | 'rename_folder' | 'delete_folder' | 'book_menu'
    this.modalContext = null;

    // Spread mode: 'single' or 'double' (like actual manga books)
    this.spreadMode = localStorage.getItem(STORAGE_KEY_SPREAD) === 'double' ? 'double' : 'single';

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

    // Floating Popover State
    this.popoverVisible = false;
    this.popoverAnchor = { x: 0, y: 0 };
    this.recognizedText = '';
    this.lastMinedWord = null;

    // Keydown handler bind
    this.boundKeyHandler = (e) => this.handleKeyDown(e);
  }

  loadLibrary() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LIBRARY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  saveLibrary() {
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
        updatedAt: b.updatedAt || Date.now()
      }));
      localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify(meta));
    } catch (e) {
      console.warn('[MangaView] Failed to save library to storage:', e);
    }
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
  }

  onHide() {
    this.closePopover();
    this.closeModal();
  }

  unmount() {
    window.removeEventListener('keydown', this.boundKeyHandler);
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
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
      return `
        <div class="manga-book-card" data-book-id="${escapeHtml(b.id)}">
          <div class="manga-book-cover-wrap">
            ${b.coverUrl
              ? `<img src="${b.coverUrl}" class="manga-book-cover-img" alt="${escapeHtml(b.title)}">`
              : `<div class="manga-book-cover-placeholder"><span>${escapeHtml(b.title.slice(0, 2).toUpperCase())}</span></div>`}
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
      <div class="manga-library-dropzone-card" id="manga-library-dropzone">
        <label for="manga-library-file-input" class="manga-dropzone-label cursor-pointer">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" class="manga-dropzone-icon">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
          </svg>
          <div class="text-xs font-bold mt-2 text-center text-warm-paper">Drop Manga Here</div>
          <div class="text-xs text-muted text-center mt-1">PDF, CBZ or Image</div>
        </label>
        <input type="file" id="manga-library-file-input" accept=".pdf,.cbz,.zip,image/*" style="display: none;" />
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
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-add-folder" title="Create New Folder">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10zm-7-1h2v-3h3v-2h-3V9h-2v3h-3v2h3z"/></svg>
              <span>New Folder</span>
            </button>
            <label class="tactile-btn tactile-btn-primary tactile-btn-sm cursor-pointer manga-add-btn" for="manga-library-file-input">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              <span>Add Manga</span>
            </label>
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
    const fileInput = this.container.querySelector('#manga-library-file-input');
    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        this.openFile(file);
        fileInput.value = '';
      }
    });

    const dropzone = this.container.querySelector('#manga-library-dropzone');
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    });
    dropzone?.addEventListener('dragleave', () => {
      dropzone.classList.remove('is-dragover');
    });
    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) this.openFile(file);
    });

    // Whole view drop listener: dropping anywhere in Manga view opens the file safely
    this.container.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    this.container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer?.files?.[0];
      if (file) this.openFile(file);
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

    // Bookshelf card clicks and book options
    const grid = this.container.querySelector('.manga-bookshelf-grid');
    grid?.addEventListener('click', async (e) => {
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
              <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-modal-cancel">Cancel</button>
              <button type="button" class="tactile-btn tactile-btn-gold tactile-btn-sm" id="btn-modal-save-book">Save</button>
            </div>
          </div>
        </div>
      </div>
    `, () => {
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

  showModal(html, onMount) {
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

    onMount?.();
  }

  closeModal() {
    const host = this.container?.querySelector('#manga-modal-host');
    if (host) {
      host.innerHTML = '';
      host.style.display = 'none';
    }
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

    this.container.innerHTML = `
      <div class="manga-immersion-reader" id="manga-immersion-reader">
        <!-- Reader Navigation Top Bar -->
        <header class="manga-reader-topbar">
          <div class="manga-topbar-left">
            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-reader-back-library" title="Back to Bookshelf">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
              <span>Bookshelf</span>
            </button>
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
                <span>2-Page Book</span>
              </button>
            </div>

            <div class="manga-topbar-divider"></div>

            <!-- Tactile Bubble Detection Controls -->
            <button type="button" class="tactile-btn tactile-btn-gold tactile-btn-sm" id="btn-detect-bubbles" title="Detect Speech Bubbles via AI">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
              <span id="label-detect-bubbles">Detect Bubbles (AI)</span>
            </button>

            <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-clear-bubbles" title="Clear Bubble Overlays">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              <span>Clear</span>
            </button>
          </div>

          <div class="manga-topbar-right">
            <span class="manga-reader-hint text-xs text-muted">A / Left = Next | D / Right = Prev</span>
          </div>
        </header>

        <!-- Canvas Stage -->
        <div class="manga-stage-card" id="manga-stage-card">
          <div class="manga-canvas-wrapper" id="manga-canvas-wrapper">
            <canvas class="manga-canvas" id="manga-canvas"></canvas>
            <div class="manga-bubble-overlay-layer" id="manga-bubble-overlay-layer"></div>
            <div class="manga-selection-box" id="manga-selection-box" style="display: none;"></div>
          </div>
        </div>

        <!-- Floating Yomitan Popover (Migaku-style) -->
        <div class="manga-floating-popover" id="manga-floating-popover" style="display: none;">
          <div class="manga-popover-header">
            <span class="manga-popover-badge font-mono text-gold">OCR Recognition</span>
            <button type="button" class="manga-popover-close-btn" id="btn-close-popover" aria-label="Close Popover">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
          <div class="manga-popover-sentence" id="manga-popover-sentence">
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
            </button>

            <div class="manga-page-stepper">
              <input type="number" id="manga-page-input" class="manga-page-input" min="1" max="${this.pageCount}" value="${this.currentPage}">
              <span class="manga-page-total font-mono">/ ${this.pageCount}</span>
            </div>

            <button type="button" class="manga-nav-btn" id="btn-reader-next" title="Next Page (A / ArrowLeft)">
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

  setupReaderEvents() {
    const btnBackLib = this.container.querySelector('#btn-reader-back-library');
    btnBackLib?.addEventListener('click', () => {
      this.closePopover();
      this.activeMode = 'library';
      this.render();
    });

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

    const btnDetect = this.container.querySelector('#btn-detect-bubbles');
    btnDetect?.addEventListener('click', () => this.detectBubblesOnCurrentPage());

    const btnClear = this.container.querySelector('#btn-clear-bubbles');
    btnClear?.addEventListener('click', () => this.clearBubbleOverlays());

    const btnClosePop = this.container.querySelector('#btn-close-popover');
    btnClosePop?.addEventListener('click', () => this.closePopover());

    const wrapper = this.container.querySelector('#manga-canvas-wrapper');
    wrapper?.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    wrapper?.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    wrapper?.addEventListener('mouseup', (e) => this.handleMouseUp(e));

    wrapper?.addEventListener('dragover', (e) => e.preventDefault());
    wrapper?.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) this.openFile(file);
    });

    const popoverLookup = this.container.querySelector('#manga-popover-lookup');
    popoverLookup?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-manga-mine-word');
      if (btn && btn.dataset.word) {
        this.mineWord(btn.dataset.word, btn.dataset.reading, btn.dataset.meaning, btn);
      }
    });
  }

  /* -------------------------------------------------------------------------
   * File Loading & IndexedDB Persistence
   * ------------------------------------------------------------------------- */
  async openFile(file) {
    if (!file) return;

    this.showLoading('Adding Manga to Library...', file.name);

    try {
      const bookId = 'book_' + Date.now();
      const title = file.name.replace(/\.[^/.]+$/, '');
      const extension = file.name.split('.').pop()?.toLowerCase();

      let type = 'image';
      if (extension === 'pdf') type = 'pdf';
      else if (extension === 'cbz' || extension === 'zip') type = 'cbz';

      this.updateLoadingStatus('Reading file bytes...', file.name);
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
      if (type === 'pdf') {
        await this.initPdfFromBuffer(newBook, arrayBuffer);
      } else if (type === 'cbz') {
        await this.initCbzFromBuffer(newBook, arrayBuffer);
      } else {
        newBook.pageCount = 1;
        newBook.currentPage = 1;
      }

      const existingIdx = this.books.findIndex(b => b.title === title);
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
      await this.generateCrispCover(newBook, true);

      this.saveLibrary();
      this.activeMode = 'reader';
      this.render();
    } catch (err) {
      console.error('[MangaView] Failed to open file:', err);
    } finally {
      this.hideLoading();
    }
  }

  async loadAndOpenBook(bookId) {
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
      this.currentPage = book.currentPage || 1;
      this.pageCount = book.pageCount || 1;
      this.activeMode = 'reader';
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
      this.saveLibrary();
    }
    this.clearBubbleOverlays();
    this.closePopover();

    const pageInput = this.container?.querySelector('#manga-page-input');
    if (pageInput) pageInput.value = this.currentPage;

    this.renderCurrentPage();
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
        this.currentImage = canvas;
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

        this.currentImage = canvas;
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
        this.currentImage = img;
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

        this.currentImage = canvas;
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

    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      this.nextPage();
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      this.prevPage();
    } else if (e.key === 'Escape') {
      this.closePopover();
      this.closeModal();
    }
  }

  /* -------------------------------------------------------------------------
   * Marquee Manual Box Selection
   * Relative strictly to the <div id="manga-canvas-wrapper">
   * ------------------------------------------------------------------------- */
  handleMouseDown(e) {
    if (!this.currentImage) return;
    const wrapper = this.container?.querySelector('#manga-canvas-wrapper');
    if (!wrapper) return;

    const wrapRect = wrapper.getBoundingClientRect();
    const x = e.clientX - wrapRect.left;
    const y = e.clientY - wrapRect.top;

    this.isSelecting = true;
    this.selectionStart = { x, y, clientX: e.clientX, clientY: e.clientY };
  }

  handleMouseMove(e) {
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
    if (!this.isSelecting || !this.selectionStart) return;
    this.isSelecting = false;

    const canvas = this.container?.querySelector('#manga-canvas');
    const wrapper = this.container?.querySelector('#manga-canvas-wrapper');
    const box = this.container?.querySelector('#manga-selection-box');
    if (box) box.style.display = 'none';
    if (!canvas || !wrapper) return;

    const wrapRect = wrapper.getBoundingClientRect();
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
    const canvas = this.container?.querySelector('#manga-canvas');
    if (!canvas) return;

    const width = Math.round(endX - startX);
    const height = Math.round(endY - startY);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = width;
    cropCanvas.height = height;
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(canvas, startX, startY, width, height, 0, 0, width, height);

    this.activeCropDataUrl = cropCanvas.toDataURL('image/png');
    const base64Data = this.activeCropDataUrl.split(',')[1];

    this.openPopover(anchor);

    const sentenceEl = this.container?.querySelector('#manga-popover-sentence');
    if (sentenceEl) {
      sentenceEl.innerHTML = `<span class="text-xs text-muted">Running MangaOCR...</span>`;
    }

    try {
      const res = await this.apiClient.request('/api/ocr/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Data })
      });

      if (res && res.text) {
        this.recognizedText = res.text.trim();
        if (sentenceEl) {
          sentenceEl.innerHTML = `<div class="manga-sentence-text">${escapeHtml(this.recognizedText)}</div>`;
        }
        await this.lookupDictionary(this.recognizedText);
      } else {
        if (sentenceEl) sentenceEl.innerHTML = `<span class="text-xs text-muted">No text detected</span>`;
      }
    } catch (err) {
      console.warn('[MangaView] OCR recognition failed:', err);
      if (sentenceEl) sentenceEl.innerHTML = `<span class="text-xs text-danger">OCR Error</span>`;
    }
  }

  /* -------------------------------------------------------------------------
   * Automatic Speech Bubble Detection (AI)
   * ------------------------------------------------------------------------- */
  async detectBubblesOnCurrentPage() {
    const canvas = this.container?.querySelector('#manga-canvas');
    const btn = this.container?.querySelector('#btn-detect-bubbles');
    const label = this.container?.querySelector('#label-detect-bubbles');
    if (!canvas || this.isAutoDetecting) return;

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
        this.renderBubbleOverlays();
      }
    } catch (err) {
      console.warn('[MangaView] Bubble detection failed:', err);
    } finally {
      this.isAutoDetecting = false;
      if (label) label.textContent = 'Detect Bubbles (AI)';
      if (btn) btn.disabled = false;
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

    this.detectedBubbles.forEach((bubble, idx) => {
      const [x1, y1, x2, y2] = bubble.box;
      const left = x1 * scaleX;
      const top = y1 * scaleY;
      const width = (x2 - x1) * scaleX;
      const height = (y2 - y1) * scaleY;

      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'manga-bubble-hitbox';
      bubbleEl.style.left = `${left}px`;
      bubbleEl.style.top = `${top}px`;
      bubbleEl.style.width = `${width}px`;
      bubbleEl.style.height = `${height}px`;
      bubbleEl.title = `Bubble ${idx + 1} (${Math.round(bubble.score * 100)}%) — Click to OCR`;

      bubbleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const anchor = {
          x: left + rect.left,
          y: top + height + rect.top + 8
        };
        this.performOcrBoxSelection(x1, y1, x2, y2, anchor);
      });

      overlayLayer.appendChild(bubbleEl);
    });
  }

  clearBubbleOverlays() {
    this.detectedBubbles = [];
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
    popover.style.display = 'block';

    const popWidth = 320;
    const popHeight = 240;
    let posX = Math.max(16, Math.min(window.innerWidth - popWidth - 16, anchor.x));
    let posY = Math.max(50, Math.min(window.innerHeight - popHeight - 60, anchor.y));

    popover.style.left = `${posX}px`;
    popover.style.top = `${posY}px`;
  }

  closePopover() {
    this.popoverVisible = false;
    const popover = this.container?.querySelector('#manga-floating-popover');
    if (popover) popover.style.display = 'none';
  }

  async lookupDictionary(text) {
    const lookupEl = this.container?.querySelector('#manga-popover-lookup');
    if (!lookupEl || !text) return;

    try {
      const res = await this.apiClient.request(`/api/dictionary/lookup?term=${encodeURIComponent(text)}`);
      if (res && Array.isArray(res.entries) && res.entries.length > 0) {
        lookupEl.innerHTML = res.entries.slice(0, 3).map((entry) => {
          const word = entry.expression || entry.kanji || text;
          const reading = entry.reading || '';
          const glossary = (entry.glossary || []).join('; ');

          return `
            <div class="manga-dict-entry mb-2">
              <div class="flex items-center justify-between">
                <span class="font-bold text-accent">${escapeHtml(word)}</span>
                <button type="button" 
                  class="tactile-btn tactile-btn-primary tactile-btn-sm btn-manga-mine-word" 
                  data-word="${escapeHtml(word)}" 
                  data-reading="${escapeHtml(reading)}" 
                  data-meaning="${escapeHtml(glossary)}">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                  <span>Mine</span>
                </button>
              </div>
              <div class="text-xs text-muted">${escapeHtml(reading)}</div>
              <div class="text-xs">${escapeHtml(glossary)}</div>
            </div>
          `;
        }).join('');
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
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg><span>Mined</span>`;
    }

    try {
      await this.apiClient.request('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expression: word,
          reading: reading,
          meaning: meaning,
          sentence: this.recognizedText,
          image_url: this.activeCropDataUrl || '',
          source: 'manga',
          source_title: this.currentBook?.title || 'Manga'
        })
      });
      this.lastMinedWord = word;
    } catch (err) {
      console.warn('[MangaView] Mine word failed:', err);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span>Retry</span>`;
      }
    }
  }
}
