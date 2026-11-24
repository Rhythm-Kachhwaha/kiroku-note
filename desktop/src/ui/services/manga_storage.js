/**
 * Kiroku Note — Manga OPFS & IndexedDB Storage
 * Stores Manga PDFs / ArrayBuffers in the Origin Private File System (OPFS)
 * for instant zero-copy streaming, with seamless IndexedDB fallback.
 */

const DB_NAME = 'kiroku_manga_store';
const STORE_DATA = 'books_data';
const STORE_INDEX = 'pdfIndex';
const STORE_ANNOTATIONS = 'page_annotations';
const STORE_TRANSFERS = 'kiroku_manga_transfers';
const STORE_TRANSFER_CHUNKS = 'manga_transfer_chunks';
const STORE_SYNC_OUTBOX = 'manga_sync_outbox';
const STORE_BOOK_COVERS = 'book_covers';
const DB_VERSION = 4;

const memoryStore = new Map();

export class StorageUnavailableError extends Error {
  constructor(message = 'Persistent storage is not available in this environment') {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export function isPersistentStorageAvailable() {
  if (typeof process !== 'undefined' && process.release?.name === 'node') {
    return true;
  }
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
        let k = key;
        if (!k) {
          if (storeName === STORE_TRANSFERS || storeName === STORE_BOOK_COVERS) {
            k = val?.bookId || val?.id;
          } else {
            k = val?.id || val?.key || val?.bookId;
          }
        }
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
      if (!db.objectStoreNames.contains(STORE_TRANSFERS)) {
        db.createObjectStore(STORE_TRANSFERS, { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains(STORE_TRANSFER_CHUNKS)) {
        db.createObjectStore(STORE_TRANSFER_CHUNKS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_SYNC_OUTBOX)) {
        db.createObjectStore(STORE_SYNC_OUTBOX, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BOOK_COVERS)) {
        db.createObjectStore(STORE_BOOK_COVERS, { keyPath: 'bookId' });
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
    const [allMeta, allTransfers] = await Promise.all([
      new Promise((resolve) => {
        const tx = db.transaction(STORE_INDEX, 'readonly');
        const store = tx.objectStore(STORE_INDEX);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      }),
      new Promise((resolve) => {
        const tx = db.transaction(STORE_TRANSFERS, 'readonly');
        const store = tx.objectStore(STORE_TRANSFERS);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      })
    ]);

    const validOpfsNames = new Set(
      allMeta.filter(m => m.storageType === 'opfs').map(m => m.fileName || getSafeFilename(m.bookId))
    );

    const now = Date.now();
    const activeTransferTempNames = new Set();
    for (const t of allTransfers) {
      if (t.status === 'in_progress' && (now - (t.updatedAt || 0) < 24 * 3600 * 1000)) {
        activeTransferTempNames.add(getOpfsTempFilename(t.bookId, t.generationId));
        activeTransferTempNames.add(getOpfsTempFilename(t.bookId));
      }
    }

    if (hasOpfs()) {
      try {
        const mangaDir = await getOpfsMangaDir();
        for await (const [name, handle] of mangaDir.entries()) {
          // Keep active transfer temporary files!
          if (activeTransferTempNames.has(name)) {
            continue;
          }
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

export async function getAllStoredBooksMetadata() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_INDEX, 'readonly');
      const store = tx.objectStore(STORE_INDEX);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (_) {
    return [];
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

// ---------------------------------------------------------------------------
// Resumable Transfer Ledger & Incremental Chunk Storage
// ---------------------------------------------------------------------------
export function getOpfsTempFilename(bookId, generationId = null) {
  const safeId = String(bookId).replace(/[^a-zA-Z0-9_-]/g, '_');
  if (generationId) {
    const safeGen = String(generationId).replace(/[^a-zA-Z0-9_-]/g, '_');
    return `temp_${safeId}_${safeGen}.part`;
  }
  return `temp_${safeId}.part`;
}

export async function saveTransferRecord(bookId, data) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_TRANSFERS, 'readwrite');
      const store = tx.objectStore(STORE_TRANSFERS);
      store.put({
        bookId,
        ...data,
        updatedAt: Date.now()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) {
    return false;
  }
}

export async function getTransferRecord(bookId) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_TRANSFERS, 'readonly');
      const req = tx.objectStore(STORE_TRANSFERS).get(bookId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (_) {
    return null;
  }
}

export async function deleteTransferRecord(bookId) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_TRANSFERS, 'readwrite');
      tx.objectStore(STORE_TRANSFERS).delete(bookId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) {
    return false;
  }
}

export async function getAllActiveTransfers() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_TRANSFERS, 'readonly');
      const req = tx.objectStore(STORE_TRANSFERS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (_) {
    return [];
  }
}

export async function storeTransferChunk(bookId, chunkIndex, uint8Data, generationId = null) {
  try {
    const db = await openDB();
    const key = generationId ? `${bookId}:${generationId}:${chunkIndex}` : `${bookId}:${chunkIndex}`;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_TRANSFER_CHUNKS, 'readwrite');
      tx.objectStore(STORE_TRANSFER_CHUNKS).put({
        key,
        bookId,
        generationId: generationId || null,
        chunkIndex,
        data: uint8Data,
        byteLength: uint8Data.byteLength,
        savedAt: Date.now()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) {
    return false;
  }
}

export async function getTransferChunk(bookId, chunkIndex, generationId = null) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_TRANSFER_CHUNKS, 'readonly');
      const store = tx.objectStore(STORE_TRANSFER_CHUNKS);
      if (generationId) {
        const key = `${bookId}:${generationId}:${chunkIndex}`;
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result?.data) return resolve(req.result.data);
          // Fallback check for legacy un-scoped key if generation matches
          const fallbackReq = store.get(`${bookId}:${chunkIndex}`);
          fallbackReq.onsuccess = () => {
            const r = fallbackReq.result;
            if (r && (!r.generationId || r.generationId === generationId)) {
              resolve(r.data || null);
            } else {
              resolve(null);
            }
          };
          fallbackReq.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      } else {
        const req = store.get(`${bookId}:${chunkIndex}`);
        req.onsuccess = () => resolve(req.result?.data || null);
        req.onerror = () => resolve(null);
      }
    });
  } catch (_) {
    return null;
  }
}

