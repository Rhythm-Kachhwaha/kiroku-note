const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { ProcessManager } = require('../src/process_manager');

test('ProcessManager: generates and retains cryptographically secure ephemeral token in-memory', () => {
  const pm = new ProcessManager();
  const token = pm.getApiToken();

  assert.ok(token);
  assert.equal(typeof token, 'string');
  // 32 bytes in base64url is 43 characters long
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);

  // Regenerated token must be different
  const token2 = pm.refreshToken();
  assert.notEqual(token, token2);
  assert.equal(token2.length, 43);
});

test('ProcessManager: redacts ephemeral Bearer token in log outputs', () => {
  const pm = new ProcessManager();
  const token = pm.getApiToken();

  const rawMessage = `Starting backend with KIROKU_STUDY_API_TOKEN=${token} and Header Authorization: Bearer ${token}`;
  const sanitized = pm._sanitize(rawMessage);

  assert.equal(sanitized.includes(token), false);
  assert.match(sanitized, /\[REDACTED/);
});

test('ProcessManager: detects offline backend', async () => {
  // Port 29999 should not be running
  const pm = new ProcessManager({ port: 29999 });
  const healthy = await pm.isBackendHealthy(500);
  assert.equal(healthy, false);
  assert.equal(pm.status, 'stopped');
});

test('ProcessManager: detects online backend and verifies authenticated Study API', async () => {
  const testPort = 29998;
  const pm = new ProcessManager({ port: testPort });
  const expectedToken = pm.getApiToken();

  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else if (req.url === '/api/study/v1/bank/summary') {
      if (req.headers['authorization'] === `Bearer ${expectedToken}`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total_questions: 10, active_questions: 10 }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(testPort, '127.0.0.1', resolve));

  try {
    const healthy = await pm.isBackendHealthy(1000);
    assert.equal(healthy, true);

    const studyAuth = await pm.isStudyApiAuthenticated(1000);
    assert.equal(studyAuth, true);

    // Test adopting pre-existing backend
    const startResult = await pm.startBackend();
    assert.equal(startResult.status, 'running');
    assert.equal(startResult.external, true);
    assert.equal(pm.isExternal, true);
    assert.equal(pm.childProcess, null);

    // Stop should not kill external process
    await pm.stopBackend();
    assert.equal(pm.status, 'stopped');

    // Server should still be alive
    const stillHealthy = await pm.isBackendHealthy(1000);
    assert.equal(stillHealthy, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ProcessManager: resolveBackendCommand development path', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const pm = new ProcessManager({ isPackaged: false, repoRoot });
  const cmd = pm.resolveBackendCommand();
  assert.equal(cmd.args[0], 'run_backend.py');
  assert.equal(cmd.cwd, repoRoot);
});

test('ProcessManager: resolveBackendCommand packaged path with explicit candidate', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const fakeExe = path.join(repoRoot, 'desktop', 'bin', 'launch.js'); // Existing file as mock candidate
  const pm = new ProcessManager({ isPackaged: true, packagedExecutablePath: fakeExe, repoRoot });
  const cmd = pm.resolveBackendCommand();
  assert.equal(cmd.command, fakeExe);
});

test('ProcessManager: waitForBackend succeeds when both health and Study API respond', async () => {
  const testPort = 29997;
  let server = null;
  const pm = new ProcessManager({ port: testPort });
  const token = pm.getApiToken();

  // Start mock server after 300ms delay
  setTimeout(() => {
    server = http.createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (req.url === '/api/study/v1/bank/summary') {
        if (req.headers['authorization'] === `Bearer ${token}`) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ total_questions: 5 }));
        } else {
          res.writeHead(401);
          res.end();
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(testPort, '127.0.0.1');
  }, 300);

  try {
    const ready = await pm.waitForBackend(4000, 150);
    assert.equal(ready, true);
    assert.equal(pm.status, 'running');
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('ProcessManager: waitForBackend times out when server never responds', async () => {
  const testPort = 29996;
  const pm = new ProcessManager({ port: testPort });

  await assert.rejects(
    async () => {
      await pm.waitForBackend(600, 150);
    },
    /timed out/
  );
  assert.equal(pm.status, 'failed');
});

test('ProcessManager: stops managed process cleanly without orphans', async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  // Launch a benign short-lived sleep process simulating the backend
  const pm = new ProcessManager({
    port: 29995,
    repoRoot,
    pythonExecutable: 'node',
    isPackaged: false
  });

  // Override command to run an idle node script
  pm.resolveBackendCommand = () => ({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: repoRoot
  });

  const startRes = await pm.startBackend();
  assert.equal(startRes.status, 'starting');
  assert.ok(pm.childProcess);
  const pid = pm.childProcess.pid;
  assert.ok(pid > 0);

  // Terminate cleanly
  await pm.stopBackend(1000);
  assert.equal(pm.status, 'stopped');
  assert.equal(pm.childProcess, null);
});
