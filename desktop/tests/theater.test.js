const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Setup mock browser globals for tests
globalThis.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
  clear() { this.store = {}; }
};

globalThis.MediaError = {
  MEDIA_ERR_ABORTED: 1,
  MEDIA_ERR_NETWORK: 2,
  MEDIA_ERR_DECODE: 3,
  MEDIA_ERR_SRC_NOT_SUPPORTED: 4
};

// Import ES modules
describe('Slice 42 — Theater & Subtitle Parser', async () => {
  const {
    SubtitleParser,
    parseSRT,
    parseVTT,
    parseASS,
    parseSubtitles,
    shiftCues,
    stripASSTags
  } = await import('../src/ui/lib-shared/subtitle_parser.mjs');

  const {
    PlayerAdapter,
    JimakuSearchProvider,
    TheaterView,
    computeFileHash
  } = await import('../src/ui/views/theater.js');

  describe('SubtitleParser Ported Suite', () => {
    it('parses SRT correctly with timestamps and stripped formatting', () => {
      const sampleSRT = `
1
00:00:01,200 --> 00:00:04,500
これは<b>テスト</b>です。
二行目の字幕。

2
00:01:15,000 --> 00:01:18,750
<i>逃げるな！</i>生きる方が戦いだ！
<font color="#ff0000">赤色テキスト</font>

3
00:02:00,000 --> 00:02:05,000
約束の場所へ行こう
`;
      const cues = parseSRT(sampleSRT);
      assert.equal(cues.length, 3);
      assert.equal(cues[0].startTime, 1.2);
      assert.equal(cues[0].endTime, 4.5);
      assert.equal(cues[0].text, 'これはテストです。\n二行目の字幕。');
      assert.equal(cues[1].startTime, 75.0);
      assert.equal(cues[2].startTime, 120.0);
    });

    it('parses WebVTT correctly', () => {
      const sampleVTT = `WEBVTT
00:00:02.500 --> 00:00:06.000
<c.yellow>こんにちは世界</c>

01:20.000 --> 01:23.500
短縮タイムスタンプのテスト
`;
      const cues = parseVTT(sampleVTT);
      assert.equal(cues.length, 2);
      assert.equal(cues[0].startTime, 2.5);
      assert.equal(cues[0].text, 'こんにちは世界');
      assert.equal(cues[1].startTime, 80.0);
    });

    it('parses ASS / SSA subtitles and strips drawing & override tags', () => {
      const sampleASS = `[Script Info]
Title: Sample
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:04.20,Default,,0,0,0,,{\\pos(192,200)\\c&H00FFFF&}魔法を教えてあげる
Dialogue: 0,0:00:05.00,0:00:08.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}実体テキスト
`;
      const cues = parseASS(sampleASS);
      assert.equal(cues.length, 2);
      assert.equal(cues[0].startTime, 1.5);
      assert.equal(cues[0].endTime, 4.2);
      assert.equal(cues[0].text, '魔法を教えてあげる');
      assert.equal(cues[1].text, '実体テキスト');
    });

    it('shifts cues accurately and clamps to 0', () => {
      const sample = [{ startTime: 1.0, endTime: 3.0, text: 'test' }];
      const shifted = shiftCues(sample, 0.5);
      assert.equal(shifted[0].startTime, 1.5);
      assert.equal(shifted[0].endTime, 3.5);

      const shiftedClamped = shiftCues(sample, -2.0);
      assert.equal(shiftedClamped[0].startTime, 0);
      assert.equal(shiftedClamped[0].endTime, 1.0);
    });

    it('auto-detects formats and handles empty inputs safely', () => {
      assert.deepEqual(parseSubtitles(''), []);
      assert.deepEqual(parseSubtitles(null), []);
      assert.equal(parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nHi', 'test.srt').length, 1);
    });
  });

  describe('PlayerAdapter & Link Command Set', () => {
    function createMockVideo() {
      const listeners = {};
      return {
        currentTime: 0,
        paused: true,
        playbackRate: 1,
        volume: 1,
        muted: false,
        duration: 120,
        addEventListener(event, fn) {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(fn);
        },
        removeEventListener(event, fn) {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter(l => l !== fn);
          }
        },
        dispatchEvent(event) {
          if (listeners[event]) {
            listeners[event].forEach(fn => fn());
          }
        },
        play() {
          this.paused = false;
          this.dispatchEvent('play');
          return Promise.resolve();
        },
        pause() {
          this.paused = true;
          this.dispatchEvent('pause');
        }
      };
    }

    it('implements cmd.play, cmd.pause, cmd.toggle, cmd.seek, cmd.rate', async () => {
      const mockVideo = createMockVideo();
      const adapter = new PlayerAdapter({ videoEl: mockVideo });

      // cmd.play
      await adapter.sendCommand('cmd.play');
      assert.equal(mockVideo.paused, false);

      // cmd.pause
      await adapter.sendCommand('cmd.pause');
      assert.equal(mockVideo.paused, true);

      // cmd.toggle
      await adapter.sendCommand('cmd.toggle');
      assert.equal(mockVideo.paused, false);

      // cmd.seek absolute and delta
      await adapter.sendCommand('cmd.seek', { t: 42 });
      assert.equal(mockVideo.currentTime, 42);

      await adapter.sendCommand('cmd.seek', { delta: 8 });
      assert.equal(mockVideo.currentTime, 50);

      // cmd.rate
      await adapter.sendCommand('cmd.rate', { v: 1.5 });
      assert.equal(mockVideo.playbackRate, 1.5);
    });

    it('loads cues, tracks active cue on timeupdate, and jumps cues via cmd.cue', async () => {
      const mockVideo = createMockVideo();
      const adapter = new PlayerAdapter({ videoEl: mockVideo });

      adapter.loadCues([
        { startTime: 0, endTime: 5, text: 'First line' },
        { startTime: 5.5, endTime: 10, text: 'Second line' },
        { startTime: 12, endTime: 18, text: 'Third line' }
      ], 'test.srt');

      assert.equal(adapter.cues.length, 3);

      // Simulate timeupdate at t=6
      mockVideo.currentTime = 6;
      mockVideo.dispatchEvent('timeupdate');

      assert.equal(adapter.activeCueIndex, 1);
      assert.equal(adapter.activeCue.text, 'Second line');

      // Jump to next cue
      await adapter.sendCommand('cmd.cue', { to: 'next' });
      assert.equal(mockVideo.currentTime, 12);

      // Jump to prev cue
      await adapter.sendCommand('cmd.cue', { to: 'prev' });
      assert.equal(mockVideo.currentTime, 5.5);
    });

    it('captures clip envelope via cmd.clip with reqId', async () => {
      const mockVideo = createMockVideo();
      const adapter = new PlayerAdapter({ videoEl: mockVideo });

      let clipResultFired = null;
      adapter.on('clip.result', (res) => {
        clipResultFired = res;
      });

      const res = await adapter.sendCommand('cmd.clip', {
        reqId: 'test-req-123',
        s: 1.0,
        e: 4.0,
        want: ['image', 'audio']
      });

      assert.equal(res.ok, true);
      assert.equal(res.reqId, 'test-req-123');
      assert.equal(clipResultFired?.reqId, 'test-req-123');
    });

    it('persists and restores last playback position by file hash', () => {
      const mockVideo = createMockVideo();
      const adapter = new PlayerAdapter({ videoEl: mockVideo });

      const fakeFile = { name: 'anime_ep01.mp4', size: 1024000, lastModified: 1700000000000 };
      const hash = computeFileHash(fakeFile);

      // Save position
      localStorage.setItem(`kiroku:theater:pos:${hash}`, '35.5');

      // Attach file -> should restore position
      adapter.attachFile(fakeFile, fakeFile.name);
      assert.equal(mockVideo.currentTime, 35.5);
    });
  });

  describe('Jimaku Subtitle Acquisition', () => {
    it('manages API key and queries entry files with mock fetch', async () => {
      const mockFetch = async ({ url, apiKey }) => {
        assert.equal(apiKey, 'secret-jimaku-key');
        if (url.includes('/search')) {
          return { ok: true, data: [{ id: 456, name: 'Frieren 01' }] };
        }
        if (url.includes('/files')) {
          return { ok: true, data: [{ url: '/sub/frieren.ass', name: 'frieren.ass' }] };
        }
        if (url.includes('/sub/frieren.ass')) {
          return {
            ok: true,
            text: `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,お久しぶりです`
          };
        }
        return { ok: false };
      };

      const provider = new JimakuSearchProvider({ fetchFunction: mockFetch });
      provider.setApiKey('secret-jimaku-key');

      const entries = await provider.searchEntries('Frieren');
      assert.equal(entries.length, 1);
      assert.equal(entries[0].id, 456);

      const files = await provider.getFilesForEntry(456);
      assert.equal(files.length, 1);

      const dl = await provider.downloadSubtitle(files[0].url, files[0].name);
      assert.equal(dl.cues.length, 1);
      assert.equal(dl.cues[0].text, 'お久しぶりです');
    });
  });
});