export async function deleteTransferChunks(bookId, generationId = null) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_TRANSFER_CHUNKS, 'readwrite');
      const store = tx.objectStore(STORE_TRANSFER_CHUNKS);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        for (const it of items) {
          if (it.bookId === bookId) {
            if (!generationId || it.generationId === generationId || !it.generationId) {
              store.delete(it.key);
            }
          }
        }
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) {
    return false;
  }
}

export async function writeOpfsTempChunk(bookId, chunkIndex, chunkSize, uint8Data, generationId = null) {
  if (!hasOpfs()) return false;
  try {
    const mangaDir = await getOpfsMangaDir();
    const tempName = getOpfsTempFilename(bookId, generationId);
    const fileHandle = await mangaDir.getFileHandle(tempName, { create: true });
    const writable = await fileHandle.createWritable({ keepExistingData: true });
    const offset = chunkIndex * chunkSize;
    await writable.seek(offset);
    await writable.write(uint8Data);
    await writable.close();
    return true;
  } catch (err) {
    console.warn('[MangaStorage] writeOpfsTempChunk error:', err);
    return false;
  }
}

export async function readOpfsTempFile(bookId, generationId = null) {
  if (!hasOpfs()) return null;
  try {
    const mangaDir = await getOpfsMangaDir();
    const tempName = getOpfsTempFilename(bookId, generationId);
    const fileHandle = await mangaDir.getFileHandle(tempName);
    return await fileHandle.getFile();
  } catch (_) {
    return null;
  }
}

