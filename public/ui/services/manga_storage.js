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

export class StorageUnavailableError extends Error {
  constructor(message = 'Persistent storage is not available in this environment') {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export function isPersistentStorageAvailable() {
  return typeof indexedDB !== 'undefined';
}

export async function getStorageEstimate() {
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const est = await navigator.storage.estimate();
      const usage = est.usage || 0;
      const quota = est.quota || 0;
      const percent = quota > 0 ? (usage / quota) * 100 : 0;
      return { usage, quota, percent, supported: true };
    } catch (_) {
      // Fallback below
    }
  }
  return { usage: 0, quota: 0, percent: 0, supported: false };
}

export async function requestPersistentStorage() {
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
    try {
      return await navigator.storage.persist();
    } catch (_) {
      return false;
    }
  }
  return false;
}

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

function openDB({ requirePersistence = false } = {}) {
  if (typeof indexedDB === 'undefined') {
    if (requirePersistence) {
      return Promise.reject(new StorageUnavailableError());
    }
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
    typeof navigator.storage.getDirectory === 'function' &&
    (typeof window === 'undefined' || (
      typeof window.FileSystemFileHandle !== 'undefined' &&
      typeof window.FileSystemFileHandle.prototype?.createWritable === 'function'
    ));
}

async function getOpfsMangaDir() {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle('manga_storage', { create: true });
}

function getSafeFilename(bookId) {
  return `book_${String(bookId).replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`;
}

export async function verifyBookStorage(bookId) {
  try {
    const meta = await getBookMetadata(bookId);
    if (!meta) {
      // Check if raw data exists without index
      if (hasOpfs()) {
        try {
          const mangaDir = await getOpfsMangaDir();
          const safeName = getSafeFilename(bookId);
          const fileHandle = await mangaDir.getFileHandle(safeName);
          const file = await fileHandle.getFile();
          if (file && file.size > 0) {
            return { verified: true, storageType: 'opfs', size: file.size, indexed: false };
          }
        } catch (_) {}
      }
      return { verified: false, storageType: 'none', size: 0, indexed: false };
    }

    if (meta.storageType === 'opfs') {
      if (!hasOpfs()) return { verified: false, storageType: 'opfs', size: meta.size || 0, indexed: true };
      const mangaDir = await getOpfsMangaDir();
      const safeName = meta.fileName || getSafeFilename(bookId);
      const fileHandle = await mangaDir.getFileHandle(safeName);
      const file = await fileHandle.getFile();
      const valid = Boolean(file && file.size > 0);
      return { verified: valid, storageType: 'opfs', size: file?.size || 0, indexed: true };
    }

    // IndexedDB storage
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_DATA, 'readonly');
      const store = tx.objectStore(STORE_DATA);
      const req = store.get(bookId);
      req.onsuccess = () => {
        const res = req.result;
        let size = 0;
        if (res instanceof ArrayBuffer) size = res.byteLength;
        else if (res && typeof res.size === 'number') size = res.size;
        else if (res && res.byteLength) size = res.byteLength;
        const valid = Boolean(res && size > 0);
        resolve({ verified: valid, storageType: 'idb', size, indexed: true });
      };
      req.onerror = () => resolve({ verified: false, storageType: 'idb', size: 0, indexed: true });
    });
  } catch (err) {
    return { verified: false, storageType: 'none', size: 0, indexed: false, error: String(err) };
  }
}

export async function getBookStorageStatus(bookId) {
  const result = await verifyBookStorage(bookId);
  return {
    exists: result.verified,
    storageType: result.storageType,
    size: result.size,
    verified: result.verified,
    indexed: result.indexed
  };
}

