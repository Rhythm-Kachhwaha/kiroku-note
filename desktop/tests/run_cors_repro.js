const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const repoRoot = path.resolve(__dirname, '..', '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiroku_cors_repro_'));
console.log('Using temp KIROKU_DATA_DIR:', tempDir);

const env = {
  ...process.env,
  PYTHONPATH: `${path.join(repoRoot, 'backend')};${repoRoot}`,
  KIROKU_DATA_DIR: tempDir,
  KIROKU_PORT: '21828'
};
delete env.ELECTRON_RUN_AS_NODE;

// 1. Spawn backend
console.log('Spawning backend on port 21828...');
const backendProcess = spawn('python', ['run_backend.py', '--port', '21828'], {
  cwd: repoRoot,
  env,
  stdio: 'pipe'
});

backendProcess.stdout.on('data', (d) => {
  // console.log('[Backend stdout]', d.toString());
});
backendProcess.stderr.on('data', (d) => {
  // console.log('[Backend stderr]', d.toString());
});

async function waitForBackend(timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.get('http://127.0.0.1:21828/api/health', (r) => {
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
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('Backend failed to start in time');
}

(async () => {
  try {
    await waitForBackend();
    console.log('Backend is UP and healthy on http://127.0.0.1:21828/api/health');

    // 2. Run electron with reproduce_cors_failure.js
    const electronBinary = require(path.join(repoRoot, 'desktop', 'node_modules', 'electron'));
    const testScript = path.join(repoRoot, 'desktop', 'tests', 'reproduce_cors_failure.js');

    console.log('Launching Electron to reproduce CORS/network errors under file:// ...');
    const result = spawnSync(electronBinary, [testScript], {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      timeout: 20000
    });

    console.log('Electron reproduction script exited with code:', result.status);
  } catch (err) {
    console.error('Reproduction failed:', err);
  } finally {
    console.log('Cleaning up backend process PID:', backendProcess.pid);
    try {
      spawnSync('taskkill', ['/pid', backendProcess.pid.toString(), '/T', '/F']);
    } catch (_) {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
})();
