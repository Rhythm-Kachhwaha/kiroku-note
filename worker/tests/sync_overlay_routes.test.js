import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import workerApp from '../index.js';

function signHs256Jwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

test('S22 & S23: Worker overlays Turso user_known_words on /api/vocab/inventory and grammar_reviews on /api/grammar/*', async () => {
  const secret = 'test_jwt_secret_123456';
  const token = signHs256Jwt(
    { sub: 'user_sync_1', email: 'rhythm@example.com', exp: Math.floor(Date.now() / 1000) + 3600 },
    secret
  );
  const env = {
    ENVIRONMENT: 'production',
    JWT_SECRET: secret,
    TURSO_DATABASE_URL: 'libsql://test-db.turso.io',
    TURSO_AUTH_TOKEN: 'turso_token',
    RENDER_BACKEND_URL: 'https://render.example.invalid',
  };

  const tursoWrites = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('turso.io/v2/pipeline')) {
      const body = JSON.parse(init.body || '{}');
      const sql = body.requests?.[0]?.stmt?.sql || '';
      if (sql.includes('FROM user_known_words')) {
        return new Response(JSON.stringify({
          results: [{
            type: 'ok',
            response: {
              type: 'execute',
              result: {
                cols: [{ name: 'word' }, { name: 'status' }],
                rows: [
                  [{ type: 'text', value: 'もう' }, { type: 'text', value: 'known' }],
                  [{ type: 'text', value: 'まっすぐ' }, { type: 'text', value: 'learning' }],
                ],
              },
            },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (sql.includes('FROM grammar_reviews')) {
        return new Response(JSON.stringify({
          results: [{
            type: 'ok',
            response: {
              type: 'execute',
              result: {
                cols: [{ name: 'point_id' }, { name: 'mastery_level' }, { name: 'consecutive_correct' }],
                rows: [
                  [{ type: 'text', value: 'てみる' }, { type: 'integer', value: '100' }, { type: 'integer', value: '3' }],
                ],
              },
            },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (sql.includes('INSERT INTO grammar_reviews')) {
        tursoWrites.push(sql);
      }
      return new Response(JSON.stringify({
        results: [{ type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 1 } } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('render.example.invalid/api/vocab/inventory')) {
      return new Response(JSON.stringify({
        items: [
          { expression: 'もう', state: 'unseen' },
          { expression: 'まっすぐ', state: 'unseen' },
          { expression: 'あまり', state: 'unseen' },
        ],
        total: 3,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('render.example.invalid/api/grammar/points')) {
      return new Response(JSON.stringify({
        points: [
          { pattern_key: 'てみる', status: 'new', mastery_score: 0, drill_count: 0 },
          { pattern_key: 'ながら', status: 'new', mastery_score: 0, drill_count: 0 },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    // S22: /api/vocab/inventory overlays user_known_words
    const invRes = await workerApp.fetch(new Request('https://kiroku.example/api/vocab/inventory?limit=50', {
      headers: { Authorization: `Bearer ${token}` },
    }), env);
    assert.equal(invRes.status, 200);
    const invData = await invRes.json();
    const byExpr = Object.fromEntries(invData.items.map(i => [i.expression, i.state]));
    assert.equal(byExpr['もう'], 'known');
    assert.equal(byExpr['まっすぐ'], 'learning');
    assert.equal(byExpr['あまり'], 'unseen');

    // S23: /api/grammar/points overlays grammar_reviews & PATCH writes to Turso
    const gRes = await workerApp.fetch(new Request('https://kiroku.example/api/grammar/points', {
      headers: { Authorization: `Bearer ${token}` },
    }), env);
    assert.equal(gRes.status, 200);
    const gData = await gRes.json();
    const gp = gData.points.find(p => p.pattern_key === 'てみる');
    assert.equal(gp.status, 'mastered');
    assert.equal(gp.drill_count, 3);

    const patchRes = await workerApp.fetch(new Request('https://kiroku.example/api/grammar/points/%E3%81%AA%E3%81%8C%E3%82%89', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'known', mastery_score: 1.0, drill_count: 2 }),
    }), env);
    assert.equal(patchRes.status, 200);
    assert.ok(tursoWrites.length >= 1, 'PATCH /api/grammar/points/:key should upsert grammar_reviews in Turso');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
