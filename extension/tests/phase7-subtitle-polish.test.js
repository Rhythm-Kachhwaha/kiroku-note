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
const { JimakuSubtitleProvider } = require("../lib/jimaku-provider.js");
const YouTubeAdapter = require("../content/adapters/youtube-adapter.js");
const NetflixAdapter = require("../content/adapters/netflix-adapter.js");

// Mock DOM & Chrome Environment Helper
function createMockEnvironment({ isYouTube = false, isNetflix = false, isHiAnime = false } = {}) {
  const listeners = {};
  const sentMessages = [];
  const storage = { local: {} };

  class MockElement {
    constructor(tagName, id = "", className = "") {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.className = className;
      this.children = [];
      this.parentElement = null;
      this.style = {};
      this._textContent = "";
      this._listeners = {};
      this.isConnected = true;
      this.rect = { top: 100, left: 50, width: 800, height: 450 };
      this.isContentEditable = false;
    }
    get textContent() { return this._textContent; }
    set textContent(val) { this._textContent = val; }
    getBoundingClientRect() { return this.rect; }
    appendChild(child) {
      if (child) {
        child.parentElement = this;
        this.children.push(child);
      }
      return child;
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentElement = null;
      }
      return child;
    }
    addEventListener(event, fn) {
      this._listeners[event] = this._listeners[event] || [];
      this._listeners[event].push(fn);
    }
    removeEventListener(event, fn) {
      if (this._listeners[event]) {
        this._listeners[event] = this._listeners[event].filter(l => l !== fn);
      }
    }
    replaceChildren(...newChildren) {
      this.children = [];
      for (const c of newChildren) {
        this.appendChild(c);
      }
      this._textContent = "";
    }
    querySelector(sel) {
      if (sel.startsWith("#")) {
        const targetId = sel.slice(1);
        if (this.id === targetId) return this;
        for (const c of this.children) {
          const found = c.querySelector(sel);
          if (found) return found;
        }
      }
      return null;
    }
    querySelectorAll(_sel) { return []; }
    closest(sel) {
      if (sel.includes("player") || sel.includes("watch")) return this.parentElement || this;
      return null;
    }
    requestFullscreen() { return Promise.resolve(); }
  }

  class MockVideoElement extends MockElement {
    constructor(id = "test-video") {
      super("VIDEO", id);
      this.currentTime = 0;
      this.duration = 120;
      this.paused = true;
      this.ended = false;
      this.readyState = 4;
      this.videoWidth = 1920;
      this.videoHeight = 1080;
      this.textTracks = [];
    }
    play() {
      this.paused = false;
      this._listeners.play?.forEach(fn => fn());
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      this._listeners.pause?.forEach(fn => fn());
    }
  }

  const documentBody = new MockElement("BODY", "document-body");

  let hostname = "example.com";
  let href = "https://example.com/video/123";
  if (isYouTube) {
    hostname = "www.youtube.com";
    href = "https://www.youtube.com/watch?v=mockYt123";
  } else if (isNetflix) {
    hostname = "www.netflix.com";
    href = "https://www.netflix.com/watch/mockNf123";
  } else if (isHiAnime) {
    hostname = "hianime.to";
    href = "https://hianime.to/watch/one-piece-100?ep=1";
  }

  const mockWindow = {
    location: { hostname, href },
    addEventListener: (evt, fn) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    removeEventListener: (evt, fn) => {
      if (listeners[evt]) {
        listeners[evt] = listeners[evt].filter(l => l !== fn);
      }
    },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    document: {
      body: documentBody,
      documentElement: documentBody,
      createElement: (tag) => new MockElement(tag),
      getElementById: (id) => documentBody.querySelector("#" + id),
      querySelector: (sel) => documentBody.querySelector(sel),
      querySelectorAll: (sel) => documentBody.querySelectorAll(sel),
      addEventListener: (evt, fn) => {
        listeners[evt] = listeners[evt] || [];
        listeners[evt].push(fn);
      },
      removeEventListener: (evt, fn) => {
        if (listeners[evt]) {
          listeners[evt] = listeners[evt].filter(l => l !== fn);
        }
      }
    },
    chrome: {
      storage: {
        local: {
          get: (key, cb) => {
            const res = typeof key === "string" ? { [key]: storage.local[key] } : storage.local;
            if (cb) cb(res);
            return Promise.resolve(res);
          },
          set: (obj, cb) => {
            Object.assign(storage.local, obj);
            if (cb) cb();
            return Promise.resolve();
          },
          remove: (keys, cb) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            arr.forEach(k => delete storage.local[k]);
            if (cb) cb();
            return Promise.resolve();
          }
        },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        sendMessage: (msg) => {
          sentMessages.push(msg);
          if (msg.type === "FETCH_JIMAKU_API") {
            return Promise.resolve({ ok: true, data: [{ id: 1, name: "Mock Anime" }], isJson: true });
          }
          if (msg.type === "FETCH_YOUTUBE_TIMEDTEXT") {
            return Promise.resolve({ ok: true, text: "<timedtext format=\"3\"><p t=\"1000\" d=\"2000\"><s>YT字幕</s></p></timedtext>" });
          }
          return Promise.resolve({ ok: true });
        },
        onMessage: { addListener: () => {} }
      }
    }
  };

  return {
    mockWindow,
    documentBody,
    MockVideoElement,
    MockElement,
    sentMessages,
    storage
  };
}

