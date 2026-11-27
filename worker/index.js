import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authApp, isAllowedOrigin, authenticateRequest, parseCookies } from './auth.js';
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

  let body;
  try {
    const rawText = await c.req.text();
    if (rawText.length > 512 * 1024) {
      return c.json({ error: 'Payload Too Large', message: 'Maximum sync payload size is 512KB' }, 413);
    }
    body = JSON.parse(rawText);
  } catch {
    return c.json({ error: 'Bad Request', message: 'Invalid JSON body' }, 400);
  }
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
        deck_name: payload?.deck_name || '',
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

  let body;
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Bad Request', message: 'Invalid JSON body' }, 400);
  }
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
      p.last_read_at,
      (SELECT COUNT(*) FROM user_manga_ocr_pages o WHERE o.user_id = b.user_id AND o.book_id = b.book_id) AS ocr_page_count,
      COALESCE(p.bubble_display, 'show') AS bubble_display
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
    const ocrPageCount = Number((r[12]?.value ?? r[12]) || 0);
    const bubbleDisplay = String((r[13]?.value ?? r[13]) || 'show');

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
      ocr_page_count: ocrPageCount,
      ocr_cached: ocrPageCount > 0,
      bubble_display: bubbleDisplay,
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

  // Check if manifest exists for this book
  const manifestRes = await queryTurso(c, `
    SELECT generation_id, total_bytes, chunk_size, total_chunks, file_hash, chunk_hashes, status
    FROM user_manga_upload_manifests
    WHERE user_id = ? AND book_id = ?
    ORDER BY created_at DESC LIMIT 1
  `, [userId, bookId]);
  const manifestRow = manifestRes?.rows?.[0];
  const manifest = manifestRow ? {
    generation_id: String(manifestRow[0]?.value ?? manifestRow[0]),
    total_bytes: Number(manifestRow[1]?.value ?? manifestRow[1]),
    chunk_size: Number(manifestRow[2]?.value ?? manifestRow[2]),
    total_chunks: Number(manifestRow[3]?.value ?? manifestRow[3]),
    file_hash: String(manifestRow[4]?.value ?? manifestRow[4]),
    chunk_hashes: JSON.parse(String((manifestRow[5]?.value ?? manifestRow[5]) || '[]')),
    status: String(manifestRow[6]?.value ?? manifestRow[6])
  } : null;

  let querySql = `
    SELECT chunk_index, total_chunks, generation_id, chunk_hash FROM user_manga_chunks
    WHERE user_id = ? AND book_id = ?
  `;
  const queryArgs = [userId, bookId];
  if (manifest?.generation_id) {
    querySql += ` AND (generation_id = ? OR generation_id = '' OR generation_id IS NULL)`;
    queryArgs.push(manifest.generation_id);
  }
  querySql += ` ORDER BY chunk_index ASC`;

  const res = await queryTurso(c, querySql, queryArgs);
  const rows = res?.rows || [];
  if (rows.length === 0) {
    const legacy = await queryTurso(c, `SELECT (file_data IS NOT NULL AND file_data != '') AS has_legacy FROM user_manga_books WHERE user_id = ? AND book_id = ?`, [userId, bookId]);
    const hasLegacy = Boolean(Number(legacy?.rows?.[0]?.[0]?.value ?? legacy?.rows?.[0]?.[0]));
    if (hasLegacy) {
      return c.json({ ok: true, book_id: bookId, total_chunks: 1, uploaded_chunks: 1, complete: true, chunk_indices: [0], is_legacy: true });
    }
    return c.json({
      ok: true,
      book_id: bookId,
      total_chunks: manifest?.total_chunks || 0,
      uploaded_chunks: 0,
      complete: false,
      chunk_indices: [],
      generation_id: manifest?.generation_id || null,
      file_hash: manifest?.file_hash || null,
      is_verified: false
    });
  }

  const totalChunks = manifest?.total_chunks || Number(rows[0][1]?.value ?? rows[0][1]);
  const chunkIndices = rows.map(r => Number(r[0]?.value ?? r[0]));
  const isContiguous = (chunkIndices.length === totalChunks && totalChunks > 0 && chunkIndices.every((idx, i) => idx === i));
  const isVerified = Boolean(manifest ? (manifest.status === 'verified' && isContiguous) : isContiguous);

  return c.json({
    ok: true,
    book_id: bookId,
    total_chunks: totalChunks,
    uploaded_chunks: chunkIndices.length,
    uploaded_count: chunkIndices.length,
    complete: isVerified,
    is_contiguous: isContiguous,
    is_verified: isVerified,
    generation_id: manifest?.generation_id || null,
    file_hash: manifest?.file_hash || null,
    chunk_hashes: manifest?.chunk_hashes || [],
    chunk_indices: chunkIndices,
    chunks: chunkIndices
  });
});

app.post('/api/user/manga/:book_id/upload/init', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');
  const body = await c.req.json();
  const generationId = String(body.generation_id || body.generationId || `gen_${Date.now()}`);
  const totalBytes = Number(body.total_bytes || body.totalBytes || 0);
  const chunkSize = Number(body.chunk_size || body.chunkSize || 2 * 1024 * 1024);
  const totalChunks = Number(body.total_chunks || body.totalChunks || 0);
  const fileHash = String(body.file_hash || body.hash || '');
  const rawChunkHashes = body.chunk_hashes || body.chunkHashes || [];
  const chunkHashes = Array.isArray(rawChunkHashes) ? JSON.stringify(rawChunkHashes) : '[]';

  if (!totalChunks || totalChunks <= 0 || !fileHash) {
    return c.json({ error: 'Invalid manifest: missing total_chunks or file_hash' }, 400);
  }

  await initTursoSchema(c);

  // If a previous unverified generation existed for this book, clear its orphan chunks
  try {
    const prevGenRes = await queryTurso(c, `
      SELECT generation_id FROM user_manga_upload_manifests
      WHERE user_id = ? AND book_id = ? AND status = 'uploading' AND generation_id != ?
    `, [userId, bookId, generationId]);
    for (const r of (prevGenRes?.rows || [])) {
      const oldGen = String(r[0]?.value ?? r[0]);
      if (oldGen) {
        await queryTurso(c, `DELETE FROM user_manga_chunks WHERE user_id = ? AND book_id = ? AND generation_id = ?`, [userId, bookId, oldGen]);
      }
    }
  } catch (_) {}

  await queryTurso(c, `
    INSERT INTO user_manga_upload_manifests (user_id, book_id, generation_id, total_bytes, chunk_size, total_chunks, file_hash, chunk_hashes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?)
    ON CONFLICT (user_id, book_id, generation_id) DO UPDATE SET
      total_bytes = excluded.total_bytes,
      chunk_size = excluded.chunk_size,
      total_chunks = excluded.total_chunks,
      file_hash = excluded.file_hash,
      chunk_hashes = excluded.chunk_hashes,
      status = 'uploading',
      created_at = excluded.created_at
  `, [userId, bookId, generationId, totalBytes, chunkSize, totalChunks, fileHash, chunkHashes, Math.floor(Date.now() / 1000)]);

  return c.json({
    ok: true,
    book_id: bookId,
    generation_id: generationId,
    total_chunks: totalChunks,
    file_hash: fileHash
  });
});

app.post('/api/user/manga/:book_id/upload/verify', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');
  const body = await c.req.json();
  const generationId = String(body.generation_id || body.generationId || '');
  const fileHash = String(body.file_hash || body.hash || '');

  await initTursoSchema(c);
  const manifestRes = await queryTurso(c, `
    SELECT total_chunks, file_hash, total_bytes, status, chunk_hashes, chunk_size FROM user_manga_upload_manifests
    WHERE user_id = ? AND book_id = ? AND generation_id = ?
  `, [userId, bookId, generationId]);

  const manifestRow = manifestRes?.rows?.[0];
  if (!manifestRow) {
    return c.json({ error: 'Upload manifest not found for generation', generation_id: generationId }, 404);
  }

  const totalChunks = Number(manifestRow[0]?.value ?? manifestRow[0]);
  const expectedHash = String(manifestRow[1]?.value ?? manifestRow[1]);
  const expectedTotalBytes = Number(manifestRow[2]?.value ?? manifestRow[2] ?? 0);
  let expectedChunkHashes = [];
  try {
    const rawChunkHashes = manifestRow[4]?.value ?? manifestRow[4];
    if (rawChunkHashes) {
      expectedChunkHashes = typeof rawChunkHashes === 'string' ? JSON.parse(rawChunkHashes) : rawChunkHashes;
    }
  } catch (_) {}

  if (fileHash && expectedHash && fileHash !== expectedHash) {
    return c.json({ error: 'Final file checksum mismatch', expected: expectedHash, provided: fileHash }, 400);
  }

  // Verify all chunks for this generation exist and are contiguous
  const chunksRes = await queryTurso(c, `
    SELECT chunk_index, generation_id, chunk_hash, chunk_data FROM user_manga_chunks
    WHERE user_id = ? AND book_id = ?
    ORDER BY chunk_index ASC
  `, [userId, bookId]);

  const rows = chunksRes?.rows || [];
  const matchingChunks = rows.filter(r => {
    const gen = String(r[1]?.value ?? r[1] ?? '');
    return !gen || gen === generationId;
  });

  const indices = matchingChunks.map(r => Number(r[0]?.value ?? r[0]));
  const isContiguous = indices.length === totalChunks && indices.every((idx, i) => idx === i);

  if (!isContiguous) {
    return c.json({
      error: 'Upload verification failed: missing or non-contiguous chunks',
      total_chunks: totalChunks,
      uploaded_chunks: indices.length,
      indices
    }, 400);
  }

  // Validate each stored chunk against manifest expected chunk hashes
  let totalReconstructedBytes = 0;
  for (let i = 0; i < matchingChunks.length; i++) {
    const r = matchingChunks[i];
    const chunkIdx = Number(r[0]?.value ?? r[0]);
    const storedChunkHash = String(r[2]?.value ?? r[2] ?? '');
    const chunkData = String(r[3]?.value ?? r[3] ?? '');

    // Reconstruct byte length from base64
    if (chunkData) {
      const padding = chunkData.endsWith('==') ? 2 : (chunkData.endsWith('=') ? 1 : 0);
      const byteLen = Math.floor((chunkData.length * 3) / 4) - padding;
      totalReconstructedBytes += Math.max(0, byteLen);
    }

    if (Array.isArray(expectedChunkHashes) && expectedChunkHashes.length === totalChunks) {
      const expectedChunkHash = expectedChunkHashes[chunkIdx];
      if (expectedChunkHash) {
        if (!storedChunkHash || storedChunkHash !== expectedChunkHash) {
          return c.json({
            error: `Chunk cryptographic hash mismatch at index ${chunkIdx}`,
            chunk_index: chunkIdx,
            expected_hash: expectedChunkHash,
            stored_hash: storedChunkHash
          }, 400);
        }
      }
    }
  }

  // Validate total byte length if recorded in manifest
  if (expectedTotalBytes > 0 && totalReconstructedBytes > 0 && expectedTotalBytes !== totalReconstructedBytes) {
    return c.json({
      error: 'Total uploaded byte length mismatch',
      expected_bytes: expectedTotalBytes,
      actual_bytes: totalReconstructedBytes
    }, 400);
  }

  // Update manifest status to verified
  await queryTurso(c, `
    UPDATE user_manga_upload_manifests
    SET status = 'verified', verified_at = ?
    WHERE user_id = ? AND book_id = ? AND generation_id = ?
  `, [Math.floor(Date.now() / 1000), userId, bookId, generationId]);

  return c.json({
    ok: true,
    verified: true,
    book_id: bookId,
    generation_id: generationId,
    file_hash: expectedHash,
    total_chunks: totalChunks
  });
});

app.get('/api/user/manga/:book_id/chunk/:chunk_index', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');
  const chunkIndex = parseInt(c.req.param('chunk_index'), 10);
  const generationId = c.req.query('generation_id') || c.req.query('generationId') || null;

  await initTursoSchema(c);

  let sql = `
    SELECT chunk_data, total_chunks, generation_id, chunk_hash FROM user_manga_chunks
    WHERE user_id = ? AND book_id = ? AND chunk_index = ?
  `;
  const args = [userId, bookId, chunkIndex];
  if (generationId) {
    sql += ` AND (generation_id = ? OR generation_id = '' OR generation_id IS NULL)`;
    args.push(generationId);
  }

  const res = await queryTurso(c, sql, args);
  const row = res?.rows?.[0];
  if (!row) {
    return c.json({ error: 'Chunk not found' }, 404);
  }
  return c.json({
    ok: true,
    book_id: bookId,
    chunk_index: chunkIndex,
    total_chunks: Number(row[1]?.value ?? row[1]),
    chunk_data: row[0]?.value ?? row[0],
    generation_id: row[2]?.value ?? row[2] ?? null,
    chunk_hash: row[3]?.value ?? row[3] ?? null
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
  const generationId = String(body.generation_id || body.generationId || '');
  const expectedChunkHash = String(body.chunk_hash || body.chunkHash || '');

  if (isNaN(chunkIndex) || isNaN(totalChunks) || !chunkData || totalChunks <= 0 || chunkIndex < 0 || chunkIndex >= totalChunks) {
    return c.json({ error: 'Invalid chunk payload: out of bounds or empty' }, 400);
  }

  await initTursoSchema(c);

  // Validate generation match if active manifest exists
  if (generationId) {
    const manifestRes = await queryTurso(c, `
      SELECT generation_id, total_chunks, chunk_hashes FROM user_manga_upload_manifests
      WHERE user_id = ? AND book_id = ?
      ORDER BY created_at DESC LIMIT 1
    `, [userId, bookId]);
    const manifestRow = manifestRes?.rows?.[0];
    if (manifestRow) {
      const activeGen = String(manifestRow[0]?.value ?? manifestRow[0]);
      if (activeGen && activeGen !== generationId) {
        return c.json({ error: 'Upload generation mismatch: chunk belongs to outdated generation', active_generation: activeGen, received_generation: generationId }, 409);
      }
    }
  }

  // Cryptographic checksum verification of chunk binary
  let computedChunkHash = '';
  try {
    const binaryStr = atob(chunkData);
    const buf = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) buf[i] = binaryStr.charCodeAt(i);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    computedChunkHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return c.json({ error: 'Failed to decode base64 chunk data' }, 400);
  }

  if (expectedChunkHash && expectedChunkHash !== computedChunkHash) {
    return c.json({ error: 'Chunk cryptographic checksum mismatch', expected: expectedChunkHash, actual: computedChunkHash }, 400);
  }

  await queryTurso(c, `
    INSERT INTO user_manga_chunks (user_id, book_id, chunk_index, total_chunks, chunk_data, created_at, generation_id, chunk_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, book_id, chunk_index) DO UPDATE SET
      total_chunks = excluded.total_chunks,
      chunk_data = excluded.chunk_data,
      created_at = excluded.created_at,
      generation_id = excluded.generation_id,
      chunk_hash = excluded.chunk_hash
  `, [userId, bookId, chunkIndex, totalChunks, chunkData, Math.floor(Date.now() / 1000), generationId, computedChunkHash]);

  return c.json({
    ok: true,
    book_id: bookId,
    chunk_index: chunkIndex,
    total_chunks: totalChunks,
    generation_id: generationId,
    chunk_hash: computedChunkHash
  });
});

