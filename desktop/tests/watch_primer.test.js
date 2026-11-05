/**
 * Tests for Watch Primer & Recap (Slice 44).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const primerPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'watch_primer.js');

test('WatchPrimerView exists and is valid ES module', async () => {
  assert.ok(fs.existsSync(primerPath), 'watch_primer.js must exist');
  const code = fs.readFileSync(primerPath, 'utf8');
  assert.ok(code.includes('export class WatchPrimerView'), 'Must export WatchPrimerView class');
  assert.ok(code.includes('renderPrimer'), 'Must provide renderPrimer method');
  assert.ok(code.includes('renderRecap'), 'Must provide renderRecap method');
  assert.ok(code.includes('mineAllSequentially'), 'Must provide mineAllSequentially method');
});

test('WatchPrimerView: renderPrimer renders gap words, mine-all, grammar points, and mini-quiz', async () => {
  const { WatchPrimerView } = await import('../src/ui/views/watch_primer.js');

  const view = new WatchPrimerView();
  const mockContainer = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };

  const mockPrimerData = {
    hash: 'ep_test_hash',
    learner_level: 'N4',
    total_cues: 42,
    gap_words: [
      { word: '猫', reading: 'ねこ', meaning: 'cat', level: 'N5', frequency: 5 },
      { word: '走る', reading: 'はしる', meaning: 'to run', level: 'N5', frequency: 3 },
    ],
    grammar_points: [
      { pattern_key: 'te_form', display: '〜て', level: 'N5', frequency: 8 }
    ],
    quiz: [
      {
        id: 1,
        word: '猫',
        reading: 'ねこ',
        prompt: 'What is the meaning of 「猫」(ねこ)?',
        options: ['cat', 'dog', 'bird', 'fish'],
        correct_index: 0,
        explanation: '「猫」(ねこ) means: cat'
      }
    ]
  };

  view.renderPrimer(mockContainer, mockPrimerData);

  // Check generated DOM string
  assert.ok(mockContainer.innerHTML.includes('Episode Primer'), 'Must include header title');
  assert.ok(mockContainer.innerHTML.includes('primer-mine-all-btn'), 'Must have Mine All button');
  assert.ok(mockContainer.innerHTML.includes('猫'), 'Must render gap word 猫');
  assert.ok(mockContainer.innerHTML.includes('ねこ'), 'Must render reading');
  assert.ok(mockContainer.innerHTML.includes('5x'), 'Must render frequency');
  assert.ok(mockContainer.innerHTML.includes('〜て'), 'Must render grammar point');
  assert.ok(mockContainer.innerHTML.includes('primer-quiz-mount'), 'Must have quiz mount container');
});

test('WatchPrimerView: renderRecap renders lines watched, % known diff, mined chips, and study CTA', async () => {
  const { WatchPrimerView } = await import('../src/ui/views/watch_primer.js');

  const view = new WatchPrimerView();
  const mockContainer = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };

  const mockRecapData = {
    hash: 'ep_test_hash',
    title: 'Episode 10',
    site: 'crunchyroll',
    lines_watched: 120,
    known_pct_before: 80.0,
    known_pct_after: 86.5,
    words_mined: ['猫', '走る'],
    gap_words_unseen: ['飛ぶ', '泳ぐ'],
    minutes: 24.0,
    review_link: '#/study?mode=practice&filter=mined'
  };

  view.renderRecap(mockContainer, mockRecapData);

  assert.ok(mockContainer.innerHTML.includes('Session Recap'), 'Must render recap header');
  assert.ok(mockContainer.innerHTML.includes('120'), 'Must render lines watched count');
  assert.ok(mockContainer.innerHTML.includes('86.5%'), 'Must render after known percent');
  assert.ok(mockContainer.innerHTML.includes('80%'), 'Must render before known percent');
  assert.ok(mockContainer.innerHTML.includes('recap-review-btn'), 'Must have Review Mined Words CTA button');
  assert.ok(mockContainer.innerHTML.includes('Review Mined Words'), 'Must have Review Mined Words text');
  assert.ok(mockContainer.innerHTML.includes('猫'), 'Must render mined word chip');
  assert.ok(mockContainer.innerHTML.includes('飛ぶ'), 'Must render unseen gap chip');
});

test('WatchPrimerView: mineAllSequentially iterates sequentially over words', async () => {
  const { WatchPrimerView } = await import('../src/ui/views/watch_primer.js');

  const calls = [];
  const mockApiClient = {
    request: async (endpoint, opts) => {
      calls.push({ endpoint, opts });
      return { ok: true };
    }
  };

  const view = new WatchPrimerView({ apiClient: mockApiClient });
  const words = [
    { word: '猫' },
    { word: '犬' }
  ];

  const progressUpdates = [];
  const results = await view.mineAllSequentially(words, (done, total, word) => {
    progressUpdates.push({ done, total, word });
  });

  assert.equal(results.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].endpoint, '/api/capture');
  assert.equal(calls[0].opts.body.text, '猫');
  assert.equal(calls[1].opts.body.text, '犬');
  assert.equal(progressUpdates.length, 2);
  assert.equal(progressUpdates[0].word, '猫');
  assert.equal(progressUpdates[1].word, '犬');
});
