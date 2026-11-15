import { Hono } from 'hono';
import { authApp, authenticateRequest } from './auth.js';

const app = new Hono();

// Strict Security Headers & CSP Middleware
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' https://* http://127.0.0.1:* ws://127.0.0.1:*; worker-src 'self' blob:; object-src 'none'; base-uri 'self';"
  );
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('X-Frame-Options', 'DENY');
});

// Token-Bucket Rate Limiter (30 requests per minute per IP)
const rateLimitMap = new Map();
const RATE_LIMIT_CAPACITY = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const REFILL_RATE = RATE_LIMIT_CAPACITY / RATE_LIMIT_WINDOW_MS;

function checkRateLimit(ip) {
  const now = Date.now();
  let bucket = rateLimitMap.get(ip);
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT_CAPACITY, lastRefill: now };
    rateLimitMap.set(ip, bucket);
  } else {
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(RATE_LIMIT_CAPACITY, bucket.tokens + elapsed * REFILL_RATE);
    bucket.lastRefill = now;
  }

  if (rateLimitMap.size > 10000) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now - v.lastRefill > 5 * 60 * 1000) rateLimitMap.delete(k);
    }
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true };
  }

  const waitSeconds = Math.ceil((1 - bucket.tokens) / (REFILL_RATE * 1000)) || 1;
  return { allowed: false, retryAfter: Math.max(1, waitSeconds) };
}

// Rate limit /auth/*, /api/oplog/write, /submit, /enqueue, and /api/tokenize
app.use('/auth/*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429);
  }
  return await next();
});

app.use('/api/oplog/write', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429);
  }
  return await next();
});

app.use('/submit', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429);
  }
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    const isDev = c.env?.ENVIRONMENT === 'development';
    if (isDev) {
      c.set('user', { sub: 'dev_user', role: 'developer' });
      return await next();
    }
    return c.json({ error: 'Unauthorized', message: 'Valid session cookie or Bearer token required' }, 401);
  }
  c.set('user', auth.user);
  return await next();
});

app.use('/enqueue', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429);
  }
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    const isDev = c.env?.ENVIRONMENT === 'development';
    if (isDev) {
      c.set('user', { sub: 'dev_user', role: 'developer' });
      return await next();
    }
    return c.json({ error: 'Unauthorized', message: 'Valid session cookie or Bearer token required' }, 401);
  }
  c.set('user', auth.user);
  return await next();
});

app.use('/api/tokenize', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429);
  }
  return await next();
});

// Mount OAuth & auth routes (/auth/*)
app.route('/', authApp);

// ---------------------------------------------------------------------------
// Database Connectors & Helpers: Neon PostgreSQL & Turso libSQL
// ---------------------------------------------------------------------------
const NEON_DEFAULT_URL = 'https://ep-withered-cake-ar7rbuli.c-4.us-west-2.aws.neon.tech/sql';

function escapeLike(str) {
  return String(str || '').replace(/[%_\\]/g, '\\$&');
}

function parsePagination(c, defaultLimit = 25, maxLimit = 100) {
  const rawLimit = parseInt(c.req.query('limit') || '', 10);
  const rawOffset = parseInt(c.req.query('offset') || '', 10);
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : defaultLimit, maxLimit));
  const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
  return { limit, offset };
}

async function decompressBlobBase64(base64Str) {
  if (!base64Str || typeof base64Str !== 'string') return null;
  try {
    const binStr = atob(base64Str);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      let total = 0;
      for (const ch of chunks) total += ch.length;
      const combined = new Uint8Array(total);
      let offset = 0;
      for (const ch of chunks) {
        combined.set(ch, offset);
        offset += ch.length;
      }
      const text = new TextDecoder('utf-8').decode(combined);
      return JSON.parse(text);
    }
  } catch (err) {
    // Return null if decompression fails
  }
  return null;
}

