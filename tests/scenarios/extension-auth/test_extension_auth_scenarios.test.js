import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

describe('extension-auth hardening scenario suite', () => {
  let mockStorage = {};
  let sentMessages = [];
  let openedTabs = [];
  let onMessageListeners = [];
  let fetchCalls = [];
  let backgroundListener = null;
  let bgModule = null;

  function createMockChrome() {
    return {
      storage: {
        local: {
          get: async (keys) => {
            if (typeof keys === 'string') {
              return { [keys]: mockStorage[keys] };
            }
            if (Array.isArray(keys)) {
              const res = {};
              for (const k of keys) res[k] = mockStorage[k];
              return res;
            }
            return { ...mockStorage };
          },
          set: async (obj) => {
            Object.assign(mockStorage, obj);
          },
          remove: async (keys) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            for (const k of arr) delete mockStorage[k];
          }
        }
      },
      runtime: {
        getURL: (file) => `chrome-extension://test-ext-id/${file}`,
        sendMessage: async (msg) => {
          sentMessages.push(msg);
          return { ok: true };
        },
        onMessage: {
          addListener: (fn) => {
            onMessageListeners.push(fn);
            backgroundListener = fn;
          }
        },
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} }
      },
      tabs: {
        create: (opts) => {
          openedTabs.push(opts);
        },
        query: async () => [],
        sendMessage: async () => {}
      },
      identity: {
        getRedirectURL: (path) => `https://test-ext-id.chromiumapp.org/${path}`,
        launchWebAuthFlow: (opts, cb) => {
          cb(null);
        }
      },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
      commands: { onCommand: { addListener: () => {} } },
      action: { onClicked: { addListener: () => {} } }
    };
  }

  function runAuthJs(searchString, mockFetch) {
    const authCode = fs.readFileSync(path.resolve('extension/auth.js'), 'utf-8');
    const domElements = {
      'spinner': { style: { display: '' } },
      'status-title': { textContent: '', className: '' },
      'status-detail': { textContent: '' }
    };

    const windowMock = {
      location: {
        search: searchString
      },
      close: () => {}
    };

    const documentMock = {
      getElementById: (id) => domElements[id] || null
    };

    const sandbox = {
      window: windowMock,
      document: documentMock,
      chrome: globalThis.chrome,
      fetch: mockFetch,
      URLSearchParams,
      console,
      setTimeout,
      clearTimeout
    };

    vm.createContext(sandbox);
    return {
      run: () => vm.runInContext(authCode, sandbox),
      domElements
    };
  }

  before(async () => {
    globalThis.chrome = createMockChrome();
    bgModule = await import('../../../extension/background.js');
  });

  beforeEach(() => {
    mockStorage = {};
    sentMessages = [];
    openedTabs = [];
    fetchCalls = [];
  });

  it('S01: OAuth code exchange session persistence', async () => {
    mockStorage['kiroku_oauth_state'] = 'state_valid_123';

    const mockFetch = async (url, opts = {}) => {
      fetchCalls.push({ url: String(url), opts });
      if (String(url).endsWith('/auth/exchange')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            token: 'jwt_token_sample_abc',
            user: { sub: 'user_123', email: 'learner@example.com', role: 'learner' }
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const { run } = runAuthJs('?code=code_test_xyz&state=state_valid_123', mockFetch);
    await run();
    // Allow async microtasks in auth.js IIFE to settle
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(mockStorage['kiroku_auth_token'], 'jwt_token_sample_abc');
    assert.equal(mockStorage['kiroku.cloud.auth_token'], 'jwt_token_sample_abc');
    assert.equal(mockStorage['kiroku_cloud_token'], 'jwt_token_sample_abc');
    assert.equal(mockStorage['kiroku.extension.session_token'], 'jwt_token_sample_abc');
    assert.equal(mockStorage['kiroku.extension.auth_token'], 'jwt_token_sample_abc');
    assert.deepEqual(mockStorage['kiroku_auth_session'], {
      sub: 'user_123',
      email: 'learner@example.com',
      role: 'learner'
    });

    const authChanged = sentMessages.find((m) => m.type === 'CLOUD_AUTH_CHANGED');
    assert.ok(authChanged, 'CLOUD_AUTH_CHANGED message must be broadcast');
    assert.equal(authChanged.authenticated, true);
    assert.equal(authChanged.user.email, 'learner@example.com');
  });

  it('S02: CSRF state parameter mismatch rejection', async () => {
    mockStorage['kiroku_oauth_state'] = 'expected_state_abc';

    let exchangeCalled = false;
    const mockFetch = async (url) => {
      if (String(url).endsWith('/auth/exchange')) exchangeCalled = true;
      return { ok: true, json: async () => ({}) };
    };

    const { run, domElements } = runAuthJs('?code=code_123&state=tampered_state_xyz', mockFetch);
    await run();
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(exchangeCalled, false, 'Exchange must NOT be called on state mismatch');
    assert.equal(mockStorage['kiroku_auth_token'], undefined);
    assert.ok(
      domElements['status-detail'].textContent.includes('CSRF') ||
      domElements['status-detail'].textContent.includes('State parameter mismatch'),
      'CSRF mismatch error must be displayed'
    );
  });

  it('S03: Missing CSRF state rejection when state expected', async () => {
    mockStorage['kiroku_oauth_state'] = 'required_state_abc';

    let exchangeCalled = false;
    const mockFetch = async (url) => {
      if (String(url).endsWith('/auth/exchange')) exchangeCalled = true;
      return { ok: true, json: async () => ({}) };
    };

    const { run, domElements } = runAuthJs('?code=code_123', mockFetch);
    await run();
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(exchangeCalled, false, 'Exchange must NOT proceed when expected state is missing');
    assert.equal(mockStorage['kiroku_auth_token'], undefined);
    assert.ok(
      domElements['status-detail'].textContent.includes('CSRF') ||
      domElements['status-detail'].textContent.includes('State') ||
      domElements['status-detail'].textContent.includes('mismatch'),
      'Missing state error must be indicated'
    );
  });

  it('S04: One-time CSRF state consumption', async () => {
    mockStorage['kiroku_oauth_state'] = 'single_use_state_999';

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, token: 't1', user: { sub: 'u1' } })
    });

    const { run } = runAuthJs('?code=code_999&state=single_use_state_999', mockFetch);
    await run();
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(mockStorage['kiroku_oauth_state'], undefined, 'State must be purged after verification');
  });

  it('S05: OAuth error callback handling', async () => {
    const mockFetch = async () => ({ ok: false });

    const { run, domElements } = runAuthJs('?error=access_denied&error_description=User+cancelled', mockFetch);
    await run();
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(domElements['spinner'].style.display, 'none');
    assert.equal(domElements['status-title'].textContent, 'Sign-In Failed');
    assert.ok(domElements['status-detail'].textContent.includes('access_denied'));
    assert.equal(mockStorage['kiroku_auth_token'], undefined);
  });

  it('S06: Token retrieval across multiple canonical storage keys', async () => {
    // Dynamically require background
    const bg = bgModule;

    const testKeys = [
      'kiroku_auth_token',
      'kiroku.cloud.auth_token',
      'kiroku_cloud_token',
      'kiroku.extension.session_token',
      'kiroku.extension.auth_token',
      'kiroku.extension.remembered_token'
    ];

    for (const key of testKeys) {
      mockStorage = { [key]: `token_for_${key}` };
      const token = await bg.getStoredCloudToken();
      assert.equal(token, `token_for_${key}`, `Should resolve token from key ${key}`);
    }

    mockStorage = { kiroku_auth_session: { token: 'session_obj_token' } };
    const sessionToken = await bg.getStoredCloudToken();
    assert.equal(sessionToken, 'session_obj_token', 'Should resolve token inside kiroku_auth_session');
  });

  it('S07: Stored session status query', async () => {
    assert.ok(backgroundListener, 'onMessage listener should be registered');
    const listener = backgroundListener;

    // Case 1: unauthenticated
    mockStorage = {};
    let response1 = null;
    await listener({ type: 'GET_CLOUD_AUTH_STATUS' }, {}, (res) => { response1 = res; });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(response1?.ok, true);
    assert.equal(response1?.authenticated, false);
    assert.equal(response1?.user, null);

    // Case 2: authenticated
    mockStorage = {
      kiroku_auth_token: 'valid_jwt_token',
      kiroku_auth_session: { sub: 'u2', email: 'test@kiroku.app' }
    };
    let response2 = null;
    await listener({ type: 'GET_CLOUD_AUTH_STATUS' }, {}, (res) => { response2 = res; });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(response2?.ok, true);
    assert.equal(response2?.authenticated, true);
    assert.equal(response2?.user?.email, 'test@kiroku.app');
    assert.equal(response2?.token, 'valid_jwt_token');
  });

  it('S08: Expired token detection and fail-closed cleanup', async () => {
    assert.ok(backgroundListener, 'onMessage listener should be registered');
    const listener = backgroundListener;

    mockStorage = {
      kiroku_auth_token: 'expired_jwt_token',
      'kiroku.cloud.auth_token': 'expired_jwt_token',
      kiroku_auth_session: { sub: 'u3' }
    };

    // Global fetch mock returning 401 Unauthorized for /auth/me
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/auth/me')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'Token expired' })
        };
      }
      return { ok: false, status: 404 };
    };

    let response = null;
    await listener({ type: 'VALIDATE_CLOUD_AUTH' }, {}, (res) => { response = res; });
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(response?.ok, true);
    assert.equal(response?.authenticated, false);
    assert.equal(mockStorage['kiroku_auth_token'], undefined, 'Expired token must be purged');
    assert.equal(mockStorage['kiroku_auth_session'], undefined, 'Expired session must be purged');

    const authChanged = sentMessages.find((m) => m.type === 'CLOUD_AUTH_CHANGED');
    assert.ok(authChanged, 'CLOUD_AUTH_CHANGED must broadcast unauthenticated state');
    assert.equal(authChanged.authenticated, false);
  });

  it('S09: Logout lifecycle', async () => {
    assert.ok(backgroundListener, 'onMessage listener should be registered');
    const listener = backgroundListener;

    mockStorage = {
      kiroku_auth_token: 'token_to_logout',
      'kiroku.cloud.auth_token': 'token_to_logout',
      'kiroku_cloud_token': 'token_to_logout',
      'kiroku.extension.session_token': 'token_to_logout',
      'kiroku.extension.auth_token': 'token_to_logout',
      kiroku_auth_session: { sub: 'u_out' }
    };

    let serverLogoutCalled = false;
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url).endsWith('/auth/logout')) {
        serverLogoutCalled = true;
        assert.equal(opts.headers?.['Authorization'], 'Bearer token_to_logout');
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: false, status: 404 };
    };

    let response = null;
    await listener({ type: 'CLOUD_LOGOUT' }, {}, (res) => { response = res; });
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(response?.ok, true);
    assert.equal(serverLogoutCalled, true, 'Server logout endpoint must be called');
    assert.equal(mockStorage['kiroku_auth_token'], undefined);
    assert.equal(mockStorage['kiroku.cloud.auth_token'], undefined);
    assert.equal(mockStorage['kiroku_auth_session'], undefined);

    const authChanged = sentMessages.find((m) => m.type === 'CLOUD_AUTH_CHANGED');
    assert.ok(authChanged, 'CLOUD_AUTH_CHANGED must broadcast on logout');
    assert.equal(authChanged.authenticated, false);
  });

  it('S10: OAuth initiation generates and persists CSRF state', async () => {
    assert.ok(backgroundListener, 'onMessage listener should be registered');
    const listener = backgroundListener;

    let response = null;
    await listener({ type: 'CLOUD_LOGIN_GOOGLE' }, {}, (res) => { response = res; });
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(response?.ok, true);
    assert.ok(mockStorage['kiroku_oauth_state'], 'OAuth state must be generated and stored');
    assert.ok(openedTabs.length > 0, 'Tab must be created for login flow');
    const openedUrl = openedTabs[0].url;
    assert.ok(openedUrl.includes('/auth/google'), 'URL must target provider');
    assert.ok(openedUrl.includes(`state=${encodeURIComponent(mockStorage['kiroku_oauth_state'])}`), 'URL must include generated state parameter');
  });

  it('S11: Exchange network failure aborts cleanly', async () => {
    mockStorage['kiroku_oauth_state'] = 'state_err';

    const mockFetch = async (url) => {
      if (String(url).endsWith('/auth/exchange')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'Internal Server Error' })
        };
      }
      return { ok: false, status: 404 };
    };

    const { run, domElements } = runAuthJs('?code=code_err&state=state_err', mockFetch);
    await run();
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(mockStorage['kiroku_auth_token'], undefined, 'No token should be stored on network failure');
    assert.ok(domElements['status-detail'].textContent.includes('500') || domElements['status-detail'].textContent.includes('failed'));
  });

  it('S13: Direct token parameter validation fail-closed', async () => {
    const mockFetch = async (url) => {
      if (String(url).endsWith('/auth/me')) {
        return { ok: false, status: 401, json: async () => ({ error: 'Invalid token' }) };
      }
      return { ok: false, status: 404 };
    };

    const { run, domElements } = runAuthJs('?token=bogus_unverified_token', mockFetch);
    await run();
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(mockStorage['kiroku_auth_token'], undefined, 'Bogus direct token must not be saved');
    assert.ok(domElements['status-detail'].textContent.includes('failed validation'));
  });

  it('S12: Sidepanel module modularity invariant', async () => {
    const sidepanelMonolithPath = path.resolve('extension/sidepanel.js');
    assert.equal(fs.existsSync(sidepanelMonolithPath), false, 'Monolith sidepanel.js must NEVER exist');

    const modulesDir = path.resolve('extension/sidepanel/modules');
    const files = fs.readdirSync(modulesDir).filter((f) => f.endsWith('.js'));
    assert.ok(files.length >= 10, `Sidepanel modules must remain separate files (found ${files.length})`);
    assert.ok(files.includes('core.js'), 'core.js must exist');
    assert.ok(files.includes('layout.js'), 'layout.js must exist');
    assert.ok(files.includes('messaging.js'), 'messaging.js must exist');
  });
});
