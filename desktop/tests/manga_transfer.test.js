const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const transferJsPath = path.join(__dirname, '..', 'src', 'ui', 'services', 'manga_transfer.js');

test('manga_transfer: exports resumable upload, download, and manifest verification APIs', () => {
  const content = fs.readFileSync(transferJsPath, 'utf8');
  assert.ok(content.includes('export async function uploadMangaChunks'), 'must export uploadMangaChunks');
  assert.ok(content.includes('export async function downloadMangaChunks'), 'must export downloadMangaChunks');
  assert.ok(content.includes('export function createUploadManifest'), 'must export createUploadManifest');
  assert.ok(content.includes('MAX_CONCURRENT_CHUNKS'), 'must define bounded concurrency');
  assert.ok(content.includes('saveTransferRecord'), 'must use durable transfer ledger');
  assert.ok(content.includes('verifyBookStorage'), 'must verify storage upon download completion');
});

test('manga_transfer: upload manifest creates unique generation ID and SHA-256 chunk hashes', async () => {
  const { createUploadManifest, computeSha256 } = await import('../src/ui/services/manga_transfer.js');
  const buffer = Buffer.from('KirokuMangaSampleContentForTesting123');
  const hash = await computeSha256(buffer);
  assert.ok(hash && hash.length === 64, 'SHA-256 hash must be 64-char hex');

  const manifest = createUploadManifest({
    bookId: 'test_book_manifest',
    totalBytes: buffer.length,
    chunkSize: 10,
    totalChunks: 4,
    hash,
    chunkHashes: ['hash0', 'hash1', 'hash2', 'hash3']
  });

  assert.ok(manifest.generationId.startsWith('gen_'), 'Must generate generationId with prefix');
  assert.equal(manifest.totalChunks, 4);
  assert.equal(manifest.hash, hash);
  assert.equal(manifest.chunkHashes.length, 4);
});

test('manga_transfer: download handles interrupted transfer resume via ledger', async () => {
  const { downloadMangaChunks } = await import('../src/ui/services/manga_transfer.js');
  const { saveTransferRecord, getTransferRecord, storeTransferChunk } = await import('../src/ui/services/manga_storage.js');
  const { apiClient } = await import('../src/ui/services/api_client.js');

  const bookId = 'test_book_resume';
  const generationId = 'gen_resume_123';
  const chunk0 = Buffer.from('ChunkZeroData_').toString('base64');
  const chunk1 = Buffer.from('ChunkOneData__').toString('base64');

  // Pre-seed transfer ledger and stored chunk as if Chunk 0 was already downloaded before reload
  await storeTransferChunk(bookId, 0, new Uint8Array(Buffer.from(chunk0, 'base64')));
  await saveTransferRecord(bookId, {
    bookId,
    generationId,
    totalChunks: 2,
    chunkSize: 14,
    completedChunks: [0],
    status: 'in_progress'
  });

  const downloadedChunkRequests = [];
  const originalRequest = apiClient.request.bind(apiClient);

  apiClient.request = async (endpoint, options = {}) => {
    const ep = typeof endpoint === 'object' ? endpoint.path : endpoint;
    if (ep.includes('/chunks')) {
      return {
        ok: true,
        book_id: bookId,
        total_chunks: 2,
        generation_id: generationId,
        chunk_hashes: []
      };
    }
    if (ep.includes('/chunk/')) {
      const match = ep.match(/\/chunk\/(\d+)/);
      const idx = Number(match[1]);
      downloadedChunkRequests.push(idx);
      return {
        ok: true,
        book_id: bookId,
        chunk_index: idx,
        chunk_data: idx === 0 ? chunk0 : chunk1
      };
    }
    return originalRequest(endpoint, options);
  };

  try {
    const res = await downloadMangaChunks(bookId);
    assert.equal(res.success, true);
    assert.equal(res.verified, true);
    // Chunk 0 was already in ledger, so only chunk 1 should be fetched!
    assert.deepEqual(downloadedChunkRequests, [1], 'Resumed download must only fetch missing chunks');

    // Transfer ledger should be cleaned up on completion
    const ledger = await getTransferRecord(bookId);
    assert.equal(ledger, null, 'Ledger must be cleared on successful completion');
  } finally {
    apiClient.request = originalRequest;
  }
});

