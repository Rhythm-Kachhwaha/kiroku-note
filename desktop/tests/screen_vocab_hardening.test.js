const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const vocabMainPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'vocab_main.js');
const vocabHistoryPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'vocab_history.js');
const vocabInvPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'vocab', 'vocab_inventory.js');

test('Vocab Hardening: Per-user auth switching and data synchronization in VocabMain', () => {
  const code = fs.readFileSync(vocabMainPath, 'utf8');

  assert.ok(code.includes('kiroku:auth-changed'), 'VocabMain must listen for kiroku:auth-changed');
  assert.ok(code.includes('updateFocusLevelDisplay'), 'VocabMain must update focus level on auth/level change');
  assert.ok(code.includes('this._authListener'), 'VocabMain must store and clean up _authListener');
  assert.ok(code.includes('activeSubView === \'shelves\''), 'VocabMain must refresh shelves when shelves subview is active');
});

test('Vocab Hardening: VocabHistory per-user auth, data sync, and cleanup', () => {
  const code = fs.readFileSync(vocabHistoryPath, 'utf8');

  assert.ok(code.includes('kiroku:auth-changed'), 'VocabHistory must listen for kiroku:auth-changed');
  assert.ok(code.includes('kiroku:data-changed'), 'VocabHistory must listen for kiroku:data-changed');
  assert.ok(code.includes('window.dispatchEvent(new CustomEvent(\'kiroku:data-changed\'))'), 'VocabHistory sync must notify data change');
  assert.ok(code.includes('removeEventListener(\'kiroku:auth-changed\''), 'VocabHistory must clean up auth listener');
  assert.ok(code.includes('removeEventListener(\'kiroku:data-changed\''), 'VocabHistory must clean up data change listener');
});

test('Vocab Hardening: VocabInventory per-user auth, word state events, and lifecycle', () => {
  const code = fs.readFileSync(vocabInvPath, 'utf8');

  assert.ok(code.includes('kiroku:auth-changed'), 'VocabInventory must listen for kiroku:auth-changed');
  assert.ok(code.includes('kiroku:data-changed'), 'VocabInventory must listen for kiroku:data-changed');
  assert.ok(code.includes('kiroku:word-state-changed'), 'VocabInventory must notify word state change for mastery tracking');
  assert.ok(code.includes('onShow()'), 'VocabInventory must implement onShow lifecycle hook');
  assert.ok(code.includes('onHide()'), 'VocabInventory must implement onHide lifecycle hook');
  assert.ok(code.includes('this._authListener = null'), 'VocabInventory unmount must nullify _authListener');
});

test('Vocab Hardening: Zero emoji policy in vocab files', () => {
  const emojiRegex = /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  for (const filePath of [vocabMainPath, vocabHistoryPath, vocabInvPath]) {
    const code = fs.readFileSync(filePath, 'utf8');
    assert.equal(emojiRegex.test(code), false, `Zero emojis policy violated in ${filePath}`);
  }
});
