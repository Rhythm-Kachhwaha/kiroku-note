const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const grammarViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'grammar.js');

test('Grammar Hardening: Per-user auth switching and JLPT level reactivity', () => {
  const code = fs.readFileSync(grammarViewPath, 'utf8');

  assert.ok(code.includes('kiroku:auth-changed'), 'GrammarView must listen for kiroku:auth-changed');
  assert.ok(code.includes('kiroku:learner-level-changed'), 'GrammarView must listen for kiroku:learner-level-changed');
  assert.ok(code.includes('updateLevelPillsInDom'), 'GrammarView must update visual syllabus level pills');
  assert.ok(code.includes('kiroku:data-changed'), 'GrammarView must listen for kiroku:data-changed');
});

test('Grammar Hardening: Lifecycle cleanup in onHide and unmount', () => {
  const code = fs.readFileSync(grammarViewPath, 'utf8');

  assert.ok(code.includes('removeEventListener(\'kiroku:learner-level-changed\''), 'Must clean up learner level listener in onHide');
  assert.ok(code.includes('removeEventListener(\'kiroku:auth-changed\''), 'Must clean up auth listener in onHide');
  assert.ok(code.includes('removeEventListener(\'kiroku:data-changed\''), 'Must clean up data changed listener in onHide');
  assert.ok(code.includes('this.searchDebounce'), 'Must track searchDebounce timer on instance');
  assert.ok(code.includes('clearTimeout(this.searchDebounce)'), 'Must clear search debouncer on hide');
});

test('Grammar Hardening: Zero emoji policy in grammar view', () => {
  const emojiRegex = /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  const code = fs.readFileSync(grammarViewPath, 'utf8');
  assert.equal(emojiRegex.test(code), false, 'Zero emojis policy violated in grammar.js');
});
