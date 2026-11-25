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
});
