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
