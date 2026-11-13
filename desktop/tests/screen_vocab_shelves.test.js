import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const vocabInventoryPath = path.resolve(__dirname, '../src/ui/views/vocab/vocab_inventory.js');
const counterBundlePath = path.resolve(__dirname, '../src/ui/vendor/counter_bundle.js');
const vocabCssPath = path.resolve(__dirname, '../src/ui/styles/views/vocab.css');

test('Vocab Shelves: Sub-view switcher toggles between Curated Shelves and Full Inventory', () => {
  const content = fs.readFileSync(vocabInventoryPath, 'utf8');

  assert.ok(content.includes('id="tab-sub-shelves"'), 'Must render Curated Shelves tab');
  assert.ok(content.includes('id="tab-sub-table"'), 'Must render Full Inventory tab');
  assert.ok(content.includes('id="inv-shelves-container"'), 'Must render shelves container');
  assert.ok(content.includes('id="inv-table-section"'), 'Must render table section');
  assert.ok(content.includes('saveSubViewPreference('), 'Must persist sub-view preference in localStorage');
});

test('Vocab Shelves: Animata Spring Counter bundle is integrated without external CDN', () => {
  assert.ok(fs.existsSync(counterBundlePath), 'counter_bundle.js must exist locally');
  const bundleContent = fs.readFileSync(counterBundlePath, 'utf8');

  assert.ok(bundleContent.includes('mountCounter'), 'counter_bundle.js must export mountCounter');
  assert.ok(bundleContent.includes('stiffness'), 'Spring counter must support stiffness configuration');
  assert.ok(bundleContent.includes('damping'), 'Spring counter must support damping configuration');
  assert.ok(bundleContent.includes('prefers-reduced-motion'), 'Counter must respect prefers-reduced-motion');

  const invContent = fs.readFileSync(vocabInventoryPath, 'utf8');
  assert.ok(invContent.includes('mountCounter('), 'vocab_inventory.js must invoke mountCounter on metric pods');
});

test('Vocab Shelves: Transitive <-> Intransitive Hub renders paired cards with particles and mastery', () => {
  const content = fs.readFileSync(vocabInventoryPath, 'utf8');

  assert.ok(content.includes('id="shelf-transitive-pairs"'), 'Must render transitive pairs shelf card');
  assert.ok(content.includes('id="transitive-pairs-grid"'), 'Must render transitive pairs grid');
  assert.ok(content.includes('filter-pair-level'), 'Must render level filter for transitive pairs');
  assert.ok(content.includes('filter-pair-mastery'), 'Must render mastery filter for transitive pairs');
  assert.ok(content.includes('particle-transitive'), 'Must display transitive particle badge [を]');
  assert.ok(content.includes('particle-intransitive'), 'Must display intransitive particle badge [が]');
  assert.ok(content.includes('apiClient.getTransitivePairs('), 'Must fetch pairs from transitive pairs API');
});

test('Vocab Shelves: Adverbs & Mimetics and Adjectives shelves support nuance & inflection tabs', () => {
  const content = fs.readFileSync(vocabInventoryPath, 'utf8');

  // Adverbs & Mimetics
  assert.ok(content.includes('id="shelf-adverbs-mimetics"'), 'Must render adverbs & mimetics shelf');
  assert.ok(content.includes('id="adverbs-shelf-grid"'), 'Must render adverbs grid');
  assert.ok(content.includes('filter-adverb-tab'), 'Must render nuance filter tabs');
  assert.ok(content.includes('data-nuance="giongo"'), 'Must support giongo nuance tab');
  assert.ok(content.includes('data-nuance="emotion"'), 'Must support emotion nuance tab');

  // Adjectives
  assert.ok(content.includes('id="shelf-adjectives"'), 'Must render adjectives shelf');
  assert.ok(content.includes('id="adjectives-shelf-grid"'), 'Must render adjectives grid');
  assert.ok(content.includes('data-tab="i"'), 'Must support i-adjectives tab');
  assert.ok(content.includes('data-tab="na"'), 'Must support na-adjectives tab');
});

test('Vocab Shelves: JLPT Gap shelf provides category breakdown, one-click mining, and Study drill', () => {
  const content = fs.readFileSync(vocabInventoryPath, 'utf8');

  assert.ok(content.includes('id="shelf-jlpt-gaps"'), 'Must render JLPT gaps shelf');
  assert.ok(content.includes('id="gaps-shelf-grid"'), 'Must render gaps grid');
  assert.ok(content.includes('filter-gap-cat'), 'Must render gap category filter pills');
  assert.ok(content.includes('btn-mine-gap'), 'Must render one-click mine card button');
  assert.ok(content.includes('handleMineGapWord('), 'Must implement handleMineGapWord');
  assert.ok(content.includes('id="btn-drill-shelf-gaps"'), 'Must render Drill in Study button');
});

test('Vocab Shelves: Tactile CSS styles and zero emojis policy enforced', () => {
  const cssContent = fs.readFileSync(vocabCssPath, 'utf8');
  const jsContent = fs.readFileSync(vocabInventoryPath, 'utf8');

  // Check CSS classes
  assert.ok(cssContent.includes('.inv-sub-segments'), 'CSS must define .inv-sub-segments');
  assert.ok(cssContent.includes('.transitive-pair-card'), 'CSS must define .transitive-pair-card');
  assert.ok(cssContent.includes('.particle-transitive'), 'CSS must define .particle-transitive');
  assert.ok(cssContent.includes('.particle-intransitive'), 'CSS must define .particle-intransitive');
  assert.ok(cssContent.includes('.pair-split-columns'), 'CSS must define .pair-split-columns');

  // Zero emojis regex
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.ok(!emojiRegex.test(jsContent), 'vocab_inventory.js must contain zero emojis');
  assert.ok(!emojiRegex.test(cssContent), 'vocab.css must contain zero emojis');
});