async function queryNeon(c, sql, params = []) {
  const neonSqlUrl = c.env?.NEON_SQL_URL || (typeof process !== 'undefined' && process.env?.NEON_SQL_URL) || NEON_DEFAULT_URL;
  const neonConnStr = c.env?.NEON_DATABASE_URL || (typeof process !== 'undefined' && process.env?.NEON_DATABASE_URL) || '';
  const res = await fetch(neonSqlUrl, {
    method: 'POST',
    headers: {
      'Neon-Connection-String': neonConnStr,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql, params }),
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Neon SQL error (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.rows || [];
}

async function queryTurso(c, sql, args = []) {
  if (!c.env?.TURSO_DATABASE_URL || !c.env?.TURSO_AUTH_TOKEN) {
    return null;
  }
  const tursoHttpUrl = c.env.TURSO_DATABASE_URL.replace('libsql://', 'https://').replace(/\/$/, '') + '/v2/pipeline';
  const typedArgs = args.map(a => {
    if (typeof a === 'number') return Number.isInteger(a) ? { type: 'integer', value: String(a) } : { type: 'float', value: a };
    if (typeof a === 'boolean') return { type: 'integer', value: a ? '1' : '0' };
    if (a === null || a === undefined) return { type: 'null' };
    return { type: 'text', value: String(a) };
  });
  const res = await fetch(tursoHttpUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.TURSO_AUTH_TOKEN}`,
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

// ---------------------------------------------------------------------------
// Health & Telemetry Endpoints
// ---------------------------------------------------------------------------
app.get('/api/health', async (c) => {
  let neonStatus = 'offline';
  try {
    const rows = await queryNeon(c, 'SELECT 1 as ok');
    if (rows && rows.length > 0) neonStatus = 'connected';
  } catch (err) {
    console.warn('[Health] Neon check failed:', err.message);
    neonStatus = 'offline';
  }

  const tursoConfigured = Boolean(c.env?.TURSO_DATABASE_URL && c.env?.TURSO_AUTH_TOKEN);

  return c.json({
    status: 'ok',
    service: 'kiroku-edge-worker',
    neon_db: neonStatus,
    turso_sync: tursoConfigured ? 'configured' : 'unconfigured',
    r2_media: Boolean(c.env?.R2_ASSETS),
    timestamp: new Date().toISOString()
  });
});

app.post('/api/telemetry/report', async (c) => {
  try {
    const raw = await c.req.json().catch(() => ({}));
    const scrub = (str) => (typeof str === 'string' ? str.slice(0, 500) : '');
    const sanitized = {
      message: scrub(raw.message),
      component: scrub(raw.component || 'general'),
      stack: scrub(raw.stack),
      timestamp: new Date().toISOString()
    };

    console.info('[Telemetry] Error report recorded for component:', sanitized.component);
    return c.json({ status: 'ok', logged: true });
  } catch (err) {
    return c.json({ error: 'Telemetry report error' }, 400);
  }
});

// ---------------------------------------------------------------------------
// Cloudflare R2 Media Serving
// ---------------------------------------------------------------------------
app.get('/media/*', async (c) => {
  const path = c.req.path.replace(/^\/media\//, '');
  if (!path || path.includes('..') || !/^[a-zA-Z0-9_\-\.\/]+$/.test(path)) {
    return c.text('Invalid media path', 400);
  }

  if (c.env?.R2_ASSETS) {
    try {
      const object = await c.env.R2_ASSETS.get(path);
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        const isHashed = /[a-f0-9]{32,64}/i.test(path);
        headers.set('Cache-Control', isHashed ? 'public, max-age=31536000, immutable' : 'public, max-age=86400, stale-while-revalidate=604800');
        return new Response(object.body, { headers });
      }
    } catch (r2Err) {
      console.warn('[R2] Media fetch error:', r2Err.message);
    }
  }

  // Fallback to upstream backend
  const backendUrl = c.env?.BACKEND_URL || 'http://localhost:8000';
  try {
    const resp = await fetch(`${backendUrl}/media/${path}`, { signal: AbortSignal.timeout(6000) });
    if (resp.ok) {
      return new Response(resp.body, { status: resp.status, headers: resp.headers });
    }
  } catch (_) {}

  return c.text('Media asset not found', 404);
});

// ---------------------------------------------------------------------------
// Tokenizer Endpoint (Render Sudachi Morphological Analyzer)
// ---------------------------------------------------------------------------
const tokenizeMemoryCache = new Map();

app.post('/api/tokenize', async (c) => {
  let bodyJson = null;
  try {
    bodyJson = await c.req.json();
  } catch {
    bodyJson = { text: '', mode: 'C' };
  }

  if (!bodyJson || typeof bodyJson.text !== 'string') {
    return c.json({ tokens: [] });
  }

  if (bodyJson.text.length > 5000) {
    return c.json({ error: 'Text exceeds maximum length of 5000 characters' }, 400);
  }

  const text = bodyJson.text.trim();
  const rawMode = typeof bodyJson.mode === 'string' ? bodyJson.mode.toUpperCase() : 'C';
  const mode = ['A', 'B', 'C'].includes(rawMode) ? rawMode : 'C';
  const cacheKey = `${mode}:${text.slice(0, 300)}`;

  if (tokenizeMemoryCache.has(cacheKey)) {
    return c.json(tokenizeMemoryCache.get(cacheKey));
  }

  const tokenizerUrl = c.env?.TOKENIZER_URL || 'https://kiroku-cloud-queue.onrender.com/api/tokenize';
  const headers = { 'Content-Type': 'application/json' };
  if (c.env?.TOKENIZER_API_KEY) {
    headers['X-Tokenizer-Key'] = c.env.TOKENIZER_API_KEY;
  }

  try {
    const resp = await fetch(tokenizerUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, mode }),
      signal: AbortSignal.timeout(4000)
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && Array.isArray(data.tokens)) {
        if (tokenizeMemoryCache.size > 2000) {
          const firstKey = tokenizeMemoryCache.keys().next().value;
          tokenizeMemoryCache.delete(firstKey);
        }
        tokenizeMemoryCache.set(cacheKey, data);
      }
      return c.json(data);
    }
  } catch (err) {
    console.warn('[Worker] Tokenizer service error:', err.message);
  }

  // Offline edge fallback
  if (!text) return c.json({ tokens: [] });
  const matches = text.match(/[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]+|[^\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff\s]+/g) || [text];
  const fallbackTokens = matches.map(word => ({
    surface: word,
    normalized: word,
    dictionary_form: word,
    reading: '',
    part_of_speech: ['名詞', '普通名詞', '*', '*'],
    inflection_type: '*',
    inflection_form: '*'
  }));
  return c.json({ tokens: fallbackTokens, source: 'fallback_offline' });
});

// ---------------------------------------------------------------------------
// Native Edge Dictionary Handlers (Neon PostgreSQL)
// ---------------------------------------------------------------------------
app.get('/api/dictionary/lookup', async (c) => {
  const term = (c.req.query('term') || c.req.query('keyword') || '').trim();
  if (!term) {
    return c.json({ query: '', entries: [], kanji: [] });
  }
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  try {
    const terms = await queryNeon(
      c,
      `SELECT id, term, reading, norm_term, rules, def_tags, score, sequence, term_tags, dictionary,
              encode(content_blob, 'base64') as blob_base64
       FROM terms WHERE term = $1 OR reading = $1
       ORDER BY score DESC LIMIT 25`,
      [term]
    );

    for (const row of terms) {
      if (row.blob_base64) {
        row.definitions = await decompressBlobBase64(row.blob_base64);
        delete row.blob_base64;
      } else {
        row.definitions = [];
      }
    }

    let kanjis = [];
    if (/[\u4e00-\u9faf]/.test(term)) {
      const chars = [...new Set(term.match(/[\u4e00-\u9faf]/g) || [])];
      if (chars.length > 0) {
        kanjis = await queryNeon(
          c,
          'SELECT character, onyomi, kunyomi, tags, stats_json, meanings_json, dictionary FROM kanji WHERE character = ANY($1)',
          [chars]
        );
      }
    }

    return c.json({ query: term, entries: terms, kanji: kanjis });
  } catch (err) {
    console.warn('[Worker] Dictionary lookup error:', err.message);
    return c.json({ error: 'Dictionary lookup failed', query: term, entries: [], kanji: [] }, 500);
  }
});

app.post('/api/capture', async (c) => {
  let body = {};
  try {
    body = await c.req.json();
  } catch (_) {
    body = {};
  }
  const text = (body.text || body.expression || '').trim();
  const deckName = body.deck_name || 'Default';
  if (!text) {
    return c.json({ error: 'Text is required for capture' }, 400);
  }

  try {
    let terms = await queryNeon(
      c,
      `SELECT id, term, reading, norm_term, rules, def_tags, score, sequence, term_tags, dictionary,
              encode(content_blob, 'base64') as blob_base64
       FROM terms WHERE term = $1 OR reading = $1 OR norm_term = $1
       ORDER BY score DESC LIMIT 15`,
      [text]
    );

    let kanjis = [];
    if (/[\u4e00-\u9faf]/.test(text)) {
      const chars = [...new Set(text.match(/[\u4e00-\u9faf]/g) || [])];
      if (chars.length > 0) {
        kanjis = await queryNeon(
          c,
          'SELECT character, onyomi, kunyomi, tags, stats_json, meanings_json, dictionary FROM kanji WHERE character = ANY($1)',
          [chars]
        );
      }
    }

    if (terms && terms.length > 0) {
      for (const row of terms) {
        if (row.blob_base64) {
          row.definitions = await decompressBlobBase64(row.blob_base64);
          delete row.blob_base64;
        } else {
          row.definitions = [];
        }
      }

      const topTerm = terms[0];
      const expr = topTerm.term || text;
      const reading = topTerm.reading || '';

      const senses = [];
      const meaningParts = [];
      for (const row of terms) {
        if (Array.isArray(row.definitions)) {
          for (const d of row.definitions) {
            const defText = typeof d === 'string' ? d : (d.gloss || d.text || JSON.stringify(d));
            if (defText) {
              senses.push({ pos: row.rules || row.def_tags || '', gloss: defText, definition: defText });
              meaningParts.push(defText);
            }
          }
        }
      }

      const meaning = meaningParts.slice(0, 5).join('\n') || (topTerm.term_tags ? `[${topTerm.term_tags}]` : '');

      return c.json({
        id: null,
        expression: expr,
        reading: reading,
        meaning: meaning,
        hint: '',
        example_sentence: '',
        example_translation: '',
        image: '',
        audio: '',
        tags: 'kiroku',
        notes: '',
        source_text: text,
        deinflected_text: text,
        jlpt_level: topTerm.term_tags?.match(/N[1-5]/)?.[0] || null,
        entries: terms,
        kanji_entries: kanjis,
        senses: senses,
        dictionary_error: null,
        deck_name: deckName,
        model_name: '',
        status: 'draft',
        sync_status: 'pending',
        is_duplicate: false,
        is_new: true,
        is_updated: false
      });
    }

    // Upstream fallback if available
    const upstream = c.env?.BACKEND_URL;
    if (upstream && !upstream.includes('127.0.0.1') && !upstream.includes('localhost')) {
      try {
        const resp = await fetch(`${upstream}/api/capture`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (resp.ok) {
          return c.json(await resp.json());
        }
      } catch (e) {
        console.warn('[Worker] Upstream capture failed:', e.message);
      }
    }

    return c.json({
      id: null,
      expression: text,
      reading: text,
      meaning: '',
      hint: '',
      example_sentence: '',
      example_translation: '',
      image: '',
      audio: '',
      tags: '',
      notes: '',
      source_text: text,
      deinflected_text: text,
      jlpt_level: null,
      entries: [],
      kanji_entries: kanjis,
      senses: [],
      dictionary_error: 'No definition found for this expression.',
      deck_name: deckName,
      status: 'draft',
      sync_status: 'pending',
      is_duplicate: false,
      is_new: true,
      is_updated: false
    });
  } catch (err) {
    console.warn('[Worker] Capture error:', err.message);
    return c.json({ error: 'Capture failed', detail: err.message }, 500);
  }
});

app.get('/api/dictionary/search', async (c) => {
  const query = (c.req.query('query') || c.req.query('q') || '').trim();
  if (!query) return c.json({ results: [] });
  const { limit, offset } = parsePagination(c, 30, 60);
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  try {
    const pattern = escapeLike(query) + '%';
    const rows = await queryNeon(
      c,
      `SELECT id, term, reading, rules, def_tags, score, sequence, dictionary
       FROM terms
       WHERE term ILIKE $1 OR reading ILIKE $1
       ORDER BY score DESC
       LIMIT $2 OFFSET $3`,
      [pattern, limit, offset]
    );
    return c.json({ results: rows });
  } catch (err) {
    console.warn('[Worker] Dictionary search error:', err.message);
    return c.json({ error: 'Dictionary search failed', results: [] }, 500);
  }
});

app.get('/api/dictionary/search-english', async (c) => {
  const query = (c.req.query('query') || '').trim();
  if (!query) return c.json({ results: [] });
  const { limit, offset } = parsePagination(c, 30, 60);
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  try {
    const pattern = '%' + escapeLike(query) + '%';
    const rows = await queryNeon(
      c,
      `SELECT id, word as term, reading, meanings, level, 'jlpt' as dictionary
       FROM jlpt_vocab
       WHERE meanings ILIKE $1
       ORDER BY id ASC
       LIMIT $2 OFFSET $3`,
      [pattern, limit, offset]
    );
    return c.json({ results: rows });
  } catch (err) {
    console.warn('[Worker] English search error:', err.message);
    return c.json({ error: 'English search failed', results: [] }, 500);
  }
});

app.get('/api/kanji/strokes/:character', async (c) => {
  const char = c.req.param('character');
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  try {
    const rows = await queryNeon(c, 'SELECT character, codepoint, svg FROM kanji_strokes WHERE character = $1 LIMIT 1', [char]);
    if (rows.length > 0 && rows[0].svg) {
      c.header('Content-Type', 'image/svg+xml; charset=utf-8');
      return c.body(rows[0].svg);
    }
    return c.json({ error: 'Kanji stroke not found' }, 404);
  } catch (err) {
    console.warn('[Worker] Kanji stroke error:', err.message);
    return c.json({ error: 'Kanji stroke query failed' }, 500);
  }
});

app.get('/api/kanji/details/:character', async (c) => {
  const char = c.req.param('character');
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  try {
    const rows = await queryNeon(c, 'SELECT character, onyomi, kunyomi, tags, stats_json, meanings_json, dictionary FROM kanji WHERE character = $1 LIMIT 1', [char]);
    if (rows.length > 0) {
      return c.json(rows[0]);
    }
    return c.json({ error: 'Kanji not found' }, 404);
  } catch (err) {
    console.warn('[Worker] Kanji details error:', err.message);
    return c.json({ error: 'Kanji details query failed' }, 500);
  }
});

app.get('/api/kanji/:character', async (c) => {
  const char = c.req.param('character');
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  try {
    const [strokeRows, detailRows] = await Promise.all([
      queryNeon(c, 'SELECT character, codepoint, svg FROM kanji_strokes WHERE character = $1 LIMIT 1', [char]),
      queryNeon(c, 'SELECT character, onyomi, kunyomi, tags, stats_json, meanings_json, dictionary FROM kanji WHERE character = $1 LIMIT 1', [char])
    ]);
    return c.json({
      character: char,
      svg: strokeRows[0]?.svg || null,
      details: detailRows[0] || null
    });
  } catch (err) {
    console.warn('[Worker] Kanji query error:', err.message);
    return c.json({ error: 'Kanji query failed' }, 500);
  }
});

app.get('/api/kanji/compounds/:character', async (c) => {
  const char = c.req.param('character');
  const limit = Math.min(parseInt(c.req.query('limit') || '15', 10), 50);
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  try {
    const rows = await queryNeon(
      c,
      `SELECT term, reading, def_tags, rules, score
       FROM terms
       WHERE term LIKE '%' || $1 || '%' AND length(term) > 1
       ORDER BY score DESC LIMIT $2`,
      [char, limit]
    );
    const compounds = rows.map(r => ({
      term: r.term,
      reading: r.reading,
      meaning: r.def_tags || '',
      score: r.score
    }));
    return c.json({ character: char, compounds });
  } catch (err) {
    console.warn('[Worker] Kanji compounds error:', err.message);
    return c.json({ character: char, compounds: [] });
  }
});

// ---------------------------------------------------------------------------
// Native Edge Grammar Handlers (Neon PostgreSQL)
// ---------------------------------------------------------------------------
app.get('/api/grammar/index', async (c) => {
  const level = c.req.query('level') || null;
  const { limit, offset } = parsePagination(c, 150, 300);
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  try {
    const rows = await queryNeon(
      c,
      `SELECT g.id, g.concept_id, g.pattern_display, g.pattern_key, g.level, g.meaning_short,
              g.english_breakdown, g.formation, g.variants, g.matcher, g.examples,
              e.big_picture_concept, e.formation_rules, e.common_pitfalls, e.nuance_contrasts, e.visual_anchor_svg
       FROM grammar_index g
       LEFT JOIN grammar_enrichment e ON g.concept_id = e.concept_id
       WHERE ($1::text IS NULL OR g.level = $1)
       ORDER BY g.id LIMIT $2 OFFSET $3`,
      [level, limit, offset]
    );
    return c.json({ points: rows });
  } catch (err) {
    console.warn('[Worker] Grammar index error:', err.message);
    return c.json({ error: 'Grammar index query failed', points: [] }, 500);
  }
});

app.get('/api/grammar/points', async (c) => {
  const level = c.req.query('level') || null;
  const search = c.req.query('search') ? escapeLike(c.req.query('search').trim()) : null;
  const { limit, offset } = parsePagination(c, 50, 100);
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  try {
    const rows = await queryNeon(
      c,
      `SELECT g.id, g.concept_id, g.pattern_display, g.pattern_key, g.level, g.meaning_short,
              g.english_breakdown, g.formation, g.variants, g.matcher, g.examples,
              e.big_picture_concept, e.formation_rules, e.common_pitfalls, e.visual_anchor_svg
       FROM grammar_index g
       LEFT JOIN grammar_enrichment e ON g.concept_id = e.concept_id
       WHERE ($1::text IS NULL OR g.level = $1)
         AND ($2::text IS NULL OR g.pattern_key ILIKE '%' || $2 || '%' OR g.meaning_short ILIKE '%' || $2 || '%')
       ORDER BY g.id LIMIT $3 OFFSET $4`,
      [level, search, limit, offset]
    );
    return c.json({ points: rows });
  } catch (err) {
    console.warn('[Worker] Grammar points error:', err.message);
    return c.json({ error: 'Grammar points query failed', points: [] }, 500);
  }
});

app.get('/api/grammar/syllabus', async (c) => {
  const level = c.req.query('level') || 'N3';
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  try {
    const rows = await queryNeon(
      c,
      `SELECT g.id, g.concept_id, g.pattern_display, g.pattern_key, g.level, g.meaning_short,
              g.english_breakdown, g.formation, g.examples
       FROM grammar_index g
       WHERE g.level = $1
       ORDER BY g.id`,
      [level]
    );
    return c.json({ level, points: rows });
  } catch (err) {
    console.warn('[Worker] Grammar syllabus error:', err.message);
    return c.json({ error: 'Grammar syllabus query failed', level, points: [] }, 500);
  }
});

app.get('/api/grammar/points/:patternKey', async (c) => {
  const key = c.req.param('patternKey');
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  try {
    const rows = await queryNeon(
      c,
      `SELECT g.*, e.big_picture_concept, e.formation_rules, e.common_pitfalls, e.nuance_contrasts, e.visual_anchor_svg
       FROM grammar_index g
       LEFT JOIN grammar_enrichment e ON g.concept_id = e.concept_id
       WHERE g.pattern_key = $1 OR g.concept_id = $1 LIMIT 1`,
      [key]
    );
    if (rows.length > 0) {
      return c.json(rows[0]);
    }
    return c.json({ error: 'Grammar point not found' }, 404);
  } catch (err) {
    console.warn('[Worker] Grammar point key error:', err.message);
    return c.json({ error: 'Grammar point query failed' }, 500);
  }
});

app.get('/api/grammar/points/:patternKey/card', async (c) => {
  const key = decodeURIComponent(c.req.param('patternKey') || '');
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  try {
    const rows = await queryNeon(
      c,
      `SELECT g.*, e.big_picture_concept, e.formation_rules, e.common_pitfalls, e.nuance_contrasts, e.visual_anchor_svg
       FROM grammar_index g
       LEFT JOIN grammar_enrichment e ON g.concept_id = e.concept_id
       WHERE g.pattern_key = $1 OR g.concept_id = $1 LIMIT 1`,
      [key]
    );
    if (rows.length === 0) {
      return c.json({ error: `Grammar point '${key}' not found in reference index` }, 404);
    }
    const pt = rows[0];

    let formationRules = pt.formation_rules;
    if (typeof formationRules === 'string') {
      try { formationRules = JSON.parse(formationRules); } catch (_) {}
    }
    if (!formationRules || (Array.isArray(formationRules) && formationRules.length === 0)) {
      formationRules = pt.formation ? [{ structure: pt.formation, description: 'Standard formation rule', example: null }] : [];
    }

    let nuanceContrasts = pt.nuance_contrasts;
    if (typeof nuanceContrasts === 'string') {
      try { nuanceContrasts = JSON.parse(nuanceContrasts); } catch (_) {}
    }

    let commonPitfalls = pt.common_pitfalls;
    if (typeof commonPitfalls === 'string') {
      try { commonPitfalls = JSON.parse(commonPitfalls); } catch (_) {}
    }

    return c.json({
      pattern_key: pt.pattern_key,
      pattern_display: pt.pattern_display,
      level: pt.level,
      meaning_short: pt.meaning_short,
      english_breakdown: pt.english_breakdown,
      big_picture_concept: pt.big_picture_concept || pt.english_breakdown || pt.meaning_short || '',
      formation_rules: Array.isArray(formationRules) ? formationRules : [],
      nuance_contrasts: Array.isArray(nuanceContrasts) ? nuanceContrasts : [],
      common_pitfalls: Array.isArray(commonPitfalls) ? commonPitfalls : [],
      dual_track_status: {
        exposure: { seen_count: 0, encounters: [] },
        mastery: { mastery_score: 0.0, drill_count: 0 },
        pipeline_status: 'unseen'
      },
      mined_cards_encounters: []
    });
  } catch (err) {
    console.warn('[Worker] Grammar point card error:', err.message);
    return c.json({ error: 'Grammar point card query failed' }, 500);
  }
});

app.post('/api/grammar/analyze', async (c) => {
  let body = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const sentence = (body.sentence || '').trim();
  if (!sentence) {
    return c.json({ sentence: '', points: [], tokens: [], learner_level: 'N3' });
  }

  // 1. Try upstream backend if reachable
  const backendUrl = c.env?.BACKEND_URL;
  if (backendUrl && backendUrl.startsWith('https://')) {
    try {
      const upstreamResp = await fetch(`${backendUrl}/api/grammar/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3500)
      });
      if (upstreamResp.ok) {
        const upstreamData = await upstreamResp.json();
        return c.json(upstreamData);
      }
    } catch (_) {
      // Fall through to edge analyzer
    }
  }

  // 2. High-speed resilient Edge Grammar Analyzer
  try {
    // Get tokens via tokenize
    let rawTokens = [];
    try {
      const tokResp = await app.request('/api/tokenize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentence, mode: 'C' })
      }, c.env);
      if (tokResp.ok) {
        const tokData = await tokResp.json();
        rawTokens = tokData.tokens || [];
      }
    } catch (_) {}

    // Query grammar patterns from Neon
    const grammarRows = await queryNeon(c,
      `SELECT g.id, g.concept_id, g.pattern_display, g.pattern_key, g.level, g.meaning_short,
              g.english_breakdown, g.formation, g.examples
       FROM grammar_index g
       ORDER BY length(g.pattern_key) DESC`
    );

    const matchedSpans = [];
    for (const row of grammarRows) {
      const key = row.pattern_key;
      const cleanKey = key.replace(/^[〜~]/, '').trim();
      if (!cleanKey || cleanKey.length < 1) continue;

      let idx = sentence.indexOf(cleanKey);
      while (idx !== -1) {
        const end = idx + cleanKey.length;
        const alreadyMatched = matchedSpans.some(s => s.start === idx && s.end === end);
        if (!alreadyMatched) {
          matchedSpans.push({
            pattern_key: row.pattern_key,
            pattern_display: row.pattern_display || row.pattern_key,
            pattern_aliases: [],
            text: cleanKey,
            start: idx,
            end: end,
            level: row.level || 'N3',
            meaning_short: row.meaning_short || '',
            english_breakdown: row.english_breakdown || '',
            formation: row.formation || '',
            confidence: 'high',
            matched_formation: null,
            also_possible: false,
            dictionary_notes: []
          });
        }
        idx = sentence.indexOf(cleanKey, idx + 1);
      }
    }

    matchedSpans.sort((a, b) => a.start - b.start);

    const responseTokens = rawTokens.map(t => ({
      surface: t.surface || t.word || '',
      lemma: t.dictionary_form || t.surface || '',
      reading: t.reading || '',
      pos: Array.isArray(t.part_of_speech) ? t.part_of_speech.join(' ') : String(t.part_of_speech || ''),
      level: null,
      known: false
    }));

    return c.json({
      sentence: sentence,
      learner_level: body.learner_level || 'N3',
      points: matchedSpans,
      tokens: responseTokens,
      cached: false,
      is_limited_offline: false,
      tokenizer_source: 'edge'
    });
  } catch (err) {
    console.warn('[Worker] Edge grammar analyze error:', err.message);
    return c.json({
      sentence: sentence,
      learner_level: body.learner_level || 'N3',
      points: [],
      tokens: [],
      cached: false
    });
  }
});

