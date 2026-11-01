const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const stylesDir = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles');
const tokensCssPath = path.join(stylesDir, 'tokens.css');
const fontsCssPath = path.join(stylesDir, 'fonts.css');
const tactileCssPath = path.join(stylesDir, 'tactile.css');

test('Design Tokens: tokens.css contains no forbidden chocolate or orange hex codes', () => {
  const content = fs.readFileSync(tokensCssPath, 'utf8');

  const forbiddenCodes = ['#26170D', '#FF8A1F', '#FFF1DC'];
  for (const code of forbiddenCodes) {
    const regex = new RegExp(code, 'i');
    assert.equal(
      regex.test(content),
      false,
      `tokens.css must not contain forbidden legacy code ${code}`
    );
  }
});

test('Design Tokens: tokens.css defines the official primary and supporting palette', () => {
  const content = fs.readFileSync(tokensCssPath, 'utf8');

  // Primary colors
  assert.ok(content.toLowerCase().includes('#141311'), 'Must include Ink Black (#141311)');
  assert.ok(content.toLowerCase().includes('#f5f1e8'), 'Must include Warm Paper (#F5F1E8)');
  assert.ok(content.toLowerCase().includes('#d94b38'), 'Must include Vermilion (#D94B38)');

  // Supporting palette
  assert.ok(content.toLowerCase().includes('#1c1b19'), 'Must include Ink Surface (#1C1B19)');
  assert.ok(content.toLowerCase().includes('#2a2926'), 'Must include Elevated Surface (#2A2926)');
  assert.ok(content.toLowerCase().includes('#151413'), 'Must include Tactile Stroke (#151413)');
  assert.ok(content.toLowerCase().includes('#c8a94a'), 'Must include Gold (#C8A94A)');
  assert.ok(content.toLowerCase().includes('#4ebb7b'), 'Must include Jade (#4EBB7B)');
  assert.ok(content.toLowerCase().includes('#f59e0b'), 'Must include Amber (#F59E0B)');
  assert.ok(content.toLowerCase().includes('#000000'), 'Must include Pure Black (#000000)');
  assert.ok(content.includes('rgba(245, 241, 232, 0.12)'), 'Must include Subtle Border rgba(245, 241, 232, 0.12)');
});

test('Design Tokens: tokens.css provides semantic scale and backward-compatible aliases', () => {
  const content = fs.readFileSync(tokensCssPath, 'utf8');

  // Semantic mapping aliases
  const requiredSemantic = [
    '--color-bg',
    '--color-surface',
    '--color-surface-elevated',
    '--color-primary',
    '--color-text',
    '--color-border',
    '--ink-black',
    '--warm-paper',
    '--vermilion',
    '--tactile-stroke',
    '--background',
    '--surface',
    '--surface-container',
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--status-green',
    '--status-amber',
    '--status-red'
  ];

  for (const token of requiredSemantic) {
    assert.ok(
      content.includes(token),
      `tokens.css must define or alias semantic token "${token}"`
    );
  }
});

test('Design Tokens: tokens.css uses 3 active typography families and excludes obsolete display fonts', () => {
  const content = fs.readFileSync(tokensCssPath, 'utf8');

  // Active families
  assert.ok(content.includes('Zen Old Mincho'), 'tokens.css must use Zen Old Mincho for display/wordmark');
  assert.ok(content.includes('Zen Kaku Gothic New'), 'tokens.css must use Zen Kaku Gothic New for Japanese text');
  assert.ok(content.includes('Inter'), 'tokens.css must use Inter for UI/sans text');

  // Active token assignments must not use Mochiy Pop One, Epilogue, or Noto Serif
  const fontDisplayMatch = content.match(/--font-display:\s*([^;]+);/);
  assert.ok(fontDisplayMatch, '--font-display must be defined');
  assert.equal(
    /Mochiy Pop One|Epilogue|Noto Serif/i.test(fontDisplayMatch[1]),
    false,
    `--font-display must not reference obsolete families, found: ${fontDisplayMatch[1]}`
  );
});

test('Typography: fonts.css sets font-display swap on active families and deprecates obsolete families', () => {
  const content = fs.readFileSync(fontsCssPath, 'utf8');

  // Active families with font-display: swap
  assert.ok(content.includes('font-family: "Zen Old Mincho"'), 'fonts.css must declare Zen Old Mincho');
  assert.ok(content.includes('font-family: "Zen Kaku Gothic New"'), 'fonts.css must declare Zen Kaku Gothic New');
  assert.ok(content.includes('font-family: "Inter"'), 'fonts.css must declare Inter');
  assert.ok(content.includes('font-display: swap'), 'fonts.css must configure font-display: swap');

  // Mochiy Pop One, Epilogue, and Noto Serif must not be active @font-face rules
  // (either commented out or deprecated)
  // Check that uncommented @font-face blocks do not include the deprecated font families
  const lines = content.split('\n');
  let inComment = false;
  let activeFontFamilies = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('/*')) inComment = true;
    if (!inComment) {
      const match = trimmed.match(/font-family:\s*["']([^"']+)["']/);
      if (match) {
        activeFontFamilies.push(match[1]);
      }
    }
    if (trimmed.endsWith('*/')) inComment = false;
  }

  assert.equal(
    activeFontFamilies.includes('Mochiy Pop One'),
    false,
    'Mochiy Pop One must not be an active font-family rule in fonts.css'
  );
  assert.equal(
    activeFontFamilies.includes('Epilogue'),
    false,
    'Epilogue must not be an active font-family rule in fonts.css'
  );
  assert.equal(
    activeFontFamilies.includes('Noto Serif'),
    false,
    'Noto Serif must not be an active font-family rule in fonts.css'
  );
});

test('Tactile Physics: tactile.css implements Planetoño offset shadow system and components', () => {
  const content = fs.readFileSync(tactileCssPath, 'utf8');

  // Hard offset shadow system
  assert.ok(
    content.includes('3px 3px 0') || content.includes('var(--shadow-md)'),
    'tactile.css must implement 3px 3px 0 rest shadow'
  );
  assert.ok(
    content.includes('4px 4px 0') || content.includes('var(--shadow-lg)'),
    'tactile.css must implement 4px 4px 0 hover shadow'
  );
  assert.ok(
    content.includes('1px 1px 0') || content.includes('var(--shadow-pressed)'),
    'tactile.css must implement 1px 1px 0 active shadow'
  );
  assert.ok(
    content.includes('translate(-1px, -1px)'),
    'tactile.css must translate(-1px, -1px) on hover'
  );
  assert.ok(
    content.includes('translate(2px, 2px)'),
    'tactile.css must translate(2px, 2px) on active depression'
  );

  // Components: comic burst sticker badges, organic shape backings, tactile pills, accessible focus outlines
  assert.ok(
    content.includes('comic-burst-sticker') || content.includes('tactile-badge-burst'),
    'tactile.css must define comic burst sticker badge class'
  );
  assert.ok(
    content.includes('organic-shape-backing') || content.includes('organic-backing'),
    'tactile.css must define organic shape backing class'
  );
  assert.ok(
    content.includes('tactile-pill'),
    'tactile.css must define tactile pill badges'
  );
  assert.ok(
    content.includes(':focus-visible'),
    'tactile.css must define accessible focus outlines'
  );
});

test('Golden Rule: Zero emojis across design tokens, fonts, and tactile styles', () => {
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

  for (const filePath of [tokensCssPath, fontsCssPath, tactileCssPath]) {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(emojiRegex);
    assert.equal(
      match,
      null,
      `Found forbidden emoji in ${path.basename(filePath)}: ${match?.[0]}`
    );
  }
});
