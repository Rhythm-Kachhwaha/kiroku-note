const test = require("node:test");
const assert = require("node:assert/strict");
const { AnimeSessionLogger } = require("../sidepanel/anime/session.js");

test("AnimeSessionLogger - counts watch seconds, lines seen, and mined words", () => {
  const logger = new AnimeSessionLogger({
    site: "crunchyroll",
    title: "Frieren Ep 1",
    series: "Frieren",
    episodeKey: "crunchyroll/frieren/ep1"
  });

  logger.onPlay();
  logger.recordCueSeen({ i: 0, text: "こんにちは", gap_words: ["こんにちは"] });
  logger.recordCueSeen({ i: 1, text: "世界", gap_words: ["世界"] });
  logger.recordCueSeen({ i: 1, text: "世界", gap_words: ["世界"] }); // duplicate cue

  logger.recordWordMined("世界");
  logger.recordWordMined("世界"); // duplicate mine

  assert.equal(logger.linesSeen, 2);
  assert.equal(logger.gapWordsSeen, 2);
  assert.equal(logger.wordsMined, 1);

  const payload = logger.buildSessionPayload();
  assert.equal(payload.site, "crunchyroll");
  assert.equal(payload.title, "Frieren Ep 1");
  assert.equal(payload.series, "Frieren");
  assert.equal(payload.episode_key, "crunchyroll/frieren/ep1");
  assert.equal(payload.lines_seen, 2);
  assert.equal(payload.words_mined, 1);
  assert.equal(payload.gap_words_seen, 2);

  logger.destroy();
});

test("AnimeSessionLogger - enqueues session locally when backend fetch fails", async () => {
  // Mock global.fetch to simulate offline backend
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("Failed to connect to backend");
  };

  const logger = new AnimeSessionLogger({
    backendUrl: "http://127.0.0.1:21828",
    site: "netflix",
    title: "Delicious in Dungeon Ep 1"
  });

  logger.watchSeconds = 65;
  logger.linesSeen = 12;
  logger.wordsMined = 2;

  // Flush should catch error and enqueue locally
  const result = await logger.flushSession("pause_threshold");
  assert.equal(result, null, "Should return null on backend failure");
  assert.equal(logger.retryQueue.length, 1, "Session payload must be queued locally");
  assert.equal(logger.retryQueue[0].watch_seconds, 65);
  assert.equal(logger.retryQueue[0].lines_seen, 12);

  // Restore fetch to simulate recovery
  let postedPayload = null;
  global.fetch = async (url, opts) => {
    postedPayload = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ id: 42, ...postedPayload })
    };
  };

  // On heartbeat, retryQueue should be flushed
  await logger.onHeartbeat();
  assert.equal(logger.retryQueue.length, 0, "Retry queue must be drained on successful flush");
  assert.ok(postedPayload, "Queued session must have been posted to backend");
  assert.equal(postedPayload.lines_seen, 12);

  global.fetch = originalFetch;
  logger.destroy();
});

test("AnimeSessionLogger - saves episode position to backend", async () => {
  const originalFetch = global.fetch;
  let targetUrl = "";
  let sentBody = null;

  global.fetch = async (url, opts) => {
    targetUrl = url;
    sentBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ hash: "cuehash123", last_position_ms: sentBody.last_position_ms })
    };
  };

  const logger = new AnimeSessionLogger({
    backendUrl: "http://127.0.0.1:21828",
    cueHash: "cuehash123",
    site: "youtube",
    title: "Anime Episode"
  });

  const res = await logger.saveEpisodePosition("cuehash123", 45000);
  assert.ok(res);
  assert.equal(targetUrl, "http://127.0.0.1:21828/api/link/episodes/cuehash123/position");
  assert.equal(sentBody.last_position_ms, 45000);

  global.fetch = originalFetch;
  logger.destroy();
});

