/**
 * Kiroku Note - Electron Main Process Entrypoint
 * Windows Desktop Shell with Subprocess Lifecycle Supervision, System Tray,
 * Authenticated Study HTTP API Bridge, and Secure IPC Communication.
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeTheme, nativeImage, shell, Notification, dialog, globalShortcut, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { ProcessManager } = require('./process_manager');
const { DesktopStore } = require('./store');
const { StudyApiClient } = require('./study_api_client');
const { createLogger } = require('./logger');
const { HotkeyManager } = require('./hotkeys');
const { forwardApiRequest } = require('./api_proxy');

// Enforce single-instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Global state
let mainWindow = null;
let tray = null;
let isQuitting = false;
let statusPollingInterval = null;
let uiReloadTimer = null;
let lastMenuState = null;
let hotkeyManager = null;
let trayServicesStatus = {
  backendRunning: false,
  yomitanConnected: false,
  ankiConnected: false,
  ocrInstalled: false,
  ocrAvailable: false
};
let backendStartupPromise = null;

const repoRoot = path.resolve(__dirname, '..', '..');
const processManager = new ProcessManager({
  repoRoot,
  isPackaged: app.isPackaged
});
const desktopStore = new DesktopStore();

// Main-process authenticated Study API client (Holds ephemeral bearer token in memory)
const studyApiClient = new StudyApiClient({
  host: processManager.host,
  port: processManager.port,
  getToken: () => processManager.getApiToken()
});

// Guarded main-process logger. Writes to %LOCALAPPDATA%/KirokuNote/logs/desktop.log
// and tolerates closed stdout/stderr pipes so a recurring timer log cannot
// crash the main process (see desktop/tests/electron_epipe.test.js).
const log = createLogger();

async function desktopControlRequest(pathname, body = {}) {
  const response = await fetch(`http://${processManager.host || '127.0.0.1'}:${processManager.port || 21828}${pathname}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${processManager.getApiToken()}`
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
  return data;
}

// GPU acceleration configuration: enable hardware rasterization for high frame rates
// and responsive UI interaction, with stability flags to prevent crashes.
// Users can toggle hardware_acceleration off in Settings when encountering DRM capture issues.
const isHardwareAccelerationEnabled = desktopStore.getConfig('hardware_acceleration', true);
if (process.env.KIROKU_DISABLE_GPU === '1' || isHardwareAccelerationEnabled === false) {
  app.disableHardwareAcceleration();
} else {
  app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
}

// Disable Chromium's Encrypted ClientHello (ECH) to prevent net_error -183 (ERR_ECH_NOT_NEGOTIATED)
// when connecting to Cloudflare Edge / Workers through ISPs or resolvers with mismatched ECH configs.
app.commandLine.appendSwitch('disable-features', 'EncryptedClientHello');

// Persistent HTTP keep-alive agent to eliminate TCP handshake latency on every IPC API call
const apiHttpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 15000,
  maxSockets: 20,
  maxFreeSockets: 10
});

// Set native theme to dark by default
nativeTheme.themeSource = 'dark';
Menu.setApplicationMenu(null);

function resolveIconPath() {
  const candidates = [
    path.join(repoRoot, 'assets', 'icon.ico'),
    path.join(repoRoot, 'assets', 'icon.png'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app', 'assets', 'icon.ico') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app', 'assets', 'icon.png') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'assets', 'icon.ico') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'assets', 'icon.png') : null,
    path.join(__dirname, '..', 'assets', 'icon.ico'),
    path.join(__dirname, '..', 'assets', 'icon.png'),
    path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    path.join(__dirname, '..', '..', 'assets', 'icon.png')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function openExtensionInstructions() {
  const candidates = [
    path.join(repoRoot, 'installer', 'extension_instructions.txt'),
    path.join(repoRoot, 'extension_instructions.txt'),
    process.resourcesPath ? path.join(process.resourcesPath, 'extension_instructions.txt') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app', 'installer', 'extension_instructions.txt') : null,
    path.join(path.dirname(process.execPath), 'extension_instructions.txt')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      shell.openPath(candidate);
      return;
    }
  }
  openUserDataFolder();
}

function openUserDataFolder() {
  const appDataDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'KirokuNote')
    : path.join(app.getPath('appData'), 'KirokuNote');
  try {
    fs.mkdirSync(appDataDir, { recursive: true });
  } catch (_) {}
  shell.openPath(appDataDir);
}

function fetchServiceJson(reqPath) {
  return new Promise((resolve) => {
    const req = http.get({
      hostname: processManager.host,
      port: processManager.port,
      path: reqPath,
      timeout: 1000,
      agent: apiHttpAgent
    }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (_) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function refreshServicesStatus(forceUpdate = false) {
  if (!tray) return;

  const backendHealthy = await fetchServiceJson('/api/health');
  const yomitanData = await fetchServiceJson('/api/yomitan/dictionaries');
  const ankiData = await fetchServiceJson('/api/anki/status');
  const ocrData = await fetchServiceJson('/api/ocr/status');

  const newStatus = {
    backendRunning: Boolean(backendHealthy && processManager.status === 'running'),
    yomitanConnected: Boolean(yomitanData && (yomitanData.available_dictionaries?.length > 0 || yomitanData.enabled)),
    ankiConnected: Boolean(ankiData && ankiData.connected),
    ocrInstalled: Boolean(ocrData && ocrData.installed),
    ocrAvailable: Boolean(ocrData && ocrData.available)
  };

  const loginSettings = app.getLoginItemSettings();
  const currentStateKey = JSON.stringify([
    newStatus,
    processManager.status,
    loginSettings.openAtLogin
  ]);

  if (currentStateKey !== lastMenuState || forceUpdate) {
    lastMenuState = currentStateKey;
    trayServicesStatus = newStatus;
    updateSystemTrayMenu();
  }
}

function updateSystemTrayMenu() {
  if (!tray) return;

  const port = processManager.port;
  let headerLabel = 'Kiroku Note: Stopped';
  if (processManager.status === 'running') {
    headerLabel = `Kiroku Note: Running (Port ${port})`;
  } else if (processManager.status === 'starting') {
    headerLabel = 'Kiroku Note: Starting...';
  }

  const yomitanText = trayServicesStatus.yomitanConnected ? 'Connected' : 'Not found';
  const ankiText = trayServicesStatus.ankiConnected ? 'Connected' : 'Not found';

  let ocrLabel = '  OCR Engine: Not installed';
  if (trayServicesStatus.ocrInstalled) {
    ocrLabel = trayServicesStatus.ocrAvailable
      ? '  OCR Engine: Ready (Active)'
      : '  OCR Engine: Off (Stopped)';
  }

  const ocrActionLabel = trayServicesStatus.ocrAvailable ? 'Stop OCR Engine' : 'Start OCR Engine';

  const menuTemplate = [
    { label: headerLabel, enabled: false },
    { type: 'separator' },
    { label: 'Service Status:', enabled: false },
    { label: `  Yomitan: ${yomitanText}`, enabled: false },
    { label: `  AnkiConnect: ${ankiText}`, enabled: false },
    { label: ocrLabel, enabled: false }
  ];

  if (trayServicesStatus.ocrInstalled) {
    menuTemplate.push({
      label: ocrActionLabel,
      click: async () => {
        const action = trayServicesStatus.ocrAvailable ? 'stop' : 'start';
        try {
          const postData = JSON.stringify({});
          const req = http.request({
            hostname: processManager.host,
            port: processManager.port,
            path: `/api/ocr/${action}`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 5000
          }, () => {
            refreshServicesStatus(true);
          });
          req.on('error', () => {});
          req.write(postData);
          req.end();
        } catch (_) {}
      }
    });
  }

  menuTemplate.push(
    { type: 'separator' },
    {
      label: 'Open Kiroku',
      click: () => showMainWindow()
    },
    {
      label: 'Quick Add',
      click: () => {
        showMainWindow();
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.executeJavaScript(`
            (function() {
              if (window.router && typeof window.router.navigateToTab === 'function') {
                window.router.navigateToTab('vocab');
                setTimeout(() => {
                  const input = document.querySelector('#vocab-search-input') || document.querySelector('#input-expression');
                  if (input) input.focus();
                }, 100);
                return;
              }
              const qTab = document.querySelector('#tab-btn-quickadd');
              if (qTab) qTab.click();
              const input = document.querySelector('#quickadd-input');
              if (input) input.focus();
            })();
          `).catch(() => {});
        }
      }
    },
    {
      label: 'Extension Setup Guide',
      click: () => openExtensionInstructions()
    },
    {
      label: 'Open User Data Folder',
      click: () => openUserDataFolder()
    },
    {
      label: 'Backend Status (Browser)',
      click: () => {
        shell.openExternal(`http://${processManager.host}:${processManager.port}/api/cards?limit=1`);
      }
    },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked,
          path: process.execPath,
          args: ['--startup']
        });
        updateSystemTrayMenu();
      }
    },
    {
      label: 'Restart Backend',
      click: async () => {
        try {
          await processManager.stopBackend();
          await startBackendAndLoadUI();
          await refreshServicesStatus(true);
        } catch (err) {
          console.error('[Main] Failed to restart backend:', err.message);
        }
      }
    },
    {
      label: 'Quit Kiroku',
      click: () => quitApplication()
    }
  );

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
}

function createMainWindow() {
  const iconPath = resolveIconPath();

  mainWindow = new BrowserWindow({
    width: 500,
    height: 750,
    useContentSize: true,
    minWidth: 380,
    minHeight: 500,
    resizable: true,
    backgroundColor: '#0c0b0a',
    title: 'Kiroku Note',
    icon: iconPath,
    show: false, // will show when ready
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  mainWindow.setContentSize(500, 750);

  // Security: Handle external URLs via default browser, permit local app navigation
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const isAppIndex = navigationUrl.startsWith('file:') && (navigationUrl.includes('index.html') || navigationUrl.includes('login.html'));
    const isBackendHost = navigationUrl.startsWith(`http://${processManager.host}:`);
    if (!isAppIndex && !isBackendHost) {
      event.preventDefault();
      if (navigationUrl.startsWith('https:') || navigationUrl.startsWith('http:')) {
        shell.openExternal(navigationUrl);
      }
    }
  });

  mainWindow.on('enter-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen-change', true);
    }
  });
  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen-change', false);
    }
  });

  // Minimize to tray on close
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Show window immediately with target view (index.html boots background app with splash)
  const isSidepanelView = process.env.KIROKU_DESKTOP_VIEW === 'sidepanel';
  const isDiagnosticsShell = process.env.KIROKU_DESKTOP_VIEW === 'shell';
  const targetFile = isSidepanelView
    ? path.join(repoRoot, 'extension', 'sidepanel', 'sidepanel.html')
    : isDiagnosticsShell
    ? path.join(__dirname, 'shell.html')
    : path.join(__dirname, 'index.html');

  let hasShown = false;
  const showWindow = () => {
    if (!hasShown && mainWindow && !mainWindow.isDestroyed()) {
      hasShown = true;
      mainWindow.show();
    }
  };
  mainWindow.once('ready-to-show', showWindow);
  setTimeout(showWindow, 450);

  mainWindow.loadFile(targetFile);
}

function createSystemTray() {
  const iconPath = resolveIconPath();
  const trayIcon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

  try {
    tray = new Tray(trayIcon);
    tray.setToolTip('Kiroku Note');
    updateSystemTrayMenu();

    tray.on('click', () => {
      if (!mainWindow) {
        createMainWindow();
        startBackendAndLoadUI();
        return;
      }
      if (mainWindow.isVisible()) {
        if (mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.focus();
        }
      } else {
        showMainWindow();
      }
    });

    tray.on('double-click', () => {
      showMainWindow();
    });

    const isTestMode = process.env.KIROKU_DESKTOP_TEST_SMOKE === '1' || process.env.KIROKU_DESKTOP_TEST_LIFECYCLE === '1';
    const isStartup = process.argv.includes('--startup');
    if (!isTestMode && !isStartup && process.platform === 'win32') {
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: 'Kiroku Note',
            body: 'Kiroku Note is active in your background and ready.',
            icon: iconPath || undefined
          }).show();
        }
      } catch (_) {}
    }

    if (!statusPollingInterval) {
      statusPollingInterval = setInterval(() => {
        refreshServicesStatus();
      }, 3000);
    }
  } catch (err) {
    console.warn('[Main] System tray initialization warning:', err.message);
  }
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    startBackendAndLoadUI();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

async function ensureBackendReady(timeoutMs = 25000, options = {}) {
  if (isQuitting) return false;

  if (backendStartupPromise) {
    return backendStartupPromise;
  }

  if (processManager.status === 'running' && !options.forceCheck) {
    return true;
  }

  if (options.forceCheck && processManager.status === 'running') {
    const healthy = await processManager.isBackendHealthy(800);
    if (healthy) return true;
  }

  backendStartupPromise = (async () => {
    await processManager.startBackend();
    await processManager.waitForBackend(timeoutMs, 400);
    return true;
  })();

  try {
    return await backendStartupPromise;
  } finally {
    backendStartupPromise = null;
  }
}

async function startBackendAndLoadUI() {
  try {
    const isSidepanelView = process.env.KIROKU_DESKTOP_VIEW === 'sidepanel';
    const isDiagnosticsShell = process.env.KIROKU_DESKTOP_VIEW === 'shell';
    const targetFile = isSidepanelView
      ? path.join(repoRoot, 'extension', 'sidepanel', 'sidepanel.html')
      : isDiagnosticsShell
      ? path.join(__dirname, 'shell.html')
      : path.join(__dirname, 'index.html');

    if (mainWindow && isSidepanelView) {
      mainWindow.loadFile(path.join(__dirname, 'loading.html'));
    }

    await ensureBackendReady(25000);

    // Refresh system tray status indicators with live backend responses
    refreshServicesStatus(true).catch(() => {});

    // Backend and authenticated Study API are verified ready.
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (isSidepanelView || isDiagnosticsShell) {
        mainWindow.loadFile(targetFile);
      } else {
        mainWindow.webContents.send('backend:ready', {
          host: processManager.host,
          port: processManager.port
        });
      }

      // Auto-reload UI in dev mode when renderer assets change
      if (!app.isPackaged && !global.__uiWatcherInitialized) {
        global.__uiWatcherInitialized = true;
        const watcherStartTime = Date.now();
        const watchDirs = [
          path.join(__dirname, 'ui'),
          path.join(__dirname, 'index.html'),
          path.join(__dirname, 'shell.html')
        ];
        const triggerReload = (filename) => {
          if (Date.now() - watcherStartTime < 2500) return;
          if (uiReloadTimer) clearTimeout(uiReloadTimer);
          uiReloadTimer = setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              log.log(`[DevReloader] Reloading UI on file change: ${filename || ''}`);
              mainWindow.webContents.reloadIgnoringCache();
            }
          }, 150);
        };

        const isDevSourceCode = (file) => {
          if (!file) return false;
          if (file.includes('.git') || file.includes('node_modules')) return false;
          return /\.(js|css|html|json)$/i.test(file);
        };

        watchDirs.forEach(dirPath => {
          if (fs.existsSync(dirPath)) {
            try {
              const isDir = fs.statSync(dirPath).isDirectory();
              fs.watch(dirPath, isDir ? { recursive: true } : {}, (eventType, filename) => {
                if (Date.now() - watcherStartTime < 2500) return;
                const checkedName = filename || (isDir ? '' : path.basename(dirPath));
                if (isDevSourceCode(checkedName)) {
                  triggerReload(checkedName);
                }
              });
            } catch (err) {
              log.warn('[DevReloader] Watch error: ' + err.message);
            }
          }
        });
      }
    }
  } catch (err) {
    console.error('[Main] Failed to start backend:', err.message);
    if (mainWindow) {
      mainWindow.loadFile(path.join(__dirname, 'error.html'));
    }
    throw err;
  }
}

async function quitApplication() {
  isQuitting = true;
  stopStatusPolling();
  try {
    await processManager.stopBackend();
  } catch (err) {
    console.warn('[Main] Error stopping backend:', err.message);
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

/** Stop recurring timers so no main-process callback runs during/after shutdown. */
function stopStatusPolling() {
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
    statusPollingInterval = null;
  }
  if (uiReloadTimer) {
    clearTimeout(uiReloadTimer);
    uiReloadTimer = null;
  }
}

