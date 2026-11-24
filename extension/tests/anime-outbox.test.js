/**
 * Targeted tests for Anime Extension Outbox Durability & Concurrency
 */
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");

let mockStorage = {};
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
    onMessage: { addListener: () => {} },
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

describe("Anime Outbox Durability & Concurrency", () => {
  beforeEach(() => {
    mockStorage = {};
  });

  test("coalesces duplicate position updates for identical episode/cue", async () => {
    await background.queueAnimeOutboxLocally({
      type: "position",
      hash: "frieren_ep1",
      payload: { cue_hash: "frieren_ep1", last_position_ms: 5000 }
    });
    await background.queueAnimeOutboxLocally({
      type: "position",
      hash: "frieren_ep1",
      payload: { cue_hash: "frieren_ep1", last_position_ms: 12000 }
    });
    await background.queueAnimeOutboxLocally({
      type: "position",
      hash: "frieren_ep1",
      payload: { cue_hash: "frieren_ep1", last_position_ms: 25000 }
    });

    const queue = mockStorage["kiroku_anime_outbox"] || [];
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].payload.last_position_ms, 25000);
  });

  test("does not evict subtitle cues or session items", async () => {
    await background.queueAnimeOutboxLocally({
      type: "subtitles",
      hash: "frieren_ep1",
      payload: { cues: [{ text: "勇者ヒンメル" }] }
    });
    await background.queueAnimeOutboxLocally({
      type: "session",
      payload: { minutes: 24, mined_count: 5 }
    });

    const queue = mockStorage["kiroku_anime_outbox"] || [];
    assert.strictEqual(queue.length, 2);
    assert.strictEqual(queue[0].type, "subtitles");
    assert.strictEqual(queue[1].type, "session");
  });

  test("does not drop items after 10 failed retry attempts", async () => {
    mockStorage["kiroku_anime_outbox"] = [
      {
        id: "sub_1",
        type: "subtitles",
        payload: { hash: "test_ep", cues: [] },
        retries: 10,
        createdAt: Date.now() - 60000
      }
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Network unreachable");
    };

    try {
      await background.drainAnimeOutbox();
      const queue = mockStorage["kiroku_anime_outbox"] || [];
      assert.strictEqual(queue.length, 1);
      assert.strictEqual(queue[0].id, "sub_1");
      assert.strictEqual(queue[0].retries, 11);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("preserves items concurrently added to storage during drain", async () => {
    mockStorage["kiroku_anime_outbox"] = [
      {
        id: "item_existing",
        type: "position",
        hash: "ep1",
        payload: { cue_hash: "ep1", last_position_ms: 1000 },
        retries: 0
      }
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      // Simulate a concurrent write arriving while fetch is in-flight
      const currentQueue = mockStorage["kiroku_anime_outbox"] || [];
      mockStorage["kiroku_anime_outbox"] = [
        ...currentQueue,
        {
          id: "item_concurrent",
          type: "session",
          payload: { minutes: 10 },
          retries: 0
        }
      ];

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, cloud_synced: true })
      };
    };

    try {
      await background.drainAnimeOutbox();
      const finalQueue = mockStorage["kiroku_anime_outbox"] || [];
      // item_existing should be removed, but item_concurrent must be preserved
      assert.strictEqual(finalQueue.length, 1);
      assert.strictEqual(finalQueue[0].id, "item_concurrent");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("requires cloud_synced: true when token is present before dequeuing", async () => {
    mockStorage["kiroku.cloud.auth_token"] = "jwt.valid.token";
    mockStorage["kiroku_anime_outbox"] = [
      {
        id: "sub_cloud_check",
        type: "subtitles",
        payload: { hash: "frieren_ep2", cues: [] },
        retries: 0
      }
    ];

    const originalFetch = globalThis.fetch;
    // Local succeeds but cloud_synced is false
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, cloud_synced: false })
    });

    try {
      await background.drainAnimeOutbox();
      const queue = mockStorage["kiroku_anime_outbox"] || [];
      // Item must NOT be dequeued because cloud persistence was not acknowledged
      assert.strictEqual(queue.length, 1);
      assert.strictEqual(queue[0].id, "sub_cloud_check");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
