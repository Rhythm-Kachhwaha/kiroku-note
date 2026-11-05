/**
 * Slice 31 Unit Tests: Theater Polish
 * - Recent files list
 * - Drag-drop subtitle file onto player
 * - Next-episode natural sort
 * - Remember volume/rate
 * - Subtitle offset hotkeys shared with Slice 26
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Mock localStorage
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

test('Slice 31: Natural sort and next episode detection', async () => {
  const { naturalCompare, findNextEpisode } = await import('../src/ui/views/theater.js');

  const filenames = [
    'Attack_on_Titan_S04E10.mp4',
    'Attack_on_Titan_S04E01.mp4',
    'Attack_on_Titan_S04E02.mp4',
    'Attack_on_Titan_S04E09.mp4'
  ];

  const sorted = [...filenames].sort(naturalCompare);
  assert.deepEqual(sorted, [
    'Attack_on_Titan_S04E01.mp4',
    'Attack_on_Titan_S04E02.mp4',
    'Attack_on_Titan_S04E09.mp4',
    'Attack_on_Titan_S04E10.mp4'
  ], 'Should sort episodes naturally by numeric value');

  const fileObjects = filenames.map(name => ({ name }));
  const nextFrom1 = findNextEpisode('Attack_on_Titan_S04E01.mp4', fileObjects);
  assert.equal(nextFrom1?.name, 'Attack_on_Titan_S04E02.mp4');

  const nextFrom9 = findNextEpisode('Attack_on_Titan_S04E09.mp4', fileObjects);
  assert.equal(nextFrom9?.name, 'Attack_on_Titan_S04E10.mp4');

  const nextFrom10 = findNextEpisode('Attack_on_Titan_S04E10.mp4', fileObjects);
  assert.equal(nextFrom10, null, 'Last episode has no next episode');
});

test('Slice 31: Remember volume, muted, and playbackRate in PlayerAdapter', async () => {
  globalThis.localStorage.clear();
  const { PlayerAdapter } = await import('../src/ui/views/theater.js');

  // Pre-seed localStorage with saved settings
  globalThis.localStorage.setItem('kiroku:theater:rate', '1.25');
  globalThis.localStorage.setItem('kiroku:theater:vol', '0.75');
  globalThis.localStorage.setItem('kiroku:theater:muted', 'true');

  const mockVideo = {
    currentTime: 0,
    paused: true,
    playbackRate: 1.0,
    volume: 1.0,
    muted: false,
    listeners: {},
    addEventListener(evt, fn) {
      if (!this.listeners[evt]) this.listeners[evt] = [];
      this.listeners[evt].push(fn);
    },
    dispatchEvent(evt) {
      const fns = this.listeners[evt] || [];
      fns.forEach(fn => fn());
    }
  };

  const adapter = new PlayerAdapter({ videoEl: mockVideo });

  // 1. Verify restored from localStorage
  assert.equal(mockVideo.playbackRate, 1.25, 'Should restore playbackRate 1.25');
  assert.equal(mockVideo.volume, 0.75, 'Should restore volume 0.75');
  assert.equal(mockVideo.muted, true, 'Should restore muted state true');

  // 2. Verify changing volume & rate updates localStorage
  mockVideo.volume = 0.5;
  mockVideo.muted = false;
  mockVideo.dispatchEvent('volumechange');
  assert.equal(globalThis.localStorage.getItem('kiroku:theater:vol'), '0.5');
  assert.equal(globalThis.localStorage.getItem('kiroku:theater:muted'), 'false');

  mockVideo.playbackRate = 1.5;
  mockVideo.dispatchEvent('ratechange');
  assert.equal(globalThis.localStorage.getItem('kiroku:theater:rate'), '1.5');
});

test('Slice 31: TheaterView recent files, offset controls, and next episode', async () => {
  globalThis.localStorage.clear();
  const { TheaterView } = await import('../src/ui/views/theater.js');

  const view = new TheaterView();

  // 1. Test Recent Files management
  const file1 = { name: 'Frieren_Ep01.mp4', size: 500000000, lastModified: 1700000000000 };
  const file2 = { name: 'Frieren_Ep02.mp4', size: 510000000, lastModified: 1700001000000 };
  view.addRecentFile(file1);
  view.addRecentFile(file2);

  const recents = view.getRecentFiles();
  assert.equal(recents.length, 2);
  assert.equal(recents[0].name, 'Frieren_Ep02.mp4', 'Most recent file should be at index 0');

  // 2. Test Subtitle Offset manipulation
  assert.equal(view.subtitleOffsetMs, 0);
  view.setSubtitleOffset(-100, true);
  assert.equal(view.subtitleOffsetMs, -100);
  assert.equal(view.playerAdapter.offsetSec, -0.1);

  view.setSubtitleOffset(100, true);
  assert.equal(view.subtitleOffsetMs, 0);
  assert.equal(view.playerAdapter.offsetSec, 0);

  view.setSubtitleOffset(100, true);
  assert.equal(view.subtitleOffsetMs, 100);
  assert.equal(view.playerAdapter.offsetSec, 0.1);

  view.setSubtitleOffset(0, false);
  assert.equal(view.subtitleOffsetMs, 0);
  assert.equal(view.playerAdapter.offsetSec, 0);

  // 3. Test next episode navigation
  const folder = [file1, file2];
  view.openVideoFile(file1, folder);
  assert.equal(view.currentFileName, 'Frieren_Ep01.mp4');
  assert.equal(view.nextEpisodeFile?.name, 'Frieren_Ep02.mp4');

  view.playNextEpisode();
  assert.equal(view.currentFileName, 'Frieren_Ep02.mp4');
  assert.equal(view.nextEpisodeFile, null, 'Last file has no next episode');

  // 4. Test drag-drop subtitle loading directly
  const srtContent = `1\n00:00:01,000 --> 00:00:03,000\n勇者ヒンメル`;
  const subFile = {
    name: 'Frieren_Ep02.srt',
    async text() {
      return srtContent;
    }
  };
  await view.loadSubtitleFile(subFile);
  assert.equal(view.currentSubName, 'Frieren_Ep02.srt');
  assert.equal(view.playerAdapter.cues.length, 1);
  assert.equal(view.playerAdapter.cues[0].text, '勇者ヒンメル');

  // 5. Test unmount cleanup
  view.unmount();
});
