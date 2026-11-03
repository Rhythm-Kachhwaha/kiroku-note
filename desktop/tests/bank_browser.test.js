const test = require('node:test');
const assert = require('node:assert/strict');

test('Question bank helpers filter by level, format, and verification status', async () => {
  const { filterBankQuestions } = await import('../src/ui/views/study.js');
  const items = [
    { level: 'N4', format_code: 'grammar', verification_status: 'valid' },
    { level: 'N4', format_code: 'vocab', verification_status: 'invalid' },
    { level: 'N3', format_code: 'grammar', verification_status: 'valid' }
  ];

  assert.deepEqual(
    filterBankQuestions(items, { level: 'N4', format: 'grammar', status: 'valid' }),
    [items[0]]
  );
  assert.deepEqual(
    filterBankQuestions(items, { format: 'grammar' }),
    [items[0], items[2]]
  );
});

test('Question bank paging clamps pages and returns stable slices', async () => {
  const { getBankPage } = await import('../src/ui/views/study.js');
  const items = Array.from({ length: 25 }, (_, index) => ({ question_id: index + 1 }));

  assert.deepEqual(getBankPage(items, 2, 10), {
    items: items.slice(10, 20),
    page: 2,
    pageCount: 3,
    total: 25
  });
  assert.equal(getBankPage(items, 99, 10).page, 3);
  assert.deepEqual(getBankPage([], 1, 10), {
    items: [],
    page: 1,
    pageCount: 1,
    total: 0
  });
});