// Progress and Annotations Outbox Sync Endpoints
app.post('/api/user/manga/:book_id/progress', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');
  const body = await c.req.json();
  const pageNumber = Number(body.page || body.page_number || body.currentPage || 1);
  const chapterNumber = Number(body.chapter || body.chapter_number || 1);
  const completed = body.completed ? 1 : 0;
  const lastReadAt = Number(body.last_read_at || body.lastReadAt || Math.floor(Date.now() / 1000));
  const bubbleDisplay = String(body.bubble_display || body.bubbleDisplay || 'show');

  await initTursoSchema(c);
  await queryTurso(c, `
    INSERT INTO user_manga_progress (user_id, manga_id, chapter_number, page_number, completed, last_read_at, bubble_display)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, manga_id, chapter_number) DO UPDATE SET
      page_number = excluded.page_number,
      completed = excluded.completed,
      last_read_at = excluded.last_read_at,
      bubble_display = COALESCE(excluded.bubble_display, user_manga_progress.bubble_display, 'show')
    WHERE excluded.last_read_at >= user_manga_progress.last_read_at OR user_manga_progress.last_read_at IS NULL
  `, [userId, bookId, chapterNumber, pageNumber, completed, lastReadAt, bubbleDisplay]);

  return c.json({ ok: true, book_id: bookId, page_number: pageNumber, completed, last_read_at: lastReadAt, bubble_display: bubbleDisplay });
});

app.post('/api/user/manga/:book_id/annotations', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');
  const body = await c.req.json();
  const pageNumber = Number(body.page_number || body.pageNum || 1);
  const dataJson = typeof body.strokes === 'object' ? JSON.stringify(body.strokes) : String(body.data_json || body.strokes || '[]');
  const updatedAt = Number(body.updated_at || body.updatedAt || Math.floor(Date.now() / 1000));

  await initTursoSchema(c);
  await queryTurso(c, `
    INSERT INTO user_manga_annotations (user_id, book_id, page_number, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, book_id, page_number) DO UPDATE SET
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at >= user_manga_annotations.updated_at OR user_manga_annotations.updated_at IS NULL
  `, [userId, bookId, pageNumber, dataJson, updatedAt]);

  return c.json({ ok: true, book_id: bookId, page_number: pageNumber, updated_at: updatedAt });
});

app.get('/api/user/manga/:book_id/annotations', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');
  await initTursoSchema(c);
  const res = await queryTurso(c, `
    SELECT page_number, data_json, updated_at FROM user_manga_annotations
    WHERE user_id = ? AND book_id = ?
    ORDER BY page_number ASC
  `, [userId, bookId]);
  const rows = res?.rows || [];
  const annotations = rows.map(r => ({
    page_number: Number(r[0]?.value ?? r[0]),
    strokes: JSON.parse(String((r[1]?.value ?? r[1]) || '[]')),
    updated_at: Number((r[2]?.value ?? r[2]) || 0)
  }));
  return c.json({ ok: true, book_id: bookId, annotations });
});

app.delete('/api/user/manga/:book_id/annotations/:page_number', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');
  const pageNumber = Number(c.req.param('page_number'));
  await initTursoSchema(c);
  await queryTurso(c, `
    DELETE FROM user_manga_annotations
    WHERE user_id = ? AND book_id = ? AND page_number = ?
  `, [userId, bookId, pageNumber]);
  return c.json({ ok: true, book_id: bookId, page_number: pageNumber });
});

app.delete('/api/user/manga/:book_id/chunks', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');
  await initTursoSchema(c);
  await queryTurso(c, `DELETE FROM user_manga_chunks WHERE user_id = ? AND book_id = ?`, [userId, bookId]);
  await queryTurso(c, `DELETE FROM user_manga_upload_manifests WHERE user_id = ? AND book_id = ?`, [userId, bookId]);
  return c.json({ ok: true, book_id: bookId });
});

// Pre-baked Manga OCR Endpoints
app.post('/api/user/manga/ocr/batch', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const body = await c.req.json();
  const bookId = body.book_id || body.bookId;
  const pages = body.pages;

  if (!bookId || !Array.isArray(pages)) {
    return c.json({ error: 'Invalid payload: book_id and pages array required' }, 400);
  }

  await initTursoSchema(c);
  const now = Math.floor(Date.now() / 1000);
  for (const p of pages) {
    const pageNum = Number(p.page_number ?? p.page ?? 1);
    const bubblesJson = typeof p.bubbles === 'object' ? JSON.stringify(p.bubbles) : (typeof p === 'object' ? JSON.stringify(p) : '[]');
    await queryTurso(c, `
      INSERT INTO user_manga_ocr_pages (user_id, book_id, page_number, bubbles_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, book_id, page_number) DO UPDATE SET
        bubbles_json = excluded.bubbles_json,
        updated_at = excluded.updated_at
    `, [userId, bookId, pageNum, bubblesJson, now]);
  }

  return c.json({ ok: true, book_id: bookId, count: pages.length });
});

app.get('/api/user/manga/ocr/:book_id', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');

  await initTursoSchema(c);
  const res = await queryTurso(c, `
    SELECT page_number, bubbles_json, updated_at FROM user_manga_ocr_pages
    WHERE user_id = ? AND book_id = ?
    ORDER BY page_number ASC
  `, [userId, bookId]);

  const rows = res?.rows || [];
  const pages = rows.map(r => {
    let bubbles = [];
    try {
      const raw = String((r[1]?.value ?? r[1]) || '[]');
      const parsed = JSON.parse(raw);
      bubbles = Array.isArray(parsed) ? parsed : (parsed?.bubbles || []);
    } catch (_) {}
    return {
      page_number: Number(r[0]?.value ?? r[0]),
      bubbles,
      updated_at: Number((r[2]?.value ?? r[2]) || 0)
    };
  });

  return c.json({ ok: true, book_id: bookId, pages });
});

app.delete('/api/user/manga/ocr/:book_id', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.sub;
  const bookId = c.req.param('book_id');

  await initTursoSchema(c);
  await queryTurso(c, `DELETE FROM user_manga_ocr_pages WHERE user_id = ? AND book_id = ?`, [userId, bookId]);
  return c.json({ ok: true, book_id: bookId });
});

// ---------------------------------------------------------------------------
// Direct Edge Anime Tracker Endpoints (Turso libSQL — avoids Render JWT mismatch/cold-start)
// ---------------------------------------------------------------------------
function _isTestFixtureSeries(name) {
  const s = String(name || '').trim().toLowerCase();
  return !s || s === 'test-series' || s === 'test-anime' || s.startsWith('test_') || s.startsWith('test-') || s.startsWith('mock-');
}

function _cellVal(cell, fallback = null) {
  if (cell === null || cell === undefined) return fallback;
  if (typeof cell === 'object' && 'value' in cell) return cell.value ?? fallback;
  return cell;
}

app.get('/api/link/series', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const mediaFilter = (c.req.query('media_type') || '').trim().toLowerCase();

  await initTursoSchema(c);
  const progRes = await queryTurso(c, `
    SELECT
      p.series_id, p.episode_number, p.last_position_ms, p.duration_ms,
      p.completed, p.mined_card_count, p.last_watched_at, p.poster_url,
      p.series_title, p.title_native, p.title_english, p.synopsis, p.media_type,
      COALESCE(NULLIF(p.cue_hash, ''), c.cue_hash, '') AS cue_hash,
      CASE WHEN c.cue_hash IS NOT NULL THEN 1 ELSE 0 END AS has_cues,
      COALESCE(c.known_pct, 0.0) AS known_pct,
      COALESCE(c.title, '') AS cue_title
    FROM user_anime_progress p
    LEFT JOIN user_episode_cues c
      ON c.user_id = p.user_id
      AND (
        (p.cue_hash != '' AND c.cue_hash = p.cue_hash)
        OR (c.series = p.series_id AND c.episode_number = p.episode_number)
      )
    WHERE p.user_id = ?
    ORDER BY p.last_watched_at DESC
  `, [userId]);

  const seriesMap = new Map();
  const seenCues = new Set();

  for (const r of (progRes?.rows || [])) {
    const seriesId = String(_cellVal(r[0], ''));
    const epNum = Number(_cellVal(r[1], 1)) || 1;
    const lastPos = Number(_cellVal(r[2], 0)) || 0;
    const durMs = Number(_cellVal(r[3], 0)) || 0;
    const completed = Boolean(Number(_cellVal(r[4], 0)));
    const minedCount = Number(_cellVal(r[5], 0)) || 0;
    const lastWatched = Number(_cellVal(r[6], 0)) || 0;
    const posterUrl = String(_cellVal(r[7], '') || '');
    const seriesTitle = String(_cellVal(r[8], '') || '');
    const titleNative = String(_cellVal(r[9], '') || '');
    const titleEnglish = String(_cellVal(r[10], '') || '');
    const synopsis = String(_cellVal(r[11], '') || '');
    const mediaType = String(_cellVal(r[12], 'anime') || 'anime');
    const cueHash = String(_cellVal(r[13], '') || '');
    const hasCues = Boolean(Number(_cellVal(r[14], 0)));
    const knownPct = Number(_cellVal(r[15], 0)) || 0;
    const cueTitle = String(_cellVal(r[16], '') || '');

    if (_isTestFixtureSeries(seriesId) && _isTestFixtureSeries(seriesTitle)) continue;
    const sName = seriesTitle || seriesId || 'Anime';
    if (!seriesMap.has(sName)) {
      seriesMap.set(sName, {
        series: sName,
        title_english: titleEnglish || sName,
        title_native: titleNative || '',
        media_type: mediaType,
        poster_url: posterUrl,
        synopsis,
        episodes: [],
      });
    }
    const actualHash = cueHash || `${seriesId}_ep${epNum}`;
    if (actualHash) seenCues.add(actualHash);
    seriesMap.get(sName).episodes.push({
      hash: actualHash,
      title: cueTitle || `Episode ${epNum}`,
      site: 'generic',
      known_pct: knownPct,
      last_position_ms: lastPos,
      duration_ms: durMs,
      mined: minedCount,
      minutes: Math.round((durMs / 60000) * 10) / 10,
      ts: lastWatched ? String(lastWatched) : '',
      completed,
      last_watched_at: lastWatched,
      has_cues: hasCues || Boolean(cueHash),
      episode_number: epNum,
    });
  }

  try {
    const cuesRes = await queryTurso(c, `
      SELECT cue_hash, title, series, episode_number, site, media_type, duration_ms, known_pct, updated_at
      FROM user_episode_cues
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `, [userId]);
    for (const r of (cuesRes?.rows || [])) {
      const cHash = String(_cellVal(r[0], '') || '');
      if (!cHash || seenCues.has(cHash)) continue;
      const sName = String(_cellVal(r[2], '') || 'Anime');
      if (_isTestFixtureSeries(sName)) continue;
      const epNum = Number(_cellVal(r[3], 1)) || 1;
      const site = String(_cellVal(r[4], 'generic') || 'generic');
      const mediaType = String(_cellVal(r[5], 'anime') || 'anime');
      const durMs = Number(_cellVal(r[6], 0)) || 0;
      const knownPct = Number(_cellVal(r[7], 0)) || 0;
      const updatedAt = Number(_cellVal(r[8], 0)) || 0;
      const cTitle = String(_cellVal(r[1], '') || '');
      if (!seriesMap.has(sName)) {
        seriesMap.set(sName, {
          series: sName,
          title_english: sName,
          title_native: '',
          media_type: mediaType,
          poster_url: '',
          synopsis: '',
          episodes: [],
        });
      }
      seriesMap.get(sName).episodes.push({
        hash: cHash,
        title: cTitle || `Episode ${epNum}`,
        site,
        known_pct: knownPct,
        last_position_ms: 0,
        duration_ms: durMs,
        mined: 0,
        minutes: Math.round((durMs / 60000) * 10) / 10,
        ts: updatedAt ? String(updatedAt) : '',
        completed: false,
        last_watched_at: updatedAt,
        has_cues: true,
        episode_number: epNum,
      });
    }
  } catch (_) {}

  let groups = Array.from(seriesMap.values()).map(g => {
    const epByNum = new Map();
    for (const ep of (g.episodes || [])) {
      const epNum = Number(ep.episode_number || 1) || 1;
      const prev = epByNum.get(epNum);
      if (!prev) {
        epByNum.set(epNum, { ...ep, episode_number: epNum });
      } else {
        prev.last_position_ms = Math.max(Number(prev.last_position_ms || 0), Number(ep.last_position_ms || 0));
        prev.duration_ms = Math.max(Number(prev.duration_ms || 0), Number(ep.duration_ms || 0));
        prev.minutes = Math.round((prev.duration_ms / 60000) * 10) / 10;
        prev.completed = Boolean(prev.completed || ep.completed);
        prev.mined = Math.max(Number(prev.mined || 0), Number(ep.mined || 0));
        prev.known_pct = Math.max(Number(prev.known_pct || 0), Number(ep.known_pct || 0));
        if (ep.has_cues && !prev.has_cues) {
          prev.has_cues = true;
          if (ep.hash) prev.hash = ep.hash;
        }
        if (!prev.title || /^Episode \d+$/i.test(prev.title)) {
          if (ep.title) prev.title = ep.title;
        }
      }
    }
    return {
      ...g,
      episodes: Array.from(epByNum.values()).sort((a, b) => a.episode_number - b.episode_number),
    };
  });
  if (mediaFilter && mediaFilter !== 'all') {
    groups = groups.filter(g => (g.media_type || 'anime').toLowerCase() === mediaFilter);
  }
  return c.json(groups);
});

app.get('/api/link/sessions', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  return c.json([]);
});

