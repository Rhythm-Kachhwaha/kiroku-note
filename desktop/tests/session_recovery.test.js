import test from 'node:test';
import assert from 'node:assert/strict';
import { decideSessionRecovery } from '../src/ui/utils/session_recovery.js';

test('offers the newest active session', () => {
  const recovery = decideSessionRecovery({
    practice: { session_id: 1, status: 'active', saved_at: '2026-11-03T10:00:00Z' },
    exam: { session_id: 2, status: 'paused', saved_at: '2026-11-03T11:00:00Z' },
    now: Date.parse('2026-11-03T12:00:00Z')
  });
  assert.equal(recovery.action, 'offer');
  assert.equal(recovery.type, 'exam');
});

test('ignores stale active sessions', () => {
  const recovery = decideSessionRecovery({
    practice: { session_id: 1, status: 'active', saved_at: '2026-11-01T10:00:00Z' },
    now: Date.parse('2026-11-03T12:00:00Z')
  });
  assert.equal(recovery.action, 'ignore_stale');
});
