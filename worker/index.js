import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authApp, isAllowedOrigin, authenticateRequest } from './auth.js';
import { queryTurso, initTursoSchema } from './turso.js';

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

// Rate limiter for auth endpoints
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

app.use('/auth/*', async (c, next) => {
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
// Manga Chunks & Edge Endpoints (Direct Turso libSQL for sub-10ms response)
// ---------------------------------------------------------------------------
app.get('/api/user/manga/list', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  await initTursoSchema(c);
  const res = await queryTurso(c, `
    SELECT b.book_id, b.title, b.page_count, b.current_page, b.file_type, b.file_name, b.file_size, b.last_read_at, b.cover_url,
      CASE WHEN (b.file_data IS NOT NULL AND b.file_data != '') OR EXISTS (SELECT 1 FROM user_manga_chunks c WHERE c.user_id = b.user_id AND c.book_id = b.book_id) THEN 1 ELSE 0 END AS has_file
    FROM user_manga_books b
    WHERE b.user_id = ?
    ORDER BY b.last_read_at DESC
  `, [userId]);
  const rows = res?.rows || [];
  const books = rows.map(r => ({
    book_id: r[0]?.value ?? r[0],
    title: r[1]?.value ?? r[1],
    page_count: Number(r[2]?.value ?? r[2]),
    current_page: Number(r[3]?.value ?? r[3]),
    file_type: r[4]?.value ?? r[4],
    file_name: r[5]?.value ?? r[5],
    file_size: Number(r[6]?.value ?? r[6]),
    last_read_at: Number(r[7]?.value ?? r[7]),
    cover_url: r[8]?.value ?? r[8],
    has_file: Boolean(Number(r[9]?.value ?? r[9]))
  }));
  return c.json({ books });
});

app.get('/api/user/manga/:book_id/chunks', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');
  await initTursoSchema(c);
  const res = await queryTurso(c, `
    SELECT chunk_index, total_chunks FROM user_manga_chunks
    WHERE user_id = ? AND book_id = ?
    ORDER BY chunk_index ASC
  `, [userId, bookId]);
  const rows = res?.rows || [];
  if (rows.length === 0) {
    const legacy = await queryTurso(c, `SELECT (file_data IS NOT NULL AND file_data != '') AS has_legacy FROM user_manga_books WHERE user_id = ? AND book_id = ?`, [userId, bookId]);
    const hasLegacy = Boolean(Number(legacy?.rows?.[0]?.[0]?.value ?? legacy?.rows?.[0]?.[0]));
    if (hasLegacy) {
      return c.json({ ok: true, book_id: bookId, total_chunks: 1, uploaded_chunks: 1, complete: true, chunk_indices: [0], is_legacy: true });
    }
    return c.json({ ok: true, book_id: bookId, total_chunks: 0, uploaded_chunks: 0, complete: false, chunk_indices: [] });
  }
  const totalChunks = Number(rows[0][1]?.value ?? rows[0][1]);
  const chunkIndices = rows.map(r => Number(r[0]?.value ?? r[0]));
  const complete = (chunkIndices.length === totalChunks && totalChunks > 0);
  return c.json({
    ok: true,
    book_id: bookId,
    total_chunks: totalChunks,
    uploaded_chunks: chunkIndices.length,
    complete,
    chunk_indices: chunkIndices
  });
});

app.get('/api/user/manga/:book_id/chunk/:chunk_index', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');
  const chunkIndex = parseInt(c.req.param('chunk_index'), 10);
  await initTursoSchema(c);
  const res = await queryTurso(c, `
    SELECT chunk_data, total_chunks FROM user_manga_chunks
    WHERE user_id = ? AND book_id = ? AND chunk_index = ?
  `, [userId, bookId, chunkIndex]);
  const row = res?.rows?.[0];
  if (!row) {
    return c.json({ error: 'Chunk not found' }, 404);
  }
  return c.json({
    ok: true,
    book_id: bookId,
    chunk_index: chunkIndex,
    total_chunks: Number(row[1]?.value ?? row[1]),
    chunk_data: row[0]?.value ?? row[0]
  });
});

app.post('/api/user/manga/:book_id/chunk', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');
  const body = await c.req.json();
  const chunkIndex = parseInt(body.chunk_index, 10);
  const totalChunks = parseInt(body.total_chunks, 10);
  const chunkData = body.chunk_data || '';
  if (isNaN(chunkIndex) || isNaN(totalChunks) || !chunkData) {
    return c.json({ error: 'Invalid chunk payload' }, 400);
  }
  await initTursoSchema(c);
  await queryTurso(c, `
    INSERT INTO user_manga_chunks (user_id, book_id, chunk_index, total_chunks, chunk_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, book_id, chunk_index) DO UPDATE SET
      total_chunks = excluded.total_chunks,
      chunk_data = excluded.chunk_data,
      created_at = excluded.created_at
  `, [userId, bookId, chunkIndex, totalChunks, chunkData, Math.floor(Date.now() / 1000)]);
  return c.json({ ok: true, book_id: bookId, chunk_index: chunkIndex, total_chunks: totalChunks });
});

app.delete('/api/user/manga/:book_id/chunks', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');
  await initTursoSchema(c);
  await queryTurso(c, `DELETE FROM user_manga_chunks WHERE user_id = ? AND book_id = ?`, [userId, bookId]);
  return c.json({ ok: true, book_id: bookId });
});

// ---------------------------------------------------------------------------
// Render Python FastAPI Reverse Proxy
// Transparently routes all /api/* requests to canonical Python backend on Render
// ---------------------------------------------------------------------------
app.all('/api/*', async (c) => {
  const renderBase = (c.env?.RENDER_BACKEND_URL || 'https://kiroku-backend-h0lv.onrender.com').replace(/\/$/, '');
  const url = new URL(c.req.url);
  const targetUrl = `${renderBase}${url.pathname}${url.search}`;

  const headers = new Headers(c.req.raw.headers);
  headers.set('Host', new URL(renderBase).host);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

  const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for');
  if (clientIp) headers.set('X-Forwarded-For', clientIp);

  const init = {
    method: c.req.method,
    headers,
    redirect: 'follow',
  };

  if (!['GET', 'HEAD'].includes(c.req.method)) {
    init.body = c.req.raw.body;
    init.duplex = 'half';
  }

  try {
    const res = await fetch(targetUrl, init);
    const resHeaders = new Headers(res.headers);
    const origin = c.req.header('origin');
    if (origin && isAllowedOrigin(origin, c.env)) {
      resHeaders.set('Access-Control-Allow-Origin', origin);
      resHeaders.set('Access-Control-Allow-Credentials', 'true');
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
    });
  } catch (err) {
    console.error('[Render Proxy Error]', err);
    return c.json({ error: 'Backend Gateway Error', detail: err.message }, 502);
  }
});

// ---------------------------------------------------------------------------
// Static Assets & Single Page Application (PWA) Fallback
// ---------------------------------------------------------------------------
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
// Scheduled Cron: Keepalive Ping for Render & Auto-Pruning Acknowledged Logs
// ---------------------------------------------------------------------------
export async function handleScheduled(event, env, ctx) {
  const renderBase = (env?.RENDER_BACKEND_URL || 'https://kiroku-backend-h0lv.onrender.com').replace(/\/$/, '');
  try {
    await fetch(`${renderBase}/api/health`, { signal: AbortSignal.timeout(6000) });
  } catch (err) {
    console.warn('[Cron] Render keepalive ping:', err.message);
  }

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

export default {
  fetch: app.fetch,
  request: (...args) => app.request(...args),
  scheduled: handleScheduled,
};
