const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Security Verification: main.js enforces Electron security boundaries', () => {
  const mainJsPath = path.resolve(__dirname, '..', 'src', 'main.js');
  const mainContent = fs.readFileSync(mainJsPath, 'utf8');

  // Verify contextIsolation is true
  assert.match(mainContent, /contextIsolation:\s*true/);

  // Verify nodeIntegration is false
  assert.match(mainContent, /nodeIntegration:\s*false/);

  // Verify webSecurity is true
  assert.match(mainContent, /webSecurity:\s*true/);

  // Verify single instance lock is requested
  assert.match(mainContent, /requestSingleInstanceLock/);

  // Verify close event prevents default and hides window
  assert.match(mainContent, /event\.preventDefault\(\)/);
  assert.match(mainContent, /mainWindow\.hide\(\)/);

  // Verify Tray integration exists
  assert.match(mainContent, /new Tray\(/);
  assert.match(mainContent, /'Quit Kiroku'/);
});

test('Security Verification: preload.js does not expose raw Node.js APIs to renderer', () => {
  const preloadJsPath = path.resolve(__dirname, '..', 'src', 'preload.js');
  const preloadContent = fs.readFileSync(preloadJsPath, 'utf8');

  // Must not require or expose fs, child_process, or net
  assert.doesNotMatch(preloadContent, /require\(['"]fs['"]\)/);
  assert.doesNotMatch(preloadContent, /require\(['"]child_process['"]\)/);
  assert.doesNotMatch(preloadContent, /require\(['"]net['"]\)/);

  // Exposes desktopAPI and chrome bridges via contextBridge
  assert.match(preloadContent, /contextBridge\.exposeInMainWorld\(['"]desktopAPI['"]/);
  assert.match(preloadContent, /contextBridge\.exposeInMainWorld\(['"]chrome['"]/);
});

test('Architecture Verification: referenced paths exist in repository', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  
  assert.equal(fs.existsSync(path.join(repoRoot, 'extension', 'sidepanel', 'sidepanel.html')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'extension', 'sidepanel', 'sidepanel.css')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'extension', 'sidepanel', 'sidepanel.js')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'run_backend.py')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'assets', 'icon.ico')), true);
});

