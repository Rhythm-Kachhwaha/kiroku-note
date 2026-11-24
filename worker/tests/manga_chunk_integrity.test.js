import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
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

      if (sql.includes('CREATE TABLE')) {
        return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { rows: [] } } }] }), { status: 200 });
      }

      if (sql.includes('INSERT INTO user_manga_chunks')) {
        const userId = args[0]?.value;
        const bookId = args[1]?.value;
        const chunkIndex = Number(args[2]?.value);
        const totalChunks = Number(args[3]?.value);
        const chunkData = args[4]?.value;
        inMemoryChunks.set(`${userId}:${bookId}:${chunkIndex}`, { userId, bookId, chunkIndex, totalChunks, chunkData });
        return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { rowsAffected: 1 } } }] }), { status: 200 });
      }

      if (sql.includes('FROM user_manga_chunks') && sql.includes('ORDER BY chunk_index ASC')) {
        const userId = args[0]?.value;
        const bookId = args[1]?.value;
        const rows = [];
        for (const [k, v] of inMemoryChunks.entries()) {
          if (v.userId === userId && v.bookId === bookId) {
            rows.push([{ value: v.chunkIndex }, { value: v.totalChunks }]);
          }
        }
        rows.sort((a, b) => a[0].value - b[0].value);
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

  test('GET /api/user/manga/:book_id/chunks requires contiguous chunk sequence for completeness', async () => {
    // Upload chunk 0 and chunk 2 for a 3-chunk book (missing chunk 1)
    await workerApp.fetch(new Request('http://localhost/api/user/manga/book_non_contiguous/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ chunk_index: 0, total_chunks: 3, chunk_data: 'Y2h1bmsw' })
    }), mockEnv);

    await workerApp.fetch(new Request('http://localhost/api/user/manga/book_non_contiguous/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ chunk_index: 2, total_chunks: 3, chunk_data: 'Y2h1bmsy' })
    }), mockEnv);

    const res = await workerApp.fetch(new Request('http://localhost/api/user/manga/book_non_contiguous/chunks', {
      headers: { Authorization: authHeader }
    }), mockEnv);

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.complete, false, 'Non-contiguous chunks must not be marked complete');
    assert.equal(json.is_contiguous, false, 'is_contiguous must be reported false');
  });
});
