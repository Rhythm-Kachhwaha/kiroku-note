/**
 * Slice 30 Unit Tests: Smart Pause (threshold N, auto-replay once) & Session Stats
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const animeViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'anime.js');
const sessionPyPath = path.join(repoRoot, 'backend', 'app', 'link', 'session.py');
const linkPyPath = path.join(repoRoot, 'backend', 'app', 'api', 'link.py');

test('Slice 30: Static checks for smart pause and session stats', () => {
  const animeJs = fs.readFileSync(animeViewPath, 'utf8');
  assert.ok(animeJs.includes('anime-smart-pause-card'), 'Must render smart pause card');
  assert.ok(animeJs.includes('anime-smart-pause-toggle'), 'Must render smart pause toggle');
  assert.ok(animeJs.includes('anime-smart-pause-threshold'), 'Must render threshold input');
  assert.ok(animeJs.includes('anime-smart-auto-replay'), 'Must render auto replay toggle');
  assert.ok(animeJs.includes('_flushSessionStats'), 'Must implement _flushSessionStats');
  assert.ok(animeJs.includes('/api/link/sessions'), 'Must call /api/link/sessions');

  const sessionPy = fs.readFileSync(sessionPyPath, 'utf8');
  assert.ok(sessionPy.includes('link_session_stat'), 'Must have link_session_stat table');
  assert.ok(sessionPy.includes('save_session_stat'), 'Must have save_session_stat');
  assert.ok(sessionPy.includes('list_session_stats'), 'Must have list_session_stats');

  const linkPy = fs.readFileSync(linkPyPath, 'utf8');
  assert.ok(linkPy.includes('/sessions'), 'Must define /sessions endpoint');
});

// Simple MockElement helper
function createMockElement(tag = 'div', id = '') {
  const classListSet = new Set();
  return {
    tagName: tag.toUpperCase(),
    id,
    dataset: {},
    style: {},
    checked: false,
    value: '',
    children: [],
    listeners: {},
    classList: {
      add: (c) => classListSet.add(c),
      remove: (c) => classListSet.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classListSet.has(c)) classListSet.delete(c);
          else classListSet.add(c);
        } else if (force) classListSet.add(c);
        else classListSet.delete(c);
      },
      contains: (c) => classListSet.has(c)
    },
    addEventListener(event, fn) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    },
    dispatchEvent(event) {
      const fns = this.listeners[event.type] || [];
      fns.forEach(fn => fn(event));
    },
    querySelector(sel) {
      if (sel.startsWith('#')) {
        const targetId = sel.slice(1);
        return this._findChild(el => el.id === targetId);
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
    _findChild(pred) {
      for (const child of this.children) {
        if (pred(child)) return child;
        if (child._findChild) {
          const found = child._findChild(pred);
          if (found) return found;
        }
      }
      return null;
    }
  };
}

test('Slice 30: Smart pause logic and session stats persistence', async () => {
  const { AnimeView } = await import('../src/ui/views/anime.js');

  const pausedCalls = [];
  const seekCalls = [];
  const fakeStore = {
    status: 'connected',
    activeSession: { tab: 42, site: 'crunchyroll', title: 'Smart Pause Test', duration: 120 },
    videoState: { t: 10.0, paused: false, rate: 1.0 },
    cueHash: 'hash-smart-pause',
    activeCueIndex: 0,
    activeCue: { i: 0, s: 5.0, e: 8.0, text: '魔王を倒す旅に出る' },
    cues: [
      { i: 0, s: 5.0, e: 8.0, text: '魔王を倒す旅に出る' }
    ],
    listeners: new Map(),
    on(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(fn);
    },
    off() {},
    pause() {
      pausedCalls.push(true);
    },
    seek(sec) {
      seekCalls.push(sec);
    },
    getStatusSummary() {
      return {
        status: this.status,
        activeSession: this.activeSession,
        videoState: this.videoState,
        cueHash: this.cueHash,
        activeCueIndex: this.activeCueIndex,
        activeCue: this.activeCue,
        cueCount: this.cues.length
      };
    }
  };

  const postedRequests = [];
  const fakeApiClient = {
    async request(url, opts = {}) {
      postedRequests.push({ url, opts });
      return { ok: true };
    }
  };

  const view = new AnimeView(null, {
    linkStore: fakeStore,
    apiClient: fakeApiClient
  });

  // Set up mock container
  const container = createMockElement('div');
  const toggleEl = createMockElement('input', 'anime-smart-pause-toggle');
  const threshEl = createMockElement('input', 'anime-smart-pause-threshold');
  const replayEl = createMockElement('input', 'anime-smart-auto-replay');
  container.children.push(toggleEl, threshEl, replayEl);

  view.container = container;
  view.setupEvents();

  // 1. Verify event handlers change state
  toggleEl.checked = true;
  toggleEl.dispatchEvent({ type: 'change', target: toggleEl });
  assert.equal(view.smartPauseEnabled, true, 'smartPauseEnabled should be true');

  threshEl.value = '3';
  threshEl.dispatchEvent({ type: 'change', target: threshEl });
  assert.equal(view.smartPauseThreshold, 3, 'smartPauseThreshold should be 3');

  replayEl.checked = true;
  replayEl.dispatchEvent({ type: 'change', target: replayEl });
  assert.equal(view.smartAutoReplay, true, 'smartAutoReplay should be true');

  // 2. Test Smart Pause & Auto Replay on Cue with Gap Words
  // Pre-load annotation for cue i=0 with 3 gap words
  view.annotatedCuesMap.set('hash-smart-pause:0', {
    gap_words: [{ word: '魔王' }, { word: '倒す' }, { word: '旅' }]
  });
  view.annotatedCuesMap.set(0, {
    gap_words: [{ word: '魔王' }, { word: '倒す' }, { word: '旅' }]
  });

  // First time cue is seen with auto-replay: should seek to cue.s
  view.updateFromStore();
  assert.equal(seekCalls.length, 1, 'Should trigger seek for auto-replay once');
  assert.equal(seekCalls[0], 5.0);
  assert.equal(pausedCalls.length, 0, 'Should not pause yet when auto-replaying');

  // Trigger again after replay: should pause
  view.seenCueIndices.clear(); // Simulate re-entering the cue
  view.updateFromStore();
  assert.equal(pausedCalls.length, 1, 'Should trigger pause after auto-replay');

  // 3. Test Session Stats collection
  assert.equal(view.sessionLinesSeen, 2);
  assert.equal(view.sessionGapWordsSeen, 6);

  // 4. Test unmount flushes session stats
  view.sessionMinedCount = 1;
  view.sessionWatchSeconds = 12.4;
  view.unmount();

  assert.ok(postedRequests.some(r => r.url === '/api/link/sessions' && r.opts.method === 'POST'), 'Must post session stats on unmount');
  const statPost = postedRequests.find(r => r.url === '/api/link/sessions');
  assert.equal(statPost.opts.body.site, 'crunchyroll');
  assert.equal(statPost.opts.body.words_mined, 1);
  assert.equal(statPost.opts.body.lines_seen, 2);
});