app.get('/api/link/episodes', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '200', 10) || 200));

  await initTursoSchema(c);
  const res = await queryTurso(c, `
    SELECT cue_hash, title, series, episode_number, episode_key, site, media_type, duration_ms, known_pct, total_lines, updated_at
    FROM user_episode_cues
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `, [userId, limit]);

  const episodes = (res?.rows || []).map(r => ({
    hash: String(_cellVal(r[0], '')),
    title: String(_cellVal(r[1], '')),
    series: String(_cellVal(r[2], '')),
    episode_number: Number(_cellVal(r[3], 1)) || 1,
    episode_key: String(_cellVal(r[4], '')),
    site: String(_cellVal(r[5], 'generic')),
    media_type: String(_cellVal(r[6], 'anime')),
    duration_ms: Number(_cellVal(r[7], 0)) || 0,
    known_pct: Number(_cellVal(r[8], 0)) || 0,
    total_lines: Number(_cellVal(r[9], 0)) || 0,
    updated_at: Number(_cellVal(r[10], 0)) || 0,
  }));
  return c.json({ episodes });
});

app.get('/api/link/episodes/:cue_hash/cues', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const cueHash = c.req.param('cue_hash');

  await initTursoSchema(c);
  const res = await queryTurso(c, `
    SELECT cue_hash, title, series, episode_number, episode_key, site, media_type, cues_json, duration_ms, mined_words_json, known_pct, total_lines, updated_at
    FROM user_episode_cues
    WHERE user_id = ? AND cue_hash = ?
    LIMIT 1
  `, [userId, cueHash]);
  const r = res?.rows?.[0];
  if (!r) return c.json({ error: 'Episode not found' }, 404);
  let cues = [];
  let minedWords = [];
  try { cues = JSON.parse(String(_cellVal(r[7], '[]') || '[]')); } catch (_) {}
  try { minedWords = JSON.parse(String(_cellVal(r[9], '[]') || '[]')); } catch (_) {}
  return c.json({
    hash: String(_cellVal(r[0], cueHash)),
    title: String(_cellVal(r[1], '')),
    series: String(_cellVal(r[2], '')),
    episode_number: Number(_cellVal(r[3], 1)) || 1,
    episode_key: String(_cellVal(r[4], '')),
    site: String(_cellVal(r[5], 'generic')),
    media_type: String(_cellVal(r[6], 'anime')),
    cues,
    duration_ms: Number(_cellVal(r[8], 0)) || 0,
    mined_words: minedWords,
    known_pct: Number(_cellVal(r[10], 0)) || 0,
    total_lines: Number(_cellVal(r[11], 0)) || cues.length,
    updated_at: Number(_cellVal(r[12], 0)) || 0,
  });
});

app.delete('/api/link/series/:series_name', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const seriesName = decodeURIComponent(c.req.param('series_name') || '');
  await initTursoSchema(c);
  await queryTurso(c, `DELETE FROM user_anime_progress WHERE user_id = ? AND (series_id = ? OR series_title = ?)`, [userId, seriesName, seriesName]);
  await queryTurso(c, `DELETE FROM user_episode_cues WHERE user_id = ? AND series = ?`, [userId, seriesName]);
  return c.json({ deleted: true, series: seriesName });
});

app.delete('/api/link/episodes/:cue_hash', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const cueHash = decodeURIComponent(c.req.param('cue_hash') || '');
  await initTursoSchema(c);
  await queryTurso(c, `DELETE FROM user_anime_progress WHERE user_id = ? AND cue_hash = ?`, [userId, cueHash]);
  await queryTurso(c, `DELETE FROM user_episode_cues WHERE user_id = ? AND cue_hash = ?`, [userId, cueHash]);
  return c.json({ deleted: true, hash: cueHash });
});

function _normSeriesSlug(str) {
  return String(str || '').trim().toLowerCase().replace(/[\s\-_!?:;.,'"()[\]{}]+/g, '');
}

const _CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '形状詞', '副詞']);
const _EXCLUDED_POS = new Set(['助詞', '助動詞', '補助記号', '記号', '接頭辞', '接尾辞', '連体詞', '感動詞', '空白']);
const _FUNCTION_WORDS = new Set([
  'いる', 'ある', 'する', 'なる', 'できる', 'れる', 'られる', 'せる', 'させる',
  'ない', 'たい', 'よう', 'こと', 'もの', 'ところ', 'ため', 'はず', 'わけ',
  'これ', 'それ', 'あれ', 'どれ', 'この', 'その', 'あの', 'どの', 'ここ', 'そこ', 'あそこ', 'どこ'
]);
const _LEVEL_PRIORITY = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };
const _JP_CHAR_RE = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/;
const _KANJI_CHAR_RE = /[\u4e00-\u9fff]/;

async function _getSeriesMinedCardsFromTurso(c, userId, seriesName) {
  const sNorm = String(seriesName || '').trim().toLowerCase();
  const sSlug = _normSeriesSlug(seriesName);
  const aliases = new Set([sNorm].filter(Boolean));
  const aliasSlugs = new Set([sSlug].filter(Boolean));
  const seriesCueHashes = new Set();

  try {
    const cueRows = await queryTurso(
      c,
      `SELECT cue_hash, series FROM user_episode_cues WHERE user_id = ?`,
      [userId]
    );
    for (const r of (cueRows?.rows || [])) {
      const ch = String(_cellVal(r[0], '') || '').trim();
      const cs = String(_cellVal(r[1], '') || '').trim();
      const csNorm = cs.toLowerCase();
      const csSlug = _normSeriesSlug(cs);
      if (csNorm === sNorm || (sSlug && csSlug === sSlug) || (sNorm && csNorm.includes(sNorm))) {
        if (ch) seriesCueHashes.add(ch.toLowerCase());
        if (csNorm) aliases.add(csNorm);
        if (csSlug) aliasSlugs.add(csSlug);
      }
    }
  } catch (_) {}

  try {
    const progRows = await queryTurso(
      c,
      `SELECT series_id, series_title, title_native, title_english, cue_hash FROM user_anime_progress WHERE user_id = ?`,
      [userId]
    );
    for (const r of (progRows?.rows || [])) {
      const vals = [0, 1, 2, 3].map(i => String(_cellVal(r[i], '') || '').trim()).filter(Boolean);
      const ch = String(_cellVal(r[4], '') || '').trim();
      const matches = vals.some(v => {
        const vn = v.toLowerCase();
        const vs = _normSeriesSlug(v);
        return vn === sNorm || (sSlug && vs === sSlug) || (sNorm && vn.includes(sNorm));
      });
      if (matches) {
        for (const v of vals) {
          aliases.add(v.toLowerCase());
          const vs = _normSeriesSlug(v);
          if (vs) aliasSlugs.add(vs);
        }
        if (ch) seriesCueHashes.add(ch.toLowerCase());
      }
    }
  } catch (_) {}

  const opRows = await queryTurso(
    c,
    `SELECT payload FROM user_op_log WHERE user_id = ? AND op_type IN ('card_save', 'save_card') ORDER BY rowid DESC LIMIT 10000`,
    [userId]
  );

  const matched = [];
  const seenKeys = new Set();
  for (const r of (opRows?.rows || [])) {
    const raw = _cellVal(r[0], '');
    if (!raw) continue;
    let card;
    try { card = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { continue; }
    if (!card || typeof card !== 'object') continue;

    const haystacks = [
      card.series,
      card.series_title,
      card.source_url,
      card.source_text,
      card.tags,
      card.notes,
      card.deck_name,
      card.episode_hash,
      card.cue_hash,
    ].map(v => String(v || '').toLowerCase()).filter(Boolean);

    const epHash = String(card.episode_hash || card.cue_hash || '').trim().toLowerCase();
    let isMatch = Boolean(epHash && seriesCueHashes.has(epHash));
    if (!isMatch) {
      for (const h of haystacks) {
        const hSlug = _normSeriesSlug(h);
        for (const a of aliases) {
          if (a && h.includes(a)) { isMatch = true; break; }
        }
        if (isMatch) break;
        for (const as of aliasSlugs) {
          if (as && as.length >= 2 && hSlug.includes(as)) { isMatch = true; break; }
        }
        if (isMatch) break;
        for (const ch of seriesCueHashes) {
          if (ch && h.includes(ch)) { isMatch = true; break; }
        }
        if (isMatch) break;
      }
    }

    if (!isMatch) continue;
    const dedupKey = String(card.id || `${card.expression || ''}|${card.reading || ''}|${card.example_sentence || ''}`);
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    matched.push({
      id: card.id,
      expression: card.expression || '',
      reading: card.reading || '',
      meaning: card.meaning || '',
      image: card.image || '',
      audio: card.audio || '',
      example_sentence: card.example_sentence || '',
      source_text: card.source_text || '',
      deck_name: card.deck_name || 'Default',
      tags: card.tags || '',
      source_url: card.source_url || '',
      created_at: card.created_at || '',
      sync_status: card.sync_status || 'synced',
    });
  }
  return matched;
}

app.get('/api/link/series/:series_name/cards', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const seriesName = decodeURIComponent(c.req.param('series_name') || '').trim();
  await initTursoSchema(c);
  const cards = await _getSeriesMinedCardsFromTurso(c, userId, seriesName);
  return c.json(cards);
});

