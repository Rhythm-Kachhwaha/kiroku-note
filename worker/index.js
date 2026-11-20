import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authApp, authenticateRequest, isAllowedOrigin } from './auth.js';
import { queryTurso, initTursoSchema, executeTursoTransaction } from './turso.js';
import kanjiRadicals from './kanji_radicals.js';

const app = new Hono();

app.onError((err, c) => {
  console.error('[Worker Error]', err);
  return c.json({
    error: 'Internal Server Error',
    message: err?.message || 'An unexpected error occurred'
  }, 500);
});

// CORS Middleware for web and extension clients
app.use('*', async (c, next) => {
  const origin = c.req.header('origin') || '';
  const allowed = isAllowedOrigin(origin, c.env);
  const corsHandler = cors({
    origin: (orig) => (allowed ? orig : null),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposeHeaders: ['Content-Length', 'X-Kiroku-Version'],
    maxAge: 86400,
    credentials: allowed,
  });
  return corsHandler(c, next);
});
app.options('*', (c) => c.text('', 204));

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

// Token-Bucket Rate Limiter (configurable capacity per IP or key)
const rateLimitMap = new Map();
const RATE_LIMIT_CAPACITY = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const REFILL_RATE = RATE_LIMIT_CAPACITY / RATE_LIMIT_WINDOW_MS;

function checkRateLimit(key, capacity = RATE_LIMIT_CAPACITY, windowMs = RATE_LIMIT_WINDOW_MS) {
  const now = Date.now();
  const refillRate = capacity / windowMs;
  let bucket = rateLimitMap.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now };
    rateLimitMap.set(key, bucket);
  } else {
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRate);
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

  const waitSeconds = Math.ceil((1 - bucket.tokens) / (refillRate * 1000)) || 1;
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

app.use('/api/sync/*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const { allowed, retryAfter } = checkRateLimit(ip, 120);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429);
  }
  return await next();
});

app.use('/sync/*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const { allowed, retryAfter } = checkRateLimit(ip, 120);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429);
  }
  return await next();
});

app.use('/api/user/progress/*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429);
  }
  return await next();
});

app.use('/api/subtitle/annotate', async (c, next) => {
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
    const isDev = c.env?.ENVIRONMENT !== 'production';
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
    const isDev = c.env?.ENVIRONMENT !== 'production';
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

app.use('/tokenize', async (c, next) => {
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

// ---------------------------------------------------------------------------
// Yomitan Structured Content AST Extractor
// ---------------------------------------------------------------------------
function findNodes(node, predicate, acc = []) {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const item of node) findNodes(item, predicate, acc);
    return acc;
  }
  if (typeof node === 'object') {
    if (predicate(node)) acc.push(node);
    if (node.content) findNodes(node.content, predicate, acc);
  }
  return acc;
}

function extractNodeText(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractNodeText).join('');
  if (node && typeof node === 'object') {
    if (node.tag === 'rt') return ''; // exclude furigana from clean text
    const cType = String(node.data?.content || node['data-content'] || node['data-sc-content'] || '').toLowerCase();
    const cClass = String(node.data?.class || node.className || node.class || '').toLowerCase();
    if (cType === 'attribution' || cType === 'extra-info' || cType === 'example-sentence' || cType === 'example-sentence-a' || cType === 'example-sentence-b' || cType === 'part-of-speech-info' || cType === 'dictionary-name' || cType === 'dictionary') {
      return '';
    }
    if (cClass.includes('attribution') || cClass.includes('extra-box') || cClass.includes('example')) {
      return '';
    }
    if (node.content) return extractNodeText(node.content);
    if (node.text) return String(node.text);
  }
  return '';
}

function extractExamplesFromSense(senseNode) {
  const examples = [];
  const exNodes = findNodes(senseNode, n => n.data?.content === 'example-sentence');
  for (const exNode of exNodes) {
    const aNodes = findNodes(exNode, n => n.data?.content === 'example-sentence-a');
    const bNodes = findNodes(exNode, n => n.data?.content === 'example-sentence-b');
    const ja = aNodes.map(extractNodeText).join('').trim();
    const en = bNodes.map(extractNodeText).join('').replace(/\[\d+\]/g, '').trim();
    if (ja) examples.push({ ja, en });
  }
  return examples;
}

function extractGlossesAndSenses(def) {
  if (typeof def === 'string') {
    return [{ glosses: [def], pos: [], examples: [] }];
  }
  if (!def || typeof def !== 'object') return [];

  const senses = [];
  const senseGroups = findNodes(def, n => n.data?.content === 'sense-group');
  if (senseGroups.length > 0) {
    for (const group of senseGroups) {
      const posNodes = findNodes(group, n => n.data?.content === 'part-of-speech-info');
      const posTags = posNodes.map(n => n.data?.code || extractNodeText(n)).filter(Boolean);

      const senseNodes = findNodes(group, n => n.data?.content === 'sense');
      if (senseNodes.length > 0) {
        for (const sNode of senseNodes) {
          const glossNodes = findNodes(sNode, n => n.data?.content === 'glossary');
          const glosses = [];
          for (const gNode of glossNodes) {
            const listItems = findNodes(gNode, n => n.tag === 'li');
            if (listItems.length > 0) {
              for (const li of listItems) {
                const txt = extractNodeText(li).trim();
                if (txt && !glosses.includes(txt)) glosses.push(txt);
              }
            } else {
              const txt = extractNodeText(gNode).trim();
              if (txt && !glosses.includes(txt)) glosses.push(txt);
            }
          }
          const examples = extractExamplesFromSense(sNode);
          if (glosses.length > 0) {
            senses.push({ glosses, pos: posTags, examples });
          }
        }
      }
    }
  }

  if (senses.length === 0) {
    const glossNodes = findNodes(def, n => n.data?.content === 'glossary');
    for (const gNode of glossNodes) {
      const listItems = findNodes(gNode, n => n.tag === 'li');
      const glosses = [];
      if (listItems.length > 0) {
        for (const li of listItems) {
          const txt = extractNodeText(li).trim();
          if (txt && !glosses.includes(txt)) glosses.push(txt);
        }
      } else {
        const txt = extractNodeText(gNode).trim();
        if (txt && !glosses.includes(txt)) glosses.push(txt);
      }
      if (glosses.length > 0) {
        senses.push({ glosses, pos: [], examples: extractExamplesFromSense(def) });
      }
    }
  }

  if (senses.length === 0) {
    const rawTxt = def.gloss || def.text || (typeof def === 'string' ? def : '');
    if (rawTxt && typeof rawTxt === 'string' && !rawTxt.startsWith('{')) {
      senses.push({ glosses: [rawTxt], pos: [], examples: [] });
    }
  }

  return senses;
}

// ---------------------------------------------------------------------------
// Grammar Progression Constants
// ---------------------------------------------------------------------------
const ROADMAP_CHAPTERS = [
  {
    chapter_id: 'ch1_foundations',
    title: 'Stage 1: Foundations & Identities',
    subtitle: 'State-of-being, core particles, questions, and polite copula',
    level_bracket: 'N5',
    order: 1,
    pattern_keys: ['だ', 'です', 'は', 'が', 'を', 'も', 'か', 'の']
  },
  {
    chapter_id: 'ch2_daily_descriptions',
    title: 'Stage 2: Daily Descriptions & Adjectives',
    subtitle: 'Actions in time and space, I/Na-adjectives, negative & past forms',
    level_bracket: 'N5',
    order: 2,
    pattern_keys: ['に', 'で', 'へ', 'と', 'から', 'まで', 'ない', 'た', 'たい']
  },
  {
    chapter_id: 'ch3_desires_connections',
    title: 'Stage 3: Desires & Connections',
    subtitle: 'Te-form linking, ongoing states, giving/receiving favors, reasons',
    level_bracket: 'N5-N4',
    order: 3,
    pattern_keys: ['て', 'ている', 'てある', 'てみる', 'あげる', 'くれる', 'もらう', 'から', 'ので', 'たり〜たり']
  },
  {
    chapter_id: 'ch4_potential_modality',
    title: 'Stage 4: Potential & Modality',
    subtitle: 'Obligations, permissions, potential ability, passive & causative voice',
    level_bracket: 'N4',
    order: 4,
    pattern_keys: ['受身', '使役', '使役受身', 'なければならない', 'てもいい', 'てはいけない', 'ことができる', 'わけにはいかない']
  },
  {
    chapter_id: 'ch5_nuance_conjecture',
    title: 'Stage 5: Nuance & Conjecture',
    subtitle: 'Direct appearance vs hearsay, conditionals, subtle expressions',
    level_bracket: 'N4-N3',
    order: 5,
    pattern_keys: ['そうだ(appearance)', 'そうだ(hearsay)', 'らしい', 'ようだ', 'たら', 'ば', 'なら', 'のに', 'てくる', 'ていく']
  }
];

const CONCEPTUAL_HUBS = [
  {
    hub_id: 'hub_particles',
    title: 'Core Particles & Role Markers',
    description: 'Topic, subject, object, venue, destination, and relational anchors.',
    icon: 'particle',
    pattern_keys: ['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も', 'から', 'まで', 'より', 'すら', 'だけ', 'しか〜ない']
  },
  {
    hub_id: 'hub_conjugations',
    title: 'Verbal Inflections & Stems',
    description: 'Te-form chains, past, negative, volitional, and stem connectors.',
    icon: 'conjugation',
    pattern_keys: ['て', 'た', 'ない', 'ずに', 'ながら', 'たり〜たり']
  },
  {
    hub_id: 'hub_giving_receiving',
    title: 'Giving & Receiving Benefactives',
    description: 'Action vectors and favor exchanges (あげる, くれる, もらう, てやる, ていただく).',
    icon: 'favor',
    pattern_keys: ['あげる', 'くれる', 'もらう', 'てあげる', 'てくれる', 'てもらう']
  },
  {
    hub_id: 'hub_conjectures',
    title: 'Conjectures, Evidentials & Hearsay',
    description: 'Subjective appearance, rumors, deduction, and certainty judgements.',
    icon: 'conjecture',
    pattern_keys: ['そうだ(appearance)', 'そうだ(hearsay)', 'らしい', 'ようだ', 'みたい', 'に違いない', 'に決まっている', 'はずだ']
  },
  {
    hub_id: 'hub_conditionals',
    title: 'Conditionals & Temporal Transitions',
    description: 'Hypothetical, temporal, inevitable, and contextual "if/when" clauses.',
    icon: 'conditional',
    pattern_keys: ['たら', 'ば', 'と', 'なら', 'たら最後 / が最後', 'ともなると / ともなれば']
  },
  {
    hub_id: 'hub_causative_passive',
    title: 'Voice: Passive, Causative & Causative-Passive',
    description: 'Transitivity, agency shifts, victim passive, and enforced actions.',
    icon: 'voice',
    pattern_keys: ['受身', '使役', '使役受身']
  }
];

async function enrichRoadmapPoints(c, patternKeys) {
  try {
    const rows = await queryNeon(
      c,
      `SELECT pattern_key, pattern_display, level, meaning_short
       FROM grammar_index
       WHERE pattern_key = ANY($1) OR pattern_display = ANY($1)`,
      [patternKeys]
    );
    const rowMap = new Map();
    for (const r of rows) {
      if (r.pattern_key) rowMap.set(r.pattern_key, r);
      if (r.pattern_display) rowMap.set(r.pattern_display, r);
    }
    return patternKeys.map(k => {
      const match = rowMap.get(k);
      return {
        pattern_key: match?.pattern_key || k,
        display: match?.pattern_display || k,
        level: match?.level || 'N5',
        meaning_short: match?.meaning_short || '',
        seen_count: 0,
        mastery_score: 0.0,
        drill_count: 0,
        pipeline_status: 'unseen',
        encountered_badge: false,
        mastery_pct: 0
      };
    });
  } catch (_) {
    return patternKeys.map(k => ({
      pattern_key: k,
      display: k,
      level: 'N5',
      meaning_short: '',
      seen_count: 0,
      mastery_score: 0.0,
      drill_count: 0,
      pipeline_status: 'unseen',
      encountered_badge: false,
      mastery_pct: 0
    }));
  }
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

function queryNeonNodeFallback(neonSqlUrl, neonConnStr, sql, params) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(neonSqlUrl);
      const dns = require('node:dns');
      const https = require('node:https');
      const resolver = new dns.Resolver();
      resolver.setServers(['8.8.8.8', '1.1.1.1']);

      const headers = {
        'Content-Type': 'application/json',
        'Neon-Connection-String': neonConnStr
      };

      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        lookup: (hostname, opts, cb) => {
          resolver.resolve4('c-4.us-west-2.aws.neon.tech', (err, addrs) => {
            if (err) return cb(err);
            if (typeof opts === 'object' && opts.all) {
              return cb(null, addrs.map(a => ({ address: a, family: 4 })));
            }
            cb(null, addrs[0], 4);
          });
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(body);
              resolve(data.rows || []);
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(`Neon Node fallback error (${res.statusCode}): ${body}`));
          }
        });
      });

      req.on('error', reject);
      req.write(JSON.stringify({ query: sql, params }));
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function queryNeon(c, sql, params = []) {
  const neonSqlUrl = c.env?.NEON_SQL_URL || (typeof process !== 'undefined' && process.env?.NEON_SQL_URL) || NEON_DEFAULT_URL;
  const neonConnStr = c.env?.NEON_DATABASE_URL || c.env?.DATABASE_URL || (typeof process !== 'undefined' && (process.env?.NEON_DATABASE_URL || process.env?.DATABASE_URL)) || '';
  const headers = { 'Content-Type': 'application/json' };
  if (neonConnStr) {
    headers['Neon-Connection-String'] = neonConnStr;
  }
  try {
    const res = await fetch(neonSqlUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: sql, params }),
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Neon SQL error (${res.status}): ${err}`);
    }
    const data = await res.json();
    return data.rows || [];
  } catch (fetchErr) {
    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        return await queryNeonNodeFallback(neonSqlUrl, neonConnStr, sql, params);
      } catch (_) {}
    }
    throw fetchErr;
  }
}

// Turso client imported from ./turso.js

// ---------------------------------------------------------------------------
// Health & Telemetry Endpoints
// ---------------------------------------------------------------------------
async function handleHealth(c) {
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
}

app.get('/api/health', handleHealth);
app.get('/health', handleHealth);

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

async function handleTokenize(c) {
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

  const tokenizerUrl = c.env?.TOKENIZER_URL;
  if (tokenizerUrl) {
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
}

app.post('/api/tokenize', handleTokenize);
app.post('/tokenize', handleTokenize);

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
        const rawDefs = await decompressBlobBase64(row.blob_base64);
        row.definitions = [];
        if (Array.isArray(rawDefs)) {
          for (const d of rawDefs) {
            const parsed = extractGlossesAndSenses(d);
            for (const p of parsed) {
              const g = p.glosses.join('; ');
              if (g && !row.definitions.includes(g)) row.definitions.push(g);
            }
          }
        }
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
    const [terms, jlptVocabRows] = await Promise.all([
      queryNeon(
        c,
        `SELECT id, term, reading, norm_term, rules, def_tags, score, sequence, term_tags, dictionary,
                encode(content_blob, 'base64') as blob_base64
         FROM terms WHERE term = $1 OR reading = $1 OR norm_term = $1
         ORDER BY score DESC LIMIT 15`,
        [text]
      ),
      queryNeon(
        c,
        `SELECT word, reading, meanings, level, examples FROM jlpt_vocab WHERE word = $1 OR reading = $1 LIMIT 1`,
        [text]
      )
    ]);

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
      let foundExample = null;

      for (const row of terms) {
        const cleanDefs = [];
        const rowSenses = [];
        if (Array.isArray(row.definitions)) {
          for (const d of row.definitions) {
            const parsedSenses = extractGlossesAndSenses(d);
            for (const s of parsedSenses) {
              const glossText = s.glosses.join('; ');
              if (glossText) {
                if (!cleanDefs.includes(glossText)) cleanDefs.push(glossText);
                const posStr = (s.pos.length > 0 ? s.pos.join(', ') : (row.rules || row.def_tags || '')).trim();
                rowSenses.push({
                  pos: posStr ? [posStr] : [],
                  glosses: s.glosses,
                  definition: glossText
                });
                senses.push({
                  pos: posStr,
                  gloss: glossText,
                  definition: glossText
                });
                meaningParts.push(glossText);
                if (!foundExample && s.examples && s.examples.length > 0) {
                  foundExample = s.examples[0];
                }
              }
            }
          }
        }
        row.definitions = cleanDefs;
        row.senses = rowSenses;
      }

      if (!foundExample && jlptVocabRows.length > 0 && jlptVocabRows[0].examples) {
        try {
          const exList = typeof jlptVocabRows[0].examples === 'string'
            ? JSON.parse(jlptVocabRows[0].examples)
            : jlptVocabRows[0].examples;
          if (Array.isArray(exList) && exList.length > 0) {
            foundExample = exList[0];
          }
        } catch (_) {}
      }

      let formattedMeaning = '';
      if (meaningParts.length === 1) {
        formattedMeaning = meaningParts[0];
      } else if (meaningParts.length > 1) {
        formattedMeaning = meaningParts.slice(0, 5).map((m, i) => `${i + 1}. ${m}`).join('\n');
      } else if (jlptVocabRows.length > 0 && jlptVocabRows[0].meanings) {
        try {
          const meanings = typeof jlptVocabRows[0].meanings === 'string'
            ? JSON.parse(jlptVocabRows[0].meanings)
            : jlptVocabRows[0].meanings;
          formattedMeaning = Array.isArray(meanings) ? meanings.join('\n') : String(meanings);
        } catch (_) {}
      }

      const jlptLevel = jlptVocabRows[0]?.level || topTerm.term_tags?.match(/N[1-5]/)?.[0] || null;

      return c.json({
        id: null,
        expression: expr,
        reading: reading,
        meaning: formattedMeaning,
        hint: '',
        example_sentence: foundExample?.ja || '',
        example_translation: foundExample?.en || '',
        image: '',
        audio: '',
        tags: 'kiroku',
        notes: '',
        source_text: text,
        deinflected_text: text,
        jlpt_level: jlptLevel,
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
          const data = await resp.json();
          if (data) {
            if (Array.isArray(data.senses)) {
              for (const s of data.senses) {
                const rawG = s.gloss || s.definition || '';
                if (typeof rawG === 'string' && (rawG.includes('"structured-content"') || rawG.startsWith('{') || rawG.startsWith('['))) {
                  try {
                    const parsed = JSON.parse(rawG);
                    const extracted = extractGlossesAndSenses(parsed);
                    if (extracted.length > 0) {
                      s.gloss = extracted[0].glosses.join('; ');
                      s.definition = s.gloss;
                      if (!s.pos && extracted[0].pos?.length) s.pos = extracted[0].pos.join(', ');
                    }
                  } catch (_) {}
                }
              }
            }
            if (typeof data.meaning === 'string' && (data.meaning.includes('"structured-content"') || data.meaning.startsWith('{') || data.meaning.startsWith('['))) {
              try {
                let jsonStr = data.meaning.trim();
                const jsonStart = jsonStr.indexOf('{"type"');
                if (jsonStart !== -1) jsonStr = jsonStr.slice(jsonStart);
                const parsedMeaning = JSON.parse(jsonStr);
                const senses = extractGlossesAndSenses(parsedMeaning);
                if (senses.length > 0) {
                  data.meaning = senses.slice(0, 5).map((s, i) => `${i + 1}. ${s.pos.length ? `[${s.pos.join(', ')}] ` : ''}${s.glosses.join('; ')}`).join('\n');
                  if (!data.senses || data.senses.length === 0) {
                    data.senses = senses.map(s => ({ pos: s.pos.join(', '), gloss: s.glosses.join('; '), definition: s.glosses.join('; ') }));
                  }
                }
              } catch (_) {}
            }
          }
          return c.json(data);
        }
      } catch (e) {
        console.warn('[Worker] Upstream capture failed:', e.message);
      }
    }

    if (jlptVocabRows && jlptVocabRows.length > 0) {
      const jRow = jlptVocabRows[0];
      let meanings = [];
      try {
        meanings = typeof jRow.meanings === 'string' ? JSON.parse(jRow.meanings) : jRow.meanings;
      } catch (_) {
        meanings = [String(jRow.meanings || '')];
      }
      if (!Array.isArray(meanings)) meanings = [String(meanings)];
      meanings = meanings.filter(Boolean);

      let foundExample = null;
      if (jRow.examples) {
        try {
          const exList = typeof jRow.examples === 'string' ? JSON.parse(jRow.examples) : jRow.examples;
          if (Array.isArray(exList) && exList.length > 0) foundExample = exList[0];
        } catch (_) {}
      }

      const formattedMeaning = meanings.length > 1
        ? meanings.slice(0, 5).map((m, i) => `${i + 1}. ${m}`).join('\n')
        : (meanings[0] || '');

      const senses = meanings.map(m => ({ pos: '', gloss: m, definition: m }));

      return c.json({
        id: null,
        expression: jRow.word || text,
        reading: jRow.reading || text,
        meaning: formattedMeaning,
        hint: '',
        example_sentence: foundExample?.ja || '',
        example_translation: foundExample?.en || '',
        image: '',
        audio: '',
        tags: 'kiroku',
        notes: '',
        source_text: text,
        deinflected_text: text,
        jlpt_level: jRow.level || null,
        entries: [{
          id: 0,
          term: jRow.word || text,
          reading: jRow.reading || text,
          definitions: meanings,
          senses: senses,
          dictionary: 'JLPT Vocab'
        }],
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
  const accept = c.req.header('Accept') || '';
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  try {
    const rows = await queryNeon(c, 'SELECT character, codepoint, svg FROM kanji_strokes WHERE character = $1 LIMIT 1', [char]);
    if (rows.length > 0 && rows[0].svg) {
      if (accept.includes('image/svg+xml') || c.req.query('format') === 'svg') {
        c.header('Content-Type', 'image/svg+xml; charset=utf-8');
        return c.body(rows[0].svg);
      }
      return c.json({
        character: rows[0].character || char,
        codepoint: rows[0].codepoint || null,
        svg: rows[0].svg
      });
    }
    return c.json({ error: 'Kanji stroke not found' }, 404);
  } catch (err) {
    console.warn('[Worker] Kanji stroke error:', err.message);
    return c.json({ error: 'Kanji stroke query failed' }, 500);
  }
});

app.get('/api/kanji/browse', async (c) => {
  const rawLevel = (c.req.query('level') || 'N5').trim();
  const limit = Math.min(parseInt(c.req.query('limit') || '36', 10), 2500);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  try {
    let whereClause = 'level = $1';
    let params = [rawLevel.toUpperCase()];

    if (rawLevel.toUpperCase() === 'JOYO') {
      whereClause = 'grade IS NOT NULL';
      params = [];
    }

    const countSql = `SELECT count(*) as total FROM jlpt_kanji WHERE ${whereClause}`;
    const listSql = `SELECT character, level, strokes, grade, freq, onyomi, kunyomi, meanings
                     FROM jlpt_kanji WHERE ${whereClause}
                     ORDER BY id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const [countRows, rows] = await Promise.all([
      queryNeon(c, countSql, params),
      queryNeon(c, listSql, [...params, limit, offset])
    ]);

    const total = parseInt(countRows[0]?.total || '0', 10);
    const kanji = rows.map(r => {
      let onyomi = r.onyomi;
      try { if (typeof onyomi === 'string' && onyomi.startsWith('[')) onyomi = JSON.parse(onyomi); } catch (_) {}
      let kunyomi = r.kunyomi;
      try { if (typeof kunyomi === 'string' && kunyomi.startsWith('[')) kunyomi = JSON.parse(kunyomi); } catch (_) {}
      let meanings = r.meanings;
      try { if (typeof meanings === 'string' && meanings.startsWith('[')) meanings = JSON.parse(meanings); } catch (_) {}

      return {
        character: r.character,
        level: r.level,
        strokes: r.strokes,
        grade: r.grade,
        freq: r.freq,
        onyomi: Array.isArray(onyomi) ? onyomi.join(', ') : (onyomi || ''),
        kunyomi: Array.isArray(kunyomi) ? kunyomi.join(', ') : (kunyomi || ''),
        meanings: Array.isArray(meanings) ? meanings : (meanings ? [meanings] : []),
        radical: kanjiRadicals[r.character] || null
      };
    });

    return c.json({ level: rawLevel, kanji, total });
  } catch (err) {
    console.warn('[Worker] Kanji browse error:', err.message);
    return c.json({ error: 'Kanji browse failed', level: rawLevel, kanji: [], total: 0 }, 500);
  }
});