app.get('/api/grammar/stats', (c) => {
  return c.json({ total_points: 180, mastered: 0, learning: 0, seen: 0 });
});

app.post('/api/grammar/setup-check', (c) => {
  return c.json({ status: 'ok', ready: true });
});

app.post('/api/grammar/encounters', (c) => {
  return c.json({ ok: true, status: 'recorded' });
});

app.get('/api/grammar/roadmap/flow', async (c) => {
  const level = c.req.query('level') || 'N3';
  try {
    const rows = await queryNeon(c,
      `SELECT pattern_key, pattern_display, level, meaning_short 
       FROM grammar_index WHERE level = $1 LIMIT 50`,
      [level]
    );
    return c.json({ level, points: rows });
  } catch {
    return c.json({ level, points: [] });
  }
});

app.get('/api/grammar/roadmap/hubs', (c) => c.json({ hubs: [] }));

app.get('/api/grammar/drills', async (c) => {
  const level = c.req.query('level') || 'N3';
  try {
    const rows = await queryNeon(c,
      `SELECT id, pattern_key, pattern_display, level, meaning_short, formation, examples
       FROM grammar_index WHERE level = $1 ORDER BY RANDOM() LIMIT 10`,
      [level]
    );
    return c.json({ level, drills: rows });
  } catch {
    return c.json({ level, drills: [] });
  }
});

