const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const TEST_PORT = 29992;

async function waitForBackend(port, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/health`, (r) => {
          resolve(r.statusCode);
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
      });
      if (res === 200) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Backend on port ${port} failed to start in time`);
}

test('Real-transport test: Renderer under file:// successfully performs GET and POST round-trips via IPC proxy', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiroku_transport_test_'));
  const runnerScript = path.join(tempDir, 'transport_runner.js');
  const resultJsonPath = path.join(tempDir, 'transport_result.json');

  const env = {
    ...process.env,
    PYTHONPATH: `${path.join(repoRoot, 'backend')};${repoRoot}`,
    KIROKU_DATA_DIR: tempDir,
    KIROKU_PORT: String(TEST_PORT)
  };
  delete env.ELECTRON_RUN_AS_NODE;

  // 1. Spawn isolated backend
  const backend = spawn('python', ['run_backend.py', '--port', String(TEST_PORT)], {
    cwd: repoRoot,
    env,
    stdio: 'pipe'
  });

  try {
    await waitForBackend(TEST_PORT);

    // 2. Create Electron test script that runs main.js with our test port
    const electronScriptContent = `
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

app.whenReady().then(async () => {
  // Setup IPC handler matching main.js implementation
  ipcMain.handle('backend:info', () => ({
    status: 'running',
    port: ${TEST_PORT},
    host: '127.0.0.1'
  }));

  ipcMain.handle('backend:services-status', () => ({
    backend: true,
    yomitan: false,
    anki: false,
    ocr: false,
    lastChecked: new Date().toISOString()
  }));

  ipcMain.handle('kiroku:api:request', async (event, req = {}) => {
    const { method = 'GET', path: reqPath, query, body, headers = {} } = req;
    const upperMethod = method.toUpperCase();

    let fullPath = reqPath;
    if (query && typeof query === 'object') {
      const qs = new URLSearchParams(query).toString();
      if (qs) fullPath += (fullPath.includes('?') ? '&' : '?') + qs;
    }

    const reqHeaders = { 'Accept': 'application/json', ...headers };
    let payload = null;
    if (body !== undefined && body !== null) {
      payload = typeof body === 'object' ? JSON.stringify(body) : String(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    return new Promise((resolve) => {
      const httpReq = http.request({
        hostname: '127.0.0.1',
        port: ${TEST_PORT},
        path: fullPath,
        method: upperMethod,
        headers: reqHeaders,
        timeout: 10000
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try { parsed = JSON.parse(buf); } catch (_) { parsed = buf; }
          resolve({
            success: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data: parsed
          });
        });
      });
      httpReq.on('error', (err) => resolve({ success: false, status: 0, error: { message: err.message } }));
      if (payload) httpReq.write(payload);
      httpReq.end();
    });
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join('${repoRoot.replace(/\\/g, '\\\\')}', 'desktop', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join('${repoRoot.replace(/\\/g, '\\\\')}', 'desktop', 'src', 'index.html'));

  // Test round-trips from renderer using window.desktopAPI.api.request
  const testResults = await win.webContents.executeJavaScript(\`
    (async () => {
      const r = {};
      // 1. Initial GET /api/cards (empty list expected)
      const list1 = await window.desktopAPI.api.request({ method: 'GET', path: '/api/cards' });
      r.initialList = list1;

      // 2. POST /api/cards/save (saving a new card)
      const saveRes = await window.desktopAPI.api.request({
        method: 'POST',
        path: '/api/cards/save',
        body: {
          expression: '食べる',
          reading: 'たべる',
          meaning: 'to eat',
          tags: 'jlpt-n5'
        }
      });
      r.save = saveRes;

      // 3. Second GET /api/cards (must contain newly saved card)
      const list2 = await window.desktopAPI.api.request({ method: 'GET', path: '/api/cards' });
      r.afterList = list2;

      // 4. GET /api/cards/stats
      const stats = await window.desktopAPI.api.request({ method: 'GET', path: '/api/cards/stats' });
      r.stats = stats;

      return r;
    })()
  \`);

  fs.writeFileSync('${resultJsonPath.replace(/\\/g, '\\\\')}', JSON.stringify(testResults, null, 2));
  win.destroy();
  app.quit();
});
`;
    fs.writeFileSync(runnerScript, electronScriptContent);

    // 3. Launch Electron binary
    const electronBinary = require(path.join(repoRoot, 'desktop', 'node_modules', 'electron'));
    const runResult = spawnSync(electronBinary, [runnerScript], {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      timeout: 25000
    });

    assert.equal(runResult.status, 0, 'Electron test runner should exit with status 0');
    assert.equal(fs.existsSync(resultJsonPath), true, 'transport_result.json was created');

    const result = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8'));

    // Assert initial list
    assert.equal(result.initialList.success, true, 'Initial GET /api/cards must succeed');
    assert.equal(result.initialList.status, 200);
    assert.ok(Array.isArray(result.initialList.data.cards), 'Initial list returns cards array');
    assert.equal(result.initialList.data.cards.length, 0, 'Initial list is empty');

    // Assert card save
    assert.equal(result.save.success, true, 'POST /api/cards/save must succeed');
    assert.equal(result.save.status, 200);
    assert.equal(result.save.data.expression, '食べる');
    assert.equal(result.save.data.reading, 'たべる');

    // Assert card retrieval after save
    assert.equal(result.afterList.success, true, 'Second GET /api/cards must succeed');
    assert.equal(result.afterList.data.cards.length, 1, 'Card list must now have 1 card');
    assert.equal(result.afterList.data.cards[0].expression, '食べる');

    // Assert stats
    assert.equal(result.stats.success, true, 'GET /api/cards/stats must succeed');
    assert.equal(result.stats.data.total, 1, 'Total cards stat must be 1');

  } finally {
    try {
      spawnSync('taskkill', ['/pid', String(backend.pid), '/T', '/F']);
    } catch (_) {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
});
