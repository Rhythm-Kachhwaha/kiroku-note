try { if (process.loadEnvFile) process.loadEnvFile(); } catch (_) {}
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';

// Configure DNS for Neon on Windows local test runners
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  const origLookup = dns.lookup;
  dns.lookup = function (hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (hostname && hostname.includes('neon.tech')) {
      dnsPromises.resolve4(hostname).then(ips => {
        if (options && options.all) {
          callback(null, ips.map(ip => ({ address: ip, family: 4 })));
        } else {
          callback(null, ips[0], 4);
        }
      }).catch(err => origLookup(hostname, options, callback));
    } else {
      origLookup(hostname, options, callback);
    }
  };
} catch (_) {}

import app from '../index.js';

describe('Cloudflare Worker Edge API Handlers', () => {
  it('GET /api/health returns healthy edge status', async () => {
    const res = await app.request('/api/health');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.service, 'kiroku-edge-worker');
    assert.equal(data.neon_db, 'connected');
  });

  it('GET /auth/me returns 401 when unauthenticated', async () => {
    const res = await app.request('/auth/me');
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.authenticated, false);
  });

  it('POST /auth/logout clears session', async () => {
    const res = await app.request('/auth/logout', { method: 'POST' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.logged_out, true);
  });

  it('POST /api/tokenize returns Sudachi tokens', async () => {
    const res = await app.request('/api/tokenize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '日本語を勉強します' })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.tokens));
    assert.ok(data.tokens.length > 0);
  });

  it('GET /api/dictionary/lookup returns dictionary entries and kanji', async () => {
    const res = await app.request('/api/dictionary/lookup?term=猫');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.query, '猫');
    assert.ok(Array.isArray(data.entries));
    assert.ok(Array.isArray(data.kanji));
    assert.ok(data.kanji.length > 0);
    assert.equal(data.kanji[0].character, '猫');
  });

  it('GET /api/kanji/strokes/:character returns SVG strokes', async () => {
    const res = await app.request('/api/kanji/strokes/日');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.character, '日');
    assert.ok(data.svg && data.svg.includes('<svg'));
  });

  it('GET /api/grammar/index returns grammar concepts from Neon', async () => {
    const res = await app.request('/api/grammar/index?level=N3');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.points));
    assert.ok(data.points.length > 0);
  });

  it('GET /api/study/v1/bank/summary returns question summary', async () => {
    const res = await app.request('/api/study/v1/bank/summary');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.summary));
    assert.ok(data.summary.length > 0);
  });

  it('GET /api/study/v1/bank/questions returns JLPT questions', async () => {
    const res = await app.request('/api/study/v1/bank/questions?level=N3&limit=5');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.questions));
    assert.ok(data.questions.length > 0);
  });
});