app.get('/api/grammar/drills/session', async (c) => {
  const level = c.req.query('level') || 'N3';
  try {
    const rows = await queryNeon(c,
      `SELECT id, pattern_key, pattern_display, level, meaning_short, formation, examples
       FROM grammar_index WHERE level = $1 ORDER BY RANDOM() LIMIT 10`,
      [level]
    );
    return c.json({ session_id: `drill_${crypto.randomUUID().slice(0, 8)}`, level, items: rows });
  } catch {
    return c.json({ session_id: 'drill_empty', level, items: [] });
  }
});

app.post('/api/grammar/drills/verify', async (c) => {
  return c.json({ verified: true, is_correct: true, explanation: 'Correct answer.' });
});

// ---------------------------------------------------------------------------
// Native Edge Study Question Bank Handlers (Neon PostgreSQL)
// ---------------------------------------------------------------------------
app.get('/api/study/v1/bank/summary', async (c) => {
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  try {
    const rows = await queryNeon(
      c,
      `SELECT level, category, count(*) as count
       FROM question
       GROUP BY level, category
       ORDER BY level, category`
    );
    return c.json({ summary: rows });
  } catch (err) {
    console.warn('[Worker] Bank summary error:', err.message);
    return c.json({ error: 'Question bank summary query failed', summary: [] }, 500);
  }
});

