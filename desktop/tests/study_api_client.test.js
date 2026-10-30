const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { StudyApiClient, StudyApiError } = require('../src/study_api_client');

test('StudyApiClient: attaches Bearer token to protected /api/study/v1 requests', async () => {
  const testPort = 31001;
  const expectedToken = 'test-ephemeral-token-abc123xyz';
  let receivedAuthHeader = null;

  const server = http.createServer((req, res) => {
    receivedAuthHeader = req.headers['authorization'];
    if (req.url === '/api/study/v1/bank/summary') {
      if (req.headers['authorization'] === `Bearer ${expectedToken}`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total_questions: 42, active_questions: 40 }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid bearer token' } }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(testPort, '127.0.0.1', resolve));

  try {
    const client = new StudyApiClient({
      port: testPort,
      getToken: () => expectedToken
    });

    const summary = await client.getBankSummary();
    assert.equal(summary.total_questions, 42);
    assert.equal(receivedAuthHeader, `Bearer ${expectedToken}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('StudyApiClient: unauthenticated /api/health request does not require Bearer token', async () => {
  const testPort = 31002;
  let receivedAuthHeader = null;

  const server = http.createServer((req, res) => {
    receivedAuthHeader = req.headers['authorization'];
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(testPort, '127.0.0.1', resolve));

  try {
    const client = new StudyApiClient({
      port: testPort,
      getToken: () => 'some-token'
    });

    const health = await client.checkHealth();
    assert.equal(health.status, 'ok');
    assert.equal(receivedAuthHeader, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('StudyApiClient: parses structured FastAPI StudyAPIError response', async () => {
  const testPort = 31003;

  const server = http.createServer((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid level filter',
        details: { field: 'level', allowed: ['N1', 'N2', 'N3', 'N4', 'N5'] }
      }
    }));
  });

  await new Promise((resolve) => server.listen(testPort, '127.0.0.1', resolve));

  try {
    const client = new StudyApiClient({ port: testPort, getToken: () => 'token' });

    await assert.rejects(
      async () => {
        await client.getBankSummary('N9');
      },
      (err) => {
        assert.ok(err instanceof StudyApiError);
        assert.equal(err.code, 'VALIDATION_FAILED');
        assert.equal(err.statusCode, 400);
        assert.equal(err.details.field, 'level');
        return true;
      }
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('StudyApiClient: attaches client_request_id (UUID) to mutating requests', async () => {
  const testPort = 31004;
  let receivedRequestId = null;

  const server = http.createServer((req, res) => {
    receivedRequestId = req.headers['x-client-request-id'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ session_id: 'test-session-1' }));
  });

  await new Promise((resolve) => server.listen(testPort, '127.0.0.1', resolve));

  try {
    const client = new StudyApiClient({ port: testPort, getToken: () => 'token' });
    const customReqId = client.generateRequestId();

    // Verify UUID format
    assert.match(customReqId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    await client.createPracticeSession({ level: 'N3', question_count: 5 }, customReqId);
    assert.equal(receivedRequestId, customReqId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('StudyApiClient: handles media byte-range requests (RFC 7233 partial content)', async () => {
  const testPort = 31005;
  let receivedRangeHeader = null;

  const server = http.createServer((req, res) => {
    receivedRangeHeader = req.headers['range'];
    res.writeHead(206, {
      'Content-Type': 'audio/mpeg',
      'Content-Range': 'bytes 0-9/100',
      'Accept-Ranges': 'bytes'
    });
    res.end(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  await new Promise((resolve) => server.listen(testPort, '127.0.0.1', resolve));

  try {
    const client = new StudyApiClient({ port: testPort, getToken: () => 'token' });
    const mediaRes = await client.getMedia('sample_audio_sha', 'bytes=0-9');

    assert.equal(mediaRes.status, 206);
    assert.equal(receivedRangeHeader, 'bytes=0-9');
    assert.ok(Buffer.isBuffer(mediaRes.data));
    assert.equal(mediaRes.data.length, 10);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('StudyApiClient: safely retries transient 503 errors on idempotent calls', async () => {
  const testPort = 31006;
  let attempts = 0;

  const server = http.createServer((req, res) => {
    attempts++;
    if (attempts === 1) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Server warming up' } }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ is_ready: true }));
    }
  });

  await new Promise((resolve) => server.listen(testPort, '127.0.0.1', resolve));

  try {
    const client = new StudyApiClient({
      port: testPort,
      getToken: () => 'token',
      maxRetries: 2,
      retryDelayMs: 50
    });

    const readiness = await client.getExamReadiness();
    assert.equal(readiness.is_ready, true);
    assert.equal(attempts, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('StudyApiClient: enforces strict path whitelist and rejects directory traversal', async () => {
  const client = new StudyApiClient({ port: 21828, getToken: () => 'token' });

  await assert.rejects(
    async () => {
      await client.request({ path: '/api/cards/123' });
    },
    /not a permitted Study API endpoint/
  );

  await assert.rejects(
    async () => {
      await client.request({ path: '/api/study/v1/../../etc/passwd' });
    },
    // Either StudyApiError or URL resolution rejection
    /StudyApiError|permitted|path/i
  );
});

