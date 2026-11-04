/**
 * Slice 39 Unit Tests: Vocab Watch Live Sentence Panel & Controls
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const vocabWatchPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'vocab_watch.js');
const watchCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'watch.css');
const vocabMainPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'vocab_main.js');

test('Vocab Watch: vocab_main.js imports vocab_watch.js', () => {
  const vocabMainCode = fs.readFileSync(vocabMainPath, 'utf8');
  assert.ok(
    vocabMainCode.includes("import './vocab_watch.js';"),
    'vocab_main.js must contain import of vocab_watch.js'
  );
});

test('Vocab Watch: watch.css exists and adheres to design system contracts', () => {
  assert.ok(fs.existsSync(watchCssPath), 'watch.css must exist');
  const css = fs.readFileSync(watchCssPath, 'utf8');
  assert.ok(css.includes('.watch-view-wrapper'), 'Must style .watch-view-wrapper');
  assert.ok(css.includes('.watch-session-header'), 'Must style session header');
  assert.ok(css.includes('.watch-active-tokens'), 'Must style active tokens');
  assert.ok(css.includes('.watch-token-chip'), 'Must style token chip');
  assert.ok(css.includes('.is-known'), 'Must support known status class');
  assert.ok(css.includes('.is-gap'), 'Must support gap status class');
  assert.ok(css.includes('.is-new'), 'Must support new status class');
  assert.ok(css.includes('.watch-controls-bar'), 'Must style controls bar');
  assert.ok(css.includes('.watch-peek-box'), 'Must style cue peeks');
  assert.ok(css.includes('.watch-grammar-accordion'), 'Must style grammar accordion');
});

test('Vocab Watch: Controller defines three states and layout structure', async () => {
  assert.ok(fs.existsSync(vocabWatchPath), 'vocab_watch.js must exist');
  const code = fs.readFileSync(vocabWatchPath, 'utf8');

  // Verify state handling
  assert.ok(code.includes('not-connected'), 'Must handle not-connected state');
  assert.ok(code.includes('connected-no-video'), 'Must handle connected-no-video state');
  assert.ok(code.includes('watching'), 'Must handle watching state');

  // Verify controls
  assert.ok(code.includes('btn-watch-play-pause'), 'Must provide play/pause control');
  assert.ok(code.includes('btn-watch-seek-back'), 'Must provide -5s seek control');
  assert.ok(code.includes('btn-watch-seek-fwd'), 'Must provide +5s seek control');
  assert.ok(code.includes('btn-watch-prev-cue'), 'Must provide prev cue control');
  assert.ok(code.includes('btn-watch-next-cue'), 'Must provide next cue control');
  assert.ok(code.includes('btn-watch-replay-cue'), 'Must provide replay cue control');
  assert.ok(code.includes('btn-watch-loop-cue'), 'Must provide loop cue control');
  assert.ok(code.includes('watch-rate-select'), 'Must provide speed selection');
  assert.ok(code.includes('btn-watch-offset-minus'), 'Must provide subtitle offset controls');

  // Verify API endpoints
  assert.ok(code.includes('/api/subtitle/annotate'), 'Must annotate via /api/subtitle/annotate');
  assert.ok(code.includes('/api/grammar/analyze'), 'Must analyze grammar via /api/grammar/analyze');

  // Verify keyboard navigation & hover-pause
  assert.ok(code.includes("'Space'"), 'Must handle Space key');
  assert.ok(code.includes("'ArrowLeft'"), 'Must handle Left Arrow key');
  assert.ok(code.includes("'ArrowRight'"), 'Must handle Right Arrow key');
  assert.ok(code.includes('hoverPauseEnabled'), 'Must implement hover-pause toggle');
});

test('Vocab Watch: Functional behavior with mock LinkStore and ApiClient', async () => {
  const { VocabWatchView } = await import('../src/ui/views/vocab_watch.js');

  const mockClient = {
    requestCalls: [],
    async request(url, options = {}) {
      mockClient.requestCalls.push({ url, options });
      if (url === '/api/subtitle/annotate') {
        return {
          version: 1,
          cues: [
            {
              id: 0,
              text: '猫が好きです',
              tokens: [
                { surface: '猫', reading: 'ねこ', status: 'known' },
                { surface: 'が', reading: 'が', status: 'unstyled' },
                { surface: '好き', reading: 'すき', status: 'gap' },
                { surface: 'です', reading: 'です', status: 'unstyled' }
              ]
            }
          ]
        };
      }
      if (url === '/api/grammar/analyze') {
        return {
          sentence: '猫が好きです',
          learner_level: 'N4',
          points: [{ id: 'gp1', point: 'が好き', level: 'N5', title: 'To like something' }]
        };
      }
      return {};
    }
  };

  const listeners = new Map();
  const mockStore = {
    status: 'connected',
    activeSession: { site: 'youtube', title: 'Japanese vlog', duration: 180 },
    videoState: { t: 42, paused: false, rate: 1 },
    cues: [
      { i: 0, s: 0, e: 5, text: 'こんにちは' },
      { i: 1, s: 6, e: 10, text: '猫が好きです' },
      { i: 2, s: 11, e: 15, text: 'さようなら' }
    ],
    activeCue: { i: 1, s: 6, e: 10, text: '猫が好きです' },
    activeCueIndex: 1,
    commandsSent: [],
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
    getStatusSummary() {
      return {
        connected: this.status === 'connected',
        status: this.status,
        activeSession: this.activeSession,
        videoState: this.videoState,
        activeCue: this.activeCue,
        activeCueIndex: this.activeCueIndex,
        cues: this.cues
      };
    },
    play() { this.commandsSent.push('play'); },
    pause() { this.commandsSent.push('pause'); },
    toggle() { this.commandsSent.push('toggle'); },
    play() { this.commandsSent.push('play'); },
    pause() { this.commandsSent.push('pause'); },
    seek(t, delta) { this.commandsSent.push({ cmd: 'seek', t, delta }); },
    jumpCue(opts) { this.commandsSent.push({ cmd: 'cue', opts }); },
    loop(s, e) { this.commandsSent.push({ cmd: 'loop', s, e }); },
    setRate(r) { this.commandsSent.push({ cmd: 'rate', r }); },
    setOffset(ms) { this.commandsSent.push({ cmd: 'offset', ms }); }
  };

  const fakeContainer = { innerHTML: '' };
  const view = new VocabWatchView({
    apiClient: mockClient,
    linkStore: mockStore
  });

  await view.mount(fakeContainer);

  assert.equal(view.state, 'watching');
  assert.equal(view.formatTime(65), '01:05');
  assert.equal(view.formatTime(0), '00:00');

  // Verify surrounding cues
  view._updateCueSurroundings();
  assert.equal(view.prevCue?.text, 'こんにちは');
  assert.equal(view.nextCue?.text, 'さようなら');

  // Test control actions
  view.replayActiveCue();
  assert.ok(mockStore.commandsSent.some(c => c.cmd === 'seek' && c.t === 6));

  view.loopActiveCue();
  assert.ok(mockStore.commandsSent.some(c => c.cmd === 'loop' && c.s === 6 && c.e === 10));

  view.jumpPrevCue();
  assert.ok(mockStore.commandsSent.some(c => c.cmd === 'cue' && c.opts.delta === -1));

  view.jumpNextCue();
  assert.ok(mockStore.commandsSent.some(c => c.cmd === 'cue' && c.opts.delta === 1));

  // Test token HTML generation
  const tokensHtml = view._generateTokenChipsHtml([
    { surface: '猫', reading: 'ねこ', status: 'known' },
    { surface: '好き', status: 'gap' },
    { surface: '新しい', status: 'new' }
  ]);
  assert.ok(tokensHtml.includes('is-known'));
  assert.ok(tokensHtml.includes('is-gap'));
  assert.ok(tokensHtml.includes('is-new'));
  assert.ok(tokensHtml.includes('ねこ'));

  // Test prefetch batching
  await view.prefetchAnnotations(mockStore.cues, 0);
  assert.ok(mockClient.requestCalls.some(c => c.url === '/api/subtitle/annotate'));

  // Test unmount
  view.unmount();
});
