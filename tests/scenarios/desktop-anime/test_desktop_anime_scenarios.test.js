import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

import { AnimeView } from '../../../desktop/src/ui/views/anime.js';
import { SubtitleParser } from '../../../desktop/src/ui/lib-shared/subtitle_parser.mjs';

function createMockElement(tagName = 'div') {
  const el = {
    tagName: tagName.toUpperCase(),
    id: '',
    className: '',
    _innerHTML: '',
    textContent: '',
    children: [],
    parentElement: null,
    attributes: new Map(),
    style: {},
    listeners: new Map(),
    classList: {
      _classes: new Set(),
      add: (...cls) => cls.forEach(c => el.classList._classes.add(c)),
      remove: (...cls) => cls.forEach(c => el.classList._classes.delete(c)),
      contains: (c) => el.classList._classes.has(c),
      toggle: (c, force) => {
        if (force !== undefined) {
          if (force) el.classList._classes.add(c);
          else el.classList._classes.delete(c);
          return force;
        }
        if (el.classList._classes.has(c)) {
          el.classList._classes.delete(c);
          return false;
        }
        el.classList._classes.add(c);
        return true;
      }
    },
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(val) {
      this._innerHTML = val;
      this.children = [];
      const tagRegex = /<([a-z0-9-]+)([^>]*)>/gi;
      let m;
      while ((m = tagRegex.exec(val)) !== null) {
        const t = m[1];
        if (t.startsWith('/')) continue;
        const attrs = m[2];
        const child = createMockElement(t);
        const idMatch = attrs.match(/id="([^"]+)"/);
        if (idMatch) child.id = idMatch[1];
        const classMatch = attrs.match(/class="([^"]+)"/);
        if (classMatch) {
          child.className = classMatch[1];
          classMatch[1].split(/\s+/).filter(Boolean).forEach(c => child.classList.add(c));
        }
        const dataHashMatch = attrs.match(/data-hash="([^"]+)"/);
        if (dataHashMatch) child.setAttribute('data-hash', dataHashMatch[1]);
        const dataLangMatch = attrs.match(/data-lang="([^"]+)"/);
        if (dataLangMatch) child.setAttribute('data-lang', dataLangMatch[1]);
        const dataSeriesMatch = attrs.match(/data-series="([^"]+)"/);
        if (dataSeriesMatch) child.setAttribute('data-series', dataSeriesMatch[1]);
        child.parentElement = this;
        this.children.push(child);
      }
    },
    setAttribute(k, v) { this.attributes.set(k, String(v)); },
    getAttribute(k) { return this.attributes.get(k) || null; },
    removeAttribute(k) { this.attributes.delete(k); },
    addEventListener(evt, fn) {
      if (!this.listeners.has(evt)) this.listeners.set(evt, []);
      this.listeners.get(evt).push(fn);
    },
    removeEventListener(evt, fn) {
      if (!this.listeners.has(evt)) return;
      const list = this.listeners.get(evt).filter(f => f !== fn);
      this.listeners.set(evt, list);
    },
    dispatchEvent(evt) {
      const list = this.listeners.get(evt?.type || evt) || [];
      list.forEach(fn => fn(evt));
    },
    closest(sel) {
      let curr = this.parentElement;
      while (curr) {
        if (sel.startsWith('.') && curr.classList.contains(sel.slice(1))) return curr;
        if (sel.startsWith('#') && curr.id === sel.slice(1)) return curr;
        curr = curr.parentElement;
      }
      return null;
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      const results = [];
      function search(node) {
        for (const child of node.children) {
          if (sel.startsWith('#') && child.id === sel.slice(1)) results.push(child);
          else if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) results.push(child);
          else if (sel.startsWith('[data-hash="')) {
            const h = sel.match(/data-hash="([^"]+)"/)?.[1];
            if (child.getAttribute('data-hash') === h) results.push(child);
          } else if (sel.startsWith('[data-series="')) {
            const s = sel.match(/data-series="([^"]+)"/)?.[1];
            if (child.getAttribute('data-series') === s) results.push(child);
          } else if (child.tagName.toLowerCase() === sel.toLowerCase()) results.push(child);
          search(child);
        }
      }
      search(this);
      return results;
    },
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter(c => c !== this);
      }
    }
  };
  return el;
}

