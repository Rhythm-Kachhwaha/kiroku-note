const test = require("node:test");
const assert = require("node:assert/strict");

const TitleParser = require("../lib/title-parser.js");
const { EpisodeStore } = require("../lib/episode-store.js");

test("TitleParser.parseEpisodeKey - Crunchyroll formats", () => {
  const k1 = TitleParser.parseEpisodeKey("https://www.crunchyroll.com/watch/EX1234/kaguya-sama", "Kaguya-sama - Episode 12");
  assert.equal(k1, "crunchyroll/kaguya-sama/EX1234");

  const k2 = TitleParser.parseEpisodeKey("https://www.crunchyroll.com/watch/GRDQPM1ZY", "Frieren: Beyond Journey's End");
  assert.equal(k2, "crunchyroll/frieren-beyond-journeys-end/GRDQPM1ZY");
});

test("TitleParser.parseEpisodeKey - Netflix formats", () => {
  const k1 = TitleParser.parseEpisodeKey("https://www.netflix.com/watch/80000000", "Delicious in Dungeon - S1E3");
  assert.equal(k1, "netflix/delicious-in-dungeon/80000000");

  const k2 = TitleParser.parseEpisodeKey("https://www.netflix.com/watch/70000001", "Cyberpunk: Edgerunners - Episode 04");
  assert.equal(k2, "netflix/cyberpunk-edgerunners/70000001");
});

test("TitleParser.parseEpisodeKey - YouTube formats", () => {
  const k1 = TitleParser.parseEpisodeKey("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "Never Gonna Give You Up");
  assert.equal(k1, "youtube/dQw4w9WgXcQ/unknown");

  const k2 = TitleParser.parseEpisodeKey("https://youtu.be/abcdef12345", "Anime PV Official");
  assert.equal(k2, "youtube/abcdef12345/unknown");
});

test("TitleParser.parseEpisodeKey - HiDive and generic formats", () => {
  const k1 = TitleParser.parseEpisodeKey("https://www.hidive.com/stream/oshi-no-ko/s01e05", "OSHI NO KO - Episode 5");
  assert.equal(k1, "hidive/oshi-no-ko/s01e05");

  const k2 = TitleParser.parseEpisodeKey("https://example.com/anime/kaguya-sama?ep=12", "Kaguya-sama Love is War - 12");
  assert.equal(k2, "generic/kaguya-sama-love-is-war/ep12");
});

test("TitleParser.parseEpisodeKey - Same URL always resolves to same key across parsers (parametric invariance)", () => {
  const urls = [
    { url: "https://www.crunchyroll.com/watch/GRDQPM1ZY/EX1234", title: "Show 1", expected: "crunchyroll/ex1234/GRDQPM1ZY" },
    { url: "https://www.netflix.com/watch/80000000", title: "Delicious in Dungeon - S1E3", expected: "netflix/delicious-in-dungeon/80000000" },
    { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Any Title", expected: "youtube/dQw4w9WgXcQ/unknown" },
    { url: "https://unknown-streaming-site.tv/watch", title: "Kaguya-sama - 12", expected: "generic/kaguya-sama/ep12" }
  ];

  for (const item of urls) {
    const res1 = TitleParser.parseEpisodeKey(item.url, item.title);
    const res2 = TitleParser.parseEpisodeKey(item.url, item.title);
    assert.equal(res1, res2, `Resolution must be stable and deterministic for ${item.url}`);
    assert.equal(res1, item.expected);
  }
});

test("EpisodeStore - sets, gets, updates, and clears episode state", async () => {
  const mockStorage = new Map();
  const adapter = {
    async get(key) { return mockStorage.get(key) || null; },
    async set(key, val) { mockStorage.set(key, val); }
  };

  const store = new EpisodeStore(adapter);
  const epKey = "crunchyroll/frieren/ep1";

  // Initially null
  assert.equal(await store.getEpisode(epKey), null);

  // Update track and offset
  await store.setEpisode(epKey, {
    sourceId: "track-jp-embedded",
    offsetMs: 250,
    jimakuId: null
  });

  const ep = await store.getEpisode(epKey);
  assert.ok(ep);
  assert.equal(ep.sourceId, "track-jp-embedded");
  assert.equal(ep.offsetMs, 250);
  assert.equal(ep.jimakuId, null);
  assert.ok(typeof ep.lastUpdated === "number");

  // Partial update (offset modification)
  await store.setEpisode(epKey, { offsetMs: -100 });
  const epUpdated = await store.getEpisode(epKey);
  assert.equal(epUpdated.sourceId, "track-jp-embedded"); // preserved
  assert.equal(epUpdated.offsetMs, -100);

  // Clear
  await store.clear();
  assert.equal(await store.getEpisode(epKey), null);
});

