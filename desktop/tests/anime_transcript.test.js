/**
 * Slice 27 Unit Tests: Anime Transcript Strip with Token Coloring, Virtualization & Filters
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const animeViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'anime.css');

test('Slice 27 Transcript: Static structure in anime.js and CSS', () => {
  const animeJs = fs.readFileSync(animeViewPath, 'utf8');
  assert.ok(animeJs.includes('anime-transcript-strip') || animeJs.includes('anime-transcript-container'), 'Must have transcript container');
  assert.ok(animeJs.includes('anime-transcript-list'), 'Must have transcript list element');
  assert.ok(animeJs.includes('anime-transcript-filter'), 'Must have transcript filter dropdown');
  assert.ok(animeJs.includes('btn-anime-toggle-coloring'), 'Must have coloring toggle button');
  assert.ok(animeJs.includes('/api/link/cues/'), 'Must fetch annotated cues from /api/link/cues/{hash}');
  assert.ok(animeJs.includes('/api/link/cue-grammar'), 'Must fetch cue grammar from /api/link/cue-grammar');

  const css = fs.readFileSync(animeCssPath, 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'anime.css must not contain raw hex');
  assert.ok(css.includes('.anime-transcript-container'), 'Must style transcript container');
  assert.ok(css.includes('.anime-transcript-item'), 'Must style transcript item');
  assert.ok(css.includes('.anime-token-chip'), 'Must style token chip');
  assert.ok(css.includes('.anime-grammar-chip'), 'Must style grammar chip');
  assert.ok(css.includes('.hide-token-colors'), 'Must support hide-token-colors state');
});

test('Slice 27 Transcript: Rendering, seeking on click, and token coloring', async () => {
  const { AnimeView } = await import('../src/ui/views/anime.js');

  const seekCalls = [];
  const fakeStore = {
    status: 'connected',
    activeSession: { site: 'youtube', title: 'Sousou no Frieren', duration: 1200 },
    videoState: { t: 45.0, paused: false, rate: 1.0 },
    cueHash: 'hash-frieren-ep1',
    activeCueIndex: 1,
    activeCue: { i: 1, s: 42.0, e: 46.5, text: '魔法が好きなんです' },
    cues: [
      { i: 0, s: 10.0, e: 15.0, text: 'こんにちは' },
      { i: 1, s: 42.0, e: 46.5, text: '魔法が好きなんです' },
      { i: 2, s: 60.0, e: 65.0, text: '冒険に出かけよう' }
    ],
    listeners: new Map(),
    on(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(fn);
    },
    off(event, fn) {
      const arr = this.listeners.get(event) || [];
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    emit(event, ...args) {
      (this.listeners.get(event) || []).forEach(fn => fn(...args));
    },
    getStatusSummary() {
      return {
        connected: this.status === 'connected',
        status: this.status,
        activeSession: this.activeSession,
        videoState: this.videoState,
        activeCue: this.activeCue,
        activeCueIndex: this.activeCueIndex,
        cueCount: this.cues.length,
        cueHash: this.cueHash
      };
    },
    seek(t, delta) {
      seekCalls.push({ t, delta });
    }
  };

  const fakeApiClient = {
    calls: [],
    async request(url) {
      fakeApiClient.calls.push(url);
      if (url.startsWith('/api/link/cues/')) {
        return {
          hash: 'hash-frieren-ep1',
          count: 3,
          cues: [
            {
              i: 0,
              s: 10.0,
              e: 15.0,
              text: 'こんにちは',
              tokens: [{ surface: 'こんにちは', status: 'known' }],
              gap_words: []
            },
            {
              i: 1,
              s: 42.0,
              e: 46.5,
              text: '魔法が好きなんです',
              tokens: [
                { surface: '魔法', status: 'known' },
                { surface: 'が', status: 'unstyled' },
                { surface: '好き', status: 'known' },
                { surface: 'な', status: 'unstyled' },
                { surface: 'ん', status: 'unstyled' },
                { surface: 'です', status: 'unstyled' }
              ],
              gap_words: []
            },
            {
              i: 2,
              s: 60.0,
              e: 65.0,
              text: '冒険に出かけよう',
              tokens: [
                { surface: '冒険', status: 'gap' },
                { surface: 'に', status: 'unstyled' },
                { surface: '出かけよう', status: 'unknown' }
              ],
              gap_words: ['冒険', '出かける']
            }
          ]
        };
      }
      if (url.startsWith('/api/link/cue-grammar')) {
        return {
          hash: 'hash-frieren-ep1',
          i: 1,
          points: [
            { id: 'g1', point: 'んです', level: 'N4', title: 'Explanatory mode' },
            { id: 'g2', point: '魔法', level: 'N2', title: 'Advanced noun' }
          ]
        };
      }
      return {};
    }
  };

  // Test DOM harness
  class MockElement {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.attributes = {};
      const set = new Set();
      this.classList = {
        add: (...c) => c.forEach(x => set.add(x)),
        remove: (...c) => c.forEach(x => set.delete(x)),
        contains: (c) => set.has(c),
        toggle: (c, force) => {
          if (force !== undefined) {
            if (force) set.add(c); else set.delete(c);
            return force;
          }
          if (set.has(c)) { set.delete(c); return false; }
          set.add(c); return true;
        },
        has: (c) => set.has(c)
      };
      this.dataset = {};
      this.style = {};
      this._textContent = '';
      this._innerHTML = '';
      this.listeners = {};
      this.value = '';
    }

    get textContent() { return this._textContent; }
    set textContent(val) { this._textContent = String(val); }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(val) {
      this._innerHTML = val;
      this._parseSimpleHtml(val);
    }

    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k]; }
    removeAttribute(k) { delete this.attributes[k]; }

    addEventListener(ev, fn) {
      if (!this.listeners[ev]) this.listeners[ev] = [];
      this.listeners[ev].push(fn);
    }

    click() {
      (this.listeners['click'] || []).forEach(fn => fn({ target: this, closest: (sel) => this.closest(sel) }));
    }

    closest(selector) {
      if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) return this;
      if (selector.startsWith('#') && this.attributes.id === selector.slice(1)) return this;
      return null;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
      const results = [];
      const match = (el) => {
        if (!el || typeof el !== 'object') return;
        if (selector.startsWith('#') && el.attributes?.id === selector.slice(1)) {
          results.push(el);
        } else if (selector.startsWith('.') && el.classList?.contains(selector.slice(1))) {
          results.push(el);
        } else if (selector.toLowerCase() === el.tagName.toLowerCase()) {
          results.push(el);
        }
        for (const child of el.children || []) {
          match(child);
        }
      };
      for (const child of this.children) {
        match(child);
      }
      return results;
    }

    _parseSimpleHtml(html) {
      this.children = [];
      const tagRegex = /<([a-z0-9-]+)([^>]*)>([\s\S]*?)<\/\1>/gi;
      let m;
      while ((m = tagRegex.exec(html)) !== null) {
        const tagName = m[1];
        const rawAttrs = m[2];
        const inner = m[3];
        const child = new MockElement(tagName);
        const idMatch = rawAttrs.match(/id="([^"]+)"/);
        if (idMatch) child.attributes.id = idMatch[1];
        const classMatch = rawAttrs.match(/class="([^"]+)"/);
        if (classMatch) {
          classMatch[1].split(/\s+/).forEach(c => child.classList.add(c));
        }
        const dataStart = rawAttrs.match(/data-start="([^"]+)"/);
        if (dataStart) child.dataset.start = dataStart[1];
        const dataCueIdx = rawAttrs.match(/data-cue-index="([^"]+)"/);
        if (dataCueIdx) child.dataset.cueIndex = dataCueIdx[1];
        const dataLevel = rawAttrs.match(/data-level="([^"]+)"/);
        if (dataLevel) child.dataset.level = dataLevel[1];

        if (/<[a-z0-9-]+/i.test(inner)) {
          child._parseSimpleHtml(inner);
        }
        this.children.push(child);
      }
    }
  }

  const container = new MockElement('div');
  const view = new AnimeView({}, {
    apiClient: fakeApiClient,
    learnerLevel: 'N4'
  });
  view.container = container;
  view.linkStore = fakeStore;

  view.render();
  view.setupEvents();
  view.updateFromStore();

  // Wait for initial fetch
  await new Promise(r => setTimeout(r, 10));

  // Check cues rendered
  const items = container.querySelectorAll('.anime-transcript-item');
  assert.strictEqual(items.length, 3, 'Should render 3 transcript items');

  // Verify active cue has active class
  const activeItem = items.find(it => it.classList.contains('is-active'));
  assert.ok(activeItem, 'Active cue must have .is-active class');
  assert.strictEqual(activeItem.dataset.cueIndex, '1', 'Cue index 1 must be active');

  // Test click to seek
  const firstItem = items[0];
  assert.ok(firstItem.dataset.start, 'Cue item should have data-start');
  const listEl = container.querySelector('#anime-transcript-list');
  (listEl.listeners['click'] || []).forEach(fn => fn({ target: firstItem }));
  assert.ok(seekCalls.length > 0, 'Clicking cue must call seek');
  assert.strictEqual(seekCalls[0].t, 10.0, 'Must seek to cue start time 10.0');

  // Test token coloring toggle
  const toggleBtn = container.querySelector('#btn-anime-toggle-coloring');
  assert.ok(toggleBtn, 'Toggle coloring button must exist');
  toggleBtn.click();
  assert.strictEqual(view.showTokenColors, false, 'Coloring should be toggled off');

  // Test Filter: only lines with <=1 unknown
  view.currentFilter = 'max1gap';
  view.renderTranscriptList();
  const filteredMax1 = container.querySelectorAll('.anime-transcript-item');
  // Cues 0 and 1 have 0 gap words, cue 2 has 2 gap words
  assert.strictEqual(filteredMax1.length, 2, 'Only cues with <= 1 unknown should render');

  // Test Filter: gap (lines with unknown words only)
  view.currentFilter = 'gap';
  view.renderTranscriptList();
  const filteredGap = container.querySelectorAll('.anime-transcript-item');
  // Cue 2 has 2 gap words ('冒険', '出かけよう'), cues 0 and 1 have none
  assert.strictEqual(filteredGap.length, 1, 'Only cue with gap words should render');
  assert.strictEqual(filteredGap[0].dataset.cueIndex, '2');

  // Test Connection chip in header
  const chip = container.querySelector('#anime-connection-chip');
  assert.ok(chip.classList.contains('is-connected'));
  assert.ok(chip.innerHTML.includes('Connected to youtube'));
  assert.ok(chip.innerHTML.includes('anime-connection-dot'));

  // Test connecting state
  fakeStore.status = 'connecting';
  view.updateFromStore();
  assert.ok(chip.classList.contains('is-connecting'));
  assert.ok(chip.innerHTML.includes('Connecting…'));

  // Test disconnected state
  fakeStore.status = 'disconnected';
  view.updateFromStore();
  assert.ok(chip.classList.contains('is-disconnected'));
  assert.ok(chip.innerHTML.includes('Not Connected'));

  // Test Filter: grammar above my level (user is N4, point is N2)
  await view.fetchCueGrammar('hash-frieren-ep1', 1);
  view.currentFilter = 'grammar-above';
  view.renderTranscriptList();
  const filteredGrammar = container.querySelectorAll('.anime-transcript-item');
  assert.strictEqual(filteredGrammar.length, 1, 'Only cue with N2 grammar above N4 should render');
  assert.strictEqual(filteredGrammar[0].dataset.cueIndex, '1');

  // Test Virtualization beyond 300 cues
  const bigCues = [];
  for (let idx = 0; idx < 350; idx++) {
    bigCues.push({ i: idx, s: idx * 3.0, e: idx * 3.0 + 2.5, text: `セリフ行 ${idx}` });
  }
  fakeStore.cues = bigCues;
  fakeStore.activeCueIndex = 150;
  view.currentFilter = 'all';
  view.renderTranscriptList();
  const virtItems = container.querySelectorAll('.anime-transcript-item');
  assert.ok(virtItems.length < 350, 'Virtualization must render fewer items than 350 total');
  assert.ok(virtItems.length > 50, 'Virtualization window must render around active cue');

  view.unmount();
});
