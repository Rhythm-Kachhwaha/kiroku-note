/**
 * Slice 41 Unit Tests: Link Mining Service & Clip Capture
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { LinkClipHandler } = require('../../extension/link/clip.js');

test('LinkClipHandler: Processes cmd.clip with fallback and formats envelope', async () => {
  const handler = new LinkClipHandler({
    getVideoElement: () => null,
    captureVisibleTab: async () => 'data:image/jpeg;base64,mockTabCapture'
  });

  const payload = {
    reqId: 'clip-req-test-1',
    s: 12.5,
    e: 15.0,
    want: ['image', 'audio']
  };

  const result = await handler.handleClipCommand(payload);
  assert.equal(result.reqId, 'clip-req-test-1');
  assert.equal(result.image_b64, 'data:image/jpeg;base64,mockTabCapture');
  assert.equal(result.audio_b64, null); // Graceful fallback
  assert.equal(result.ok, true);

  const envelope = handler.createResultEnvelope(result, 'sess-test', 5);
  assert.equal(envelope.v, 1);
  assert.equal(envelope.type, 'clip.result');
  assert.equal(envelope.src, 'ext');
  assert.equal(envelope.sid, 'sess-test');
  assert.equal(envelope.payload.reqId, 'clip-req-test-1');
  assert.equal(envelope.payload.image_b64, 'data:image/jpeg;base64,mockTabCapture');
});

test('LinkClipHandler: Handles headless / no media gracefully', async () => {
  const handler = new LinkClipHandler({
    getVideoElement: () => null,
    captureVisibleTab: null
  });

  const result = await handler.handleClipCommand({ reqId: 'req-empty' });
  assert.equal(result.reqId, 'req-empty');
  assert.equal(result.image_b64, null);
  assert.equal(result.audio_b64, null);
  assert.equal(result.ok, true);
});

test('LinkMineService: Successful clip capture and card creation', async () => {
  const { LinkMineService } = await import('../src/ui/services/link_mine.js');

  const listeners = new Map();
  const mockStore = {
    status: 'connected',
    requestedClips: [],
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    off(event, fn) {
      const arr = listeners.get(event) || [];
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    emit(event, ...args) {
      (listeners.get(event) || []).forEach(fn => fn(...args));
    },
    requestClip(reqId, s, e, want) {
      this.requestedClips.push({ reqId, s, e, want });
      // Simulate async response from extension
      setTimeout(() => {
        this.emit('clip:result', {
          reqId,
          image_b64: 'data:image/jpeg;base64,testImage',
          audio_b64: 'data:audio/mp3;base64,testAudio'
        });
      }, 10);
    }
  };

  const savedCards = [];
  const knownWords = [];
  const mockApi = {
    async saveCard(data) {
      savedCards.push(data);
      return { id: 'card-101', ...data };
    },
    async markWordKnown(word) {
      knownWords.push(word);
      return { ok: true };
    }
  };

  const service = new LinkMineService({
    linkStore: mockStore,
    apiClient: mockApi,
    clipTimeoutMs: 1000
  });

  const res = await service.mineWord({
    expression: '猫',
    reading: 'ねこ',
    meaning: 'cat',
    cue: { s: 5.0, e: 8.0, text: '猫が好きです。' },
    session: { title: 'Anime Ep 1', site: 'netflix' }
  });

  assert.equal(res.ok, true);
  assert.equal(res.cardId, 'card-101');
  assert.equal(res.mediaCaptured, true);
  assert.equal(res.timedOut, false);
  assert.equal(res.expression, '猫');

  // Verify saved card payload
  assert.equal(savedCards.length, 1);
  assert.equal(savedCards[0].expression, '猫');
  assert.equal(savedCards[0].example_sentence, '猫が好きです。');
  assert.equal(savedCards[0].image_data, 'data:image/jpeg;base64,testImage');
  assert.equal(savedCards[0].audio_data, 'data:audio/mp3;base64,testAudio');

  // Verify word was marked known
  assert.ok(knownWords.includes('猫'));
});

test('LinkMineService: Clip timeout persists card without media', async () => {
  const { LinkMineService } = await import('../src/ui/services/link_mine.js');

  const mockStore = {
    status: 'connected',
    on() {},
    off() {},
    requestClip() {
      // Intentionally do not respond to test timeout
    }
  };

  const savedCards = [];
  const mockApi = {
    async saveCard(data) {
      savedCards.push(data);
      return { id: 'card-no-media', ...data };
    },
    async markWordKnown() {}
  };

  const service = new LinkMineService({
    linkStore: mockStore,
    apiClient: mockApi,
    clipTimeoutMs: 50 // Short timeout for test
  });

  const res = await service.mineWord({
    expression: '犬',
    reading: 'いぬ',
    meaning: 'dog',
    cue: { s: 10, e: 12, text: '大きな犬です。' }
  });

  assert.equal(res.ok, true);
  assert.equal(res.cardId, 'card-no-media');
  assert.equal(res.mediaCaptured, false);
  assert.equal(res.timedOut, true);

  assert.equal(savedCards.length, 1);
  assert.equal(savedCards[0].image_data, null);
  assert.equal(savedCards[0].audio_data, null);
});

test('LinkMineService: API failure returns error with retry function', async () => {
  const { LinkMineService } = await import('../src/ui/services/link_mine.js');

  let callCount = 0;
  const mockApi = {
    async saveCard(data) {
      callCount++;
      if (callCount === 1) {
        throw new Error('Database temporarily locked');
      }
      return { id: 'card-retry-ok', ...data };
    }
  };

  const service = new LinkMineService({
    linkStore: { status: 'disconnected' },
    apiClient: mockApi
  });

  const res1 = await service.mineWord({ expression: '本' });
  assert.equal(res1.ok, false);
  assert.ok(res1.error.includes('Database temporarily locked'));
  assert.equal(typeof res1.retry, 'function');

  // Test retry function
  const res2 = await res1.retry();
  assert.equal(res2.ok, true);
  assert.equal(res2.cardId, 'card-retry-ok');
});

test('VocabWatchView: mineTerm marks token known in cache', async () => {
  const { VocabWatchView } = await import('../src/ui/views/vocab_watch.js');

  let savedCardData = null;
  const mockMineService = {
    async mineWord(params) {
      savedCardData = params;
      return {
        ok: true,
        cardId: 'mock-c1',
        mediaCaptured: true,
        timedOut: false,
        expression: params.expression
      };
    }
  };

  const view = new VocabWatchView({
    linkMineService: mockMineService
  });

  view.activeCue = { text: '桜が綺麗です。', s: 2, e: 5 };
  view.annotationsCache.set('桜が綺麗です。', [
    { surface: '桜', status: 'gap', known: false },
    { surface: 'が', status: 'unstyled' },
    { surface: '綺麗', status: 'new', known: false }
  ]);

  const res = await view.mineTerm('桜', 'さくら', 'cherry blossom');
  assert.equal(res.ok, true);

  // Assert token in cache turned known
  const tokens = view.annotationsCache.get('桜が綺麗です。');
  const sakura = tokens.find(t => t.surface === '桜');
  assert.equal(sakura.status, 'known');
  assert.equal(sakura.known, true);
});