app.get('/api/kanji/study-list', async (c) => {
  const rawLevel = (c.req.query('level') || 'N5').trim();
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 2500);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');

  try {
    let whereClause = 'level = $1';
    let params = [rawLevel.toUpperCase()];
    if (rawLevel.toUpperCase() === 'JOYO') {
      whereClause = 'grade IS NOT NULL';
      params = [];
    }

    const countSql = `SELECT count(*) as total FROM jlpt_kanji WHERE ${whereClause}`;
    const listSql = `SELECT character, level, strokes, grade, freq, onyomi, kunyomi, meanings
                     FROM jlpt_kanji WHERE ${whereClause}
                     ORDER BY id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const [countRows, rows] = await Promise.all([
      queryNeon(c, countSql, params),
      queryNeon(c, listSql, [...params, limit, offset])
    ]);

    const total = parseInt(countRows[0]?.total || '0', 10);
    const chars = rows.map(r => r.character);

    // Fetch vocabulary compounds for this batch of kanji from jlpt_vocab
    const compoundsMap = {};
    if (chars.length > 0 && chars.length <= 100) {
      try {
        const vocabPatterns = chars.map(ch => `%${ch}%`);
        const vocabRows = await queryNeon(c, `
          SELECT word, reading, meanings
          FROM jlpt_vocab
          WHERE word LIKE ANY($1)
          ORDER BY id ASC LIMIT 250
        `, [vocabPatterns]);

        for (const v of vocabRows) {
          let m = v.meanings;
          try { if (typeof m === 'string' && m.startsWith('[')) m = JSON.parse(m); } catch (_) {}
          const gloss = Array.isArray(m) ? m.slice(0, 2).join('; ') : (m || '');

          for (const ch of chars) {
            if (v.word.includes(ch)) {
              if (!compoundsMap[ch]) compoundsMap[ch] = [];
              if (compoundsMap[ch].length < 4 && !compoundsMap[ch].some(x => x.term === v.word)) {
                compoundsMap[ch].push({
                  term: v.word,
                  reading: v.reading,
                  meaning: gloss
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Worker] Kanji study-list compounds fetch error:', err.message);
      }
    }

    const items = rows.map((r, i) => {
      let onyomi = r.onyomi;
      try { if (typeof onyomi === 'string' && onyomi.startsWith('[')) onyomi = JSON.parse(onyomi); } catch (_) {}
      let kunyomi = r.kunyomi;
      try { if (typeof kunyomi === 'string' && kunyomi.startsWith('[')) kunyomi = JSON.parse(kunyomi); } catch (_) {}
      let meanings = r.meanings;
      try { if (typeof meanings === 'string' && meanings.startsWith('[')) meanings = JSON.parse(meanings); } catch (_) {}

      return {
        index: offset + i + 1,
        character: r.character,
        level: r.level,
        strokes: r.strokes,
        grade: r.grade,
        freq: r.freq,
        meanings: Array.isArray(meanings) ? meanings : (meanings ? [meanings] : []),
        onyomi: Array.isArray(onyomi) ? onyomi : (typeof onyomi === 'string' ? onyomi.split(/[,、\s]+/).filter(Boolean) : []),
        kunyomi: Array.isArray(kunyomi) ? kunyomi : (typeof kunyomi === 'string' ? kunyomi.split(/[,、\s]+/).filter(Boolean) : []),
        radical: kanjiRadicals[r.character] || null,
        compounds: compoundsMap[r.character] || [],
        custom_compounds: []
      };
    });

    return c.json({ level: rawLevel, items, total, offset, limit });
  } catch (err) {
    console.warn('[Worker] Kanji study-list error:', err.message);
    return c.json({ level: rawLevel, items: [], total: 0, offset, limit, error: err.message }, 500);
  }
});

app.get('/api/kanji/seen', (c) => {
  return c.json({ seen_kanji: {}, total_seen: 0 });
});

app.get('/api/kanji/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const limit = Math.min(parseInt(c.req.query('limit') || '10', 10), 30);
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (!q) {
    return c.json({ query: '', results: [] });
  }

  try {
    const kanjiChars = q.match(/[\u4e00-\u9faf]/g) || [];
    let rows = [];

    if (kanjiChars.length > 0) {
      rows = await queryNeon(
        c,
        'SELECT character, level, strokes, grade, freq, onyomi, kunyomi, meanings FROM jlpt_kanji WHERE character = ANY($1) LIMIT $2',
        [kanjiChars, limit]
      );
    }

    if (rows.length === 0) {
      const qLower = q.toLowerCase();
      const pattern = `%${qLower}%`;
      const prefix = `${qLower}%`;
      rows = await queryNeon(
        c,
        `SELECT character, level, strokes, grade, freq, onyomi, kunyomi, meanings
         FROM jlpt_kanji
         WHERE character = $1
            OR meanings ILIKE $2
            OR onyomi ILIKE $2
            OR kunyomi ILIKE $2
         ORDER BY
           CASE
             WHEN character = $1 THEN 0
             WHEN meanings ILIKE $3 THEN 1
             WHEN onyomi ILIKE $3 THEN 2
             WHEN kunyomi ILIKE $3 THEN 3
             ELSE 4
           END,
           freq ASC NULLS LAST, id ASC
         LIMIT $4`,
        [q, pattern, prefix, limit]
      );
    }

    if (rows.length === 0) {
      const pattern = `%${q.toLowerCase()}%`;
      const vocabRows = await queryNeon(
        c,
        'SELECT word FROM jlpt_vocab WHERE word ILIKE $1 OR reading ILIKE $1 OR meanings ILIKE $1 ORDER BY id ASC LIMIT 5',
        [pattern]
      );
      const extractedChars = [];
      for (const vr of vocabRows) {
        const matches = (vr.word || '').match(/[\u4e00-\u9faf]/g) || [];
        for (const ch of matches) {
          if (!extractedChars.includes(ch)) extractedChars.push(ch);
        }
      }
      if (extractedChars.length > 0) {
        rows = await queryNeon(
          c,
          'SELECT character, level, strokes, grade, freq, onyomi, kunyomi, meanings FROM jlpt_kanji WHERE character = ANY($1) LIMIT $2',
          [extractedChars, limit]
        );
      }
    }

    const results = rows.map(r => {
      let onyomi = r.onyomi;
      try { if (typeof onyomi === 'string' && onyomi.startsWith('[')) onyomi = JSON.parse(onyomi); } catch (_) {}
      let kunyomi = r.kunyomi;
      try { if (typeof kunyomi === 'string' && kunyomi.startsWith('[')) kunyomi = JSON.parse(kunyomi); } catch (_) {}
      let meanings = r.meanings;
      try { if (typeof meanings === 'string' && meanings.startsWith('[')) meanings = JSON.parse(meanings); } catch (_) {}

      return {
        character: r.character,
        level: r.level || '--',
        jlpt_level: r.level || '--',
        strokes: r.strokes || null,
        stroke_count: r.strokes || null,
        grade: r.grade || null,
        freq: r.freq || null,
        radical: kanjiRadicals[r.character] || null,
        onyomi: Array.isArray(onyomi) ? onyomi : (onyomi ? [onyomi] : []),
        kunyomi: Array.isArray(kunyomi) ? kunyomi : (kunyomi ? [kunyomi] : []),
        meanings: Array.isArray(meanings) ? meanings : (meanings ? [meanings] : [])
      };
    });

    return c.json({ query: q, results });
  } catch (err) {
    console.warn('[Worker] Kanji search error:', err.message);
    return c.json({ query: q, results: [], error: err.message }, 500);
  }
});

app.get('/api/kanji/details/:character', async (c) => {
  const char = c.req.param('character');
  c.header('Cache-Control', 'no-cache, must-revalidate');
  try {
    // 1. Query jlpt_kanji first
    const jlptRows = await queryNeon(
      c,
      'SELECT character, level, strokes, grade, freq, onyomi, kunyomi, meanings FROM jlpt_kanji WHERE character = $1 LIMIT 1',
      [char]
    );

    if (jlptRows.length > 0) {
      const r = jlptRows[0];
      let onyomi = r.onyomi;
      try { if (typeof onyomi === 'string' && onyomi.startsWith('[')) onyomi = JSON.parse(onyomi); } catch (_) {}
      let kunyomi = r.kunyomi;
      try { if (typeof kunyomi === 'string' && kunyomi.startsWith('[')) kunyomi = JSON.parse(kunyomi); } catch (_) {}
      let meanings = r.meanings;
      try { if (typeof meanings === 'string' && meanings.startsWith('[')) meanings = JSON.parse(meanings); } catch (_) {}

      return c.json({
        character: r.character,
        level: r.level || '--',
        jlpt_level: r.level || '--',
        strokes: r.strokes || null,
        stroke_count: r.strokes || null,
        grade: r.grade || null,
        freq: r.freq || null,
        radical: kanjiRadicals[char] || null,
        onyomi: Array.isArray(onyomi) ? onyomi : (onyomi ? [onyomi] : []),
        kunyomi: Array.isArray(kunyomi) ? kunyomi : (kunyomi ? [kunyomi] : []),
        meanings: Array.isArray(meanings) ? meanings : (meanings ? [meanings] : [])
      });
    }

    // 2. Fallback to general kanji table
    const rows = await queryNeon(
      c,
      'SELECT character, onyomi, kunyomi, tags, stats_json, meanings_json, dictionary FROM kanji WHERE character = $1 LIMIT 1',
      [char]
    );
    if (rows.length > 0) {
      const r = rows[0];
      let meanings = [];
      try { meanings = typeof r.meanings_json === 'string' ? JSON.parse(r.meanings_json) : (r.meanings_json || []); } catch (_) {}
      let stats = {};
      try { stats = typeof r.stats_json === 'string' ? JSON.parse(r.stats_json) : (r.stats_json || {}); } catch (_) {}

      const rawLevel = stats.jlpt ? (String(stats.jlpt).startsWith('N') ? stats.jlpt : `N${stats.jlpt}`) : (stats.level || '--');
      return c.json({
        character: r.character,
        level: rawLevel,
        jlpt_level: rawLevel,
        strokes: stats.strokes ? parseInt(stats.strokes, 10) : null,
        stroke_count: stats.strokes ? parseInt(stats.strokes, 10) : null,
        grade: stats.grade ? parseInt(stats.grade, 10) : null,
        freq: stats.freq || stats.frequency || null,
        radical: kanjiRadicals[char] || null,
        onyomi: r.onyomi ? r.onyomi.split(/[,、\s]+/).filter(Boolean) : [],
        kunyomi: r.kunyomi ? r.kunyomi.split(/[,、\s]+/).filter(Boolean) : [],
        meanings: Array.isArray(meanings) ? meanings : []
      });
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
    const [strokeRows, jlptRows, genericRows] = await Promise.all([
      queryNeon(c, 'SELECT character, codepoint, svg FROM kanji_strokes WHERE character = $1 LIMIT 1', [char]),
      queryNeon(c, 'SELECT character, level, strokes, grade, freq, onyomi, kunyomi, meanings FROM jlpt_kanji WHERE character = $1 LIMIT 1', [char]),
      queryNeon(c, 'SELECT character, onyomi, kunyomi, tags, stats_json, meanings_json, dictionary FROM kanji WHERE character = $1 LIMIT 1', [char])
    ]);

    let details = null;
    if (jlptRows.length > 0) {
      const r = jlptRows[0];
      let onyomi = r.onyomi;
      try { if (typeof onyomi === 'string' && onyomi.startsWith('[')) onyomi = JSON.parse(onyomi); } catch (_) {}
      let kunyomi = r.kunyomi;
      try { if (typeof kunyomi === 'string' && kunyomi.startsWith('[')) kunyomi = JSON.parse(kunyomi); } catch (_) {}
      let meanings = r.meanings;
      try { if (typeof meanings === 'string' && meanings.startsWith('[')) meanings = JSON.parse(meanings); } catch (_) {}

      details = {
        character: r.character,
        level: r.level || '--',
        jlpt_level: r.level || '--',
        strokes: r.strokes || null,
        stroke_count: r.strokes || null,
        grade: r.grade || null,
        freq: r.freq || null,
        radical: kanjiRadicals[char] || null,
        onyomi: Array.isArray(onyomi) ? onyomi : (onyomi ? [onyomi] : []),
        kunyomi: Array.isArray(kunyomi) ? kunyomi : (kunyomi ? [kunyomi] : []),
        meanings: Array.isArray(meanings) ? meanings : (meanings ? [meanings] : [])
      };
    } else if (genericRows.length > 0) {
      const r = genericRows[0];
      let meanings = [];
      try { meanings = typeof r.meanings_json === 'string' ? JSON.parse(r.meanings_json) : (r.meanings_json || []); } catch (_) {}
      let stats = {};
      try { stats = typeof r.stats_json === 'string' ? JSON.parse(r.stats_json) : (r.stats_json || {}); } catch (_) {}

      const rawLevel = stats.jlpt ? (String(stats.jlpt).startsWith('N') ? stats.jlpt : `N${stats.jlpt}`) : (stats.level || '--');
      details = {
        character: r.character,
        level: rawLevel,
        jlpt_level: rawLevel,
        strokes: stats.strokes ? parseInt(stats.strokes, 10) : null,
        stroke_count: stats.strokes ? parseInt(stats.strokes, 10) : null,
        grade: stats.grade ? parseInt(stats.grade, 10) : null,
        freq: stats.freq || stats.frequency || null,
        radical: kanjiRadicals[char] || null,
        onyomi: r.onyomi ? r.onyomi.split(/[,、\s]+/).filter(Boolean) : [],
        kunyomi: r.kunyomi ? r.kunyomi.split(/[,、\s]+/).filter(Boolean) : [],
        meanings: Array.isArray(meanings) ? meanings : (meanings ? [meanings] : [])
      };
    }

    return c.json({
      character: char,
      svg: strokeRows[0]?.svg || null,
      details: details
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
    // 1. First query jlpt_vocab for clean compound words with readable English meanings
    const vocabRows = await queryNeon(
      c,
      `SELECT word, reading, meanings, level
       FROM jlpt_vocab
       WHERE word LIKE '%' || $1 || '%' AND length(word) > 1
       ORDER BY level ASC, id ASC LIMIT $2`,
      [char, limit]
    );

    const compounds = vocabRows.map(r => {
      let m = r.meanings;
      try { if (typeof m === 'string' && m.startsWith('[')) m = JSON.parse(m); } catch (_) {}
      const meaningStr = Array.isArray(m) ? m.slice(0, 2).join('; ') : (m || '');
      return {
        term: r.word,
        reading: r.reading,
        meaning: meaningStr,
        level: r.level || 'JLPT'
      };
    });

    // 2. If fewer than desired limit, supplement from terms table
    if (compounds.length < limit) {
      const remainingLimit = limit - compounds.length;
      const termRows = await queryNeon(
        c,
        `SELECT term, reading, def_tags, rules, score
         FROM terms
         WHERE term LIKE '%' || $1 || '%' AND length(term) > 1
         ORDER BY score DESC LIMIT $2`,
        [char, remainingLimit * 2]
      );

      for (const tr of termRows) {
        if (!compounds.some(c => c.term === tr.term)) {
          compounds.push({
            term: tr.term,
            reading: tr.reading,
            meaning: tr.rules || tr.term || '',
            score: tr.score
          });
          if (compounds.length >= limit) break;
        }
      }
    }

    return c.json({ character: char, compounds });
  } catch (err) {
    console.warn('[Worker] Kanji compounds error:', err.message);
    return c.json({ character: char, compounds: [] });
  }
});

app.post('/api/kanji/compounds/custom', async (c) => {
  let body = {};
  try { body = await c.req.json(); } catch {}
  return c.json({
    ok: true,
    id: Date.now(),
    character: body.character || '',
    term: body.term || '',
    reading: body.reading || '',
    meaning: body.meaning || '',
    created_at: new Date().toISOString()
  }, 201);
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

app.patch('/api/grammar/points/:patternKey', async (c) => {
  const patternKey = c.req.param('patternKey');
  let body = {};
  try { body = await c.req.json(); } catch {}
  return c.json({
    ok: true,
    pattern_key: patternKey,
    status: body.status || 'learning',
    updated_at: new Date().toISOString()
  });
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
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  try {
    const chapters = [];
    for (const ch of ROADMAP_CHAPTERS) {
      const pts = await enrichRoadmapPoints(c, ch.pattern_keys);
      chapters.push({
        chapter_id: ch.chapter_id,
        title: ch.title,
        subtitle: ch.subtitle,
        level_bracket: ch.level_bracket,
        order: ch.order,
        stats: {
          total_points: pts.length,
          encountered_points: 0,
          mastered_points: 0,
          average_mastery: 0.0
        },
        points: pts
      });
    }
    return c.json({ chapters });
  } catch (err) {
    console.warn('[Worker] Roadmap flow error:', err.message);
    return c.json({ chapters: [] });
  }
});

app.get('/api/grammar/roadmap/hubs', async (c) => {
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  try {
    const hubs = [];
    for (const hb of CONCEPTUAL_HUBS) {
      const pts = await enrichRoadmapPoints(c, hb.pattern_keys);
      hubs.push({
        hub_id: hb.hub_id,
        title: hb.title,
        description: hb.description,
        icon: hb.icon,
        stats: {
          total_points: pts.length,
          encountered_points: 0,
          mastered_points: 0,
          average_mastery: 0.0
        },
        points: pts
      });
    }
    return c.json({ hubs });
  } catch (err) {
    console.warn('[Worker] Roadmap hubs error:', err.message);
    return c.json({ hubs: [] });
  }
});

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
// Native Edge Study Question Bank & Practice Engine (Neon PostgreSQL)
// ---------------------------------------------------------------------------
const practiceSessions = new Map();

app.get('/api/study/v1/bank/summary', async (c) => {
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  try {
    const rows = await queryNeon(
      c,
      `SELECT level, category, format_code, count(*) as count
       FROM question
       GROUP BY level, category, format_code
       ORDER BY level, category, format_code`
    );

    const levels = {
      N5: { level: 'N5', total_count: 0, eligible_count: 0, formats: [] },
      N4: { level: 'N4', total_count: 0, eligible_count: 0, formats: [] },
      N3: { level: 'N3', total_count: 0, eligible_count: 0, formats: [] },
      N2: { level: 'N2', total_count: 0, eligible_count: 0, formats: [] },
      N1: { level: 'N1', total_count: 0, eligible_count: 0, formats: [] }
    };

    let totalQuestions = 0;

    for (const r of rows) {
      const lvl = r.level || 'N5';
      const cnt = parseInt(r.count || '0', 10);
      totalQuestions += cnt;

      if (!levels[lvl]) {
        levels[lvl] = { level: lvl, total_count: 0, eligible_count: 0, formats: [] };
      }

      levels[lvl].total_count += cnt;
      levels[lvl].eligible_count += cnt;
      levels[lvl].formats.push({
        format_code: r.format_code,
        category: r.category,
        total_count: cnt,
        eligible_count: cnt
      });
    }

    return c.json({
      total_questions: totalQuestions,
      active_questions: totalQuestions,
      eligible_questions: totalQuestions,
      levels,
      summary: rows
    });
  } catch (err) {
    console.warn('[Worker] Bank summary error:', err.message);
    return c.json({ error: 'Question bank summary query failed', total_questions: 0, levels: {}, summary: [] }, 500);
  }
});

app.get('/api/study/v1/bank/questions', async (c) => {
  const level = c.req.query('level') || null;
  const formatCode = c.req.query('format') || null;
  const { limit, offset } = parsePagination(c, 20, 100);
  c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  try {
    let whereClause = '($1::text IS NULL OR q.level = $1) AND ($2::text IS NULL OR q.format_code = $2)';
    const countSql = `SELECT count(*) as total FROM question q WHERE ${whereClause}`;
    const listSql = `
      SELECT q.id, q.external_id, q.format_code, q.level, q.category,
             qr.stem_markup, qr.payload_json,
             (SELECT json_agg(json_build_object('id', rc.id, 'choice_id', rc.id, 'choice_key', rc.choice_key, 'label', rc.label, 'text_markup', rc.text_markup, 'text', rc.text_markup, 'ordinal', rc.ordinal) ORDER BY rc.ordinal)
              FROM revision_choice rc WHERE rc.question_revision_id = qr.id) as choices,
             (SELECT json_build_object('choice_id', ra.choice_id, 'rationale_markup', ra.rationale_markup)
              FROM revision_answer ra WHERE ra.question_revision_id = qr.id) as answer,
             (SELECT json_build_object('summary_text', qe.summary_text, 'correct_choice_analysis', qe.correct_choice_analysis)
              FROM question_explanation qe WHERE qe.question_id = q.id LIMIT 1) as explanation
      FROM question q
      JOIN question_revision qr ON q.current_revision_id = qr.id
      WHERE ${whereClause}
      ORDER BY q.id
      LIMIT $3 OFFSET $4
    `;

    const [countRows, rows] = await Promise.all([
      queryNeon(c, countSql, [level, formatCode]),
      queryNeon(c, listSql, [level, formatCode, limit, offset])
    ]);

    const total = parseInt(countRows[0]?.total || '0', 10);
    const items = rows.map((r) => ({
      id: r.id,
      question_id: r.id,
      external_id: r.external_id,
      format_code: r.format_code,
      level: r.level,
      category: r.category,
      prompt_markup: r.stem_markup,
      stem_markup: r.stem_markup,
      prompt_html: null,
      verification_status: 'verified',
      choices: (r.choices || []).map((ch, i) => ({
        id: String(ch.id || ch.choice_id || i + 1),
        choice_id: String(ch.id || ch.choice_id || i + 1),
        choice_key: ch.choice_key || `c_${i + 1}`,
        label: ch.label || String(i + 1),
        text_markup: ch.text_markup || ch.text || '',
        text: ch.text_markup || ch.text || ''
      })),
      answer: r.answer || null,
      explanation: r.explanation || null
    }));

    return c.json({
      items,
      total,
      questions: items,
      count: items.length,
      offset,
      limit
    });
  } catch (err) {
    console.warn('[Worker] Bank questions error:', err.message);
    return c.json({ error: 'Question bank query failed', items: [], questions: [], total: 0, count: 0 }, 500);
  }
});

app.get('/api/study/v1/bank/questions/:id', async (c) => {
  const rawId = c.req.param('id');
  const numId = parseInt(rawId, 10);
  try {
    const rows = await queryNeon(c, `
      SELECT q.id, q.external_id, q.format_code, q.level, q.category,
             qr.stem_markup, qr.payload_json,
             (SELECT json_agg(json_build_object('id', rc.id, 'choice_id', rc.id, 'choice_key', rc.choice_key, 'label', rc.label, 'text_markup', rc.text_markup, 'text', rc.text_markup, 'ordinal', rc.ordinal) ORDER BY rc.ordinal)
              FROM revision_choice rc WHERE rc.question_revision_id = qr.id) as choices,
             (SELECT json_build_object('choice_id', ra.choice_id, 'rationale_markup', ra.rationale_markup)
              FROM revision_answer ra WHERE ra.question_revision_id = qr.id) as answer,
             (SELECT json_build_object('summary_text', qe.summary_text, 'correct_choice_analysis', qe.correct_choice_analysis)
              FROM question_explanation qe WHERE qe.question_id = q.id LIMIT 1) as explanation
      FROM question q
      JOIN question_revision qr ON q.current_revision_id = qr.id
      WHERE q.id = $1 OR q.external_id = $2
      LIMIT 1
    `, [Number.isFinite(numId) ? numId : -1, rawId]);

    if (rows.length === 0) return c.json({ error: 'Question not found' }, 404);
    const r = rows[0];
    const choices = (r.choices || []).map((ch, i) => ({
      id: String(ch.id || ch.choice_id || i + 1),
      choice_id: String(ch.id || ch.choice_id || i + 1),
      choice_key: ch.choice_key || `c_${i + 1}`,
      label: ch.label || String(i + 1),
      text_markup: ch.text_markup || ch.text || '',
      text: ch.text_markup || ch.text || ''
    }));

    return c.json({
      id: r.id,
      question_id: r.id,
      external_id: r.external_id,
      level: r.level,
      format_code: r.format_code,
      category: r.category,
      prompt_markup: r.stem_markup,
      stem_markup: r.stem_markup,
      choices,
      answer: r.answer || null,
      canonical_choice_id: r.answer?.choice_id ? String(r.answer.choice_id) : null,
      explanation: r.explanation || null,
      explanation_markup: r.explanation?.summary_text || r.explanation?.correct_choice_analysis || r.answer?.rationale_markup || null,
      verification_status: 'verified'
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch question' }, 500);
  }
});

app.get('/api/study/v1/bank/questions/:id/provenance', async (c) => {
  const rawId = c.req.param('id');
  const numId = parseInt(rawId, 10);
  try {
    const rows = await queryNeon(c, `
      SELECT q.id, q.external_id, qr.stem_markup, qr.payload_json
      FROM question q
      JOIN question_revision qr ON q.current_revision_id = qr.id
      WHERE q.id = $1 OR q.external_id = $2
      LIMIT 1
    `, [Number.isFinite(numId) ? numId : -1, rawId]);
    if (rows.length === 0) return c.json({ error: 'Provenance not found' }, 404);
    const r = rows[0];
    return c.json({
      question_id: r.id,
      external_id: r.external_id,
      source_page: 1,
      source_line: null,
      raw_source_text: r.stem_markup
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch provenance' }, 500);
  }
});

app.get('/api/study/v1/history/incorrect', (c) => {
  return c.json({ items: [], total: 0 });
});

app.get('/api/study/v1/analytics/weak-areas', (c) => {
  return c.json({ weak_areas: [], recommended_drills: [] });
});

// Practice Session Lifecycle Endpoints
app.post('/api/study/v1/practice/sessions', async (c) => {
  let body = {};
  try { body = await c.req.json(); } catch {}
  const rawLevel = (body.level || 'N4').trim().toUpperCase();
  const formatCode = body.format_code || null;
  const category = body.category && body.category !== 'all' ? body.category : null;
  const count = Math.min(Math.max(1, parseInt(body.question_count || '10', 10)), 50);
  const sessionId = `prac_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  try {
    let whereClause = '($1::text IS NULL OR q.level = $1)';
    const params = [rawLevel === 'ALL' ? null : rawLevel];

    if (formatCode && formatCode !== 'all') {
      params.push(formatCode);
      whereClause += ` AND q.format_code = $${params.length}`;
    }
    if (category && category !== 'all') {
      params.push(category);
      whereClause += ` AND q.category = $${params.length}`;
    }
    params.push(count);

    const sql = `
      SELECT q.id, q.external_id, q.format_code, q.level, q.category,
             qr.stem_markup, qr.payload_json,
             (SELECT json_agg(json_build_object('id', rc.id, 'choice_id', rc.id, 'choice_key', rc.choice_key, 'label', rc.label, 'text_markup', rc.text_markup, 'text', rc.text_markup, 'ordinal', rc.ordinal) ORDER BY rc.ordinal)
              FROM revision_choice rc WHERE rc.question_revision_id = qr.id) as choices,
             (SELECT json_build_object('choice_id', ra.choice_id, 'rationale_markup', ra.rationale_markup)
              FROM revision_answer ra WHERE ra.question_revision_id = qr.id) as answer,
             (SELECT json_build_object('summary_text', qe.summary_text, 'correct_choice_analysis', qe.correct_choice_analysis)
              FROM question_explanation qe WHERE qe.question_id = q.id LIMIT 1) as explanation
      FROM question q
      JOIN question_revision qr ON q.current_revision_id = qr.id
      WHERE ${whereClause}
      ORDER BY RANDOM() LIMIT $${params.length}
    `;

    const rows = await queryNeon(c, sql, params);

    const sessionItems = [];
    const clientItems = [];

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const attemptItemId = `item_${r.id}_${idx + 1}`;
      const choices = (r.choices || []).map((ch, i) => ({
        id: String(ch.id || ch.choice_id || i + 1),
        choice_id: String(ch.id || ch.choice_id || i + 1),
        choice_key: ch.choice_key || `c_${i + 1}`,
        label: ch.label || String(i + 1),
        text_markup: ch.text_markup || ch.text || '',
        text: ch.text_markup || ch.text || '',
        ordinal: ch.ordinal || (i + 1)
      }));

      const correctChoiceId = r.answer?.choice_id ? String(r.answer.choice_id) : (choices[0]?.choice_id || '1');
      const explanationText = r.explanation?.summary_text || r.explanation?.correct_choice_analysis || r.answer?.rationale_markup || '';

      sessionItems.push({
        attempt_item_id: attemptItemId,
        question_id: r.id,
        format_code: r.format_code,
        level: r.level,
        category: r.category,
        stem_markup: r.stem_markup,
        choices,
        correct_choice_id: correctChoiceId,
        explanation_markup: explanationText,
        answered: false,
        is_correct: null
      });

      clientItems.push({
        id: r.id,
        question_id: r.id,
        external_id: r.external_id,
        attempt_item_id: attemptItemId,
        position: idx + 1,
        format_code: r.format_code,
        level: r.level,
        category: r.category,
        prompt_markup: r.stem_markup,
        stem_markup: r.stem_markup,
        prompt_html: null,
        choices,
        verification_status: 'verified'
      });
    }

    const sessObj = {
      session_id: sessionId,
      external_id: sessionId,
      session_type: body.session_type || 'practice',
      status: 'active',
      level: rawLevel,
      category: category,
      format_code: formatCode,
      total_questions: clientItems.length,
      answered_count: 0,
      correct_count: 0,
      started_at: new Date().toISOString(),
      items: sessionItems
    };

    practiceSessions.set(sessionId, sessObj);

    if (practiceSessions.size > 200) {
      const firstKey = practiceSessions.keys().next().value;
      practiceSessions.delete(firstKey);
    }

    // Persist practice session to Neon database for multi-isolate edge durability
    try {
      await queryNeon(c, `
        INSERT INTO practice_sessions (session_id, external_id, session_type, status, level, category, format_code, total_questions, answered_count, correct_count, started_at, data_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (session_id) DO UPDATE SET
          status = EXCLUDED.status,
          answered_count = EXCLUDED.answered_count,
          correct_count = EXCLUDED.correct_count,
          data_json = EXCLUDED.data_json
      `, [
        sessionId,
        sessionId,
        sessObj.session_type,
        sessObj.status,
        sessObj.level,
        sessObj.category,
        sessObj.format_code,
        sessObj.total_questions,
        sessObj.answered_count,
        sessObj.correct_count,
        sessObj.started_at,
        JSON.stringify({ items: sessionItems })
      ]);
    } catch (dbErr) {
      console.warn('[Worker] Failed to persist practice session to Neon:', dbErr.message);
    }

    return c.json({
      session_id: sessionId,
      external_id: sessionId,
      session_type: body.session_type || 'practice',
      status: 'active',
      level: rawLevel,
      category: category,
      format_code: formatCode,
      total_questions: clientItems.length,
      answered_count: 0,
      started_at: new Date().toISOString(),
      items: clientItems
    }, 201);
  } catch (err) {
    console.warn('[Worker] Practice session creation error:', err.message);
    return c.json({ error: 'Failed to create practice session', detail: err.message }, 500);
  }
});