app.get('/api/link/episodes/:cue_hash/inspect', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const cueHash = decodeURIComponent(c.req.param('cue_hash') || '').trim();
  const learnerLevel = (c.req.query('learner_level') || 'N3').toUpperCase();
  const learnerPri = _LEVEL_PRIORITY[learnerLevel] || 3;

  await initTursoSchema(c);

  let cueRes = await queryTurso(
    c,
    `SELECT cue_hash, title, series, episode_number, episode_key, site, media_type, cues_json, duration_ms, mined_words_json, known_pct, total_lines, updated_at, COALESCE(grammar_points_json, '[]')
     FROM user_episode_cues WHERE user_id = ? AND cue_hash = ? LIMIT 1`,
    [userId, cueHash]
  );
  let row = cueRes?.rows?.[0];

  let epRecord = {
    hash: cueHash,
    title: row ? String(_cellVal(row[1], 'Episode')) : 'Episode',
    series: row ? String(_cellVal(row[2], '')) : '',
    episode_number: row ? (Number(_cellVal(row[3], 1)) || 1) : 1,
    episode_key: row ? String(_cellVal(row[4], '')) : '',
    site: row ? String(_cellVal(row[5], 'generic')) : 'generic',
    media_type: row ? String(_cellVal(row[6], 'anime')) : 'anime',
    duration_ms: row ? (Number(_cellVal(row[8], 0)) || 0) : 0,
    known_pct: row ? (Number(_cellVal(row[10], 0)) || 0) : 0,
    mined: 0,
    minutes: 0,
    last_position_ms: 0,
    ts: '',
  };

  if (!epRecord.series || !row) {
    try {
      const progRes = await queryTurso(
        c,
        `SELECT series_id, series_title, episode_number, duration_ms, last_position_ms, mined_card_count, poster_url, media_type
         FROM user_anime_progress WHERE user_id = ? AND cue_hash = ? LIMIT 1`,
        [userId, cueHash]
      );
      const pr = progRes?.rows?.[0];
      if (pr) {
        epRecord.series = epRecord.series || String(_cellVal(pr[1], '') || _cellVal(pr[0], '') || '');
        epRecord.episode_number = Number(_cellVal(pr[2], epRecord.episode_number)) || 1;
        epRecord.duration_ms = Number(_cellVal(pr[3], epRecord.duration_ms)) || 0;
        epRecord.last_position_ms = Number(_cellVal(pr[4], 0)) || 0;
        epRecord.mined = Number(_cellVal(pr[5], 0)) || 0;
        epRecord.poster_url = String(_cellVal(pr[6], '') || '');
        epRecord.media_type = String(_cellVal(pr[7], epRecord.media_type)) || 'anime';
      }
    } catch (_) {}
  }

  // Fallback: if cueHash has no direct cues row (e.g. 'k-on_ep1' vs 'file_...'), find matching series+episode cues
  if (!row && epRecord.series) {
    try {
      const allSeriesCues = await queryTurso(
        c,
        `SELECT cue_hash, title, series, episode_number, episode_key, site, media_type, cues_json, duration_ms, mined_words_json, known_pct, total_lines, updated_at, COALESCE(grammar_points_json, '[]')
         FROM user_episode_cues WHERE user_id = ? AND episode_number = ? ORDER BY total_lines DESC LIMIT 20`,
        [userId, epRecord.episode_number]
      );
      const targetSlug = _normSeriesSlug(epRecord.series);
      for (const candidate of (allSeriesCues?.rows || [])) {
        const cSeries = String(_cellVal(candidate[2], '') || '');
        const cSlug = _normSeriesSlug(cSeries);
        if (cSeries.toLowerCase() === epRecord.series.toLowerCase() || (targetSlug && cSlug && (cSlug === targetSlug || cSlug.includes(targetSlug) || targetSlug.includes(cSlug)))) {
          row = candidate;
          epRecord.title = String(_cellVal(row[1], epRecord.title));
          epRecord.known_pct = Number(_cellVal(row[10], epRecord.known_pct)) || 0;
          break;
        }
      }
    } catch (_) {}
  }

  let cues = [];
  let minedWords = [];
  let grammarPoints = [];
  if (row) {
    try { cues = JSON.parse(String(_cellVal(row[7], '[]') || '[]')); } catch (_) { cues = []; }
    try { minedWords = JSON.parse(String(_cellVal(row[9], '[]') || '[]')); } catch (_) { minedWords = []; }
    try { grammarPoints = JSON.parse(String(_cellVal(row[13], '[]') || '[]')); } catch (_) { grammarPoints = []; }
  }
  epRecord.minutes = Math.round((epRecord.duration_ms / 60000) * 10) / 10;

  const minedCards = epRecord.series
    ? await _getSeriesMinedCardsFromTurso(c, userId, epRecord.series)
    : [];

  const hasAnnotatedTokens = Array.isArray(cues) && cues.some(q => Array.isArray(q?.tokens) && q.tokens.length > 0);

  // If cues exist without tokens, try Render once for full Sudachi analysis; fall back to Turso response if Render fails
  if (Array.isArray(cues) && cues.length > 0 && !hasAnnotatedTokens && c.env?.RENDER_BACKEND_URL) {
    try {
      const renderBase = c.env.RENDER_BACKEND_URL.replace(/\/$/, '');
      const url = new URL(c.req.url);
      const targetUrl = `${renderBase}${url.pathname}${url.search}`;
      const cookies = parseCookies(c.req.header('Cookie') || '');
      const hdrs = new Headers({ Accept: 'application/json' });
      const authHdr = c.req.header('Authorization') || (cookies.session ? `Bearer ${cookies.session}` : '');
      if (authHdr) hdrs.set('Authorization', authHdr);
      const rRes = await fetch(targetUrl, { method: 'GET', headers: hdrs, signal: AbortSignal.timeout(7000) });
      if (rRes.ok) {
        const rData = await rRes.json();
        if (rData && rData.cues_available) return c.json(rData);
      }
    } catch (_) {}
  }

  const knownSet = new Set(minedWords.map(w => String(w || '').trim()).filter(Boolean));
  for (const mc of minedCards) {
    if (mc.expression) knownSet.add(mc.expression);
  }
  try {
    const kwRes = await queryTurso(
      c,
      `SELECT word FROM user_known_words WHERE user_id = ? AND status = 'known'`,
      [userId]
    );
    for (const r of (kwRes?.rows || [])) {
      const w = String(_cellVal(r[0], '') || '').trim();
      if (w) knownSet.add(w);
    }
  } catch (_) {}
  try {
    const allCardRes = await queryTurso(
      c,
      `SELECT json_extract(payload, '$.expression'), json_extract(payload, '$.deinflected_text') FROM user_op_log WHERE user_id = ? AND op_type IN ('card_save', 'save_card') LIMIT 5000`,
      [userId]
    );
    for (const r of (allCardRes?.rows || [])) {
      const e1 = String(_cellVal(r[0], '') || '').trim();
      const e2 = String(_cellVal(r[1], '') || '').trim();
      if (e1) knownSet.add(e1);
      if (e2) knownSet.add(e2);
    }
  } catch (_) {}

  const levelCounts = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0, Unranked: 0 };
  const allWordsMap = new Map();
  const gapWordsMap = new Map();

  for (const cue of (Array.isArray(cues) ? cues : [])) {
    const cueText = String(cue?.text || '').trim();
    const cueImage = cue?.image || cue?.snapshot || '';
    for (const tok of (Array.isArray(cue?.tokens) ? cue.tokens : [])) {
      const surface = String(tok?.surface || '').trim();
      if (!surface) continue;
      const posVal = tok?.pos;
      const posHead = Array.isArray(posVal)
        ? String(posVal[0] || '')
        : String(posVal || '').split(/[-,]/)[0].trim();
      if (_EXCLUDED_POS.has(posHead) || (posHead && !_CONTENT_POS.has(posHead))) continue;
      if (!_JP_CHAR_RE.test(surface)) continue;
      if (surface.length <= 1 && !_KANJI_CHAR_RE.test(surface)) continue;

      const lemma = String(tok?.lemma || surface).trim() || surface;
      if (_FUNCTION_WORDS.has(surface) || _FUNCTION_WORDS.has(lemma)) continue;
      const tokLevel = String(tok?.jlpt_level || tok?.jlpt || 'Unranked');
      levelCounts[tokLevel] = (levelCounts[tokLevel] || 0) + 1;

      const reading = String(tok?.reading || tok?.canonical_reading || surface);
      const meaning = String(tok?.meaning || tok?.gloss || '');

      if (!allWordsMap.has(lemma)) {
        allWordsMap.set(lemma, {
          word: lemma,
          reading,
          meaning,
          jlpt: tokLevel,
          frequency: 1,
          context_sentence: cueText,
          image: cueImage,
        });
      } else {
        const ex = allWordsMap.get(lemma);
        ex.frequency += 1;
        if (!ex.context_sentence && cueText) ex.context_sentence = cueText;
        if (!ex.image && cueImage) ex.image = cueImage;
      }

      const tokPri = _LEVEL_PRIORITY[tokLevel] || 4;
      const status = String(tok?.status || '').toLowerCase();
      const isGap = !knownSet.has(lemma) && !knownSet.has(surface) && (
        status === 'gap' || status === 'should_know' || status === 'unknown' || (!status && tokPri >= learnerPri)
      );
      if (isGap) {
        if (!gapWordsMap.has(lemma)) {
          gapWordsMap.set(lemma, {
            word: lemma,
            reading,
            meaning,
            jlpt: tokLevel,
            is_known: false,
            frequency: 1,
            context_sentence: cueText,
            image: cueImage,
          });
        } else {
          const gx = gapWordsMap.get(lemma);
          gx.frequency += 1;
          if (!gx.context_sentence && cueText) gx.context_sentence = cueText;
          if (!gx.image && cueImage) gx.image = cueImage;
        }
      }
    }
  }

  const totalCounted = Object.values(levelCounts).reduce((a, b) => a + b, 0) || 1;
  const pct = (k) => Math.round(((levelCounts[k] || 0) / totalCounted) * 1000) / 10;
  const totalRanked = (levelCounts.N5 + levelCounts.N4 + levelCounts.N3 + levelCounts.N2 + levelCounts.N1);
  let overallLevel = (Array.isArray(cues) && cues.length > 0) ? 'N4' : 'Unknown';
  if (totalRanked > 0) {
    const r1 = levelCounts.N1 / totalRanked;
    const r2 = levelCounts.N2 / totalRanked;
    const r3 = levelCounts.N3 / totalRanked;
    const r4 = levelCounts.N4 / totalRanked;
    const n2Plus = r1 + r2;
    const n3Plus = n2Plus + r3;
    if (r1 >= 0.15 || n2Plus >= 0.28) overallLevel = 'N1';
    else if (n2Plus >= 0.16 || n3Plus >= 0.40) overallLevel = 'N2';
    else if (n3Plus >= 0.22 || (n3Plus + r4) >= 0.60) overallLevel = 'N3';
    else if ((n3Plus + r4) >= 0.30 || r4 >= 0.20) overallLevel = 'N4';
    else overallLevel = 'N5';
  }

  const allWords = Array.from(allWordsMap.values()).sort((a, b) => b.frequency - a.frequency).slice(0, 500);
  const missedWords = Array.from(gapWordsMap.values()).sort((a, b) => b.frequency - a.frequency).slice(0, 200);
  const cuesAvailable = Array.isArray(cues) && cues.length > 0;

  return c.json({
    episode_record: epRecord,
    difficulty: {
      overall_level: overallLevel,
      target_learner_level: learnerLevel,
      n5_pct: pct('N5'),
      n4_pct: pct('N4'),
      n3_pct: pct('N3'),
      n2_pct: pct('N2'),
      n1_pct: pct('N1'),
      unranked_pct: pct('Unranked'),
      unique_words_count: allWordsMap.size,
    },
    missed_words: missedWords,
    all_words: allWords,
    grammar_points: Array.isArray(grammarPoints) ? grammarPoints : [],
    mined_cards: minedCards,
    target_learner_level: learnerLevel,
    cues_available: cuesAvailable,
    cue_count: Array.isArray(cues) ? cues.length : 0,
  });
});

app.get('/api/user/progress/anime', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const seriesIdFilter = (c.req.query('series_id') || '').trim();
  await initTursoSchema(c);

  const sql = seriesIdFilter
    ? `SELECT series_id, episode_number, last_position_ms, duration_ms, completed, mined_card_count, last_watched_at, poster_url, series_title, title_native, title_english, synopsis, media_type, cue_hash
       FROM user_anime_progress WHERE user_id = ? AND series_id = ? ORDER BY episode_number ASC`
    : `SELECT series_id, episode_number, last_position_ms, duration_ms, completed, mined_card_count, last_watched_at, poster_url, series_title, title_native, title_english, synopsis, media_type, cue_hash
       FROM user_anime_progress WHERE user_id = ? ORDER BY last_watched_at DESC`;
  const args = seriesIdFilter ? [userId, seriesIdFilter] : [userId];
  const res = await queryTurso(c, sql, args);

  const progress = [];
  for (const r of (res?.rows || [])) {
    const seriesId = String(_cellVal(r[0], ''));
    const seriesTitle = String(_cellVal(r[8], ''));
    if (_isTestFixtureSeries(seriesId) && _isTestFixtureSeries(seriesTitle)) continue;
    progress.push({
      series_id: seriesId,
      episode_number: Number(_cellVal(r[1], 1)) || 1,
      last_position_ms: Number(_cellVal(r[2], 0)) || 0,
      duration_ms: Number(_cellVal(r[3], 0)) || 0,
      completed: Number(_cellVal(r[4], 0)) || 0,
      mined_card_count: Number(_cellVal(r[5], 0)) || 0,
      last_watched_at: Number(_cellVal(r[6], 0)) || 0,
      poster_url: String(_cellVal(r[7], '') || ''),
      series_title: seriesTitle,
      title_native: String(_cellVal(r[9], '') || ''),
      title_english: String(_cellVal(r[10], '') || ''),
      synopsis: String(_cellVal(r[11], '') || ''),
      media_type: String(_cellVal(r[12], 'anime') || 'anime'),
      cue_hash: String(_cellVal(r[13], '') || ''),
    });
  }
  return c.json({ progress });
});

app.post('/api/user/progress/anime', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const r = await c.req.json().catch(() => ({}));
  if (_isTestFixtureSeries(r?.series_id)) return c.json({ ok: true, persisted: false, test_ignored: true });

  await initTursoSchema(c);
  const nowMs = Date.now();
  const lastWatched = Number(r.last_watched_at || nowMs);
  await queryTurso(c, `
    INSERT INTO user_anime_progress (
      user_id, series_id, episode_number, last_position_ms, duration_ms,
      completed, mined_card_count, last_watched_at, poster_url,
      series_title, title_native, title_english, synopsis, media_type, cue_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, series_id, episode_number) DO UPDATE SET
      last_position_ms = MAX(user_anime_progress.last_position_ms, excluded.last_position_ms),
      duration_ms = MAX(user_anime_progress.duration_ms, excluded.duration_ms),
      completed = MAX(user_anime_progress.completed, excluded.completed),
      mined_card_count = MAX(user_anime_progress.mined_card_count, excluded.mined_card_count),
      last_watched_at = excluded.last_watched_at,
      poster_url = CASE WHEN excluded.poster_url != '' THEN excluded.poster_url ELSE user_anime_progress.poster_url END,
      series_title = CASE WHEN excluded.series_title != '' THEN excluded.series_title ELSE user_anime_progress.series_title END,
      title_native = CASE WHEN excluded.title_native != '' THEN excluded.title_native ELSE user_anime_progress.title_native END,
      title_english = CASE WHEN excluded.title_english != '' THEN excluded.title_english ELSE user_anime_progress.title_english END,
      synopsis = CASE WHEN LENGTH(excluded.synopsis) > LENGTH(user_anime_progress.synopsis) THEN excluded.synopsis ELSE user_anime_progress.synopsis END,
      media_type = excluded.media_type,
      cue_hash = CASE WHEN excluded.cue_hash != '' THEN excluded.cue_hash ELSE user_anime_progress.cue_hash END
  `, [
    userId, String(r.series_id || 'Anime'), Number(r.episode_number || 1),
    Number(r.last_position_ms || 0), Number(r.duration_ms || 0), r.completed ? 1 : 0,
    Number(r.mined_card_count || 0), lastWatched,
    String(r.poster_url || ''), String(r.series_title || ''), String(r.title_native || ''),
    String(r.title_english || ''), String(r.synopsis || ''), String(r.media_type || 'anime'),
    String(r.cue_hash || '')
  ]);
  return c.json({ ok: true, persisted: true });
});

app.post('/api/user/progress/anime/batch', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const body = await c.req.json().catch(() => ({}));
  const list = Array.isArray(body?.progress)
    ? body.progress
    : (Array.isArray(body?.anime_progress) ? body.anime_progress : []);

  await initTursoSchema(c);
  const nowMs = Date.now();
  const stmts = [];
  for (const r of list) {
    if (!r || _isTestFixtureSeries(r.series_id)) continue;
    stmts.push({
      sql: `
        INSERT INTO user_anime_progress (
          user_id, series_id, episode_number, last_position_ms, duration_ms,
          completed, mined_card_count, last_watched_at, poster_url,
          series_title, title_native, title_english, synopsis, media_type, cue_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, series_id, episode_number) DO UPDATE SET
          last_position_ms = MAX(user_anime_progress.last_position_ms, excluded.last_position_ms),
          duration_ms = MAX(user_anime_progress.duration_ms, excluded.duration_ms),
          completed = MAX(user_anime_progress.completed, excluded.completed),
          mined_card_count = MAX(user_anime_progress.mined_card_count, excluded.mined_card_count),
          last_watched_at = excluded.last_watched_at,
          poster_url = CASE WHEN excluded.poster_url != '' THEN excluded.poster_url ELSE user_anime_progress.poster_url END,
          series_title = CASE WHEN excluded.series_title != '' THEN excluded.series_title ELSE user_anime_progress.series_title END,
          title_native = CASE WHEN excluded.title_native != '' THEN excluded.title_native ELSE user_anime_progress.title_native END,
          title_english = CASE WHEN excluded.title_english != '' THEN excluded.title_english ELSE user_anime_progress.title_english END,
          synopsis = CASE WHEN LENGTH(excluded.synopsis) > LENGTH(user_anime_progress.synopsis) THEN excluded.synopsis ELSE user_anime_progress.synopsis END,
          media_type = excluded.media_type,
          cue_hash = CASE WHEN excluded.cue_hash != '' THEN excluded.cue_hash ELSE user_anime_progress.cue_hash END
      `,
      args: [
        userId, String(r.series_id || 'Anime'), Number(r.episode_number || 1),
        Number(r.last_position_ms || 0), Number(r.duration_ms || 0), r.completed ? 1 : 0,
        Number(r.mined_card_count || 0), Number(r.last_watched_at || nowMs),
        String(r.poster_url || ''), String(r.series_title || ''), String(r.title_native || ''),
        String(r.title_english || ''), String(r.synopsis || ''), String(r.media_type || 'anime'),
        String(r.cue_hash || '')
      ],
    });
  }
  if (stmts.length > 0) {
    await executeTursoTransaction(c, stmts);
  }
  return c.json({ ok: true, count: stmts.length });
});

