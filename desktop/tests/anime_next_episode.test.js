const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LinkStore } = require('../src/ui/services/link_store.js');

test('anime_next_episode: LinkStore sends cmd.next_episode', () => {
  let sentCommand = null;
  const mockClient = {
    on: () => {},
    sendCommand: (cmd, payload) => {
      sentCommand = { cmd, payload };
      return true;
    }
  };

  const store = new LinkStore(mockClient);
  assert.equal(typeof store.nextEpisode, 'function', 'store.nextEpisode should be a function');
  store.nextEpisode();

  assert.deepEqual(sentCommand, { cmd: 'cmd.next_episode', payload: {} });
});

test('anime_next_episode: anime.js renders Next Ep button and wires click handler', () => {
  const animeJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'anime.js');
  const content = fs.readFileSync(animeJsPath, 'utf8');

  assert.ok(
    content.includes('btn-anime-next-ep'),
    'anime.js must render #btn-anime-next-ep button'
  );
  assert.ok(
    content.includes('nextEpisode') || content.includes('cmd.next_episode'),
    'anime.js must trigger nextEpisode action'
  );
});
