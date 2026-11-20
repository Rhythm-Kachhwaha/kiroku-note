import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../../../worker/index.js';
import {
  authApp,
  signJwt,
  verifyJwt,
  authenticateRequest,
  getUserToken,
  verifyUserToken,
  regenerateUserToken,
  storeAuthCode,
  consumeAuthCode,
  isAllowedOrigin,
  isAllowedRedirect,
  _resetTokensForTest
} from '../../../worker/auth.js';

describe('cloud-auth hardening scenario suite', () => {
  const DEV_SECRET = 'kiroku-edge-development-secret-change-in-production';
  const PROD_SECRET = 'production-super-secret-key-at-least-32-chars-long';

  beforeEach(() => {
    _resetTokensForTest();
  });

  it('S01: Guest login session issuance', async () => {
    const res = await app.request('/auth/guest', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(data.token, 'Token must be issued');
    assert.equal(data.user.role, 'guest');
    assert.ok(data.user.sub.startsWith('guest_'));

    const setCookie = res.headers.get('Set-Cookie') || '';
    assert.ok(setCookie.includes('session='), 'Cookie must set session');
    assert.ok(setCookie.includes('Max-Age='), 'Cookie must specify Max-Age');
    assert.ok(setCookie.includes('HttpOnly'), 'Cookie must be HttpOnly');
  });

  it('S02: Multi-credential authentication', async () => {
    const token = await signJwt({ sub: 'user_multi_1', role: 'learner' }, DEV_SECRET);
    const shortcutToken = await getUserToken('user_multi_2');

    // 1. Session Cookie
    const resCookie = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Cookie': `session=${token}` }
    });
    assert.equal(resCookie.status, 200);
    const dataCookie = await resCookie.json();
    assert.equal(dataCookie.authenticated, true);
    assert.equal(dataCookie.user.sub, 'user_multi_1');
    assert.equal(dataCookie.source, 'cookie');

    // 2. Bearer JWT
    const resBearerJwt = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.equal(resBearerJwt.status, 200);
    const dataBearerJwt = await resBearerJwt.json();
    assert.equal(dataBearerJwt.authenticated, true);
    assert.equal(dataBearerJwt.source, 'bearer_jwt');

    // 3. Bearer shortcut token
    const resShortcut = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${shortcutToken}` }
    });
    assert.equal(resShortcut.status, 200);
    const dataShortcut = await resShortcut.json();
    assert.equal(dataShortcut.authenticated, true);
    assert.equal(dataShortcut.source, 'shortcut_token');
    assert.equal(dataShortcut.user.sub, 'user_multi_2');

    // 4. Unauthenticated
    const resUnauth = await app.request('/auth/me', { method: 'GET' });
    assert.equal(resUnauth.status, 401);
    const dataUnauth = await resUnauth.json();
    assert.equal(dataUnauth.authenticated, false);
  });

  it('S03: Expired JWT rejection', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiredToken = await signJwt({
      sub: 'user_expired',
      role: 'learner',
      exp: nowSec - 60
    }, DEV_SECRET);

    // Verify raw verifyJwt rejects
    const verified = await verifyJwt(expiredToken, DEV_SECRET);
    assert.equal(verified, null, 'verifyJwt must return null for expired token');

    // Verify /auth/me rejects with 401
    const res = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${expiredToken}` }
    });
    assert.equal(res.status, 401);
  });

  it('S04: Tampered JWT and dev secret rejection in production', async () => {
    const validToken = await signJwt({ sub: 'user_prod_1', exp: Math.floor(Date.now() / 1000) + 3600 }, PROD_SECRET);
    const parts = validToken.split('.');
    const tamperedToken = `${parts[0]}.${parts[1]}.invalidsignature123`;

    const prodEnv = { ENVIRONMENT: 'production', JWT_SECRET: PROD_SECRET };

    // Tampered token rejected
    const resTampered = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tamperedToken}` }
    }, prodEnv);
    assert.equal(resTampered.status, 401);

    // Token signed with dev default secret rejected when production secret is in use
    const devSignedToken = await signJwt({ sub: 'user_forged', exp: Math.floor(Date.now() / 1000) + 3600 }, DEV_SECRET);
    const resDevSecret = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${devSignedToken}` }
    }, prodEnv);
    assert.equal(resDevSecret.status, 401);

    // In production mode, if JWT_SECRET was configured as DEFAULT_JWT_SECRET, must be rejected
    const devSecretInProdEnv = { ENVIRONMENT: 'production', JWT_SECRET: DEV_SECRET };
    const resInsecureProd = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${devSignedToken}` }
    }, devSecretInProdEnv);
    assert.equal(resInsecureProd.status, 401);
  });

  it('S05: Production missing secret fails closed', async () => {
    const prodNoSecretEnv = { ENVIRONMENT: 'production' };
    const token = await signJwt({ sub: 'user_test', exp: Math.floor(Date.now() / 1000) + 3600 }, DEV_SECRET);

    // authenticateRequest without secret in production must fail closed
    const resAuth = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    }, prodNoSecretEnv);
    assert.equal(resAuth.status, 401);

    // Guest login in production without secret must fail closed with 500
    const resGuest = await app.request('/auth/guest', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    }, prodNoSecretEnv);
    assert.equal(resGuest.status, 500);
  });

  it('S06: Server-side token revocation', async () => {
    const token = await signJwt({ sub: 'user_revoke_test', exp: Math.floor(Date.now() / 1000) + 3600 }, DEV_SECRET);

    // 1. Initially valid
    const res1 = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.equal(res1.status, 200);

    // 2. Logout revokes token
    const resLogout = await app.request('/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.equal(resLogout.status, 200);

    // 3. Subsequent request immediately rejected
    const res2 = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.equal(res2.status, 401);
  });

  it('S07: OAuth CSRF state protection', async () => {
    const env = { GOOGLE_CLIENT_ID: 'mock-google-id', GOOGLE_CLIENT_SECRET: 'mock-google-sec' };

    // Missing state parameter
    const resNoState = await app.request('/auth/callback/google?code=valid_code', { method: 'GET' }, env);
    assert.equal(resNoState.status, 400);

    // State mismatch with cookie
    const resMismatch = await app.request('/auth/callback/google?code=valid_code&state=attack_state', {
      method: 'GET',
      headers: { 'Cookie': 'oauth_state=legit_state' }
    }, env);
    assert.equal(resMismatch.status, 400);

    // Missing cookie
    const resNoCookie = await app.request('/auth/callback/google?code=valid_code&state=legit_state', {
      method: 'GET'
    }, env);
    assert.equal(resNoCookie.status, 400);
  });

  it('S08: Auth code exchange lifecycle', async () => {
    // 1. Wrong state rejected and consumes attempt
    const codeWrong = 'krk_code_wrong_state_attempt';
    await storeAuthCode(codeWrong, {
      token: 'jwt_mock_token_1',
      sub: 'user_oauth_wrong',
      state: 'valid_state_nonce',
      expiresAt: Date.now() + 60000
    }, {});

    const resWrongState = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeWrong, state: 'attacker_forged_state' })
    });
    assert.equal(resWrongState.status, 400);

    // Replay of that code is rejected
    const resReplayWrong = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeWrong, state: 'valid_state_nonce' })
    });
    assert.equal(resReplayWrong.status, 400);

    // 2. Successful exchange with matching state
    const codeSuccess = 'krk_code_success_exchange';
    await storeAuthCode(codeSuccess, {
      token: 'jwt_secret_token_123',
      sub: 'user_exchange_target',
      email: 'user@example.com',
      name: 'Exchange User',
      state: 'desktop_flow_nonce_42',
      expiresAt: Date.now() + 60000
    }, {});

    const resSuccess = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeSuccess, state: 'desktop_flow_nonce_42' })
    });
    assert.equal(resSuccess.status, 200);
    const dataSuccess = await resSuccess.json();
    assert.equal(dataSuccess.token, 'jwt_secret_token_123');
    assert.equal(dataSuccess.user.sub, 'user_exchange_target');

    // 3. Single-use enforcement: repeat exchange fails with 400
    const resRepeat = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeSuccess, state: 'desktop_flow_nonce_42' })
    });
    assert.equal(resRepeat.status, 400);

    // 4. Expired code fails
    const expiredCode = 'krk_code_expired_1';
    await storeAuthCode(expiredCode, {
      token: 'jwt_expired',
      sub: 'user_exp',
      expiresAt: Date.now() - 5000
    }, {});
    const resExp = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: expiredCode })
    });
    assert.equal(resExp.status, 400);
  });

  it('S09: Redirect URI allowlist enforcement', () => {
    // Malicious open redirects
    assert.equal(isAllowedRedirect('https://evil.com/callback'), false);
    assert.equal(isAllowedRedirect('http://attacker.com:3000/auth/callback'), false);
    assert.equal(isAllowedRedirect('javascript:alert(1)'), false);
    assert.equal(isAllowedRedirect('data:text/html,hack'), false);

    // Valid desktop loopback
    assert.equal(isAllowedRedirect('http://localhost:3000/auth/callback'), true);
    assert.equal(isAllowedRedirect('http://127.0.0.1:21828/auth/callback'), true);
    assert.equal(isAllowedRedirect('http://localhost/auth/callback'), true);

    // Valid Chrome extension
    assert.equal(isAllowedRedirect('chrome-extension://chnnchfpjephcpgamfkjnfobfnjabika/auth.html'), true);
    // Extension with invalid pathname
    assert.equal(isAllowedRedirect('chrome-extension://chnnchfpjephcpgamfkjnfobfnjabika/evil.js'), false);
    // Unknown extension id
    assert.equal(isAllowedRedirect('chrome-extension://unknownextension123456789012345/auth.html'), false);
  });

  it('S10: CORS origin validation with credentials', async () => {
    // Malicious untrusted origin requesting /auth/me
    const resDisallowed = await app.request('/auth/me', {
      method: 'GET',
      headers: {
        'Origin': 'https://evil.attacker.com',
        'Cookie': 'session=test'
      }
    });

    const allowOrigin = resDisallowed.headers.get('Access-Control-Allow-Origin');
    const allowCreds = resDisallowed.headers.get('Access-Control-Allow-Credentials');

    // A credentialed request must NEVER reflect an untrusted origin
    assert.ok(
      allowOrigin !== 'https://evil.attacker.com' || allowCreds !== 'true',
      'Untrusted origin must not receive credentialed CORS reflection'
    );

    // Trusted origin receives CORS header
    const resAllowed = await app.request('/auth/me', {
      method: 'GET',
      headers: {
        'Origin': 'http://localhost:3000',
        'Cookie': 'session=test'
      }
    });
    assert.equal(resAllowed.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
    assert.equal(resAllowed.headers.get('Access-Control-Allow-Credentials'), 'true');
  });

  it('S11: Guest forbidden from shortcut token generation', async () => {
    const guestToken = await signJwt({
      sub: 'guest_12345',
      role: 'guest',
      provider: 'guest',
      exp: Math.floor(Date.now() / 1000) + 3600
    }, DEV_SECRET);

    // GET /api/user/token with guest session
    const resGet = await app.request('/api/user/token', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${guestToken}` }
    });
    assert.equal(resGet.status, 403);
    const dataGet = await resGet.json();
    assert.equal(dataGet.error, 'Forbidden');

    // POST /api/user/token/regenerate with guest session
    const resRegen = await app.request('/api/user/token/regenerate', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${guestToken}` }
    });
    assert.equal(resRegen.status, 403);
  });

  it('S12: Shortcut token regeneration invalidation', async () => {
    const userId = 'user_regen_test_1';
    const initialToken = await getUserToken(userId);
    assert.ok(initialToken && initialToken.startsWith('krk_live_'));

    // Authenticate with user session and regenerate token
    const userJwt = await signJwt({ sub: userId, role: 'learner' }, DEV_SECRET);
    const resRegen = await app.request('/api/user/token/regenerate', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userJwt}` }
    });
    assert.equal(resRegen.status, 200);
    const dataRegen = await resRegen.json();
    const newToken = dataRegen.token;
    assert.notEqual(newToken, initialToken);

    // Previous token immediately rejected
    const resOld = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${initialToken}` }
    });
    assert.equal(resOld.status, 401);

    // New token accepted
    const resNew = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${newToken}` }
    });
    assert.equal(resNew.status, 200);
  });

  it('S13: Service credential isolation', async () => {
    const env = { CLOUD_QUEUE_API_KEY: 'test-service-key-999' };

    // Service key authenticates with service role
    const resMe = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer test-service-key-999' }
    }, env);
    assert.equal(resMe.status, 200);
    const dataMe = await resMe.json();
    assert.equal(dataMe.user.role, 'service');
    assert.equal(dataMe.user.is_service, true);

    // Service key cannot generate personal user shortcut token
    const resToken = await app.request('/api/user/token', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer test-service-key-999' }
    }, env);
    assert.ok([401, 403].includes(resToken.status));
  });

  it('S14: Rate limiting on auth endpoints', async () => {
    const ip = '192.168.1.100';
    let limitedRes = null;

    // Burst 35 requests to /auth/guest to exceed capacity (30)
    for (let i = 0; i < 35; i++) {
      const res = await app.request('/auth/guest', {
        method: 'GET',
        headers: {
          'cf-connecting-ip': ip,
          'Accept': 'application/json'
        }
      });
      if (res.status === 429) {
        limitedRes = res;
        break;
      }
    }

    assert.ok(limitedRes, 'Request burst must hit rate limit (status 429)');
    assert.equal(limitedRes.status, 429);
    assert.ok(limitedRes.headers.get('Retry-After'), '429 must include Retry-After header');
  });

  it('S15: Future-dated JWT nbf claim rejection', async () => {
    const now = Math.floor(Date.now() / 1000);
    const futureToken = await signJwt({
      sub: 'user_future_nbf',
      nbf: now + 86400,
      exp: now + 90000
    }, DEV_SECRET);

    const verified = await verifyJwt(futureToken, DEV_SECRET);
    assert.equal(verified, null, 'verifyJwt must reject future-dated nbf claim');

    const res = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${futureToken}` }
    });
    assert.equal(res.status, 401);
  });

  it('S16: Production mode fails closed when JWT_SECRET matches DEFAULT_JWT_SECRET', async () => {
    const res = await app.request('/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      ENVIRONMENT: 'production',
      JWT_SECRET: DEV_SECRET
    });
    assert.equal(res.status, 500);
  });

  it('S17: Auth exchange code 60-second expiration enforcement', async () => {
    const code = 'krk_code_test_expiration_60s';
    await storeAuthCode(code, {
      token: 'jwt_valid_token_123',
      sub: 'user_target_456'
    }, {});

    // Fast-forward time past 60s
    const origNow = Date.now;
    Date.now = () => origNow() + 65 * 1000;

    try {
      const res = await app.request('/auth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      assert.equal(res.status, 400, 'Expired code after 60s must fail with 400');
    } finally {
      Date.now = origNow;
    }
  });
});