app.post('/api/link/episodes/sync', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;

  const body = await c.req.json().catch(() => ({}));
  const cueHash = String(body?.hash || body?.cue_hash || '').trim();
  if (!cueHash) return c.json({ error: 'Bad Request', detail: 'Missing cue hash' }, 400);

  const rawCues = Array.isArray(body?.cues) ? body.cues : [];
  if (rawCues.length > 5000) {
    return c.json({ error: 'Payload Too Large', detail: 'Subtitle payload exceeds maximum 5000 cues' }, 413);
  }

  const cleanedCues = rawCues.map((q, idx) => {
    const out = {
      i: q?.i ?? idx,
      s: Number(q?.s ?? q?.startTime ?? 0) || 0,
      e: Number(q?.e ?? q?.endTime ?? 0) || 0,
      text: String(q?.text || '').slice(0, 2000),
    };
    if (q?.image) out.image = q.image;
    if (Array.isArray(q?.tokens) && q.tokens.length > 0) {
      out.tokens = q.tokens.map(t => ({
        surface: t?.surface || t?.text || '',
        lemma: t?.lemma || t?.surface || '',
        reading: t?.reading || '',
        pos: Array.isArray(t?.pos) ? (t.pos[0] || '') : (t?.pos || ''),
        jlpt_level: t?.jlpt_level || t?.jlpt || '',
        status: t?.status || 'unstyled',
        meaning: t?.meaning || t?.gloss || '',
      }));
    }
    return out;
  });

  await initTursoSchema(c);

  let mergedMinedWords = Array.from(new Set((Array.isArray(body?.mined_words) ? body.mined_words : []).filter(Boolean).map(String)));
  try {
    const prevRes = await queryTurso(
      c,
      `SELECT mined_words_json, known_pct FROM user_episode_cues WHERE user_id = ? AND cue_hash = ? LIMIT 1`,
      [userId, cueHash]
    );
    const pr = prevRes?.rows?.[0];
    if (pr) {
      try {
        const prevWords = JSON.parse(String(_cellVal(pr[0], '[]') || '[]'));
        if (Array.isArray(prevWords)) {
          mergedMinedWords = Array.from(new Set([...prevWords, ...mergedMinedWords]));
        }
      } catch (_) {}
    }
  } catch (_) {}

  let knownPct = Number(body?.known_pct || 0) || 0;
  if (knownPct <= 0 && cleanedCues.length > 0) {
    const lemmas = new Set();
    const knownLemmas = new Set(mergedMinedWords);
    try {
      const kwRes = await queryTurso(c, `SELECT word FROM user_known_words WHERE user_id = ? AND status = 'known'`, [userId]);
      for (const r of (kwRes?.rows || [])) {
        const w = String(_cellVal(r[0], '') || '').trim();
        if (w) knownLemmas.add(w);
      }
    } catch (_) {}
    for (const q of cleanedCues) {
      for (const t of (q.tokens || [])) {
        const lem = String(t.lemma || t.surface || '').trim();
        if (!lem || _EXCLUDED_POS.has(t.pos)) continue;
        if (!_JP_CHAR_RE.test(t.surface || lem)) continue;
        lemmas.add(lem);
        if (t.status === 'known' || t.status === 'mined') knownLemmas.add(lem);
      }
    }
    if (lemmas.size > 0) {
      let knownCount = 0;
      for (const l of lemmas) if (knownLemmas.has(l)) knownCount++;
      knownPct = Math.round((knownCount / lemmas.size) * 1000) / 10;
    }
  }

  const _parseEpNum = (explicitVal, titleStr, hashStr) => {
    const num = Number(explicitVal);
    if (Number.isFinite(num) && num > 1) return Math.floor(num);
    for (const src of [String(titleStr || ''), String(hashStr || '')]) {
      const m = src.match(/S\d+E(\d+)/i) ||
        src.match(/(?:episode|ep|e)\s*[-.:]?\s*(\d+)/i) ||
        src.match(/第\s*(\d+)\s*[話回]/) ||
        src.match(/_ep(\d+)/i);
      if (m) {
        const parsed = parseInt(m[1], 10);
        if (Number.isFinite(parsed) && parsed >= 1) return parsed;
      }
    }
    return (Number.isFinite(num) && num >= 1) ? Math.floor(num) : 1;
  };

  const nowTs = Date.now();
  const epNum = _parseEpNum(body?.episode_number, body?.title, cueHash);
  const seriesName = String(body?.series || body?.title || 'Anime');
  const durMs = Number(body?.duration_ms || 0) || 0;
  const cuesJson = JSON.stringify(cleanedCues);
  const minedJson = JSON.stringify(mergedMinedWords);
  const grammarJson = JSON.stringify(Array.isArray(body?.grammar_points) ? body.grammar_points : []);

  await queryTurso(c, `
    INSERT INTO user_episode_cues (
      user_id, cue_hash, title, series, episode_number, episode_key, site, media_type,
      cues_json, duration_ms, mined_words_json, known_pct, total_lines, updated_at, grammar_points_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, cue_hash) DO UPDATE SET
      cues_json = CASE WHEN length(excluded.cues_json) > 2 THEN excluded.cues_json ELSE user_episode_cues.cues_json END,
      title = CASE WHEN excluded.title != '' THEN excluded.title ELSE user_episode_cues.title END,
      series = CASE WHEN excluded.series != '' THEN excluded.series ELSE user_episode_cues.series END,
      episode_number = excluded.episode_number,
      episode_key = CASE WHEN excluded.episode_key != '' THEN excluded.episode_key ELSE user_episode_cues.episode_key END,
      duration_ms = MAX(user_episode_cues.duration_ms, excluded.duration_ms),
      mined_words_json = CASE WHEN excluded.mined_words_json != '[]' THEN excluded.mined_words_json ELSE user_episode_cues.mined_words_json END,
      known_pct = CASE WHEN excluded.known_pct > 0.0 THEN excluded.known_pct ELSE user_episode_cues.known_pct END,
      total_lines = MAX(user_episode_cues.total_lines, excluded.total_lines),
      updated_at = excluded.updated_at,
      grammar_points_json = CASE WHEN excluded.grammar_points_json != '[]' THEN excluded.grammar_points_json ELSE COALESCE(user_episode_cues.grammar_points_json, '[]') END
  `, [
    userId, cueHash, String(body?.title || ''), String(body?.series || ''), epNum,
    String(body?.episode_key || ''), String(body?.site || 'generic'), String(body?.media_type || 'anime'),
    cuesJson, durMs, minedJson, knownPct, cleanedCues.length, nowTs, grammarJson
  ]);

  await queryTurso(c, `
    INSERT INTO user_anime_progress (
      user_id, series_id, episode_number, last_position_ms, duration_ms,
      completed, mined_card_count, last_watched_at, poster_url,
      series_title, title_native, title_english, synopsis, media_type, cue_hash
    ) VALUES (?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, series_id, episode_number) DO UPDATE SET
      duration_ms = MAX(user_anime_progress.duration_ms, excluded.duration_ms),
      mined_card_count = MAX(user_anime_progress.mined_card_count, excluded.mined_card_count),
      last_watched_at = excluded.last_watched_at,
      poster_url = CASE WHEN excluded.poster_url != '' THEN excluded.poster_url ELSE user_anime_progress.poster_url END,
      series_title = CASE WHEN excluded.series_title != '' THEN excluded.series_title ELSE user_anime_progress.series_title END,
      media_type = excluded.media_type,
      cue_hash = CASE WHEN excluded.cue_hash != '' THEN excluded.cue_hash ELSE user_anime_progress.cue_hash END
  `, [
    userId, seriesName, epNum, durMs, mergedMinedWords.length, nowTs,
    String(body?.poster_url || ''), seriesName, String(body?.title_native || ''),
    String(body?.title_english || seriesName), String(body?.synopsis || ''),
    String(body?.media_type || 'anime'), cueHash
  ]);

  return c.json({
    hash: cueHash,
    title: String(body?.title || ''),
    series: String(body?.series || ''),
    site: String(body?.site || 'generic'),
    media_type: String(body?.media_type || 'anime'),
    known_pct: knownPct,
    mined: mergedMinedWords.length,
    minutes: Math.round((durMs / 60000) * 10) / 10,
    duration_ms: durMs,
    has_cues: cleanedCues.length > 0,
    episode_number: epNum,
    cloud_synced: true,
  });
});

app.post('/api/link/episodes/:cue_hash/position', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const cueHash = decodeURIComponent(c.req.param('cue_hash') || '').trim();
  const body = await c.req.json().catch(() => ({}));
  await initTursoSchema(c);

  const nowTs = Date.now();
  let seriesName = String(body?.series || '').trim();
  let epNum = Number(body?.episode_number || 0) || 0;

  if (!seriesName || epNum <= 1) {
    try {
      const cueLookup = await queryTurso(
        c,
        `SELECT series, episode_number FROM user_episode_cues WHERE user_id = ? AND cue_hash = ? LIMIT 1`,
        [userId, cueHash]
      );
      const cr = cueLookup?.rows?.[0];
      if (cr) {
        if (!seriesName) seriesName = String(_cellVal(cr[0], '') || '').trim();
        const dbEp = Number(_cellVal(cr[1], 0)) || 0;
        if (epNum <= 1 && dbEp > 1) epNum = dbEp;
      }
    } catch (_) {}
  }

  if (!seriesName) seriesName = String(body?.title || 'Anime');
  if (epNum <= 1) {
    for (const src of [String(body?.title || ''), cueHash]) {
      const m = src.match(/S\d+E(\d+)/i) ||
        src.match(/(?:episode|ep|e)\s*[-.:]?\s*(\d+)/i) ||
        src.match(/第\s*(\d+)\s*[話回]/) ||
        src.match(/_ep(\d+)/i);
      if (m) {
        const parsed = parseInt(m[1], 10);
        if (Number.isFinite(parsed) && parsed >= 1) {
          epNum = parsed;
          break;
        }
      }
    }
  }
  if (epNum < 1) epNum = 1;

  const posMs = Number(body?.last_position_ms || 0) || 0;
  const durMs = Number(body?.duration_ms || 0) || 0;
  const completed = body?.completed ? 1 : 0;

  await queryTurso(c, `
    INSERT INTO user_anime_progress (
      user_id, series_id, episode_number, last_position_ms, duration_ms,
      completed, mined_card_count, last_watched_at, poster_url,
      series_title, title_native, title_english, synopsis, media_type, cue_hash
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, '', ?, ?, ?, ?)
    ON CONFLICT (user_id, series_id, episode_number) DO UPDATE SET
      last_position_ms = MAX(user_anime_progress.last_position_ms, excluded.last_position_ms),
      duration_ms = MAX(user_anime_progress.duration_ms, excluded.duration_ms),
      completed = MAX(user_anime_progress.completed, excluded.completed),
      last_watched_at = excluded.last_watched_at,
      poster_url = CASE WHEN excluded.poster_url != '' THEN excluded.poster_url ELSE user_anime_progress.poster_url END,
      series_title = CASE WHEN excluded.series_title != '' THEN excluded.series_title ELSE user_anime_progress.series_title END,
      media_type = excluded.media_type,
      cue_hash = CASE WHEN excluded.cue_hash != '' THEN excluded.cue_hash ELSE user_anime_progress.cue_hash END
  `, [
    userId, seriesName, epNum, posMs, durMs, completed, nowTs,
    String(body?.poster_url || ''), seriesName, seriesName,
    String(body?.synopsis || ''), String(body?.media_type || 'anime'), cueHash
  ]);

  return c.json({
    hash: cueHash,
    title: String(body?.title || `Episode ${epNum}`),
    series: seriesName,
    site: String(body?.site || 'generic'),
    media_type: String(body?.media_type || 'anime'),
    last_position_ms: posMs,
    duration_ms: durMs,
    completed: Boolean(completed),
    minutes: Math.round((durMs / 60000) * 10) / 10,
    known_pct: 0,
    mined: 0,
    episode_number: epNum,
    cloud_synced: true,
  });
});

app.post('/api/link/sessions', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const body = await c.req.json().catch(() => ({}));
  await initTursoSchema(c);

  const sessionId = String(body?.session_id || body?.id || '').trim() || `${String(body?.cue_hash || body?.episode_key || 'session')}_${Date.now()}`;
  const nowTs = Date.now();
  await queryTurso(c, `
    INSERT INTO user_sessions (
      user_id, session_id, episode_key, cue_hash, series, title, site, media_type,
      watch_time_ms, lines_seen, words_mined, gap_words_encountered, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, session_id) DO UPDATE SET
      watch_time_ms = MAX(user_sessions.watch_time_ms, excluded.watch_time_ms),
      lines_seen = MAX(user_sessions.lines_seen, excluded.lines_seen),
      words_mined = MAX(user_sessions.words_mined, excluded.words_mined),
      gap_words_encountered = MAX(user_sessions.gap_words_encountered, excluded.gap_words_encountered),
      updated_at = excluded.updated_at
  `, [
    userId,
    sessionId,
    String(body?.episode_key || ''),
    String(body?.cue_hash || ''),
    String(body?.series || ''),
    String(body?.title || ''),
    String(body?.site || 'generic'),
    String(body?.media_type || 'anime'),
    Math.max(0, Number(body?.watch_time_ms || 0) || 0),
    Math.max(0, Number(body?.lines_seen || 0) || 0),
    Math.max(0, Number(body?.words_mined || 0) || 0),
    Math.max(0, Number(body?.gap_words_encountered || 0) || 0),
    nowTs,
  ]);
  return c.json({ ok: true, session_id: sessionId, cloud_synced: true });
});

app.get('/api/link/episodes/:cue_hash', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const cueHash = decodeURIComponent(c.req.param('cue_hash') || '').trim();
  await initTursoSchema(c);

  const res = await queryTurso(
    c,
    `SELECT cue_hash, title, series, episode_number, episode_key, site, media_type, duration_ms, known_pct, updated_at
     FROM user_episode_cues WHERE user_id = ? AND cue_hash = ? LIMIT 1`,
    [userId, cueHash]
  );
  const r = res?.rows?.[0];
  if (!r) return c.json({ error: 'Episode not found' }, 404);
  const durMs = Number(_cellVal(r[7], 0)) || 0;
  return c.json({
    hash: String(_cellVal(r[0], cueHash)),
    title: String(_cellVal(r[1], '')),
    series: String(_cellVal(r[2], '')),
    episode_number: Number(_cellVal(r[3], 1)) || 1,
    episode_key: String(_cellVal(r[4], '')),
    site: String(_cellVal(r[5], 'generic')),
    media_type: String(_cellVal(r[6], 'anime')),
    duration_ms: durMs,
    known_pct: Number(_cellVal(r[8], 0)) || 0,
    has_cues: true,
    ts: String(_cellVal(r[9], '')),
    minutes: Math.round((durMs / 60000) * 10) / 10,
  });
});