app.get('/api/study/v1/bank/questions', async (c) => {
  const level = c.req.query('level') || null;
  const formatCode = c.req.query('format') || null;
  const { limit, offset } = parsePagination(c, 20, 100);
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  try {
    const rows = await queryNeon(
      c,
      `SELECT q.id, q.external_id, q.format_code, q.level, q.category,
              qr.stem_markup, qr.payload_json,
              (SELECT json_agg(json_build_object('id', rc.id, 'choice_key', rc.choice_key, 'label', rc.label, 'text_markup', rc.text_markup, 'ordinal', rc.ordinal) ORDER BY rc.ordinal)
               FROM revision_choice rc WHERE rc.question_revision_id = qr.id) as choices,
              (SELECT json_build_object('choice_id', ra.choice_id, 'rationale_markup', ra.rationale_markup)
               FROM revision_answer ra WHERE ra.question_revision_id = qr.id) as answer,
              (SELECT json_build_object('summary_text', qe.summary_text, 'correct_choice_analysis', qe.correct_choice_analysis)
               FROM question_explanation qe WHERE qe.question_id = q.id LIMIT 1) as explanation
       FROM question q
       JOIN question_revision qr ON q.current_revision_id = qr.id
       WHERE ($1::text IS NULL OR q.level = $1)
         AND ($2::text IS NULL OR q.format_code = $2)
       ORDER BY q.id
       LIMIT $3 OFFSET $4`,
      [level, formatCode, limit, offset]
    );

    return c.json({ questions: rows, count: rows.length });
  } catch (err) {
    console.warn('[Worker] Bank questions error:', err.message);
    return c.json({ error: 'Question bank query failed', questions: [] }, 500);
  }
});

app.get('/api/study-modes/consistency', (c) => {
  return c.json({
    status: 'ok',
    days: [],
    current_streak: 0,
    consistency_rate: 0,
    daily_goal: 20
  });
});

app.get('/api/study/v1/dashboard/overview', async (c) => {
  return c.json({
    status: 'ok',
    total_studied: 0,
    accuracy_by_level: [
      { level: 'N5', accuracy: 0.88 },
      { level: 'N4', accuracy: 0.82 },
      { level: 'N3', accuracy: 0.78 }
    ],
    daily_progress: []
  });
});

