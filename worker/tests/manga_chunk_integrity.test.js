import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import workerApp from '../index.js';
import { signJwt } from '../auth.js';

describe('Worker Chunk Integrity & Manifests', () => {
  let authHeader = '';
  const inMemoryChunks = new Map();
  const inMemoryManifests = new Map();

  const mockEnv = {
    ENVIRONMENT: 'development',
    JWT_SECRET: 'test-secret-at-least-32-chars-long-1234567890',
    TURSO_DATABASE_URL: 'libsql://mock.turso.io',
    TURSO_AUTH_TOKEN: 'mock-turso-token'
  };

  before(async () => {
    inMemoryChunks.clear();
    inMemoryManifests.clear();
    const token = await signJwt({ sub: 'user_integrity', exp: Math.floor(Date.now() / 1000) + 3600 }, mockEnv.JWT_SECRET);
    authHeader = `Bearer ${token}`;

    globalThis.fetch = async (url, options) => {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch (_) {}
      const stmt = body?.requests?.[0]?.stmt;
      const sql = stmt?.sql || '';
      const args = stmt?.args || [];

      if (sql.includes('CREATE TABLE') || sql.includes('ALTER TABLE')) {
        return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { rows: [] } } }] }), { status: 200 });
      }

      // Manifest insert
      if (sql.includes('INSERT INTO user_manga_upload_manifests')) {
        const userId = args[0]?.value;
        const bookId = args[1]?.value;
        const generationId = args[2]?.value;
        const totalBytes = Number(args[3]?.value);
        const chunkSize = Number(args[4]?.value);
        const totalChunks = Number(args[5]?.value);
        const fileHash = args[6]?.value;
        const chunkHashes = args[7]?.value;
        inMemoryManifests.set(`${userId}:${bookId}:${generationId}`, {
          userId, bookId, generationId, totalBytes, chunkSize, totalChunks, fileHash, chunkHashes, status: 'uploading'
        });
        return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { rowsAffected: 1 } } }] }), { status: 200 });
      }

      // Manifest select by book
      if (sql.includes('FROM user_manga_upload_manifests') && sql.includes('ORDER BY created_at DESC LIMIT 1')) {
        const userId = args[0]?.value;
        const bookId = args[1]?.value;
        let latest = null;
        for (const m of inMemoryManifests.values()) {
          if (m.userId === userId && m.bookId === bookId) {
            latest = m;
          }
        }
        const rows = latest ? [[
          { value: latest.generationId },
          { value: String(latest.totalBytes) },
          { value: String(latest.chunkSize) },
          { value: String(latest.totalChunks) },
          { value: latest.fileHash },
          { value: latest.chunkHashes },
          { value: latest.status }
        ]] : [];
        return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { rows } } }] }), { status: 200 });
      }

      // Manifest select by generation
      if (sql.includes('FROM user_manga_upload_manifests') && sql.includes('generation_id = ?')) {
        const userId = args[0]?.value;
        const bookId = args[1]?.value;
        const generationId = args[2]?.value;
        const m = inMemoryManifests.get(`${userId}:${bookId}:${generationId}`);
        const rows = m ? [[
          { value: String(m.totalChunks) },
          { value: m.fileHash },
          { value: String(m.totalBytes) },
          { value: m.status }
        ]] : [];
        return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { rows } } }] }), { status: 200 });
      }

      // Manifest update to verified
      if (sql.includes('UPDATE user_manga_upload_manifests') && sql.includes("SET status = 'verified'")) {
        const userId = args[1]?.value;
        const bookId = args[2]?.value;
        const generationId = args[3]?.value;
        const m = inMemoryManifests.get(`${userId}:${bookId}:${generationId}`);
        if (m) m.status = 'verified';
        return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { rowsAffected: 1 } } }] }), { status: 200 });
      }

      // Chunk insert
      if (sql.includes('INSERT INTO user_manga_chunks')) {
        const userId = args[0]?.value;
        const bookId = args[1]?.value;
        const chunkIndex = Number(args[2]?.value);
        const totalChunks = Number(args[3]?.value);
        const chunkData = args[4]?.value;
        const generationId = args[6]?.value || '';
        const chunkHash = args[7]?.value || '';
        inMemoryChunks.set(`${userId}:${bookId}:${chunkIndex}`, { userId, bookId, chunkIndex, totalChunks, chunkData, generationId, chunkHash });
        return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { rowsAffected: 1 } } }] }), { status: 200 });
      }

      // Chunks select
      if (sql.includes('FROM user_manga_chunks') && sql.includes('ORDER BY chunk_index ASC')) {
        const userId = args[0]?.value;
        const bookId = args[1]?.value;
        const rows = [];
        for (const [k, v] of inMemoryChunks.entries()) {
          if (v.userId === userId && v.bookId === bookId) {
            if (sql.includes('SELECT chunk_index, generation_id')) {
              rows.push([
                { value: String(v.chunkIndex) },
                { value: v.generationId || '' }
              ]);
            } else {
              rows.push([
                { value: String(v.chunkIndex) },
                { value: String(v.totalChunks) },
                { value: v.generationId || '' },
                { value: v.chunkHash || '' }
              ]);
            }
          }
        }
        rows.sort((a, b) => Number(a[0].value) - Number(b[0].value));
        return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { rows } } }] }), { status: 200 });
      }

      return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { rows: [] } } }] }), { status: 200 });
    };
  });

  test('POST /api/user/manga/:book_id/chunk rejects out-of-bounds chunk index', async () => {
    const res = await workerApp.fetch(new Request('http://localhost/api/user/manga/book_test_bounds/chunk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader
      },
      body: JSON.stringify({
        chunk_index: 5,
        total_chunks: 3,
        chunk_data: 'dGVzdA=='
      })
    }), mockEnv);

    assert.equal(res.status, 400);
    const json = await res.json();
    assert.ok(json.error);
  });

  test('POST /api/user/manga/:book_id/chunk rejects invalid cryptographic chunk checksum', async () => {
    // "test" base64 is dGVzdA==, but we supply a bogus chunk_hash
    const res = await workerApp.fetch(new Request('http://localhost/api/user/manga/book_bad_hash/chunk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader
      },
      body: JSON.stringify({
        chunk_index: 0,
        total_chunks: 1,
        chunk_data: 'dGVzdA==',
        chunk_hash: '0000000000000000000000000000000000000000000000000000000000000000'
      })
    }), mockEnv);

    assert.equal(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /checksum mismatch/i);
  });

  test('POST /api/user/manga/:book_id/chunk rejects mixed/outdated upload generation', async () => {
    // Initialize active upload manifest with gen_alpha
    await workerApp.fetch(new Request('http://localhost/api/user/manga/book_gen_test/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        generation_id: 'gen_alpha',
        total_bytes: 4,
        total_chunks: 1,
        file_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
      })
    }), mockEnv);

    // Attempt to upload chunk with outdated gen_old
    const res = await workerApp.fetch(new Request('http://localhost/api/user/manga/book_gen_test/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        chunk_index: 0,
        total_chunks: 1,
        chunk_data: 'dGVzdA==',
        generation_id: 'gen_old'
      })
    }), mockEnv);

    assert.equal(res.status, 409, 'Must reject outdated generation with 409 Conflict');
    const json = await res.json();
    assert.match(json.error, /generation mismatch/i);
  });

  test('POST /api/user/manga/:book_id/upload/verify rejects checksum mismatch on final file', async () => {
    // Correct SHA-256 for "test" is 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
    const expectedHash = crypto.createHash('sha256').update('test').digest('hex');

    await workerApp.fetch(new Request('http://localhost/api/user/manga/book_verify_fail/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        generation_id: 'gen_verify',
        total_bytes: 4,
        total_chunks: 1,
        file_hash: expectedHash
      })
    }), mockEnv);

    // Verify with mismatched hash
    const res = await workerApp.fetch(new Request('http://localhost/api/user/manga/book_verify_fail/upload/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        generation_id: 'gen_verify',
        file_hash: 'badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad1'
      })
    }), mockEnv);

    assert.equal(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /checksum mismatch/i);
  });

  test('Full manifest-verified upload succeeds and marks book verified', async () => {
    const chunkData = Buffer.from('HelloWorld').toString('base64');
    const chunkHash = crypto.createHash('sha256').update('HelloWorld').digest('hex');

    // 1. Init manifest
    const initRes = await workerApp.fetch(new Request('http://localhost/api/user/manga/book_full_flow/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        generation_id: 'gen_success',
        total_bytes: 10,
        total_chunks: 1,
        file_hash: chunkHash,
        chunk_hashes: [chunkHash]
      })
    }), mockEnv);
    assert.equal(initRes.status, 200);

    // 2. Upload chunk
    const chunkRes = await workerApp.fetch(new Request('http://localhost/api/user/manga/book_full_flow/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        chunk_index: 0,
        total_chunks: 1,
        chunk_data: chunkData,
        generation_id: 'gen_success',
        chunk_hash: chunkHash
      })
    }), mockEnv);
    assert.equal(chunkRes.status, 200);

    // 3. Verify
    const verifyRes = await workerApp.fetch(new Request('http://localhost/api/user/manga/book_full_flow/upload/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        generation_id: 'gen_success',
        file_hash: chunkHash
      })
    }), mockEnv);
    assert.equal(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.equal(verifyData.verified, true);
  });
});
