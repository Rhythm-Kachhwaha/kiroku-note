import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../index.js';
import { signJwt } from '../auth.js';

describe('Worker Render Proxy Cookie-to-Bearer Auth', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('promotes valid session cookie to Authorization Bearer when proxying /api/* to Render', async () => {
    const secret = 'test-jwt-secret-1234567890abcdef';
    const validJwt = await signJwt({ sub: 'user_cookie_1', name: 'Rhythm', email: 'r@example.com' }, secret);

    let forwardedAuth = null;
    globalThis.fetch = async (url, init) => {
      forwardedAuth = init.headers.get('Authorization');
      return new Response(JSON.stringify([{ series: 'Frieren' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const req = new Request('https://kiroku-note.rhythmkach.workers.dev/api/link/series', {
      headers: {
        'Cookie': `session=${validJwt}`,
      },
    });

    const res = await app.fetch(req, {
      ENVIRONMENT: 'production',
      JWT_SECRET: secret,
      RENDER_BACKEND_URL: 'https://render-mock.example.com',
    });

    assert.equal(res.status, 200);
    assert.equal(forwardedAuth, `Bearer ${validJwt}`);
  });

  it('retries with valid session cookie if Render returns 401 for stale Bearer token', async () => {
    const secret = 'test-jwt-secret-1234567890abcdef';
    const now = Math.floor(Date.now() / 1000);
    const expiredJwt = await signJwt({ sub: 'user_cookie_1', exp: now - 3600 }, secret);
    const freshJwt = await signJwt({ sub: 'user_cookie_1', exp: now + 3600 }, secret);

    const seenAuths = [];
    globalThis.fetch = async (url, init) => {
      const auth = init.headers.get('Authorization');
      seenAuths.push(auth);
      if (auth === `Bearer ${expiredJwt}`) {
        return new Response(JSON.stringify({ detail: 'Invalid, expired, or tampered JWT token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([{ series: 'Frieren' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const req = new Request('https://kiroku-note.rhythmkach.workers.dev/api/link/series', {
      headers: {
        'Authorization': `Bearer ${expiredJwt}`,
        'Cookie': `session=${freshJwt}`,
      },
    });

    const res = await app.fetch(req, {
      ENVIRONMENT: 'production',
      JWT_SECRET: secret,
      RENDER_BACKEND_URL: 'https://render-mock.example.com',
    });

    assert.equal(res.status, 200);
    assert.deepEqual(seenAuths, [`Bearer ${expiredJwt}`, `Bearer ${freshJwt}`]);
  });

  it('serves GET /api/link/series directly from Turso for cookie-authenticated web user without calling Render', async () => {
    const secret = 'test-jwt-secret-1234567890abcdef';
    const validJwt = await signJwt({ sub: 'user_turso_1', name: 'Rhythm', email: 'r@example.com' }, secret);

    let calledRender = false;
    globalThis.fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('render-mock.example.com')) {
        calledRender = true;
        return new Response('Should not hit Render', { status: 500 });
      }
      if (urlStr.includes('turso.io')) {
        const body = JSON.parse(init.body || '{}');
        const sql = body.requests?.[0]?.stmt?.sql || '';
        if (sql.includes('FROM user_anime_progress')) {
          return new Response(JSON.stringify({
            results: [{
              type: 'ok',
              response: {
                type: 'execute',
                result: {
                  rows: [[
                    { type: 'text', value: 'Frieren' },
                    { type: 'integer', value: '1' },
                    { type: 'integer', value: '60000' },
                    { type: 'integer', value: '1440000' },
                    { type: 'integer', value: '0' },
                    { type: 'integer', value: '2' },
                    { type: 'integer', value: '1795600000' },
                    { type: 'text', value: '' },
                    { type: 'text', value: 'Frieren' },
                    { type: 'text', value: '葬送のフリーレン' },
                    { type: 'text', value: 'Frieren' },
                    { type: 'text', value: '' },
                    { type: 'text', value: 'anime' },
                    { type: 'text', value: 'hash_frieren_1' },
                    { type: 'integer', value: '1' },
                    { type: 'float', value: 75.5 },
                    { type: 'text', value: 'Episode 1' },
                  ]]
                }
              }
            }]
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          results: [{ type: 'ok', response: { type: 'execute', result: { rows: [] } } }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${urlStr}`);
    };

    const req = new Request('https://kiroku-note.rhythmkach.workers.dev/api/link/series', {
      headers: {
        'Cookie': `session=${validJwt}`,
      },
    });

    const res = await app.fetch(req, {
      ENVIRONMENT: 'production',
      JWT_SECRET: secret,
      TURSO_DATABASE_URL: 'https://mock-db.turso.io',
      TURSO_AUTH_TOKEN: 'mock_turso_token',
      RENDER_BACKEND_URL: 'https://render-mock.example.com',
    });

    assert.equal(res.status, 200);
    assert.equal(calledRender, false);
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].series, 'Frieren');
    assert.equal(data[0].episodes[0].hash, 'hash_frieren_1');
  });
});
