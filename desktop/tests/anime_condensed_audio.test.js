const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const animeJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'anime.js');

test('anime_condensed_audio: anime.js renders condensed audio export button', () => {
  const content = fs.readFileSync(animeJsPath, 'utf8');
  assert.ok(content.includes('btn-anime-export-condensed'), 'anime.js must render #btn-anime-export-condensed');
  assert.ok(content.includes('exportCondensedAudio'), 'anime.js must implement exportCondensedAudio');
});