// ---------------------------------------------------------------------------
// Edge User Known Words, Cards Save, Kanji Mastery, Settings & Study Sync
// ---------------------------------------------------------------------------
app.get('/api/known-words', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  await initTursoSchema(c);

  const markedKnown = [];
  const minedWords = [];
  const txRes = await executeTursoTransaction(c, [
    { sql: `SELECT word FROM user_known_words WHERE user_id = ? AND status = 'known'`, args: [userId] },
    { sql: `SELECT json_extract(payload, '$.expression') FROM user_op_log WHERE user_id = ? AND op_type IN ('card_save', 'save_card') ORDER BY created_at DESC LIMIT 1500`, args: [userId] },
  ]);
  const kwRes = txRes?.[0];
  const opRes = txRes?.[1];
  for (const r of (kwRes?.rows || [])) {
    const w = String(_cellVal(r[0], '') || '').trim();
    if (w) markedKnown.push(w);
  }
  for (const r of (opRes?.rows || [])) {
    const w = String(_cellVal(r[0], '') || '').trim();
    if (w) minedWords.push(w);
  }
  const allWords = Array.from(new Set([...markedKnown, ...minedWords]));
  return c.json({ words: allWords, marked_known: markedKnown, mined_words: Array.from(new Set(minedWords)) });
});

app.post('/api/known-words/mark', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const body = await c.req.json().catch(() => ({}));
  const word = String(body?.word || '').trim();
  if (!word) return c.json({ error: 'Bad Request', detail: 'Missing word' }, 400);
  await initTursoSchema(c);
  await queryTurso(
    c,
    `INSERT INTO user_known_words (user_id, word, status, updated_at) VALUES (?, ?, 'known', ?)
     ON CONFLICT (user_id, word) DO UPDATE SET status = 'known', updated_at = excluded.updated_at`,
    [userId, word, Date.now()]
  );
  return c.json({ ok: true, word, status: 'known' });
});

app.delete('/api/known-words/mark/:word', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const word = decodeURIComponent(c.req.param('word') || '').trim();
  await initTursoSchema(c);
  await queryTurso(c, `DELETE FROM user_known_words WHERE user_id = ? AND word = ?`, [userId, word]);
  return c.json({ ok: true, word, status: 'unknown' });
});

app.post('/api/vocab/inventory/bulk-state', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const body = await c.req.json().catch(() => ({}));
  const expressions = Array.isArray(body?.expressions) ? body.expressions.map(w => String(w || '').trim()).filter(Boolean) : [];
  const state = String(body?.state || 'known').trim().toLowerCase();
  await initTursoSchema(c);
  const nowTs = Date.now();
  const stmts = expressions.slice(0, 200).map(w => ({
    sql: `INSERT INTO user_known_words (user_id, word, status, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (user_id, word) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    args: [userId, w, state, nowTs],
  }));
  if (stmts.length > 0) await executeTursoTransaction(c, stmts);
  return c.json({ ok: true, updated: stmts.length, state });
});

app.post('/api/cards/save', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const body = await c.req.json().catch(() => ({}));
  const expression = String(body?.expression || '').trim();
  if (!expression) return c.json({ error: 'Bad Request', detail: 'Expression is required' }, 400);

  await initTursoSchema(c);
  let deckName = String(body?.deck_name || '').trim();
  if (!deckName || deckName === 'Default') {
    try {
      const prefRes = await queryTurso(c, `SELECT anki_deck FROM user_preferences WHERE user_id = ? LIMIT 1`, [userId]);
      const prefDeck = String(_cellVal(prefRes?.rows?.[0]?.[0], '') || '').trim();
      if (prefDeck) deckName = prefDeck;
    } catch (_) {}
  }
  if (!deckName) deckName = 'Default';

  const nowIso = new Date().toISOString();
  const cardId = String(body?.id || `cloud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`);
  const payloadObj = {
    ...body,
    id: cardId,
    op_type: 'card_save',
    expression,
    reading: String(body?.reading || ''),
    meaning: String(body?.meaning || ''),
    example_sentence: String(body?.example_sentence || body?.sentence || ''),
    example_translation: String(body?.example_translation || body?.sentence_translation || ''),
    deck_name: deckName,
    created_at: body?.created_at || nowIso,
    updated_at: nowIso,
    sync_status: 'synced',
  };

  await queryTurso(c, `
    INSERT INTO user_op_log (id, user_id, op_type, payload, ack, attempts, created_at)
    VALUES (?, ?, 'card_save', ?, 0, 0, ?)
    ON CONFLICT (user_id, id) DO UPDATE SET
      payload = excluded.payload,
      ack = 0,
      created_at = excluded.created_at
  `, [cardId, userId, JSON.stringify(payloadObj), nowIso]);

  return c.json({ ok: true, id: cardId, card_id: cardId, deck_name: deckName, sync_destination: 'cloud' });
});

app.get('/api/kanji/seen', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  await initTursoSchema(c);

  const txRes = await executeTursoTransaction(c, [
    { sql: `SELECT kanji_char, accuracy_percent, mastery_flags, review_count FROM user_kanji_progress WHERE user_id = ?`, args: [userId] },
    { sql: `SELECT word FROM user_known_words WHERE user_id = ? AND status = 'known'`, args: [userId] },
    { sql: `SELECT json_extract(payload, '$.expression') FROM user_op_log WHERE user_id = ? AND op_type IN ('card_save', 'save_card') ORDER BY created_at DESC LIMIT 1500`, args: [userId] },
  ]);

  const seen = {};
  const kpRes = txRes?.[0];
  const kwRes = txRes?.[1];
  const cardRes = txRes?.[2];

  const distinctWords = {};
  for (const r of (cardRes?.rows || [])) {
    const expr = String(_cellVal(r[0], '') || '').trim();
    if (!expr) continue;
    for (const ch of expr) {
      if (_KANJI_CHAR_RE.test(ch)) {
        if (!distinctWords[ch]) distinctWords[ch] = new Set();
        distinctWords[ch].add(expr);
      }
    }
  }
  for (const [ch, set] of Object.entries(distinctWords)) {
    seen[ch] = set.size;
  }

  for (const r of (kpRes?.rows || [])) {
    const ch = String(_cellVal(r[0], '') || '').trim();
    if (!ch) continue;
    const acc = Number(_cellVal(r[1], 0)) || 0;
    const flags = Number(_cellVal(r[2], 0)) || 0;
    const revs = Number(_cellVal(r[3], 0)) || 0;
    const score = (flags > 0 || acc >= 80 || revs >= 3) ? 3 : Math.max(1, revs);
    seen[ch] = Math.max(seen[ch] || 0, score);
  }

  for (const r of (kwRes?.rows || [])) {
    const w = String(_cellVal(r[0], '') || '').trim();
    for (const ch of w) {
      if (_KANJI_CHAR_RE.test(ch)) seen[ch] = Math.max(seen[ch] || 0, 3);
    }
  }
  return c.json({ seen_kanji: seen, total_seen: Object.keys(seen).length });
});

app.get('/api/learner/settings', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  await initTursoSchema(c);
  const res = await queryTurso(c, `SELECT anki_deck, learner_level, prefs_json, updated_at FROM user_preferences WHERE user_id = ? LIMIT 1`, [userId]);
  const r = res?.rows?.[0];
  let prefs = {};
  if (r) {
    try { prefs = JSON.parse(String(_cellVal(r[2], '{}') || '{}')); } catch (_) {}
  }
  const ankiDeck = r ? String(_cellVal(r[0], '') || '') : (prefs.anki_deck || '');
  const learnerLevel = r ? String(_cellVal(r[1], 'N4') || 'N4') : (prefs.learner_level || 'N4');
  const updatedAt = r ? Number(_cellVal(r[3], 0) || 0) : 0;
  return c.json({
    ok: true,
    updated_at: updatedAt,
    preferences: {
      ...prefs,
      anki_deck: ankiDeck,
      learner_level: learnerLevel,
    },
  });
});

async function _handleUpdateLearnerSettings(c, next) {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const body = await c.req.json().catch(() => ({}));
  const prefs = body?.preferences && typeof body.preferences === 'object' ? body.preferences : body;
  await initTursoSchema(c);

  const prevRes = await queryTurso(c, `SELECT anki_deck, learner_level, prefs_json FROM user_preferences WHERE user_id = ? LIMIT 1`, [userId]);
  const prevRow = prevRes?.rows?.[0];
  let mergedPrefs = {};
  if (prevRow) {
    try { mergedPrefs = JSON.parse(String(_cellVal(prevRow[2], '{}') || '{}')); } catch (_) {}
  }
  mergedPrefs = { ...mergedPrefs, ...prefs };
  const ankiDeck = String(prefs?.anki_deck ?? (prevRow ? _cellVal(prevRow[0], '') : '') ?? '').trim();
  const learnerLevel = String(prefs?.learner_level ?? (prevRow ? _cellVal(prevRow[1], 'N4') : 'N4') ?? 'N4').trim();

  await queryTurso(c, `
    INSERT INTO user_preferences (user_id, anki_deck, learner_level, prefs_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      anki_deck = CASE WHEN excluded.anki_deck != '' THEN excluded.anki_deck ELSE user_preferences.anki_deck END,
      learner_level = CASE WHEN excluded.learner_level != '' THEN excluded.learner_level ELSE user_preferences.learner_level END,
      prefs_json = excluded.prefs_json,
      updated_at = excluded.updated_at
  `, [userId, ankiDeck, learnerLevel, JSON.stringify(mergedPrefs), Date.now()]);
  return c.json({ ok: true, preferences: { ...mergedPrefs, anki_deck: ankiDeck, learner_level: learnerLevel } });
}
app.put('/api/learner/settings', _handleUpdateLearnerSettings);
app.post('/api/learner/settings', _handleUpdateLearnerSettings);

app.post('/api/user/progress/sync', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  const body = await c.req.json().catch(() => ({}));
  await initTursoSchema(c);
  const nowTs = Date.now();
  const stmts = [];
  for (const kp of (Array.isArray(body?.kanji_practices) ? body.kanji_practices : [])) {
    const ch = String(kp?.kanji_char || kp?.character || '').trim();
    if (!ch) continue;
    stmts.push({
      sql: `INSERT INTO user_kanji_progress (user_id, kanji_char, mastery_flags, accuracy_percent, review_count, last_practiced_at)
            VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT (user_id, kanji_char) DO UPDATE SET
              mastery_flags = MAX(user_kanji_progress.mastery_flags, excluded.mastery_flags),
              accuracy_percent = MAX(user_kanji_progress.accuracy_percent, excluded.accuracy_percent),
              review_count = user_kanji_progress.review_count + 1,
              last_practiced_at = excluded.last_practiced_at`,
      args: [userId, ch, Number(kp?.mastery_flags || 0), Number(kp?.accuracy_percent || 0), nowTs],
    });
  }
  for (const vr of (Array.isArray(body?.vocab_reviews) ? body.vocab_reviews : [])) {
    const vid = String(vr?.vocab_id || vr?.word || '').trim();
    if (!vid) continue;
    stmts.push({
      sql: `INSERT INTO user_vocab_progress (user_id, vocab_id, state, stability, difficulty, reps, lapses, due_at, last_reviewed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id, vocab_id) DO UPDATE SET
              state = excluded.state,
              reps = user_vocab_progress.reps + 1,
              last_reviewed_at = excluded.last_reviewed_at`,
      args: [userId, vid, String(vr?.state || 'learning'), Number(vr?.stability || 1), Number(vr?.difficulty || 5), Number(vr?.reps || 1), Number(vr?.lapses || 0), Number(vr?.due_at || nowTs), nowTs],
    });
  }
  for (const gr of (Array.isArray(body?.grammar_reviews) ? body.grammar_reviews : [])) {
    const pid = String(gr?.point_id || gr?.pattern_key || '').trim();
    if (!pid) continue;
    stmts.push({
      sql: `INSERT INTO user_grammar_progress (user_id, point_id, mastery_level, consecutive_correct, last_studied_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (user_id, point_id) DO UPDATE SET
              mastery_level = MAX(user_grammar_progress.mastery_level, excluded.mastery_level),
              consecutive_correct = MAX(user_grammar_progress.consecutive_correct, excluded.consecutive_correct),
              last_studied_at = MAX(COALESCE(user_grammar_progress.last_studied_at, 0), excluded.last_studied_at)`,
      args: [userId, pid, Number(gr?.mastery_level || 0), Number(gr?.consecutive_correct || 0), Number(gr?.last_studied_at || nowTs)],
    });
  }
  if (stmts.length > 0) await executeTursoTransaction(c, stmts);
  return c.json({ ok: true, synced: { kanji: (body?.kanji_practices || []).length, vocab: (body?.vocab_reviews || []).length, grammar: (body?.grammar_reviews || []).length } });
});

app.get('/api/user/progress/pull', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const userId = auth.user.sub;
  await initTursoSchema(c);

  const txRes = await executeTursoTransaction(c, [
    { sql: `SELECT word, status, updated_at FROM user_known_words WHERE user_id = ?`, args: [userId] },
    { sql: `SELECT kanji_char, mastery_flags, accuracy_percent, review_count, last_practiced_at FROM user_kanji_progress WHERE user_id = ?`, args: [userId] },
    { sql: `SELECT anki_deck, learner_level, prefs_json, updated_at FROM user_preferences WHERE user_id = ? LIMIT 1`, args: [userId] },
    { sql: `SELECT point_id, mastery_level, consecutive_correct, last_studied_at FROM user_grammar_progress WHERE user_id = ?`, args: [userId] },
  ]);

  const knownWords = (txRes?.[0]?.rows || []).map(r => ({
    word: String(_cellVal(r[0], '') || '').trim(),
    status: String(_cellVal(r[1], 'known') || 'known').trim(),
    updated_at: Number(_cellVal(r[2], 0) || 0),
  })).filter(x => x.word);

  const kanjiPractices = (txRes?.[1]?.rows || []).map(r => ({
    kanji_char: String(_cellVal(r[0], '') || '').trim(),
    mastery_flags: Number(_cellVal(r[1], 0) || 0),
    accuracy_percent: Number(_cellVal(r[2], 0) || 0),
    review_count: Number(_cellVal(r[3], 0) || 0),
    last_practiced_at: Number(_cellVal(r[4], 0) || 0),
  })).filter(x => x.kanji_char);

  const prefRow = txRes?.[2]?.rows?.[0];
  let prefs = {};
  if (prefRow) {
    try { prefs = JSON.parse(String(_cellVal(prefRow[2], '{}') || '{}')); } catch (_) {}
  }
  const preferences = prefRow ? {
    ...prefs,
    anki_deck: String(_cellVal(prefRow[0], '') || prefs.anki_deck || ''),
    learner_level: String(_cellVal(prefRow[1], '') || prefs.learner_level || ''),
    updated_at: Number(_cellVal(prefRow[3], 0) || 0),
  } : null;

  const grammarProgress = (txRes?.[3]?.rows || []).map(r => ({
    point_id: String(_cellVal(r[0], '') || '').trim(),
    mastery_level: Number(_cellVal(r[1], 0) || 0),
    consecutive_correct: Number(_cellVal(r[2], 0) || 0),
    last_studied_at: Number(_cellVal(r[3], 0) || 0),
  })).filter(x => x.point_id);

  return c.json({
    ok: true,
    known_words: knownWords,
    kanji_practices: kanjiPractices,
    grammar_progress: grammarProgress,
    preferences,
  });
});

// ---------------------------------------------------------------------------
// Edge Turso Overlays for Vocab Inventory (Curated Shelves) & Grammar
// ---------------------------------------------------------------------------
async function _fetchRenderJson(c, method = 'GET', bodyText = undefined) {
  const renderBase = (c.env?.RENDER_BACKEND_URL || 'https://kiroku-backend-h0lv.onrender.com').replace(/\/$/, '');
  const url = new URL(c.req.url);
  const headers = new Headers(c.req.raw.headers);
  headers.set('Host', new URL(renderBase).host);
  return fetch(`${renderBase}${url.pathname}${url.search}`, {
    method,
    headers,
    body: bodyText,
  });
}

async function _fetchRenderJsonCached(c, ttlSeconds = 300) {
  const renderBase = (c.env?.RENDER_BACKEND_URL || 'https://kiroku-backend-h0lv.onrender.com').replace(/\/$/, '');
  const url = new URL(c.req.url);
  const cacheUrl = `${renderBase}${url.pathname}${url.search}`;
  const cacheKeyReq = new Request(cacheUrl, { method: 'GET' });
  let edgeCache = null;
  try {
    if (typeof caches !== 'undefined' && caches.default) {
      edgeCache = caches.default;
      const hit = await edgeCache.match(cacheKeyReq);
      if (hit) return hit;
    }
  } catch (_) {}

  const res = await _fetchRenderJson(c, 'GET');
  if (edgeCache && res && res.ok) {
    try {
      const h = new Headers(res.headers);
      h.set('Cache-Control', `public, max-age=${ttlSeconds}`);
      const toCache = new Response(res.clone().body, {
        status: res.status,
        statusText: res.statusText,
        headers: h,
      });
      c.executionCtx?.waitUntil(edgeCache.put(cacheKeyReq, toCache));
    } catch (_) {}
  }
  return res;
}

app.get('/api/vocab/inventory', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return next();
  const userId = auth.user.sub;

  const [renderResp, kwRes] = await Promise.all([
    _fetchRenderJsonCached(c, 300),
    initTursoSchema(c).then(() => queryTurso(c, `SELECT word, status FROM user_known_words WHERE user_id = ?`, [userId])).catch(() => null),
  ]);
  if (!renderResp.ok) return renderResp;
  const data = await renderResp.json().catch(() => null);
  if (!data || typeof data !== 'object') return next();

  const knownMap = new Map();
  for (const r of (kwRes?.rows || [])) {
    const w = String(_cellVal(r[0], '') || '').trim();
    const st = String(_cellVal(r[1], 'known') || 'known').trim().toLowerCase();
    if (w) knownMap.set(w, st);
  }
  if (knownMap.size > 0 && Array.isArray(data.items)) {
    for (const item of data.items) {
      const expr = String(item?.expression || item?.word || '').trim();
      const reading = String(item?.reading || '').trim();
      const matched = (expr && knownMap.get(expr)) || (reading && knownMap.get(reading));
      if (matched) {
        item.state = matched;
      }
    }
  }
  return c.json(data);
});

function _overlayGrammarList(list, grMap) {
  if (!Array.isArray(list) || grMap.size === 0) return;
  for (const p of list) {
    const key = String(p?.pattern_key || p?.point_id || '').trim();
    if (!key || !grMap.has(key)) continue;
    const g = grMap.get(key);
    p.mastery_score = g.mastery_level > 1 ? g.mastery_level / 100 : g.mastery_level;
    p.drill_count = Math.max(Number(p.drill_count || 0), g.consecutive_correct);
    p.status = g.mastery_level >= 80 ? 'mastered' : (g.mastery_level > 0 || g.consecutive_correct > 0) ? 'learning' : p.status;
  }
}

async function _getGrammarReviewMap(c, userId) {
  await initTursoSchema(c);
  const res = await queryTurso(c, `SELECT point_id, mastery_level, consecutive_correct FROM grammar_reviews WHERE user_id = ?`, [userId]);
  const map = new Map();
  for (const r of (res?.rows || [])) {
    const pid = String(_cellVal(r[0], '') || '').trim();
    if (!pid) continue;
    map.set(pid, {
      mastery_level: Number(_cellVal(r[1], 0) || 0),
      consecutive_correct: Number(_cellVal(r[2], 0) || 0),
    });
  }
  return map;
}

app.get('/api/grammar/points', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return next();
  const [renderResp, grMap] = await Promise.all([
    _fetchRenderJsonCached(c, 300),
    _getGrammarReviewMap(c, auth.user.sub).catch(() => new Map()),
  ]);
  if (!renderResp.ok) return renderResp;
  const data = await renderResp.json().catch(() => null);
  if (!data) return next();
  _overlayGrammarList(Array.isArray(data) ? data : (data.points || data.items), grMap);
  return c.json(data);
});

app.get('/api/grammar/syllabus', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return next();
  const [renderResp, grMap] = await Promise.all([
    _fetchRenderJsonCached(c, 300),
    _getGrammarReviewMap(c, auth.user.sub).catch(() => new Map()),
  ]);
  if (!renderResp.ok) return renderResp;
  const data = await renderResp.json().catch(() => null);
  if (!data) return next();
  _overlayGrammarList(data.points || data.items || data.syllabus, grMap);
  return c.json(data);
});

app.get('/api/grammar/stats', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return next();
  const [renderResp, grMap] = await Promise.all([
    _fetchRenderJsonCached(c, 300),
    _getGrammarReviewMap(c, auth.user.sub).catch(() => new Map()),
  ]);
  if (!renderResp.ok) return renderResp;
  const data = await renderResp.json().catch(() => null);
  if (!data || typeof data !== 'object') return next();
  if (grMap.size > 0) {
    let mastered = 0;
    let learning = 0;
    for (const g of grMap.values()) {
      if (g.mastery_level >= 80) mastered++;
      else if (g.mastery_level > 0 || g.consecutive_correct > 0) learning++;
    }
    data.mastered = Math.max(Number(data.mastered || 0), mastered);
    data.learning = Math.max(Number(data.learning || 0), learning);
  }
  return c.json(data);
});

app.patch('/api/grammar/points/:patternKey', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  const patternKey = decodeURIComponent(c.req.param('patternKey') || '').trim();
  const body = await c.req.json().catch(() => ({}));
  const status = String(body?.status || 'learning').trim().toLowerCase();
  const rawScore = Number(body?.mastery_score ?? (status === 'mastered' || status === 'known' ? 1.0 : 0.5));
  const masteryLevel = rawScore <= 1.0 ? Math.round(rawScore * 100) : Math.round(rawScore);
  const drillCount = Number(body?.drill_count || 1);
  await initTursoSchema(c);
  await queryTurso(c, `
    INSERT INTO grammar_reviews (user_id, point_id, mastery_level, consecutive_correct, last_studied_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, point_id) DO UPDATE SET
      mastery_level = excluded.mastery_level,
      consecutive_correct = MAX(grammar_reviews.consecutive_correct, excluded.consecutive_correct),
      last_studied_at = excluded.last_studied_at
  `, [auth.user.sub, patternKey, masteryLevel, drillCount, Date.now()]);
  return c.json({ ok: true, pattern_key: patternKey, status, mastery_score: masteryLevel / 100 });
});

app.post('/api/grammar/drills/verify', async (c, next) => {
  if (!c.env?.TURSO_DATABASE_URL) return next();
  const auth = await authenticateRequest(c);
  if (!auth.authenticated || !auth.user?.sub) return next();
  const rawBody = await c.req.text();
  const renderResp = await _fetchRenderJson(c, 'POST', rawBody);
  const data = await renderResp.clone().json().catch(() => null);
  let reqBody = {};
  try { reqBody = JSON.parse(rawBody || '{}'); } catch (_) {}
  const patternKey = String(reqBody?.pattern_key || reqBody?.point_id || data?.pattern_key || '').trim();
  if (renderResp.ok && patternKey) {
    const isCorrect = Boolean(data?.correct ?? data?.is_correct ?? true);
    await initTursoSchema(c).catch(() => {});
    await queryTurso(c, `
      INSERT INTO grammar_reviews (user_id, point_id, mastery_level, consecutive_correct, last_studied_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, point_id) DO UPDATE SET
        mastery_level = MIN(100, MAX(grammar_reviews.mastery_level, excluded.mastery_level)),
        consecutive_correct = CASE WHEN ? = 1 THEN grammar_reviews.consecutive_correct + 1 ELSE 0 END,
        last_studied_at = excluded.last_studied_at
    `, [auth.user.sub, patternKey, isCorrect ? 50 : 10, isCorrect ? 1 : 0, Date.now(), isCorrect ? 1 : 0]).catch(() => {});
  }
  return renderResp;
});

// ---------------------------------------------------------------------------
// Direct Neon Edge Dictionary & Capture Routes (bypasses Render cold-starts)
// ---------------------------------------------------------------------------
const NEON_DEFAULT_SQL_URL = 'https://ep-withered-cake-ar7rbuli.c-4.us-west-2.aws.neon.tech/sql';

async function queryNeon(c, sql, params = []) {
  const neonSqlUrl = c.env?.NEON_SQL_URL || NEON_DEFAULT_SQL_URL;
  const neonConnStr = c.env?.NEON_DATABASE_URL || c.env?.DATABASE_URL || '';
  if (!neonConnStr) return null;
  const headers = {
    'Content-Type': 'application/json',
    'Neon-Connection-String': neonConnStr,
  };
  const res = await fetch(neonSqlUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: sql, params }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Neon SQL error (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.rows || [];
}

function _decodeNeonBytea(val) {
  if (!val) return null;
  if (val instanceof Uint8Array) return val;
  if (typeof val === 'string') {
    if (val.startsWith('\\x') || val.startsWith('\\\\x')) {
      const hex = val.replace(/^\\+x/, '');
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    }
    try {
      const bin = atob(val);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch (_) {
      return null;
    }
  }
  return null;
}

async function _decompressContentBlob(blobVal) {
  const bytes = _decodeNeonBytea(blobVal);
  if (!bytes || bytes.length === 0) return null;
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const out = await new Response(ds.readable).text();
    return JSON.parse(out);
  } catch (_) {
    return null;
  }
}

function _extractGlossesFromContent(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') {
    const t = node.trim();
    if (t && !t.startsWith('http') && t !== 'JMdict') out.push(t);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) _extractGlossesFromContent(item, out);
    return out;
  }
  if (typeof node === 'object') {
    if (node.tag === 'rt' || node.tag === 'rp') return out;
    const dataContent = node.data?.content;
    if (
      dataContent === 'part-of-speech-info' ||
      dataContent === 'info-gloss' ||
      dataContent === 'examples' ||
      dataContent === 'attribution' ||
      dataContent === 'references' ||
      dataContent === 'xref'
    ) {
      return out;
    }
    if (node.content !== undefined) _extractGlossesFromContent(node.content, out);
    else if (typeof node.text === 'string') _extractGlossesFromContent(node.text, out);
  }
  return out;
}

function _parseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [String(raw)];
    } catch (_) {
      return [raw];
    }
  }
  return [];
}

function _edgeJsonWithCors(c, payload, status = 200, cacheControl = '', extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders };
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  const origin = c.req.header('origin');
  if (origin && isAllowedOrigin(origin, c.env)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

async function _matchEdgeCache(c, cacheKeyReq) {
  try {
    if (typeof caches !== 'undefined' && caches.default) {
      const cached = await caches.default.match(cacheKeyReq);
      if (cached) {
        const h = new Headers(cached.headers);
        h.set('X-Kiroku-Edge-Cache', 'HIT');
        const origin = c.req.header('origin');
        if (origin && isAllowedOrigin(origin, c.env)) {
          h.set('Access-Control-Allow-Origin', origin);
          h.set('Access-Control-Allow-Credentials', 'true');
        }
        return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers: h });
      }
    }
  } catch (_) {}
  return null;
}

function _storeEdgeCache(c, cacheKeyReq, payload, ttlSeconds) {
  try {
    if (typeof caches !== 'undefined' && caches.default) {
      const toCache = new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${ttlSeconds}`,
        },
      });
      c.executionCtx?.waitUntil(caches.default.put(cacheKeyReq, toCache));
    }
  } catch (_) {}
}

