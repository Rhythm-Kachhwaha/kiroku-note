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
      id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'api-client',
      op_type TEXT NOT NULL DEFAULT 'card_save',
      payload TEXT NOT NULL,
      lease_id TEXT DEFAULT NULL,
      lease_expires_at TEXT DEFAULT NULL,
      ack INTEGER NOT NULL DEFAULT 0,
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

    `CREATE TABLE IF NOT EXISTS user_anki_links (
      user_id TEXT NOT NULL,
      anki_card_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      item_ref_id TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      last_synced_at INTEGER,
      PRIMARY KEY (user_id, anki_card_id)
    )`,

    `CREATE TABLE IF NOT EXISTS user_daily_activity (
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      cards_reviewed INTEGER NOT NULL DEFAULT 0,
      minutes_studied REAL NOT NULL DEFAULT 0.0,
      cards_mined INTEGER NOT NULL DEFAULT 0,
      again_count INTEGER NOT NULL DEFAULT 0,
      good_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, date)
    )`
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
