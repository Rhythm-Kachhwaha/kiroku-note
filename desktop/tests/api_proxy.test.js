/**
 * Test: Backend IPC HTTP Proxy Readiness & ECONNREFUSED Recovery
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { forwardApiRequest } = require('../src/api_proxy');

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

function getUnusedPort() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test('forwardApiRequest waits for backend startup before sending request', async () => {
  const port = await getUnusedPort();
  let server = null;
  let ensureCalls = 0;

  try {
    const res = await forwardApiRequest({
      req: { method: 'GET', path: '/api/grammar/syllabus', query: { level: 'N4' } },
      host: '127.0.0.1',
      port,
      getToken: () => 'test-token',
      ensureBackendReady: async () => {
        ensureCalls += 1;
        // Simulate backend finishing boot asynchronously after 80ms
        await new Promise((r) => setTimeout(r, 80));
        server = http.createServer((req, httpRes) => {
          assert.equal(req.url, '/api/grammar/syllabus?level=N4');
          assert.equal(req.headers.authorization, 'Bearer test-token');
          httpRes.writeHead(200, { 'Content-Type': 'application/json' });
          httpRes.end(JSON.stringify({ items: [{ pattern_key: 'te-iru' }] }));
        });
        await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
        return true;
      }
    });

    assert.equal(ensureCalls, 1);
    assert.equal(res.success, true);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { items: [{ pattern_key: 'te-iru' }] });
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('forwardApiRequest recovers from transient ECONNREFUSED by re-ensuring backend and retrying once', async () => {
  const port = await getUnusedPort();
  let server = null;
  let ensureCalls = 0;
  let sawForceCheck = false;

  try {
    const res = await forwardApiRequest({
      req: { method: 'GET', path: '/api/kanji/details', query: { char: '静' } },
      host: '127.0.0.1',
      port,
      getToken: () => 'test-token',
      ensureBackendReady: async (_timeoutMs, opts = {}) => {
        ensureCalls += 1;
        if (opts.forceCheck) {
          sawForceCheck = true;
          server = http.createServer((_req, httpRes) => {
            httpRes.writeHead(200, { 'Content-Type': 'application/json' });
            httpRes.end(JSON.stringify({ char: '静' }));
          });
          await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
        }
        return true;
      }
    });

    assert.equal(ensureCalls, 2);
    assert.equal(sawForceCheck, true);
    assert.equal(res.success, true);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { char: '静' });
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('forwardApiRequest does not wait or retry when app is quitting', async () => {
  const port = await getUnusedPort();
  let ensureCalled = false;

  const res = await forwardApiRequest({
    req: { method: 'GET', path: '/api/health' },
    host: '127.0.0.1',
    port,
    isQuitting: () => true,
    ensureBackendReady: async () => {
      ensureCalled = true;
      return true;
    }
  });

  assert.equal(ensureCalled, false);
  assert.equal(res.success, false);
  assert.equal(res.status, 0);
  assert.equal(res.error.code, 'NETWORK_ERROR');
  assert.equal('errCode' in res.error, false);
});

test('forwardApiRequest rejects invalid paths and methods before waiting on backend', async () => {
  let ensureCalled = false;
  const ensureBackendReady = async () => {
    ensureCalled = true;
    return true;
  };

  const badPath = await forwardApiRequest({
    req: { method: 'GET', path: '/api/../secret' },
    ensureBackendReady
  });
  assert.equal(badPath.success, false);
  assert.equal(badPath.error.code, 'REQUEST_FAILED');
  assert.equal(ensureCalled, false);

  const badMethod = await forwardApiRequest({
    req: { method: 'TRACE', path: '/api/health' },
    ensureBackendReady
  });
  assert.equal(badMethod.success, false);
  assert.equal(badMethod.error.code, 'REQUEST_FAILED');
  assert.equal(ensureCalled, false);
});

test('forwardApiRequest forwards successful HTTP response directly when backend is already up', async () => {
  const { server, port } = await startMockServer((_req, httpRes) => {
    httpRes.writeHead(200, { 'Content-Type': 'application/json' });
    httpRes.end(JSON.stringify({ ok: true }));
  });

  try {
    const res = await forwardApiRequest({
      req: { method: 'GET', path: '/api/health' },
      host: '127.0.0.1',
      port,
      ensureBackendReady: async () => true
    });
    assert.equal(res.success, true);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { ok: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

