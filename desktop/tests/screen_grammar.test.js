const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const grammarViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'grammar.js');

test('Grammar View: No hardcoded mock data in production templates', () => {
  const content = fs.readFileSync(grammarViewPath, 'utf8');

  // Forbidden placeholder mock text
  const forbidden = [
    'LV.28',
    '7 DAY STREAK',
    '214 / 848 MASTERED',
    '<h2 class="point-title" id="point-title">〜ほうがいい (hou ga ii)</h2>',
    '風邪を引いたなら、早く寝た<strong>ほうがいい</strong>ですよ。',
    'あまり無理をしない<strong>ほうがいい</strong>。',
    'catch (_) {}'
  ];

  for (const str of forbidden) {
    assert.equal(
      content.includes(str),
      false,
      `GrammarView must not contain placeholder string: "${str}"`
    );
  }

  // Shows honest empty placeholder
  assert.ok(
    content.includes('Enter a Japanese sentence above and click "Analyze Sentence"'),
    'GrammarView must show honest prompt state for tokens'
  );
  assert.ok(
    content.includes('Select any grammar token or browse the syllabus below'),
    'GrammarView must show honest prompt state for detail card'
  );
});

test('Grammar View: Sentence analyzer calls apiClient.analyzeGrammar and handles response', () => {
  const content = fs.readFileSync(grammarViewPath, 'utf8');

  assert.ok(
    content.includes('apiClient.analyzeGrammar('),
    'GrammarView must call apiClient.analyzeGrammar with input sentence'
  );
  assert.ok(
    content.includes('renderAnalyzedSentence('),
    'GrammarView must render segmented token chips from analyzed points'
  );
  assert.ok(
    content.includes('is-active-point'),
    'GrammarView must support active point elevation on token chips'
  );
});

test('Grammar View: Mastery pills call apiClient.updateGrammarPoint with status', () => {
  const content = fs.readFileSync(grammarViewPath, 'utf8');

  assert.ok(
    content.includes('apiClient.updateGrammarPoint('),
    'GrammarView must call apiClient.updateGrammarPoint when mastery pill clicked'
  );
  assert.ok(
    content.includes('loadInitialGrammarStats()'),
    'GrammarView must refresh stats after updating grammar mastery'
  );
  assert.ok(
    content.includes('updateSyllabusItemStatus('),
    'GrammarView must update syllabus item badge when mastery changes'
  );
});

test('Grammar View: Syllabus browser wires to apiClient.getGrammarSyllabus', () => {
  const content = fs.readFileSync(grammarViewPath, 'utf8');

  assert.ok(
    content.includes('apiClient.getGrammarSyllabus('),
    'GrammarView must fetch syllabus points via apiClient.getGrammarSyllabus'
  );
  assert.ok(
    content.includes('syllabus-level-pill'),
    'GrammarView must provide level filtering pills (N5–N1)'
  );
  assert.ok(
    content.includes('syllabus-search'),
    'GrammarView must provide search filter input'
  );
  assert.ok(
    content.includes('displayGrammarDetail('),
    'GrammarView must display point details when syllabus item is clicked'
  );
});

test('Grammar View: Error handling is visible with banner (no silent catches)', () => {
  const content = fs.readFileSync(grammarViewPath, 'utf8');

  assert.ok(
    content.includes('showError('),
    'GrammarView must implement visible showError method'
  );
  assert.ok(
    content.includes('grammar-error-banner'),
    'GrammarView must include visible grammar-error-banner element'
  );
  assert.ok(
    !content.includes('catch (_) {}'),
    'GrammarView must not contain empty silent catch blocks'
  );
});

test('Grammar View: bundle.css styles grammar studio with Planetoño tactile physics, pitch-black visualizer, and editorial Zen Old Mincho', () => {
  const bundleCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'bundle.css');
  const css = fs.readFileSync(bundleCssPath, 'utf8');

  // Planetoño tactile borders and shadows
  assert.ok(
    css.includes('2px solid var(--tactile-stroke)') || css.includes('2px solid #151413'),
    'bundle.css must apply 2px solid tactile stroke borders to grammar cards'
  );
  assert.ok(
    css.includes('3px 3px 0 var(--tactile-stroke)') || css.includes('3px 3px 0 #151413'),
    'bundle.css must apply 3px 3px 0 tactile offset shadows to grammar cards'
  );

  // Pure black visualizer surface
  assert.ok(
    css.includes('.grammar-visualizer-card') && (css.includes('var(--pure-black)') || css.includes('#000000')),
    'bundle.css must style .grammar-visualizer-card with pure black background'
  );

  // Pattern title typography
  assert.ok(
    css.includes('.point-title') && css.includes('var(--font-display)'),
    'bundle.css must style .point-title with Zen Old Mincho (var(--font-display))'
  );

  // Responsive layout: 1fr on compact and 2-column or split grid on wide
  assert.ok(
    css.includes('.grammar-layout-grid') && css.includes('grid-template-columns: 1fr'),
    'bundle.css must default .grammar-layout-grid to single column stack'
  );
  assert.ok(
    css.includes('.grammar-layout-grid') && (css.includes('grid-template-columns: 1.15fr 0.85fr') || css.includes('grid-template-columns: 1fr 1fr')),
    'bundle.css must expand .grammar-layout-grid on wide screens'
  );

  // No legacy chocolate/orange colors
  const forbiddenColors = ['#26170d', '#ff8a1f', '#fff1dc', '#e28c4b'];
  for (const c of forbiddenColors) {
    assert.equal(
      css.toLowerCase().includes(c),
      false,
      `bundle.css must not contain legacy color "${c}"`
    );
  }
});

test('Grammar View: Zero emojis across code, templates, and styles', () => {
  const bundleCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'bundle.css');
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

  for (const filePath of [grammarViewPath, bundleCssPath]) {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(emojiRegex);
    assert.equal(
      match,
      null,
      `Found forbidden emoji in ${path.basename(filePath)}: ${match?.[0]}`
    );
  }
});

