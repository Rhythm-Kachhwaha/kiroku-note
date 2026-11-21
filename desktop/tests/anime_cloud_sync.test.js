import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnimeView } from '../src/ui/views/anime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimal DOM Mock for Node.js test environment
class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.innerHTML = '';
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      contains: (c) => this.classList._classes.contains(c),
    };
    this.style = {};
    this.attributes = new Map();
    this.textContent = '';
  }

  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) || null; }

  querySelector(selector) {
    if (selector === '#btn-anime-sync') {
      const btn = new MockElement('button');
      btn.id = 'btn-anime-sync';
      return btn;
    }
    if (selector === '#label-anime-sync') {
      const span = new MockElement('span');
      span.id = 'label-anime-sync';
      span.textContent = 'Sync Cloud';
      return span;
    }
    if (selector === '.anime-sync-icon') {
      return new MockElement('svg');
    }
    if (selector === '#anime-stream-pill-container' || selector === '#anime-history-list') {
      return new MockElement('div');
    }
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

test('Anime Cloud Sync: Renders Sync Cloud button and styles properly', () => {
  const container = new MockElement('div');
  const view = new AnimeView({}, {});
  view.container = container;
  view.render();

  assert.ok(container.innerHTML.includes('id="btn-anime-sync"'), 'Header must contain #btn-anime-sync');
  assert.ok(container.innerHTML.includes('anime-sync-icon'), 'Header must contain .anime-sync-icon');
  assert.ok(container.innerHTML.includes('id="label-anime-sync"'), 'Header must contain #label-anime-sync');
  assert.ok(container.innerHTML.includes('Sync Cloud'), 'Default label must be Sync Cloud');
});

test('Anime Cloud Sync: syncAnimeToCloud sends batch progress payload non-destructively', async () => {
  let capturedBatchRequest = null;
  let capturedGetProgress = false;

  const mockApiClient = {
    request: async (endpoint, opts) => {
      if (endpoint === '/api/link/series') {
        return [
          {
            series: 'けいおん!',
            title_english: 'K-ON!',
            media_type: 'anime',
            poster_url: 'https://s4.anilist.co/poster.png',
            synopsis: 'Light music club story',
            episodes: [
              {
                hash: 'ep1_hash',
                title: 'Episode 1',
                episode_number: 1,
                last_position_ms: 592473,
                duration_ms: 1420000,
                completed: false,
                mined: 4
              }
            ]
          }
        ];
      }
      return [];
    }
  };

  const view = new AnimeView({}, { apiClient: mockApiClient });
  const container = new MockElement('div');
  view.container = container;

  // Intercept requestCloudApi
  view.requestCloudApi = async (endpoint, opts = {}) => {
    if (endpoint === '/api/user/progress/anime/batch') {
      capturedBatchRequest = JSON.parse(opts.body);
      return { ok: true, synced_count: 1 };
    }
    if (endpoint === '/api/user/progress/anime') {
      capturedGetProgress = true;
      return { ok: true, progress: [] };
    }
    return { ok: true };
  };

  await view.syncAnimeToCloud({ silent: true });

  assert.ok(capturedBatchRequest, 'Must send batch progress payload');
  assert.ok(Array.isArray(capturedBatchRequest.anime_progress), 'Payload must have anime_progress list');
  const item = capturedBatchRequest.anime_progress[0];
  assert.strictEqual(item.series_id, 'けいおん!');
  assert.strictEqual(item.episode_number, 1);
  assert.strictEqual(item.last_position_ms, 592473);
  assert.strictEqual(item.duration_ms, 1420000);
  assert.strictEqual(item.poster_url, 'https://s4.anilist.co/poster.png');
  assert.strictEqual(item.synopsis, 'Light music club story');
  assert.strictEqual(capturedGetProgress, true, 'Must pull cloud progress to ensure bidirectional sync');
  assert.strictEqual(view.syncStatus, 'synced', 'Sync status should be synced');
});

test('Anime Cloud Sync: Zero raw hex and adheres to design tokens in anime.css', () => {
  const cssPath = path.resolve(__dirname, '../src/ui/styles/views/anime.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // Verify spin keyframe
  assert.ok(cssContent.includes('anime-sync-spin'), 'Must include anime-sync-spin keyframe');
  assert.ok(cssContent.includes('.anime-sync-icon.is-spinning'), 'Must include is-spinning selector');

  // Check no raw hex colors outside approved comments
  const lines = cssContent.split('\n');
  lines.forEach((line, idx) => {
    if (line.trim().startsWith('/*') || line.trim().startsWith('*')) return;
    const hexMatch = line.match(/#[0-9a-fA-F]{3,8}\b/);
    assert.strictEqual(hexMatch, null, `Raw hex color found in anime.css at line ${idx + 1}: ${line}`);
  });
});