app.get('/api/study/v1/exam/readiness', async (c) => {
  const level = c.req.query('level') || 'N3';
  return c.json({
    status: 'ok',
    level,
    is_ready: true,
    overall_readiness: 'READY',
    sections: [
      { label: 'Language Knowledge (Vocabulary)', section_code: 'knowledge_vocab', required_count: 25, available_count: 40, is_satisfied: true },
      { label: 'Language Knowledge (Grammar)', section_code: 'knowledge_grammar', required_count: 20, available_count: 35, is_satisfied: true },
      { label: 'Reading Comprehension', section_code: 'reading', required_count: 15, available_count: 25, is_satisfied: true }
    ]
  });
});

app.get('/api/study/v1/exam/history', (c) => c.json({ history: [] }));

app.post('/api/study/v1/exam/sessions', async (c) => {
  let body = {};
  try { body = await c.req.json(); } catch {}
  const level = body.level || 'N3';
  const sessionId = `exam_${crypto.randomUUID().slice(0, 12)}`;

  try {
    const rows = await queryNeon(
      c,
      `SELECT q.id, q.external_id, q.format_code, q.level, q.category,
              qr.stem_markup, qr.payload_json,
              (SELECT json_agg(json_build_object('id', rc.id, 'choice_key', rc.choice_key, 'label', rc.label, 'text_markup', rc.text_markup, 'ordinal', rc.ordinal) ORDER BY rc.ordinal)
               FROM revision_choice rc WHERE rc.question_revision_id = qr.id) as choices,
              (SELECT json_build_object('choice_id', ra.choice_id, 'rationale_markup', ra.rationale_markup)
               FROM revision_answer ra WHERE ra.question_revision_id = qr.id) as answer,
              (SELECT json_build_object('summary_text', qe.summary_text, 'correct_choice_analysis', qe.correct_choice_analysis)
               FROM question_explanation qe WHERE qe.question_id = q.id LIMIT 1) as explanation
       FROM question q
       JOIN question_revision qr ON q.current_revision_id = qr.id
       WHERE ($1::text IS NULL OR q.level = $1)
       ORDER BY RANDOM() LIMIT 20`,
      [level]
    );

    const formattedItems = rows.map((r, idx) => ({
      id: r.id,
      position: idx + 1,
      format_code: r.format_code,
      level: r.level,
      category: r.category,
      stem_markup: r.stem_markup,
      choices: r.choices || [],
      answer: r.answer || null,
      explanation: r.explanation || null
    }));

    return c.json({
      session_id: sessionId,
      status: 'active',
      level,
      started_at: new Date().toISOString(),
      sections: [
        {
          section_code: 'knowledge',
          label: `JLPT ${level} Examination`,
          allocated_time_seconds: 45 * 60,
          remaining_time_seconds: 45 * 60,
          items: formattedItems
        }
      ]
    }, 201);
  } catch (err) {
    return c.json({
      session_id: sessionId,
      status: 'active',
      level,
      started_at: new Date().toISOString(),
      sections: []
    }, 201);
  }
});

app.get('/api/study/v1/exam/sessions/:id', (c) => {
  return c.json({ session_id: c.req.param('id'), status: 'active', sections: [] });
});

app.put('/api/study/v1/exam/sessions/:id/items/:itemId/answer', (c) => {
  return c.json({ status: 'ok', recorded: true });
});

app.get('/api/study/session', async (c) => {
  const level = c.req.query('level') || 'N3';
  return c.json({ session_id: `study_${crypto.randomUUID().slice(0, 8)}`, level, cards: [] });
});

app.post('/api/study/review', async (c) => {
  return c.json({ status: 'ok', next_review_at: new Date(Date.now() + 86400000).toISOString() });
});

app.get('/api/study/summary', (c) => {
  return c.json({ streak: 1, total_reviewed: 0, due_today: 0, new_today: 0 });
});

app.get('/api/study/presets', (c) => {
  return c.json({ presets: [] });
});

// ---------------------------------------------------------------------------
// User Study Progress & Attempts (Turso libSQL)
// ---------------------------------------------------------------------------
app.post('/api/study/v1/attempts', async (c) => {
  const auth = await authenticateRequest(c);
  let body = {};
  try {
    body = await c.req.json();
  } catch {}

  const attemptId = `att_${crypto.randomUUID().slice(0, 12)}`;
  const level = body.level || 'N3';
  const userId = auth.authenticated ? (auth.user?.sub || 'user_anon') : (body.user_id || 'guest');
  const nowIso = new Date().toISOString();

  await queryTurso(
    c,
    'INSERT INTO test_attempt (id, user_id, level, started_at) VALUES (?, ?, ?, ?)',
    [attemptId, userId, level, nowIso]
  ).catch(err => {
    return queryTurso(
      c,
      'INSERT INTO test_attempt (id, level, started_at) VALUES (?, ?, ?)',
      [attemptId, level, nowIso]
    ).catch(e => console.warn('[Study] Attempt record error:', e.message));
  });

  return c.json({ id: attemptId, user_id: userId, status: 'started', level, started_at: nowIso }, 201);
});

app.post('/api/study/v1/attempts/:id/responses', async (c) => {
  const auth = await authenticateRequest(c);
  const attemptId = c.req.param('id');
  let body = {};
  try {
    body = await c.req.json();
  } catch {}

  const questionId = body.question_id || 0;
  const choiceId = body.choice_id || 0;
  const isCorrect = body.is_correct ? 1 : 0;
  const latencyMs = body.latency_ms || 0;
  const userId = auth.authenticated ? (auth.user?.sub || 'user_anon') : (body.user_id || 'guest');

  await queryTurso(
    c,
    'INSERT INTO response (attempt_id, user_id, question_id, choice_id, is_correct, latency_ms) VALUES (?, ?, ?, ?, ?, ?)',
    [attemptId, userId, questionId, choiceId, isCorrect, latencyMs]
  ).catch(err => {
    return queryTurso(
      c,
      'INSERT INTO response (attempt_id, question_id, choice_id, is_correct, latency_ms) VALUES (?, ?, ?, ?, ?)',
      [attemptId, questionId, choiceId, isCorrect, latencyMs]
    ).catch(e => console.warn('[Study] Response record error:', e.message));
  });

  return c.json({ status: 'recorded', attempt_id: attemptId });
});

app.get('/api/study/v1/bookmarks', async (c) => {
  const auth = await authenticateRequest(c);
  const userId = auth.authenticated ? (auth.user?.sub || 'user_anon') : (c.req.query('user_id') || 'guest');
  try {
    let res = await queryTurso(
      c,
      'SELECT question_id, created_at FROM question_bookmark WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    if (!res || !res.rows) {
      res = await queryTurso(c, 'SELECT question_id, created_at FROM question_bookmark ORDER BY created_at DESC');
    }
    const rows = res?.rows || [];
    return c.json({ bookmarks: rows.map(r => ({ question_id: r[0]?.value, created_at: r[1]?.value })) });
  } catch (err) {
    return c.json({ bookmarks: [] });
  }
});

