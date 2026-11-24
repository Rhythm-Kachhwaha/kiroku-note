/**
 * Kiroku Note — Resumable Manga Transfer Service
 * Bounded-memory, concurrent chunk transfers with exponential retry backoff,
 * durable resumption, transfer ledger, and cryptographic integrity verification.
 */

import { apiClient } from './api_client.js';
import {
  storeBookFile,
  verifyBookStorage,
  getBookFileBuffer,
  saveTransferRecord,
  getTransferRecord,
  deleteTransferRecord,
  storeTransferChunk,
  getTransferChunk,
  deleteTransferChunks,
  writeOpfsTempChunk,
  readOpfsTempFile,
  promoteOpfsTempFile,
  cleanupTempFile
} from './manga_storage.js';

export const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024; // 2 MiB chunks
export const MAX_CONCURRENT_CHUNKS = 3; // Bounded concurrency for mobile memory constraints
export const MAX_RETRY_ATTEMPTS = 3;

/**
 * Computes hexadecimal SHA-256 hash of a buffer or Uint8Array
 */
export async function computeSha256(bufferOrUint8) {
  if (!bufferOrUint8) return '';
  const bytes = bufferOrUint8 instanceof Uint8Array ? bufferOrUint8 : new Uint8Array(bufferOrUint8);
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  try {
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
  } catch (_) {}
  return '';
}

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
export function createUploadManifest({ bookId, totalBytes, chunkSize = DEFAULT_CHUNK_SIZE, totalChunks, hash = null, chunkHashes = [] }) {
  const computedTotalChunks = totalChunks || Math.ceil(totalBytes / chunkSize);
  return {
    bookId,
    generationId: `gen_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    totalBytes,
    chunkSize,
    totalChunks: computedTotalChunks,
    hash,
    chunkHashes,
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
 * Uploads manga chunks to the Cloud Worker with upload manifest, generation ID,
 * chunk SHA-256 verification, and final integrity validation.
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

  // 1. Calculate per-chunk hashes and full file hash for cryptographic integrity
  const chunkHashes = [];
  for (let idx = 0; idx < totalChunks; idx++) {
    const start = idx * chunkSize;
    const end = Math.min(start + chunkSize, totalBytes);
    const slice = arrayBuffer.slice(start, end);
    const cHash = await computeSha256(slice);
    chunkHashes.push(cHash);
  }
  const fileHash = await computeSha256(arrayBuffer);

  // 2. Initialize upload manifest on server with generation ID
  const manifest = createUploadManifest({
    bookId,
    totalBytes,
    chunkSize,
    totalChunks,
    hash: fileHash,
    chunkHashes
  });

  const initRes = await apiClient.request(`/api/user/manga/${encodeURIComponent(bookId)}/upload/init`, {
    method: 'POST',
    body: {
      generation_id: manifest.generationId,
      total_bytes: totalBytes,
      chunk_size: chunkSize,
      total_chunks: totalChunks,
      file_hash: fileHash,
      chunk_hashes: chunkHashes
    }
  });

  if (!initRes || !initRes.ok) {
    throw new Error(`Failed to initialize upload manifest for book ${bookId}: server rejected manifest`);
  }

  // 3. Query already uploaded chunks for this generation (resumption)
  let alreadyUploadedIndices = new Set();
  try {
    const statusRes = await apiClient.request(`/api/user/manga/${encodeURIComponent(bookId)}/chunks`);
    if (statusRes && statusRes.generation_id === manifest.generationId) {
      const available = statusRes.chunk_indices || statusRes.chunks || [];
      if (Array.isArray(available)) {
        alreadyUploadedIndices = new Set(available);
      }
    }
  } catch (_) {}

  let completedChunks = alreadyUploadedIndices.size;
  if (typeof onProgress === 'function') {
    onProgress({ current: completedChunks, total: totalChunks, percent: Math.round((completedChunks / totalChunks) * 100) });
  }

  // 4. Prepare upload tasks with generation ID and chunk cryptographic hashes
  const tasks = [];
  for (let idx = 0; idx < totalChunks; idx++) {
    if (alreadyUploadedIndices.has(idx)) continue;

    const chunkIndex = idx;
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, totalBytes);
    const chunkSlice = arrayBuffer.slice(start, end);
    const chunkHash = chunkHashes[chunkIndex];

    tasks.push(async () => {
      await retryOperation(async () => {
        const base64Data = bufferToBase64(chunkSlice);
        const res = await apiClient.request(
          `/api/user/manga/${encodeURIComponent(bookId)}/chunk`,
          {
            method: 'POST',
            body: {
              chunk_index: chunkIndex,
              total_chunks: totalChunks,
              chunk_data: base64Data,
              generation_id: manifest.generationId,
              chunk_hash: chunkHash
            }
          }
        );
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

  // 5. Commit and verify upload on server with full file hash validation
  const verifyRes = await apiClient.request(`/api/user/manga/${encodeURIComponent(bookId)}/upload/verify`, {
    method: 'POST',
    body: {
      generation_id: manifest.generationId,
      file_hash: fileHash
    }
  });

  if (!verifyRes || !verifyRes.ok || !verifyRes.verified) {
    throw new Error(`Upload verification failed for book ${bookId}: server could not cryptographically verify all chunks`);
  }

  return {
    success: true,
    bookId,
    generationId: manifest.generationId,
    totalBytes,
    totalChunks,
    fileHash,
    verified: true
  };
}

/**
 * Downloads manga chunks from Cloud Worker into local storage with durable
 * transfer ledger, incremental writing, and cryptographic integrity verification.
 */
export async function downloadMangaChunks(bookId, { onProgress = null, maxConcurrency = MAX_CONCURRENT_CHUNKS, signal = null } = {}) {
  // 1. Get chunk completeness and manifest metadata from cloud
  const metaRes = await apiClient.request(`/api/user/manga/${encodeURIComponent(bookId)}/chunks`);
  if (!metaRes || !metaRes.ok || !metaRes.total_chunks) {
    throw new Error(`Cannot download ${bookId}: no chunks available on server`);
  }

  const totalChunks = metaRes.total_chunks;
  const generationId = metaRes.generation_id || 'gen_legacy';
  const expectedFileHash = metaRes.file_hash || null;
  const chunkHashes = Array.isArray(metaRes.chunk_hashes) ? metaRes.chunk_hashes : [];
  const chunkSize = metaRes.chunk_size || DEFAULT_CHUNK_SIZE;

  // 2. Load or initialize durable transfer ledger in IndexedDB
  let transferRecord = await getTransferRecord(bookId);
  if (!transferRecord || transferRecord.generationId !== generationId) {
    if (transferRecord && transferRecord.generationId && transferRecord.generationId !== generationId) {
      // Generation changed: clean up previous generation's partial temp files and chunks
      await cleanupTempFile(bookId, transferRecord.generationId);
    }
    transferRecord = {
      bookId,
      generationId,
      totalChunks,
      chunkSize,
      fileHash: expectedFileHash,
      completedChunks: [],
      status: 'in_progress',
      createdAt: Date.now()
    };
    await saveTransferRecord(bookId, transferRecord);
  }

  // Validate previously completed chunks against expected chunk hashes
  const validCompletedSet = new Set();
  const previouslyCompleted = Array.isArray(transferRecord.completedChunks) ? transferRecord.completedChunks : [];
  for (const idx of previouslyCompleted) {
    const expectedHash = chunkHashes[idx];
    if (expectedHash) {
      const existingChunk = await getTransferChunk(bookId, idx, generationId);
      if (existingChunk) {
        const actualHash = await computeSha256(existingChunk);
        if (actualHash === expectedHash) {
          validCompletedSet.add(idx);
          continue;
        }
      }
      // Chunk corrupted or missing: do not trust resume ledger for this chunk
      continue;
    }
    // If no chunk hash provided in manifest, verify chunk presence
    const existingChunk = await getTransferChunk(bookId, idx, generationId);
    if (existingChunk) {
      validCompletedSet.add(idx);
    }
  }

  transferRecord.completedChunks = Array.from(validCompletedSet);
  await saveTransferRecord(bookId, transferRecord);

  let completed = validCompletedSet.size;

  if (typeof onProgress === 'function') {
    onProgress({ current: completed, total: totalChunks, percent: Math.round((completed / totalChunks) * 100) });
  }

  // 3. Download missing chunks with bounded concurrency and per-chunk verification
  const missingIndices = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!validCompletedSet.has(i)) {
      missingIndices.push(i);
    }
  }

  const tasks = missingIndices.map((idx) => async () => {
    if (signal?.aborted) {
      throw new Error('Download aborted by user');
    }

    const chunkDataRes = await retryOperation(async () => {
      const url = generationId && generationId !== 'gen_legacy'
        ? `/api/user/manga/${encodeURIComponent(bookId)}/chunk/${idx}?generation_id=${encodeURIComponent(generationId)}`
        : `/api/user/manga/${encodeURIComponent(bookId)}/chunk/${idx}`;
      const res = await apiClient.request(url);
      if (!res || !res.ok || !res.chunk_data) {
        throw new Error(`Failed to download chunk ${idx}`);
      }
      return res;
    });

    const uint8 = base64ToUint8Array(chunkDataRes.chunk_data);

    // Cryptographic validation of downloaded chunk if manifest provides chunk_hash
    const expectedChunkHash = chunkHashes[idx] || chunkDataRes.chunk_hash;
    if (expectedChunkHash) {
      const actualChunkHash = await computeSha256(uint8);
      if (actualChunkHash !== expectedChunkHash) {
        throw new Error(`Cryptographic hash mismatch for chunk ${idx}: expected ${expectedChunkHash}, got ${actualChunkHash}`);
      }
    }

    // Write chunk incrementally to OPFS temporary file or bounded IDB chunk store scoped by generation
    const opfsSuccess = await writeOpfsTempChunk(bookId, idx, chunkSize, uint8, generationId);
    // Always persist to generation-scoped IndexedDB store as resilient backup
    await storeTransferChunk(bookId, idx, uint8, generationId);

    // Update durable transfer ledger
    validCompletedSet.add(idx);
    completed++;
    await saveTransferRecord(bookId, {
      ...transferRecord,
      completedChunks: Array.from(validCompletedSet),
      status: completed >= totalChunks ? 'verifying' : 'in_progress'
    });

    if (typeof onProgress === 'function') {
      onProgress({ current: completed, total: totalChunks, percent: Math.round((completed / totalChunks) * 100) });
    }
  });

  await runWithBoundedConcurrency(tasks, maxConcurrency);

  // 4. Verification and atomic promotion to bookshelf storage
  const opfsTemp = await readOpfsTempFile(bookId, generationId);
  let totalLength = 0;

  if (opfsTemp && opfsTemp.size > 0) {
    totalLength = opfsTemp.size;

    // Verify whole file SHA-256 and byte length if expected
    const buf = await opfsTemp.arrayBuffer();
    if (expectedFileHash) {
      const actualHash = await computeSha256(buf);
      if (actualHash !== expectedFileHash) {
        await cleanupTempFile(bookId, generationId);
        await deleteTransferRecord(bookId);
        throw new Error(`File integrity verification failed: SHA-256 ${actualHash} did not match expected ${expectedFileHash}`);
      }
    }

    const promoted = await promoteOpfsTempFile(bookId, {
      generationId,
      fileHash: expectedFileHash,
      totalChunks
    }, generationId);

    if (!promoted) {
      await cleanupTempFile(bookId, generationId);
      throw new Error(`Failed to promote downloaded OPFS temp file for book ${bookId}`);
    }
  } else {
    // Reconstruct from bounded IDB chunk store
    const chunks = [];
    for (let i = 0; i < totalChunks; i++) {
      const c = await getTransferChunk(bookId, i, generationId);
      if (!c) {
        throw new Error(`Missing chunk ${i} in transfer store during reassembly`);
      }
      chunks.push(c);
      totalLength += c.byteLength;
    }

    const combinedBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (let i = 0; i < totalChunks; i++) {
      combinedBuffer.set(chunks[i], offset);
      offset += chunks[i].byteLength;
      chunks[i] = null; // Free reference
    }

    if (expectedFileHash) {
      const actualHash = await computeSha256(combinedBuffer);
      if (actualHash !== expectedFileHash) {
        await deleteTransferChunks(bookId, generationId);
        await deleteTransferRecord(bookId);
        throw new Error(`File integrity verification failed: SHA-256 ${actualHash} did not match expected ${expectedFileHash}`);
      }
    }

    const stored = await storeBookFile(bookId, combinedBuffer.buffer, {
      generationId,
      fileHash: expectedFileHash,
      totalChunks
    });

    await deleteTransferChunks(bookId, generationId);

    if (!stored) {
      await deleteTransferRecord(bookId);
      throw new Error(`Failed to store downloaded book ${bookId} into persistent storage`);
    }
  }

  // 5. Final storage verification & transfer ledger cleanup
  const verify = await verifyBookStorage(bookId);
  if (!verify || !verify.verified) {
    await deleteTransferRecord(bookId);
    throw new Error(`Verification failed after storing downloaded book ${bookId}`);
  }

  await deleteTransferRecord(bookId);

  return {
    success: true,
    bookId,
    generationId,
    totalBytes: totalLength,
    totalChunks,
    fileHash: expectedFileHash,
    verified: true
  };
}
