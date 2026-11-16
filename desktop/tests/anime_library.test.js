/**
 * Desktop Anime Library & Immersion Dashboard Test (Group 6)
 *
 * Verifies that Desktop AnimeView:
 * 1. Functions cleanly with no browser extension installed (empty state, zero crashes).
 * 2. Fetches and renders series groupings, episode cards, continue-watching cues, and session stats from HTTP.
 * 3. Has zero WebSocket dependencies and no pairing flow copy.
 * 4. Strictly respects design tokens and typography contracts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const animeJsPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'anime.css');

test('Anime Library: Static inspection in anime.js and CSS', () => {
  assert.ok(fs.existsSync(animeJsPath), 'anime.js must exist');
  const code = fs.readFileSync(animeJsPath, 'utf8');

  // Must not have WebSocket connection requirements or pairing strings
  assert.doesNotMatch(code, /new\s+WebSocket/i, 'Must not establish WebSocket connection in AnimeView');
  assert.doesNotMatch(code, /pairing\s+code/i, 'Must not contain legacy pairing code prompts');
  assert.doesNotMatch(code, /fresh\s+code/i, 'Must not contain fresh code prompts');

  // Must have HTTP endpoints for series, episodes, and sessions
  assert.ok(code.includes('/api/link/series'), 'Must query /api/link/series');
  assert.ok(code.includes('/api/link/sessions'), 'Must query /api/link/sessions');

  // CSS token compliance
  const css = fs.readFileSync(animeCssPath, 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'anime.css must contain zero raw hex');
  assert.ok(css.includes('var(--font-sans)') || css.includes('var(--font-japanese)'), 'Must adhere to font tokens');
});

test('Anime Library: Renders clean empty state when no episodes or sessions exist (extension never installed)', async () => {
  const { AnimeView } = await import('../src/ui/views/anime.js');

  const requestedUrls = [];
  const fakeApiClient = {
    async request(url) {
      requestedUrls.push(url);
      if (url.startsWith('/api/link/series')) {
        return [];
      }
      if (url.startsWith('/api/link/sessions')) {
        return [];
      }
      return [];
    }
  };

  let targetHtml = '';
  const listEl = {
    set innerHTML(val) { targetHtml = val; },
    get innerHTML() { return targetHtml; }
  };
  const container = {
    innerHTML: '',
    children: [],
    querySelector(sel) {
      if (sel === '#anime-history-list') {
        return listEl;
      }
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };

  const view = new AnimeView(null, { apiClient: fakeApiClient });
  view.container = container;

  // fetchWatchHistory should load both series and sessions
  await view.fetchWatchHistory();

  assert.ok(requestedUrls.some(u => u.includes('/api/link/series')), 'Should request /api/link/series');
  assert.ok(requestedUrls.some(u => u.includes('/api/link/sessions')), 'Should request /api/link/sessions');

  assert.ok(targetHtml.includes('No watch history yet'), 'Should render clean empty state without extension');
});

test('Anime Library: Renders series episodes and excludes removed continue-watching/sessions from HTTP', async () => {
  const { AnimeView } = await import('../src/ui/views/anime.js');

  const fakeApiClient = {
    async request(url) {
      if (url.startsWith('/api/link/series')) {
        return [
          {
            series: 'Sousou no Frieren',
            episodes: [
              {
                hash: 'ep1-hash',
                title: 'Sousou no Frieren Ep. 01',
                known_pct: 91.5,
                mined: 4,
                minutes: 24.0,
                last_position_ms: 600000
              },
              {
                hash: 'ep2-hash',
                title: 'Sousou no Frieren Ep. 02',
                known_pct: 84.0,
                mined: 7,
                minutes: 24.0,
                last_position_ms: 0
              }
            ]
          }
        ];
      }
      if (url.startsWith('/api/link/sessions')) {
        return [
          {
            id: 101,
            title: 'Frieren Episode 1 Immersion',
            series: 'Sousou no Frieren',
            watch_seconds: 1200,
            lines_seen: 48,
            words_mined: 3
          }
        ];
      }
      return [];
    }
  };

  let renderedHtml = '';
  const container = {
    innerHTML: '',
    children: [],
    querySelector(sel) {
      if (sel === '#anime-history-list') {
        return {
          set innerHTML(val) { renderedHtml = val; },
          get innerHTML() { return renderedHtml; }
        };
      }
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };

  const view = new AnimeView(null, { apiClient: fakeApiClient });
  view.container = container;

  await view.fetchWatchHistory();

  // Verify Continue Watching & Recent Sessions sections are excluded per UX design
  assert.ok(!renderedHtml.includes('Continue Watching'), 'Must not render Continue Watching section');
  assert.ok(!renderedHtml.includes('Recent Immersion Sessions'), 'Must not render Immersion Sessions header');

  // Verify Series Library rendered
  assert.ok(renderedHtml.includes('Sousou no Frieren'), 'Must render Series name');
  assert.ok(renderedHtml.includes('Sousou no Frieren Ep. 02'), 'Must render episode item');
  assert.ok(renderedHtml.includes('84% known'), 'Must render known percentage');
});

test('Anime Library: Language toggle switches between English and Japanese titles', async () => {
  const { AnimeView } = await import('../src/ui/views/anime.js');

  const view = new AnimeView(null);
  const sampleSeries = {
    series: 'K-ON!',
    title_english: 'K-ON!',
    title_native: 'けいおん!',
    episodes: [{ title: 'K-ON! Episode 1', last_position_ms: 100000 }]
  };

  // Default / English
  view.titleLang = 'en';
  assert.equal(view.getSeriesTitle(sampleSeries), 'K-ON!');

  // Japanese toggle
  view.titleLang = 'jp';
  assert.equal(view.getSeriesTitle(sampleSeries), 'けいおん!');

  // Fallback when native is missing
  const noNative = { series: 'Unknown Anime' };
  assert.equal(view.getSeriesTitle(noNative), 'Unknown Anime');
});

test('Anime Library: Inline Episode Inspector expands with JLPT difficulty, missed words, and grammar', async () => {
  const { AnimeView } = await import('../src/ui/views/anime.js');

  const inspectorMock = {
    episode_record: { hash: 'ep_test_hash', title: 'Frieren Ep 1', known_pct: 85.0, mined: 2, minutes: 24.0 },
    difficulty: {
      overall_level: 'N3',
      n5_pct: 40.0,
      n4_pct: 25.0,
      n3_pct: 20.0,
      n2_pct: 10.0,
      n1_pct: 5.0,
      unranked_pct: 0.0,
      unique_words_count: 142
    },
    missed_words: [
      { word: '魔法使い', reading: 'まほうつかい', meaning: 'magician, wizard', frequency: 5, jlpt: 'N3', is_known: false },
      { word: '冒険', reading: 'ぼうけん', meaning: 'adventure', frequency: 3, jlpt: 'N3', is_known: false }
    ],
    grammar_points: [
      { point: '〜ましょう', grammar_id: 'g_mashou', jlpt: 'N5', occurrences: 4, example_sentence: '冒険を続けましょう。' }
    ],
    mined_cards: []
  };

  const fakeApiClient = {
    async getEpisodeInspector(hash) {
      if (hash === 'ep_test_hash') return inspectorMock;
      throw new Error('Not found');
    },
    async request() {
      return [];
    }
  };

  const view = new AnimeView(null, { apiClient: fakeApiClient });
  view.selectedSeries = {
    series: 'Sousou no Frieren',
    title_english: 'Frieren',
    episodes: [{ hash: 'ep_test_hash', title: 'Episode 1', known_pct: 85.0, mined: 2, minutes: 24.0 }]
  };
  view.seriesDetailTab = 'episodes';

  // Initially not expanded
  assert.equal(view.expandedEpisodeHash, null);
  const initialHtml = view._renderDetailTabContent();
  assert.ok(initialHtml.includes('anime-episode-row'), 'Should render episode row');
  assert.ok(!initialHtml.includes('inspector-section-title'), 'Inspector should not be rendered before expansion');

  // Toggle open
  await view.toggleEpisodeInspector('ep_test_hash');
  assert.equal(view.expandedEpisodeHash, 'ep_test_hash');
  const expandedHtml = view._renderDetailTabContent();

  // Verify inline drawer content
  assert.ok(expandedHtml.includes('anime-inline-inspector'), 'Must render anime-inline-inspector');
  assert.ok(expandedHtml.includes('Difficulty Breakdown'), 'Must render difficulty section');
  assert.ok(expandedHtml.includes('level-n3'), 'Must render N3 level segment in bar');
  assert.ok(expandedHtml.includes('魔法使い'), 'Must render missed word expression');
  assert.ok(expandedHtml.includes('まほうつかい'), 'Must render missed word reading');
  assert.ok(expandedHtml.includes('magician, wizard'), 'Must render missed word gloss');
  assert.ok(expandedHtml.includes('〜ましょう'), 'Must render grammar pattern name');
  assert.ok(expandedHtml.includes('inspector-quick-mine-btn'), 'Must render quick-mine button');

  // Toggle close
  await view.toggleEpisodeInspector('ep_test_hash');
  assert.equal(view.expandedEpisodeHash, null);
  const closedHtml = view._renderDetailTabContent();
  assert.ok(!closedHtml.includes('anime-inline-inspector'), 'Inspector should be removed when collapsed');
});
