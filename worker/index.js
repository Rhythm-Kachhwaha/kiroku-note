import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authApp, isAllowedOrigin, authenticateRequest } from './auth.js';
import { queryTurso, executeTursoTransaction, initTursoSchema } from './turso.js';

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
// Manga Chunks & Edge Endpoints (Direct Turso libSQL for sub-10ms response)
// ---------------------------------------------------------------------------
app.get('/api/user/manga/list', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  await initTursoSchema(c);
  const res = await queryTurso(c, `
    SELECT b.book_id, b.title, b.filename, b.file_type, b.size, b.total_pages, b.uploaded_at, b.cover_url,
      CASE WHEN (b.file_data IS NOT NULL AND b.file_data != '') OR EXISTS (SELECT 1 FROM user_manga_chunks c WHERE c.user_id = b.user_id AND c.book_id = b.book_id) THEN 1 ELSE 0 END AS has_file,
      COALESCE(p.page_number, 1) AS current_page,
      COALESCE(p.completed, 0) AS completed,
      p.last_read_at
    FROM user_manga_books b
    LEFT JOIN user_manga_progress p ON b.user_id = p.user_id AND b.book_id = p.manga_id AND (p.chapter_number = 1 OR p.chapter_number IS NULL)
    WHERE b.user_id = ?
    ORDER BY b.uploaded_at DESC
  `, [userId]);
  const rows = res?.rows || [];
  const books = rows.map(r => {
    const bookId = String(r[0]?.value ?? r[0]);
    const title = String((r[1]?.value ?? r[1]) || 'Untitled Manga');
    const filename = String((r[2]?.value ?? r[2]) || '');
    const fileType = String((r[3]?.value ?? r[3]) || 'pdf');
    const size = Number((r[4]?.value ?? r[4]) || 0);
    const totalPages = Number((r[5]?.value ?? r[5]) || 1);
    const uploadedAt = Number((r[6]?.value ?? r[6]) || 0);
    const coverUrl = String((r[7]?.value ?? r[7]) || '');
    const hasFile = Boolean(Number((r[8]?.value ?? r[8]) || 0));
    const currentPage = Number((r[9]?.value ?? r[9]) || 1);
    const completed = Boolean(Number((r[10]?.value ?? r[10]) || 0));
    const lastReadAt = Number((r[11]?.value ?? r[11]) || uploadedAt);

    return {
      id: bookId,
      book_id: bookId,
      title,
      filename,
      file_name: filename,
      file_type: fileType,
      type: fileType,
      size,
      file_size: size,
      page_count: totalPages,
      total_pages: totalPages,
      uploaded_at: uploadedAt,
      cover_url: coverUrl,
      has_file: hasFile,
      current_page: currentPage,
      completed,
      last_read_at: lastReadAt,
      cloud: true
    };
  });
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
  const isContiguous = (chunkIndices.length === totalChunks && totalChunks > 0 && chunkIndices.every((idx, i) => idx === i));
  return c.json({
    ok: true,
    book_id: bookId,
    total_chunks: totalChunks,
    uploaded_chunks: chunkIndices.length,
    uploaded_count: chunkIndices.length,
    complete: isContiguous,
    is_contiguous: isContiguous,
    chunk_indices: chunkIndices,
    chunks: chunkIndices
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
  if (isNaN(chunkIndex) || isNaN(totalChunks) || !chunkData || totalChunks <= 0 || chunkIndex < 0 || chunkIndex >= totalChunks) {
    return c.json({ error: 'Invalid chunk payload: out of bounds or empty' }, 400);
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
