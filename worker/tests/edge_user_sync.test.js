/**
 * Targeted tests for Cloudflare Worker User Progress Sync & Hydration Endpoints
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import workerApp from '../index.js';

describe('Edge User Progress Endpoints', () => {
  const realFetch = globalThis.fetch;

  before(() => {
    // Intercept Turso & Neon fetch calls to provide hermetic mock responses
    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);

      if (urlStr.includes('/v2/pipeline')) {
        let body = {};
        try { body = JSON.parse(options.body || '{}'); } catch (_) {}
        const stmt = body?.requests?.[0]?.stmt;
        const sql = stmt?.sql || '';

        if (sql.includes('count(*) as total')) {
          return new Response(JSON.stringify({
            results: [{
              response: {
                type: 'execute',
                result: {
                  cols: [{ name: 'total' }, { name: 'learning' }, { name: 'review' }],
                  rows: [[{ value: '15' }, { value: '5' }, { value: '10' }]]
                }
              }
            }]
          }), { status: 200 });
        }

        if (sql.includes('count(*) as seen')) {
          return new Response(JSON.stringify({
            results: [{
              response: {
                type: 'execute',
                result: {
                  cols: [{ name: 'seen' }, { name: 'mastered' }],
                  rows: [[{ value: '50' }, { value: '25' }]]
                }
              }
            }]
          }), { status: 200 });
        }

        if (sql.includes('SELECT vocab_id, state')) {
          return new Response(JSON.stringify({
            results: [{
              response: {
                type: 'execute',
                result: {
                  cols: [{ name: 'vocab_id' }, { name: 'state' }, { name: 'stability' }, { name: 'due_at' }],
                  rows: [[{ value: '101' }, { value: '1' }, { value: 1.5 }, { value: '1600000000' }]]
                }
              }
            }]
          }), { status: 200 });
        }

        if (sql.includes('FROM user_op_log')) {
          return new Response(JSON.stringify({
            results: [{
              response: {
                type: 'execute',
                result: {
                  cols: [{ name: 'id' }, { name: 'op_type' }, { name: 'payload' }, { name: 'created_at' }],
                  rows: [[
                    { value: 'card_1' },
                    { value: 'card_save' },
                    { value: JSON.stringify({ id: 'card_1', expression: '猫', reading: 'ねこ', meaning: 'cat', deck_name: 'Default', sync_status: 'synced' }) },
                    { value: new Date().toISOString() }
                  ]]
                }
              }
            }]
          }), { status: 200 });
        }

        if (sql.includes('ORDER BY last_watched_at DESC')) {
          return new Response(JSON.stringify({
            results: [{
              response: {
                type: 'execute',
                result: {
                  cols: [
                    { name: 'series_id' }, { name: 'episode_number' }, { name: 'last_position_ms' },
                    { name: 'duration_ms' }, { name: 'completed' }, { name: 'mined_card_count' },
                    { name: 'last_watched_at' }, { name: 'poster_url' }, { name: 'series_title' },
                    { name: 'synopsis' }, { name: 'media_type' }
                  ],
                  rows: [[
                    { value: 'frieren' }, { value: 1 }, { value: 1200000 },
                    { value: 1440000 }, { value: 1 }, { value: 4 },
                    { value: 1700000000 }, { value: 'https://example.com/poster.jpg' }, { value: 'Sousou no Frieren' },
                    { value: 'Elves and magic' }, { value: 'anime' }
                  ]]
                }
              }
            }]
          }), { status: 200 });
        }

        if (sql.includes('SELECT series_id, episode_number')) {
          return new Response(JSON.stringify({
            results: [{
              response: {
                type: 'execute',
                result: {
                  cols: [{ name: 'series_id' }, { name: 'episode_number' }, { name: 'last_position_ms' }, { name: 'completed' }],
                  rows: [[{ value: 'frieren-s1' }, { value: 1 }, { value: 1245000 }, { value: 1 }]]
                }
              }
            }]
          }), { status: 200 });
        }

        return new Response(JSON.stringify({
          results: [{ response: { type: 'execute', result: { cols: [], rows: [] } } }]
        }), { status: 200 });
      }

      if (urlStr.includes('neon.tech/sql')) {
        return new Response(JSON.stringify({
          rows: [{
            vocab_id: 101,
            id: 101,
            term: '魔法',
            reading: 'まほう',
            content_blob: JSON.stringify(['magic; witchcraft']),
            rules: 'n',
            def_tags: '',
            score: 5000
          }]
        }), { status: 200 });
      }

      return realFetch(url, options);
    };
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  const mockEnv = {
    ENVIRONMENT: 'development',
    TURSO_DATABASE_URL: 'libsql://mock.turso.io',
    TURSO_AUTH_TOKEN: 'mock-turso-token',
    NEON_DATABASE_URL: 'postgresql://mock:mock@neon.tech/mock'
  };

  test('GET /api/user/progress/summary returns user study counts', async () => {
    const res = await workerApp.fetch(new Request('http://localhost/api/user/progress/summary'), mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.summary);
    assert.strictEqual(body.summary.vocab.total, 15);
    assert.strictEqual(body.summary.kanji.seen, 50);
  });

  test('POST /api/user/progress/sync accepts batch reviews without duplicate text', async () => {
    const payload = {
      vocab_reviews: [
        { vocab_id: 101, state: 2, stability: 4.2, difficulty: 2.1, reps: 3, lapses: 0, due_at: 1780000000 }
      ],
      kanji_practices: [
        { kanji_char: '猫', mastery_flags: 7, accuracy_percent: 100 }
      ],
      grammar_reviews: [
        { point_id: 'n3_te_shimau', mastery_level: 4, consecutive_correct: 3 }
      ],
      daily: {
        cards_reviewed: 10,
        minutes_studied: 12.5,
        cards_mined: 2
      }
    };

    const res = await workerApp.fetch(new Request('http://localhost/api/user/progress/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }), mockEnv);

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.synced.vocab, 1);
    assert.strictEqual(body.synced.kanji, 1);
    assert.strictEqual(body.synced.grammar, 1);
  });

  test('GET /api/user/progress/vocab/due hydrates cards from Neon when requested', async () => {
    const res = await workerApp.fetch(new Request('http://localhost/api/user/progress/vocab/due?hydrate=true'), mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.count, 1);
    const card = body.due_cards[0];
    assert.strictEqual(card.vocab_id, '101');
    assert.strictEqual(card.expression, '魔法');
    assert.strictEqual(card.reading, 'まほう');
  });

  test('POST and GET /api/user/progress/anime saves and retrieves playback bookmarks', async () => {
    const postRes = await workerApp.fetch(new Request('http://localhost/api/user/progress/anime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        series_id: 'frieren-s1',
        episode_number: 1,
        last_position_ms: 1245000,
        duration_ms: 1420000,
        completed: true,
        mined_card_count: 3
      })
    }), mockEnv);
    assert.strictEqual(postRes.status, 200);

    const getRes = await workerApp.fetch(new Request('http://localhost/api/user/progress/anime/frieren-s1'), mockEnv);
    assert.strictEqual(getRes.status, 200);
    const getBody = await getRes.json();
    assert.strictEqual(getBody.ok, true);
    assert.strictEqual(getBody.series_id, 'frieren-s1');
    assert.strictEqual(getBody.episodes.length, 1);
    assert.strictEqual(getBody.episodes[0].last_position_ms, 1245000);
  });

  test('POST /api/user/progress/sync is idempotent when event_id is supplied', async () => {
    let checkedEvents = false;
    const realFetchFn = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);
      if (urlStr.includes('/v2/pipeline')) {
        let body = {};
        try { body = JSON.parse(options.body || '{}'); } catch (_) {}
        const sql = body?.requests?.[0]?.stmt?.sql || '';
        if (sql.includes('SELECT event_id FROM user_sync_events')) {
          if (checkedEvents) {
            return new Response(JSON.stringify({
              results: [{ response: { type: 'execute', result: { cols: [{ name: 'event_id' }], rows: [[{ value: 'evt_12345' }]] } } }]
            }), { status: 200 });
          }
          checkedEvents = true;
          return new Response(JSON.stringify({
            results: [{ response: { type: 'execute', result: { cols: [], rows: [] } } }]
          }), { status: 200 });
        }
      }
      return realFetchFn(url, options);
    };

    try {
      const payload = {
        event_id: 'evt_12345',
        vocab_reviews: [{ vocab_id: 101, state: 2 }]
      };
      // First sync attempt
      const res1 = await workerApp.fetch(new Request('http://localhost/api/user/progress/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }), mockEnv);
      assert.strictEqual(res1.status, 200);

      // Second retry attempt with same event_id
      const res2 = await workerApp.fetch(new Request('http://localhost/api/user/progress/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }), mockEnv);
      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.deduplicated, true);
    } finally {
      globalThis.fetch = realFetchFn;
    }
  });

  test('POST /api/user/progress/sync rejects service API keys with 403 Forbidden', async () => {
    const res = await workerApp.fetch(new Request('http://localhost/api/user/progress/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer service-secret-key'
      },
      body: JSON.stringify({ vocab_reviews: [{ vocab_id: 101 }] })
    }), {
      ...mockEnv,
      CLOUD_QUEUE_API_KEY: 'service-secret-key'
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error, 'Forbidden');
  });

  test('Production mode rejects unauthenticated user progress requests with 401', async () => {
    const res = await workerApp.fetch(new Request('http://localhost/api/user/progress/summary'), {
      ...mockEnv,
      ENVIRONMENT: 'production'
    });
    assert.strictEqual(res.status, 401);
  });

  test('GET /api/cards retrieves user cards from Turso op_log with pagination', async () => {
    const res = await workerApp.fetch(new Request('http://localhost/api/cards?limit=10&offset=0'), mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.total, 1);
    assert.strictEqual(body.cards.length, 1);
    assert.strictEqual(body.cards[0].expression, '猫');
    assert.strictEqual(body.cards[0].meaning, 'cat');
  });

  test('GET /api/cards/stats returns user card telemetry and sync ratio', async () => {
    const res = await workerApp.fetch(new Request('http://localhost/api/cards/stats'), mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.total, 1);
    assert.strictEqual(body.sync_ratio.synced, 1);
  });

  test('GET /api/link/series retrieves persistent anime series and episodes from Turso', async () => {
    const res = await workerApp.fetch(new Request('http://localhost/api/link/series'), mockEnv);
    assert.strictEqual(res.status, 200);
    const list = await res.json();
    assert.ok(Array.isArray(list));
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].series, 'Sousou no Frieren');
    assert.strictEqual(list[0].episodes.length, 1);
    assert.strictEqual(list[0].episodes[0].last_position_ms, 1200000);
  });
});