async function _buildEdgeLookupPayload(c, queryTerm) {
  const q = String(queryTerm || '').trim();
  if (!q) return null;

  const kanjiChars = Array.from(new Set(q.match(/[\u4e00-\u9faf]/g) || [])).slice(0, 6);
  const [termRows, jlptRows, kanjiRows] = await Promise.all([
    queryNeon(
      c,
      `SELECT term, reading, dictionary, score, def_tags, term_tags, content_blob
       FROM terms
       WHERE term = $1 OR reading = $1 OR norm_term = $1 OR norm_reading = $1
       ORDER BY CASE WHEN term = $1 THEN 2 WHEN reading = $1 THEN 1 ELSE 0 END DESC, score DESC
       LIMIT 10`,
      [q]
    ),
    queryNeon(
      c,
      `SELECT word, reading, meanings, level, examples
       FROM jlpt_vocab
       WHERE word = $1 OR reading = $1
       LIMIT 3`,
      [q]
    ),
    kanjiChars.length > 0
      ? queryNeon(
          c,
          `SELECT character, onyomi, kunyomi, meanings_json FROM kanji WHERE character = ANY($1)`,
          [kanjiChars]
        ).catch(() => [])
      : Promise.resolve([]),
  ]);

  if ((!termRows || termRows.length === 0) && (!jlptRows || jlptRows.length === 0)) {
    return null;
  }

  const entries = [];
  for (const r of (termRows || []).slice(0, 5)) {
    const content = await _decompressContentBlob(r.content_blob);
    const rawGlosses = _extractGlossesFromContent(content);
    const seen = new Set();
    const deduped = [];
    for (const g of rawGlosses) {
      const low = g.toLowerCase();
      if (!seen.has(low)) {
        seen.add(low);
        deduped.push(g);
      }
    }
    const senses = deduped.length > 0
      ? deduped.slice(0, 8).map((g, i) => ({ index: i + 1, glosses: [g] }))
      : [];
    const tags = [
      ...String(r.def_tags || '').split(/\s+/).filter(Boolean),
      ...String(r.term_tags || '').split(/\s+/).filter(Boolean),
    ];
    entries.push({
      dictionary: r.dictionary || 'Jitendex',
      term: r.term || q,
      reading: r.reading || '',
      senses,
      tags,
    });
  }

  const jRow = (jlptRows && jlptRows[0]) || null;
  const jlptMeanings = jRow ? _parseJsonArray(jRow.meanings) : [];
  const jlptExamples = jRow ? _parseJsonArray(jRow.examples) : [];
  const ex0 = (jlptExamples[0] && typeof jlptExamples[0] === 'object') ? jlptExamples[0] : {};

  if (entries.length === 0 && jRow) {
    entries.push({
      dictionary: 'JLPT Reference',
      term: jRow.word || q,
      reading: jRow.reading || '',
      senses: jlptMeanings.map((m, i) => ({ index: i + 1, glosses: [String(m)] })),
      tags: jRow.level ? [jRow.level] : [],
    });
  }

  const primary = entries[0] || {};
  const primaryExpr = primary.term || jRow?.word || q;
  let resolvedKanjiRows = kanjiRows || [];
  if (resolvedKanjiRows.length === 0) {
    const exprKanji = Array.from(new Set(String(primaryExpr).match(/[\u4e00-\u9faf]/g) || [])).slice(0, 6);
    if (exprKanji.length > 0) {
      resolvedKanjiRows = await queryNeon(
        c,
        `SELECT character, onyomi, kunyomi, meanings_json FROM kanji WHERE character = ANY($1)`,
        [exprKanji]
      ).catch(() => []);
    }
  }
  const primarySenses = primary.senses || [];
  const meaningText = primarySenses.length > 0
    ? primarySenses.slice(0, 4).map((s) => (s.glosses || []).join(', ')).filter(Boolean).join('; ')
    : jlptMeanings.join('; ');

  const kanjiEntries = resolvedKanjiRows.map((k) => ({
    character: k.character,
    onyomi: k.onyomi || '',
    kunyomi: k.kunyomi || '',
    meanings: _parseJsonArray(k.meanings_json),
  }));

  return {
    query: q,
    expression: primary.term || jRow?.word || q,
    reading: primary.reading || jRow?.reading || '',
    meaning: meaningText,
    jlpt_level: jRow?.level || null,
    example_sentence: String(ex0.ja || ''),
    example_translation: String(ex0.en || ''),
    entries,
    kanji: kanjiEntries,
    kanji_entries: kanjiEntries,
  };
}