async function getOrFetchPracticeSession(c, sessionId) {
  let sess = practiceSessions.get(sessionId);
  if (!sess) {
    try {
      const rows = await queryNeon(c, 'SELECT session_id, external_id, session_type, status, level, category, format_code, total_questions, answered_count, correct_count, started_at, data_json FROM practice_sessions WHERE session_id = $1 LIMIT 1', [sessionId]);
      if (rows && rows.length > 0) {
        const r = rows[0];
        let data = {};
        try { data = typeof r.data_json === 'string' ? JSON.parse(r.data_json) : (r.data_json || {}); } catch (_) {}
        sess = {
          session_id: r.session_id,
          external_id: r.external_id,
          session_type: r.session_type || 'practice',
          status: r.status || 'active',
          level: r.level,
          category: r.category,
          format_code: r.format_code,
          total_questions: r.total_questions || 0,
          answered_count: r.answered_count || 0,
          correct_count: r.correct_count || 0,
          started_at: r.started_at,
          items: data.items || []
        };
        practiceSessions.set(sessionId, sess);
      }
    } catch (err) {
      console.warn('[Worker] Failed to fetch session from Neon:', err.message);
    }
  }
  return sess;
}

app.get('/api/study/v1/practice/sessions/:id', async (c) => {
  const sessionId = c.req.param('id');
  const sess = await getOrFetchPracticeSession(c, sessionId);
  if (!sess) return c.json({ error: 'Practice session not found' }, 404);
  return c.json({
    session_id: sess.session_id,
    external_id: sess.external_id,
    status: sess.status,
    level: sess.level,
    category: sess.category,
    format_code: sess.format_code,
    total_questions: sess.total_questions,
    answered_count: sess.answered_count,
    started_at: sess.started_at,
    items: sess.items.map(it => ({
      attempt_item_id: it.attempt_item_id,
      question_id: it.question_id,
      format_code: it.format_code,
      level: it.level,
      category: it.category,
      prompt_markup: it.stem_markup,
      choices: it.choices,
      verification_status: 'verified'
    }))
  });
});

