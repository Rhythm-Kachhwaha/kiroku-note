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

  let groups = Array.from(seriesMap.values());
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
    url.pathname.startsWith('/api/vocab/conjugations') ||
    url.pathname.startsWith('/api/kanji/strokes')
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
        const cacheClone = res.clone();
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
