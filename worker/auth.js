/**
 * Kiroku Note — Cloudflare Worker Authentication Module
 * Handles OAuth 2.0 (Google, GitHub), cryptographic JWT issuance, and secure cookie management.
 */

import { Hono } from 'hono';

export const authApp = new Hono();

const DEFAULT_JWT_SECRET = 'kiroku-edge-development-secret-change-in-production';

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
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
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
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

export async function authenticateRequest(c) {
  const secret = c.env?.JWT_SECRET || DEFAULT_JWT_SECRET;
  const apiKey = c.env?.CLOUD_QUEUE_API_KEY || '';

  // 1. Check HttpOnly cookie
  const cookieHeader = c.req.header('Cookie') || '';
  const cookies = parseCookies(cookieHeader);
  if (cookies.session) {
    const verified = await verifyJwt(cookies.session, secret);
    if (verified) {
      return { authenticated: true, user: verified, source: 'cookie' };
    }
  }

  // 2. Check Authorization header
  const authHeader = c.req.header('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    // Check static API key for worker / shortcut compatibility
    if (apiKey && token === apiKey) {
      return { authenticated: true, user: { sub: 'api-client', role: 'worker' }, source: 'api_key' };
    }
    // Check JWT
    const verified = await verifyJwt(token, secret);
    if (verified) {
      return { authenticated: true, user: verified, source: 'bearer_jwt' };
    }
  }

  return { authenticated: false };
}

// Routes
authApp.get('/auth/google', async (c) => {
  const clientId = c.env?.GOOGLE_CLIENT_ID || '';
  const url = new URL(c.req.url);
  const redirectUri = `${url.origin}/auth/callback/google`;

  if (!clientId) {
    // If OAuth is unconfigured in development, issue a local dev token
    const devToken = await signJwt({ sub: 'dev_user', name: 'Kiroku Learner', provider: 'local_dev', exp: Math.floor(Date.now() / 1000) + (7 * 86400) }, c.env?.JWT_SECRET || DEFAULT_JWT_SECRET);
    c.header('Set-Cookie', `session=${devToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
    return c.redirect('/?login=dev_success');
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile&access_type=online`;
  return c.redirect(authUrl);
});

authApp.get('/auth/github', async (c) => {
  const clientId = c.env?.GITHUB_CLIENT_ID || '';
  const url = new URL(c.req.url);
  const redirectUri = `${url.origin}/auth/callback/github`;

  if (!clientId) {
    const devToken = await signJwt({ sub: 'dev_user', name: 'Kiroku Learner', provider: 'local_dev', exp: Math.floor(Date.now() / 1000) + (7 * 86400) }, c.env?.JWT_SECRET || DEFAULT_JWT_SECRET);
    c.header('Set-Cookie', `session=${devToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
    return c.redirect('/?login=dev_success');
  }

  const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user%20user:email`;
  return c.redirect(authUrl);
});

authApp.get('/auth/callback/google', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.text('Missing authorization code', 400);

  const clientId = c.env?.GOOGLE_CLIENT_ID || '';
  const clientSecret = c.env?.GOOGLE_CLIENT_SECRET || '';
  const url = new URL(c.req.url);
  const redirectUri = `${url.origin}/auth/callback/google`;

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

    const jwtToken = await signJwt({
      sub: profile.id,
      email: profile.email,
      name: profile.name,
      provider: 'google',
      exp: Math.floor(Date.now() / 1000) + (7 * 86400)
    }, c.env?.JWT_SECRET || DEFAULT_JWT_SECRET);

    c.header('Set-Cookie', `session=${jwtToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
    return c.redirect('/');
  } catch (err) {
    return c.text(`Google OAuth Error: ${err.message}`, 500);
  }
});

authApp.get('/auth/callback/github', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.text('Missing authorization code', 400);

  const clientId = c.env?.GITHUB_CLIENT_ID || '';
  const clientSecret = c.env?.GITHUB_CLIENT_SECRET || '';

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

    const jwtToken = await signJwt({
      sub: String(profile.id),
      name: profile.name || profile.login,
      provider: 'github',
      exp: Math.floor(Date.now() / 1000) + (7 * 86400)
    }, c.env?.JWT_SECRET || DEFAULT_JWT_SECRET);

    c.header('Set-Cookie', `session=${jwtToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
    return c.redirect('/');
  } catch (err) {
    return c.text(`GitHub OAuth Error: ${err.message}`, 500);
  }
});

authApp.get('/auth/me', async (c) => {
  const auth = await authenticateRequest(c);
  if (!auth.authenticated) {
    return c.json({ authenticated: false, user: null }, 401);
  }
  return c.json({ authenticated: true, user: auth.user, source: auth.source });
});

authApp.post('/auth/logout', async (c) => {
  c.header('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return c.json({ status: 'ok', logged_out: true });
});

