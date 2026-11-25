import test from 'node:test';
import assert from 'node:assert/strict';
import { AnimeView } from '../src/ui/views/anime.js';

test('AnimeView.syncAnimeToCloud pulls cues when /api/link/episodes returns { episodes: [...] }', async () => {
  const localCalls = [];
  const cloudCalls = [];

  const mockApiClient = {
    async request(endpoint, options = {}) {
      localCalls.push({ endpoint, options });
      if (endpoint === '/api/link/series') {
        return [{
          series: 'K-ON!',
          title_english: 'K-ON!',
          episodes: [{ hash: 'ep1_hash', title: 'Episode 1', episode_number: 1, has_cues: false, last_position_ms: 1000, duration_ms: 1440000 }],
        }];
      }
      if (endpoint === '/api/link/sessions') return [];
      return { ok: true };
    },
  };

  const view = new AnimeView();
  view.apiClient = mockApiClient;
  view.requestCloudApi = async (endpoint, options = {}) => {
    cloudCalls.push({ endpoint, options });
    if (endpoint === '/api/user/progress/anime/batch') return { ok: true, count: 1 };
    if (endpoint === '/api/user/progress/anime') return { progress: [] };
    if (endpoint.startsWith('/api/link/episodes?')) {
      return {
        episodes: [{
          hash: 'ep1_hash',
          title: 'Episode 1',
          series: 'K-ON!',
          episode_number: 1,
          duration_ms: 1440000,
        }],
      };
    }
    if (endpoint === '/api/link/episodes/ep1_hash/cues') {
      return {
        hash: 'ep1_hash',
        title: 'Episode 1',
        series: 'K-ON!',
        episode_number: 1,
        cues: [{ i: 0, s: 1, e: 3, text: '軽音部' }],
        mined_words: ['軽音部'],
      };
    }
    return {};
  };

  await view.syncAnimeToCloud({ silent: true });

  const syncPost = localCalls.find((c) => c.endpoint === '/api/link/episodes/sync');
  assert.ok(syncPost, 'Expected syncAnimeToCloud to POST pulled cues to /api/link/episodes/sync');
  const body = JSON.parse(syncPost.options.body);
  assert.equal(body.hash, 'ep1_hash');
  assert.equal(body.cues.length, 1);
});
