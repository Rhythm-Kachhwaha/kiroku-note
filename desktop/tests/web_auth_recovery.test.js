const test = require('node:test');
const assert = require('node:assert/strict');

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); },
  };
}

test('ApiClient refreshes token via /auth/me on 401 and retries on remote web', async () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;

  const events = [];
  globalThis.localStorage = createMockStorage({
    'kiroku:auth-user': JSON.stringify({ id: 'u1', name: 'Rhythm' }),
    'kiroku_auth_token': 'stale_or_missing',
  });
  globalThis.window = {
    location: {
      origin: 'https://kiroku-note.rhythmkach.workers.dev',
      protocol: 'https:',
      hostname: 'kiroku-note.rhythmkach.workers.dev',
      pathname: '/',
      search: '',
      hash: '',
    },
    dispatchEvent(evt) { events.push(evt); },
    CustomEvent: class CustomEvent {
      constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
    },
  };

  let callCount = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (url.endsWith('/auth/me')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          token: 'fresh_jwt_token',
          user: { id: 'u1', sub: 'u1', name: 'Rhythm' },
        }),
      };
    }
    if (url.endsWith('/api/link/series')) {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => ({ detail: 'Missing or malformed Bearer authorization token' }),
        };
      }
      assert.equal(init.headers['Authorization'], 'Bearer fresh_jwt_token');
      return {
        ok: true,
        status: 200,
        json: async () => [{ series: 'Frieren' }],
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const { ApiClient } = await import('../src/ui/services/api_client.js');
    const client = new ApiClient();
    const res = await client.request('/api/link/series');
    assert.deepEqual(res, [{ series: 'Frieren' }]);
    assert.equal(callCount, 2);
    assert.equal(globalThis.localStorage.getItem('kiroku_auth_token'), 'fresh_jwt_token');
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
  }
});

test('ApiClient clears stale cached user and dispatches auth-changed(null) when /auth/me also returns 401', async () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;

  const events = [];
  globalThis.localStorage = createMockStorage({
    'kiroku:auth-user': JSON.stringify({ id: 'u1', name: 'Rhythm' }),
    'kiroku_auth_token': 'expired_token',
  });
  globalThis.window = {
    location: {
      origin: 'https://kiroku-note.rhythmkach.workers.dev',
      protocol: 'https:',
      hostname: 'kiroku-note.rhythmkach.workers.dev',
      pathname: '/',
      search: '',
      hash: '',
    },
    dispatchEvent(evt) { events.push(evt); },
    CustomEvent: class CustomEvent {
      constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
    },
  };

  globalThis.fetch = async (url) => {
    return {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ detail: 'Invalid, expired, or tampered JWT token' }),
    };
  };

  try {
    const { ApiClient } = await import('../src/ui/services/api_client.js');
    const client = new ApiClient();
    await assert.rejects(() => client.request('/api/link/series'), (err) => err.status === 401);
    assert.equal(globalThis.localStorage.getItem('kiroku:auth-user'), null);
    assert.equal(globalThis.localStorage.getItem('kiroku_auth_token'), null);
    assert.ok(events.some(e => e.type === 'kiroku:auth-changed' && e.detail?.user === null));
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
  }
});
