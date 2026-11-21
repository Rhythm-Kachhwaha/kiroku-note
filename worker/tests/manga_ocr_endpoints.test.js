/**
 * Targeted tests for Cloudflare Worker Manga OCR Endpoints
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import workerApp from '../index.js';

describe('Worker Manga OCR Endpoints', () => {
  const realFetch = globalThis.fetch;
  const inMemoryOcrPages = new Map();

  const mockEnv = {
    ENVIRONMENT: 'development',
    JWT_SECRET: 'test-secret-at-least-32-chars-long-1234567890',
    TURSO_DATABASE_URL: 'libsql://mock.turso.io',
    TURSO_AUTH_TOKEN: 'mock-turso-token'
  };

  before(() => {
    inMemoryOcrPages.clear();

    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);

      if (urlStr.includes('/v2/pipeline')) {
        let body = {};
        try { body = JSON.parse(options.body || '{}'); } catch (_) {}
        const stmt = body?.requests?.[0]?.stmt;
        const sql = stmt?.sql || '';
        const args = stmt?.args || [];

        // Handle table creation / init
        if (sql.includes('CREATE TABLE')) {
          return new Response(JSON.stringify({
            results: [{ response: { type: 'execute', result: { rows: [] } } }]
          }), { status: 200 });
        }

        // Handle INSERT / UPSERT into user_manga_ocr_pages
        if (sql.includes('INSERT INTO user_manga_ocr_pages')) {
          const userId = args[0]?.value;
          const bookId = args[1]?.value;
          const pageNum = Number(args[2]?.value);
          const bubblesJson = args[3]?.value;
          const key = `${userId}:${bookId}:${pageNum}`;
          inMemoryOcrPages.set(key, { page_number: pageNum, bubbles_json: bubblesJson, updated_at: 1000 });
          return new Response(JSON.stringify({
            results: [{ response: { type: 'execute', result: { rowsAffected: 1 } } }]
          }), { status: 200 });
        }

        // Handle SELECT from user_manga_ocr_pages
        if (sql.includes('FROM user_manga_ocr_pages') && sql.includes('SELECT')) {
          const userId = args[0]?.value;
          const bookId = args[1]?.value;
          const rows = [];
          for (const [k, v] of inMemoryOcrPages.entries()) {
            if (k.startsWith(`${userId}:${bookId}:`)) {
              rows.push([
                { value: String(v.page_number) },
                { value: v.bubbles_json },
                { value: String(v.updated_at) }
              ]);
            }
          }
          return new Response(JSON.stringify({
            results: [{
              response: {
                type: 'execute',
                result: {
                  cols: [{ name: 'page_number' }, { name: 'bubbles_json' }, { name: 'updated_at' }],
                  rows
                }
              }
            }]
          }), { status: 200 });
        }

        // Handle DELETE from user_manga_ocr_pages
        if (sql.includes('DELETE FROM user_manga_ocr_pages')) {
          const userId = args[0]?.value;
          const bookId = args[1]?.value;
          for (const k of Array.from(inMemoryOcrPages.keys())) {
            if (k.startsWith(`${userId}:${bookId}:`)) {
              inMemoryOcrPages.delete(k);
            }
          }
          return new Response(JSON.stringify({
            results: [{ response: { type: 'execute', result: { rowsAffected: 1 } } }]
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

  test('POST /api/user/manga/ocr/batch upserts pages successfully', async () => {
    const req = new Request('https://worker/api/user/manga/ocr/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        book_id: 'test_book_yotsuba_1',
        pages: [
          {
            page_number: 1,
            bubbles: [
              { box: [100, 200, 300, 400], text: 'こんにちは', confidence: 0.95 }
            ]
          },
          {
            page_number: 2,
            bubbles: [
              { box: [50, 60, 150, 160], text: 'ありがとう', confidence: 0.98 }
            ]
          }
        ]
      })
    });

    const res = await workerApp.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.book_id, 'test_book_yotsuba_1');
    assert.strictEqual(data.count, 2);
  });

  test('GET /api/user/manga/ocr/:bookId returns saved pages', async () => {
    const req = new Request('https://worker/api/user/manga/ocr/test_book_yotsuba_1', {
      method: 'GET'
    });

    const res = await workerApp.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.book_id, 'test_book_yotsuba_1');
    assert.strictEqual(Array.isArray(data.pages), true);
    assert.strictEqual(data.pages.length, 2);
    assert.strictEqual(data.pages[0].page_number, 1);
    assert.strictEqual(data.pages[0].bubbles[0].text, 'こんにちは');
  });

  test('DELETE /api/user/manga/ocr/:bookId clears pages', async () => {
    const delReq = new Request('https://worker/api/user/manga/ocr/test_book_yotsuba_1', {
      method: 'DELETE'
    });
    const delRes = await workerApp.fetch(delReq, mockEnv);
    assert.strictEqual(delRes.status, 200);

    const getReq = new Request('https://worker/api/user/manga/ocr/test_book_yotsuba_1', {
      method: 'GET'
    });
    const getRes = await workerApp.fetch(getReq, mockEnv);
    const getData = await getRes.json();
    assert.strictEqual(getData.pages.length, 0);
  });
});