app.get('/api/dictionary/search-english', async (c, next) => {
  if (!c.env?.NEON_DATABASE_URL) return next();
  const hit = await _matchEdgeCache(c, c.req.raw);
  if (hit) return hit;

  const q = String(c.req.query('query') || '').trim();
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '20', 10)), 50);
  if (!q) return _edgeJsonWithCors(c, { entries: [], count: 0 });

  try {
    const hasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(q);
    const levelWeights = { N5: 50, N4: 40, N3: 30, N2: 20, N1: 10 };
    const scored = [];
    const seenKeys = new Set();

    if (hasJapanese) {
      const prefixLike = `${q}%`;
      const [jlptRows, termRows] = await Promise.all([
        queryNeon(
          c,
          `SELECT word, reading, meanings, level FROM jlpt_vocab
           WHERE word LIKE $1 OR reading LIKE $1 LIMIT 40`,
          [prefixLike]
        ),
        queryNeon(
          c,
          `SELECT term, reading, score, content_blob FROM terms
           WHERE term = $1 OR reading = $1 OR norm_term = $1 OR norm_reading = $1
              OR term LIKE $2 OR reading LIKE $2
           ORDER BY CASE WHEN term = $1 OR reading = $1 THEN 2 ELSE 0 END DESC, score DESC
           LIMIT 30`,
          [q, prefixLike]
        ),
      ]);

      for (const r of (jlptRows || [])) {
        const w = String(r.word || '').trim();
        const rd = String(r.reading || w).trim();
        const key = `${w}|${rd}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const meaningsList = _parseJsonArray(r.meanings);
        const primaryGloss = String(meaningsList[0] || '');
        const lvl = String(r.level || '').toUpperCase();
        let score = levelWeights[lvl] || 0;
        if (w === q || rd === q) score += 200;
        else if (w.startsWith(q) || rd.startsWith(q)) score += 100;
        else score += 30;
        scored.push({
          score,
          term: w,
          expression: w,
          word: w,
          reading: rd,
          senses: [{ glosses: primaryGloss ? [primaryGloss] : [''] }],
          tags: lvl ? [lvl] : [],
          jlpt: lvl || null,
          jlpt_level: lvl || null,
          meaning: primaryGloss,
          meanings: meaningsList,
        });
      }

      const termCandidates = (termRows || []).filter((r) => !seenKeys.has(`${r.term}|${r.reading || r.term}`)).slice(0, 15);
      const decompressed = await Promise.all(termCandidates.map((r) => _decompressContentBlob(r.content_blob)));
      for (let i = 0; i < termCandidates.length; i++) {
        const r = termCandidates[i];
        const w = String(r.term || '').trim();
        const rd = String(r.reading || w).trim();
        const key = `${w}|${rd}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const glosses = _extractGlossesFromContent(decompressed[i]).slice(0, 4);
        const primaryGloss = glosses.join('; ');
        let score = Number(r.score || 0) > 0 ? 15 : 5;
        if (w === q || rd === q) score += 190;
        else if (w.startsWith(q) || rd.startsWith(q)) score += 90;
        else score += 20;
        scored.push({
          score,
          term: w,
          expression: w,
          word: w,
          reading: rd,
          senses: [{ glosses: primaryGloss ? [primaryGloss] : [''] }],
          tags: [],
          jlpt: null,
          jlpt_level: null,
          meaning: primaryGloss,
          meanings: glosses,
        });
      }
      scored.sort((a, b) => (b.score - a.score) || (a.term.length - b.term.length));
    } else {
      const normQ = q.toLowerCase().replace(/^(to|a|an)\s+/, '');
      const words = normQ.match(/\b[a-z0-9'-]+\b/g) || [];
      if (words.length > 0) {
        const whereSql = words.map((_, idx) => `meanings ILIKE $${idx + 1}`).join(' AND ');
        const params = words.map((w) => `%${w}%`);
        const rows = await queryNeon(
          c,
          `SELECT word, reading, meanings, level FROM jlpt_vocab WHERE ${whereSql} LIMIT 100`,
          params
        );
        const wordRegexes = words.map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
        const qLow = q.toLowerCase();
        for (const r of (rows || [])) {
          const meaningsList = _parseJsonArray(r.meanings);
          let matched = false;
          let exactGloss = false;
          let startsGloss = false;
          for (const m of meaningsList) {
            const mStr = String(m);
            if (wordRegexes.every((rx) => rx.test(mStr))) {
              matched = true;
              const mLow = mStr.toLowerCase();
              if (mLow === qLow || mLow === `to ${qLow}`) exactGloss = true;
              else if (mLow.startsWith(qLow) || mLow.startsWith(`to ${qLow}`)) startsGloss = true;
            }
          }
          if (!matched) continue;
          const lvl = String(r.level || '').toUpperCase();
          let score = levelWeights[lvl] || 0;
          if (exactGloss) score += 100;
          else if (startsGloss) score += 50;
          const w = String(r.word || '');
          const rd = String(r.reading || w);
          const primaryGloss = String(meaningsList[0] || '');
          scored.push({
            score,
            term: w,
            expression: w,
            word: w,
            reading: rd,
            senses: [{ glosses: primaryGloss ? [primaryGloss] : [''] }],
            tags: lvl ? [lvl] : [],
            jlpt: lvl || null,
            jlpt_level: lvl || null,
            meaning: primaryGloss,
            meanings: meaningsList,
          });
        }
        scored.sort((a, b) => b.score - a.score);
      }
    }

    const entries = scored.slice(0, limit).map(({ score, ...rest }) => rest);
    const payload = { entries, count: entries.length };
    _storeEdgeCache(c, c.req.raw, payload, 3600);
    return _edgeJsonWithCors(c, payload, 200, 'public, max-age=3600', { 'X-Kiroku-Edge-Source': 'neon' });
  } catch (err) {
    console.warn('[EdgeSearch] Neon fallback to Render:', err?.message);
    await next();
    c.res.headers.set('X-Kiroku-Edge-Fallback', String(err?.message || 'err').slice(0, 120));
    return;
  }
});

app.get('/api/dictionary/lookup', async (c, next) => {
  if (!c.env?.NEON_DATABASE_URL) return next();
  const hit = await _matchEdgeCache(c, c.req.raw);
  if (hit) return hit;

  const q = String(c.req.query('term') || c.req.query('keyword') || '').trim();
  if (!q) return _edgeJsonWithCors(c, { query: '', entries: [], kanji: [] });

  try {
    const payload = await _buildEdgeLookupPayload(c, q);
    if (!payload) return next();
    _storeEdgeCache(c, c.req.raw, payload, 86400);
    return _edgeJsonWithCors(c, payload, 200, 'public, max-age=86400', { 'X-Kiroku-Edge-Source': 'neon' });
  } catch (err) {
    console.warn('[EdgeLookup] Neon fallback to Render:', err?.message);
    await next();
    c.res.headers.set('X-Kiroku-Edge-Fallback', String(err?.message || 'err').slice(0, 120));
    return;
  }
});

app.post('/api/capture', async (c, next) => {
  if (!c.env?.NEON_DATABASE_URL) return next();
  let body = null;
  try {
    body = await c.req.raw.clone().json();
  } catch (_) {
    return next();
  }
  if (!body || body.auto_save) return next();

  const text = String(body.text || '').trim();
  if (!text) return next();

  const cacheKeyReq = new Request(`https://cache.kiroku.internal/api/capture?term=${encodeURIComponent(text)}`);
  const hit = await _matchEdgeCache(c, cacheKeyReq);
  if (hit) return hit;

  try {
    const lookup = await _buildEdgeLookupPayload(c, text);
    if (!lookup) return next();
    const payload = {
      expression: lookup.expression,
      reading: lookup.reading,
      meaning: lookup.meaning,
      jlpt_level: lookup.jlpt_level,
      example_sentence: lookup.example_sentence,
      example_translation: lookup.example_translation,
      entries: lookup.entries,
      kanji_entries: lookup.kanji_entries,
      status: 'draft',
    };
    _storeEdgeCache(c, cacheKeyReq, payload, 86400);
    return _edgeJsonWithCors(c, payload, 200);
  } catch (err) {
    console.warn('[EdgeCapture] Neon fallback to Render:', err?.message);
    return next();
  }
});

// ---------------------------------------------------------------------------
// Render Python FastAPI Reverse Proxy
// Transparently routes all /api/* requests to canonical Python backend on Render
// ---------------------------------------------------------------------------
app.all('/api/*', async (c) => {
  const renderBase = (c.env?.RENDER_BACKEND_URL || 'https://kiroku-backend-h0lv.onrender.com').replace(/\/$/, '');
  const url = new URL(c.req.url);
  const targetUrl = `${renderBase}${url.pathname}${url.search}`;

  // Edge cache lookup for deterministic read-only endpoints (dictionary, conjugations, kanji)
  const isCacheableGet = c.req.method === 'GET' && (
    url.pathname.startsWith('/api/dictionary/lookup') ||
    url.pathname.startsWith('/api/dictionary/search') ||
    url.pathname.startsWith('/api/dictionary/search-english') ||
    url.pathname.startsWith('/api/vocab/conjugations') ||
    url.pathname.startsWith('/api/kanji/strokes') ||
    url.pathname.startsWith('/api/kanji/browse') ||
    url.pathname.startsWith('/api/kanji/study-list') ||
    url.pathname.startsWith('/api/kanji/details/') ||
    url.pathname.startsWith('/api/kanji/compounds/')
  );
  let edgeCache = null;
  try {
    if (isCacheableGet && typeof caches !== 'undefined' && caches.default) {
      edgeCache = caches.default;
      const cached = await edgeCache.match(c.req.raw);
      if (cached) {
        const cachedHeaders = new Headers(cached.headers);
        cachedHeaders.set('X-Kiroku-Edge-Cache', 'HIT');
        const origin = c.req.header('origin');
        if (origin && isAllowedOrigin(origin, c.env)) {
          cachedHeaders.set('Access-Control-Allow-Origin', origin);
          cachedHeaders.set('Access-Control-Allow-Credentials', 'true');
        }
        return new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers: cachedHeaders,
        });
      }
    }
  } catch (_) {}

  const headers = new Headers(c.req.raw.headers);
  headers.set('Host', new URL(renderBase).host);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

  const cookies = parseCookies(c.req.header('Cookie') || '');
  let verifiedCookieSession = null;
  if (!headers.get('Authorization') && cookies.session) {
    const cookieAuth = await authenticateRequest(c);
    if (cookieAuth?.authenticated && cookieAuth.source === 'cookie') {
      verifiedCookieSession = cookies.session;
      headers.set('Authorization', `Bearer ${cookies.session}`);
    }
  }

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
    let res = await fetch(targetUrl, init);
    // If Render rejected a stale Bearer token but the browser carries a valid session cookie, retry with cookie JWT
    if (res.status === 401 && cookies.session && !verifiedCookieSession && ['GET', 'HEAD'].includes(c.req.method)) {
      const cookieAuth = await authenticateRequest(c);
      if (cookieAuth?.authenticated && cookieAuth.source === 'cookie' && headers.get('Authorization') !== `Bearer ${cookies.session}`) {
        headers.set('Authorization', `Bearer ${cookies.session}`);
        res = await fetch(targetUrl, { ...init, headers });
      }
    }
    const resHeaders = new Headers(res.headers);
    const origin = c.req.header('origin');
    if (origin && isAllowedOrigin(origin, c.env)) {
      resHeaders.set('Access-Control-Allow-Origin', origin);
      resHeaders.set('Access-Control-Allow-Credentials', 'true');
    }
    if (edgeCache && res.status === 200) {
      try {
        const cacheHeaders = new Headers(res.headers);
        if (!cacheHeaders.get('Cache-Control')) {
          cacheHeaders.set('Cache-Control', 'public, max-age=300');
        }
        const cacheClone = new Response(res.clone().body, {
          status: res.status,
          statusText: res.statusText,
          headers: cacheHeaders,
        });
        c.executionCtx?.waitUntil(edgeCache.put(c.req.raw, cacheClone));
      } catch (_) {}
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
      `DELETE FROM user_op_log WHERE ack = 1 AND op_type != 'card_save' AND created_at < ?`,
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