test('S01: Anime Library clean empty state and offline backend resilience', async () => {
  const fakeApiClient = {
    async request() {
      throw new Error('Connection refused: Backend offline');
    },
    async getBackendInfo() {
      return { port: 21828 };
    }
  };

  const container = createMockElement('div');
  const view = new AnimeView(null, { apiClient: fakeApiClient });
  await view.mount(container);
  await view.fetchWatchHistory();

  const historyList = container.querySelector('#anime-history-list');
  assert.ok(historyList, 'anime-history-list should exist');
  assert.ok(
    historyList.innerHTML.includes('No watch history yet') || historyList.innerHTML.includes('Start watching'),
    'Should render graceful empty/offline state without crashing'
  );
  view.unmount();
});

test('S02: Continue-watching cards and progress bar calculations', () => {
  const view = new AnimeView(null);
  
  // Episode with 85%+ completion
  const completedEp = { duration_ms: 100000, last_position_ms: 90000 };
  const inProgressEp = { duration_ms: 100000, last_position_ms: 50000 };
  const unplayedEp = { duration_ms: 100000, last_position_ms: 0 };

  const seriesWithEps = {
    series: 'Sousou no Frieren',
    episodes: [completedEp, inProgressEp, unplayedEp]
  };

  const progress = view.calculateWatchProgress(seriesWithEps);
  assert.equal(progress, 33, '1 out of 3 episodes completed = 33% watch progress');

  const emptyProgress = view.calculateWatchProgress({ series: 'Empty', episodes: [] });
  assert.equal(emptyProgress, 0, 'Empty series returns 0%');
});

test('S03: Series grouping and multi-episode hierarchy rendering', async () => {
  const seriesData = [
    {
      series: 'Steins;Gate',
      title_english: 'Steins;Gate',
      title_native: 'シュタインズ・ゲート',
      poster_url: 'https://example.com/steins.jpg',
      episodes: [
        { hash: 'sg_ep1', title: 'Ep. 01', known_pct: 88.0, mined: 5, difficulty: 'N3' },
        { hash: 'sg_ep2', title: 'Ep. 02', known_pct: 92.4, mined: 2, difficulty: 'N3' }
      ]
    }
  ];

  const fakeApiClient = {
    async request(url) {
      if (url.startsWith('/api/link/series')) return seriesData;
      return [];
    },
    async getBackendInfo() {
      return { port: 21828 };
    }
  };

  const container = createMockElement('div');
  const view = new AnimeView(null, { apiClient: fakeApiClient });
  view.container = container;
  view.render();
  await view.fetchWatchHistory();

  const historyList = container.querySelector('#anime-history-list');
  assert.ok(historyList.innerHTML.includes('Steins;Gate'), 'Should render canonical series name');
  assert.ok(historyList.innerHTML.includes('anime-poster-card'), 'Should render anime poster card');
});