export async function promoteOpfsTempFile(bookId, meta = {}, generationId = null) {
  if (!hasOpfs()) return false;
  const tempName = getOpfsTempFilename(bookId, generationId || meta.generationId);
  const safeName = getSafeFilename(bookId);
  try {
    const mangaDir = await getOpfsMangaDir();
    const tempHandle = await mangaDir.getFileHandle(tempName);
    const tempFile = await tempHandle.getFile();
    if (!tempFile || tempFile.size === 0) return false;

    // Stream write from temp file to final target file
    const targetHandle = await mangaDir.getFileHandle(safeName, { create: true });
    const writable = await targetHandle.createWritable();
    await writable.write(tempFile);
    await writable.close();

    // Remove temp file
    try { await mangaDir.removeEntry(tempName); } catch (_) {}

    // Update metadata index
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_INDEX, 'readwrite');
      tx.objectStore(STORE_INDEX).put({
        bookId,
        fileName: safeName,
        storageType: 'opfs',
        size: tempFile.size,
        updatedAt: Date.now(),
        ...meta
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });

    const verify = await verifyBookStorage(bookId);
    return verify.verified;
  } catch (err) {
    console.warn('[MangaStorage] promoteOpfsTempFile error:', err);
    return false;
  }
}

export async function cleanupTempFile(bookId, generationId = null) {
  if (hasOpfs()) {
    try {
      const mangaDir = await getOpfsMangaDir();
      const tempName = getOpfsTempFilename(bookId, generationId);
      await mangaDir.removeEntry(tempName);
    } catch (_) {}
  }
  await deleteTransferChunks(bookId, generationId);
}

// ---------------------------------------------------------------------------
// Thumbnail Blob Storage in IndexedDB
// ---------------------------------------------------------------------------
export async function storeBookCover(bookId, blobOrDataUrl) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_BOOK_COVERS, 'readwrite');
      const store = tx.objectStore(STORE_BOOK_COVERS);
      store.put({
        bookId,
        cover: blobOrDataUrl,
        updatedAt: Date.now()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('[MangaStorage] Failed to store cover:', err);
    return false;
  }
}

export async function getBookCover(bookId) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_BOOK_COVERS, 'readonly');
      const req = tx.objectStore(STORE_BOOK_COVERS).get(bookId);
      req.onsuccess = () => resolve(req.result?.cover || null);
      req.onerror = () => resolve(null);
    });
  } catch (_) {
    return null;
  }
}

export async function deleteBookCover(bookId) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_BOOK_COVERS, 'readwrite');
      tx.objectStore(STORE_BOOK_COVERS).delete(bookId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Offline Outbox Sync for Progress & Annotations
// ---------------------------------------------------------------------------
export async function enqueueSyncOutbox(item) {
  try {
    const db = await openDB();
    const id = item.id || `outbox_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SYNC_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_SYNC_OUTBOX);
      store.put({
        ...item,
        id,
        attempts: item.attempts || 0,
        status: 'pending',
        createdAt: item.createdAt || Date.now()
      });
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => resolve(null);
    });
  } catch (_) {
    return null;
  }
}

export async function peekSyncOutbox(limit = 50) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SYNC_OUTBOX, 'readonly');
      const req = tx.objectStore(STORE_SYNC_OUTBOX).getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        items.sort((a, b) => a.createdAt - b.createdAt);
        resolve(items.slice(0, limit));
      };
      req.onerror = () => resolve([]);
    });
  } catch (_) {
    return [];
  }
}

export async function removeSyncOutbox(id) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SYNC_OUTBOX, 'readwrite');
      tx.objectStore(STORE_SYNC_OUTBOX).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) {
    return false;
  }
}

export async function updateSyncOutboxItem(id, updates = {}) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SYNC_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_SYNC_OUTBOX);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (item) {
          store.put({ ...item, ...updates, updatedAt: Date.now() });
        }
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) {
    return false;
  }
}