export async function cleanupIncompleteWrites() {
  const cleaned = [];
  try {
    const db = await openDB();
    const allMeta = await new Promise((resolve) => {
      const tx = db.transaction(STORE_INDEX, 'readonly');
      const store = tx.objectStore(STORE_INDEX);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    const validOpfsNames = new Set(
      allMeta.filter(m => m.storageType === 'opfs').map(m => m.fileName || getSafeFilename(m.bookId))
    );

    if (hasOpfs()) {
      try {
        const mangaDir = await getOpfsMangaDir();
        for await (const [name, handle] of mangaDir.entries()) {
          if (!validOpfsNames.has(name)) {
            await mangaDir.removeEntry(name);
            cleaned.push(`opfs:${name}`);
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[MangaStorage] Cleanup incomplete writes error:', err);
  }
  return cleaned;
}

export async function storeBookFile(bookId, fileOrBuffer, meta = {}) {
  try {
    if (!isPersistentStorageAvailable() && !hasOpfs()) {
      console.error('[MangaStorage] StorageUnavailableError: Neither OPFS nor IndexedDB is available.');
      return false;
    }

    let size = 0;
    if (fileOrBuffer instanceof ArrayBuffer) {
      size = fileOrBuffer.byteLength;
    } else if (fileOrBuffer && typeof fileOrBuffer.size === 'number') {
      size = fileOrBuffer.size;
    }

    // Try OPFS first
    if (hasOpfs()) {
      const safeName = getSafeFilename(bookId);
      try {
        const mangaDir = await getOpfsMangaDir();
        const fileHandle = await mangaDir.getFileHandle(safeName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(fileOrBuffer);
        await writable.close();

        // Update pdfIndex in IndexedDB
        const db = await openDB();
        const indexSaved = await new Promise((resolve) => {
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

        if (!indexSaved) {
          // Transactional rollback: remove orphaned OPFS file
          try { await mangaDir.removeEntry(safeName); } catch (_) {}
          throw new Error('Failed to update storage metadata index for OPFS write');
        }

        const verify = await verifyBookStorage(bookId);
        if (!verify.verified) {
          try { await mangaDir.removeEntry(safeName); } catch (_) {}
          throw new Error('Storage verification failed after OPFS write');
        }

        return true;
      } catch (opfsErr) {
        console.warn('[MangaStorage] OPFS write failed, falling back to IndexedDB:', opfsErr);
        try {
          const mangaDir = await getOpfsMangaDir();
          await mangaDir.removeEntry(safeName);
        } catch (_) {}
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
    const stored = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_DATA, STORE_INDEX], 'readwrite');
      const dataStore = tx.objectStore(STORE_DATA);
      const indexStore = tx.objectStore(STORE_INDEX);

      dataStore.put(buffer, bookId);
      indexStore.put({
        bookId,
        storageType: 'idb',
        size: buffer ? (buffer.byteLength || (buffer.size || 0)) : 0,
        updatedAt: Date.now(),
        ...meta
      });

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });

    if (!stored) {
      console.warn('[MangaStorage] IndexedDB storage transaction failed');
      return false;
    }

    const verify = await verifyBookStorage(bookId);
    return verify.verified;
  } catch (err) {
    console.warn('[MangaStorage] Failed to store book data:', err);
    return false;
  }
}

export async function getBookFileBuffer(bookId) {
  try {
    // Try OPFS first
    if (hasOpfs()) {
      const safeName = getSafeFilename(bookId);
      try {
        const mangaDir = await getOpfsMangaDir();
        const fileHandle = await mangaDir.getFileHandle(safeName);
        const file = await fileHandle.getFile();
        if (file && file.size > 0) {
          return await file.arrayBuffer();
        }
        // Zero-byte or incomplete stub: purge and fall through to IndexedDB
        try { await mangaDir.removeEntry(safeName); } catch (_) {}
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
        const file = await fileHandle.getFile();
        if (file && file.size > 0) return file;
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

export async function getAllStoredAnnotations() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_ANNOTATIONS, 'readonly');
      const store = tx.objectStore(STORE_ANNOTATIONS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    return [];
  }
}


