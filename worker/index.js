import { Hono } from 'hono';
import { authApp, authenticateRequest } from './auth.js';

const app = new Hono();

// Mount OAuth & auth routes (/auth/*)
app.route('/', authApp);

// Health check endpoint (Public)
app.get('/api/health', async (c) => {
  const backendUrl = c.env?.BACKEND_URL || 'http://localhost:8000';
  try {
    const res = await fetch(`${backendUrl}/api/health`, { headers: c.req.raw.headers });
    const data = await res.json();
    return c.json(data, res.status);
  } catch (err) {
    return c.json({
      status: 'ok',
      service: 'kiroku-pwa-worker',
      backend_connected: false,
      message: 'Worker online, upstream backend unreachable',
      error: String(err)
    }, 200);
  }
});

// Guard protected /api/* endpoints
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') {
    return await next();
  }

  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    // In local development or when secrets are unconfigured, permit development requests
    const isDev = (c.env?.ENVIRONMENT === 'development') || !c.env?.CLOUD_QUEUE_API_KEY;
    if (isDev) {
      c.set('user', { sub: 'dev_user', role: 'developer' });
      return await next();
    }
    return c.json({ error: 'Unauthorized', message: 'Valid session cookie or Bearer token required' }, 401);
  }

  c.set('user', auth.user);
  return await next();
});

// Op-log & Mirror endpoints (proxying to backend / Turso)
app.post('/api/oplog/write', async (c) => {
  const backendUrl = c.env?.BACKEND_URL || 'http://localhost:8000';
  const target = `${backendUrl}/api/oplog/write`;
  try {
    const resp = await fetch(target, {
      method: 'POST',
      headers: c.req.raw.headers,
      body: c.req.raw.body
    });
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  } catch (err) {
    return c.json({ error: 'Proxy error', details: String(err) }, 502);
  }
});

app.get('/api/oplog/lease', async (c) => {
  const backendUrl = c.env?.BACKEND_URL || 'http://localhost:8000';
  const target = `${backendUrl}/api/oplog/lease`;
  try {
    const resp = await fetch(target, { method: 'GET', headers: c.req.raw.headers });
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  } catch (err) {
    return c.json({ error: 'Proxy error', details: String(err) }, 502);
  }
});

app.get('/api/mirror/read', async (c) => {
  const backendUrl = c.env?.BACKEND_URL || 'http://localhost:8000';
  const target = `${backendUrl}/api/mirror/read`;
  try {
    const resp = await fetch(target, { method: 'GET', headers: c.req.raw.headers });
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  } catch (err) {
    return c.json({ error: 'Proxy error', details: String(err) }, 502);
  }
});

app.post('/api/mirror/write', async (c) => {
  const backendUrl = c.env?.BACKEND_URL || 'http://localhost:8000';
  const target = `${backendUrl}/api/mirror/write`;
  try {
    const resp = await fetch(target, {
      method: 'POST',
      headers: c.req.raw.headers,
      body: c.req.raw.body
    });
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  } catch (err) {
    return c.json({ error: 'Proxy error', details: String(err) }, 502);
  }
});

// General /api/* proxy to existing backend
app.all('/api/*', async (c) => {
  const backendUrl = c.env?.BACKEND_URL || 'http://localhost:8000';
  const url = new URL(c.req.url);
  const target = `${backendUrl}${url.pathname}${url.search}`;

  const headers = new Headers(c.req.raw.headers);
  headers.delete('host');

  try {
    const resp = await fetch(target, {
      method: c.req.method,
      headers: headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body
    });
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers
    });
  } catch (err) {
    return c.json({ error: 'Backend unreachable', details: String(err) }, 502);
  }
});

// Static assets handler via Cloudflare Workers Assets binding
app.all('*', async (c) => {
  if (c.env?.ASSETS) {
    return await c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

export default app;
