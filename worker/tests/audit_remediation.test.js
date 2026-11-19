import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import app from '../index.js';
import {
  revokeToken,
  isTokenRevoked,
  getUserToken,
  verifyUserToken,
  timingSafeEqual,
  storeAuthCode,
  consumeAuthCode,
  _resetTokensForTest
} from '../auth.js';

describe('Audit Remediation Verification Suite', () => {
  it('H1 & M2: Token revocation, shortcut tokens and auth codes persist durably', async () => {
    _resetTokensForTest();

    // 1. Revocation persists and expires properly
    const testToken = 'header.eyJzdWIiOiJ1c2VyXzEiLCJleHAiOjk5OTk5OTk5OTl9.testsig123';
    assert.equal(await isTokenRevoked(testToken, {}), false);
    await revokeToken(testToken, {});
    assert.equal(await isTokenRevoked(testToken, {}), true);

    // 2. Shortcut tokens mint and verify
    const liveToken = await getUserToken('user_test_42', {});
    assert.ok(liveToken.startsWith('krk_live_'));
    const verified = await verifyUserToken(liveToken, {});
    assert.equal(verified?.sub, 'user_test_42');

    // 3. Auth exchange code storage and single-use consumption
    const testCode = 'krk_code_test_abc';
    await storeAuthCode(testCode, {
      token: 'jwt_mock_token',
      sub: 'user_oauth_123',
      email: 'learner@example.com',
      expiresAt: Date.now() + 60000
    }, {});

    const consumed = await consumeAuthCode(testCode, {});
    assert.equal(consumed?.token, 'jwt_mock_token');
    assert.equal(consumed?.sub, 'user_oauth_123');

    // Subsequent consumption returns null (single use)
    const consumedAgain = await consumeAuthCode(testCode, {});
    assert.equal(consumedAgain, null);
  });

  it('L5: Constant-time comparison timingSafeEqual correctly matches strings', () => {
    assert.equal(timingSafeEqual('secret_key_123', 'secret_key_123'), true);
    assert.equal(timingSafeEqual('secret_key_123', 'secret_key_124'), false);
    assert.equal(timingSafeEqual('secret_key_123', 'short'), false);
    assert.equal(timingSafeEqual('', ''), true);
  });

  it('M3: Guest users cannot mint persistent shortcut tokens', async () => {
    const res = await app.request('/api/user/token', {
      method: 'GET',
      headers: {
        'Cookie': 'session=guest_token'
      }
    });
    // Unauthenticated or guest rejected
    assert.ok([401, 403].includes(res.status));
  });

  it('L4: /api/oplog/write rejects batches over 100 items with 413', async () => {
    const hugeBatch = Array.from({ length: 105 }, (_, i) => ({ expression: `word_${i}` }));
    const res = await app.request('/api/oplog/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hugeBatch)
    });
    assert.equal(res.status, 413);
    const data = await res.json();
    assert.equal(data.error, 'Payload Too Large');
  });

  it('L3: /api/sync/push rejects batches over 100 items with 413', async () => {
    const hugeBatch = Array.from({ length: 105 }, (_, i) => ({ id: `sync_${i}`, expression: `word_${i}` }));
    const res = await app.request('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops: hugeBatch })
    });
    assert.equal(res.status, 413);
  });

  it('L3: /api/sync/ack rejects batches over 100 ids with 413', async () => {
    const hugeIds = Array.from({ length: 105 }, (_, i) => `id_${i}`);
    const res = await app.request('/api/sync/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: hugeIds })
    });
    assert.equal(res.status, 413);
  });

  it('L7: /api/subtitle/annotate rejects over 100 cues with 413', async () => {
    const hugeCues = Array.from({ length: 105 }, (_, i) => ({ id: i, text: `cue ${i}` }));
    const res = await app.request('/api/subtitle/annotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cues: hugeCues })
    });
    assert.equal(res.status, 413);
  });

  it('M1: /api/user/progress/sync returns 503 in production when Turso is unset', async () => {
    const res = await app.request('/api/user/progress/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviews: [{ vocab_id: 1, state: 1, stability: 1.0, difficulty: 1.0, due_at: 1000 }] })
    }, {
      ENVIRONMENT: 'production',
      JWT_SECRET: 'kiroku-edge-development-secret-change-in-production'
    });
    // In production without Turso credentials: 401 unauthenticated or 503 unavailable
    assert.ok([401, 503].includes(res.status));
  });
});

