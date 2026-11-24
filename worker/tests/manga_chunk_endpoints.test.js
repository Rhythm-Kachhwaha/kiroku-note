import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import workerApp from '../index.js';
import { signJwt } from '../auth.js';

describe('Worker Manga Chunk Endpoints', () => {
  const realFetch = globalThis.fetch;
  const inMemoryChunks = new Map();
  const inMemoryBooks = new Map();

  const mockEnv = {
    ENVIRONMENT: 'development',
    JWT_SECRET: 'test-secret-at-least-32-chars-long-1234567890',
    TURSO_DATABASE_URL: 'libsql://mock.turso.io',
    TURSO_AUTH_TOKEN: 'mock-turso-token'
  };

  let authHeader = '';

  before(async () => {
    inMemoryChunks.clear();
    inMemoryBooks.clear();

    const token = await signJwt({ sub: 'user_123', exp: Math.floor(Date.now() / 1000) + 3600 }, mockEnv.JWT_SECRET);
    authHeader = `Bearer ${token}`;

    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);

      if (urlStr.includes('/v2/pipeline')) {
        let body = {};
        try { body = JSON.parse(options.body || '{}'); } catch (_) {}
        const stmt = body?.requests?.[0]?.stmt;
        const sql = stmt?.sql || '';
        const args = stmt?.args || [];

        // Schema init / create table
        if (sql.includes('CREATE TABLE') || sql.includes('ALTER TABLE')) {
          return new Response(JSON.stringify({
            results: [{ response: { type: 'execute', result: { rows: [] } } }]
          }), { status: 200 });
        }

        // INSERT into user_manga_chunks
        if (sql.includes('INSERT INTO user_manga_chunks')) {
          const userId = args[0]?.value;
          const bookId = args[1]?.value;
          const chunkIndex = Number(args[2]?.value);
          const totalChunks = Number(args[3]?.value);
          const chunkData = args[4]?.value;
          const key = `${userId}:${bookId}:${chunkIndex}`;
          inMemoryChunks.set(key, { userId, bookId, chunkIndex, totalChunks, chunkData });
          return new Response(JSON.stringify({
            results: [{ response: { type: 'execute', result: { rowsAffected: 1 } } }]
          }), { status: 200 });
        }

        // SELECT from user_manga_chunks (all chunks for book)
        if (sql.includes('FROM user_manga_chunks') && sql.includes('ORDER BY chunk_index ASC')) {
          const userId = args[0]?.value;
          const bookId = args[1]?.value;
          const rows = [];
          for (const v of inMemoryChunks.values()) {
            if (v.userId === userId && v.bookId === bookId) {
              rows.push([
                { value: String(v.chunkIndex) },
                { value: String(v.totalChunks) }
              ]);
            }
          }
          rows.sort((a, b) => Number(a[0].value) - Number(b[0].value));
          return new Response(JSON.stringify({
            results: [{ response: { type: 'execute', result: { rows } } }]
          }), { status: 200 });
        }

        // SELECT single chunk
        if (sql.includes('FROM user_manga_chunks') && sql.includes('WHERE user_id = ? AND book_id = ? AND chunk_index = ?')) {
          const userId = args[0]?.value;
          const bookId = args[1]?.value;
          const chunkIndex = Number(args[2]?.value);
          const key = `${userId}:${bookId}:${chunkIndex}`;
          const chunk = inMemoryChunks.get(key);
          const rows = chunk ? [[{ value: chunk.chunkData }, { value: String(chunk.totalChunks) }]] : [];
          return new Response(JSON.stringify({
            results: [{ response: { type: 'execute', result: { rows } } }]
          }), { status: 200 });
        }

        // DELETE from user_manga_chunks
        if (sql.includes('DELETE FROM user_manga_chunks')) {
          const userId = args[0]?.value;
          const bookId = args[1]?.value;
          for (const [k, v] of Array.from(inMemoryChunks.entries())) {
            if (v.userId === userId && v.bookId === bookId) {
              inMemoryChunks.delete(k);
            }
          }
          return new Response(JSON.stringify({
            results: [{ response: { type: 'execute', result: { rowsAffected: 1 } } }]
          }), { status: 200 });
        }

        // SELECT list
        if (sql.includes('FROM user_manga_books b')) {
          const userId = args[0]?.value;
          const rows = [];
          for (const b of inMemoryBooks.values()) {
            if (b.userId === userId) {
              let hasFile = 0;
              for (const c of inMemoryChunks.values()) {
                if (c.userId === userId && c.bookId === b.book_id) {
                  hasFile = 1;
                  break;
                }
              }
              rows.push([
                { value: b.book_id },
                { value: b.title },
                { value: b.file_name || b.filename },
                { value: b.file_type },
                { value: String(b.file_size || b.size || 0) },
                { value: String(b.page_count || b.total_pages || 1) },
                { value: String(b.last_read_at || 0) },
                { value: b.cover_url || '' },
                { value: String(hasFile) },
                { value: String(b.current_page || 1) },
                { value: '0' },
                { value: String(b.last_read_at || 0) }
              ]);
            }
          }
          return new Response(JSON.stringify({
            results: [{ response: { type: 'execute', result: { rows } } }]
          }), { status: 200 });
        }

        return new Response(JSON.stringify({
          results: [{ response: { type: 'execute', result: { rows: [] } } }]
        }), { status: 200 });
      }

      return realFetch(url, options);
    };
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  test('POST /api/user/manga/:book_id/chunk uploads chunks correctly', async () => {
    const req1 = new Request('https://worker/api/user/manga/book_test_1/chunk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({
        chunk_index: 0,
        total_chunks: 2,
        chunk_data: 'AAECAwQ='
      })
    });
    const res1 = await workerApp.fetch(req1, mockEnv);
    assert.strictEqual(res1.status, 200);
    const data1 = await res1.json();
    assert.strictEqual(data1.ok, true);
    assert.strictEqual(data1.chunk_index, 0);

    const req2 = new Request('https://worker/api/user/manga/book_test_1/chunk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({
        chunk_index: 1,
        total_chunks: 2,
        chunk_data: 'BQYHCAk='
      })
    });
    const res2 = await workerApp.fetch(req2, mockEnv);
    assert.strictEqual(res2.status, 200);
  });

  test('GET /api/user/manga/:book_id/chunks returns completeness and index list', async () => {
    const req = new Request('https://worker/api/user/manga/book_test_1/chunks', {
      method: 'GET',
      headers: { 'Authorization': authHeader }
    });
    const res = await workerApp.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.total_chunks, 2);
    assert.strictEqual(data.uploaded_chunks, 2);
    assert.strictEqual(data.complete, true);
    assert.deepStrictEqual(data.chunk_indices, [0, 1]);
  });

  test('GET /api/user/manga/:book_id/chunk/:index retrieves chunk data', async () => {
    const req = new Request('https://worker/api/user/manga/book_test_1/chunk/0', {
      method: 'GET',
      headers: { 'Authorization': authHeader }
    });
    const res = await workerApp.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.chunk_data, 'AAECAwQ=');
  });

  test('GET /api/user/manga/list reports has_file true when chunks exist', async () => {
    inMemoryBooks.set('user_123:book_test_1', {
      userId: 'user_123',
      book_id: 'book_test_1',
      title: 'Yotsubato Vol 1',
      page_count: 231,
      current_page: 0,
      file_type: 'cbz',
      file_name: '001 [JP] Yotsubato.cbz',
      file_size: 64618110,
      last_read_at: 1794685753,
      cover_url: 'data:image/jpeg;base64,...'
    });

    const req = new Request('https://worker/api/user/manga/list', {
      method: 'GET',
      headers: { 'Authorization': authHeader }
    });
    const res = await workerApp.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(Array.isArray(data.books), true);
    assert.strictEqual(data.books.length, 1);
    assert.strictEqual(data.books[0].has_file, true);
    assert.strictEqual(data.books[0].title, 'Yotsubato Vol 1');
  });

  test('DELETE /api/user/manga/:book_id/chunks clears all chunks', async () => {
    const delReq = new Request('https://worker/api/user/manga/book_test_1/chunks', {
      method: 'DELETE',
      headers: { 'Authorization': authHeader }
    });
    const delRes = await workerApp.fetch(delReq, mockEnv);
    assert.strictEqual(delRes.status, 200);

    const getReq = new Request('https://worker/api/user/manga/book_test_1/chunks', {
      method: 'GET',
      headers: { 'Authorization': authHeader }
    });
    const getRes = await workerApp.fetch(getReq, mockEnv);
    const getData = await getRes.json();
    assert.strictEqual(getData.complete, false);
    assert.strictEqual(getData.uploaded_chunks, 0);
  });
});
