const test = require("node:test");
const assert = require("node:assert/strict");

// Load TitleParser and AnimeSessionLogger
const TitleParser = require("../lib/title-parser.js");
const { AnimeSessionLogger } = require("../sidepanel/anime/session.js");

test("TitleParser extracts series, episode number, and episodeKey from various anime sites", () => {
  // Crunchyroll
  const cr = TitleParser.cleanAnimeTitle("Watch Frieren: Beyond Journey's End - Episode 01 - The Journey's End | Crunchyroll");
  assert.equal(cr.title, "Frieren: Beyond Journey's End");
  assert.equal(cr.episode, 1);

  // HiAnime
  const ha = TitleParser.cleanAnimeTitle("Attack on Titan Final Season - 03 (English Sub) on HiAnime", "https://hianime.to/watch/attack-on-titan-112?ep=3");
  assert.equal(ha.title, "Attack on Titan Final Season");
  assert.equal(ha.episode, 3);

  // Japanese notation
  const jp = TitleParser.cleanAnimeTitle("葬送のフリーレン 第11話「冬の魔法」");
  assert.equal(jp.title, "葬送のフリーレン");
  assert.equal(jp.episode, 11);

  // Episode key parsing
  const epKey = TitleParser.parseEpisodeKey("https://www.crunchyroll.com/watch/G1441/frieren-ep-1", "Frieren Episode 1");
  assert.ok(epKey.includes("crunchyroll"));
});

test("AnimeSessionLogger saves position immediately on pause and ended", async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, opts) => {
    requests.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      json: async () => ({ ok: true })
    };
  };

  const logger = new AnimeSessionLogger({
    backendUrl: "http://127.0.0.1:21828",
    site: "crunchyroll",
    title: "Frieren: Beyond Journey's End Episode 1",
    series: "Frieren: Beyond Journey's End",
    episodeKey: "crunchyroll/frieren/ep1",
    cueHash: "frieren-beyond-journeys-end_ep1",
    mediaType: "anime"
  });

  logger.onPlay();
  logger.onTimeUpdate(125.5); // 125.5 seconds into episode
  logger.recordCueSeen({ i: 0, text: "テスト字幕", gap_words: ["テスト"] });

  // Before mining any word, pause must NOT save position
  logger.onPause();
  assert.equal(requests.length, 0);

  // Mining 1 word unlocks position saving on pause and ended
  logger.onPlay();
  logger.recordWordMined("テスト");
  // recordWordMined already saves position once, so reset requests to verify onPause
  requests.length = 0;
  logger.onPause();

  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.includes("/api/link/episodes/frieren-beyond-journeys-end_ep1/position"));
  assert.equal(requests[0].body.last_position_ms, 125500);
  assert.equal(requests[0].body.series, "Frieren: Beyond Journey's End");
  assert.equal(requests[0].body.media_type, "anime");

  // On ended, should also save position and flush session
  logger.onTimeUpdate(1440.0);
  logger.onEnded();

  assert.ok(requests.some(r => r.url.includes("/api/link/episodes/frieren-beyond-journeys-end_ep1/position")));
  assert.ok(requests.some(r => r.url.includes("/api/link/sessions")));

  global.fetch = originalFetch;
  logger.destroy();
});

test("AnimeSessionLogger updates episode metadata via setEpisodeInfo", () => {
  const logger = new AnimeSessionLogger();
  assert.equal(logger.series, "");
  assert.equal(logger.cueHash, "");

  logger.setEpisodeInfo({
    site: "hianime",
    title: "DanDaDan Episode 4",
    series: "DanDaDan",
    episodeKey: "hianime/dandadan/ep4",
    cueHash: "dandadan_ep4",
    mediaType: "anime"
  });

  assert.equal(logger.series, "DanDaDan");
  assert.equal(logger.title, "DanDaDan Episode 4");
  assert.equal(logger.cueHash, "dandadan_ep4");
  assert.equal(logger.mediaType, "anime");

  const payload = logger.buildSessionPayload();
  assert.equal(payload.series, "DanDaDan");
  assert.equal(payload.title, "DanDaDan Episode 4");

  logger.destroy();
});

