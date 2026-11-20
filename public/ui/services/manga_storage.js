/**
 * Kiroku Note — Manga OPFS & IndexedDB Storage
 * Stores Manga PDFs / ArrayBuffers in the Origin Private File System (OPFS)
 * for instant zero-copy streaming, with seamless IndexedDB fallback.
 */

const DB_NAME = 'kiroku_manga_store';
const STORE_DATA = 'books_data';
const STORE_INDEX = 'pdfIndex';
const STORE_ANNOTATIONS = 'page_annotations';
const DB_VERSION = 3;

const memoryStore = new Map();

function createMemoryTx() {
  const tx = {
    objectStore: (storeName) => ({
      put: (val, key) => {
        const k = key || val?.bookId || val?.key;
        memoryStore.set(`${storeName}:${k}`, val);
      },
      get: (key) => {
        const req = { result: memoryStore.get(`${storeName}:${key}`) || null };
        queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); });
        return req;
      },
      getAll: () => {
        const list = [];
        for (const [k, v] of memoryStore.entries()) {
          if (k.startsWith(`${storeName}:`)) list.push(v);
        }
        const req = { result: list };
        queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); });
        return req;
      },
      delete: (key) => {
        memoryStore.delete(`${storeName}:${key}`);
      }
    }),
    oncomplete: null,
    onerror: null
  };
  queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
  return tx;
}

function openDB() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve({
      transaction: () => createMemoryTx()
    });
  }
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
      if (!db.objectStoreNames.contains(STORE_ANNOTATIONS)) {
        db.createObjectStore(STORE_ANNOTATIONS, { keyPath: 'key' });
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

export async function storePageAnnotations(bookId, pageNum, strokes = []) {
  try {
    const db = await openDB();
    const key = `${bookId}_p${pageNum}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ANNOTATIONS, 'readwrite');
      const store = tx.objectStore(STORE_ANNOTATIONS);
      store.put({
        key,
        bookId,
        pageNum: Number(pageNum),
        strokes,
        updatedAt: Date.now()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[MangaStorage] Failed to store page annotations:', err);
    return false;
  }
}

export async function getPageAnnotations(bookId, pageNum) {
  try {
    const db = await openDB();
    const key = `${bookId}_p${pageNum}`;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_ANNOTATIONS, 'readonly');
      const store = tx.objectStore(STORE_ANNOTATIONS);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result?.strokes || []);
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    return [];
  }
}

export async function deletePageAnnotations(bookId, pageNum) {
  try {
    const db = await openDB();
    const key = `${bookId}_p${pageNum}`;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_ANNOTATIONS, 'readwrite');
      tx.objectStore(STORE_ANNOTATIONS).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (err) {
    return false;
  }
}

export async function getAllBookAnnotations(bookId) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_ANNOTATIONS, 'readonly');
      const store = tx.objectStore(STORE_ANNOTATIONS);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        const filtered = items.filter(it => it.bookId === bookId);
        resolve(filtered);
      };
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    return [];
  }
}

