/**
 * Kiroku Note - Packaged Windows Smoke Test
 * -----------------------------------------
 * Verifies that dist/desktop/kiroku.exe:
 * 1. Launches cleanly as a standalone Windows executable.
 * 2. Automatically starts its bundled Python backend (KirokuNote.exe).
 * 3. Generates the ephemeral Bearer token in memory.
 * 4. Communicates successfully with the authenticated Study HTTP API.
 * 5. Cleanly terminates the backend process tree upon quit without orphaned processes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const kirokuExe = path.join(repoRoot, 'dist', 'desktop', 'kiroku.exe');
const smokeResultPath = path.join(repoRoot, 'desktop', 'tests', 'smoke_result.json');

test('Packaged Smoke Test: kiroku.exe launches, supervises backend, authenticates Study API, and cleans up', async (t) => {
  if (!fs.existsSync(kirokuExe)) {
    t.skip(`Packaged executable not found at ${kirokuExe}; run release/build-desktop.ps1 first`);
    return;
  }

  // Clean prior smoke log
  if (fs.existsSync(smokeResultPath)) {
    fs.unlinkSync(smokeResultPath);
  }

  // Ensure port 21828 is free
  try {
    const netstat = execSync('netstat -ano | findstr :21828', { encoding: 'utf8' });
    if (netstat) {
      console.log('Port 21828 appears busy before test:\n', netstat);
    }
  } catch (_) {}

  console.log(`[Smoke Test] Launching packaged executable: ${kirokuExe}`);
  const env = {
    ...process.env,
    KIROKU_DESKTOP_TEST_SMOKE: '1',
    KIROKU_SMOKE_LOG: smokeResultPath,
    ELECTRON_ENABLE_LOGGING: '1'
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(kirokuExe, [], {
    cwd: path.dirname(kirokuExe),
    env,
    stdio: 'inherit'
  });

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {}
      reject(new Error('Packaged smoke test timed out after 35 seconds'));
    }, 35000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log(`[Smoke Test] kiroku.exe exited with code ${exitCode}`);
  assert.equal(exitCode, 0, `kiroku.exe should exit with code 0, got ${exitCode}`);

  // Verify smoke result file exists
  assert.equal(fs.existsSync(smokeResultPath), true, 'Smoke test result JSON must be generated');

  const result = JSON.parse(fs.readFileSync(smokeResultPath, 'utf8'));
  console.log('[Smoke Test] Result data:', JSON.stringify(result, null, 2));

  assert.equal(result.success, true, `Smoke test should report success: ${result.error || ''}`);
  assert.equal(result.backendStatus, 'running', 'Backend supervisor status must be running');
  assert.equal(result.hasApiToken, true, 'Ephemeral Bearer token must be generated');
  assert.ok(result.health, 'Health endpoint response must be present');
  assert.ok(result.bank, 'Study bank summary response must be present');
  assert.equal(typeof result.bank.total_questions, 'number', 'Bank total_questions must be a number');

  // Verify that the child process PID was recorded and is now dead (no orphans)
  const backendPid = result.pid;
  assert.ok(backendPid, 'Backend child process PID must be reported');

  let processStillRunning = false;
  try {
    const tasklist = execSync(`tasklist /fi "PID eq ${backendPid}"`, { encoding: 'utf8' });
    if (tasklist.includes(String(backendPid))) {
      processStillRunning = true;
    }
  } catch (_) {}

  assert.equal(processStillRunning, false, `Backend process PID ${backendPid} must be terminated upon quit`);
  console.log(`[Smoke Test] Verified backend PID ${backendPid} is cleanly terminated. No orphans!`);
});