// Second instance detection - focus existing window
app.on('second-instance', () => {
  showMainWindow();
});

// App lifecycle
app.whenReady().then(() => {
  setupIpcHandlers();
  createSystemTray();
  createMainWindow();
  try {
    hotkeyManager = new HotkeyManager({ globalShortcut, getMainWindow: () => mainWindow, store: desktopStore, ipcMain });
    hotkeyManager.register();
  } catch (_) {}

  if (process.env.KIROKU_DESKTOP_TEST_SMOKE === '1') {
    const smokeLog = process.env.KIROKU_SMOKE_LOG || path.join(repoRoot, 'desktop', 'tests', 'smoke_result.json');
    (async () => {
      try {
        await startBackendAndLoadUI();
        const health = await studyApiClient.checkHealth();
        const bank = await studyApiClient.getBankSummary();
        const pid = processManager.childProcess ? processManager.childProcess.pid : null;
        fs.writeFileSync(smokeLog, JSON.stringify({
          success: true,
          pid,
          backendStatus: processManager.status,
          backendExternal: processManager.isExternal,
          hasApiToken: Boolean(processManager.getApiToken()),
          health,
          bank,
          isPackaged: app.isPackaged
        }, null, 2));
      } catch (err) {
        fs.writeFileSync(smokeLog, JSON.stringify({
          success: false,
          error: err.message
        }, null, 2));
      } finally {
        setTimeout(() => quitApplication(), 800);
      }
    })();
    return;
  }

  if (process.env.KIROKU_DESKTOP_TEST_LIFECYCLE === '1') {
    const testLog = path.join(repoRoot, 'desktop', 'tests', 'lifecycle_result.json');
    setTimeout(() => {
      try {
        fs.writeFileSync(testLog, JSON.stringify({
          success: true,
          windowCreated: Boolean(mainWindow),
          trayCreated: Boolean(tray),
          width: mainWindow ? mainWindow.getSize()[0] : null,
          height: mainWindow ? mainWindow.getSize()[1] : null,
          contentWidth: mainWindow ? mainWindow.getContentSize()[0] : null,
          contentHeight: mainWindow ? mainWindow.getContentSize()[1] : null,
          isResizable: mainWindow ? mainWindow.isResizable() : null,
          backendStatus: processManager.status,
          backendExternal: processManager.isExternal,
          hasApiToken: Boolean(processManager.getApiToken())
        }, null, 2));
      } catch (_) {}
      quitApplication();
    }, 1200);
    return;
  }

  startBackendAndLoadUI();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      startBackendAndLoadUI();
    } else {
      showMainWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (hotkeyManager) {
    try { hotkeyManager.unregister(); } catch (_) {}
  }
  stopStatusPolling();
  try {
    processManager.stopBackend();
  } catch (_) {}
});

