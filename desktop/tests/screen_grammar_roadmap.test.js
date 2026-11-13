import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const grammarJsPath = path.resolve('desktop/src/ui/views/grammar.js');
const grammarCssPath = path.resolve('desktop/src/ui/styles/views/grammar.css');

test('Roadmap: Promise.allSettled is used for resilient dual-mode loading', () => {
  const content = fs.readFileSync(grammarJsPath, 'utf8');
  assert.ok(
    content.includes('Promise.allSettled'),
    'Expected loadRoadmap to use Promise.allSettled'
  );
  assert.ok(
    !content.includes('Promise.all([\n        apiClient.getGrammarRoadmapFlow()'),
    'Promise.all should be replaced with Promise.allSettled'
  );
});

test('Roadmap: Continue button is rendered in toolbar and wired', () => {
  const content = fs.readFileSync(grammarJsPath, 'utf8');
  assert.ok(
    content.includes('id="btn-roadmap-continue"'),
    'Expected #btn-roadmap-continue in template'
  );
  assert.ok(
    content.includes('continueNextRoadmapPoint'),
    'Expected continueNextRoadmapPoint handler'
  );
});

test('Roadmap: Chip status dot has dedicated action and optimistic cycling', () => {
  const content = fs.readFileSync(grammarJsPath, 'utf8');
  assert.ok(
    content.includes('data-action="cycle-status"'),
    'Expected data-action="cycle-status" on .roadmap-chip-dot'
  );
  assert.ok(
    content.includes('cycleChipStatus'),
    'Expected cycleChipStatus method'
  );
  assert.ok(
    content.includes('updateStageStatsInDom'),
    'Expected updateStageStatsInDom method for zero-reload updates'
  );
  assert.ok(
    content.includes('updateRoadmapChipStatus'),
    'Expected updateRoadmapChipStatus method'
  );
});

test('Roadmap: Full-screen continuous Tofugu breakdown reader renders all 6 sections', () => {
  const content = fs.readFileSync(grammarJsPath, 'utf8');
  assert.ok(
    content.includes('id="grammar-full-breakdown-view"'),
    'Expected #grammar-full-breakdown-view container'
  );
  assert.ok(
    content.includes('id="breakdown-concept-content"'),
    'Expected section 1 concept banner'
  );
  assert.ok(
    content.includes('id="breakdown-formations-content"'),
    'Expected section 2 formation formulas'
  );
  assert.ok(
    content.includes('id="breakdown-contrasts-content"'),
    'Expected section 3 nuance contrasts'
  );
  assert.ok(
    content.includes('id="breakdown-pitfalls-content"'),
    'Expected section 4 common pitfalls'
  );
  assert.ok(
    content.includes('id="breakdown-examples-content"'),
    'Expected section 5 natural examples'
  );
  assert.ok(
    content.includes('id="breakdown-encounters-content"'),
    'Expected section 6 card encounters'
  );
  assert.ok(
    content.includes('openFullBreakdown'),
    'Expected openFullBreakdown method'
  );
  assert.ok(
    content.includes('closeFullBreakdown'),
    'Expected closeFullBreakdown method'
  );
  assert.ok(
    content.includes('btn-breakdown-revise') && content.includes('btn-breakdown-mastered'),
    'Expected Revise and Mastered action buttons in breakdown reader'
  );
});

test('Roadmap: Styles exist for full-screen breakdown reader and tactile dot', () => {
  const css = fs.readFileSync(grammarCssPath, 'utf8');
  assert.ok(
    css.includes('.grammar-full-breakdown-view'),
    'Expected .grammar-full-breakdown-view in grammar.css'
  );
  assert.ok(
    css.includes('.breakdown-reader-container'),
    'Expected .breakdown-reader-container in grammar.css'
  );
  assert.ok(
    css.includes('.roadmap-chip-dot:hover'),
    'Expected hover interaction on .roadmap-chip-dot'
  );
  assert.ok(
    css.includes('.roadmap-point-chip.is-save-failed'),
    'Expected .is-save-failed pulse animation'
  );
  assert.ok(
    css.includes('.roadmap-continue-btn'),
    'Expected .roadmap-continue-btn tactile styles'
  );
});

test('Roadmap: Zero emojis across implementation files', () => {
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  const jsContent = fs.readFileSync(grammarJsPath, 'utf8');
  const cssContent = fs.readFileSync(grammarCssPath, 'utf8');
  assert.ok(!emojiRegex.test(jsContent), 'Found emoji in grammar.js');
  assert.ok(!emojiRegex.test(cssContent), 'Found emoji in grammar.css');
});