test('S04: Inline Episode Inspector toggle and cache retention', async () => {
  let inspectApiCallCount = 0;
  const fakeApiClient = {
    async request() { return []; },
    async getEpisodeInspector(hash, level) {
      inspectApiCallCount++;
      return {
        difficulty: { overall_level: 'N3', unique_words_count: 140 },
        words: [
          { word: '運命', reading: 'うんめい', level: 'N3', status: 'candidate' }
        ],
        grammar: []
      };
    }
  };

  const container = createMockElement('div');
  const view = new AnimeView(null, { apiClient: fakeApiClient });
  view.container = container;
  view.render();

  // Initial inspection toggle
  await view.toggleEpisodeInspector('ep_hash_test');
  assert.equal(inspectApiCallCount, 1, 'Should fetch inspection data on first expand');
  assert.equal(view.expandedEpisodeHash, 'ep_hash_test');
  assert.ok(view.episodeInspectorCache.has('ep_hash_test'), 'Should cache inspection data');

  // Collapse
  await view.toggleEpisodeInspector('ep_hash_test');
  assert.equal(view.expandedEpisodeHash, null, 'Should collapse when toggled again');

  // Re-expand without force reload should use cache
  await view.toggleEpisodeInspector('ep_hash_test');
  assert.equal(inspectApiCallCount, 1, 'Should use cache without re-fetching API');
});

test('S05: JLPT difficulty breakdown and dynamic target level reactivity', async () => {
  const fakeApiClient = {
    async request() { return []; },
    async getBackendInfo() { return { port: 21828 }; },
    async getEpisodeInspector(hash, level) {
      return {
        difficulty: { overall_level: 'N4', target_learner_level: level, unique_words_count: 85 },
        words: [],
        grammar: []
      };
    }
  };

  const container = createMockElement('div');
  const view = new AnimeView(null, { apiClient: fakeApiClient });
  await view.mount(container);

  view.expandedEpisodeHash = 'ep_reactivity_hash';
  view.episodeInspectorCache.set('ep_reactivity_hash', {
    difficulty: { overall_level: 'N4' },
    words: [],
    grammar: []
  });

  // Trigger learner level handler
  if (view.boundLearnerLevelHandler) {
    view.boundLearnerLevelHandler({ detail: { level: 'N2' } });
  }

  assert.equal(view.learnerLevel, 'N2', 'View learner level should update to N2');
  assert.equal(view.episodeInspectorCache.size, 0, 'Inspector cache must be cleared when learner level changes');
  view.unmount();
});

test('S06: Episode inspector vocabulary and grammar filtering', () => {
  const view = new AnimeView(null);
  view.learnerLevel = 'N3';

  view.dumpGrammarPoint('〜うちに', 'uchi_ni');

  const inspectorData = {
    grammar_points: [
      { point: '〜うちに', pattern_key: 'uchi_ni', meaning: 'while' },
      { point: '〜かもしれない', pattern_key: 'kamoshirenai', meaning: 'might' }
    ]
  };

  const dumped = view.getDumpedGrammar();
  const filteredGrammar = inspectorData.grammar_points.filter(g => !dumped.has(g.point) && !dumped.has(g.pattern_key));
  assert.equal(filteredGrammar.length, 1, 'Dumped grammar points should be excluded');
  assert.equal(filteredGrammar[0].point, '〜かもしれない');
});

test('S07: Brutalist Flashcard Review Screen modal and actions', () => {
  const container = createMockElement('div');
  const fakeApiClient = {
    request() { return Promise.resolve([]); }
  };
  const view = new AnimeView(null, { apiClient: fakeApiClient });
  view.container = container;

  view.episodeInspectorCache.set('test_ep_hash', {
    missed_words: [
      { word: '未来', reading: 'みらい', meaning: 'future', jlpt: 'N3' },
      { word: '過去', reading: 'かこ', meaning: 'past', jlpt: 'N3' }
    ]
  });

  view.startReviewSession('vocab', 'test_ep_hash');
  assert.ok(view.reviewSession, 'Review session should be created');
  assert.equal(view.reviewSession.items.length, 2, 'Review queue should have 2 cards');
  assert.equal(view.reviewSession.currentIndex, 0, 'Should start at card 0');

  // Mark first card as known
  view.handleReviewAction('known');
  assert.equal(view.reviewSession.currentIndex, 1, 'Review index should advance to card 1');

  // Mark second card as mined
  view.handleReviewAction('mine');
  assert.equal(view.reviewSession.currentIndex, 2, 'Both cards should be reviewed');

  view.closeReviewSession();
  assert.equal(view.reviewSession, null, 'Review session should be closed cleanly');
});

