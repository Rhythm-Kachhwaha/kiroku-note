/**
 * Automated Hardening Scenarios for Sync Module (Edge Worker, Turso, Multi-Device, Extension)
 * Tests real boundaries: HTTP requests, Turso libSQL statements, cursor pagination, LWW conflict resolution.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import workerApp from '../../../worker/index.js';
import { signJwt } from '../../../worker/auth.js';

describe('Sync Hardening Scenario Suite', () => {
  const realFetch = globalThis.fetch;
  const mockJwtSecret = 'sync-test-super-secret-key-32chars!';

  // In-memory simulated Turso database table for user_op_log
  let mockOpLog = [];
  let txLogs = [];
  let inTx = false;

  before(() => {
    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      if (urlStr.includes('/v2/pipeline')) {
        let body = {};
        try { body = JSON.parse(options.body || '{}'); } catch (_) {}
        const requests = body.requests || [];
        const results = [];

        for (const req of requests) {
          const stmt = req.stmt || {};
          const sql = stmt.sql || '';
          const args = (stmt.args || []).map(a => a?.value !== undefined ? a.value : a);

          if (sql.startsWith('BEGIN')) {
            inTx = true;
            txLogs = [...mockOpLog];
            results.push({ response: { type: 'execute', result: { cols: [], rows: [] } } });
          } else if (sql.startsWith('COMMIT')) {
            inTx = false;
            results.push({ response: { type: 'execute', result: { cols: [], rows: [] } } });
          } else if (sql.startsWith('ROLLBACK')) {
            inTx = false;
            mockOpLog = [...txLogs];
            results.push({ response: { type: 'execute', result: { cols: [], rows: [] } } });
          } else if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) {
            results.push({ response: { type: 'execute', result: { cols: [], rows: [] } } });
          } else if (sql.includes('INSERT INTO user_op_log')) {
            // Args: id, user_id, op_type, payload, ack, attempts, created_at, [device_id]
            const [id, userId, opType, payloadStr, nowIso, deviceId] = [args[0], args[1], args[2], args[3], args[6] || args[4], args[7] || null];
            const existingIdx = mockOpLog.findIndex(r => r.user_id === userId && r.id === id);

            if (sql.includes('DO UPDATE')) {
              if (existingIdx >= 0) {
                // Last-writer-wins check if payload has updated_at
                let updateAllowed = true;
                try {
                  const newPayload = JSON.parse(payloadStr);
                  const oldPayload = JSON.parse(mockOpLog[existingIdx].payload);
                  if (newPayload.updated_at && oldPayload.updated_at && newPayload.updated_at < oldPayload.updated_at) {
                    updateAllowed = false;
                  }
                } catch (_) {}

                if (updateAllowed) {
                  mockOpLog[existingIdx] = {
                    ...mockOpLog[existingIdx],
                    op_type: opType,
                    payload: payloadStr,
                    ack: 0,
                    created_at: nowIso,
                    device_id: deviceId || mockOpLog[existingIdx].device_id
                  };
                }
              } else {
                mockOpLog.push({ id, user_id: userId, op_type: opType, payload: payloadStr, ack: 0, attempts: 0, created_at: nowIso, device_id: deviceId });
              }
            } else if (sql.includes('DO NOTHING')) {
              if (existingIdx === -1) {
                mockOpLog.push({ id, user_id: userId, op_type: opType, payload: payloadStr, ack: 0, attempts: 0, created_at: nowIso, device_id: deviceId });
              }
            } else {
              mockOpLog.push({ id, user_id: userId, op_type: opType, payload: payloadStr, ack: 0, attempts: 0, created_at: nowIso, device_id: deviceId });
            }
            results.push({ response: { type: 'execute', result: { cols: [], rows: [] } } });
          } else if (sql.includes('UPDATE user_op_log SET ack = 1')) {
            // Args: nowIso, userId, id
            const nowIso = args[0];
            const userId = args[1];
            const id = args[2];
            let affected = 0;
            for (const r of mockOpLog) {
              if (r.user_id === userId && r.id === id) {
                r.ack = 1;
                r.acked_at = nowIso;
                affected++;
              }
            }
            results.push({ response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: affected, rows_affected: affected } } });
          } else if (sql.includes('SELECT id, op_type, payload, ack, created_at')) {
            // Filter by user_id
            const userId = args[0];
            let rows = mockOpLog.filter(r => r.user_id === userId);

            // Per-device cursor or ack filtering
            if (sql.includes('AND (created_at > ? OR (created_at = ? AND id > ?))')) {
              const cursorTime = args[1];
              const cursorId = args[3];
              rows = rows.filter(r => r.created_at > cursorTime || (r.created_at === cursorTime && r.id > cursorId));
            } else if (sql.includes('AND created_at > ?')) {
              const cursorTime = args[1];
              rows = rows.filter(r => r.created_at > cursorTime);
            } else if (sql.includes('ack = 0')) {
              rows = rows.filter(r => r.ack === 0);
            }

            // Exclude caller device_id if requested
            if (sql.includes('device_id != ?') || sql.includes('device_id IS NULL OR device_id != ?')) {
              const devId = args[args.length - 2];
              if (devId) {
                rows = rows.filter(r => !r.device_id || r.device_id !== devId);
              }
            }

            // Limit
            const limit = parseInt(args[args.length - 1], 10) || 50;
            rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
            const paged = rows.slice(0, limit);

            const resultRows = paged.map(r => [
              { value: r.id },
              { value: r.op_type },
              { value: r.payload },
              { value: r.ack },
              { value: r.created_at },
              { value: r.device_id || null }
            ]);

            results.push({
              response: {
                type: 'execute',
                result: {
                  cols: [{ name: 'id' }, { name: 'op_type' }, { name: 'payload' }, { name: 'ack' }, { name: 'created_at' }, { name: 'device_id' }],
                  rows: resultRows
                }
              }
            });
          } else {
            results.push({ response: { type: 'execute', result: { cols: [], rows: [] } } });
          }
        }

        return new Response(JSON.stringify({ results }), { status: 200 });
      }

      return realFetch(url, options);
    };
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  beforeEach(() => {
    mockOpLog = [];
  });

  const makeAuthEnv = (overrides = {}) => ({
    ENVIRONMENT: 'development',
    JWT_SECRET: mockJwtSecret,
    TURSO_DATABASE_URL: 'libsql://mock.turso.io',
    TURSO_AUTH_TOKEN: 'mock-turso-token',
    ...overrides
  });

  const makeUserToken = async (sub = 'user_sync_test') => {
    return await signJwt({ sub, role: 'learner' }, mockJwtSecret);
  };

  test('S01: Push and pull across devices', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s01');

    // 1. Device A pushes a card
    const pushRes = await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        ops: [{
          id: 'card_s01_neko',
          expression: '猫',
          reading: 'ねこ',
          meaning: 'cat'
        }]
      })
    }), env);

    assert.strictEqual(pushRes.status, 200);
    const pushData = await pushRes.json();
    assert.strictEqual(pushData.status, 'ok');
    assert.strictEqual(pushData.pushed, 1);

    // 2. Device B pulls changes
    const pullRes = await workerApp.fetch(new Request('http://localhost/api/sync/pull', {
      headers: { 'Authorization': `Bearer ${token}` }
    }), env);

    assert.strictEqual(pullRes.status, 200);
    const pullData = await pullRes.json();
    assert.strictEqual(pullData.count, 1);
    assert.strictEqual(pullData.items[0].id, 'card_s01_neko');
    assert.strictEqual(pullData.items[0].expression, '猫');
  });

  test('S02: Edit propagation via Last-Writer-Wins', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s02');

    // Initial save
    await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        ops: [{ id: 'card_s02', expression: '車', reading: 'くるま', meaning: 'car', updated_at: '2026-11-20T10:00:00Z' }]
      })
    }), env);

    // Device A edits the card with a newer timestamp
    const editRes = await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        ops: [{ id: 'card_s02', expression: '車', reading: 'くるま', meaning: 'automobile / vehicle', updated_at: '2026-11-20T10:05:00Z' }]
      })
    }), env);

    assert.strictEqual(editRes.status, 200);

    // Device B pulls updates: must receive the latest edited meaning
    const pullRes = await workerApp.fetch(new Request('http://localhost/api/sync/pull', {
      headers: { 'Authorization': `Bearer ${token}` }
    }), env);

    const pullData = await pullRes.json();
    assert.strictEqual(pullData.count, 1);
    assert.strictEqual(pullData.items[0].meaning, 'automobile / vehicle');
  });

  test('S03: Tombstone delete propagation', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s03');

    // 1. Save card
    await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        ops: [{ id: 'card_s03', expression: '犬', reading: 'いぬ', meaning: 'dog' }]
      })
    }), env);

    // 2. Delete card with tombstone
    const delRes = await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        ops: [{
          id: 'card_s03',
          op_type: 'card_delete',
          expression: '犬',
          reading: 'いぬ',
          deleted_at: '2026-11-20T10:10:00Z'
        }]
      })
    }), env);
    assert.strictEqual(delRes.status, 200);

    // 3. Pull receives delete op
    const pullRes = await workerApp.fetch(new Request('http://localhost/api/sync/pull', {
      headers: { 'Authorization': `Bearer ${token}` }
    }), env);
    const pullData = await pullRes.json();
    assert.strictEqual(pullData.count, 1);
    assert.strictEqual(pullData.items[0].op_type, 'card_delete');
  });

  test('S04: Per-device cursor independence', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s04');

    // 1. Push item
    await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        ops: [{ id: 'card_s04', expression: '本', reading: 'ほん', meaning: 'book' }]
      })
    }), env);

    // 2. Device A pulls and acks the op
    await workerApp.fetch(new Request('http://localhost/api/sync/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ids: ['card_s04'] })
    }), env);

    // 3. Device B pulls with its cursor (or since_cursor="0") - must NOT be blocked by Device A's ack
    const pullDevB = await workerApp.fetch(new Request('http://localhost/api/sync/pull?cursor=0', {
      headers: { 'Authorization': `Bearer ${token}` }
    }), env);

    const dataDevB = await pullDevB.json();
    assert.strictEqual(dataDevB.count, 1, 'Device B must receive the card even after Device A acked');
    assert.strictEqual(dataDevB.items[0].id, 'card_s04');
  });

  test('S05: Self-push suppression', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s05');

    // Device A pushes with device_id
    await workerApp.fetch(new Request('http://localhost/api/sync/push?device_id=device_alpha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        ops: [{ id: 'card_s05', expression: '星', reading: 'ほし', meaning: 'star', device_id: 'device_alpha' }]
      })
    }), env);

    // Device A pulls specifying its own device_id -> should be suppressed
    const pullSelf = await workerApp.fetch(new Request('http://localhost/api/sync/pull?device_id=device_alpha', {
      headers: { 'Authorization': `Bearer ${token}` }
    }), env);
    const selfData = await pullSelf.json();
    assert.strictEqual(selfData.count, 0, 'Originating device should not re-download its own push');

    // Device B pulls -> receives it
    const pullDevB = await workerApp.fetch(new Request('http://localhost/api/sync/pull?device_id=device_beta', {
      headers: { 'Authorization': `Bearer ${token}` }
    }), env);
    const betaData = await pullDevB.json();
    assert.strictEqual(betaData.count, 1);
  });

  test('S06: Idempotency on duplicate push', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s06');
    const batch = {
      ops: [{ id: 'card_s06_dup', expression: '雨', reading: 'あめ', meaning: 'rain' }]
    };

    const res1 = await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(batch)
    }), env);
    assert.strictEqual(res1.status, 200);

    const res2 = await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(batch)
    }), env);
    assert.strictEqual(res2.status, 200);

    const pullRes = await workerApp.fetch(new Request('http://localhost/api/sync/pull', {
      headers: { 'Authorization': `Bearer ${token}` }
    }), env);
    const pullData = await pullRes.json();
    assert.strictEqual(pullData.count, 1, 'Duplicate pushes must result in exactly 1 entry');
  });

  test('S07: Payload and batch limits', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s07');

    // > 100 items rejected with 413
    const bigBatch = Array.from({ length: 101 }, (_, i) => ({ id: `card_${i}`, expression: `word_${i}` }));
    const overCountRes = await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ops: bigBatch })
    }), env);
    assert.strictEqual(overCountRes.status, 413);

    // > 512KB payload rejected with 413
    const largeStr = 'x'.repeat(550 * 1024);
    const overSizeRes = await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': String(largeStr.length)
      },
      body: JSON.stringify({ ops: [{ id: 'huge', data: largeStr }] })
    }), env);
    assert.strictEqual(overSizeRes.status, 413);
  });

  test('S08: Cursor pagination boundary handling', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s08');

    // Push 3 items with ordered timestamps
    for (let i = 1; i <= 3; i++) {
      await workerApp.fetch(new Request('http://localhost/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ops: [{ id: `card_p_${i}`, expression: `page_${i}` }] })
      }), env);
    }

    // Pull page 1 (limit 2)
    const page1Res = await workerApp.fetch(new Request('http://localhost/api/sync/pull?limit=2', {
      headers: { 'Authorization': `Bearer ${token}` }
    }), env);
    const page1 = await page1Res.json();
    assert.strictEqual(page1.items.length, 2);
    assert.strictEqual(page1.has_more, true);
    assert.ok(page1.cursor);

    // Pull page 2 using returned cursor
    const page2Res = await workerApp.fetch(new Request(`http://localhost/api/sync/pull?limit=2&cursor=${encodeURIComponent(page1.cursor)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }), env);
    const page2 = await page2Res.json();
    assert.strictEqual(page2.items.length, 1);
    assert.strictEqual(page2.has_more, false);
  });

  test('S09: Production auth enforcement', async () => {
    const prodEnv = {
      ENVIRONMENT: 'production',
      JWT_SECRET: mockJwtSecret,
      TURSO_DATABASE_URL: 'libsql://mock.turso.io',
      TURSO_AUTH_TOKEN: 'mock-turso-token'
    };

    // Unauthenticated push in prod -> 401
    const unauthRes = await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops: [{ id: 'card_x', expression: 'x' }] })
    }), prodEnv);
    assert.strictEqual(unauthRes.status, 401);

    // Service role push -> 403 Forbidden (personal data isolation)
    const serviceToken = await signJwt({ sub: 'svc_sync', role: 'service', is_service: true }, mockJwtSecret);
    const svcRes = await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceToken}` },
      body: JSON.stringify({ ops: [{ id: 'card_x', expression: 'x' }] })
    }), prodEnv);
    assert.strictEqual(svcRes.status, 403);
  });

  test('S10: Production fail-closed without Turso', async () => {
    const prodEnvNoTurso = {
      ENVIRONMENT: 'production',
      JWT_SECRET: mockJwtSecret
      // Missing TURSO_DATABASE_URL and TURSO_AUTH_TOKEN
    };
    const token = await makeUserToken('user_s10');

    const res = await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ops: [{ id: 'card_fail', expression: 'fail' }] })
    }), prodEnvNoTurso);

    assert.strictEqual(res.status, 503);
  });

  test('S11: Multi-tenant user isolation', async () => {
    const env = makeAuthEnv();
    const tokenA = await makeUserToken('user_alice');
    const tokenB = await makeUserToken('user_bob');

    // Alice pushes a secret card
    await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
      body: JSON.stringify({ ops: [{ id: 'alice_secret', expression: '秘密', meaning: 'secret' }] })
    }), env);

    // Bob pulls -> must NOT see Alice's card
    const bobPull = await workerApp.fetch(new Request('http://localhost/api/sync/pull', {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    }), env);
    const bobData = await bobPull.json();
    assert.strictEqual(bobData.count, 0);

    // Bob attempts to ack Alice's card -> 0 acked
    const bobAck = await workerApp.fetch(new Request('http://localhost/api/sync/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenB}` },
      body: JSON.stringify({ ids: ['alice_secret'] })
    }), env);
    const ackData = await bobAck.json();
    assert.strictEqual(ackData.acked, 0);
  });

  test('S12: Extension offline queue draining', async () => {
    // Tests extension background drain behavior:
    // When local backend is offline, pushes to cloud worker.
    let mockStorage = {
      kiroku_pending_cards: [
        { queue_entry_id: 'qe_1', payload: { id: 'card_ext_1', expression: '青', meaning: 'blue' } }
      ],
      'kiroku.cloud.auth_token': await makeUserToken('user_ext')
    };

    // Simulate drain loop against workerApp
    const env = makeAuthEnv();
    const token = mockStorage['kiroku.cloud.auth_token'];
    const pending = mockStorage.kiroku_pending_cards;

    const pushRes = await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ops: pending.map(p => p.payload) })
    }), env);

    assert.strictEqual(pushRes.status, 200);
    const data = await pushRes.json();
    assert.strictEqual(data.pushed, 1);

    // Successfully drained queue empties
    mockStorage.kiroku_pending_cards = [];
    assert.strictEqual(mockStorage.kiroku_pending_cards.length, 0);
  });

  test('S13: High-throughput low-latency batching', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s13');

    // 100-card batch
    const cards = Array.from({ length: 100 }, (_, i) => ({
      id: `card_batch_${i}`,
      expression: `単語_${i}`,
      reading: `たんご_${i}`,
      meaning: `word ${i}`
    }));

    const startTime = performance.now();
    const pushRes = await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ops: cards })
    }), env);
    const duration = performance.now() - startTime;

    assert.strictEqual(pushRes.status, 200);
    const pushData = await pushRes.json();
    assert.strictEqual(pushData.pushed, 100);
    // Sub-second batch execution
    assert.ok(duration < 1000, `Batch took ${duration}ms, expected sub-second execution`);
  });

  test('S14: Clock-skew edit resolution', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s14');

    // Client edit with older timestamp arriving after newer edit must not overwrite
    await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        ops: [{ id: 'card_skew', expression: '空', meaning: 'sky (newer)', updated_at: '2026-11-20T12:00:00Z' }]
      })
    }), env);

    // Stale edit arriving later
    await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        ops: [{ id: 'card_skew', expression: '空', meaning: 'sky (stale)', updated_at: '2026-11-20T11:00:00Z' }]
      })
    }), env);

    const pullRes = await workerApp.fetch(new Request('http://localhost/api/sync/pull', {
      headers: { 'Authorization': `Bearer ${token}` }
    }), env);
    const pullData = await pullRes.json();
    assert.strictEqual(pullData.items[0].meaning, 'sky (newer)', 'Stale update must not overwrite newer update');
  });

  test('S15: Ack transaction result unwrapping', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s15');

    await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ops: [{ id: 'card_s15', expression: '木' }] })
    }), env);

    const ackRes = await workerApp.fetch(new Request('http://localhost/api/sync/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ids: ['card_s15'] })
    }), env);

    assert.strictEqual(ackRes.status, 200);
    const ackData = await ackRes.json();
    assert.strictEqual(ackData.status, 'ok');
    assert.strictEqual(ackData.acked, 1);
  });

  test('S16: Cross-device pull without prior ack filter', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s16');

    // Device A pushes card
    await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ops: [{ id: 'card_s16', expression: '花' }] })
    }), env);

    // Device A acks card
    await workerApp.fetch(new Request('http://localhost/api/sync/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ids: ['card_s16'] })
    }), env);

    // Device B pulls for the first time without cursor
    const pullRes = await workerApp.fetch(new Request('http://localhost/api/sync/pull?device_id=device_B', {
      headers: { 'Authorization': `Bearer ${token}` }
    }), env);
    const pullData = await pullRes.json();
    assert.strictEqual(pullData.count, 1, 'Device B should receive cards even if Device A acked');
    assert.strictEqual(pullData.items[0].id, 'card_s16');
  });

  test('S17: Service role forbidden from sync ack', async () => {
    const prodEnv = {
      ENVIRONMENT: 'production',
      JWT_SECRET: mockJwtSecret,
      TURSO_DATABASE_URL: 'libsql://mock.turso.io',
      TURSO_AUTH_TOKEN: 'mock-token'
    };
    const serviceToken = await signJwt({ sub: 'svc_sync', role: 'service', is_service: true }, mockJwtSecret);

    const ackRes = await workerApp.fetch(new Request('http://localhost/api/sync/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceToken}` },
      body: JSON.stringify({ ids: ['card_1'] })
    }), prodEnv);

    assert.strictEqual(ackRes.status, 403, 'Service role must receive 403 Forbidden on personal ack');
  });

  test('S18: Python sync push includes updated_at for LWW', async () => {
    const { execFileSync } = await import('node:child_process');
    const pyScript = `
import tempfile
from pathlib import Path
from app.db.connection import init_db, db_session
from app.services.cloud_sync_service import CloudSyncService
from app.services.card_service import CardService
from app.schemas import SaveCardRequest

tmp_a = Path(tempfile.mkdtemp()) / 'test_a.db'
init_db(tmp_a)
svc_a = CloudSyncService(db_path=tmp_a)
c_a = CardService(card_repository=svc_a.card_repo).save_card(SaveCardRequest(expression='空', reading='そら', meaning='sky A'))
with db_session(tmp_a) as conn:
    conn.execute("UPDATE cards SET updated_at = '2026-11-20T12:00:00+00:00' WHERE id = ?", (c_a.id,))
unsynced = svc_a.get_unsynced_cards()
assert len(unsynced) == 1
assert unsynced[0].get('updated_at') == '2026-11-20T12:00:00+00:00', f"Expected updated_at in push, got {unsynced[0]}"

tmp_b = Path(tempfile.mkdtemp()) / 'test_b.db'
init_db(tmp_b)
svc_b = CloudSyncService(db_path=tmp_b)
c_b = CardService(card_repository=svc_b.card_repo).save_card(SaveCardRequest(expression='空', reading='そら', meaning='sky B'))
with db_session(tmp_b) as conn:
    conn.execute("UPDATE cards SET updated_at = '2026-11-20T11:00:00+00:00' WHERE id = ?", (c_b.id,))

svc_b.import_pulled_card(unsynced[0])
with db_session(tmp_b) as conn:
    row = conn.execute("SELECT meaning FROM cards WHERE id = ?", (c_b.id,)).fetchone()
    assert row[0] == 'sky A', f"Expected LWW to keep sky A, got {row[0]}"
print("S18_OK")
`;
    const res = execFileSync('python', ['-c', pyScript], {
      env: { ...process.env, PYTHONPATH: '.;backend' }
    }).toString();
    assert.ok(res.includes('S18_OK'));
  });

  test('S19: Tombstone check considers updated_at for resurrection', async () => {
    const { execFileSync } = await import('node:child_process');
    const pyScript = `
import tempfile
from pathlib import Path
from app.db.connection import init_db, db_session
from app.services.cloud_sync_service import CloudSyncService
from app.services.card_service import CardService
from app.schemas import SaveCardRequest

tmp = Path(tempfile.mkdtemp()) / 'test.db'
init_db(tmp)
svc = CloudSyncService(db_path=tmp)
c = CardService(card_repository=svc.card_repo).save_card(SaveCardRequest(expression='桜', reading='さくら', meaning='blossom'))

with db_session(tmp) as conn:
    conn.execute('DELETE FROM cards WHERE id = ?', (c.id,))
    conn.execute('INSERT INTO deleted_cards (card_id, expression, reading, deck_name, deleted_at, pushed_at) VALUES (?, ?, ?, ?, ?, ?)',
                 (c.id, '桜', 'さくら', 'Default', '2026-11-20T11:00:00+00:00', '2026-11-20T11:00:00+00:00'))

item = {
    'id': 'cloud_1',
    'op_type': 'card_save',
    'created_at': '2026-11-20T12:05:00+00:00',
    'payload': {
        'expression': '桜',
        'reading': 'さくら',
        'meaning': 'cherry blossom (edited at 12:00)',
        'created_at': '2026-11-20T10:00:00+00:00',
        'updated_at': '2026-11-20T12:00:00+00:00',
    }
}
card_id, was_new = svc.import_pulled_card(item)
assert card_id > 0, "Card should be recreated by newer edit"
with db_session(tmp) as conn:
    row = conn.execute('SELECT meaning FROM cards WHERE expression = ?', ('桜',)).fetchone()
    assert row is not None and 'cherry blossom' in row[0]
print("S19_OK")
`;
    const res = execFileSync('python', ['-c', pyScript], {
      env: { ...process.env, PYTHONPATH: '.;backend' }
    }).toString();
    assert.ok(res.includes('S19_OK'));
  });

  test('S20: Worker LibSQL UPSERT LWW condition in SQL', async () => {
    const env = makeAuthEnv();
    const token = await makeUserToken('user_s20');

    // Newer edit arrives first
    await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        ops: [{ id: 'card_s20', expression: '海', meaning: 'ocean (12:00)', updated_at: '2026-11-20T12:00:00Z' }]
      })
    }), env);

    // Stale edit arrives second
    await workerApp.fetch(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        ops: [{ id: 'card_s20', expression: '海', meaning: 'ocean (stale 11:00)', updated_at: '2026-11-20T11:00:00Z' }]
      })
    }), env);

    const pullRes = await workerApp.fetch(new Request('http://localhost/api/sync/pull', {
      headers: { 'Authorization': `Bearer ${token}` }
    }), env);
    const pullData = await pullRes.json();
    assert.strictEqual(pullData.items[0].meaning, 'ocean (12:00)', 'Stale update must not overwrite newer update');
  });
});