test('manga_transfer: download rejects checksum mismatch and aborts promotion', async () => {
  const { downloadMangaChunks } = await import('../src/ui/services/manga_transfer.js');
  const { apiClient } = await import('../src/ui/services/api_client.js');

  const bookId = 'test_book_corrupt';
  const originalRequest = apiClient.request.bind(apiClient);

  apiClient.request = async (endpoint) => {
    const ep = typeof endpoint === 'object' ? endpoint.path : endpoint;
    if (ep.includes('/chunks')) {
      return {
        ok: true,
        book_id: bookId,
        total_chunks: 1,
        generation_id: 'gen_corrupt',
        file_hash: 'expected_correct_hash_that_wont_match_payload_data_000000000000',
        chunk_hashes: []
      };
    }
    if (ep.includes('/chunk/0')) {
      return {
        ok: true,
        book_id: bookId,
        chunk_index: 0,
        chunk_data: Buffer.from('CorruptedBytes').toString('base64')
      };
    }
  };

  try {
    await assert.rejects(
      async () => { await downloadMangaChunks(bookId); },
      /verification failed/i,
      'Must reject download if checksum fails'
    );
  } finally {
    apiClient.request = originalRequest;
  }
});

test('manga_transfer: generation change discards stale temp chunks and invalidates resume ledger', async () => {
  const { downloadMangaChunks } = await import('../src/ui/services/manga_transfer.js');
  const { saveTransferRecord, getTransferRecord, storeTransferChunk, getTransferChunk } = await import('../src/ui/services/manga_storage.js');
  const { apiClient } = await import('../src/ui/services/api_client.js');

  const bookId = 'test_book_gen_switch';
  const oldGen = 'gen_old_999';
  const newGen = 'gen_new_111';

  // Seed chunk and ledger under old generation
  await storeTransferChunk(bookId, 0, new Uint8Array(Buffer.from('StaleBytesFromOldGen')), oldGen);
  await saveTransferRecord(bookId, {
    bookId,
    generationId: oldGen,
    totalChunks: 1,
    completedChunks: [0],
    status: 'in_progress'
  });

  const originalRequest = apiClient.request.bind(apiClient);
  let chunkDownloadedGen = null;

  apiClient.request = async (endpoint) => {
    const ep = typeof endpoint === 'object' ? endpoint.path : endpoint;
    if (ep.includes('/chunks')) {
      return {
        ok: true,
        book_id: bookId,
        total_chunks: 1,
        generation_id: newGen,
        chunk_hashes: []
      };
    }
    if (ep.includes('/chunk/0')) {
      const match = ep.match(/generation_id=([^&]+)/);
      chunkDownloadedGen = match ? decodeURIComponent(match[1]) : null;
      return {
        ok: true,
        book_id: bookId,
        chunk_index: 0,
        chunk_data: Buffer.from('FreshBytesFromNewGen').toString('base64'),
        generation_id: newGen
      };
    }
    return originalRequest(endpoint);
  };

  try {
    const res = await downloadMangaChunks(bookId);
    assert.equal(res.success, true);
    assert.equal(chunkDownloadedGen, newGen, 'Must fetch chunk using new generation ID');
    // Ledger under old generation must be superseded
    const ledger = await getTransferRecord(bookId);
    assert.equal(ledger, null, 'Ledger cleaned on completion');
  } finally {
    apiClient.request = originalRequest;
  }
});

test('manga_transfer: corrupted resumed chunk detected via chunk SHA-256 and re-downloaded', async () => {
  const { downloadMangaChunks, computeSha256 } = await import('../src/ui/services/manga_transfer.js');
  const { saveTransferRecord, storeTransferChunk } = await import('../src/ui/services/manga_storage.js');
  const { apiClient } = await import('../src/ui/services/api_client.js');

  const bookId = 'test_book_corrupted_resume';
  const generationId = 'gen_resume_check';

  const goodData = Buffer.from('ValidChunkData');
  const goodHash = await computeSha256(goodData);
  const corruptedData = Buffer.from('CorruptedChunkData');

  // Pre-seed chunk 0 with corrupted data but marked completed in ledger
  await storeTransferChunk(bookId, 0, new Uint8Array(corruptedData), generationId);
  await saveTransferRecord(bookId, {
    bookId,
    generationId,
    totalChunks: 1,
    completedChunks: [0],
    status: 'in_progress'
  });

  let redownloaded = false;
  const originalRequest = apiClient.request.bind(apiClient);

  apiClient.request = async (endpoint) => {
    const ep = typeof endpoint === 'object' ? endpoint.path : endpoint;
    if (ep.includes('/chunks')) {
      return {
        ok: true,
        book_id: bookId,
        total_chunks: 1,
        generation_id: generationId,
        file_hash: goodHash,
        chunk_hashes: [goodHash]
      };
    }
    if (ep.includes('/chunk/0')) {
      redownloaded = true;
      return {
        ok: true,
        book_id: bookId,
        chunk_index: 0,
        chunk_data: goodData.toString('base64'),
        chunk_hash: goodHash
      };
    }
    return originalRequest(endpoint);
  };

  try {
    const res = await downloadMangaChunks(bookId);
    assert.equal(res.success, true);
    assert.equal(redownloaded, true, 'Corrupted chunk in ledger must be re-downloaded');
  } finally {
    apiClient.request = originalRequest;
  }
});
