import test from 'node:test';
import assert from 'node:assert/strict';
import { getEligibleQuestionCount } from '../src/ui/utils/practice_setup.js';

const summary = {
  levels: {
    N4: {
      eligible_count: 12,
      formats: [
        { category: 'grammar', format_code: 'G1', eligible_count: 5 },
        { category: 'vocabulary', format_code: 'V1', eligible_count: 7 }
      ]
    }
  }
};

test('counts eligible questions for category and format filters', () => {
  assert.equal(getEligibleQuestionCount(summary, 'N4'), 12);
  assert.equal(getEligibleQuestionCount(summary, 'N4', 'grammar', 'all'), 5);
  assert.equal(getEligibleQuestionCount(summary, 'N4', 'all', 'V1'), 7);
  assert.equal(getEligibleQuestionCount(summary, 'N4', 'missing', 'all'), 0);
});
