/**
 * Kiroku Note - System Tray & Legacy Feature Preservation Tests
 * -------------------------------------------------------------
 * Validates that all legacy tray features and behaviors from the older
 * Python/pystray implementation are fully preserved and owned by the Electron desktop shell:
 * 1. Tray creation, tooltip, and icon configuration.
 * 2. Window show/hide, toggle, and minimize-to-tray lifecycle on close.
 * 3. Complete legacy menu mapping:
 *    - Dynamic header status (Running with port, Starting, Stopped)
 *    - Service status indicators (Yomitan, AnkiConnect, OCR Engine)
 *    - OCR engine toggle action (Start/Stop)
 *    - Core navigation (Open Kiroku, Quick Add)
 *    - Helpers & Documentation (Extension Setup Guide, User Data Folder, Browser Status)
 *    - System lifecycle (Start with Windows, Restart Backend, Quit Kiroku)
 * 4. Single-instance protection and focus handover on second-instance.
 * 5. Secure IPC and preload boundaries for tray features.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const mainJsPath = path.join(repoRoot, 'desktop', 'src', 'main.js');
const preloadJsPath = path.join(repoRoot, 'desktop', 'src', 'preload.js');

test('System Tray: main.js preserves complete legacy tray structure and menu items', () => {
  assert.equal(fs.existsSync(mainJsPath), true, 'desktop/src/main.js must exist');
  const mainContent = fs.readFileSync(mainJsPath, 'utf8');

  // 1. Tooltip and tray icon setup
  assert.match(mainContent, /tray\.setToolTip\(['"]Kiroku Note['"]\)/, 'Tray must have tooltip "Kiroku Note"');
  assert.match(mainContent, /new Tray\(/, 'Tray instance must be created');

  // 2. Dynamic header status label (plain text, zero emojis/symbols)
  assert.match(mainContent, /Kiroku Note: Running \(Port /, 'Header must indicate running state and port');
  assert.match(mainContent, /Kiroku Note: Starting\.\.\./, 'Header must indicate starting state');
  assert.match(mainContent, /Kiroku Note: Stopped/, 'Header must indicate stopped state');

  // 3. Service status indicators
  assert.match(mainContent, /Service Status:/, 'Must contain "Service Status:" separator/label');
  assert.match(mainContent, /Yomitan:/, 'Must contain Yomitan status indicator');
  assert.match(mainContent, /AnkiConnect:/, 'Must contain AnkiConnect status indicator');
  assert.match(mainContent, /OCR Engine:/, 'Must contain OCR Engine status indicator');

  // 4. OCR Toggle action
  assert.match(mainContent, /ocrActionLabel/, 'Must compute dynamic OCR start/stop label');
  assert.match(mainContent, /'Stop OCR Engine'/, 'Must include Stop OCR action label');
  assert.match(mainContent, /'Start OCR Engine'/, 'Must include Start OCR action label');
  assert.match(mainContent, /\/api\/ocr\/\${action}/, 'Must invoke backend OCR start/stop endpoint');

  // 5. Core actions
  assert.match(mainContent, /'Open Kiroku'/, 'Must contain "Open Kiroku" action');
  assert.match(mainContent, /'Quick Add'/, 'Must contain "Quick Add" action');
  assert.match(mainContent, /'Extension Setup Guide'/, 'Must contain "Extension Setup Guide" action');
  assert.match(mainContent, /'Open User Data Folder'/, 'Must contain "Open User Data Folder" action');
  assert.match(mainContent, /'Backend Status \(Browser\)'/, 'Must contain "Backend Status (Browser)" action');

  // 6. System & Lifecycle actions
  assert.match(mainContent, /'Start with Windows'/, 'Must contain "Start with Windows" toggle');
  assert.match(mainContent, /type:\s*['"]checkbox['"]/, 'Start with Windows must be a checkbox');
  assert.match(mainContent, /setLoginItemSettings/, 'Must configure login item settings');
  assert.match(mainContent, /'Restart Backend'/, 'Must contain "Restart Backend" action');
  assert.match(mainContent, /'Quit Kiroku'/, 'Must contain "Quit Kiroku" action');
});

test('System Tray: Window lifecycle hides to tray and restores without exiting', () => {
  const mainContent = fs.readFileSync(mainJsPath, 'utf8');

  // Window close intercept
  assert.match(mainContent, /mainWindow\.on\(['"]close['"],\s*\(event\)\s*=>\s*\{/);
  assert.match(mainContent, /event\.preventDefault\(\)/);
  assert.match(mainContent, /mainWindow\.hide\(\)/);

  // Left click / double click restores or toggles window
  assert.match(mainContent, /tray\.on\(['"]click['"]/);
  assert.match(mainContent, /tray\.on\(['"]double-click['"]/);
  assert.match(mainContent, /showMainWindow\(\)/);
});

test('System Tray: Single-instance lock and background persistence verified', () => {
  const mainContent = fs.readFileSync(mainJsPath, 'utf8');

  // Single-instance lock
  assert.match(mainContent, /app\.requestSingleInstanceLock\(\)/, 'Single-instance lock must be requested');
  assert.match(mainContent, /app\.on\(['"]second-instance['"]/, 'Second instance must focus existing window');

  // Background polling without hover stutter
  assert.match(mainContent, /setInterval\(/, 'Must poll service status in background');
  assert.match(mainContent, /refreshServicesStatus/, 'Must refresh service status');
  assert.match(mainContent, /lastMenuState/, 'Must detect state changes to avoid unnecessary menu rebuilding');
});

test('System Tray: Secure IPC and preload bridge exposure', () => {
  const mainContent = fs.readFileSync(mainJsPath, 'utf8');
  const preloadContent = fs.readFileSync(preloadJsPath, 'utf8');

  // Main IPC handlers
  assert.match(mainContent, /ipcMain\.handle\(['"]app:open-folder['"]/);
  assert.match(mainContent, /ipcMain\.handle\(['"]app:open-instructions['"]/);
  assert.match(mainContent, /ipcMain\.handle\(['"]backend:services-status['"]/);
  assert.match(mainContent, /ipcMain\.handle\(['"]ocr:toggle['"]/);

  // Preload desktopAPI exposures
  assert.match(preloadContent, /openUserDataFolder:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]app:open-folder['"]\)/);
  assert.match(preloadContent, /openInstructions:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]app:open-instructions['"]\)/);
  assert.match(preloadContent, /getServicesStatus:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]backend:services-status['"]\)/);
  assert.match(preloadContent, /toggleOcr:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]ocr:toggle['"]\)/);

  // Top Chrome & Window controls integration
  const topChromePath = path.join(repoRoot, 'desktop', 'src', 'ui', 'shell', 'top_chrome.js');
  const topChromeContent = fs.readFileSync(topChromePath, 'utf8');

  assert.match(topChromeContent, /#btn-window-minimize|btn-window-minimize/, 'Top chrome must define minimize window button');
  assert.match(topChromeContent, /#btn-window-maximize|btn-window-maximize/, 'Top chrome must define maximize window button');
  assert.match(topChromeContent, /#btn-window-close|btn-window-close/, 'Top chrome must define close window button');
  assert.match(topChromeContent, /desktopAPI\?\.minimize/, 'Top chrome must consume desktopAPI.minimize');
  assert.match(topChromeContent, /desktopAPI\?\.toggleMaximize/, 'Top chrome must consume desktopAPI.toggleMaximize');
  assert.match(topChromeContent, /desktopAPI\?\.close/, 'Top chrome must consume desktopAPI.close');
  assert.match(topChromeContent, /desktopAPI\?\.getServicesStatus/, 'Top chrome must poll getServicesStatus');
  assert.match(topChromeContent, /pip-backend/, 'Top chrome must render backend telemetry pip');
  assert.match(topChromeContent, /pip-yomitan/, 'Top chrome must render yomitan telemetry pip');
  assert.match(topChromeContent, /pip-anki/, 'Top chrome must render anki telemetry pip');
  assert.match(topChromeContent, /pip-ocr/, 'Top chrome must render ocr telemetry pip');
  assert.match(topChromeContent, /top-chrome-section-indicator/, 'Top chrome must render section indicator');
});