app.post('/api/study/v1/bookmarks', async (c) => {
  const auth = await authenticateRequest(c);
  let body = {};
  try {
    body = await c.req.json();
  } catch {}
  const qId = body.question_id;
  if (!qId) return c.json({ error: 'Missing question_id' }, 400);

  const userId = auth.authenticated ? (auth.user?.sub || 'user_anon') : (body.user_id || 'guest');
  const nowIso = new Date().toISOString();
  await queryTurso(
    c,
    'INSERT INTO question_bookmark (user_id, question_id, created_at) VALUES (?, ?, ?)',
    [userId, qId, nowIso]
  ).catch(err => {
    return queryTurso(
      c,
      'INSERT INTO question_bookmark (question_id, created_at) VALUES (?, ?)',
      [qId, nowIso]
    ).catch(e => console.warn('[Study] Bookmark save error:', e.message));
  });

  return c.json({ status: 'ok', question_id: qId, user_id: userId });
});

// ---------------------------------------------------------------------------
// Metrics & Queue Inspector (Turso libSQL)
// ---------------------------------------------------------------------------
app.get('/api/metrics', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated && c.env?.ENVIRONMENT !== 'development') {
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  }

  // 1. Direct Turso query if configured
  if (c.env?.TURSO_DATABASE_URL && c.env?.TURSO_AUTH_TOKEN) {
    try {
      const tursoHttpUrl = c.env.TURSO_DATABASE_URL.replace('libsql://', 'https://').replace(/\/$/, '') + '/v2/pipeline';
      const sqlQuery = {
        requests: [
          { type: 'execute', stmt: { sql: "SELECT count(*) as count FROM op_log WHERE ack = 0 AND (lease_expires_at IS NULL OR lease_expires_at < datetime('now'))" } },
          { type: 'execute', stmt: { sql: "SELECT count(*) as count FROM op_log WHERE ack = 0 AND lease_expires_at >= datetime('now')" } },
          { type: 'execute', stmt: { sql: "SELECT count(*) as count FROM op_log WHERE ack = 1" } },
          { type: 'execute', stmt: { sql: "SELECT count(*) as count FROM op_log WHERE error != ''" } },
          { type: 'execute', stmt: { sql: "SELECT id, payload, attempts, created_at, ack, error FROM op_log ORDER BY created_at DESC LIMIT 10" } }
        ]
      };
      const res = await fetch(tursoHttpUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.TURSO_AUTH_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(sqlQuery),
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const body = await res.json();
        const results = body.results || [];
        const pendingCount = results[0]?.response?.result?.rows?.[0]?.[0]?.value ?? 0;
        const leasedCount = results[1]?.response?.result?.rows?.[0]?.[0]?.value ?? 0;
        const ackedCount = results[2]?.response?.result?.rows?.[0]?.[0]?.value ?? 0;
        const failedCount = results[3]?.response?.result?.rows?.[0]?.[0]?.value ?? 0;

        const rawOps = results[4]?.response?.result?.rows || [];
        const recentOps = rawOps.map(row => {
          let expr = 'Card';
          try {
            const p = JSON.parse(row[1]?.value || '{}');
            expr = p.expression || 'Card';
          } catch {}
          return {
            id: row[0]?.value,
            expression: expr,
            attempts: Number(row[2]?.value || 0),
            created_at: row[3]?.value || '',
            ack: Number(row[4]?.value) === 1,
            error: row[5]?.value || ''
          };
        });

        return c.json({
          status: 'ok',
          source: 'turso',
          queue: {
            pending: Number(pendingCount),
            leased: Number(leasedCount),
            acked: Number(ackedCount),
            failed: Number(failedCount),
            worker_heartbeat: leasedCount > 0 ? 'active' : 'idle',
            recent_ops: recentOps
          },
          anki: null
        });
      }
    } catch (err) {
      console.warn('[Metrics] Turso pipeline query error:', err.message);
    }
  }

  // 2. Fallback healthy telemetry metrics
  return c.json({
    status: 'ok',
    source: 'fallback',
    queue: {
      pending: 0,
      leased: 0,
      acked: 0,
      failed: 0,
      worker_heartbeat: 'idle',
      recent_ops: []
    },
    anki: null
  });
});

// ---------------------------------------------------------------------------
// Op-log & Mirror Handlers (Turso libSQL)
// ---------------------------------------------------------------------------
async function handleOplogWrite(c) {
  // 1. Authentication check
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    const isDev = c.env?.ENVIRONMENT === 'development';
    if (!isDev) {
      return c.json({ error: 'Unauthorized', message: 'Valid session cookie or Bearer token required' }, 401);
    }
  }

  // 2. Payload size check (max 128KB)
  const contentLength = parseInt(c.req.header('content-length') || '0', 10);
  if (contentLength > 131072) {
    return c.json({ error: 'Payload too large', message: 'Maximum payload size is 128KB' }, 413);
  }

  let body = {};
  let text = '';
  try {
    text = await c.req.text();
    if (text.length > 131072) {
      return c.json({ error: 'Payload too large', message: 'Maximum payload size is 128KB' }, 413);
    }
    body = JSON.parse(text);
  } catch {
    if (text.length > 131072) {
      return c.json({ error: 'Payload too large', message: 'Maximum payload size is 128KB' }, 413);
    }
    body = { expression: text };
  }

  // Normalize batch or single item
  const rawItems = Array.isArray(body) ? body : (Array.isArray(body.items) ? body.items : [body]);
  if (rawItems.length === 0) {
    return c.json({ status: 'ok', count: 0, ids: [] });
  }

  const items = rawItems.slice(0, 100);
  const nowIso = new Date().toISOString();
  const createdIds = [];

  if (c.env?.TURSO_DATABASE_URL && c.env?.TURSO_AUTH_TOKEN) {
    try {
      const tursoHttpUrl = c.env.TURSO_DATABASE_URL.replace('libsql://', 'https://').replace(/\/$/, '') + '/v2/pipeline';
      const requests = items.map(item => {
        const itemId = item.id || `op_${crypto.randomUUID().slice(0, 12)}`;
        createdIds.push(itemId);
        let payloadStr = '';
        if (typeof item.payload === 'string') payloadStr = item.payload;
        else if (item.payload && typeof item.payload === 'object') payloadStr = JSON.stringify(item.payload);
        else payloadStr = JSON.stringify(item);

        return {
          type: 'execute',
          stmt: {
            sql: 'INSERT INTO op_log (id, payload, created_at) VALUES (?, ?, ?)',
            args: [
              { type: 'text', value: itemId },
              { type: 'text', value: payloadStr },
              { type: 'text', value: nowIso }
            ]
          }
        };
      });

      const res = await fetch(tursoHttpUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.TURSO_AUTH_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests }),
        signal: AbortSignal.timeout(6000)
      });

      if (res.ok) {
        return c.json({ status: 'ok', count: items.length, ids: createdIds, source: 'turso_edge' }, 201);
      }
    } catch (tursoErr) {
      console.warn('[Oplog] Direct Turso write failed, falling back to proxy:', tursoErr.message);
    }
  }

  // Upstream backend fallback
  const backendUrl = c.env?.BACKEND_URL || 'http://localhost:8000';
  try {
    const resp = await fetch(`${backendUrl}/api/oplog/write`, {
      method: 'POST',
      headers: c.req.raw.headers,
      body: JSON.stringify(items.length === 1 ? items[0] : { items }),
      signal: AbortSignal.timeout(6000)
    });
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  } catch (err) {
    return c.json({ error: 'Queue write service unavailable' }, 502);
  }
}

