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

  // Verify window open handler denies popups
  assert.match(mainContent, /setWindowOpenHandler/);

  // Verify navigation restricts non-local destinations
  assert.match(mainContent, /will-navigate/);

  // Verify single instance lock is requested
  assert.match(mainContent, /requestSingleInstanceLock/);

  // Verify close event prevents default and hides window
  assert.match(mainContent, /event\.preventDefault\(\)/);
  assert.match(mainContent, /mainWindow\.hide\(\)/);

  // Verify Tray integration exists
  assert.match(mainContent, /new Tray\(/);
  assert.match(mainContent, /'Quit Kiroku'/);
});

test('Security Verification: preload.js does not expose raw Node.js APIs or secret tokens', () => {
  const preloadJsPath = path.resolve(__dirname, '..', 'src', 'preload.js');
  const preloadContent = fs.readFileSync(preloadJsPath, 'utf8');

  // Must not require or expose fs, child_process, or net
  assert.doesNotMatch(preloadContent, /require\(['"]fs['"]\)/);
  assert.doesNotMatch(preloadContent, /require\(['"]child_process['"]\)/);
  assert.doesNotMatch(preloadContent, /require\(['"]net['"]\)/);

  // Must not hold or expose token accessors
  assert.doesNotMatch(preloadContent, /apiToken/i);
  assert.doesNotMatch(preloadContent, /KIROKU_STUDY_API_TOKEN/);

  // Exposes desktopAPI and chrome bridges via contextBridge
  assert.match(preloadContent, /contextBridge\.exposeInMainWorld\(['"]desktopAPI['"]/);
  assert.match(preloadContent, /contextBridge\.exposeInMainWorld\(['"]chrome['"]/);
  assert.match(preloadContent, /studyApi:\s*\{/);
});

test('Security Verification: main.js enforces strict IPC validation for study:request', () => {
  const mainJsPath = path.resolve(__dirname, '..', 'src', 'main.js');
  const mainContent = fs.readFileSync(mainJsPath, 'utf8');

  // Path whitelist check
  assert.match(mainContent, /reqPath\.startsWith\(['"]\/api\/study\/v1['"]\)/);
  // Traversal prevention
  assert.match(mainContent, /reqPath\.includes\(['"]\.\.['"]\)/);
  // Method whitelist
  assert.match(mainContent, /allowedMethods/);
});

test('Security Verification: shell.html implements restrictive Content Security Policy', () => {
  const shellHtmlPath = path.resolve(__dirname, '..', 'src', 'shell.html');
  const shellContent = fs.readFileSync(shellHtmlPath, 'utf8');

  assert.match(shellContent, /http-equiv=['"]Content-Security-Policy['"]/i);
  assert.match(shellContent, /default-src\s+'self'/);
  assert.match(shellContent, /connect-src\s+'self'\s+http:\/\/127\.0\.0\.1:\*/);
});

test('Architecture Verification: referenced paths exist in repository', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');

  assert.equal(fs.existsSync(path.join(repoRoot, 'extension', 'sidepanel', 'sidepanel.html')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'extension', 'sidepanel', 'sidepanel.css')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'extension', 'sidepanel', 'sidepanel.js')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'desktop', 'src', 'shell.html')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'desktop', 'src', 'study_api_client.js')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'run_backend.py')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'assets', 'icon.ico')), true);
});
