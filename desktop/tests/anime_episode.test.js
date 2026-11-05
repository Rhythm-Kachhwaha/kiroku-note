/**
 * Slice 28 Unit Tests: Episode timeline sparkline, resume prompt, position saving, and series watch history
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const animeViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'anime.css');

test('Slice 28 Episode: Static inspection in anime.js & CSS', () => {
  const animeJs = fs.readFileSync(animeViewPath, 'utf8');
  assert.ok(animeJs.includes('anime-sparkline-track'), 'Must render sparkline track');
  assert.ok(animeJs.includes('anime-resume-banner'), 'Must have resume banner');
  assert.ok(animeJs.includes('btn-anime-resume'), 'Must have resume button');
  assert.ok(animeJs.includes('anime-history-list'), 'Must have watch history list');
  assert.ok(animeJs.includes('/api/link/series'), 'Must fetch series grouping from /api/link/series');
  assert.ok(animeJs.includes('/position'), 'Must save position to /position endpoint');

  const css = fs.readFileSync(animeCssPath, 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'anime.css must not contain raw hex');
  assert.ok(css.includes('.anime-sparkline-card'), 'Must style sparkline card');
  assert.ok(css.includes('.anime-sparkline-bar.is-easiest'), 'Must style easiest 5 bar');
  assert.ok(css.includes('.anime-sparkline-bar.is-hardest'), 'Must style hardest 5 bar');
  assert.ok(css.includes('.anime-resume-banner'), 'Must style resume banner');
  assert.ok(css.includes('.anime-history-card'), 'Must style watch history card');
});

test('Slice 28 Episode: Sparkline rendering, easiest/hardest 5, resume banner, and history', async () => {
  const { AnimeView } = await import('../src/ui/views/anime.js');

  const seekCalls = [];
  const apiRequests = [];

  const fakeStore = {
    status: 'connected',
    activeSession: { site: 'crunchyroll', title: 'Sousou no Frieren Ep. 04', duration: 1440 },
    videoState: { t: 0.0, paused: true, rate: 1.0 },
    cueHash: 'frieren-hash-04',
    activeCueIndex: 0,
    activeCue: { i: 0, s: 0.0, e: 4.5, text: '旅の途中' },
    cues: [
      { i: 0, s: 0.0, e: 4.5, text: '旅の途中' },
      { i: 1, s: 10.0, e: 14.5, text: '簡単なセリフです' },
      { i: 2, s: 20.0, e: 25.0, text: '非常に難解な古代魔法の文献' },
      { i: 3, s: 30.0, e: 35.0, text: 'こんにちは' },
      { i: 4, s: 40.0, e: 45.0, text: '難解な術式を展開する魔導師' },
      { i: 5, s: 50.0, e: 55.0, text: 'ありがとう' },
      { i: 6, s: 60.0, e: 65.0, text: 'さようなら' }
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
    async request(url, options = {}) {
      apiRequests.push({ url, options });
      if (url.startsWith('/api/link/episodes/frieren-hash-04')) {
        return {
          hash: 'frieren-hash-04',
          title: 'Sousou no Frieren Ep. 04',
          site: 'crunchyroll',
          known_pct: 88.5,
          mined: 5,
          minutes: 18.0,
          ts: '2026-11-05T12:00:00Z',
          last_position_ms: 760000, // 12m 40s
          series: 'Sousou no Frieren'
        };
      }
      if (url.startsWith('/api/link/series')) {
        return [
          {
            series: 'Sousou no Frieren',
            episodes: [
              {
                hash: 'frieren-hash-04',
                title: 'Sousou no Frieren Ep. 04',
                site: 'crunchyroll',
                known_pct: 88.5,
                mined: 5,
                minutes: 18.0,
                ts: '2026-11-05T12:00:00Z',
                last_position_ms: 760000
              }
            ]
          }
        ];
      }
      if (url.startsWith('/api/link/cues/')) {
        return {
          hash: 'frieren-hash-04',
          count: 7,
          cues: [
            { i: 0, s: 0.0, e: 4.5, gap_words: [] },
            { i: 1, s: 10.0, e: 14.5, gap_words: [] },
            { i: 2, s: 20.0, e: 25.0, gap_words: ['難解', '古代', '魔法', '文献'] },
            { i: 3, s: 30.0, e: 35.0, gap_words: [] },
            { i: 4, s: 40.0, e: 45.0, gap_words: ['術式', '展開', '魔導師'] },
            { i: 5, s: 50.0, e: 55.0, gap_words: [] },
            { i: 6, s: 60.0, e: 65.0, gap_words: [] }
          ]
        };
      }
      return {};
    }
  };

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
        const dataHash = rawAttrs.match(/data-hash="([^"]+)"/);
        if (dataHash) child.dataset.hash = dataHash[1];

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

  // Wait for async calls (fetchCuesAnalysis, checkResumePosition, fetchWatchHistory)
  await new Promise(r => setTimeout(r, 20));

  // 1. Resume banner check ("Resume at 12:40")
  assert.strictEqual(view.resumePositionMs, 760000, 'Must record resumePositionMs 760000');
  const resumeText = container.querySelector('#anime-resume-text');
  assert.ok(resumeText, 'Resume text element should exist');
  assert.ok(resumeText.textContent.includes('12:40'), 'Resume prompt must say 12:40');

  // Click resume button -> seeks to 760s (12m 40s)
  const btnResume = container.querySelector('#btn-anime-resume');
  assert.ok(btnResume, 'Resume button must exist');
  btnResume.click();
  assert.ok(seekCalls.length > 0, 'Clicking resume must seek');
  assert.strictEqual(seekCalls[0].t, 760, 'Must seek to 760s');

  // 2. Sparkline check
  view.renderSparkline();
  const bars = container.querySelectorAll('.anime-sparkline-bar');
  assert.strictEqual(bars.length, 7, 'Sparkline should render 7 bars for 7 cues');

  const easiestBars = bars.filter(b => b.classList.contains('is-easiest'));
  assert.ok(easiestBars.length > 0, 'Must mark easiest lines in sparkline');

  const hardestBars = bars.filter(b => b.classList.contains('is-hardest'));
  assert.ok(hardestBars.length > 0, 'Must mark hardest lines in sparkline');

  // Click sparkline bar seeks
  const bar2 = bars[2];
  const track = container.querySelector('#anime-sparkline-track');
  (track.listeners['click'] || []).forEach(fn => fn({ target: bar2 }));
  const lastSeek = seekCalls[seekCalls.length - 1];
  assert.strictEqual(lastSeek.t, 20.0, 'Clicking sparkline bar must seek to cue start time 20.0s');

  // 3. Throttled position saving
  fakeStore.videoState.paused = false;
  fakeStore.videoState.t = 780.0;
  view._savePositionIfPlaying();
  const posSaveReq = apiRequests.find(r => r.url.includes('/position'));
  assert.ok(posSaveReq, 'Position save request should be sent when playing');
  assert.strictEqual(posSaveReq.options.body.last_position_ms, 780000);

  // 4. Watch history check
  const historyItems = container.querySelectorAll('.anime-history-item');
  assert.ok(historyItems.length >= 1, 'Watch history must render episode items');
  assert.strictEqual(historyItems[0].dataset.hash, 'frieren-hash-04');

  view.unmount();
});
