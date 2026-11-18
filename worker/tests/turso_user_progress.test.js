/**
 * Targeted tests for Turso libSQL User Progress Schemas (Zero Data Duplication)
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { queryTurso, initTursoSchema, _resetSchemaInitForTest } from '../turso.js';

describe('Turso libSQL User Progress Schema & Operations', () => {
  // Mock fetch for Turso HTTP pipeline if live Turso is unavailable in offline CI
  const realFetch = globalThis.fetch;
  const inMemoryTables = new Map();

  before(() => {
    _resetSchemaInitForTest();
    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);
      if (urlStr.includes('/v2/pipeline')) {
        let body = {};
        try { body = JSON.parse(options.body || '{}'); } catch (_) {}
        const stmt = body?.requests?.[0]?.stmt;
        const sql = stmt?.sql || '';
        const args = stmt?.args || [];

        // In-memory tracker for test verification (handles both single and batched pipeline requests)
        if (body?.requests && Array.isArray(body.requests)) {
          const createTableReqs = body.requests.filter(r => (r?.stmt?.sql || '').includes('CREATE TABLE'));
          if (createTableReqs.length > 0) {
            for (const req of createTableReqs) {
              const match = (req?.stmt?.sql || '').match(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)/i);
              if (match) inMemoryTables.set(match[1], true);
            }
            return new Response(JSON.stringify({
              results: body.requests.map(() => ({ response: { type: 'execute', result: { cols: [], rows: [] } } }))
            }), { status: 200 });
          }
        }

        if (sql.includes('INSERT INTO user_vocab_progress')) {
          return new Response(JSON.stringify({
            results: [{ response: { type: 'execute', result: { cols: [], rows: [] } } }]
          }), { status: 200 });
        }

        if (sql.includes('SELECT') && sql.includes('user_vocab_progress')) {
          return new Response(JSON.stringify({
            results: [{
              response: {
                type: 'execute',
                result: {
                  cols: [{ name: 'vocab_id' }, { name: 'state' }, { name: 'stability' }, { name: 'due_at' }],
                  rows: [
                    [{ value: '42' }, { value: '1' }, { value: 2.5 }, { value: '1700000000' }]
                  ]
                }
              }
            }]
          }), { status: 200 });
        }

        if (sql.includes('INSERT INTO user_anime_progress')) {
          return new Response(JSON.stringify({
            results: [{ response: { type: 'execute', result: { cols: [], rows: [] } } }]
          }), { status: 200 });
        }

        return new Response(JSON.stringify({
          results: [{ response: { type: 'execute', result: { cols: [], rows: [] } } }]
        }), { status: 200 });
      }
      return realFetch(url, options);
    };
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  test('initTursoSchema creates all deduplicated user tracking tables', async () => {
    const mockContext = {
      env: {
        TURSO_DATABASE_URL: 'libsql://mock-test.turso.io',
        TURSO_AUTH_TOKEN: 'mock-token'
      }
    };

    await initTursoSchema(mockContext);

    const expectedTables = [
      'user_vocab_progress',
      'user_kanji_progress',
      'user_grammar_progress',
      'user_question_history',
      'user_anime_progress',
      'user_manga_progress',
      'user_anki_links',
      'user_daily_activity'
    ];

    for (const tbl of expectedTables) {
      assert.strictEqual(inMemoryTables.has(tbl), true, `Table ${tbl} should be initialized`);
    }
  });

  test('user_vocab_progress query returns normalized reference fields without strings', async () => {
    const mockContext = {
      env: {
        TURSO_DATABASE_URL: 'libsql://mock-test.turso.io',
        TURSO_AUTH_TOKEN: 'mock-token'
      }
    };

    const res = await queryTurso(mockContext, 'SELECT vocab_id, state, stability, due_at FROM user_vocab_progress WHERE user_id = ?', ['test-user']);
    assert.ok(res);
    assert.ok(Array.isArray(res.rows));
    assert.strictEqual(res.rows.length, 1);
    assert.strictEqual(res.rows[0][0].value, '42');
  });
});

