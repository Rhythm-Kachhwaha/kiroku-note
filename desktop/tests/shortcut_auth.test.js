import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCryptoToken,
  getUserToken,
  regenerateUserToken,
  verifyUserToken,
  authenticateRequest,
  _resetTokensForTest,
  authApp
} from '../../worker/auth.js';

test('Shortcut Token: generates tokens with krk_live_ prefix and sufficient entropy', () => {
  const token1 = generateCryptoToken();
  const token2 = generateCryptoToken();
  assert.ok(token1.startsWith('krk_live_'), 'Token must start with krk_live_');
  assert.ok(token2.startsWith('krk_live_'), 'Token must start with krk_live_');
  assert.notEqual(token1, token2, 'Generated tokens must be distinct');
  assert.ok(token1.length >= 40, 'Token must have sufficient cryptographic length');
});

test('Shortcut Token: user token creation and verification lifecycle', async () => {
  _resetTokensForTest();
  const userId = 'user_test_123';

  // 1. Initial retrieval generates token
  const token = await getUserToken(userId);
  assert.ok(token && token.startsWith('krk_live_'));

  // 2. Subsequent retrieval returns same token
  const tokenAgain = await getUserToken(userId);
  assert.equal(token, tokenAgain);

  // 3. Verification succeeds
  const user = await verifyUserToken(token);
  assert.ok(user);
  assert.equal(user.sub, userId);

  // 4. Invalid token verification returns null
  const invalidUser = await verifyUserToken('krk_live_invalidtoken12345');
  assert.equal(invalidUser, null);
  const emptyUser = await verifyUserToken('');
  assert.equal(emptyUser, null);
});

test('Shortcut Token: regeneration invalidates previous token and creates new one', async () => {
  _resetTokensForTest();
  const userId = 'user_regen_456';

  const oldToken = await getUserToken(userId);
  assert.ok(oldToken);

  // Verify old token works before regeneration
  const beforeRegen = await verifyUserToken(oldToken);
  assert.ok(beforeRegen);
  assert.equal(beforeRegen.sub, userId);

  // Regenerate token
  const newToken = await regenerateUserToken(userId);
  assert.ok(newToken);
  assert.notEqual(newToken, oldToken);

  // Old token is immediately invalidated
  const afterRegenOld = await verifyUserToken(oldToken);
  assert.equal(afterRegenOld, null, 'Old token must be rejected after regeneration');

  // New token is valid
  const afterRegenNew = await verifyUserToken(newToken);
  assert.ok(afterRegenNew);
  assert.equal(afterRegenNew.sub, userId);
});

test('Shortcut Token: authenticateRequest recognizes Bearer krk_live_* tokens', async () => {
  _resetTokensForTest();
  const userId = 'user_auth_789';
  const token = await getUserToken(userId);

  // Request with valid bearer token
  const mockReqValid = {
    header: (name) => {
      if (name.toLowerCase() === 'authorization') return `Bearer ${token}`;
      return null;
    }
  };
  const mockContextValid = { req: mockReqValid, env: {} };
  const authValid = await authenticateRequest(mockContextValid);
  assert.equal(authValid.authenticated, true);
  assert.equal(authValid.source, 'shortcut_token');
  assert.equal(authValid.user.sub, userId);

  // Request with forged/invalid bearer token
  const mockReqInvalid = {
    header: (name) => {
      if (name.toLowerCase() === 'authorization') return 'Bearer krk_live_forged_99999999';
      return null;
    }
  };
  const mockContextInvalid = { req: mockReqInvalid, env: {} };
  const authInvalid = await authenticateRequest(mockContextInvalid);
  assert.equal(authInvalid.authenticated, false);
});

test('Shortcut Token: Hono endpoints /api/user/token and /api/user/token/regenerate', async () => {
  _resetTokensForTest();

  // Test with dev mode environment
  const env = { ENVIRONMENT: 'development' };

  // GET /api/user/token
  const resGet = await authApp.request('http://localhost/api/user/token', { method: 'GET' }, env);
  assert.equal(resGet.status, 200);
  const dataGet = await resGet.json();
  assert.ok(dataGet.token && dataGet.token.startsWith('krk_live_'));
  assert.equal(dataGet.user_id, 'dev_user');

  // POST /api/user/token/regenerate
  const resRegen = await authApp.request('http://localhost/api/user/token/regenerate', { method: 'POST' }, env);
  assert.equal(resRegen.status, 200);
  const dataRegen = await resRegen.json();
  assert.ok(dataRegen.token && dataRegen.token.startsWith('krk_live_'));
  assert.notEqual(dataRegen.token, dataGet.token);
  assert.equal(dataRegen.regenerated, true);
});

