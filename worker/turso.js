/**
 * Kiroku Note — Turso libSQL Client for Edge Worker
 * Provides sub-millisecond edge queries and multi-tenant schema initialization.
 */

let schemaInitialized = false;
const initializedDatabases = new Set();
const SCHEMA_VERSION = 'v2_sync_res';

export function formatTursoArgs(args = []) {
  return args.map(a => {
    if (typeof a === 'number') {
      return Number.isInteger(a) ? { type: 'integer', value: String(a) } : { type: 'float', value: a };
    }
    if (typeof a === 'boolean') return { type: 'integer', value: a ? '1' : '0' };
    if (a === null || a === undefined) return { type: 'null' };
    return { type: 'text', value: String(a) };
  });
}

export async function queryTurso(c, sql, args = []) {
  const dbUrl = c?.env?.TURSO_DATABASE_URL || c?.TURSO_DATABASE_URL;
  const authToken = c?.env?.TURSO_AUTH_TOKEN || c?.TURSO_AUTH_TOKEN;
  if (!dbUrl || !authToken) {
    return null;
  }
  const tursoHttpUrl = dbUrl.replace('libsql://', 'https://').replace(/\/$/, '') + '/v2/pipeline';
  const typedArgs = formatTursoArgs(args);

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
  const firstResult = body?.results?.[0];
  if (firstResult?.type === 'error') {
    throw new Error(`Turso SQL statement error: ${firstResult.error?.message || 'unknown error'} (code: ${firstResult.error?.code})`);
  }
  return firstResult?.response?.result || null;
}

