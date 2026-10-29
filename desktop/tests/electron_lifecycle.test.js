const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('Electron Lifecycle: Launches window, creates system tray, and exits cleanly', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const launchScript = path.join(repoRoot, 'desktop', 'bin', 'launch.js');
  const resultJsonPath = path.join(__dirname, 'lifecycle_result.json');

  if (fs.existsSync(resultJsonPath)) {
    fs.unlinkSync(resultJsonPath);
  }

  const env = {
    ...process.env,
    KIROKU_DESKTOP_TEST_LIFECYCLE: '1'
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const result = spawnSync(process.execPath, [launchScript], {
    env,
    timeout: 10000,
    stdio: 'pipe'
  });

  assert.equal(result.status, 0, `Electron launcher exited with code ${result.status}, stderr: ${result.stderr.toString()}`);
  assert.equal(fs.existsSync(resultJsonPath), true, 'lifecycle_result.json was not created');

  const data = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8'));
  assert.equal(data.success, true);
  assert.equal(data.windowCreated, true, 'Window was not created');
  assert.equal(data.trayCreated, true, 'System tray was not created');
  assert.ok(Math.abs(data.contentWidth - 500) <= 2, `Content width (${data.contentWidth}) should be ~500px`);
  assert.ok(Math.abs(data.contentHeight - 750) <= 2, `Content height (${data.contentHeight}) should be ~750px`);
  assert.equal(data.isResizable, true, 'Window must be resizable');

  // Clean up
  fs.unlinkSync(resultJsonPath);
});
