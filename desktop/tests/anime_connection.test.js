import test from 'node:test';
import assert from 'node:assert/strict';
import { LinkStore } from '../src/ui/services/link_store.js';
import { AnimeView } from '../src/ui/views/anime.js';

class MockEventEmitter {
  constructor() {
    this.handlers = new Map();
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
  }
  off(event, fn) {
    if (this.handlers.has(event)) this.handlers.get(event).delete(fn);
  }
  emit(event, ...args) {
    if (this.handlers.has(event)) {
      for (const fn of this.handlers.get(event)) fn(...args);
    }
  }
  sendCommand(type, payload) {
    return { type, payload };
  }
}

test('LinkStore: handles peer.status, sub.status, video.detach, and chunked cue.list', () => {
  const fakeClient = new MockEventEmitter();
  fakeClient.status = 'connected';
  const store = new LinkStore(fakeClient);

  // 1. peer.status
  fakeClient.emit('peer.status', { ext: 2, desk: 1 });
  assert.equal(store.peerCounts.ext, 2);
  assert.equal(store.peerCounts.desk, 1);

  // 2. sub.status
  fakeClient.emit('sub.status', { count: 320, ja: true });
  assert.equal(store.subStatus.count, 320);
  assert.equal(store.subStatus.ja, true);

  // 3. Chunked cue.list reassembly
  fakeClient.emit('cue.list', {
    hash: 'chunk-test-hash',
    part: 1,
    parts: 2,
    cues: [{ i: 0, s: 1.0, e: 2.0, text: 'Part 1' }]
  });
  // Not yet complete
  assert.equal(store.cues.length, 0);

  fakeClient.emit('cue.list', {
    hash: 'chunk-test-hash',
    part: 2,
    parts: 2,
    cues: [{ i: 1, s: 2.5, e: 3.5, text: 'Part 2' }]
  });
  // Now assembled
  assert.equal(store.cues.length, 2);
  assert.equal(store.cueHash, 'chunk-test-hash');
  assert.equal(store.cues[0].text, 'Part 1');
  assert.equal(store.cues[1].text, 'Part 2');

  // 4. video.attach then video.detach
  fakeClient.emit('video.attach', { tab: 42, site: 'crunchyroll', title: 'Frieren Ep 1', duration: 1400 });
  assert.equal(store.activeTabId, 42);
  assert.equal(store.activeSession.title, 'Frieren Ep 1');

  fakeClient.emit('video.detach', { tab: 42 });
  assert.equal(store.activeTabId, null);
  assert.equal(store.activeSession, null);
  assert.equal(store.cues.length, 0);
});

test('AnimeView: renderConnectionStepper renders 4 steps and updates with connection states', () => {
  const fakeClient = new MockEventEmitter();
  fakeClient.status = 'connected';
  const store = new LinkStore(fakeClient);

  const view = new AnimeView({ linkClient: fakeClient, linkStore: store });

  // Initial disconnected extension state
  let html = view.renderConnectionStepper(store.getStatusSummary());
  assert.ok(html.includes('anime-connection-stepper-card'));
  assert.ok(html.includes('Step 1: Link Hub Backend'));
  assert.ok(html.includes('Step 2: Extension Online'));
  assert.ok(html.includes('Step 3: Video Detected'));
  assert.ok(html.includes('Step 4: Subtitles Loaded'));
  assert.ok(html.includes('Extension not connected'));

  // When extension connects
  fakeClient.emit('peer.status', { ext: 1, desk: 1 });
  html = view.renderConnectionStepper(store.getStatusSummary());
  assert.ok(html.includes('Browser extension connected'));

  // When video attaches
  fakeClient.emit('video.attach', { tab: 1, site: 'youtube', title: 'Sample Anime', duration: 300 });
  html = view.renderConnectionStepper(store.getStatusSummary());
  assert.ok(html.includes('Sample Anime'));

  // When reject banner is set
  view.lastReject = { reason: 'invalid_token', role: 'ext', origin: 'chrome-extension://xyz' };
  html = view.renderConnectionStepper(store.getStatusSummary());
  assert.ok(html.includes('anime-reject-banner'));
  assert.ok(html.includes('Extension Connection Rejected (invalid_token)'));
});