export async function executeTursoTransaction(c, statements = []) {
  const dbUrl = c?.env?.TURSO_DATABASE_URL || c?.TURSO_DATABASE_URL;
  const authToken = c?.env?.TURSO_AUTH_TOKEN || c?.TURSO_AUTH_TOKEN;
  if (!dbUrl || !authToken) return null;
  if (!Array.isArray(statements) || statements.length === 0) return [];

  const tursoHttpUrl = dbUrl.replace('libsql://', 'https://').replace(/\/$/, '') + '/v2/pipeline';
  const requests = [
    { type: 'execute', stmt: { sql: 'BEGIN TRANSACTION', args: [] } },
    ...statements.map(s => ({
      type: 'execute',
      stmt: {
        sql: typeof s === 'string' ? s : s.sql,
        args: formatTursoArgs(s.args || [])
      }
    })),
    { type: 'execute', stmt: { sql: 'COMMIT', args: [] } }
  ];

  const res = await fetch(tursoHttpUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Turso transaction HTTP error (${res.status}): ${err}`);
  }

  const body = await res.json();
  const results = Array.isArray(body?.results) ? body.results : [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r?.type === 'error' || r?.error) {
      const errDetail = r.error?.message || 'statement error';
      try {
        await fetch(tursoHttpUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: 'ROLLBACK', args: [] } }] }),
          signal: AbortSignal.timeout(3000)
        });
      } catch (_) {}
      throw new Error(`Turso transaction failed at step ${i}: ${errDetail}`);
    }
  }

  return results.slice(1, -1).map(r => r?.response?.result || null);
}

export async function initTursoSchema(c) {
  const dbUrl = c?.env?.TURSO_DATABASE_URL || c?.TURSO_DATABASE_URL;
  const authToken = c?.env?.TURSO_AUTH_TOKEN || c?.TURSO_AUTH_TOKEN;
  if (!dbUrl || !authToken) return;
  const cacheKey = `${dbUrl}_${SCHEMA_VERSION}`;
  if (initializedDatabases.has(cacheKey)) return;

  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      display_name TEXT,
      avatar_url TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_auth_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'shortcut_user',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_uat_user ON user_auth_tokens (user_id)`,
    `CREATE TABLE IF NOT EXISTS revoked_tokens (
      sig TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS auth_exchange_codes (
      code TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      sub TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      state TEXT,
      code_challenge TEXT,
      expires_at INTEGER NOT NULL
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
      id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'api-client',
      op_type TEXT NOT NULL DEFAULT 'card_save',
      payload TEXT NOT NULL,
      lease_id TEXT DEFAULT NULL,
      lease_expires_at TEXT DEFAULT NULL,
      ack INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      acked_at TEXT DEFAULT NULL,
      PRIMARY KEY (user_id, id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_uol_user_ack ON user_op_log (user_id, ack, created_at)`,

    // Smart Deduplicated Progress Tracking (References only, zero duplicated strings)
    `CREATE TABLE IF NOT EXISTS user_vocab_progress (
      user_id TEXT NOT NULL,
      vocab_id INTEGER NOT NULL,
      state INTEGER NOT NULL DEFAULT 0,
      stability REAL NOT NULL DEFAULT 0.0,
      difficulty REAL NOT NULL DEFAULT 0.0,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      last_review_at INTEGER,
      due_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, vocab_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_uvp_user_due ON user_vocab_progress (user_id, due_at)`,

    `CREATE TABLE IF NOT EXISTS user_kanji_progress (
      user_id TEXT NOT NULL,
      kanji_char TEXT NOT NULL,
      mastery_flags INTEGER NOT NULL DEFAULT 0,
      accuracy_percent INTEGER DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      last_practiced_at INTEGER,
      PRIMARY KEY (user_id, kanji_char)
    )`,

    `CREATE TABLE IF NOT EXISTS user_grammar_progress (
      user_id TEXT NOT NULL,
      point_id TEXT NOT NULL,
      mastery_level INTEGER DEFAULT 0,
      consecutive_correct INTEGER DEFAULT 0,
      last_studied_at INTEGER,
      PRIMARY KEY (user_id, point_id)
    )`,

    `CREATE TABLE IF NOT EXISTS user_question_history (
      user_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      total_attempts INTEGER DEFAULT 1,
      correct_count INTEGER DEFAULT 0,
      last_answered_at INTEGER,
      PRIMARY KEY (user_id, question_id)
    )`,

    `CREATE TABLE IF NOT EXISTS user_anime_progress (
      user_id TEXT NOT NULL,
      series_id TEXT NOT NULL,
      episode_number INTEGER NOT NULL,
      last_position_ms INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      completed INTEGER DEFAULT 0,
      mined_card_count INTEGER DEFAULT 0,
      last_watched_at INTEGER,
      poster_url TEXT DEFAULT '',
      series_title TEXT DEFAULT '',
      synopsis TEXT DEFAULT '',
      media_type TEXT DEFAULT 'anime',
      PRIMARY KEY (user_id, series_id, episode_number)
    )`,

    `CREATE TABLE IF NOT EXISTS user_manga_progress (
      user_id TEXT NOT NULL,
      manga_id TEXT NOT NULL,
      chapter_number REAL NOT NULL,
      page_number INTEGER NOT NULL DEFAULT 1,
      completed INTEGER DEFAULT 0,
      mined_card_count INTEGER DEFAULT 0,
      last_read_at INTEGER,
      PRIMARY KEY (user_id, manga_id, chapter_number)
    )`,

    `CREATE TABLE IF NOT EXISTS user_manga_books (
      user_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_type TEXT NOT NULL DEFAULT 'pdf',
      size INTEGER NOT NULL DEFAULT 0,
      total_pages INTEGER NOT NULL DEFAULT 1,
      uploaded_at INTEGER NOT NULL,
      file_data TEXT,
      PRIMARY KEY (user_id, book_id)
    )`,

    `CREATE TABLE IF NOT EXISTS user_manga_annotations (
      user_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, book_id, page_number)
    )`,

    `CREATE TABLE IF NOT EXISTS user_anki_links (
      user_id TEXT NOT NULL,
      anki_card_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      item_ref_id TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      last_synced_at INTEGER,
      PRIMARY KEY (user_id, anki_card_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ual_user_item ON user_anki_links (user_id, item_type, item_ref_id)`,

    `CREATE TABLE IF NOT EXISTS user_daily_activity (
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      cards_reviewed INTEGER NOT NULL DEFAULT 0,
      minutes_studied REAL NOT NULL DEFAULT 0.0,
      cards_mined INTEGER NOT NULL DEFAULT 0,
      again_count INTEGER NOT NULL DEFAULT 0,
      good_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, date)
    )`,

    `CREATE TABLE IF NOT EXISTS user_sync_events (
      user_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      result_json TEXT DEFAULT NULL,
      PRIMARY KEY (user_id, event_id)
    )`
  ];

  const tursoHttpUrl = dbUrl.replace('libsql://', 'https://').replace(/\/$/, '') + '/v2/pipeline';
  try {
    const res = await fetch(tursoHttpUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: statements.map(sql => ({ type: 'execute', stmt: { sql, args: [] } }))
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const results = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
      const hasErrors = results.some(r => r?.type === 'error' || r?.error);
      if (!hasErrors) {
        // Idempotently ensure error column exists on user_op_log
        try {
          await queryTurso(c, `ALTER TABLE user_op_log ADD COLUMN error TEXT NOT NULL DEFAULT ''`);
        } catch (_) {}
        try {
          await queryTurso(c, `ALTER TABLE user_anime_progress ADD COLUMN poster_url TEXT DEFAULT ''`);
        } catch (_) {}
        try {
          await queryTurso(c, `ALTER TABLE user_anime_progress ADD COLUMN series_title TEXT DEFAULT ''`);
        } catch (_) {}
        try {
          await queryTurso(c, `ALTER TABLE user_anime_progress ADD COLUMN synopsis TEXT DEFAULT ''`);
        } catch (_) {}
        try {
          await queryTurso(c, `ALTER TABLE user_anime_progress ADD COLUMN media_type TEXT DEFAULT 'anime'`);
        } catch (_) {}
        initializedDatabases.add(cacheKey);
        schemaInitialized = true;
        return;
      }
    }
  } catch (_) {}

  // Fallback to sequential execution if batch pipeline fails
  let allSucceeded = true;
  for (const sql of statements) {
    try {
      const qRes = await queryTurso(c, sql);
      if (!qRes) allSucceeded = false;
    } catch (err) {
      allSucceeded = false;
      console.warn('[Turso] Schema init warning:', err.message);
    }
  }
  try {
    await queryTurso(c, `ALTER TABLE user_op_log ADD COLUMN error TEXT NOT NULL DEFAULT ''`);
  } catch (_) {}
  if (allSucceeded) {
    initializedDatabases.add(cacheKey);
    schemaInitialized = true;
  }
}

export function _resetSchemaInitForTest() {
  initializedDatabases.clear();
  schemaInitialized = false;
}
