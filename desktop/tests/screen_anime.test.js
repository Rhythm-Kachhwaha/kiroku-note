/**
 * Test: Anime Screen & Navigation Tab Verification
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const dockPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'shell', 'bottom_dock.js');
const animeViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'anime.js');
const routerPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'router.js');
const animeCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'anime.css');

test('Anime Tab: BottomDock registers Anime tab right before Study tab', () => {
  const content = fs.readFileSync(dockPath, 'utf8');

  // Verify anime tab object exists with correct id, label, sublabel, and svg icon
  assert.match(content, /id:\s*['"]anime['"]/);
  assert.match(content, /label:\s*['"]Anime['"]/);
  assert.match(content, /sublabel:\s*['"]アニメ['"]/);
  assert.match(content, /iconSvg:\s*`<svg viewBox="0 0 24 24">/);

  // Verify tab order: anime must precede study
  const animeIndex = content.indexOf("id: 'anime'");
  const studyIndex = content.indexOf("id: 'study'");
  assert.ok(animeIndex > 0, 'Anime tab must be defined');
  assert.ok(studyIndex > 0, 'Study tab must be defined');
  assert.ok(animeIndex < studyIndex, 'Anime tab must precede Study tab');
});

test('Anime View: Page header mimics standard tab header with uplifting letters', () => {
  const content = fs.readFileSync(animeViewPath, 'utf8');

  // Verify standard brand header markup
  assert.match(content, /class="grammar-brand-header"/);
  assert.match(content, /class="grammar-word-title"/);
  assert.match(content, /class="grammar-word-kanji"/);

  // Verify uplifting letters for ANIME
  assert.match(content, /<span class="hero-letter">A<\/span>/);
  assert.match(content, /<span class="hero-letter">N<\/span>/);
  assert.match(content, /<span class="hero-letter">I<\/span>/);
  assert.match(content, /<span class="hero-letter">M<\/span>/);
  assert.match(content, /<span class="hero-letter">E<\/span>/);

  // Verify uplifting letters for アニメ
  assert.match(content, /<span class="hero-letter">ア<\/span>/);
  assert.match(content, /<span class="hero-letter">ニ<\/span>/);
  assert.match(content, /<span class="hero-letter">メ<\/span>/);
});

test('Anime Router: AppRouter registers anime route and tabOrder', () => {
  const content = fs.readFileSync(routerPath, 'utf8');

  // Verify route registration
  assert.match(content, /import\s*\{\s*AnimeView\s*\}\s*from\s*['"]\.\/views\/anime\.js['"]/);
  assert.match(content, /'anime':\s*AnimeView/);

  // Verify tab order in router has anime before study
  assert.match(content, /tabOrder\s*=\s*\[[^\]]*'test',\s*'anime',\s*'study'[^\]]*\]/);
});

test('Anime CSS: anime.css uses strictly tokens and no raw hex', () => {
  const css = fs.readFileSync(animeCssPath, 'utf8');

  // No raw hex
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);

  // Uses design tokens
  assert.match(css, /var\(--pure-black\)/);
  assert.match(css, /var\(--architectural-cream\)/);
  assert.match(css, /var\(--tactile-stroke\)/);
});