async function handlePracticeAnswer(c) {
  const sessionId = c.req.param('id');
  const sess = await getOrFetchPracticeSession(c, sessionId);
  let body = {};
  try { body = await c.req.json(); } catch {}
  const attemptItemId = body.attempt_item_id;
  const selectedChoiceId = String(body.selected_choice_id || '');

  let item = null;
  if (sess) {
    item = sess.items.find(it => it.attempt_item_id === attemptItemId || String(it.question_id) === String(attemptItemId));
  }

  let isCorrect = false;
  let canonicalId = '1';
  let explanation = '';

  if (item) {
    canonicalId = String(item.correct_choice_id);
    isCorrect = selectedChoiceId === canonicalId;
    explanation = item.explanation_markup || '';
    if (!item.answered) {
      item.answered = true;
      item.is_correct = isCorrect;
      sess.answered_count += 1;
      if (isCorrect) sess.correct_count += 1;
      // Persist update to Neon
      queryNeon(c, `
        UPDATE practice_sessions
        SET answered_count = $1, correct_count = $2, data_json = $3
        WHERE session_id = $4
      `, [sess.answered_count, sess.correct_count, JSON.stringify({ items: sess.items }), sessionId]).catch(err => {
        console.warn('[Worker] Failed to update session in Neon:', err.message);
      });
    }
  } else {
    try {
      const qId = parseInt(String(attemptItemId).replace(/\D/g, ''), 10);
      if (qId) {
        const rows = await queryNeon(c, `
          SELECT ra.choice_id, qe.summary_text, qe.correct_choice_analysis
          FROM question q
          JOIN question_revision qr ON q.current_revision_id = qr.id
          LEFT JOIN revision_answer ra ON ra.question_revision_id = qr.id
          LEFT JOIN question_explanation qe ON qe.question_id = q.id
          WHERE q.id = $1 LIMIT 1
        `, [qId]);
        if (rows.length > 0) {
          canonicalId = String(rows[0].choice_id || '1');
          isCorrect = selectedChoiceId === canonicalId;
          explanation = rows[0].summary_text || rows[0].correct_choice_analysis || '';
        }
      }
    } catch (_) {}
  }

  return c.json({
    session_id: sessionId,
    attempt_item_id: attemptItemId,
    is_correct: isCorrect,
    canonical_choice_id: canonicalId,
    explanation_markup: explanation || 'Explanation recorded in study database.'
  });
}

app.post('/api/study/v1/practice/sessions/:id/answer', handlePracticeAnswer);
app.post('/api/study/v1/practice/sessions/:id/answers', handlePracticeAnswer);

app.post('/api/study/v1/practice/sessions/:id/complete', async (c) => {
  const sessionId = c.req.param('id');
  const sess = await getOrFetchPracticeSession(c, sessionId);
  if (sess) {
    sess.status = 'completed';
    queryNeon(c, `
      UPDATE practice_sessions
      SET status = 'completed', completed_at = NOW()
      WHERE session_id = $1
    `, [sessionId]).catch(err => console.warn('[Worker] Session complete Neon error:', err.message));
  }
  return c.json({
    session_id: sessionId,
    status: 'completed',
    total_questions: sess?.total_questions || 0,
    answered_count: sess?.answered_count || 0,
    correct_count: sess?.correct_count || 0,
    completed_at: new Date().toISOString()
  });
});

app.post('/api/study/v1/practice/sessions/:id/feedback', (c) => {
  return c.json({ ok: true, recorded: true });
});

app.post('/api/study/v1/practice/sessions/:id/abandon', async (c) => {
  const sessionId = c.req.param('id');
  practiceSessions.delete(sessionId);
  queryNeon(c, `
    UPDATE practice_sessions
    SET status = 'abandoned'
    WHERE session_id = $1
  `, [sessionId]).catch(err => console.warn('[Worker] Session abandon Neon error:', err.message));
  return c.json({ ok: true, status: 'abandoned' });
});

// ---------------------------------------------------------------------------
// Study Modes (Sentence Scramble & Audio Shadowing) Handlers
// ---------------------------------------------------------------------------
const burstSessions = new Map();

const KEY_PARTICLES_MAP = {
  'は': 'topic particle',
  'が': 'subject particle',
  'を': 'object particle',
  'に': 'target / location particle',
  'で': 'means / context particle',
  'へ': 'direction particle',
  'と': 'with / and particle',
  'から': 'from / because particle',
  'まで': 'until / up to particle',
  'も': 'also / too particle'
};

function splitSentenceIntoScrambleTiles(sentence) {
  const clean = sentence.trim().replace(/[。！？\s]+$/, '');
  const tokens = [];
  let remaining = clean;
  let pos = 0;
  const particleRegex = /^(から|まで|は|が|を|に|で|へ|と|も)/;

  while (remaining.length > 0) {
    const pMatch = remaining.match(particleRegex);
    if (pMatch && tokens.length > 0) {
      const p = pMatch[1];
      tokens.push({
        tile_id: `t_${pos++}`,
        surface: p,
        role: 'particle',
        hint: KEY_PARTICLES_MAP[p] || 'particle'
      });
      remaining = remaining.slice(p.length);
      continue;
    }

    let wordLen = 1;
    while (wordLen < remaining.length) {
      const nextSlice = remaining.slice(wordLen);
      if (particleRegex.test(nextSlice) || /^[、。！？\s]/.test(nextSlice)) {
        break;
      }
      wordLen++;
    }
    const word = remaining.slice(0, wordLen).replace(/^[、\s]+|[、\s]+$/g, '');
    if (word) {
      tokens.push({
        tile_id: `t_${pos++}`,
        surface: word,
        role: 'word',
        hint: ''
      });
    }
    remaining = remaining.slice(wordLen).replace(/^[、\s]+/, '');
  }

  if (tokens.length >= 3) {
    return tokens;
  }

  const teMatch = clean.match(/^(.+?[てで])(.+)$/);
  if (teMatch) {
    return [
      { tile_id: 't_0', surface: teMatch[1], role: 'word', hint: '' },
      { tile_id: 't_1', surface: teMatch[2], role: 'word', hint: '' }
    ];
  }

  const mid = Math.ceil(clean.length / 2);
  return [
    { tile_id: 't_0', surface: clean.slice(0, mid), role: 'word', hint: '' },
    { tile_id: 't_1', surface: clean.slice(mid), role: 'word', hint: '' }
  ];
}

function getWeeklyConsistencyHelper() {
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    days.push({
      date: d.toISOString().slice(0, 10),
      sessions_completed: 0,
      items_reviewed: 0
    });
  }
  return {
    status: 'ok',
    days,
    active_days: 0,
    window_days: 7,
    total_bursts_7d: 0,
    total_items_7d: 0
  };
}

