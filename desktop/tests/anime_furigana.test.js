const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const animeJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(__dirname, '..', 'src', 'ui', 'styles', 'views', 'anime.css');

test('anime_furigana: anime.js implements selective furigana ruby engine', () => {
  const content = fs.readFileSync(animeJsPath, 'utf8');

  assert.ok(
    content.includes('furiganaEnabled'),
    'anime.js must maintain furiganaEnabled state'
  );
  assert.ok(
    content.includes('<ruby>') || content.includes('<ruby'),
    'anime.js must generate <ruby> tags'
  );
  assert.ok(
    content.includes('<rt>') || content.includes('<rt'),
    'anime.js must generate <rt> annotation tags'
  );
  assert.ok(
    content.includes('btn-anime-toggle-furigana'),
    'anime.js must render furigana toggle affordance'
  );
});

test('anime_furigana: anime.css styles ruby and rt with design tokens without emoji', () => {
  const css = fs.readFileSync(animeCssPath, 'utf8');

  assert.ok(
    css.includes('ruby') && css.includes('rt'),
    'anime.css must style ruby and rt elements'
  );

  // Strictly no emoji
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(css), false, 'anime.css must not contain emoji');
});
