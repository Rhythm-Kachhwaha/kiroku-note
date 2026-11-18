/**
 * Kiroku Note — Turso libSQL Client for Edge Worker
 * Provides sub-millisecond edge queries and multi-tenant schema initialization.
 */

let schemaInitialized = false;

export async function queryTurso(c, sql, args = []) {
  const dbUrl = c.env?.TURSO_DATABASE_URL;
  const authToken = c.env?.TURSO_AUTH_TOKEN;
  if (!dbUrl || !authToken) {
    return null;
  }
  const tursoHttpUrl = dbUrl.replace('libsql://', 'https://').replace(/\/$/, '') + '/v2/pipeline';
  const typedArgs = args.map(a => {
    if (typeof a === 'number') {
      return Number.isInteger(a) ? { type: 'integer', value: String(a) } : { type: 'float', value: a };
    }
    if (typeof a === 'boolean') return { type: 'integer', value: a ? '1' : '0' };
    if (a === null || a === undefined) return { type: 'null' };
    return { type: 'text', value: String(a) };
  });

  const res = await fetch(tursoHttpUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{ type: 'execute', stmt: { sql, args: typedArgs } }]
    }),
    signal: AbortSignal.timeout(6000)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Turso SQL error (${res.status}): ${err}`);
  }
  const body = await res.json();
  return body?.results?.[0]?.response?.result || null;
}

export async function initTursoSchema(c) {
  if (schemaInitialized) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      display_name TEXT,
      avatar_url TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_study_cards (
      user_id TEXT NOT NULL,
      term_ref TEXT NOT NULL,
      deck_id INTEGER NOT NULL DEFAULT 1,
      state INTEGER NOT NULL DEFAULT 0,
      stability REAL DEFAULT NULL,
      difficulty REAL DEFAULT NULL,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      due_at INTEGER NOT NULL,
      last_reviewed_at INTEGER,
      custom_sentence TEXT DEFAULT NULL,
      PRIMARY KEY (user_id, term_ref)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_usc_user_due ON user_study_cards (user_id, due_at)`,
    `CREATE TABLE IF NOT EXISTS user_daily_stats (
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      reviews INTEGER NOT NULL DEFAULT 0,
      time_ms INTEGER NOT NULL DEFAULT 0,
      again_count INTEGER NOT NULL DEFAULT 0,
      good_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, date)
    )`,
    `CREATE TABLE IF NOT EXISTS user_op_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'api-client',
      op_type TEXT NOT NULL DEFAULT 'card_save',
      payload TEXT NOT NULL,
      lease_id TEXT DEFAULT NULL,
      lease_expires_at TEXT DEFAULT NULL,
      ack INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      acked_at TEXT DEFAULT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_uol_user_ack ON user_op_log (user_id, ack, created_at)`
  ];

  for (const sql of statements) {
    try {
      await queryTurso(c, sql);
    } catch (err) {
      console.warn('[Turso] Schema init warning:', err.message);
    }
  }
  schemaInitialized = true;
}

export function _resetSchemaInitForTest() {
  schemaInitialized = false;
}