app.on('window-all-closed', () => {
  // On Windows with system tray, closing all windows hides to tray rather than exiting
  // Explicit exit only happens via Tray -> Quit or app.quit()
});

function setupIpcHandlers() {
  ipcMain.handle('runtime:get-rive-asset-url', (_event, assetName) => {
    if (typeof assetName !== 'string' || !/^[a-z0-9][a-z0-9._-]*\.riv$/i.test(assetName)) {
      throw new Error('Invalid Rive asset name');
    }

    const possibleRoots = [
      app.isPackaged ? path.join(process.resourcesPath, 'app', 'assets', 'dekstop', 'riv') : path.join(repoRoot, 'assets', 'dekstop', 'riv'),
      app.isPackaged ? path.join(process.resourcesPath, 'app', 'desktop', 'src', 'ui', 'assets', 'riv') : path.join(repoRoot, 'desktop', 'src', 'ui', 'assets', 'riv')
    ];

    let assetPath = null;
    for (const root of possibleRoots) {
      const candidate = path.join(root, assetName);
      if (fs.existsSync(candidate)) {
        assetPath = candidate;
        break;
      }
    }

    if (!assetPath) {
      throw new Error('Rive asset is unavailable');
    }
    return pathToFileURL(assetPath).href;
  });

  ipcMain.handle('runtime:get-rive-asset-buffer', (_event, assetName) => {
    if (typeof assetName !== 'string' || !/^[a-z0-9][a-z0-9._-]*\.riv$/i.test(assetName)) {
      throw new Error('Invalid Rive asset name');
    }

    const possibleRoots = [
      app.isPackaged ? path.join(process.resourcesPath, 'app', 'assets', 'dekstop', 'riv') : path.join(repoRoot, 'assets', 'dekstop', 'riv'),
      app.isPackaged ? path.join(process.resourcesPath, 'app', 'desktop', 'src', 'ui', 'assets', 'riv') : path.join(repoRoot, 'desktop', 'src', 'ui', 'assets', 'riv')
    ];

    let assetPath = null;
    for (const root of possibleRoots) {
      const candidate = path.join(root, assetName);
      if (fs.existsSync(candidate)) {
        assetPath = candidate;
        break;
      }
    }

    if (!assetPath) {
      throw new Error('Rive asset is unavailable');
    }
    const buf = fs.readFileSync(assetPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  // Window controls
  ipcMain.handle('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.handle('window:toggle-maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  });

  ipcMain.handle('window:set-fullscreen', (_event, flag) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const target = typeof flag === 'boolean' ? flag : !mainWindow.isFullScreen();
      mainWindow.setFullScreen(target);
      return mainWindow.isFullScreen();
    }
    return false;
  });

  ipcMain.handle('window:is-fullscreen', () => {
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFullScreen() : false;
  });

  ipcMain.handle('app:quit', async () => {
    await quitApplication();
  });

  // Backend state & retry
  ipcMain.handle('backend:info', () => ({
    status: processManager.status,
    external: processManager.isExternal,
    port: processManager.port,
    hasToken: Boolean(processManager.getApiToken())
  }));

  ipcMain.handle('backend:retry', async () => {
    await startBackendAndLoadUI();
    return true;
  });

  // General FastAPI Backend IPC Proxy (eliminates direct browser fetch & CORS restrictions under file://)
  ipcMain.handle('kiroku:api:request', async (event, req = {}) => {
    return forwardApiRequest({
      req,
      host: processManager.host || '127.0.0.1',
      port: processManager.port || 21828,
      getToken: () => processManager.getApiToken(),
      agent: apiHttpAgent,
      ensureBackendReady: async (waitTimeoutMs, opts) => {
        try {
          return await ensureBackendReady(waitTimeoutMs, opts);
        } catch (err) {
          log.warn('[IPC Proxy] Backend readiness wait failed:', err.message);
          return false;
        }
      },
      isQuitting: () => isQuitting
    });
  });

  // Secure Study API bridge handler
  ipcMain.handle('study:request', async (event, req = {}) => {
    try {
      if (!req || typeof req !== 'object') {
        throw new Error('Invalid request payload');
      }

      const { method = 'GET', path: reqPath, query, body, headers, timeoutMs, clientRequestId, range } = req;

      // Strict IPC validation: Only permit /api/study/v1, /api/journey, /api/link, or /api/health
      if (typeof reqPath !== 'string' || (!reqPath.startsWith('/api/study/v1') && !reqPath.startsWith('/api/journey') && !reqPath.startsWith('/api/link') && reqPath !== '/api/health')) {
        throw new Error(`Unauthorized or invalid Study API path: ${reqPath}`);
      }

      // Traversal and arbitrary URL injection prevention
      if (reqPath.includes('..') || reqPath.includes('://')) {
        throw new Error('Path traversal or arbitrary URL not allowed');
      }

      // Method validation
      const allowedMethods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
      const upperMethod = String(method).toUpperCase();
      if (!allowedMethods.includes(upperMethod)) {
        throw new Error(`Method ${method} is not permitted`);
      }

      try {
        await ensureBackendReady(timeoutMs || 25000);
      } catch (_) {}

      const result = await studyApiClient.request({
        method: upperMethod,
        path: reqPath,
        query,
        body,
        headers,
        timeoutMs,
        clientRequestId,
        range
      });

      let serializedData = result.data;
      let isBuffer = false;
      if (Buffer.isBuffer(result.data)) {
        serializedData = result.data.toString('base64');
        isBuffer = true;
      }

      return {
        success: true,
        status: result.status,
        headers: result.headers,
        data: serializedData,
        isBuffer
      };
    } catch (err) {
      return {
        success: false,
        error: {
          code: err.code || 'REQUEST_FAILED',
          message: err.message,
          statusCode: err.statusCode || 500,
          details: err.details || {}
        }
      };
    }
  });

  // Desktop storage shim for chrome.storage.local
  ipcMain.handle('chrome:storage:get', (event, keys) => {
    return desktopStore.get(keys);
  });

  ipcMain.handle('chrome:storage:set', (event, items) => {
    desktopStore.set(items);
    return true;
  });

  ipcMain.handle('chrome:storage:remove', (event, keys) => {
    desktopStore.remove(keys);
    return true;
  });

  ipcMain.handle('chrome:storage:clear', () => {
    desktopStore.clear();
    return true;
  });

  // Extension runtime messaging stub
  ipcMain.handle('chrome:runtime:sendMessage', (event, msg) => {
    return { received: true };
  });

  // Settings and application lifecycle restart
  ipcMain.handle('settings:restart-app', () => {
    app.relaunch();
    app.exit(0);
    return true;
  });

  ipcMain.handle('app:restart', () => {
    app.relaunch();
    app.exit(0);
    return true;
  });

  // Tray and Desktop Shell feature integrations
  ipcMain.handle('app:open-folder', () => {
    openUserDataFolder();
    return true;
  });

  ipcMain.handle('app:open-instructions', () => {
    openExtensionInstructions();
    return true;
  });

  ipcMain.handle('backend:services-status', () => {
    return {
      backend: trayServicesStatus.backendRunning,
      yomitan: trayServicesStatus.yomitanConnected,
      anki: trayServicesStatus.ankiConnected,
      ocr: trayServicesStatus.ocrAvailable,
      ...trayServicesStatus
    };
  });

  ipcMain.handle('ocr:toggle', async () => {
    const action = trayServicesStatus.ocrAvailable ? 'stop' : 'start';
    await new Promise((resolve) => {
      const postData = JSON.stringify({});
      const req = http.request({
        hostname: processManager.host,
        port: processManager.port,
        path: `/api/ocr/${action}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 5000
      }, () => resolve());
      req.on('error', () => resolve());
      req.write(postData);
      req.end();
    });
    await refreshServicesStatus(true);
    return trayServicesStatus;
  });

  // --- Theater Tier 2 IPC Handlers (Slice 43) ---
  const { TheaterViewController } = require('./theater_view.js');
  const theaterController = new TheaterViewController({
    get mainWindow() {
      return (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
    },
    onDrmDetected: (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('theater:drm-alert', info);
      }
    },
    onAskHostApproval: async (_hostname) => {
      return true;
    }
  });

  ipcMain.handle('theater:open-url', async (_event, url, bounds) => {
    return await theaterController.openUrl(url, bounds);
  });

  ipcMain.handle('theater:close', async () => {
    theaterController.close();
    return { ok: true };
  });

  ipcMain.handle('theater:command', async (_event, cmd, payload) => {
    return theaterController.sendCommand(cmd, payload);
  });

  ipcMain.handle('theater:status', () => {
    return theaterController.getStatus();
  });

  ipcMain.handle('theater:open-command', async (_event, payload = {}) => {
    const url = payload.url;
    if (url) {
      return await theaterController.openUrl(url);
    }
    return { ok: false, error: 'No URL provided' };
  });

  ipcMain.on('theater:drm-detected', (_event, info) => {
    theaterController.handleDrmDetection(info);
  });

  ipcMain.on('theater:bridge:event', (_event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('theater:bridge:event', data);
    }
  });

  // --- Desktop Shell Auth & Loopback OAuth Server ---
  let activeAuthServer = null;
  let ephemeralSessionToken = null;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function encryptToken(token) {
    if (token && safeStorage && safeStorage.isEncryptionAvailable()) {
      try {
        return 'enc:' + safeStorage.encryptString(token).toString('base64');
      } catch (_) {}
    }
    // Finding S7: If safeStorage encryption is unavailable or fails, fail-closed for disk persistence.
    // Keep in memory (ephemeral) only, never write raw plaintext credentials to disk.
    ephemeralSessionToken = token;
    return null;
  }

  function decryptToken(storedToken) {
    if (storedToken && storedToken.startsWith('enc:') && safeStorage && safeStorage.isEncryptionAvailable()) {
      try {
        const buf = Buffer.from(storedToken.slice(4), 'base64');
        return safeStorage.decryptString(buf);
      } catch (_) {}
    }
    if (ephemeralSessionToken) return ephemeralSessionToken;
    return storedToken && storedToken.startsWith('enc:') ? null : storedToken;
  }

  ipcMain.handle('auth:get-session', () => {
    const raw = desktopStore.get('kiroku_auth_session');
    const session = raw?.kiroku_auth_session;
    if (session) {
      return {
        ...session,
        token: decryptToken(session.token)
      };
    }
    return null;
  });

  ipcMain.handle('auth:clear-session', () => {
    ephemeralSessionToken = null;
    desktopStore.remove('kiroku_auth_session');
    return { ok: true };
  });

  ipcMain.handle('auth:save-session', (_event, session) => {
    if (session && session.user) {
      // Preserve existing token if caller only passed user metadata
      const existing = desktopStore.get('kiroku_auth_session')?.kiroku_auth_session;
      const token = session.token || existing?.token || null;
      const sessionToSave = {
        ...session,
        token: token ? encryptToken(decryptToken(token)) : null
      };
      desktopStore.set({ kiroku_auth_session: sessionToSave });
      return { ok: true };
    }
    return { ok: false, error: 'Invalid session payload' };
  });

  ipcMain.handle('auth:verify-token', async (_event, token) => {
    if (!token) return { authenticated: false };
    const workerHost = process.env.WORKER_URL || 'https://kiroku-note.rhythmkach.workers.dev';
    try {
      const resp = await fetch(`${workerHost}/auth/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        signal: AbortSignal.timeout(5000)
      });
      if (resp.ok) {
        const data = await resp.json();
        return data;
      }
      return { authenticated: false, status: resp.status };
    } catch (_) {
      // In offline mode, verify against locally cached session
      const raw = desktopStore.get('kiroku_auth_session');
      const session = raw?.kiroku_auth_session;
      if (session && session.token) {
        const cachedToken = decryptToken(session.token);
        if (cachedToken && cachedToken === token) {
          return { authenticated: true, offline: true, user: session.user };
        }
      }
      return { authenticated: false, offline: true };
    }
  });

  let lastOAuthTriggerTime = 0;
  ipcMain.handle('auth:start-oauth', async (_event, provider = 'google') => {
    const now = Date.now();
    if (now - lastOAuthTriggerTime < 2500) {
      console.debug('[OAuth] Duplicate OAuth trigger ignored within 2.5s');
      return { ok: false, error: 'OAuth request already in progress' };
    }
    lastOAuthTriggerTime = now;

    if (activeAuthServer) {
      try { activeAuthServer.close(); } catch (_) {}
      activeAuthServer = null;
    }

    const expectedState = crypto.randomBytes(24).toString('hex');
    const workerHost = process.env.WORKER_URL || 'https://kiroku-note.rhythmkach.workers.dev';

    return new Promise((resolve) => {
      let isResolved = false;
      const safeResolve = (val) => {
        if (!isResolved) {
          isResolved = true;
          resolve(val);
        }
      };

      const server = http.createServer((req, res) => {
        try {
          const reqUrl = new URL(req.url, `http://127.0.0.1:${server.address()?.port || 21829}`);
          if (reqUrl.pathname === '/auth/callback') {
            const handleAuthPayload = async (payload) => {
              const state = payload.state;
              if (!state || state !== expectedState) {
                res.writeHead(403, {
                  'Content-Type': 'text/plain; charset=utf-8',
                  'Cache-Control': 'no-store, no-cache, must-revalidate',
                  'Referrer-Policy': 'no-referrer'
                });
                res.end('Forbidden: Invalid or missing OAuth state parameter (CSRF protection)');
                safeResolve({ ok: false, error: 'CSRF state mismatch' });
                return;
              }

              const errorParam = payload.error || payload.error_description;
              if (errorParam) {
                res.writeHead(200, {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Cache-Control': 'no-store, no-cache, must-revalidate',
                  'Referrer-Policy': 'no-referrer'
                });
                res.end(`
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <title>Kiroku Note - Authentication</title>
                    <style>
                      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #141311; color: #F5F1E8; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                      .card { background: #1C1B19; border: 1px solid rgba(245, 241, 232, 0.15); border-radius: 8px; padding: 32px; max-width: 440px; text-align: center; }
                      h2 { color: #D94B38; margin-top: 0; font-size: 20px; }
                      p { color: rgba(245, 241, 232, 0.7); line-height: 1.5; font-size: 14px; }
                    </style>
                  </head>
                  <body>
                    <div class="card">
                      <h2>Sign-in Incomplete</h2>
                      <p>${escapeHtml(errorParam)}</p>
                      <p style="color: rgba(245, 241, 232, 0.4); font-size: 12px;">You can close this tab and return to Kiroku Note.</p>
                    </div>
                  </body>
                  </html>
                `);
                safeResolve({ ok: false, error: errorParam });
                return;
              }

              let token = payload.token || payload.jwt;
              let sub = payload.sub || payload.user_id;
              let email = payload.email || '';
              let name = payload.name || '';

              if (!token && payload.code) {
                try {
                  const exchResp = await fetch(`${workerHost}/auth/exchange`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: payload.code, state: expectedState })
                  });
                  if (exchResp.ok) {
                    const exchData = await exchResp.json();
                    if (exchData.token) {
                      token = exchData.token;
                      if (exchData.user) {
                        sub = exchData.user.sub || exchData.user.id || sub;
                        email = exchData.user.email || email;
                        name = exchData.user.name || name;
                      }
                    }
                  }
                } catch (_) {}
              }

              if (token && sub) {
                const session = {
                  token,
                  user: {
                    id: sub,
                    sub,
                    name: name || 'Learner',
                    email,
                    authenticated: true,
                    provider
                  },
                  timestamp: Date.now()
                };

                const sessionToSave = {
                  ...session,
                  token: encryptToken(token)
                };

                desktopStore.set({ kiroku_auth_session: sessionToSave });
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('auth:success', session);
                }

                res.writeHead(200, {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Cache-Control': 'no-store, no-cache, must-revalidate',
                  'Referrer-Policy': 'no-referrer'
                });
                res.end(`
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <title>Kiroku Note - Signed In</title>
                    <style>
                      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0c0b0a; color: #edeae3; text-align: center; padding: 60px 20px; }
                      .card { background: #181715; border: 1px solid #332d27; border-radius: 12px; max-width: 420px; margin: 0 auto; padding: 32px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
                      h2 { color: #52c41a; margin-top: 0; }
                      p { color: #a8a29e; line-height: 1.5; }
                    </style>
                  </head>
                  <body>
                    <div class="card">
                      <h2>Signed in successfully!</h2>
                      <p>You are now connected to Kiroku Note Desktop. You can safely close this browser window and return to the app.</p>
                    </div>
                    <script>setTimeout(() => window.close(), 1500);</script>
                  </body>
                  </html>
                `);

                safeResolve({ ok: true, session });
              } else {
                res.writeHead(400, {
                  'Content-Type': 'text/plain; charset=utf-8',
                  'Cache-Control': 'no-store, no-cache, must-revalidate',
                  'Referrer-Policy': 'no-referrer'
                });
                res.end('Missing authentication token from server');
                safeResolve({ ok: false, error: 'Missing token in callback' });
              }

              setTimeout(() => {
                try { server.close(); } catch (_) {}
                if (activeAuthServer === server) activeAuthServer = null;
              }, 1000);
            };

            if (req.method === 'POST') {
              let bodyRaw = '';
              let exceeded = false;
              req.on('data', chunk => {
                bodyRaw += chunk;
                if (bodyRaw.length > 65536) {
                  exceeded = true;
                  req.destroy();
                  res.writeHead(413, { 'Content-Type': 'text/plain' });
                  res.end('Payload too large');
                }
              });
              req.on('end', () => {
                if (exceeded) return;
                let parsed = {};
                try {
                  parsed = JSON.parse(bodyRaw);
                } catch (_) {
                  try {
                    const usp = new URLSearchParams(bodyRaw);
                    parsed = Object.fromEntries(usp.entries());
                  } catch (_) {}
                }
                handleAuthPayload(parsed);
              });
            } else {
              handleAuthPayload({
                state: reqUrl.searchParams.get('state'),
                code: reqUrl.searchParams.get('code'),
                error: reqUrl.searchParams.get('error'),
                error_description: reqUrl.searchParams.get('error_description'),
                token: reqUrl.searchParams.get('token') || reqUrl.searchParams.get('jwt'),
                sub: reqUrl.searchParams.get('sub') || reqUrl.searchParams.get('user_id'),
                email: reqUrl.searchParams.get('email') || '',
                name: reqUrl.searchParams.get('name') || ''
              });
            }
          } else {
            res.writeHead(404);
            res.end();
          }
        } catch (err) {
          res.writeHead(500);
          res.end(err.message);
          safeResolve({ ok: false, error: err.message });
        }
      });

      server.once('error', (err) => {
        safeResolve({ ok: false, error: `Loopback server error: ${err.message}` });
      });

      // Bind directly to ephemeral port 0 (OS allocates free port, avoiding collisions with KirokuOCR on 21829)
      server.listen(0, '127.0.0.1', () => {
        activeAuthServer = server;
        const boundPort = server.address().port;
        const redirectUri = `http://127.0.0.1:${boundPort}/auth/callback`;
        const authUrl = `${workerHost}/auth/${encodeURIComponent(provider)}?redirect=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(expectedState)}`;
        shell.openExternal(authUrl);
      });

      // Auto-expire listener after 2 minutes
      setTimeout(() => {
        if (activeAuthServer === server) {
          try { server.close(); } catch (_) {}
          activeAuthServer = null;
          safeResolve({ ok: false, error: 'OAuth listener timed out' });
        }
      }, 120000);
    });
  });
}