app.post('/api/study-modes/sessions', async (c) => {
  let body = {};
  try { body = await c.req.json(); } catch (_) { body = {}; }
  const mode = body.mode === 'audio_shadowing' ? 'audio_shadowing' : 'sentence_scramble';
  const targetCount = [5, 10].includes(body.target_count) ? body.target_count : 5;

  try {
    const rows = await queryNeon(
      c,
      `SELECT word, reading, meanings, examples
       FROM jlpt_vocab
       WHERE examples IS NOT NULL AND length(examples) > 15
       ORDER BY RANDOM() LIMIT 30`
    );

    const candidates = [];
    for (const r of rows) {
      let exList = [];
      try {
        exList = typeof r.examples === 'string' ? JSON.parse(r.examples) : (r.examples || []);
      } catch (_) {}
      if (Array.isArray(exList) && exList.length > 0) {
        for (const ex of exList) {
          if (ex.ja && ex.en && ex.ja.length >= 4 && ex.ja.length <= 40) {
            candidates.push({
              word: r.word,
              reading: r.reading,
              ja: ex.ja,
              en: ex.en
            });
            break;
          }
        }
      }
      if (candidates.length >= targetCount) break;
    }

    if (candidates.length === 0) {
      return c.json({
        session_id: null,
        mode,
        target_count: targetCount,
        status: 'empty',
        items: [],
        message: 'No study items available.'
      });
    }

    const sessionId = `burst_${crypto.randomUUID().slice(0, 10)}`;
    const sessionItems = [];
    const publicItems = [];

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (mode === 'sentence_scramble') {
        const tiles = splitSentenceIntoScrambleTiles(cand.ja);
        const expectedOrder = tiles.map(t => t.tile_id);
        const shuffled = [...tiles].sort(() => Math.random() - 0.5);

        sessionItems.push({
          item_index: i,
          expected_sentence: cand.ja,
          english_gloss: cand.en,
          expected_order: expectedOrder,
          tiles: tiles
        });

        publicItems.push({
          item_index: i,
          mode: 'sentence_scramble',
          tiles: shuffled,
          english_gloss: cand.en,
          expected_sentence: cand.ja
        });
      } else {
        // audio_shadowing
        const kanjiChars = [...new Set(cand.ja.match(/[\u4e00-\u9faf]/g) || [])];
        let kanjiBreakdown = [];
        if (kanjiChars.length > 0) {
          try {
            const kRows = await queryNeon(
              c,
              'SELECT character, level, meanings, onyomi, kunyomi FROM jlpt_kanji WHERE character = ANY($1)',
              [kanjiChars]
            );
            kanjiBreakdown = kRows.map(k => {
              let m = k.meanings;
              try { if (typeof m === 'string' && m.startsWith('[')) m = JSON.parse(m); } catch (_) {}
              let on = k.onyomi;
              try { if (typeof on === 'string' && on.startsWith('[')) on = JSON.parse(on); } catch (_) {}
              let kun = k.kunyomi;
              try { if (typeof kun === 'string' && kun.startsWith('[')) kun = JSON.parse(kun); } catch (_) {}
              return {
                character: k.character,
                level: k.level,
                meanings: Array.isArray(m) ? m : [m].filter(Boolean),
                onyomi: Array.isArray(on) ? on : [on].filter(Boolean),
                kunyomi: Array.isArray(kun) ? kun : [kun].filter(Boolean)
              };
            });
          } catch (_) {}
        }

        sessionItems.push({
          item_index: i,
          transcript: cand.ja,
          reading: cand.reading,
          english_gloss: cand.en,
          audio_url: null,
          kanji_breakdown: kanjiBreakdown
        });

        publicItems.push({
          item_index: i,
          mode: 'audio_shadowing',
          audio_url: null,
          has_audio: false,
          revealed: false
        });
      }
    }

    burstSessions.set(sessionId, {
      session_id: sessionId,
      mode,
      target_count: targetCount,
      status: 'active',
      items: sessionItems,
      public_items: publicItems,
      attempts: [],
      correct_count: 0,
      created_at: new Date().toISOString()
    });

    if (burstSessions.size > 500) {
      const oldestKey = burstSessions.keys().next().value;
      burstSessions.delete(oldestKey);
    }

    return c.json({
      session_id: sessionId,
      mode,
      target_count: targetCount,
      status: 'active',
      correct_count: 0,
      total_count: sessionItems.length,
      created_at: new Date().toISOString(),
      completed_at: null,
      items: publicItems,
      attempts: []
    });
  } catch (err) {
    console.warn('[Worker] Start burst session error:', err.message);
    return c.json({ error: 'Failed to start burst session', detail: err.message }, 500);
  }
});

app.get('/api/study-modes/sessions/:id', (c) => {
  const sessionId = c.req.param('id');
  const sess = burstSessions.get(sessionId);
  if (!sess) {
    return c.json({ error: `Study burst session ${sessionId} not found.` }, 404);
  }
  return c.json({
    session_id: sess.session_id,
    mode: sess.mode,
    target_count: sess.target_count,
    status: sess.status,
    correct_count: sess.correct_count,
    total_count: sess.items.length,
    created_at: sess.created_at,
    completed_at: sess.completed_at || null,
    items: sess.public_items,
    attempts: sess.attempts
  });
});

app.post('/api/study-modes/sessions/:id/reveal', async (c) => {
  const sessionId = c.req.param('id');
  const sess = burstSessions.get(sessionId);
  if (!sess) {
    return c.json({ error: `Study burst session ${sessionId} not found.` }, 404);
  }
  let body = {};
  try { body = await c.req.json(); } catch (_) { body = {}; }
  const itemIndex = typeof body.item_index === 'number' ? body.item_index : 0;
  const item = sess.items[itemIndex];
  if (!item) {
    return c.json({ error: `Item index ${itemIndex} is out of range.` }, 400);
  }

  if (sess.mode === 'audio_shadowing') {
    return c.json({
      item_index: itemIndex,
      mode: 'audio_shadowing',
      revealed: true,
      transcript: item.transcript,
      reading: item.reading,
      english_gloss: item.english_gloss,
      kanji_breakdown: item.kanji_breakdown
    });
  }

  return c.json({
    item_index: itemIndex,
    mode: sess.mode,
    revealed: true,
    english_gloss: item.english_gloss || ''
  });
});

app.post('/api/study-modes/sessions/:id/answer', async (c) => {
  const sessionId = c.req.param('id');
  const sess = burstSessions.get(sessionId);
  if (!sess) {
    return c.json({ error: `Study burst session ${sessionId} not found.` }, 404);
  }
  let body = {};
  try { body = await c.req.json(); } catch (_) { body = {}; }
  const itemIndex = typeof body.item_index === 'number' ? body.item_index : 0;
  const item = sess.items[itemIndex];
  if (!item) {
    return c.json({ error: `Item index ${itemIndex} is out of range.` }, 400);
  }

  let isCorrect = false;
  let tileFeedback = [];

  if (sess.mode === 'sentence_scramble') {
    const userAnswer = Array.isArray(body.user_answer) ? body.user_answer.map(String) : [];
    const expected = (item.expected_order || []).map(String);
    isCorrect = expected.length > 0 && userAnswer.join(',') === expected.join(',');

    const tileById = new Map((item.tiles || []).map(t => [String(t.tile_id), t.surface]));
    const maxLen = Math.max(expected.length, userAnswer.length);
    for (let pos = 0; pos < maxLen; pos++) {
      const expId = expected[pos];
      const gotId = userAnswer[pos];
      const match = expId && gotId && expId === gotId;
      tileFeedback.push({
        position: pos,
        is_match: Boolean(match),
        expected_surface: tileById.get(expId) || '',
        submitted_surface: tileById.get(gotId) || ''
      });
    }
  } else {
    // audio_shadowing
    isCorrect = body.user_answer === 'got_it' || body.user_answer === true;
  }

  sess.attempts.push({
    item_index: itemIndex,
    is_correct: isCorrect,
    user_answer: body.user_answer,
    answered_at: new Date().toISOString()
  });

  if (isCorrect) {
    sess.correct_count = (sess.correct_count || 0) + 1;
  }

  return c.json({
    session_id: sessionId,
    item_index: itemIndex,
    mode: sess.mode,
    is_correct: isCorrect,
    expected_sentence: item.expected_sentence || item.transcript || '',
    english_gloss: item.english_gloss || '',
    tile_feedback: tileFeedback,
    correct_count: sess.correct_count,
    total_count: sess.items.length
  });
});

app.post('/api/study-modes/sessions/:id/complete', (c) => {
  const sessionId = c.req.param('id');
  const sess = burstSessions.get(sessionId);
  if (!sess) {
    return c.json({ error: `Study burst session ${sessionId} not found.` }, 404);
  }
  sess.status = 'completed';
  sess.completed_at = new Date().toISOString();

  const total = sess.items.length || 1;
  const accuracy = Math.round(((sess.correct_count || 0) / total) * 100);
  const consistency = getWeeklyConsistencyHelper();
  consistency.total_bursts_7d = 1;
  consistency.active_days = 1;
  if (consistency.days.length > 0) {
    consistency.days[consistency.days.length - 1].sessions_completed = 1;
    consistency.days[consistency.days.length - 1].items_reviewed = total;
  }

  return c.json({
    session_id: sessionId,
    mode: sess.mode,
    target_count: sess.target_count,
    status: 'completed',
    correct_count: sess.correct_count || 0,
    attempted_count: sess.attempts.length,
    total_count: total,
    accuracy_percent: accuracy,
    completed_at: sess.completed_at,
    consistency
  });
});

app.get('/api/study-modes/consistency', (c) => {
  return c.json(getWeeklyConsistencyHelper());
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
  if (!auth.authenticated && c.env?.ENVIRONMENT === 'production') {
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  }
  if (auth.user?.is_service) {
    return c.json({ error: 'Forbidden', message: 'Service credentials cannot access learner study data' }, 403);
  }

  let body = {};
  try {
    body = await c.req.json();
  } catch {}

  const attemptId = `att_${crypto.randomUUID().slice(0, 12)}`;
  const level = body.level || 'N3';
  const userId = auth.authenticated
    ? (auth.user?.sub || 'user_anon')
    : (c.env?.ENVIRONMENT !== 'production' ? (body.user_id || 'dev_user') : null);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const nowIso = new Date().toISOString();

  const insertRes = await queryTurso(
    c,
    'INSERT INTO test_attempt (id, user_id, level, started_at) VALUES (?, ?, ?, ?)',
    [attemptId, userId, level, nowIso]
  ).catch(err => {
    console.warn('[Study] Attempt record error:', err.message);
    return null;
  });

  const isProd = c.env?.ENVIRONMENT === 'production';
  const hasTurso = Boolean(c.env?.TURSO_DATABASE_URL && c.env?.TURSO_AUTH_TOKEN);
  if (!insertRes && (isProd || hasTurso)) {
    return c.json({ error: 'Database error', message: 'Failed to record test attempt' }, 500);
  }

  return c.json({ id: attemptId, user_id: userId, status: 'started', level, started_at: nowIso }, 201);
});

app.post('/api/study/v1/attempts/:id/responses', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated && c.env?.ENVIRONMENT === 'production') {
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  }
  if (auth.user?.is_service) {
    return c.json({ error: 'Forbidden', message: 'Service credentials cannot access learner study data' }, 403);
  }

  const attemptId = c.req.param('id');
  let body = {};
  try {
    body = await c.req.json();
  } catch {}

  const questionId = body.question_id || 0;
  const choiceId = body.choice_id || 0;
  const isCorrect = body.is_correct ? 1 : 0;
  const latencyMs = body.latency_ms || 0;
  const userId = auth.authenticated
    ? (auth.user?.sub || 'user_anon')
    : (c.env?.ENVIRONMENT !== 'production' ? (body.user_id || 'dev_user') : null);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Verify attempt ownership if record exists
  try {
    const attemptCheck = await queryTurso(c, 'SELECT user_id FROM test_attempt WHERE id = ?', [attemptId]);
    if (attemptCheck?.rows?.length > 0) {
      const ownerId = attemptCheck.rows[0][0]?.value ?? attemptCheck.rows[0][0];
      if (!ownerId || ownerId !== userId) {
        return c.json({ error: 'Forbidden', message: 'Attempt does not belong to user' }, 403);
      }
    }
  } catch (_) {}

  const respInsert = await queryTurso(
    c,
    'INSERT INTO response (attempt_id, user_id, question_id, choice_id, is_correct, latency_ms) VALUES (?, ?, ?, ?, ?, ?)',
    [attemptId, userId, questionId, choiceId, isCorrect, latencyMs]
  ).catch(err => {
    console.warn('[Study] Response record error:', err.message);
    return null;
  });

  if (!respInsert && (c.env?.ENVIRONMENT === 'production' || Boolean(c.env?.TURSO_DATABASE_URL && c.env?.TURSO_AUTH_TOKEN))) {
    return c.json({ error: 'Database error', message: 'Failed to record attempt response' }, 500);
  }

  return c.json({ status: 'recorded', attempt_id: attemptId });
});

app.get('/api/study/v1/bookmarks', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated && c.env?.ENVIRONMENT === 'production') {
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  }
  if (auth.user?.is_service) {
    return c.json({ error: 'Forbidden', message: 'Service credentials cannot access learner study data' }, 403);
  }

  const userId = auth.authenticated
    ? (auth.user?.sub || 'user_anon')
    : (c.env?.ENVIRONMENT !== 'production' ? (c.req.query('user_id') || 'dev_user') : null);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const res = await queryTurso(
      c,
      'SELECT question_id, created_at FROM question_bookmark WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    const rows = res?.rows || [];
    return c.json({ bookmarks: rows.map(r => ({ question_id: r[0]?.value, created_at: r[1]?.value })) });
  } catch (err) {
    return c.json({ bookmarks: [] });
  }
});

