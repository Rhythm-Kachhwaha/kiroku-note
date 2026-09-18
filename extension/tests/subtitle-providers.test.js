const test = require("node:test");
const assert = require("node:assert/strict");
const SubtitleParser = require("../lib/subtitle-parser.js");
const {
  BaseSubtitleProvider,
  LocalFileSubtitleProvider,
  YouTubeSubtitleProvider,
  NetflixSubtitleProvider,
  SubtitleProviderRegistry
} = require("../lib/subtitle-provider.js");

test("SubtitleProvider - BaseSubtitleProvider contract", async () => {
  const base = new BaseSubtitleProvider("test_id", "Test Provider", "custom");
  assert.equal(base.id, "test_id");
  assert.equal(base.name, "Test Provider");
  assert.equal(base.type, "custom");
  assert.equal(await base.isAvailable(), false);
  assert.deepEqual(await base.getTracks(), []);
  await assert.rejects(async () => await base.loadTrack("track_1"), /not implemented/i);
});

test("SubtitleProvider - LocalFileSubtitleProvider loads SRT, VTT, and ASS files", async () => {
  const provider = new LocalFileSubtitleProvider({ parser: SubtitleParser });
  assert.equal(provider.id, "local_file");
  assert.equal(provider.type, "file");
  assert.equal(await provider.isAvailable(), true);

  // Load an ASS file content
  const sampleASS = `[Script Info]
Title: Sample
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:01:00.00,0:01:05.00,Default,,0,0,0,,{\\pos(100,100)}【田中】テスト字幕です。
`;

  const trackData = await provider.loadFile(sampleASS, "sample_anime.ass");
  assert.equal(trackData.source, "local_file");
  assert.equal(trackData.format, "ass");
  assert.equal(trackData.filename, "sample_anime.ass");
  assert.equal(trackData.cues.length, 1);
  assert.equal(trackData.cues[0].text, "テスト字幕です。");

  const tracks = await provider.getTracks();
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].id, "sample_anime.ass");
  assert.equal(tracks[0].name, "sample_anime.ass (1 cues)");

  const loaded = await provider.loadTrack("sample_anime.ass");
  assert.equal(loaded.cues[0].text, "テスト字幕です。");
});

test("SubtitleProvider - YouTubeSubtitleProvider processes and loads tracks", async () => {
  const provider = new YouTubeSubtitleProvider({
    parser: SubtitleParser,
    fetchFunction: async (_url) => `<timedtext format="3"><body><p t="1000" d="3000"><s>テスト動画字幕</s></p></body></timedtext>`
  });

  provider.setRawTracks([
    {
      languageCode: "ja",
      name: { simpleText: "Japanese" },
      baseUrl: "https://www.youtube.com/api/timedtext?v=123&lang=ja"
    },
    {
      languageCode: "en",
      name: { simpleText: "English" },
      baseUrl: "https://www.youtube.com/api/timedtext?v=123&lang=en"
    }
  ]);

  const tracks = await provider.getTracks();
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].languageCode, "ja");
  assert.equal(tracks[0].providerId, "youtube_cc");

  const loadedData = await provider.loadTrack(tracks[0].id);
  assert.equal(loadedData.source, "youtube_cc");
  assert.equal(loadedData.language, "ja");
  assert.equal(loadedData.cues.length, 1);
  assert.equal(loadedData.cues[0].text, "テスト動画字幕");
});

test("SubtitleProviderRegistry - manages multiple providers and queries tracks", async () => {
  const registry = new SubtitleProviderRegistry();
  const fileProvider = new LocalFileSubtitleProvider({ parser: SubtitleParser });
  const ytProvider = new YouTubeSubtitleProvider({ parser: SubtitleParser });

  registry.registerProvider(fileProvider);
  registry.registerProvider(ytProvider);

  assert.equal(registry.getProvider("local_file"), fileProvider);
  assert.equal(registry.getProvider("youtube_cc"), ytProvider);

  // Load a file
  await fileProvider.loadFile("1\n00:00:01,000 --> 00:00:03,000\nテスト字幕\n", "sub.srt");

  const allTracks = await registry.getAllAvailableTracks();
  assert.ok(allTracks.some(t => t.providerId === "local_file" && t.id === "sub.srt"));

  const loaded = await registry.loadTrack("local_file", "sub.srt");
  assert.equal(loaded.cues[0].text, "テスト字幕");
});
