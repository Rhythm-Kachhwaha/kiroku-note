/**
 * Kiroku Note — Cloudflare Worker Authentication Module
 * Handles OAuth 2.0 (Google, GitHub), cryptographic JWT issuance, and secure cookie management.
 */

import { Hono } from 'hono';
import { queryTurso, initTursoSchema } from './turso.js';

export const authApp = new Hono();

const DEFAULT_JWT_SECRET = 'kiroku-edge-development-secret-change-in-production';

// In-memory token stores (persisted to KV if USER_TOKENS_KV is bound in Cloudflare Worker)
const userTokens = new Map(); // userId -> { token, createdAt }
const tokenToUser = new Map(); // token -> { sub, role }

export function generateCryptoToken() {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 24; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `krk_live_${hex}`;
}

export async function getUserToken(userId, env) {
  if (!userId) return null;
  if (env?.USER_TOKENS_KV) {
    const existing = await env.USER_TOKENS_KV.get(`user:${userId}`);
    if (existing) return existing;
    const newToken = generateCryptoToken();
    await env.USER_TOKENS_KV.put(`user:${userId}`, newToken);
    await env.USER_TOKENS_KV.put(`token:${newToken}`, userId);
    return newToken;
  }
  let record = userTokens.get(userId);
  if (!record) {
    const token = generateCryptoToken();
    record = { token, createdAt: Date.now() };
    userTokens.set(userId, record);
    tokenToUser.set(token, { sub: userId, role: 'shortcut_user' });
  }
  return record.token;
}

export async function regenerateUserToken(userId, env) {
  if (!userId) return null;
  const newToken = generateCryptoToken();
  if (env?.USER_TOKENS_KV) {
    const oldToken = await env.USER_TOKENS_KV.get(`user:${userId}`);
    if (oldToken) {
      await env.USER_TOKENS_KV.delete(`token:${oldToken}`);
    }
    await env.USER_TOKENS_KV.put(`user:${userId}`, newToken);
    await env.USER_TOKENS_KV.put(`token:${newToken}`, userId);
    return newToken;
  }
  const oldRecord = userTokens.get(userId);
  if (oldRecord) {
    tokenToUser.delete(oldRecord.token);
  }
  userTokens.set(userId, { token: newToken, createdAt: Date.now() });
  tokenToUser.set(newToken, { sub: userId, role: 'shortcut_user' });
  return newToken;
}

export async function verifyUserToken(token, env) {
  if (!token || typeof token !== 'string' || !token.startsWith('krk_live_')) return null;
  if (env?.USER_TOKENS_KV) {
    const userId = await env.USER_TOKENS_KV.get(`token:${token}`);
    if (userId) {
      return { sub: userId, role: 'shortcut_user' };
    }
    return null;
  }
  return tokenToUser.get(token) || null;
}

export function _resetTokensForTest() {
  userTokens.clear();
  tokenToUser.clear();
}

