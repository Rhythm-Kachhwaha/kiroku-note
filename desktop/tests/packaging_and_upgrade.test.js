const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

test('Packaging: release/build-desktop.ps1 stages kiroku.exe and bundled resources', () => {
  const buildScriptPath = path.join(repoRoot, 'release', 'build-desktop.ps1');
  assert.equal(fs.existsSync(buildScriptPath), true);

  const script = fs.readFileSync(buildScriptPath, 'utf8');
  assert.match(script, /kiroku\.exe/);
  assert.match(script, /Rename-Item.*kiroku\.exe/i);
  assert.match(script, /resources[\\\/]app/);
  assert.match(script, /resources[\\\/]backend/);
});

test('Packaging: Inno Setup script configures kiroku.exe and preserves user data', () => {
  const issPath = path.join(repoRoot, 'installer', 'kiroku_setup.iss');
  assert.equal(fs.existsSync(issPath), true);

  const iss = fs.readFileSync(issPath, 'utf8');

  // Verify executable name is kiroku.exe
  assert.match(iss, /#define\s+MyAppExeName\s+"kiroku\.exe"/);

  // Verify installation targets localappdata Programs directory
  assert.match(iss, /DefaultDirName=\{localappdata\}\\Programs\\\{#MyAppName\}/);

  // Verify user data directories reside in %LOCALAPPDATA%\KirokuNote
  assert.match(iss, /Name:\s*"\{localappdata\}\\KirokuNote\\study"/);
  assert.match(iss, /Name:\s*"\{localappdata\}\\KirokuNote\\study\\media"/);
  assert.match(iss, /Name:\s*"\{localappdata\}\\KirokuNote\\study\\backups"/);
  assert.match(iss, /Name:\s*"\{localappdata\}\\KirokuNote\\data"/);

  // Ensure NO user databases are bundled in the Files section
  const lines = iss.split('\n');
  let inFiles = false;
  for (const line of lines) {
    if (line.trim().startsWith('[Files]')) {
      inFiles = true;
      continue;
    }
    if (inFiles && line.trim().startsWith('[')) {
      inFiles = false;
    }
    if (inFiles) {
      if (line.trim().startsWith(';') || !line.trim()) continue;
      assert.doesNotMatch(line, /study\.db/i);
      assert.doesNotMatch(line, /kiroku\.db/i);
      assert.doesNotMatch(line, /ankiminer\.db/i);
    }
  }
});

test('Packaging: User data is preserved during application upgrades', () => {
  const issPath = path.join(repoRoot, 'installer', 'kiroku_setup.iss');
  const iss = fs.readFileSync(issPath, 'utf8');

  // UninstallDelete and InstallDelete must NEVER touch {localappdata}\KirokuNote
  const forbiddenPatterns = [
    /Name:\s*"\{localappdata\}\\KirokuNote"/i,
    /Name:\s*"\{localappdata\}\\KirokuNote\\.*"/i
  ];

  const lines = iss.split('\n');
  let inDeleteSection = false;
  for (const line of lines) {
    if (line.trim().startsWith('[InstallDelete]') || line.trim().startsWith('[UninstallDelete]')) {
      inDeleteSection = true;
      continue;
    }
    if (inDeleteSection && line.trim().startsWith('[')) {
      inDeleteSection = false;
    }
    if (inDeleteSection) {
      for (const pattern of forbiddenPatterns) {
        assert.doesNotMatch(line, pattern);
      }
    }
  }
});
