import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('extension-cloud hardening scenario suite', async (t) => {
  let mockStorage = {};
  let sentMessages = [];
  let fetchCalls = [];
  let bgModule = null;
  let backgroundListener = null;

  function createMockChrome() {
    return {
      storage: {
        local: {
          get: async (keys) => {
            const clone = (v) => (v !== undefined ? JSON.parse(JSON.stringify(v)) : undefined);
            if (typeof keys === 'string') {
              return { [keys]: clone(mockStorage[keys]) };
            }
            if (Array.isArray(keys)) {
              const res = {};
              for (const k of keys) res[k] = clone(mockStorage[k]);
              return res;
            }
            const all = {};
            for (const k of Object.keys(mockStorage)) all[k] = clone(mockStorage[k]);
            return all;
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
            backgroundListener = fn;
          }
        },
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} }
      },
      tabs: {
        query: async () => [],
        sendMessage: async () => {}
      },
      alarms: {
        create: () => {},
        onAlarm: { addListener: () => {} }
      },
      commands: {
        onCommand: { addListener: () => {} }
      },
      action: {
        onClicked: { addListener: () => {} }
      }
    };
  }

  function dispatchMessage(msg) {
    return new Promise((resolve) => {
      backgroundListener(msg, {}, resolve);
    });
  }

  before(async () => {
    globalThis.chrome = createMockChrome();
    bgModule = await import('../../../extension/background.js');
  });

  beforeEach(() => {
    mockStorage = {};
    sentMessages = [];
    fetchCalls = [];
  });

  afterEach(() => {
    mockStorage = {};
    fetchCalls = [];
  });

  await t.test('S01: Three-tier save: local backend reachable', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, opts = {}) => {
        fetchCalls.push({ url: String(url), opts });
        if (String(url).includes('/api/cards/save')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'card_local_123', status: 'success' })
          };
        }
        return { ok: false, status: 500 };
      };

      const response = await dispatchMessage({
        type: 'HUD_MINE',
        card: { expression: '食べる', reading: 'たべる', meaning: 'to eat' }
      });

      assert.ok(response, 'HUD_MINE must respond');
      assert.equal(response.ok, true);
      assert.equal(response.sync_destination, 'local');
      assert.equal(response.card_id, 'card_local_123');

      const pending = mockStorage['kiroku_pending_cards'] || [];
      assert.equal(pending.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('S02: Three-tier save: local offline, cloud edge fallback', async () => {
    mockStorage['kiroku_auth_token'] = 'bearer_token_xyz';

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, opts = {}) => {
        fetchCalls.push({ url: String(url), opts });
        if (String(url).includes('127.0.0.1')) {
          throw new Error('ECONNREFUSED');
        }
        if (String(url).includes('/sync/push')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'ok', pushed: 1, ids: ['cloud_card_456'] })
          };
        }
        return { ok: false, status: 500 };
      };

      const response = await dispatchMessage({
        type: 'HUD_MINE',
        card: { expression: '本', meaning: 'book' }
      });

      assert.ok(response, 'HUD_MINE must respond');
      assert.equal(response.ok, true);
      assert.equal(response.sync_destination, 'cloud');
      assert.equal(response.card_id, 'cloud_card_456');

      const cloudCall = fetchCalls.find(c => c.url.includes('/sync/push'));
      assert.ok(cloudCall, 'Cloud /sync/push must be called');
      assert.equal(cloudCall.opts.headers['Authorization'], 'Bearer bearer_token_xyz');

      const pending = mockStorage['kiroku_pending_cards'] || [];
      assert.equal(pending.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('S03: Three-tier save: local and cloud offline, queues locally', async () => {
    mockStorage['kiroku_auth_token'] = 'bearer_token_xyz';

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, opts = {}) => {
        fetchCalls.push({ url: String(url), opts });
        throw new Error('Network offline');
      };

      const response = await dispatchMessage({
        type: 'HUD_MINE',
        card: { expression: '車', meaning: 'car' }
      });

      assert.ok(response, 'HUD_MINE must respond');
      assert.equal(response.ok, true);
      assert.equal(response.queued, true);
      assert.equal(response.sync_destination, 'queued');

      const pending = mockStorage['kiroku_pending_cards'];
      assert.ok(Array.isArray(pending));
      assert.equal(pending.length, 1);
      assert.equal(pending[0].payload.expression, '車');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('S04: Concurrency protection: withQueueLock serializes concurrent appends', async () => {
    mockStorage['kiroku_pending_cards'] = [];

    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(bgModule.queueCardLocally({ expression: `word_${i}` }));
    }

    const results = await Promise.all(promises);
    assert.ok(results.every(r => r === true), 'All 20 appends must return true');

    const pending = mockStorage['kiroku_pending_cards'];
    assert.equal(pending.length, 20, 'All 20 cards must be preserved without lost writes');
  });

  await t.test('S05: Queue capacity limit enforcement', async () => {
    const fullQueue = [];
    for (let i = 0; i < 1000; i++) {
      fullQueue.push({ id: `item_${i}`, payload: { expression: `item_${i}` }, timestamp: Date.now() });
    }
    mockStorage['kiroku_pending_cards'] = fullQueue;

    const added = await bgModule.queueCardLocally({ expression: 'overflow_card' });
    assert.equal(added, false, 'queueCardLocally must reject when capacity reaches 1000');

    const pending = mockStorage['kiroku_pending_cards'];
    assert.equal(pending.length, 1000, 'Queue size must remain capped at 1000');
    mockStorage['kiroku_pending_cards'] = [];
  });

  await t.test('S06: Queue drain: local backend online', async () => {
    mockStorage['kiroku_pending_cards'] = [
      { id: 'c1', queue_entry_id: 'qe1', payload: { expression: '猫' }, timestamp: Date.now() },
      { id: 'c2', queue_entry_id: 'qe2', payload: { expression: '犬' }, timestamp: Date.now() }
    ];

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url) => {
        fetchCalls.push({ url: String(url) });
        if (String(url).includes('/api/cards/save')) {
          return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
        }
        return { ok: false, status: 500 };
      };

      const drainedCount = await bgModule.drainPendingCardsQueue();
      assert.equal(drainedCount, 2);

      const pending = mockStorage['kiroku_pending_cards'];
      assert.equal(pending.length, 0, 'Drained items must be cleared from pending queue');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('S07: Queue drain: local backend offline, cloud online', async () => {
    mockStorage['kiroku_auth_token'] = 'drain_cloud_token_123';
    mockStorage['kiroku_pending_cards'] = [
      { id: 'c1', queue_entry_id: 'qe1', payload: { expression: '鳥' }, timestamp: Date.now() },
      { id: 'c2', queue_entry_id: 'qe2', payload: { expression: '魚' }, timestamp: Date.now() }
    ];

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, opts = {}) => {
        fetchCalls.push({ url: String(url), opts });
        if (String(url).includes('127.0.0.1')) {
          throw new Error('Local backend offline');
        }
        if (String(url).includes('/sync/push')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'ok', pushed: 1 })
          };
        }
        return { ok: false, status: 500 };
      };

      const drainedCount = await bgModule.drainPendingCardsQueue();
      assert.equal(drainedCount, 2);

      const cloudCalls = fetchCalls.filter(c => c.url.includes('/sync/push'));
      assert.equal(cloudCalls.length, 2);
      assert.equal(cloudCalls[0].opts.headers['Authorization'], 'Bearer drain_cloud_token_123');

      const pending = mockStorage['kiroku_pending_cards'];
      assert.equal(pending.length, 0, 'Cloud-synced items must be cleared from pending queue');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('S08: Queue drain concurrency safety: items added mid-drain preserved', async () => {
    mockStorage['kiroku_pending_cards'] = [
      { id: 'c1', queue_entry_id: 'qe1', payload: { expression: '月' }, timestamp: Date.now() }
    ];

    const originalFetch = globalThis.fetch;
    try {
      let appendedMidDrain = false;
      globalThis.fetch = async (url) => {
        if (String(url).includes('/api/cards/save')) {
          if (!appendedMidDrain) {
            appendedMidDrain = true;
            await bgModule.queueCardLocally({ expression: '太陽' });
          }
          return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
        }
        return { ok: false, status: 500 };
      };

      const drainedCount = await bgModule.drainPendingCardsQueue();
      assert.equal(drainedCount, 1);

      const pending = mockStorage['kiroku_pending_cards'];
      assert.equal(pending.length, 1, 'Item added mid-drain must be preserved');
      assert.equal(pending[0].payload.expression, '太陽');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('S09: Dead-letter queue: HTTP 409 conflict eviction', async () => {
    mockStorage['kiroku_auth_token'] = 'token_test_409';
    mockStorage['kiroku_pending_cards'] = [
      { id: 'conflict_card', queue_entry_id: 'qe_conf', payload: { expression: '星' }, timestamp: Date.now() }
    ];

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url) => {
        if (String(url).includes('127.0.0.1')) {
          throw new Error('Local offline');
        }
        if (String(url).includes('/sync/push')) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: 'Conflict: payload mismatch' })
          };
        }
        return { ok: false, status: 500 };
      };

      const drained = await bgModule.drainPendingCardsQueue();
      assert.equal(drained, 1, 'Dead-lettered item is counted as acknowledged');

      const pending = mockStorage['kiroku_pending_cards'];
      assert.equal(pending.length, 0, 'Conflicted item must be evicted from pending queue');

      const deadLetters = mockStorage['kiroku_dead_letter_cards'];
      assert.ok(Array.isArray(deadLetters));
      assert.equal(deadLetters.length, 1);
      assert.equal(deadLetters[0].id, 'conflict_card');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('S10: Dead-letter queue: max retry threshold (10 attempts)', async () => {
    mockStorage['kiroku_pending_cards'] = [
      { id: 'exhausted_card', queue_entry_id: 'qe_ex', attempts: 9, payload: { expression: '川' }, timestamp: Date.now() }
    ];

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        throw new Error('All endpoints offline');
      };

      await bgModule.drainPendingCardsQueue();

      const pending = mockStorage['kiroku_pending_cards'];
      assert.equal(pending.length, 0, 'Item exceeding 10 attempts must be evicted from pending');

      const deadLetters = mockStorage['kiroku_dead_letter_cards'];
      assert.ok(Array.isArray(deadLetters));
      assert.equal(deadLetters.length, 1);
      assert.equal(deadLetters[0].id, 'exhausted_card');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('S11: Drain re-entrancy prevention: isDrainingQueue guard', async () => {
    mockStorage['kiroku_pending_cards'] = [
      { id: 'slow_card', queue_entry_id: 'qe_slow', payload: { expression: '山' }, timestamp: Date.now() }
    ];

    let resolveFetch = null;
    const slowFetchPromise = new Promise((res) => { resolveFetch = res; });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url) => {
        if (String(url).includes('/api/cards/save')) {
          await slowFetchPromise;
          return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
        }
        return { ok: false, status: 500 };
      };

      const drain1Promise = bgModule.drainPendingCardsQueue();
      const drain2Result = await bgModule.drainPendingCardsQueue();
      assert.equal(drain2Result, 0, 'Second drain call must immediately return 0 due to re-entrancy lock');

      resolveFetch();
      const drain1Result = await drain1Promise;
      assert.equal(drain1Result, 1, 'First drain call finishes successfully');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('S12: Sidepanel modularity invariant', () => {
    const monolithPath = path.resolve('extension/sidepanel.js');
    assert.equal(fs.existsSync(monolithPath), false, 'Monolith extension/sidepanel.js must NOT exist');

    const modulesDir = path.resolve('extension/sidepanel/modules');
    assert.ok(fs.existsSync(modulesDir), 'extension/sidepanel/modules directory must exist');

    const files = fs.readdirSync(modulesDir).filter((f) => f.endsWith('.js'));
    assert.ok(files.length >= 10, `Sidepanel modules must remain separate files (found ${files.length})`);
    assert.ok(files.includes('core.js'), 'core.js must exist');
    assert.ok(files.includes('history.js'), 'history.js must exist');
    assert.ok(files.includes('dictionaries.js'), 'dictionaries.js must exist');
    assert.ok(files.includes('card-editor.js'), 'card-editor.js must exist');
    assert.ok(files.includes('messaging.js'), 'messaging.js must exist');
  });

  await t.test('S13: KirokuApi saveCard and capture cloud fallback', async () => {
    const kirokuApiModule = await import('../../../extension/lib/kiroku-api.js');
    const { KirokuApi } = kirokuApiModule.default || kirokuApiModule;
    const api = new KirokuApi('http://127.0.0.1:21828', null, {
      cloudBaseUrl: 'https://kiroku-note.rhythmkach.workers.dev',
      cloudAuthToken: 'api_cloud_token_abc'
    });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, opts = {}) => {
        fetchCalls.push({ url: String(url), opts });
        if (String(url).includes('127.0.0.1')) {
          throw new Error('Local down');
        }
        if (String(url).includes('/sync/push')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ status: 'ok', pushed: 1 })
          };
        }
        if (String(url).includes('/api/capture')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, cards: [{ id: 'cloud_cap_1' }] })
          };
        }
        return { ok: false, status: 500, text: async () => '' };
      };

      const saveRes = await api.saveCard({ expression: '勉強' });
      assert.equal(saveRes.source, 'cloud');
      assert.equal(saveRes.status, 'ok');

      const capRes = await api.capture('学校');
      assert.equal(capRes.source, 'cloud');
      assert.equal(capRes.ok, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('S14: Background runtime message handling for DRAIN_PENDING_QUEUE and QUEUE_CARD', async () => {
    const queueRes = await dispatchMessage({
      type: 'QUEUE_CARD',
      card: { expression: '雨', meaning: 'rain' }
    });
    assert.ok(queueRes);
    assert.equal(queueRes.ok, true);

    const pending = mockStorage['kiroku_pending_cards'];
    assert.equal(pending.length, 1);
    assert.equal(pending[0].payload.expression, '雨');

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url) => {
        if (String(url).includes('/api/cards/save')) {
          return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
        }
        return { ok: false, status: 500 };
      };

      const drainRes = await dispatchMessage({ type: 'DRAIN_PENDING_QUEUE' });
      assert.ok(drainRes);
      assert.equal(drainRes.ok, true);
      assert.equal(drainRes.syncedCount, 1);

      assert.equal(mockStorage['kiroku_pending_cards'].length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('S15: HUD_MINE cloud 409 conflict dead-letters card', async () => {
    mockStorage['kiroku_auth_token'] = 'conflict_token_abc';
    mockStorage['kiroku_pending_cards'] = [];
    mockStorage['kiroku_dead_letter_cards'] = [];

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url) => {
        if (String(url).includes('127.0.0.1')) {
          throw new Error('Local offline');
        }
        if (String(url).includes('/sync/push')) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: 'Conflict: card exists with different payload' })
          };
        }
        return { ok: false, status: 500 };
      };

      const response = await dispatchMessage({
        type: 'HUD_MINE',
        card: { expression: '衝突', reading: 'しょうとつ' }
      });

      assert.ok(response, 'HUD_MINE must respond');
      assert.equal(response.ok, false, '409 Conflict must not report ok: true');
      assert.equal(response.sync_destination, 'dead_letter');

      const pending = mockStorage['kiroku_pending_cards'] || [];
      assert.equal(pending.length, 0, 'Conflict card must NOT be enqueued in pending cards');

      const deadLetters = mockStorage['kiroku_dead_letter_cards'];
      assert.ok(Array.isArray(deadLetters));
      assert.equal(deadLetters.length, 1, 'Card must be placed in dead-letter queue');
      assert.equal(deadLetters[0].payload.expression, '衝突');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('S16: KirokuApi capture with cloud auth token pushes valid payload', async () => {
    const kirokuApiModule = await import('../../../extension/lib/kiroku-api.js');
    const { KirokuApi } = kirokuApiModule.default || kirokuApiModule;
    const api = new KirokuApi('http://127.0.0.1:21828', null, {
      cloudBaseUrl: 'https://kiroku-note.rhythmkach.workers.dev',
      cloudAuthToken: 'valid_bearer_token'
    });

    let cloudPushBody = null;
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, opts = {}) => {
        fetchCalls.push({ url: String(url), opts });
        if (String(url).includes('127.0.0.1:21828/api/capture')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, cards: [{ id: 'card_123', expression: '食べる' }] })
          };
        }
        if (String(url).includes('/sync/push')) {
          cloudPushBody = JSON.parse(opts.body);
          return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'ok' }) };
        }
        return { ok: false, status: 500, text: async () => '' };
      };

      const result = await api.capture('食べる');
      assert.equal(result.ok, true);
      assert.ok(result.cards && result.cards.length === 1);

      await new Promise((r) => setTimeout(r, 20));
      assert.ok(cloudPushBody, 'Cloud sync/push should have been called');
      assert.equal(cloudPushBody.ops[0].id, 'card_123');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