function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let m = str.replace(/-/g, '+').replace(/_/g, '/');
  while (m.length % 4) m += '=';
  const binary = atob(m);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export async function signJwt(payload, secret = DEFAULT_JWT_SECRET) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigBytes = new Uint8Array(signature);
  let sigBinary = '';
  for (let i = 0; i < sigBytes.length; i++) {
    sigBinary += String.fromCharCode(sigBytes[i]);
  }
  const encodedSignature = btoa(sigBinary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${data}.${encodedSignature}`;
}

export async function verifyJwt(token, secret = DEFAULT_JWT_SECRET) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const data = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    let sigStr = encodedSignature.replace(/-/g, '+').replace(/_/g, '/');
    while (sigStr.length % 4) sigStr += '=';
    const sigBinary = atob(sigStr);
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i);
    }

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload.exp || typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }
    return payload;
  } catch (err) {
    return null;
  }
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

export async function authenticateRequest(c) {
  const isDev = (c.env?.ENVIRONMENT !== 'production');
  const secret = c.env?.JWT_SECRET || (isDev ? DEFAULT_JWT_SECRET : null);
  const apiKey = c.env?.CLOUD_QUEUE_API_KEY || c.env?.SUBMIT_TOKEN || c.env?.PHONE_SECRET || '';

  // 1. Check HttpOnly cookie
  const cookieHeader = c.req.header('Cookie') || '';
  const cookies = parseCookies(cookieHeader);
  if (cookies.session && secret) {
    const verified = await verifyJwt(cookies.session, secret);
    if (verified) {
      return { authenticated: true, user: verified, source: 'cookie' };
    }
  }

  // 2. Check Authorization header
  const authHeader = c.req.header('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    // Check static API key for worker / shortcut compatibility (scoped to service role)
    if (apiKey && token === apiKey) {
      return {
        authenticated: true,
        user: { sub: 'api-client', role: 'service', is_service: true },
        source: 'api_key'
      };
    }
    // Check personalized user token krk_live_*
    if (token.startsWith('krk_live_')) {
      const user = await verifyUserToken(token, c.env);
      if (user) {
        return { authenticated: true, user, source: 'shortcut_token' };
      }
      return { authenticated: false };
    }
    // Check JWT
    if (secret) {
      const verified = await verifyJwt(token, secret);
      if (verified) {
        return { authenticated: true, user: verified, source: 'bearer_jwt' };
      }
    }
  }

  return { authenticated: false };
}

export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host === 'kiroku.app' || host.endsWith('.kiroku.app')) return true;
    if (host === 'kirokunote.pages.dev' || host.endsWith('.kirokunote.pages.dev')) return true;
    if (/^kiroku-note(?:\.[a-z0-9_-]+)?\.workers\.dev$/i.test(host)) return true;
    if (env?.ALLOWED_ORIGINS) {
      const allowed = env.ALLOWED_ORIGINS.split(',').map(s => s.trim().toLowerCase());
      if (allowed.includes(host) || allowed.includes(origin.toLowerCase())) return true;
    }
    if (env?.WORKER_HOST && host === env.WORKER_HOST.toLowerCase()) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isAllowedRedirect(redirectUri) {
  if (!redirectUri) return false;
  try {
    const parsed = new URL(redirectUri);
    const host = parsed.hostname.toLowerCase();
    const isLoopback = (host === 'localhost' || host === '127.0.0.1');
    const isAllowedPath = parsed.pathname === '/auth/callback' || parsed.pathname === '/';
    const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
    const isValidPort = !isNaN(port) && port >= 1 && port <= 65535;
    return isLoopback && isAllowedPath && (parsed.protocol === 'http:' || parsed.protocol === 'https:') && isValidPort;
  } catch {
    return false;
  }
}

export function generateOAuthState() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// Routes
authApp.get('/auth/guest', async (c) => {
  const isDev = (c.env?.ENVIRONMENT !== 'production');
  const secret = c.env?.JWT_SECRET || (isDev ? DEFAULT_JWT_SECRET : null);
  if (!secret) {
    return c.json({ error: 'Server misconfiguration', message: 'JWT_SECRET is required' }, 500);
  }
  const guestId = 'guest_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const token = await signJwt({ sub: guestId, name: 'Guest Learner', provider: 'guest', exp: Math.floor(Date.now() / 1000) + (7 * 86400) }, secret);
  c.header('Set-Cookie', `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
  return c.redirect('/?login=guest_success');
});

