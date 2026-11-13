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

test('Vocab Shelves: Collapsible multi-open behavior and expand/collapse controls', () => {
  const content = fs.readFileSync(vocabInventoryPath, 'utf8');

  assert.ok(content.includes('this.openedShelves = new Set()'), 'Shelves must start collapsed by default');
  assert.ok(content.includes('toggleShelf('), 'Must provide toggleShelf method');
  assert.ok(content.includes('applyShelfState('), 'Must provide applyShelfState method');
  assert.ok(content.includes('expandAllShelves('), 'Must provide expandAllShelves method');
  assert.ok(content.includes('collapseAllShelves('), 'Must provide collapseAllShelves method');
  assert.ok(content.includes('shelf-accordion-toggle'), 'Must render shelf accordion toggle headers');
  assert.ok(content.includes('id="btn-shelves-expand-all"'), 'Must render Expand all toolbar button');
  assert.ok(content.includes('id="btn-shelves-collapse-all"'), 'Must render Collapse all toolbar button');
  assert.ok(content.includes('shelf-chevron'), 'Must render SVG chevrons for visual accordion state');
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

test('Vocab Shelves: Standard Adverbs shelf separated from Onomatopoeia with grammatical nuance tabs', () => {
  const content = fs.readFileSync(vocabInventoryPath, 'utf8');

  assert.ok(content.includes('id="shelf-adverbs"'), 'Must render dedicated adverbs shelf');
  assert.ok(content.includes('id="adverbs-shelf-grid"'), 'Must render adverbs grid');
  assert.ok(content.includes('filter-adverb-tab'), 'Must render adverb nuance filter tabs');
  assert.ok(content.includes('data-type="degree"'), 'Must support degree nuance tab');
  assert.ok(content.includes('data-type="time"'), 'Must support time nuance tab');
  assert.ok(content.includes('data-type="frequency"'), 'Must support frequency nuance tab');
  assert.ok(content.includes('data-type="manner"'), 'Must support manner nuance tab');
});

test('Vocab Shelves: Dedicated Onomatopoeia & Mimetics shelf with sound symbolism nuances', () => {
  const content = fs.readFileSync(vocabInventoryPath, 'utf8');

  assert.ok(content.includes('id="shelf-onomatopoeia"'), 'Must render dedicated onomatopoeia shelf');
  assert.ok(content.includes('id="onomatopoeia-shelf-grid"'), 'Must render onomatopoeia grid');
  assert.ok(content.includes('filter-onomatopoeia-tab'), 'Must render onomatopoeia nuance tabs');
  assert.ok(content.includes('data-nuance="giongo"'), 'Must support giongo (sound) tab');
  assert.ok(content.includes('data-nuance="giseigo"'), 'Must support giseigo (voice) tab');
  assert.ok(content.includes('data-nuance="gitaigo"'), 'Must support gitaigo (manner) tab');
  assert.ok(content.includes('data-nuance="emotion"'), 'Must support emotion tab');
  assert.ok(content.includes('renderOnomatopoeiaShelf('), 'Must implement renderOnomatopoeiaShelf');
});

test('Vocab Shelves: Adjectives showcase supports i-adjective and na-adjective tabs', () => {
  const content = fs.readFileSync(vocabInventoryPath, 'utf8');

  assert.ok(content.includes('id="shelf-adjectives"'), 'Must render adjectives shelf');
  assert.ok(content.includes('id="adjectives-shelf-grid"'), 'Must render adjectives grid');
  assert.ok(content.includes('data-tab="i"'), 'Must support i-adjectives tab');
  assert.ok(content.includes('data-tab="na"'), 'Must support na-adjectives tab');
});

test('Vocab Shelves: Dedicated Keigo (Honorifics) Hub with Sonkeigo and Kenjougo comparisons', () => {
  const content = fs.readFileSync(vocabInventoryPath, 'utf8');

  assert.ok(content.includes('id="shelf-keigo"'), 'Must render dedicated Keigo shelf');
  assert.ok(content.includes('id="keigo-shelf-grid"'), 'Must render keigo shelf grid');
  assert.ok(content.includes('filter-keigo-tab'), 'Must render keigo filter tabs');
  assert.ok(content.includes('data-type="sonkeigo"'), 'Must support Sonkeigo tab');
  assert.ok(content.includes('data-type="kenjougo"'), 'Must support Kenjougo tab');
  assert.ok(content.includes('apiClient.getKeigo('), 'Must fetch Keigo entries from API');
  assert.ok(content.includes('renderKeigoShelf('), 'Must implement renderKeigoShelf');
  assert.ok(content.includes('keigo-trio-card'), 'Must render keigo trio cards');
  assert.ok(content.includes('keigo-sonkeigo-box'), 'Must render respectful Sonkeigo box');
  assert.ok(content.includes('keigo-kenjougo-box'), 'Must render humble Kenjougo box');
});

test('Vocab Shelves: Larger lists and load more pagination controls ("Show more" / "Show all")', () => {
  const content = fs.readFileSync(vocabInventoryPath, 'utf8');

  assert.ok(content.includes('btn-shelf-show-more'), 'Must render "Show +30 more" pagination buttons');
  assert.ok(content.includes('btn-shelf-show-all'), 'Must render "Show all" pagination buttons');
  assert.ok(content.includes('shelf-pagination-footer'), 'Must render shelf pagination footers');
  assert.ok(content.includes('updateShelfPagination('), 'Must implement updateShelfPagination');
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
  assert.ok(cssContent.includes('.shelf-accordion-toggle'), 'CSS must define .shelf-accordion-toggle');
  assert.ok(cssContent.includes('.shelf-chevron'), 'CSS must define .shelf-chevron');
  assert.ok(cssContent.includes('.keigo-shelf-grid'), 'CSS must define .keigo-shelf-grid');
  assert.ok(cssContent.includes('.keigo-trio-card'), 'CSS must define .keigo-trio-card');

  // Zero emojis regex
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.ok(!emojiRegex.test(jsContent), 'vocab_inventory.js must contain zero emojis');
  assert.ok(!emojiRegex.test(cssContent), 'vocab.css must contain zero emojis');
});
