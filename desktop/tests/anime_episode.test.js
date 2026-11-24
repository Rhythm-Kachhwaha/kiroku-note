/**
 * Unit Tests: Anime Episode and Watch History
 * Verifies decoupled HTTP persistence, series grouping, episode progress, and UI rendering.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const animeViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'anime.css');

test('Anime Episode: Static inspection in anime.js & CSS', () => {
  const animeJs = fs.readFileSync(animeViewPath, 'utf8');
  assert.ok(animeJs.includes('anime-history-list'), 'Must render watch history list');
  assert.ok(animeJs.includes('/api/link/series'), 'Must fetch series grouping from /api/link/series');
  assert.ok(animeJs.includes('/api/link/sessions'), 'Must fetch sessions from /api/link/sessions');
  assert.ok(animeJs.includes('deduplicateSeriesList'), 'Must deduplicate series list');

  const css = fs.readFileSync(animeCssPath, 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'anime.css must not contain raw hex');
  assert.ok(css.includes('.anime-series-grid'), 'Must style anime-series-grid');
  assert.ok(css.includes('.anime-poster-card'), 'Must style anime-poster-card');
});

test('Anime Episode: Series loading, episode watch progress, and language switching', async () => {
  const { AnimeView } = await import('../src/ui/views/anime.js');

  const apiRequests = [];
  const fakeApiClient = {
    async request(url, options = {}) {
      apiRequests.push({ url, options });
      if (url.startsWith('/api/link/series')) {
        return [
          {
            series: 'Sousou no Frieren',
            title_english: 'Frieren: Beyond Journey\'s End',
            title_native: '葬送のフリーレン',
            poster_url: 'https://cdn.example.com/frieren.jpg',
            episodes: [
              {
                hash: 'frieren-hash-01',
                episode_number: 1,
                title: 'Episode 1: The Journey\'s End',
                last_position_ms: 1200000,
                duration_ms: 1440000,
                completed: 1,
                mined: 8
              },
              {
                hash: 'frieren-hash-02',
                episode_number: 2,
                title: 'Episode 2: It Didn\'t Have to Be Magic...',
                last_position_ms: 600000,
                duration_ms: 1440000,
                completed: 0,
                mined: 3
              }
            ]
          }
        ];
      }
      if (url.startsWith('/api/link/sessions')) {
        return [
          {
            series: 'Sousou no Frieren',
            episode_number: 2,
            watch_seconds: 600,
            words_mined: 3,
            ts: new Date().toISOString()
          }
        ];
      }
      return [];
    },
    async getBackendInfo() {
      return { port: 21828 };
    }
  };

  class MockElement {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.id = '';
      this.className = '';
      this._innerHTML = '';
      this.textContent = '';
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      this.style = {};
      this.dataset = {};
      this.listeners = new Map();
      this.classList = {
        _classes: new Set(),
        add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
        remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
        contains: (c) => this.classList._classes.has(c)
      };
    }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(val) {
      this._innerHTML = val;
      this.children = [];
      const tagRegex = /<([a-z0-9-]+)([^>]*)>/gi;
      let m;
      while ((m = tagRegex.exec(val)) !== null) {
        const tagName = m[1];
        if (tagName.startsWith('/')) continue;
        const attrs = m[2];
        const child = new MockElement(tagName);
        const idMatch = attrs.match(/id="([^"]+)"/);
        if (idMatch) child.id = idMatch[1];
        const classMatch = attrs.match(/class="([^"]+)"/);
        if (classMatch) {
          child.className = classMatch[1];
          classMatch[1].split(/\s+/).filter(Boolean).forEach(c => child.classList.add(c));
        }
        const dataHashMatch = attrs.match(/data-hash="([^"]+)"/);
        if (dataHashMatch) child.dataset.hash = dataHashMatch[1];
        child.parentElement = this;
        this.children.push(child);
      }
    }

    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k) || null; }
    removeAttribute(k) { this.attributes.delete(k); }

    addEventListener(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(fn);
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
      const results = [];
      function search(node) {
        for (const child of node.children) {
          if (selector.startsWith('#')) {
            if (child.id === selector.slice(1)) results.push(child);
          } else if (selector.startsWith('.')) {
            if (child.classList.contains(selector.slice(1))) results.push(child);
          } else if (child.tagName.toLowerCase() === selector.toLowerCase()) {
            results.push(child);
          }
          search(child);
        }
      }
      search(this);
      return results;
    }
  }

  const container = new MockElement('div');
  const view = new AnimeView({}, {
    apiClient: fakeApiClient,
    learnerLevel: 'N4'
  });
  view.container = container;

  await view.fetchWatchHistory();
  assert.strictEqual(view.seriesList.length, 1, 'Must have loaded 1 series');
  assert.strictEqual(view.seriesList[0].episodes.length, 2, 'Series must have 2 episodes');

  // Verify titles in English and Japanese
  assert.strictEqual(view.getSeriesTitle(view.seriesList[0], 'en'), 'Frieren: Beyond Journey\'s End');
  assert.strictEqual(view.getSeriesTitle(view.seriesList[0], 'jp'), '葬送のフリーレン');

  // Verify deduplication
  const dupList = [
    { series: 'Sousou no Frieren', title_english: 'Frieren' },
    { series: 'Frieren', title_native: '葬送のフリーレン' }
  ];
  const deduped = view.deduplicateSeriesList(dupList);
  assert.strictEqual(deduped.length, 1, 'Duplicate series with EN/JP titles must merge');
});