authApp.get('/auth/google', async (c) => {
  const clientId = c.env?.GOOGLE_CLIENT_ID || '';
  const url = new URL(c.req.url);
  if (!isAllowedOrigin(url.origin, c.env)) {
    return c.text('Forbidden: Untrusted OAuth origin', 403);
  }
  const redirectUri = `${url.origin}/auth/callback/google`;

  if (!clientId) {
    if (c.env?.ENVIRONMENT !== 'development') {
      return c.json({ error: 'OAuth is not configured on this server' }, 503);
    }
    const devSecret = c.env?.JWT_SECRET || DEFAULT_JWT_SECRET;
    const devToken = await signJwt({ sub: 'cloud_learner', name: 'Kiroku Learner', provider: 'google_fallback', exp: Math.floor(Date.now() / 1000) + (7 * 86400) }, devSecret);
    c.header('Set-Cookie', `session=${devToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
    return c.redirect('/?login=success');
  }

  const state = generateOAuthState();
  c.header('Set-Cookie', `oauth_state=${state}; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

  const redirectParam = c.req.query('redirect');
  const desktopState = c.req.query('state') || c.req.query('desktop_state');
  if (redirectParam && isAllowedRedirect(redirectParam)) {
    c.header('Set-Cookie', `oauth_redirect=${encodeURIComponent(redirectParam)}; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, { append: true });
    if (desktopState) {
      c.header('Set-Cookie', `oauth_desktop_state=${encodeURIComponent(desktopState)}; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, { append: true });
    }
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile&access_type=online&state=${encodeURIComponent(state)}`;
  return c.redirect(authUrl);
});

authApp.get('/auth/github', async (c) => {
  const clientId = c.env?.GITHUB_CLIENT_ID || '';
  const url = new URL(c.req.url);
  if (!isAllowedOrigin(url.origin, c.env)) {
    return c.text('Forbidden: Untrusted OAuth origin', 403);
  }
  const redirectUri = `${url.origin}/auth/callback/github`;

  if (!clientId) {
    const redirectParam = c.req.query('redirect');
    const desktopState = c.req.query('state') || c.req.query('desktop_state');
    if (redirectParam && isAllowedRedirect(redirectParam)) {
      const errUrl = new URL(redirectParam);
      errUrl.searchParams.set('error', 'GitHub Sign-in is not configured yet (missing GITHUB_CLIENT_ID on server). Please use Google Sign-in.');
      if (desktopState) errUrl.searchParams.set('state', desktopState);
      return c.redirect(errUrl.toString());
    }
    return c.html(`
      <!DOCTYPE html>
      <html>
      <head><title>GitHub Sign-in Not Configured</title>
      <style>body{font-family:system-ui,-apple-system,sans-serif;background:#141311;color:#F5F1E8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
      .box{background:#1C1B19;border:1px solid rgba(245,241,232,0.15);padding:32px;border-radius:10px;max-width:480px;text-align:center;}
      h2{color:#D94B38;margin-top:0;}p{color:rgba(245,241,232,0.7);line-height:1.6;}code{background:#2A2926;padding:2px 6px;border-radius:4px;color:#4EBB7B;}
      </style></head>
      <body>
      <div class="box">
        <h2>GitHub Sign-in Not Configured</h2>
        <p>To enable GitHub sign-in, add <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> to your Cloudflare Worker.</p>
        <p>In the meantime, please use <strong>Sign in with Google</strong>.</p>
      </div>
      </body>
      </html>
    `, 503);
  }

  const state = generateOAuthState();
  c.header('Set-Cookie', `oauth_state=${state}; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

  const redirectParam = c.req.query('redirect');
  const desktopState = c.req.query('state') || c.req.query('desktop_state');
  if (redirectParam && isAllowedRedirect(redirectParam)) {
    c.header('Set-Cookie', `oauth_redirect=${encodeURIComponent(redirectParam)}; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, { append: true });
    if (desktopState) {
      c.header('Set-Cookie', `oauth_desktop_state=${encodeURIComponent(desktopState)}; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, { append: true });
    }
  }

  const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user%20user:email&state=${encodeURIComponent(state)}`;
  return c.redirect(authUrl);
});

authApp.get('/auth/callback/google', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.text('Missing authorization code', 400);

  const state = c.req.query('state');
  const cookieHeader = c.req.header('Cookie') || '';
  const cookies = parseCookies(cookieHeader);
  if (!state || !cookies.oauth_state || state !== cookies.oauth_state) {
    return c.text('Invalid or expired OAuth state parameter (CSRF protection)', 400);
  }

  const clientId = c.env?.GOOGLE_CLIENT_ID || '';
  const clientSecret = c.env?.GOOGLE_CLIENT_SECRET || '';
  const url = new URL(c.req.url);
  if (!isAllowedOrigin(url.origin, c.env)) {
    return c.text('Forbidden: Untrusted OAuth origin', 403);
  }
  const redirectUri = `${url.origin}/auth/callback/google`;

  const secret = c.env?.JWT_SECRET || (c.env?.ENVIRONMENT !== 'production' ? DEFAULT_JWT_SECRET : null);
  if (!secret) {
    return c.text('Server authentication configuration error', 500);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return c.text('Failed to exchange Google OAuth code', 500);
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await userRes.json();

    try {
      await initTursoSchema(c);
      await queryTurso(c, `
        INSERT INTO users (id, email, display_name, avatar_url, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url;
      `, [
        String(profile.id),
        profile.email || '',
        profile.name || profile.login || 'Kiroku Learner',
        profile.avatar_url || '',
        Math.floor(Date.now() / 1000)
      ]);
    } catch (dbErr) {
      console.warn('[Auth] Turso user upsert warning:', dbErr.message);
    }

    const jwtToken = await signJwt({
      sub: profile.id,
      email: profile.email,
      name: profile.name,
      provider: 'google',
      exp: Math.floor(Date.now() / 1000) + (7 * 86400)
    }, secret);

    c.header('Set-Cookie', `session=${jwtToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
    c.header('Set-Cookie', 'oauth_state=; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    c.header('Set-Cookie', 'oauth_redirect=; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    c.header('Set-Cookie', 'oauth_desktop_state=; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

    const redirectTarget = cookies.oauth_redirect ? decodeURIComponent(cookies.oauth_redirect) : null;
    const desktopState = cookies.oauth_desktop_state ? decodeURIComponent(cookies.oauth_desktop_state) : null;

    if (redirectTarget && isAllowedRedirect(redirectTarget)) {
      const redirectUrl = new URL(redirectTarget);
      redirectUrl.searchParams.set('token', jwtToken);
      redirectUrl.searchParams.set('sub', String(profile.id));
      redirectUrl.searchParams.set('email', profile.email || '');
      redirectUrl.searchParams.set('name', profile.name || profile.login || 'Learner');
      if (desktopState) {
        redirectUrl.searchParams.set('state', desktopState);
      }
      return c.redirect(redirectUrl.toString());
    }

    return c.redirect('/');
  } catch (err) {
    return c.text('Authentication error occurred', 500);
  }
});

authApp.get('/auth/callback/github', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.text('Missing authorization code', 400);

  const state = c.req.query('state');
  const cookieHeader = c.req.header('Cookie') || '';
  const cookies = parseCookies(cookieHeader);
  if (!state || !cookies.oauth_state || state !== cookies.oauth_state) {
    return c.text('Invalid or expired OAuth state parameter (CSRF protection)', 400);
  }

  const url = new URL(c.req.url);
  if (!isAllowedOrigin(url.origin, c.env)) {
    return c.text('Forbidden: Untrusted OAuth origin', 403);
  }

  const clientId = c.env?.GITHUB_CLIENT_ID || '';
  const clientSecret = c.env?.GITHUB_CLIENT_SECRET || '';

  const secret = c.env?.JWT_SECRET || (c.env?.ENVIRONMENT !== 'production' ? DEFAULT_JWT_SECRET : null);
  if (!secret) {
    return c.text('Server authentication configuration error', 500);
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return c.text('Failed to exchange GitHub OAuth code', 500);
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'Kiroku-PWA'
      }
    });
    const profile = await userRes.json();
    let userEmail = profile.email || '';
    if (!userEmail) {
      try {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            'User-Agent': 'Kiroku-PWA'
          }
        });
        if (emailsRes.ok) {
          const emails = await emailsRes.json();
          const primary = Array.isArray(emails) && (emails.find(e => e.primary && e.verified) || emails[0]);
          if (primary && primary.email) userEmail = primary.email;
        }
      } catch (_) {}
    }

    try {
      await initTursoSchema(c);
      await queryTurso(c, `
        INSERT INTO users (id, email, display_name, avatar_url, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url;
      `, [
        String(profile.id),
        userEmail,
        profile.name || profile.login || 'Kiroku Learner',
        profile.avatar_url || '',
        Math.floor(Date.now() / 1000)
      ]);
    } catch (dbErr) {
      console.warn('[Auth] Turso user upsert warning:', dbErr.message);
    }

    const jwtToken = await signJwt({
      sub: String(profile.id),
      name: profile.name || profile.login,
      provider: 'github',
      exp: Math.floor(Date.now() / 1000) + (7 * 86400)
    }, secret);

    c.header('Set-Cookie', `session=${jwtToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
    c.header('Set-Cookie', 'oauth_state=; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    c.header('Set-Cookie', 'oauth_redirect=; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    c.header('Set-Cookie', 'oauth_desktop_state=; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

    const redirectTarget = cookies.oauth_redirect ? decodeURIComponent(cookies.oauth_redirect) : null;
    const desktopState = cookies.oauth_desktop_state ? decodeURIComponent(cookies.oauth_desktop_state) : null;

    if (redirectTarget && isAllowedRedirect(redirectTarget)) {
      const redirectUrl = new URL(redirectTarget);
      redirectUrl.searchParams.set('token', jwtToken);
      redirectUrl.searchParams.set('sub', String(profile.id));
      redirectUrl.searchParams.set('email', profile.email || '');
      redirectUrl.searchParams.set('name', profile.name || profile.login || 'Learner');
      if (desktopState) {
        redirectUrl.searchParams.set('state', desktopState);
      }
      return c.redirect(redirectUrl.toString());
    }

    return c.redirect('/');
  } catch (err) {
    return c.text('Authentication error occurred', 500);
  }
});

authApp.get('/auth/me', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    return c.json({ authenticated: false, user: null }, 401);
  }
  return c.json({ authenticated: true, user: auth.user, source: auth.source });
});

authApp.get('/api/user/token', async (c) => {
  const auth = await authenticateRequest(c);
  const user = auth.authenticated ? auth.user : (c.get('user') || (c.env?.ENVIRONMENT !== 'production' ? { sub: 'dev_user' } : null));
  if (!user || !user.sub) {
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  }
  const token = await getUserToken(user.sub, c.env);
  return c.json({ token, user_id: user.sub, created_at: Date.now() });
});

authApp.post('/api/user/token/regenerate', async (c) => {
  const auth = await authenticateRequest(c);
  const user = auth.authenticated ? auth.user : (c.get('user') || (c.env?.ENVIRONMENT !== 'production' ? { sub: 'dev_user' } : null));
  if (!user || !user.sub) {
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  }
  const token = await regenerateUserToken(user.sub, c.env);
  return c.json({ token, user_id: user.sub, regenerated: true, created_at: Date.now() });
});

authApp.post('/auth/logout', async (c) => {
  c.header('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return c.json({ status: 'ok', logged_out: true });
});

