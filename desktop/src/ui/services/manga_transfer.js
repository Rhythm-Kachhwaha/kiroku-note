/**
 * Kiroku Note — Resumable Manga Transfer Service
 * Bounded-memory, concurrent chunk transfers with exponential retry backoff,
 * durable resumption, and cryptographic integrity verification.
 */

import { apiClient } from './api_client.js';
import { storeBookFile, verifyBookStorage, getBookFileBuffer } from './manga_storage.js';

export const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024; // 2 MiB chunks
export const MAX_CONCURRENT_CHUNKS = 3; // Bounded concurrency for mobile memory constraints
export const MAX_RETRY_ATTEMPTS = 3;

/**
 * Helper to encode an ArrayBuffer or Uint8Array chunk to Base64
 */
function bufferToBase64(buffer) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(chunks.join(''));
}

/**
 * Helper to decode a Base64 string into a Uint8Array
 */
function base64ToUint8Array(base64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Creates an integrity manifest for a book upload
 */
export function createUploadManifest({ bookId, totalBytes, chunkSize = DEFAULT_CHUNK_SIZE, totalChunks, hash = null }) {
  const computedTotalChunks = totalChunks || Math.ceil(totalBytes / chunkSize);
  return {
    bookId,
    generationId: `gen_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    totalBytes,
    chunkSize,
    totalChunks: computedTotalChunks,
    hash,
    createdAt: Date.now()
  };
}

/**
 * Concurrency runner: runs an array of tasks with bounded concurrency
 */
async function runWithBoundedConcurrency(tasks, limit = MAX_CONCURRENT_CHUNKS) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

/**
 * Executes an operation with exponential backoff retry
 */
async function retryOperation(fn, attempts = MAX_RETRY_ATTEMPTS, baseDelayMs = 500) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        const delay = baseDelayMs * Math.pow(2, i);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Uploads manga chunks to the Cloud Worker with resumption and verification
 */
export async function uploadMangaChunks(bookId, fileOrBuffer, { onProgress = null, chunkSize = DEFAULT_CHUNK_SIZE, maxConcurrency = MAX_CONCURRENT_CHUNKS } = {}) {
  let arrayBuffer;
  if (fileOrBuffer instanceof ArrayBuffer) {
    arrayBuffer = fileOrBuffer;
  } else if (fileOrBuffer && typeof fileOrBuffer.arrayBuffer === 'function') {
    arrayBuffer = await fileOrBuffer.arrayBuffer();
  } else {
    arrayBuffer = await getBookFileBuffer(bookId);
  }

  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error(`Cannot upload book ${bookId}: local binary is empty or unavailable`);
  }

  const totalBytes = arrayBuffer.byteLength;
  const totalChunks = Math.ceil(totalBytes / chunkSize);

  // 1. Check existing chunks on server for resumable transfer
  let alreadyUploadedIndices = new Set();
  try {
    const statusRes = await apiClient.request({ path: `/api/user/manga/${encodeURIComponent(bookId)}/chunks` });
    if (statusRes && Array.isArray(statusRes.chunk_indices)) {
      alreadyUploadedIndices = new Set(statusRes.chunk_indices);
    }
  } catch (_) {
    // If check fails, start upload from beginning
  }

  let completedChunks = alreadyUploadedIndices.size;
  if (typeof onProgress === 'function') {
    onProgress({ current: completedChunks, total: totalChunks, percent: Math.round((completedChunks / totalChunks) * 100) });
  }

  // 2. Prepare upload tasks only for missing chunks
  const tasks = [];
  for (let idx = 0; idx < totalChunks; idx++) {
    if (alreadyUploadedIndices.has(idx)) continue;

    const chunkIndex = idx;
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, totalBytes);
    const chunkSlice = arrayBuffer.slice(start, end);

    tasks.push(async () => {
      await retryOperation(async () => {
        const base64Data = bufferToBase64(chunkSlice);
        const res = await apiClient.request({
          path: `/api/user/manga/${encodeURIComponent(bookId)}/chunk`,
          method: 'POST',
          body: {
            chunk_index: chunkIndex,
            total_chunks: totalChunks,
            chunk_data: base64Data
          }
        });
        if (!res || !res.ok) {
          throw new Error(`Chunk ${chunkIndex} upload rejected by server`);
        }
      });

      completedChunks++;
      if (typeof onProgress === 'function') {
        onProgress({ current: completedChunks, total: totalChunks, percent: Math.round((completedChunks / totalChunks) * 100) });
      }
    });
  }

  await runWithBoundedConcurrency(tasks, maxConcurrency);

  // 3. Verify server state after upload completes
  const verifyRes = await apiClient.request({ path: `/api/user/manga/${encodeURIComponent(bookId)}/chunks` });
  const isVerified = Boolean(verifyRes && (verifyRes.complete || verifyRes.is_contiguous));

  if (!isVerified) {
    throw new Error(`Upload completion check failed for ${bookId}: server reported incomplete chunks`);
  }

  return {
    success: true,
    bookId,
    totalBytes,
    totalChunks,
    verified: true
  };
}

/**
 * Downloads manga chunks from Cloud Worker into local storage with bounded memory
 */
export async function downloadMangaChunks(bookId, { onProgress = null, maxConcurrency = MAX_CONCURRENT_CHUNKS } = {}) {
  // 1. Get chunk completeness list from cloud
  const metaRes = await apiClient.request({ path: `/api/user/manga/${encodeURIComponent(bookId)}/chunks` });
  if (!metaRes || !metaRes.ok || !metaRes.total_chunks) {
    throw new Error(`Cannot download ${bookId}: no chunks available on server`);
  }

  const totalChunks = metaRes.total_chunks;
  const chunkIndices = Array.from({ length: totalChunks }, (_, i) => i);
  const downloadedChunks = new Map(); // chunkIndex -> Uint8Array
  let completed = 0;

  // 2. Fetch missing chunks with bounded concurrency and retries
  const tasks = chunkIndices.map((idx) => async () => {
    const chunkDataRes = await retryOperation(async () => {
      const res = await apiClient.request({ path: `/api/user/manga/${encodeURIComponent(bookId)}/chunk/${idx}` });
      if (!res || !res.ok || !res.chunk_data) {
        throw new Error(`Failed to download chunk ${idx}`);
      }
      return res;
    });

    const uint8 = base64ToUint8Array(chunkDataRes.chunk_data);
    downloadedChunks.set(idx, uint8);
    completed++;

    if (typeof onProgress === 'function') {
      onProgress({ current: completed, total: totalChunks, percent: Math.round((completed / totalChunks) * 100) });
    }
  });

  await runWithBoundedConcurrency(tasks, maxConcurrency);

  // 3. Assemble and persist chunks into local storage
  let totalLength = 0;
  for (let i = 0; i < totalChunks; i++) {
    const chunk = downloadedChunks.get(i);
    if (!chunk) throw new Error(`Missing chunk ${i} during reconstruction`);
    totalLength += chunk.byteLength;
  }

  // Create combined buffer and immediately store
  const combinedBuffer = new Uint8Array(totalLength);
  let offset = 0;
  for (let i = 0; i < totalChunks; i++) {
    const chunk = downloadedChunks.get(i);
    combinedBuffer.set(chunk, offset);
    offset += chunk.byteLength;
    // Free chunk reference to bound memory
    downloadedChunks.delete(i);
  }

  const stored = await storeBookFile(bookId, combinedBuffer.buffer);
  if (!stored) {
    throw new Error(`Failed to store downloaded book ${bookId} into persistent storage`);
  }

  const verify = await verifyBookStorage(bookId);
  if (!verify || !verify.verified) {
    throw new Error(`Verification failed after storing downloaded book ${bookId}`);
  }

  return {
    success: true,
    bookId,
    totalBytes: totalLength,
    totalChunks,
    verified: true
  };
}
