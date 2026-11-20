# Contract: desktop-manga
Depends-on: desktop, db, cloud-auth, sync

## Purpose
Provides the Manga Bookshelf Library and Full-Screen Immersion Reader: client-side PDF/CBZ rendering with OPFS and IndexedDB persistence, LAN Wi-Fi PC-to-Mobile direct streaming, Cloud manga storage and per-user reading progress tracking, multi-engine OCR (MangaOCR & Comic Bubble Detector) with edge/cloud/desktop runtime and predictive multi-page caching, and in-viewer tactile canvas annotations (pencil, eraser, colors) synchronized per user in cloud.

## Boundaries
- View Component Lifecycle:
  - `mount(container)`: attaches to renderer root DOM, initializes library cards, folders, and event listeners.
  - `render()`: renders container shell with library bookshelf or immersion reader view.
  - `onShow()`: refreshes manga library and cloud sync status if visible.
  - `unmount()`: cleans up interval timers, prefetch timeouts, canvas contexts, and listeners.
- Storage & File Management:
  - `storeBookFile(bookId, buffer, meta)`: stores manga binary in OPFS with IndexedDB fallback.
  - `getBookFileBuffer(bookId)`: retrieves binary buffer from OPFS or IndexedDB.
  - `deleteBookFile(bookId)`: removes file from local client storage.
  - `storePageAnnotations(bookId, pageNum, strokes)` / `getPageAnnotations(bookId, pageNum)`: manages local page annotation records.
- Local LAN Streaming & Pairing:
  - `GET /api/manga/lan-info`: reports local Wi-Fi subnet IP and port.
  - `POST /api/manga/ticket`: issues 10-minute single-use transfer ticket for book.
  - `GET /api/manga/stream/{book_id}`: streams book binary with HTTP Range (206) support to LAN devices.
  - `POST /api/manga/upload`: uploads book binary from client OPFS to local backend storage for streaming.
  - `GET /api/manga/qr`: generates SVG QR code for mobile pairing.
- Cloud Manga Storage & Per-User Sync:
  - `POST /api/user/manga/upload`: uploads manga book file and metadata to user cloud store.
  - `GET /api/user/manga/list`: returns authenticated user's cloud manga list with progress.
  - `GET /api/user/manga/:bookId/file`: streams or downloads cloud manga file for PWA / web anywhere.
  - `DELETE /api/user/manga/:bookId`: deletes cloud book and associated user records.
  - `POST /api/user/progress/manga`: upserts per-user reading progress `(user_id, manga_id, chapter_number, page_number, completed, mined_card_count, last_read_at)`.
  - `GET /api/user/progress/manga/:mangaId` and `GET /api/user/progress/manga`: queries user manga reading progress.
  - `POST /api/user/manga/annotations`: saves canvas annotations per user, book, and page.
  - `GET /api/user/manga/annotations/:bookId`: queries book annotations for user.
  - `DELETE /api/user/manga/annotations/:bookId/:pageNum`: removes page annotations.
  - `POST /api/user/manga/library-state`: syncs user folder taxonomy and bookmarks map to cloud.
  - `GET /api/user/manga/library-state`: retrieves user folder taxonomy and bookmarks from cloud.
  - Bookshelf Background Sync: `#btn-manga-sync-all` deduplicates existing books via cloud list check and executes task queue in background without blocking screen or showing loading overlays.
  - Resumable Sync Ledger: `kiroku.manga.sync_queue` persists queue state in `localStorage` to survive application close and resume seamlessly on next launch.
- Multi-Engine OCR & Bubble Detection:
  - `POST /api/ocr/recognize`: runs MangaOCR on cropped bubble region (on-device worker -> desktop server -> cloud worker).
  - `POST /api/ocr/detect`: runs comic bubble detection (on-device detector -> desktop server -> cloud worker).
  - Predictive Caching: `ocrTextCache` and `bubbleCache` store results with prefetch for page N+1 and page N-1 for instant page turn.
- In-Viewer Annotations:
  - Canvas layer `#manga-annotation-canvas` overlaid on `#manga-canvas`.
  - Active tools: `move` (pan), `select` (OCR box), `draw` (pencil with color palette: gold, cyan, crimson), `eraser`.
  - Touch and mouse stroke rendering with clear and cloud sync capabilities.
- PWA & Mobile Compatibility:
  - Responsive design, touch gestures (touch draw, touch pan, swipe navigation).
  - Compatible with Web platform shim `webAPI` and desktop Electron `desktopAPI`.

## State and storage
- Local client storage:
  - `kiroku.manga.library`: JSON array of book metadata objects.
  - `kiroku.manga.folders`: custom user folder taxonomy.
  - `kiroku.manga.spread_mode`: 'single' | 'double' | 'auto'.
  - `kiroku_manga_store`: IndexedDB database with `books_data`, `pdfIndex`, and `page_annotations` stores.
  - OPFS directory `manga_storage`: zero-copy file storage.
- Cloud edge state (Turso libSQL / Neon):
  - `user_manga_books`: `(user_id, book_id, title, filename, file_type, size, total_pages, uploaded_at, file_data)`.
  - `user_manga_progress`: `(user_id, manga_id, chapter_number, page_number, completed, mined_card_count, last_read_at)`.
  - `user_manga_annotations`: `(user_id, book_id, page_number, data_json, updated_at)`.
  - `user_manga_library_state`: `(user_id, folders_json, bookmarks_json, updated_at)`.
- In-memory state:
  - `bubbleCache`: Map of cached bubble detection results keyed by `${bookId}_p${pageNum}_${spreadMode}`.
  - `ocrTextCache`: Map of cached OCR text strings keyed by image content hash.
  - `pageAnnotations`: Map of active page annotation stroke arrays.
  - `currentBook`, `pdfDoc`, `cbzImageEntries`, `currentPage`, `zoomScale`, `activeTool`.

## Dependencies
- Node.js, Electron runtime, Chromium browser, Service Worker for PWA.
- PDF.js (`pdf.min.js`, `pdf.worker.min.js`) & JSZip (`jszip.min.js`).
- Local FastAPI backend (`manga_stream.py`) & Cloudflare Worker (`worker/index.js`, `worker/turso.js`).

## Invariants
1. Offline first: The manga library and reader function completely offline using local OPFS/IndexedDB storage.
2. User isolation: Cloud manga books, reading progress, and page annotations are strictly scoped to the authenticated `user_id`.
3. Design tokens: Strict adherence to `tokens.css`; zero raw hex colors outside allowed tokens; tactile buttons with offset shadows.
4. No emoji: Strict plain text and SVG icons; zero emoji characters in UI, copy, logs, or tools.
5. Cache speed: Switching to an already-visited or pre-fetched page displays bubbles and OCR immediately in 0ms without re-triggering inference.
6. Seamless sync: "Send to Phone" automatically ensures the book binary is available on the local backend before generating the transfer ticket and QR code.

## Failure behavior
- Backend offline during LAN send: Notifies user with tactile alert and copies direct file transfer instructions.
- Cloud sync offline: Persists progress and annotations in local IndexedDB; syncs automatically once reconnected.
- OCR worker unavailable: Safely falls back to backend OCR server or returns graceful "No text detected" without UI crash.
- Missing OPFS: Transparently falls back to IndexedDB ArrayBuffer storage.

## Out of scope
- Desktop audio playback synchronization (handled in study tab).
- DRM protected proprietary ebook formats (EPUB/MOBI) — focus is on standard PDF and CBZ.
