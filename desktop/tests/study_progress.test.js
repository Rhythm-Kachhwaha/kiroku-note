import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration,
  formatPercent,
  getProgressMetrics,
  hasProgressHistory
} from '../src/ui/utils/progress_formatters.js';

test('formats progress percentages and durations', () => {
  assert.equal(formatPercent(82.5), '82.5%');
  assert.equal(formatDuration(125000), '2m 5s');
});

test('returns only metrics provided by the API', () => {
  assert.deepEqual(getProgressMetrics({
    overall_accuracy: 80,
    current_streak: 3
  }), [
    { key: 'overall_accuracy', label: 'Accuracy', value: '80%' },
    { key: 'current_streak', label: 'Current streak', value: '3' }
  ]);
});

test('detects an empty overview without inventing history', () => {
  assert.equal(hasProgressHistory({ learning_summary: {} }, []), false);
  assert.equal(hasProgressHistory({
    learning_summary: { total_questions_attempted: 1 }
  }, []), true);
});
