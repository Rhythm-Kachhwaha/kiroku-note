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

test('Anime Library: Renders continue-watching, series episodes, and recent immersion sessions from HTTP', async () => {
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
                last_position_ms: 600000 // 10m in progress -> continue watching
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

  // Verify Continue Watching section rendered
  assert.ok(renderedHtml.includes('Continue Watching'), 'Must render Continue Watching section');
  assert.ok(renderedHtml.includes('Resume at 10:00'), 'Must render resume timestamp');

  // Verify Series Library rendered
  assert.ok(renderedHtml.includes('Sousou no Frieren'), 'Must render Series name');
  assert.ok(renderedHtml.includes('Sousou no Frieren Ep. 02'), 'Must render episode item');
  assert.ok(renderedHtml.includes('84% known'), 'Must render known percentage');

  // Verify Recent Immersion Sessions rendered
  assert.ok(renderedHtml.includes('Recent Immersion Sessions'), 'Must render Immersion Sessions header');
  assert.ok(renderedHtml.includes('Frieren Episode 1 Immersion'), 'Must render session title');
  assert.ok(renderedHtml.includes('20 min (48 lines)'), 'Must render watch minutes and line counts');
});