test("Phase 7 Verification - End-to-End ASS / SSA Subtitle Pipeline", async () => {
  const sampleASS = `[Script Info]
Title: Frieren Ep 1
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:04.20,Default,,0,0,0,,{\\pos(192,200)}【フリーレン】魔法の収集が私の趣味だ。
Dialogue: 0,0:00:05.00,0:00:08.00,Default,,0,0,0,,{\\fad(200,200)}次の町まで歩こう。
`;

  // 1. Parsing
  const parsed = SubtitleParser.parseSubtitles(sampleASS, "frieren_01.ass");
  assert.equal(parsed.length, 2);

  // 2. Normalization (strips speaker labels and style overrides)
  const normalized = SubtitleParser.normalizeCues(parsed, { stripSpeakerLabels: true });
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].text, "魔法の収集が私の趣味だ。");
  assert.equal(normalized[0].startTime, 1.5);
  assert.equal(normalized[0].endTime, 4.2);
  assert.equal(normalized[1].text, "次の町まで歩こう。");

  // 3. Provider acquisition
  const provider = new LocalFileSubtitleProvider({ parser: SubtitleParser });
  const trackData = await provider.loadFile(sampleASS, "frieren_01.ass");
  assert.equal(trackData.source, "local_file");
  assert.equal(trackData.format, "ass");
  assert.equal(trackData.cues[0].text, "魔法の収集が私の趣味だ。");

  // 4. Registry management
  const registry = new SubtitleProviderRegistry();
  registry.registerProvider(provider);
  const tracks = await registry.getAllAvailableTracks();
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].providerId, "local_file");

  const loaded = await registry.loadTrack("local_file", "frieren_01.ass");
  assert.equal(loaded.cues.length, 2);
});

test("Phase 7 Verification - YouTube Subtitle Acquisition and Prioritization", async () => {
  const rawTracks = [
    { languageCode: "en", name: { simpleText: "English" }, baseUrl: "https://youtube.com/sub?lang=en" },
    { languageCode: "ja", name: { simpleText: "日本語" }, baseUrl: "https://youtube.com/sub?lang=ja" }
  ];

  const prioritized = YouTubeAdapter.prioritizeTracks(rawTracks);
  assert.equal(prioritized[0].languageCode, "ja", "Japanese track must be prioritized first");

  const provider = new YouTubeSubtitleProvider({
    parser: SubtitleParser,
    adapter: YouTubeAdapter,
    fetchFunction: async () => `<timedtext format="3"><body><p t="500" d="2500"><s>こんにちは世界</s></p></body></timedtext>`
  });

  provider.setRawTracks(rawTracks);
  const tracks = await provider.getTracks();
  assert.equal(tracks[0].languageCode, "ja");

  const data = await provider.loadTrack(tracks[0].id);
  assert.equal(data.source, "youtube_cc");
  assert.equal(data.cues[0].text, "こんにちは世界");
});

