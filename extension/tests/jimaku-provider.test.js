const test = require("node:test");
const assert = require("node:assert/strict");
const SubtitleParser = require("../lib/subtitle-parser.js");
const { JimakuSubtitleProvider } = require("../lib/jimaku-provider.js");

test("JimakuSubtitleProvider - initialization and API key management", async () => {
  const provider = new JimakuSubtitleProvider({ parser: SubtitleParser });
  assert.equal(provider.id, "jimaku_search");
  assert.equal(provider.type, "service");
  assert.equal(await provider.isAvailable(), false, "Should not be available without API key");

  provider.setApiKey("test_secret_key_123");
  assert.equal(provider.getApiKey(), "test_secret_key_123");
  assert.equal(await provider.isAvailable(), true, "Should be available when API key is set");
});

test("JimakuSubtitleProvider - searchEntries sends proper request and returns parsed entries", async () => {
  let capturedUrl = "";
  let capturedApiKey = "";

  const mockFetcher = async ({ url, apiKey }) => {
    capturedUrl = url;
    capturedApiKey = apiKey;
    return {
      ok: true,
      isJson: true,
      data: [
        {
          id: 42,
          name: "Sousou no Frieren",
          japanese_name: "葬送のフリーレン"
        }
      ]
    };
  };

  const provider = new JimakuSubtitleProvider({
    parser: SubtitleParser,
    fetchFunction: mockFetcher
  });
  provider.setApiKey("my_api_key");

  const results = await provider.searchEntries("Frieren");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 42);
  assert.equal(results[0].name, "Sousou no Frieren");
  assert.ok(capturedUrl.includes("query=Frieren"));
  assert.equal(capturedApiKey, "my_api_key");
});

test("JimakuSubtitleProvider - getFilesForEntry returns files list", async () => {
  const mockFetcher = async ({ url }) => {
    assert.ok(url.includes("/entries/42/files"));
    return {
      ok: true,
      isJson: true,
      data: [
        {
          id: 101,
          name: "Episode 01.ass",
          size: 32000,
          download_url: "https://jimaku.cc/api/files/101/download"
        }
      ]
    };
  };

  const provider = new JimakuSubtitleProvider({
    parser: SubtitleParser,
    fetchFunction: mockFetcher
  });
  provider.setApiKey("my_key");

  const files = await provider.getFilesForEntry(42);
  assert.equal(files.length, 1);
  assert.equal(files[0].id, 101);
  assert.equal(files[0].name, "Episode 01.ass");
});

test("JimakuSubtitleProvider - downloadSubtitle downloads and parses ASS/SRT file", async () => {
  const sampleASS = `[Script Info]
Title: Ep1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:10.00,0:00:14.00,Default,,0,0,0,,フリーレンの旅立ち
`;

  const mockFetcher = async ({ url }) => {
    return {
      ok: true,
      isJson: false,
      text: sampleASS
    };
  };

  const provider = new JimakuSubtitleProvider({
    parser: SubtitleParser,
    fetchFunction: mockFetcher
  });
  provider.setApiKey("my_key");

  const subData = await provider.downloadSubtitle("https://jimaku.cc/api/files/101/download", "Episode 01.ass");
  assert.equal(subData.source, "jimaku_search");
  assert.equal(subData.format, "ass");
  assert.equal(subData.filename, "Episode 01.ass");
  assert.equal(subData.cues.length, 1);
  assert.equal(subData.cues[0].text, "フリーレンの旅立ち");
});

test("JimakuSubtitleProvider - handles errors gracefully", async () => {
  // 1. Missing API key
  const providerNoKey = new JimakuSubtitleProvider({ parser: SubtitleParser });
  await assert.rejects(async () => await providerNoKey.searchEntries("test"), /MISSING_API_KEY/);

  // 2. 401 Unauthorized
  const providerBadKey = new JimakuSubtitleProvider({
    parser: SubtitleParser,
    fetchFunction: async () => ({ ok: false, error: "UNAUTHORIZED: Invalid Jimaku API key" })
  });
  providerBadKey.setApiKey("bad_key");
  await assert.rejects(async () => await providerBadKey.searchEntries("test"), /UNAUTHORIZED/);

  // 3. 429 Rate Limit
  const providerRateLimited = new JimakuSubtitleProvider({
    parser: SubtitleParser,
    fetchFunction: async () => ({ ok: false, error: "RATE_LIMITED: Jimaku API rate limit reached" })
  });
  providerRateLimited.setApiKey("key");
  await assert.rejects(async () => await providerRateLimited.searchEntries("test"), /RATE_LIMITED/);
});