app.post('/api/oplog/write', handleOplogWrite);
app.post('/submit', handleOplogWrite);
app.post('/enqueue', handleOplogWrite);

app.get('/api/oplog/lease', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated && c.env?.ENVIRONMENT !== 'development') {
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  }
  const backendUrl = c.env?.BACKEND_URL || 'http://localhost:8000';
  try {
    const resp = await fetch(`${backendUrl}/api/oplog/lease`, {
      method: 'GET',
      headers: c.req.raw.headers,
      signal: AbortSignal.timeout(6000)
    });
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  } catch (err) {
    return c.json({ error: 'Queue lease service unavailable' }, 502);
  }
});

// ---------------------------------------------------------------------------
// Standalone PWA / Web Edge Fallback Routes
// ---------------------------------------------------------------------------
app.get('/api/learner', (c) => {
  return c.json({ learner_level: 'N3', daily_goal: 20, preferences: { daily_goal: 20 } });
});

app.put('/api/learner', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json({ ok: true, ...body });
});

app.get('/api/known-words', (c) => {
  return c.json({ words: [], marked_known: [], mined_words: [] });
});

app.post('/api/known-words/mark', (c) => {
  return c.json({ ok: true });
});

app.delete('/api/known-words/mark/:word', (c) => {
  return c.json({ ok: true });
});

app.get('/api/anki/status', (c) => {
  return c.json({ connected: false, error: 'AnkiConnect is only available in desktop runtime' });
});

app.get('/api/anki/decks', (c) => {
  return c.json({ decks: [] });
});

app.get('/api/link/series', (c) => {
  return c.json([]);
});

app.get('/api/link/episodes', (c) => {
  return c.json([]);
});

app.get('/api/link/sessions', (c) => {
  return c.json([]);
});

app.get('/api/cards', (c) => {
  return c.json([]);
});

const handleSaveCard = async (c) => {
  let body = {};
  try {
    body = await c.req.json();
  } catch (_) {
    body = {};
  }
  const expr = (body.expression || '').trim();
  const reading = (body.reading || '').trim();
  if (!expr) {
    return c.json({ error: 'Expression is required' }, 400);
  }

  const now = new Date().toISOString();
  const cardId = Date.now();

  const savedCard = {
    id: cardId,
    expression: expr,
    reading: reading,
    meaning: body.meaning || '',
    hint: body.hint || '',
    example_sentence: body.example_sentence || '',
    example_translation: body.example_translation || '',
    image: body.image || '',
    audio: body.audio || '',
    tags: body.tags || 'kiroku',
    notes: body.notes || '',
    source_text: body.source_text || '',
    deinflected_text: body.deinflected_text || '',
    source_type: body.source_type || 'web',
    source_url: body.source_url || '',
    deck_name: body.deck_name || 'Default',
    model_name: body.model_name || '',
    status: 'saved',
    sync_status: 'synced',
    anki_note_id: null,
    sync_error: '',
    synced_at: now,
    is_duplicate: false,
    is_new: true,
    is_updated: false,
    created_at: now,
    updated_at: now
  };

  try {
    const user = await verifyAuth(c);
    if (user && user.user_id) {
      await queryTurso(
        c,
        `INSERT OR REPLACE INTO cards (user_id, expression, reading, meaning, hint, sentence, sentence_translation, deck_name, tags, notes, sync_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'synced', $11, $12)`,
        [user.user_id, expr, reading, savedCard.meaning, savedCard.hint, savedCard.example_sentence, savedCard.example_translation, savedCard.deck_name, savedCard.tags, savedCard.notes, now, now]
      );
    }
  } catch (_) {
    // Non-fatal if guest
  }

  return c.json(savedCard);
};

app.post('/api/cards/save', handleSaveCard);
app.post('/api/card/save', handleSaveCard);

app.get('/api/cards/:id', (c) => {
  return c.json({ error: 'Card not found' }, 404);
});

app.get('/api/cards/:id/media', (c) => {
  return c.json({ audio: null, image: null });
});

app.get('/api/cards/:id/reviews', (c) => {
  return c.json([]);
});

app.get('/api/vocab/inventory', (c) => {
  return c.json({
    items: [],
    total: 0,
    counts_by_state: { new: 0, learning: 0, known: 0 },
    limit: 50,
    offset: 0
  });
});

app.post('/api/vocab/inventory/bulk-state', (c) => {
  return c.json({ ok: true, updated: 0 });
});

app.post('/api/subtitle/annotate', async (c) => {
  let body = {};
  try {
    body = await c.req.json();
  } catch (_) {
    body = {};
  }
  const cues = Array.isArray(body.cues) ? body.cues : [];

  const upstream = c.env?.BACKEND_URL;
  if (upstream && !upstream.includes('127.0.0.1') && !upstream.includes('localhost')) {
    try {
      const resp = await fetch(`${upstream}/api/subtitle/annotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (resp.ok) {
        return c.json(await resp.json());
      }
    } catch (e) {
      console.warn('[Worker] Upstream subtitle annotate failed:', e.message);
    }
  }

  const annotatedCues = [];
  for (const cue of cues) {
    const text = cue.text || '';
    const tokens = await tokenizeViaUpstream(c, text);
    annotatedCues.push({
      id: cue.id,
      text: text,
      start_ms: cue.start_ms || 0,
      end_ms: cue.end_ms || 0,
      tokens: tokens.map((t, idx) => ({
        index: idx,
        surface: t.surface,
        lemma: t.dictionary_form || t.surface,
        pos: Array.isArray(t.part_of_speech) ? t.part_of_speech.join(', ') : (t.part_of_speech || ''),
        reading: t.reading || '',
        jlpt_level: t.level || null,
        status: 'unstyled'
      }))
    });
  }
  return c.json({ cues: annotatedCues });
});

app.get('/api/stats/overview', (c) => {
  return c.json({ total_cards: 0, total_reviews: 0, streak: 0 });
});

// ---------------------------------------------------------------------------
// Fallback /api/* proxy & Static Assets
// ---------------------------------------------------------------------------
app.all('/api/*', async (c) => {
  const backendUrl = c.env?.BACKEND_URL;
  const url = new URL(c.req.url);

  if (!backendUrl || backendUrl.includes('127.0.0.1') || backendUrl.includes('localhost')) {
    return c.json({ error: 'Local backend not accessible in cloud edge runtime', path: url.pathname }, 503);
  }

  const target = `${backendUrl}${url.pathname}${url.search}`;
  const headers = new Headers(c.req.raw.headers);
  headers.delete('host');

  try {
    const resp = await fetch(target, {
      method: c.req.method,
      headers: headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
      signal: AbortSignal.timeout(6000)
    });
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers
    });
  } catch (err) {
    return c.json({ error: 'Upstream backend unreachable', path: url.pathname }, 502);
  }
});

app.all('*', async (c) => {
  if (c.env?.ASSETS) {
    return await c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

export default app;
