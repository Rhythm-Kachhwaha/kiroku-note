const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { ProcessManager } = require('../src/process_manager');

test('ProcessManager: detects offline backend', async () => {
  // Port 29999 should not be running
  const pm = new ProcessManager({ port: 29999 });
  const healthy = await pm.isBackendHealthy(500);
  assert.equal(healthy, false);
  assert.equal(pm.status, 'stopped');
});

test('ProcessManager: detects online backend', async () => {
  const testPort = 29998;
  const server = http.createServer((req, res) => {
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
    const pm = new ProcessManager({ port: testPort });
    const healthy = await pm.isBackendHealthy(1000);
    assert.equal(healthy, true);

    // Test adopting pre-existing backend
    const startResult = await pm.startBackend();
    assert.equal(startResult.status, 'running');
    assert.equal(startResult.external, true);
    assert.equal(pm.isExternal, true);
    assert.equal(pm.childProcess, null);

    // Stop should not kill external process
    pm.stopBackend();
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

test('ProcessManager: waitForBackend succeeds when server responds within timeout', async () => {
  const testPort = 29997;
  let server = null;
  const pm = new ProcessManager({ port: testPort });

  // Start server after a short delay
  setTimeout(() => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    server.listen(testPort, '127.0.0.1');
  }, 400);

  try {
    const ready = await pm.waitForBackend(3000, 200);
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
      await pm.waitForBackend(800, 150);
    },
    /timed out/
  );
  assert.equal(pm.status, 'failed');
});