test('S08: Language toggle title switching and preference persistence', () => {
  const container = createMockElement('div');
  const view = new AnimeView(null);
  view.container = container;

  const series = {
    series: 'Frieren',
    title_english: 'Frieren: Beyond Journey\'s End',
    title_native: '葬送のフリーレン'
  };

  view.setTitleLang('en');
  assert.equal(view.titleLang, 'en');
  assert.equal(view.getSeriesTitle(series), 'Frieren: Beyond Journey\'s End');

  view.setTitleLang('jp');
  assert.equal(view.titleLang, 'jp');
  assert.equal(view.getSeriesTitle(series), '葬送のフリーレン');
});

test('S09: Subtitle parser multi-format support (SRT, VTT, ASS, SSA)', () => {
  const srtRaw = `1
00:00:01,000 --> 00:00:03,500
こんにちは、世界！

2
00:00:04,100 --> 00:00:06,000
第２話へようこそ。`;

  const srtCues = SubtitleParser.parseSubtitles(srtRaw, 'test.srt');
  assert.equal(srtCues.length, 2, 'SRT parser should yield 2 cues');
  assert.equal(srtCues[0].startTime, 1.0);
  assert.equal(srtCues[0].endTime, 3.5);
  assert.equal(srtCues[0].text, 'こんにちは、世界！');

  const vttRaw = `WEBVTT

00:01.000 --> 00:03.500
テスト字幕です。`;

  const vttCues = SubtitleParser.parseSubtitles(vttRaw, 'test.vtt');
  assert.equal(vttCues.length, 1, 'VTT parser should yield 1 cue');
  assert.equal(vttCues[0].text, 'テスト字幕です。');

  const assRaw = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:04.20,Default,,0,0,0,,{\\i1}斜体テキスト{\\i0}と通常テキスト`;

  const assCues = SubtitleParser.parseSubtitles(assRaw, 'test.ass');
  assert.equal(assCues.length, 1, 'ASS parser should yield 1 cue');
  assert.equal(assCues[0].startTime, 1.5);
  assert.equal(assCues[0].endTime, 4.2);
  assert.equal(assCues[0].text, '斜体テキストと通常テキスト', 'ASS override tags must be stripped');
});

test('S10: Connection stepper removed; AnimeView operates as HTTP-only consumer', () => {
  const view = new AnimeView(null);
  assert.equal(view.renderConnectionStepper, undefined, 'renderConnectionStepper must be removed');
  assert.equal(view.renderStreamPill, undefined, 'renderStreamPill must be removed');
  assert.equal(view.activeStreamSession, undefined, 'activeStreamSession must be removed');
});

test('S11: Series pin and bookmark state toggles', () => {
  const view = new AnimeView(null);
  
  assert.equal(view.isSeriesPinned('Frieren'), false);
  view.toggleSeriesPin('Frieren');
  assert.equal(view.isSeriesPinned('Frieren'), true);
  view.toggleSeriesPin('Frieren');
  assert.equal(view.isSeriesPinned('Frieren'), false);

  assert.equal(view.isSeriesBookmarked('Steins;Gate'), false);
  view.toggleSeriesBookmark('Steins;Gate');
  assert.equal(view.isSeriesBookmarked('Steins;Gate'), true);
  view.toggleSeriesBookmark('Steins;Gate');
  assert.equal(view.isSeriesBookmarked('Steins;Gate'), false);
});

test('S12: Design tokens adherence and emoji prevention', () => {
  const cssPath = path.join(ROOT_DIR, 'desktop', 'src', 'ui', 'styles', 'views', 'anime.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Zero raw hex colors
  const linesWithHex = css.split('\n').filter(l => /#[0-9a-fA-F]{3,8}\b/.test(l) && !l.trim().startsWith('/*') && !l.trim().startsWith('*'));
  assert.equal(linesWithHex.length, 0, `anime.css should have zero raw hex colors, found: ${linesWithHex.join('; ')}`);

  // Adheres to tactile tokens
  assert.ok(css.includes('var(--tactile-stroke)'), 'Must use tactile stroke token');

  // Zero emoji in CSS and JS
  const jsPath = path.join(ROOT_DIR, 'desktop', 'src', 'ui', 'views', 'anime.js');
  const js = fs.readFileSync(jsPath, 'utf8');

  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(css), false, 'anime.css must contain zero emoji');
  assert.equal(emojiRegex.test(js), false, 'anime.js must contain zero emoji');
});

test('S13: Tactile Sync Cloud button rendering & state transitions', () => {
  const container = createMockElement('div');
  const view = new AnimeView(null);
  view.container = container;
  view.render();

  const syncBtn = container.querySelector('#btn-anime-sync');
  assert.ok(syncBtn, 'Sync Cloud button #btn-anime-sync must exist in DOM');
  const syncLabel = container.querySelector('#label-anime-sync');
  assert.ok(syncLabel, 'Label #label-anime-sync must exist');
  assert.ok(container.innerHTML.includes('Sync Cloud'), 'Initial markup must render Sync Cloud');

  // Test syncing state
  view.isSyncing = true;
  view.syncStatus = 'syncing';
  view.updateSyncButtonUI();
  assert.ok(syncBtn.classList.contains('is-syncing'), 'Button must have .is-syncing class');
  assert.equal(syncLabel.textContent, 'Syncing...', 'Label should show Syncing...');

  // Test synced state
  view.isSyncing = false;
  view.syncStatus = 'synced';
  view.updateSyncButtonUI();
  assert.equal(syncBtn.classList.contains('is-syncing'), false, 'Button should not have .is-syncing');
  assert.equal(syncLabel.textContent, 'Synced', 'Label should show Synced');

  // Test error state
  view.syncStatus = 'error';
  view.updateSyncButtonUI();
  assert.equal(syncLabel.textContent.trim(), 'Sync Retry', 'Label should show Sync Retry');
});

test('S14: Non-destructive batch payload assembly', async () => {
  let capturedBatch = null;
  const mockApi = {
    request: async (endpoint) => {
      if (endpoint === '/api/link/series') {
        return [
          {
            series: 'けいおん!',
            title_english: 'K-ON!',
            media_type: 'anime',
            poster_url: 'https://s4.anilist.co/file/anilistcdn/poster.png',
            synopsis: 'Light music club story',
            episodes: [
              {
                hash: 'ep1_hash',
                title: 'けいおん! Episode 1',
                last_position_ms: 1200000,
                duration_ms: 1400000,
                mined: 5
              }
            ]
          }
        ];
      }
      return [];
    }
  };

  const view = new AnimeView(null, { apiClient: mockApi });
  view.container = createMockElement('div');
  view.requestCloudApi = async (endpoint, opts = {}) => {
    if (endpoint === '/api/user/progress/anime/batch') {
      capturedBatch = JSON.parse(opts.body);
      return { ok: true, synced_count: 1 };
    }
    if (endpoint === '/api/user/progress/anime') {
      return { ok: true, progress: [] };
    }
    return { ok: true };
  };

  await view.syncAnimeToCloud({ silent: true });

  assert.ok(capturedBatch, 'Must send batch payload to /api/user/progress/anime/batch');
  assert.equal(Array.isArray(capturedBatch.anime_progress), true);
  assert.equal(capturedBatch.anime_progress.length, 1);

  const ep = capturedBatch.anime_progress[0];
  assert.equal(ep.series_id, 'けいおん!');
  assert.equal(ep.series_title, 'K-ON!');
  assert.equal(ep.episode_number, 1);
  assert.equal(ep.last_position_ms, 1200000);
  assert.equal(ep.duration_ms, 1400000);
  assert.equal(ep.completed, 1, '1200000/1400000 is > 85%, must be completed');
  assert.equal(ep.poster_url, 'https://s4.anilist.co/file/anilistcdn/poster.png');
  assert.equal(ep.synopsis, 'Light music club story');
});

test('S15: Non-destructive bidirectional sync (cloud updates local)', async () => {
  let updatedLocalPosition = null;

  const mockApi = {
    request: async (endpoint, opts) => {
      if (endpoint === '/api/link/series') {
        return [
          {
            series: 'けいおん!',
            title_english: 'K-ON!',
            episodes: [
              {
                hash: 'kon_ep1_hash',
                title: 'Episode 1',
                episode_number: 1,
                last_position_ms: 400000
              }
            ]
          }
        ];
      }
      if (endpoint.includes('/position') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        updatedLocalPosition = body.last_position_ms;
        return { ok: true };
      }
      return [];
    }
  };

  const view = new AnimeView(null, { apiClient: mockApi });
  view.container = createMockElement('div');
  view.requestCloudApi = async (endpoint) => {
    if (endpoint === '/api/user/progress/anime/batch') {
      return { ok: true, synced_count: 1 };
    }
    if (endpoint === '/api/user/progress/anime') {
      // Cloud has further watch progress: 650000ms > local 400000ms
      return {
        ok: true,
        progress: [
          {
            series_id: 'けいおん!',
            episode_number: 1,
            last_position_ms: 650000
          }
        ]
      };
    }
    return { ok: true };
  };

  await view.syncAnimeToCloud({ silent: true });

  assert.equal(updatedLocalPosition, 650000, 'Local episode position must be updated to further cloud position');
});

test('S16: Debounced auto-sync lifecycle', async () => {
  const view = new AnimeView(null);
  view.container = createMockElement('div');

  let syncCallCount = 0;
  view.syncAnimeToCloud = async () => {
    syncCallCount++;
  };

  // Rapidly trigger auto sync 4 times within short interval
  view.triggerAutoSync(50);
  view.triggerAutoSync(50);
  view.triggerAutoSync(50);
  view.triggerAutoSync(50);

  assert.ok(view._autoSyncTimer, 'Auto-sync timer must be scheduled');
  assert.equal(syncCallCount, 0, 'Should not have fired immediately');

  // Wait for debounce timer to expire
  await new Promise(r => setTimeout(r, 80));
  assert.equal(syncCallCount, 1, 'Debounced calls should collapse into exactly 1 sync');

  // Verify unmount clears timer
  view.triggerAutoSync(500);
  assert.ok(view._autoSyncTimer, 'Timer scheduled before unmount');
  view.unmount();
  assert.equal(view._autoSyncTimer, null, 'Unmount must cancel pending auto-sync timer');
});

test('S17: Auth resolution & offline/unauthorized graceful recovery', async () => {
  const mockApi = {
    request: async (endpoint) => {
      if (endpoint === '/api/link/series') {
        return [{ series: 'K-ON!', episodes: [{ episode_number: 1, last_position_ms: 0 }] }];
      }
      return [];
    }
  };

  const view = new AnimeView(null, { apiClient: mockApi });
  const container = createMockElement('div');
  view.container = container;
  view.render();

  // Simulate Cloud 401 Unauthorized or network failure
  view.requestCloudApi = async () => {
    throw new Error('Cloud API 401: Unauthorized');
  };

  // Must not throw uncaught error
  await assert.doesNotReject(async () => {
    await view.syncAnimeToCloud({ silent: true });
  });

  assert.equal(view.syncStatus, 'error', 'Sync status should be error');
  const label = container.querySelector('#label-anime-sync');
  assert.equal(label.textContent.trim(), 'Sync Retry', 'Button should display Sync Retry');
});
