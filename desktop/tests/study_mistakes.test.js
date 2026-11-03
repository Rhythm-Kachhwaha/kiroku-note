const test = require('node:test');
const assert = require('node:assert/strict');

test('filterMistakes filters by level and format', async () => {
  const { filterMistakes } = await import('../src/ui/views/study.js');
  const items = [
    { level: 'N4', format_code: 'grammar' },
    { level: 'N4', format_code: 'vocab' },
    { level: 'N3', format_code: 'grammar' }
  ];

  assert.deepEqual(filterMistakes(items, { level: 'N4' }), items.slice(0, 2));
  assert.deepEqual(filterMistakes(items, { format: 'grammar' }), [items[0], items[2]]);
  assert.deepEqual(filterMistakes(items, { level: 'N4', format: 'vocab' }), [items[1]]);
});
