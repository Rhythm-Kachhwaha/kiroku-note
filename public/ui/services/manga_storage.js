/**
 * Kiroku Note — Manga OPFS & IndexedDB Storage
 * Stores Manga PDFs / ArrayBuffers in the Origin Private File System (OPFS)
 * for instant zero-copy streaming, with seamless IndexedDB fallback.
 */

const DB_NAME = 'kiroku_manga_store';
const STORE_DATA = 'books_data';
const STORE_INDEX = 'pdfIndex';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DATA)) {
        db.createObjectStore(STORE_DATA);
      }
      if (!db.objectStoreNames.contains(STORE_INDEX)) {
        db.createObjectStore(STORE_INDEX, { keyPath: 'bookId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function hasOpfs() {
  return typeof navigator !== 'undefined' &&
    Boolean(navigator.storage) &&
    typeof navigator.storage.getDirectory === 'function';
}

async function getOpfsMangaDir() {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle('manga_storage', { create: true });
}

function getSafeFilename(bookId) {
  return `book_${String(bookId).replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`;
}

export async function storeBookFile(bookId, fileOrBuffer, meta = {}) {
  try {
    let size = 0;
    if (fileOrBuffer instanceof ArrayBuffer) {
      size = fileOrBuffer.byteLength;
    } else if (fileOrBuffer && typeof fileOrBuffer.size === 'number') {
      size = fileOrBuffer.size;
    }

    // Try OPFS first
    if (hasOpfs()) {
      try {
        const mangaDir = await getOpfsMangaDir();
        const safeName = getSafeFilename(bookId);
        const fileHandle = await mangaDir.getFileHandle(safeName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(fileOrBuffer);
        await writable.close();

        // Update pdfIndex in IndexedDB
        const db = await openDB();
        await new Promise((resolve) => {
          const tx = db.transaction(STORE_INDEX, 'readwrite');
          const store = tx.objectStore(STORE_INDEX);
          store.put({
            bookId,
            fileName: safeName,
            storageType: 'opfs',
            size,
            updatedAt: Date.now(),
            ...meta
          });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });

        return true;
      } catch (opfsErr) {
        console.warn('[MangaStorage] OPFS write failed, falling back to IndexedDB:', opfsErr);
      }
    }

    // Fallback to IndexedDB
    let buffer;
    if (fileOrBuffer instanceof ArrayBuffer) {
      buffer = fileOrBuffer;
    } else if (fileOrBuffer && typeof fileOrBuffer.arrayBuffer === 'function') {
      buffer = await fileOrBuffer.arrayBuffer();
    } else {
      buffer = fileOrBuffer;
    }

    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_DATA, STORE_INDEX], 'readwrite');
      const dataStore = tx.objectStore(STORE_DATA);
      const indexStore = tx.objectStore(STORE_INDEX);

      dataStore.put(buffer, bookId);
      indexStore.put({
        bookId,
        storageType: 'idb',
        size: buffer ? (buffer.byteLength || 0) : 0,
        updatedAt: Date.now(),
        ...meta
      });

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[MangaStorage] Failed to store book data:', err);
    return false;
  }
}

export async function getBookFileBuffer(bookId) {
  try {
    // Try OPFS first
    if (hasOpfs()) {
      try {
        const mangaDir = await getOpfsMangaDir();
        const safeName = getSafeFilename(bookId);
        const fileHandle = await mangaDir.getFileHandle(safeName);
        const file = await fileHandle.getFile();
        return await file.arrayBuffer();
      } catch (opfsErr) {
        // File may be in IndexedDB fallback or does not exist
      }
    }

    // Fallback to IndexedDB
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DATA, 'readonly');
      const store = tx.objectStore(STORE_DATA);
      const req = store.get(bookId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[MangaStorage] Failed to get book data:', err);
    return null;
  }
}

export async function getBookFile(bookId) {
  try {
    if (hasOpfs()) {
      try {
        const mangaDir = await getOpfsMangaDir();
        const safeName = getSafeFilename(bookId);
        const fileHandle = await mangaDir.getFileHandle(safeName);
        return await fileHandle.getFile();
      } catch (opfsErr) {
        // Fallback
      }
    }

    const buf = await getBookFileBuffer(bookId);
    if (buf) {
      return new Blob([buf]);
    }
    return null;
  } catch (err) {
    console.warn('[MangaStorage] Failed to get book file:', err);
    return null;
  }
}

export async function deleteBookFile(bookId) {
  try {
    if (hasOpfs()) {
      try {
        const mangaDir = await getOpfsMangaDir();
        const safeName = getSafeFilename(bookId);
        await mangaDir.removeEntry(safeName);
      } catch (opfsErr) {
        // File might not exist in OPFS
      }
    }

    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_DATA, STORE_INDEX], 'readwrite');
      tx.objectStore(STORE_DATA).delete(bookId);
      tx.objectStore(STORE_INDEX).delete(bookId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[MangaStorage] Failed to delete book data:', err);
    return false;
  }
}

export async function getBookMetadata(bookId) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_INDEX, 'readonly');
      const req = tx.objectStore(STORE_INDEX).get(bookId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}