app.post('/api/study/v1/bookmarks', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated && c.env?.ENVIRONMENT === 'production') {
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  }
  if (auth.user?.is_service) {
    return c.json({ error: 'Forbidden', message: 'Service credentials cannot access learner study data' }, 403);
  }

  let body = {};
  try {
    body = await c.req.json();
  } catch {}
  const qId = body.question_id;
  if (!qId) return c.json({ error: 'Missing question_id' }, 400);

  const userId = auth.authenticated
    ? (auth.user?.sub || 'user_anon')
    : (c.env?.ENVIRONMENT !== 'production' ? (body.user_id || 'dev_user') : null);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const nowIso = new Date().toISOString();
  await queryTurso(
    c,
    'INSERT INTO question_bookmark (user_id, question_id, created_at) VALUES (?, ?, ?) ON CONFLICT (user_id, question_id) DO NOTHING',
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
  if (!auth.authenticated && c.env?.ENVIRONMENT === 'production') {
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  }

  // 1. Direct Turso query if configured
  if (c.env?.TURSO_DATABASE_URL && c.env?.TURSO_AUTH_TOKEN) {
    try {
      const userId = auth.user?.sub || 'default_user';
      const tursoHttpUrl = c.env.TURSO_DATABASE_URL.replace('libsql://', 'https://').replace(/\/$/, '') + '/v2/pipeline';
      const sqlQuery = {
        requests: [
          { type: 'execute', stmt: { sql: "SELECT count(*) as count FROM user_op_log WHERE user_id = ? AND ack = 0 AND (lease_expires_at IS NULL OR lease_expires_at < datetime('now'))", args: [{ type: 'text', value: userId }] } },
          { type: 'execute', stmt: { sql: "SELECT count(*) as count FROM user_op_log WHERE user_id = ? AND ack = 0 AND lease_expires_at >= datetime('now')", args: [{ type: 'text', value: userId }] } },
          { type: 'execute', stmt: { sql: "SELECT count(*) as count FROM user_op_log WHERE user_id = ? AND ack = 1", args: [{ type: 'text', value: userId }] } },
          { type: 'execute', stmt: { sql: "SELECT count(*) as count FROM user_op_log WHERE user_id = ? AND error != ''", args: [{ type: 'text', value: userId }] } },
          { type: 'execute', stmt: { sql: "SELECT id, payload, attempts, created_at, ack, error FROM user_op_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 10", args: [{ type: 'text', value: userId }] } }
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
    const isDev = c.env?.ENVIRONMENT !== 'production';
    if (!isDev) {
      return c.json({ error: 'Unauthorized', message: 'Valid session cookie or Bearer token required' }, 401);
    }
  }
  const userId = auth.authenticated ? (auth.user?.sub || 'api-client') : 'dev_user';

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

  if (rawItems.length > 100) {
    return c.json({ error: 'Payload Too Large', message: 'Maximum 100 items per batch' }, 413);
  }

  const items = rawItems;
  const nowIso = new Date().toISOString();
  const createdIds = [];

  if (c.env?.TURSO_DATABASE_URL && c.env?.TURSO_AUTH_TOKEN) {
    try {
      const tursoHttpUrl = c.env.TURSO_DATABASE_URL.replace('libsql://', 'https://').replace(/\/$/, '') + '/v2/pipeline';

      // Verify immutable operation semantics (Finding S2)
      for (const item of items) {
        if (item.id) {
          const existingRes = await queryTurso(c, `SELECT payload FROM user_op_log WHERE user_id = ? AND id = ?`, [userId, item.id]);
          if (existingRes?.rows?.length > 0) {
            const existingPayload = existingRes.rows[0][0]?.value ?? existingRes.rows[0][0];
            let itemPayloadStr = '';
            if (typeof item.payload === 'string') itemPayloadStr = item.payload;
            else if (item.payload && typeof item.payload === 'object') itemPayloadStr = JSON.stringify(item.payload);
            else itemPayloadStr = JSON.stringify(item);

            if (existingPayload !== itemPayloadStr) {
              return c.json({ error: 'Conflict', message: `Operation ${item.id} already exists with different payload` }, 409);
            }
          }
        }
      }

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
            sql: `INSERT INTO user_op_log (id, user_id, op_type, payload, ack, attempts, created_at)
                  VALUES (?, ?, 'card_save', ?, 0, 0, ?)
                  ON CONFLICT (user_id, id) DO NOTHING`,
            args: [
              { type: 'text', value: itemId },
              { type: 'text', value: userId },
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
        const data = await res.json().catch(() => null);
        const results = Array.isArray(data?.results) ? data.results : [];
        const hasErrors = results.some(r => r?.type === 'error' || r?.error);
        if (!hasErrors) {
          return c.json({ status: 'ok', count: items.length, ids: createdIds, source: 'turso_edge' }, 201);
        }
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
      headers: { 'Content-Type': 'application/json' },
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

// ---------------------------------------------------------------------------
// Multi-Tenant Sync Endpoints (Turso libSQL user_op_log)
// ---------------------------------------------------------------------------
async function handleSyncPush(c) {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  if (auth.user?.is_service) {
    return c.json({ error: 'Forbidden', message: 'Service credentials cannot sync personal user cards' }, 403);
  }
  const userId = auth.user?.sub || 'dev_user';

  const isProd = c.env?.ENVIRONMENT === 'production';
  const hasTursoConfig = Boolean(c.env?.TURSO_DATABASE_URL && c.env?.TURSO_AUTH_TOKEN);

  if (isProd && !hasTursoConfig) {
    return c.json({ error: 'Service Unavailable', message: 'Turso database is not configured' }, 503);
  }

  const contentLength = parseInt(c.req.header('content-length') || '0', 10);
  if (contentLength > 512 * 1024) {
    return c.json({ error: 'Payload Too Large', message: 'Maximum sync payload size is 512KB' }, 413);
  }

  let body = {};
  try { body = await c.req.json(); } catch {}
  const rawItems = Array.isArray(body)
    ? body
    : Array.isArray(body.ops)
      ? body.ops
      : Array.isArray(body.items)
        ? body.items
        : Array.isArray(body.cards)
          ? body.cards
          : [body];
  const items = rawItems.filter(Boolean);
  if (items.length > 100) {
    return c.json({ error: 'Payload Too Large', message: 'Maximum 100 items per sync push batch' }, 413);
  }
  const nowIso = new Date().toISOString();
  const pushDeviceId = c.req.query('device_id') || c.req.header('x-device-id') || null;
  const createdIds = [];
  const failedIds = [];

  await initTursoSchema(c);

  const statements = [];
  for (const it of items) {
    const itemId = it.id || `sync_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const opType = it.op_type || it.op || 'card_save';
    const itWithDevice = (pushDeviceId && typeof it === 'object' && !it.device_id)
      ? { ...it, device_id: pushDeviceId }
      : it;
    const payloadStr = typeof itWithDevice === 'string' ? itWithDevice : JSON.stringify(itWithDevice);
    statements.push({
      sql: `
        INSERT INTO user_op_log (id, user_id, op_type, payload, ack, attempts, created_at)
        VALUES (?, ?, ?, ?, 0, 0, ?)
        ON CONFLICT (user_id, id) DO UPDATE SET
          op_type = excluded.op_type,
          payload = excluded.payload,
          ack = 0,
          created_at = excluded.created_at
        WHERE json_extract(user_op_log.payload, '$.updated_at') IS NULL
           OR json_extract(excluded.payload, '$.updated_at') IS NULL
           OR json_extract(excluded.payload, '$.updated_at') >= json_extract(user_op_log.payload, '$.updated_at')
      `,
      args: [itemId, userId, opType, payloadStr, nowIso]
    });
    createdIds.push(itemId);
  }

  if (hasTursoConfig && statements.length > 0) {
    try {
      const txRes = await executeTursoTransaction(c, statements);
      if (txRes === null && (isProd || hasTursoConfig)) {
        return c.json({ error: 'Database write failed', failed: createdIds }, 500);
      }
    } catch (err) {
      console.warn('[SyncPush] Batched transaction failed:', err.message);
      return c.json({ error: 'Database write failed', failed: createdIds }, 500);
    }
  }

  if (items.length > 0 && createdIds.length === 0) {
    return c.json({ error: 'Database write failed', failed: failedIds }, 500);
  }

  return c.json({
    status: failedIds.length === 0 ? 'ok' : 'partial',
    pushed: createdIds.length,
    ids: createdIds,
    failed: failedIds,
    cursor: nowIso
  });
}

async function handleSyncPull(c) {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  if (auth.user?.is_service) {
    return c.json({ error: 'Forbidden', message: 'Service credentials cannot pull personal user cards' }, 403);
  }
  const userId = auth.user?.sub || 'dev_user';

  const sinceCursor = c.req.query('since_cursor') || c.req.query('cursor') || null;
  const callerDeviceId = c.req.query('device_id') || c.req.header('x-device-id') || null;
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10)), 500);

  try {
    await initTursoSchema(c);

    let sql = `
      SELECT id, op_type, payload, ack, created_at
      FROM user_op_log
      WHERE user_id = ?
    `;
    const params = [userId];

    let effectiveCursor = sinceCursor;
    if (effectiveCursor) {
      if (effectiveCursor.includes('|')) {
        const [cursorTime, cursorId] = effectiveCursor.split('|');
        sql += ` AND (created_at > ? OR (created_at = ? AND id > ?))`;
        params.push(cursorTime, cursorTime, cursorId);
      } else {
        sql += ` AND created_at > ?`;
        params.push(effectiveCursor);
      }
    }
    params.push(limit);
    sql += ` ORDER BY created_at ASC, id ASC LIMIT ?`;

    const res = await queryTurso(c, sql, params);
    const rows = res?.rows || [];

    const items = rows.map(r => {
      const id = r[0]?.value ?? r[0];
      const op_type = r[1]?.value ?? r[1];
      const payload_raw = r[2]?.value ?? r[2];
      const ack = r[3]?.value ?? r[3];
      const created_at = r[4]?.value ?? r[4];

      let payload = null;
      try { payload = typeof payload_raw === 'string' ? JSON.parse(payload_raw) : payload_raw; } catch (_) {}
      return {
        id,
        op_type,
        status: 'pending',
        expression: payload?.expression || payload?.term || '',
        reading: payload?.reading || '',
        meaning: payload?.meaning || '',
        sentence: payload?.sentence || '',
        sentence_meaning: payload?.sentence_meaning || '',
        deck_name: payload?.deck_name || 'Default',
        created_at,
        payload
      };
    });

    const activeItems = callerDeviceId
      ? items.filter(it => !it.payload?.device_id || it.payload.device_id !== callerDeviceId)
      : items;

    const newCursor = items.length > 0
      ? `${items[items.length - 1].created_at}|${items[items.length - 1].id}`
      : sinceCursor;

    return c.json({
      items: activeItems,
      count: activeItems.length,
      cursor: newCursor,
      has_more: items.length >= limit
    });
  } catch (err) {
    console.warn('[SyncPull] Error querying user_op_log:', err.message);
    return c.json({ items: [], count: 0, cursor: sinceCursor, has_more: false, error: err.message }, 500);
  }
}

async function handleSyncAck(c) {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  if (auth.user?.is_service) {
    return c.json({ error: 'Forbidden', message: 'Service credentials cannot acknowledge personal user sync items' }, 403);
  }
  const userId = auth.user?.sub || 'dev_user';

  let body = {};
  try { body = await c.req.json(); } catch {}
  const ids = Array.isArray(body) ? body : (Array.isArray(body.ids) ? body.ids : [body.id]);
  const validIds = ids.filter(Boolean);
  if (validIds.length > 100) {
    return c.json({ error: 'Payload Too Large', message: 'Maximum 100 ids per ack request' }, 413);
  }
  const nowIso = new Date().toISOString();

  let actuallyAcked = 0;
  if (validIds.length > 0) {
    const isProd = c.env?.ENVIRONMENT === 'production';
    const hasTurso = Boolean(c.env?.TURSO_DATABASE_URL && c.env?.TURSO_AUTH_TOKEN);
    if (isProd && !hasTurso) {
      return c.json({ error: 'Service Unavailable', message: 'Turso database is not configured' }, 503);
    }

    await initTursoSchema(c);
    if (hasTurso) {
      const statements = validIds.map(id => ({
        sql: `UPDATE user_op_log SET ack = 1, acked_at = ? WHERE user_id = ? AND id = ?`,
        args: [nowIso, userId, id]
      }));
      const txRes = await executeTursoTransaction(c, statements);
      if (Array.isArray(txRes)) {
        for (const r of txRes) {
          const resObj = r?.response?.result || r;
          const count = resObj?.affected_row_count ?? resObj?.rows_affected;
          if (typeof count === 'number') {
            actuallyAcked += count;
          }
        }
      }
    } else {
      actuallyAcked = validIds.length;
    }
  }

  return c.json({ status: 'ok', acked: actuallyAcked });
}

app.post('/api/sync/push', handleSyncPush);
app.post('/sync/push', handleSyncPush);
app.get('/api/sync/pull', handleSyncPull);
app.get('/sync/pull', handleSyncPull);
app.post('/api/sync/ack', handleSyncAck);
app.post('/sync/ack', handleSyncAck);

// ---------------------------------------------------------------------------
// Smart Per-User Progress Tracking (Pure References in Turso libSQL)
// ---------------------------------------------------------------------------
function mapTursoRows(res) {
  if (!res || !Array.isArray(res.rows) || !Array.isArray(res.cols)) return [];
  const colNames = res.cols.map(col => col.name);
  return res.rows.map(r => {
    const obj = {};
    for (let i = 0; i < colNames.length; i++) {
      const val = r[i]?.value !== undefined ? r[i].value : r[i];
      obj[colNames[i]] = val;
    }
    return obj;
  });
}

app.get('/api/user/progress/summary', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';
  await initTursoSchema(c);

  try {
    const [vocabRes, kanjiRes, grammarRes, animeRes, todayRes] = await Promise.all([
      queryTurso(c, `SELECT count(*) as total, sum(CASE WHEN state = 1 THEN 1 ELSE 0 END) as learning, sum(CASE WHEN state = 2 THEN 1 ELSE 0 END) as review FROM user_vocab_progress WHERE user_id = ?`, [userId]),
      queryTurso(c, `SELECT count(*) as seen, sum(CASE WHEN (mastery_flags & 8) != 0 THEN 1 ELSE 0 END) as mastered FROM user_kanji_progress WHERE user_id = ?`, [userId]),
      queryTurso(c, `SELECT count(*) as total FROM user_grammar_progress WHERE user_id = ?`, [userId]),
      queryTurso(c, `SELECT count(*) as episodes_watched FROM user_anime_progress WHERE user_id = ? AND completed = 1`, [userId]),
      queryTurso(c, `SELECT cards_reviewed, minutes_studied, cards_mined, again_count, good_count FROM user_daily_activity WHERE user_id = ? AND date = date('now')`, [userId])
    ]);

    const vocabRows = mapTursoRows(vocabRes);
    const kanjiRows = mapTursoRows(kanjiRes);
    const grammarRows = mapTursoRows(grammarRes);
    const animeRows = mapTursoRows(animeRes);
    const todayRows = mapTursoRows(todayRes);

    return c.json({
      ok: true,
      user_id: userId,
      summary: {
        vocab: {
          total: parseInt(vocabRows[0]?.total || 0, 10),
          learning: parseInt(vocabRows[0]?.learning || 0, 10),
          review: parseInt(vocabRows[0]?.review || 0, 10)
        },
        kanji: {
          seen: parseInt(kanjiRows[0]?.seen || 0, 10),
          mastered: parseInt(kanjiRows[0]?.mastered || 0, 10)
        },
        grammar: {
          total: parseInt(grammarRows[0]?.total || 0, 10)
        },
        anime: {
          episodes_watched: parseInt(animeRows[0]?.episodes_watched || 0, 10)
        },
        today: todayRows[0] || {
          cards_reviewed: 0,
          minutes_studied: 0,
          cards_mined: 0,
          again_count: 0,
          good_count: 0
        }
      }
    });
  } catch (err) {
    console.warn('[ProgressSummary] Error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get('/api/user/progress/vocab/due', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10)), 200);
  const nowSec = Math.floor(Date.now() / 1000);
  const hydrate = c.req.query('hydrate') === 'true';

  await initTursoSchema(c);

  try {
    const res = await queryTurso(c, `
      SELECT vocab_id, state, stability, difficulty, reps, lapses, last_review_at, due_at
      FROM user_vocab_progress
      WHERE user_id = ? AND due_at <= ?
      ORDER BY due_at ASC
      LIMIT ?
    `, [userId, nowSec, limit]);

    const cards = mapTursoRows(res);

    if (hydrate && cards.length > 0) {
      const vocabIds = cards.map(cd => parseInt(cd.vocab_id, 10)).filter(id => !isNaN(id));
      if (vocabIds.length > 0) {
        try {
          const neonRows = await queryNeon(c, `
            SELECT id as vocab_id, term, reading,
                   encode(content_blob, 'base64') as blob_base64,
                   rules, def_tags, score
            FROM terms
            WHERE id = ANY($1::bigint[])
          `, [vocabIds]);

          const neonMap = new Map((neonRows || []).map(r => [String(r.vocab_id || r.id), r]));
          for (const card of cards) {
            const canonical = neonMap.get(String(card.vocab_id));
            if (canonical) {
              card.expression = canonical.term || '';
              card.reading = canonical.reading || '';
              let meaningStr = '';
              try {
                if (canonical.blob_base64) {
                  const rawDefs = await decompressBlobBase64(canonical.blob_base64);
                  if (Array.isArray(rawDefs)) {
                    const glosses = [];
                    for (const d of rawDefs) {
                      const parsed = extractGlossesAndSenses(d);
                      for (const p of parsed) {
                        const g = p.glosses.join('; ');
                        if (g && !glosses.includes(g)) glosses.push(g);
                      }
                    }
                    meaningStr = glosses.join('; ');
                  }
                }
              } catch (_) {}
              card.meaning = meaningStr || canonical.term || '';
              card.rules = canonical.rules;
              card.def_tags = canonical.def_tags;
              card.score = canonical.score;
            }
          }
        } catch (neonErr) {
          console.warn('[ProgressVocabDue] Neon hydration fallback:', neonErr.message);
        }
      }
    }

    return c.json({
      ok: true,
      count: cards.length,
      due_cards: cards
    });
  } catch (err) {
    console.warn('[ProgressVocabDue] Error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post('/api/user/progress/sync', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  if (auth.user?.is_service) {
    return c.json({ error: 'Forbidden', message: 'Service credentials cannot sync personal user progress' }, 403);
  }
  const userId = auth.user?.sub || 'dev_user';
  let body = {};
  try { body = await c.req.json(); } catch (_) {}

  await initTursoSchema(c);

  const eventId = body.event_id || body.sync_id || null;
  if (eventId) {
    try {
      const existing = await queryTurso(c, `SELECT event_id FROM user_sync_events WHERE user_id = ? AND event_id = ?`, [userId, eventId]);
      if (existing?.rows?.length > 0) {
        return c.json({
          ok: true,
          user_id: userId,
          deduplicated: true,
          synced: { vocab: 0, kanji: 0, grammar: 0 }
        });
      }
    } catch (_) {}
  }

  const rawVocab = Array.isArray(body.vocab_reviews) ? body.vocab_reviews : [];
  const rawKanji = Array.isArray(body.kanji_practices) ? body.kanji_practices : [];
  const rawGrammar = Array.isArray(body.grammar_reviews) ? body.grammar_reviews : [];
  const daily = (body.daily && typeof body.daily === 'object') ? body.daily : null;

  // Bound array sizes to prevent DoS
  const vocabReviews = rawVocab.slice(0, 500);
  const kanjiPractices = rawKanji.slice(0, 500);
  const grammarReviews = rawGrammar.slice(0, 500);

  const statements = [];
  let vocabCount = 0;
  let kanjiCount = 0;
  let grammarCount = 0;

  for (const vr of vocabReviews) {
    const vId = parseInt(vr.vocab_id, 10);
    if (isNaN(vId) || vId <= 0) continue;
    statements.push({
      sql: `
        INSERT INTO user_vocab_progress (user_id, vocab_id, state, stability, difficulty, reps, lapses, last_review_at, due_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, vocab_id) DO UPDATE SET
          state = excluded.state,
          stability = excluded.stability,
          difficulty = excluded.difficulty,
          reps = excluded.reps,
          lapses = excluded.lapses,
          last_review_at = excluded.last_review_at,
          due_at = excluded.due_at
        WHERE excluded.last_review_at >= user_vocab_progress.last_review_at
      `,
      args: [
        userId,
        vId,
        parseInt(vr.state || 0, 10),
        parseFloat(vr.stability || 0.0),
        parseFloat(vr.difficulty || 0.0),
        parseInt(vr.reps || 0, 10),
        parseInt(vr.lapses || 0, 10),
        vr.last_review_at ? parseInt(vr.last_review_at, 10) : Math.floor(Date.now() / 1000),
        parseInt(vr.due_at || 0, 10)
      ]
    });
    vocabCount++;
  }

  for (const kp of kanjiPractices) {
    if (!kp.kanji_char) continue;
    const kanjiChar = [...String(kp.kanji_char)][0] || String(kp.kanji_char);
    const flags = kp.mastery_flags !== undefined ? parseInt(kp.mastery_flags, 10) : 1;
    const accuracy = kp.accuracy_percent !== undefined ? parseInt(kp.accuracy_percent, 10) : 100;
    const reviewCount = kp.review_count !== undefined ? parseInt(kp.review_count, 10) : 1;
    statements.push({
      sql: `
        INSERT INTO user_kanji_progress (user_id, kanji_char, mastery_flags, accuracy_percent, review_count, last_practiced_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, kanji_char) DO UPDATE SET
          mastery_flags = user_kanji_progress.mastery_flags | excluded.mastery_flags,
          accuracy_percent = excluded.accuracy_percent,
          review_count = user_kanji_progress.review_count + 1,
          last_practiced_at = excluded.last_practiced_at
      `,
      args: [
        userId,
        kanjiChar,
        flags,
        accuracy,
        reviewCount,
        kp.last_practiced_at ? parseInt(kp.last_practiced_at, 10) : Math.floor(Date.now() / 1000)
      ]
    });
    kanjiCount++;
  }

  for (const gr of grammarReviews) {
    if (!gr.point_id) continue;
    statements.push({
      sql: `
        INSERT INTO user_grammar_progress (user_id, point_id, mastery_level, consecutive_correct, last_studied_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (user_id, point_id) DO UPDATE SET
          mastery_level = excluded.mastery_level,
          consecutive_correct = excluded.consecutive_correct,
          last_studied_at = excluded.last_studied_at
      `,
      args: [
        userId,
        String(gr.point_id),
        parseInt(gr.mastery_level || 0, 10),
        parseInt(gr.consecutive_correct || 0, 10),
        gr.last_studied_at ? parseInt(gr.last_studied_at, 10) : Math.floor(Date.now() / 1000)
      ]
    });
    grammarCount++;
  }

  if (daily) {
    const today = daily.date || new Date().toISOString().slice(0, 10);
    statements.push({
      sql: `
        INSERT INTO user_daily_activity (user_id, date, cards_reviewed, minutes_studied, cards_mined, again_count, good_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, date) DO UPDATE SET
          cards_reviewed = user_daily_activity.cards_reviewed + excluded.cards_reviewed,
          minutes_studied = user_daily_activity.minutes_studied + excluded.minutes_studied,
          cards_mined = user_daily_activity.cards_mined + excluded.cards_mined,
          again_count = user_daily_activity.again_count + excluded.again_count,
          good_count = user_daily_activity.good_count + excluded.good_count
      `,
      args: [
        userId,
        today,
        parseInt(daily.cards_reviewed || 0, 10),
        parseFloat(daily.minutes_studied || 0.0),
        parseInt(daily.cards_mined || 0, 10),
        parseInt(daily.again_count || 0, 10),
        parseInt(daily.good_count || 0, 10)
      ]
    });
  }

  const resultObj = {
    ok: true,
    user_id: userId,
    synced: {
      vocab: vocabCount,
      kanji: kanjiCount,
      grammar: grammarCount
    }
  };

  if (eventId) {
    statements.push({
      sql: `INSERT INTO user_sync_events (user_id, event_id, created_at, result_json) VALUES (?, ?, ?, ?)`,
      args: [userId, eventId, Math.floor(Date.now() / 1000), JSON.stringify(resultObj)]
    });
  }

  const isProd = c.env?.ENVIRONMENT === 'production';
  const hasTurso = Boolean(c.env?.TURSO_DATABASE_URL && c.env?.TURSO_AUTH_TOKEN);
  if (isProd && !hasTurso) {
    return c.json({ ok: false, error: 'Database service unavailable' }, 503);
  }

  try {
    if (statements.length > 0) {
      const txRes = await executeTursoTransaction(c, statements);
      if (txRes === null && (isProd || hasTurso)) {
        return c.json({ ok: false, error: 'Database transaction failed' }, 500);
      }
    }
    return c.json(resultObj);
  } catch (err) {
    if (eventId && /UNIQUE|PRIMARYKEY|constraint/i.test(err.message)) {
      return c.json({
        ok: true,
        user_id: userId,
        deduplicated: true,
        synced: { vocab: 0, kanji: 0, grammar: 0 }
      });
    }
    console.warn('[ProgressSync] Atomic transaction failed:', err.message);
    return c.json({
      ok: false,
      error: 'Atomic sync transaction failed',
      detail: err.message,
      user_id: userId
    }, 500);
  }
});

app.post('/api/user/progress/anime', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';
  let body = {};
  try { body = await c.req.json(); } catch (_) {}

  const seriesId = String(body.series_id || '').trim();
  const episodeNumber = parseInt(body.episode_number || 1, 10);
  const lastPositionMs = Math.max(0, parseInt(body.last_position_ms || 0, 10));
  const durationMs = Math.max(0, parseInt(body.duration_ms || 0, 10));
  const completed = body.completed ? 1 : 0;
  const minedCardCount = parseInt(body.mined_card_count || 0, 10);
  const posterUrl = String(body.poster_url || body.posterUrl || '').trim();
  const seriesTitle = String(body.series_title || body.series || '').trim();
  const synopsis = String(body.synopsis || '').trim();
  const mediaType = String(body.media_type || 'anime').trim();
  const nowSec = Math.floor(Date.now() / 1000);

  if (!seriesId) {
    return c.json({ error: 'series_id is required' }, 400);
  }

  await initTursoSchema(c);

  try {
    await queryTurso(c, `
      INSERT INTO user_anime_progress (user_id, series_id, episode_number, last_position_ms, duration_ms, completed, mined_card_count, last_watched_at, poster_url, series_title, synopsis, media_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, series_id, episode_number) DO UPDATE SET
        last_position_ms = CASE WHEN excluded.last_position_ms > 0 THEN MAX(user_anime_progress.last_position_ms, excluded.last_position_ms) ELSE user_anime_progress.last_position_ms END,
        duration_ms = CASE WHEN excluded.duration_ms > 0 THEN MAX(user_anime_progress.duration_ms, excluded.duration_ms) ELSE user_anime_progress.duration_ms END,
        completed = MAX(user_anime_progress.completed, excluded.completed),
        mined_card_count = MAX(user_anime_progress.mined_card_count, excluded.mined_card_count),
        last_watched_at = excluded.last_watched_at,
        poster_url = CASE WHEN excluded.poster_url != '' THEN excluded.poster_url ELSE user_anime_progress.poster_url END,
        series_title = CASE WHEN excluded.series_title != '' THEN excluded.series_title ELSE user_anime_progress.series_title END,
        synopsis = CASE WHEN excluded.synopsis != '' THEN excluded.synopsis ELSE user_anime_progress.synopsis END,
        media_type = CASE WHEN excluded.media_type != '' THEN excluded.media_type ELSE user_anime_progress.media_type END
    `, [userId, seriesId, episodeNumber, lastPositionMs, durationMs, completed, minedCardCount, nowSec, posterUrl, seriesTitle, synopsis, mediaType]);

    return c.json({ ok: true, series_id: seriesId, episode_number: episodeNumber });
  } catch (err) {
    console.warn('[ProgressAnime] Upsert error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get('/api/user/progress/anime/:seriesId', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';
  const seriesId = c.req.param('seriesId');

  await initTursoSchema(c);

  try {
    const res = await queryTurso(c, `
      SELECT series_id, episode_number, last_position_ms, duration_ms, completed, mined_card_count, last_watched_at, poster_url, series_title, synopsis, media_type
      FROM user_anime_progress
      WHERE user_id = ? AND series_id = ?
      ORDER BY episode_number ASC
    `, [userId, seriesId]);

    const episodes = mapTursoRows(res);
    return c.json({ ok: true, series_id: seriesId, episodes });
  } catch (err) {
    console.warn('[ProgressAnime] Fetch error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Cloud Manga Storage & Per-User Reading Progress & In-Viewer Annotations
// ---------------------------------------------------------------------------
app.post('/api/user/progress/manga', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';
  const body = await c.req.json().catch(() => ({}));
  const mangaId = String(body.manga_id || body.book_id || '').trim();
  const chapterNumber = Number(body.chapter_number ?? 1.0);
  const pageNumber = Number(body.page_number ?? body.current_page ?? 1);
  const completed = body.completed ? 1 : 0;
  const minedCardCount = Number(body.mined_card_count ?? 0);
  const nowSec = Math.floor(Date.now() / 1000);

  if (!mangaId) {
    return c.json({ ok: false, error: 'Missing manga_id or book_id' }, 400);
  }

  await initTursoSchema(c);

  try {
    await queryTurso(c, `
      INSERT INTO user_manga_progress (user_id, manga_id, chapter_number, page_number, completed, mined_card_count, last_read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, manga_id, chapter_number) DO UPDATE SET
        page_number = excluded.page_number,
        completed = MAX(user_manga_progress.completed, excluded.completed),
        mined_card_count = MAX(user_manga_progress.mined_card_count, excluded.mined_card_count),
        last_read_at = excluded.last_read_at
    `, [userId, mangaId, chapterNumber, pageNumber, completed, minedCardCount, nowSec]);

    return c.json({ ok: true, manga_id: mangaId, page_number: pageNumber });
  } catch (err) {
    console.warn('[ProgressManga] Upsert error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get('/api/user/progress/manga/:mangaId', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';
  const mangaId = c.req.param('mangaId');

  await initTursoSchema(c);

  try {
    const res = await queryTurso(c, `
      SELECT manga_id, chapter_number, page_number, completed, mined_card_count, last_read_at
      FROM user_manga_progress
      WHERE user_id = ? AND manga_id = ?
      ORDER BY chapter_number ASC
    `, [userId, mangaId]);

    const progress = mapTursoRows(res);
    return c.json({ ok: true, manga_id: mangaId, progress });
  } catch (err) {
    console.warn('[ProgressManga] Fetch error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get('/api/user/progress/manga', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';

  await initTursoSchema(c);

  try {
    const res = await queryTurso(c, `
      SELECT manga_id, chapter_number, page_number, completed, mined_card_count, last_read_at
      FROM user_manga_progress
      WHERE user_id = ?
      ORDER BY last_read_at DESC
    `, [userId]);

    const progress = mapTursoRows(res);
    return c.json({ ok: true, progress });
  } catch (err) {
    console.warn('[ProgressManga] Fetch all error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// Cloud Manga Storage: Upload, List, Download, Delete
app.post('/api/user/manga/upload', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';
  const body = await c.req.json().catch(() => ({}));
  const bookId = String(body.book_id || body.id || '').trim();
  const title = String(body.title || 'Untitled Manga').trim();
  const filename = String(body.filename || `${bookId}.pdf`).trim();
  const fileType = String(body.file_type || (filename.endsWith('.cbz') ? 'cbz' : 'pdf')).trim();
  const size = Number(body.size || 0);
  const totalPages = Number(body.total_pages || 1);
  const fileData = body.file_data ? String(body.file_data) : '';
  const nowSec = Math.floor(Date.now() / 1000);

  if (!bookId) {
    return c.json({ ok: false, error: 'Missing book_id' }, 400);
  }

  await initTursoSchema(c);

  try {
    await queryTurso(c, `
      INSERT INTO user_manga_books (user_id, book_id, title, filename, file_type, size, total_pages, uploaded_at, file_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, book_id) DO UPDATE SET
        title = excluded.title,
        filename = excluded.filename,
        file_type = excluded.file_type,
        size = excluded.size,
        total_pages = excluded.total_pages,
        uploaded_at = excluded.uploaded_at,
        file_data = CASE WHEN excluded.file_data != '' THEN excluded.file_data ELSE user_manga_books.file_data END
    `, [userId, bookId, title, filename, fileType, size, totalPages, nowSec, fileData]);

    return c.json({ ok: true, book_id: bookId, size, uploaded_at: nowSec });
  } catch (err) {
    console.warn('[CloudManga] Upload error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get('/api/user/manga/list', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';

  await initTursoSchema(c);

  try {
    const res = await queryTurso(c, `
      SELECT b.book_id, b.title, b.filename, b.file_type, b.size, b.total_pages, b.uploaded_at,
             COALESCE(p.page_number, 1) as current_page,
             COALESCE(p.completed, 0) as completed,
             p.last_read_at
      FROM user_manga_books b
      LEFT JOIN user_manga_progress p ON b.user_id = p.user_id AND b.book_id = p.manga_id
      WHERE b.user_id = ?
      ORDER BY b.uploaded_at DESC
    `, [userId]);

    const books = mapTursoRows(res);
    return c.json({ ok: true, books });
  } catch (err) {
    console.warn('[CloudManga] List error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get('/api/user/manga/:bookId/file', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';
  const bookId = c.req.param('bookId');

  await initTursoSchema(c);

  try {
    const res = await queryTurso(c, `
      SELECT book_id, title, filename, file_type, size, total_pages, file_data
      FROM user_manga_books
      WHERE user_id = ? AND book_id = ?
    `, [userId, bookId]);

    const rows = mapTursoRows(res);
    if (!rows || rows.length === 0) {
      return c.json({ ok: false, error: 'Manga book not found in cloud' }, 404);
    }
    const book = rows[0];
    return c.json({
      ok: true,
      book_id: book.book_id,
      title: book.title,
      filename: book.filename,
      file_type: book.file_type,
      size: book.size,
      total_pages: book.total_pages,
      file_data: book.file_data
    });
  } catch (err) {
    console.warn('[CloudManga] File fetch error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.delete('/api/user/manga/:bookId', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';
  const bookId = c.req.param('bookId');

  await initTursoSchema(c);

  try {
    await queryTurso(c, `DELETE FROM user_manga_books WHERE user_id = ? AND book_id = ?`, [userId, bookId]);
    await queryTurso(c, `DELETE FROM user_manga_progress WHERE user_id = ? AND manga_id = ?`, [userId, bookId]);
    await queryTurso(c, `DELETE FROM user_manga_annotations WHERE user_id = ? AND book_id = ?`, [userId, bookId]);
    return c.json({ ok: true, deleted: true, book_id: bookId });
  } catch (err) {
    console.warn('[CloudManga] Delete error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// Cloud Manga Annotations
app.post('/api/user/manga/annotations', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';
  const body = await c.req.json().catch(() => ({}));
  const bookId = String(body.book_id || '').trim();
  const pageNumber = Number(body.page_number ?? 1);
  const dataJson = typeof body.data_json === 'string' ? body.data_json : JSON.stringify(body.data_json || body.strokes || []);
  const nowSec = Math.floor(Date.now() / 1000);

  if (!bookId) {
    return c.json({ ok: false, error: 'Missing book_id' }, 400);
  }

  await initTursoSchema(c);

  try {
    await queryTurso(c, `
      INSERT INTO user_manga_annotations (user_id, book_id, page_number, data_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, book_id, page_number) DO UPDATE SET
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `, [userId, bookId, pageNumber, dataJson, nowSec]);

    return c.json({ ok: true, book_id: bookId, page_number: pageNumber });
  } catch (err) {
    console.warn('[Annotations] Save error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get('/api/user/manga/annotations/:bookId', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';
  const bookId = c.req.param('bookId');
  const page = c.req.query('page');

  await initTursoSchema(c);

  try {
    let sql = `SELECT book_id, page_number, data_json, updated_at FROM user_manga_annotations WHERE user_id = ? AND book_id = ?`;
    const params = [userId, bookId];
    if (page !== undefined && page !== null) {
      sql += ` AND page_number = ?`;
      params.push(Number(page));
    }
    sql += ` ORDER BY page_number ASC`;

    const res = await queryTurso(c, sql, params);
    const annotations = mapTursoRows(res);
    return c.json({ ok: true, book_id: bookId, annotations });
  } catch (err) {
    console.warn('[Annotations] Fetch error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.delete('/api/user/manga/annotations/:bookId/:pageNum', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';
  const bookId = c.req.param('bookId');
  const pageNum = Number(c.req.param('pageNum'));

  await initTursoSchema(c);

  try {
    await queryTurso(c, `DELETE FROM user_manga_annotations WHERE user_id = ? AND book_id = ? AND page_number = ?`, [userId, bookId, pageNum]);
    return c.json({ ok: true, deleted: true, book_id: bookId, page_number: pageNum });
  } catch (err) {
    console.warn('[Annotations] Delete error:', err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// Cloud OCR Fallback / Proxy Endpoints
app.post('/api/ocr/recognize', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const backendUrl = c.env?.BACKEND_URL;
  if (backendUrl) {
    try {
      const resp = await fetch(`${backendUrl}/api/ocr/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      });
      if (resp.ok) return new Response(resp.body, { status: resp.status, headers: resp.headers });
    } catch (_) {}
  }
  return c.json({ text: '', confidence: 1.0, fallback: true });
});

app.post('/api/ocr/detect', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const backendUrl = c.env?.BACKEND_URL;
  if (backendUrl) {
    try {
      const resp = await fetch(`${backendUrl}/api/ocr/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      });
      if (resp.ok) return new Response(resp.body, { status: resp.status, headers: resp.headers });
    } catch (_) {}
  }
  return c.json({ boxes: [], fallback: true });
});

app.get('/api/ocr/status', async (c) => {
  return c.json({ status: 'ready', detector_available: true, recognizer_available: true, provider: 'cloud-edge' });
});

app.get('/api/oplog/lease', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated && c.env?.ENVIRONMENT === 'production') {
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

app.get('/api/anki/models', (c) => {
  return c.json({ models: [] });
});

const cloudSessionCache = [];
const cloudEpisodeCache = new Map();
const MAX_EPISODE_CACHE = 20;

function setEpisodeCache(hash, data) {
  if (cloudEpisodeCache.size >= MAX_EPISODE_CACHE && !cloudEpisodeCache.has(hash)) {
    const oldestKey = cloudEpisodeCache.keys().next().value;
    cloudEpisodeCache.delete(oldestKey);
  }
  cloudEpisodeCache.set(hash, data);
}

app.post('/api/subtitle/annotate', async (c) => {
  let body = {};
  try { body = await c.req.json(); } catch (_) { body = {}; }
  const cues = Array.isArray(body.cues) ? body.cues : [];
  if (cues.length > 100) {
    return c.json({ error: 'Payload Too Large', message: 'Maximum 100 cues allowed per annotation request' }, 413);
  }
  if (cues.length === 0) {
    return c.json({ cues: [] });
  }

  const annotatedCues = [];
  for (const cue of cues) {
    const text = String(cue.text || '').trim();
    if (!text) {
      annotatedCues.push({ ...cue, tokens: [], gap_words: [] });
      continue;
    }

    const matches = text.match(/[\u4e00-\u9faf]+[\u3040-\u309f]*|[\u30a0-\u30ff]+|[\u3040-\u309f]{1,3}|[^\u4e00-\u9faf\u3040-\u30ff\s]+/g) || [text];
    const tokens = [];
    const gapWords = [];

    for (const surface of matches) {
      const isJapanese = /[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]/.test(surface);
      if (!isJapanese) {
        tokens.push({ surface, lemma: surface, reading: '', pos: '補助記号', status: 'unstyled', level: '' });
        continue;
      }
      tokens.push({
        surface,
        lemma: surface,
        reading: '',
        pos: '名詞',
        status: 'unstyled',
        level: ''
      });
      if (surface.length > 1 && !gapWords.includes(surface)) {
        gapWords.push(surface);
      }
    }

    annotatedCues.push({
      ...cue,
      tokens,
      gap_words: gapWords
    });
  }

  const uniqueLemmas = [...new Set(annotatedCues.flatMap(c => c.tokens.filter(t => t.pos !== '補助記号').map(t => t.lemma)))];
  if (uniqueLemmas.length > 0) {
    try {
      const jlptRows = await queryNeon(
        c,
        'SELECT word, level FROM jlpt_vocab WHERE word = ANY($1)',
        [uniqueLemmas.slice(0, 100)]
      );
      if (Array.isArray(jlptRows)) {
        const levelMap = new Map(jlptRows.map(r => [r.word, r.level]));
        for (const cue of annotatedCues) {
          for (const tok of cue.tokens) {
            if (levelMap.has(tok.lemma)) {
              tok.level = levelMap.get(tok.lemma);
            }
          }
        }
      }
    } catch (_) {}
  }

  return c.json({ cues: annotatedCues });
});

app.post('/api/link/sessions', async (c) => {
  let body = {};
  try { body = await c.req.json(); } catch (_) { body = {}; }
  if (cloudSessionCache.length > 100) cloudSessionCache.shift();
  cloudSessionCache.push({ ...body, receivedAt: Date.now() });
  return c.json({ ok: true, data: body });
});

app.get('/api/link/sessions', (c) => {
  return c.json(cloudSessionCache.slice(-50));
});

app.post('/api/link/episodes/sync', async (c) => {
  let body = {};
  try { body = await c.req.json(); } catch (_) { body = {}; }
  const hash = body.hash || body.cueHash;
  const existing = hash ? (cloudEpisodeCache.get(hash) || {}) : {};
  const mergedLastPos = Math.max(body.last_position_ms || 0, existing.last_position_ms || 0);
  const mergedDuration = Math.max(body.duration_ms || 0, existing.duration_ms || 0);
  const existingMined = Array.isArray(existing.mined_words) ? existing.mined_words.length : (existing.mined || 0);
  const newMined = Array.isArray(body.mined_words) ? body.mined_words.length : (body.mined || 0);
  const finalMined = Math.max(newMined, existingMined);

  if (hash) {
    setEpisodeCache(hash, {
      ...existing,
      ...body,
      last_position_ms: mergedLastPos,
      duration_ms: mergedDuration,
      mined: finalMined,
      poster_url: body.poster_url || existing.poster_url || '',
      synopsis: body.synopsis || existing.synopsis || '',
      syncedAt: Date.now()
    });
  }
  return c.json({
    hash,
    title: body.title || existing.title || 'Episode',
    series: body.series || existing.series || 'Anime',
    site: body.site || existing.site || 'generic',
    known_pct: body.known_pct || existing.known_pct || 0,
    mined: finalMined,
    minutes: Math.round(mergedDuration / 60000),
    last_position_ms: mergedLastPos,
    duration_ms: mergedDuration,
    poster_url: body.poster_url || existing.poster_url || '',
    synopsis: body.synopsis || existing.synopsis || ''
  });
});

app.get('/api/link/cues/:hash', (c) => {
  const hash = c.req.param('hash');
  const ep = cloudEpisodeCache.get(hash);
  if (ep && Array.isArray(ep.cues)) {
    return c.json({ hash, cues: ep.cues });
  }
  return c.json({ hash, cues: [] });
});

app.post('/api/link/episodes/:hash/position', async (c) => {
  const hash = c.req.param('hash');
  let body = {};
  try { body = await c.req.json(); } catch (_) { body = {}; }
  const existing = cloudEpisodeCache.get(hash) || {};
  setEpisodeCache(hash, {
    ...existing,
    last_position_ms: body.last_position_ms || 0,
    title: body.title || existing.title || '',
    series: body.series || existing.series || '',
    site: body.site || existing.site || 'generic'
  });
  return c.json({ ok: true, hash, last_position_ms: body.last_position_ms || 0 });
});

app.get('/api/link/episodes/:hash/inspect', (c) => {
  const hash = c.req.param('hash');
  const ep = cloudEpisodeCache.get(hash);
  const cues = ep?.cues || [];
  return c.json({
    hash,
    difficulty: { overall_level: 'N4', target_learner_level: 'N3', unique_words_count: cues.length },
    missed_words: [],
    all_words: [],
    grammar_points: []
  });
});

app.get('/api/link/series', (c) => {
  const seriesMap = new Map();
  for (const [hash, ep] of cloudEpisodeCache.entries()) {
    const sName = ep.series || 'Anime';
    if (!seriesMap.has(sName)) {
      seriesMap.set(sName, {
        series: sName,
        title_english: sName,
        media_type: ep.mediaType || ep.media_type || 'anime',
        poster_url: ep.poster_url || ep.posterUrl || '',
        synopsis: ep.synopsis || '',
        episodes: []
      });
    } else {
      const cur = seriesMap.get(sName);
      if (!cur.poster_url && (ep.poster_url || ep.posterUrl)) {
        cur.poster_url = ep.poster_url || ep.posterUrl;
      }
      if (!cur.synopsis && ep.synopsis) {
        cur.synopsis = ep.synopsis;
      }
    }
    seriesMap.get(sName).episodes.push({
      hash,
      title: ep.title || 'Episode',
      site: ep.site || 'generic',
      last_position_ms: ep.last_position_ms || 0,
      duration_ms: ep.duration_ms || 0,
      mined: Array.isArray(ep.mined_words) ? ep.mined_words.length : (ep.mined || 0)
    });
  }
  return c.json(Array.from(seriesMap.values()));
});

app.get('/api/link/poster-proxy', async (c) => {
  const url = c.req.query('url');
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return c.json({ error: 'Invalid poster URL' }, 400);
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return c.json({ error: 'Malformed URL' }, 400);
  }
  const allowedDomains = ['anilist.co', 'youtube.com', 'ytimg.com', 'tvmaze.com', 'media-amazon.com', 'crunchyroll.com', 'myanimelist.net'];
  if (!allowedDomains.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
    return c.json({ error: 'Domain not permitted' }, 400);
  }
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'KirokuNote/1.0' } });
    if (!resp.ok) {
      return c.json({ error: 'Failed to fetch poster' }, 502);
    }
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const body = await resp.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (err) {
    return c.json({ error: err.message }, 502);
  }
});

app.get('/api/link/episodes', (c) => {
  const epList = [];
  for (const [hash, ep] of cloudEpisodeCache.entries()) {
    epList.push({
      hash,
      title: ep.title || 'Episode',
      series: ep.series || 'Anime',
      site: ep.site || 'generic',
      last_position_ms: ep.last_position_ms || 0,
      duration_ms: ep.duration_ms || 0,
      mined: Array.isArray(ep.mined_words) ? ep.mined_words.length : 0
    });
  }
  return c.json(epList);
});

app.get('/api/cards', (c) => {
  return c.json([]);
});

const handleSaveCard = async (c) => {
  const contentLength = parseInt(c.req.header('content-length') || '0', 10);
  if (contentLength > 131072) {
    return c.json({ error: 'Payload Too Large', message: 'Maximum card payload size is 128KB' }, 413);
  }

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

  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    if (c.env?.ENVIRONMENT !== 'production') {
      auth.user = { sub: 'dev_user', role: 'developer' };
    } else {
      return c.json({ error: 'Unauthorized', message: 'Authentication required to save card to cloud' }, 401);
    }
  }
  const userId = auth.user?.sub || 'dev_user';

  try {
    await initTursoSchema(c);
    const nowEpoch = Math.floor(Date.now() / 1000);
    await queryTurso(
      c,
      `INSERT INTO user_study_cards (user_id, term_ref, deck_id, state, due_at, last_reviewed_at, custom_sentence)
       VALUES (?, ?, 1, 0, ?, ?, ?)
       ON CONFLICT (user_id, term_ref) DO UPDATE SET
         last_reviewed_at = excluded.last_reviewed_at,
         custom_sentence = excluded.custom_sentence`,
      [userId, expr, nowEpoch, nowEpoch, savedCard.example_sentence || null]
    );

    const stableOpId = body.id || `card_${cardId}`;
    if (body.id) {
      const existing = await queryTurso(c, `SELECT payload FROM user_op_log WHERE user_id = ? AND id = ?`, [userId, stableOpId]);
      if (existing?.rows?.length > 0) {
        const existingPayload = existing.rows[0][0]?.value ?? existing.rows[0][0];
        let existingObj = null;
        try { existingObj = JSON.parse(existingPayload); } catch (_) {}
        if (existingObj && (existingObj.expression !== expr || existingObj.reading !== reading || (existingObj.meaning || '') !== (body.meaning || ''))) {
          return c.json({ error: 'Conflict', message: `Card operation ${stableOpId} already exists with different payload` }, 409);
        }
        return c.json(existingObj || savedCard);
      }
    }

    await queryTurso(
      c,
      `INSERT INTO user_op_log (id, user_id, op_type, payload, ack, attempts, created_at)
       VALUES (?, ?, 'card_save', ?, 0, 0, ?)
       ON CONFLICT (user_id, id) DO NOTHING`,
      [stableOpId, userId, JSON.stringify(savedCard), now]
    );
  } catch (err) {
    console.warn('[SaveCard] Turso study card upsert error:', err.message);
    return c.json({ error: 'Failed to persist card to cloud', detail: err.message }, 500);
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

app.get('/api/vocab/inventory', async (c) => {
  const search = (c.req.query('search') || '').trim();
  const rawLevel = (c.req.query('jlpt_level') || c.req.query('level') || 'all').trim();
  const category = (c.req.query('category') || 'all').trim().toLowerCase();
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');

  try {
    const conditions = [];
    const params = [];

    if (rawLevel && rawLevel.toLowerCase() !== 'all') {
      params.push(rawLevel.toUpperCase());
      conditions.push(`level = $${params.length}`);
    }

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(word ILIKE $${params.length} OR reading ILIKE $${params.length} OR meanings ILIKE $${params.length})`);
    }

    if (category && category !== 'all') {
      if (category === 'adverb') {
        params.push('%adv%');
        conditions.push(`meanings ILIKE $${params.length}`);
      } else if (category === 'onomatopoeia' || category === 'on-mim') {
        params.push('%on-mim%');
        conditions.push(`meanings ILIKE $${params.length}`);
      } else if (category === 'adjective' || category === 'adj-i') {
        params.push('%adj%');
        conditions.push(`meanings ILIKE $${params.length}`);
      } else if (category === 'verb_transitive' || category === 'vt') {
        params.push('%transitive%');
        conditions.push(`meanings ILIKE $${params.length}`);
      } else if (category === 'verb_intransitive' || category === 'vi') {
        params.push('%intransitive%');
        conditions.push(`meanings ILIKE $${params.length}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT count(*) as total FROM jlpt_vocab ${whereClause}`;
    const listSql = `SELECT id, word, reading, meanings, level
                     FROM jlpt_vocab ${whereClause}
                     ORDER BY id ASC
                     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const [countRows, rows] = await Promise.all([
      queryNeon(c, countSql, params),
      queryNeon(c, listSql, [...params, limit, offset])
    ]);

    const total = parseInt(countRows[0]?.total || '0', 10);
    const items = rows.map(r => {
      let meanings = r.meanings;
      try { if (typeof meanings === 'string' && meanings.startsWith('[')) meanings = JSON.parse(meanings); } catch (_) {}
      const meaningStr = Array.isArray(meanings) ? meanings.slice(0, 3).join('; ') : (meanings || '—');

      return {
        expression: r.word,
        reading: r.reading || '',
        meaning: meaningStr,
        jlpt_level: r.level || '—',
        state: 'unseen',
        categories: category !== 'all' ? [category] : [],
        encounters_count: 0,
        card_id: null
      };
    });

    return c.json({
      items,
      total,
      counts_by_state: { total, known: 0, learning: 0, unseen: total, ignored: 0 },
      limit,
      offset
    });
  } catch (err) {
    console.warn('[Worker] Vocab inventory query error:', err.message);
    return c.json({ items: [], total: 0, counts_by_state: { total: 0, known: 0, learning: 0, unseen: 0, ignored: 0 }, limit, offset });
  }
});

app.post('/api/vocab/inventory/bulk-state', (c) => {
  return c.json({ ok: true, updated: 0 });
});



app.get('/api/stats/overview', (c) => {
  return c.json({ total_cards: 0, total_reviews: 0, streak: 0 });
});

// ---------------------------------------------------------------------------
// Sudachi WebAssembly Static Asset Serving
// ---------------------------------------------------------------------------
app.get('/assets/wasm/:file', async (c) => {
  const fileName = c.req.param('file');
  if (c.env?.ASSETS) {
    return await c.env.ASSETS.fetch(c.req.raw);
  }
  let contentType = 'application/octet-stream';
  if (fileName.endsWith('.js')) {
    contentType = 'application/javascript; charset=utf-8';
  } else if (fileName.endsWith('.wasm')) {
    contentType = 'application/wasm';
  }
  return new Response(`// Sudachi WASM Asset: ${fileName}`, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  });
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
  headers.delete('cookie');
  headers.delete('authorization');

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
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status === 404 && (c.req.header('Accept')?.includes('text/html') || !c.req.path.includes('.'))) {
      const url = new URL(c.req.url);
      url.pathname = '/index.html';
      return await c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
    }
    return res;
  }
  return c.text('Not Found', 404);
});

// ---------------------------------------------------------------------------
// Scheduled Cron: Auto-Pruning Acknowledged Sync Logs (14-day TTL compaction)
// ---------------------------------------------------------------------------
export async function handleScheduled(event, env, ctx) {
  const cutoffIso = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
  try {
    const fakeContext = { env };
    await initTursoSchema(fakeContext);
    const result = await queryTurso(
      fakeContext,
      `DELETE FROM user_op_log WHERE ack = 1 AND created_at < ?`,
      [cutoffIso]
    );
    return { status: 'ok', pruned: true, cutoff: cutoffIso, result };
  } catch (err) {
    console.warn('[Cron] Auto-pruning error:', err.message);
    return { status: 'error', error: err.message };
  }
}

app.scheduled = handleScheduled;

export default app;
