/**
 * Targeted tests for Extension Cloud Sync, Offline Queue & Fallback
 */
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");

// Mock global chrome object before loading background.js
let mockStorage = {};
const messageListeners = [];
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === "string") {
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
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: (fn) => { messageListeners.push(fn); } },
    sendMessage: async () => {}
  },
  tabs: {
    query: async () => [],
    sendMessage: async () => {},
    onActivated: { addListener: () => {} },
    onUpdated: { addListener: () => {} }
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

const background = require("../background.js");
const { KirokuApi } = require("../lib/kiroku-api.js");

describe("Extension Cloud Sync & Offline Queueing", () => {
  beforeEach(() => {
    mockStorage = {};
  });

  test("queueCardLocally correctly appends to kiroku_pending_cards", async () => {
    const card = { expression: "日本語", meaning: "Japanese language" };
    const queued = await background.queueCardLocally(card);
    assert.strictEqual(queued, true);

    const stored = mockStorage["kiroku_pending_cards"];
    assert.ok(Array.isArray(stored));
    assert.strictEqual(stored.length, 1);
    const expr = stored[0].payload?.expression || stored[0].expression;
    assert.strictEqual(expr, "日本語");
  });

  test("getStoredCloudToken retrieves token from storage", async () => {
    mockStorage["kiroku.cloud.auth_token"] = "test-token-xyz";
    const token = await background.getStoredCloudToken();
    assert.strictEqual(token, "test-token-xyz");
  });

  test("drainPendingCardsQueue clears queue when sync succeeds", async () => {
    mockStorage["kiroku_pending_cards"] = [
      { expression: "猫", meaning: "cat" },
      { expression: "犬", meaning: "dog" }
    ];

    // Mock fetch to simulate successful local backend save
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes("/api/cards/save")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "local-card-1", status: "success" })
        };
      }
      return { ok: false, status: 500 };
    };

    try {
      const synced = await background.drainPendingCardsQueue();
      assert.strictEqual(synced, 2);
      assert.deepStrictEqual(mockStorage["kiroku_pending_cards"], []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("KirokuApi saveCard falls back to cloud worker when local backend is unreachable", async () => {
    const api = new KirokuApi("http://127.0.0.1:99999", null, {
      cloudBaseUrl: "https://mock-worker.test",
      cloudAuthToken: "mock-bearer-token"
    });

    const originalFetch = globalThis.fetch;
    let cloudCalled = false;
    globalThis.fetch = async (url, options) => {
      if (url.includes("127.0.0.1")) {
        throw new Error("Local connection refused");
      }
      if (url.includes("mock-worker.test/sync/push")) {
        cloudCalled = true;
        assert.strictEqual(options.headers["Authorization"], "Bearer mock-bearer-token");
        return {
          ok: true,
          text: async () => JSON.stringify({ synced: 1, cloud_id: "c-123" })
        };
      }
      return { ok: false, text: async () => "{}" };
    };

    try {
      const res = await api.saveCard({ expression: "勉強", reading: "べんきょう" });
      assert.strictEqual(cloudCalled, true);
      assert.strictEqual(res.source, "cloud");
      assert.strictEqual(res.cloud_id, "c-123");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("CLOUD_LOGOUT clears all stored cloud tokens including kiroku.extension.remembered_token", async () => {
    mockStorage = {
      kiroku_auth_token: "tok-1",
      "kiroku.extension.remembered_token": "tok-remembered",
      kiroku_auth_session: { token: "tok-1", email: "user@example.com" }
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true });
    try {
      const listener = messageListeners[0];
      assert.ok(listener, "background.js should register an onMessage listener");
      const resp = await new Promise((resolve) => {
        listener({ type: "CLOUD_LOGOUT" }, {}, resolve);
      });
      assert.strictEqual(resp.ok, true);
      assert.strictEqual(mockStorage["kiroku.extension.remembered_token"], undefined);
      assert.strictEqual(mockStorage.kiroku_auth_token, undefined);
      assert.strictEqual(mockStorage.kiroku_auth_session, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("VALIDATE_CLOUD_AUTH clears kiroku.extension.remembered_token on 401", async () => {
    mockStorage = {
      "kiroku.extension.remembered_token": "tok-expired"
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 401 });
    try {
      const listener = messageListeners[0];
      const resp = await new Promise((resolve) => {
        listener({ type: "VALIDATE_CLOUD_AUTH" }, {}, resolve);
      });
      assert.strictEqual(resp.authenticated, false);
      assert.strictEqual(mockStorage["kiroku.extension.remembered_token"], undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