test("Phase 7 Verification - Netflix Subtitle Provider Observation", async () => {
  const provider = new NetflixSubtitleProvider();
  assert.equal(provider.id, "netflix_live");
  assert.equal(provider.type, "site");

  const loaded = await provider.loadTrack("live");
  assert.equal(loaded.source, "netflix_live");
  assert.equal(loaded.language, "ja");
});

test("Phase 7 Verification - Optional Jimaku Subtitle Provider", async () => {
  const mockFetcher = async ({ url }) => {
    if (url.includes("/entries/search")) {
      return {
        ok: true,
        isJson: true,
        data: [{ id: 99, name: "Bocchi the Rock!", japanese_name: "ぼっち・ざ・ろっく！" }]
      };
    }
    if (url.includes("/entries/99/files")) {
      return {
        ok: true,
        isJson: true,
        data: [{ id: 888, name: "Bocchi_01.ass", size: 50000, download_url: "https://jimaku.cc/api/files/888/download" }]
      };
    }
    if (url.includes("/files/888/download")) {
      return {
        ok: true,
        isJson: false,
        text: `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.00,0:00:06.00,Default,,0,0,0,,ギターが弾きたい！\n`
      };
    }
    return { ok: false, error: "Not found" };
  };

  const jimaku = new JimakuSubtitleProvider({
    parser: SubtitleParser,
    fetchFunction: mockFetcher
  });
  jimaku.setApiKey("test_key");

  const searchResults = await jimaku.searchEntries("Bocchi");
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].japanese_name, "ぼっち・ざ・ろっく！");

  const files = await jimaku.getFilesForEntry(searchResults[0].id);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "Bocchi_01.ass");

  const subData = await jimaku.downloadSubtitle(files[0].download_url, files[0].name);
  assert.equal(subData.source, "jimaku_search");
  assert.equal(subData.cues[0].text, "ギターが弾きたい！");
  assert.equal(subData.cues[0].startTime, 2.0);
  assert.equal(subData.cues[0].endTime, 6.0);
});

test("Phase 7 Verification - Subtitle Normalization Handles Edge Cases & Speaker Formatting", () => {
  const edgeCues = [
    { id: 1, startTime: 0.5, endTime: 2.0, text: "【男A】ここは危ない！" },
    { id: 2, startTime: 2.0, endTime: 3.5, text: "[Narrator]: 一方その頃..." },
    { id: 3, startTime: 3.5, endTime: 5.0, text: "山田：そんなわけないよ。" }, // Full-width colon
    { id: 4, startTime: 5.0, endTime: 7.0, text: "{\\pos(100,200)\\c&H00FFFF&}カラオケに行こう\\N今夜！" },
    { id: 5, startTime: 7.0, endTime: 8.5, text: "<v Teacher>起立！礼！</v>" },
    { id: 6, startTime: 8.5, endTime: 8.5, text: "0 duration cue" }, // 0 duration
    { id: 7, startTime: 9.0, endTime: 11.0, text: "    " } // whitespace only
  ];

  const normalized = SubtitleParser.normalizeCues(edgeCues, { stripSpeakerLabels: true });
  assert.equal(normalized.length, 5, "Should filter out 0 duration and whitespace-only cues");

  assert.equal(normalized[0].text, "ここは危ない！");
  assert.equal(normalized[1].text, "一方その頃...");
  assert.equal(normalized[2].text, "そんなわけないよ。");
  assert.equal(normalized[3].text, "カラオケに行こう\n今夜！");
  assert.equal(normalized[4].text, "起立！礼！");
});
