/**
 * Kiroku Note - Electron Main Process Entrypoint
 * Windows Desktop Shell with Subprocess Lifecycle Supervision, System Tray,
 * Authenticated Study HTTP API Bridge, and Secure IPC Communication.
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeTheme, nativeImage, shell, Notification, dialog, globalShortcut } = require('electron');
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
    backgroundColor: '#121110',
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

  // Security: Deny window.open and restrict navigation to local origins
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!navigationUrl.startsWith('file:') && !navigationUrl.startsWith(`http://${processManager.host}:`)) {
      event.preventDefault();
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

  mainWindow.show();
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
        const watchDirs = [
          path.join(__dirname, 'ui'),
          path.join(__dirname, 'index.html'),
          path.join(__dirname, 'shell.html')
        ];
        const triggerReload = (filename) => {
          if (uiReloadTimer) clearTimeout(uiReloadTimer);
          uiReloadTimer = setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              log.log('[DevReloader] Reloading UI on file change:', filename || '');
              mainWindow.webContents.reloadIgnoringCache();
            }
          }, 150);
        };

        watchDirs.forEach(dirPath => {
          if (fs.existsSync(dirPath)) {
            try {
              fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
                if (filename && !filename.includes('.git') && !filename.includes('node_modules')) {
                  triggerReload(filename);
                }
              });
            } catch (err) {
              log.warn('[DevReloader] Watch error:', err.message);
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
    hotkeyManager = new HotkeyManager({ globalShortcut, getMainWindow: () => mainWindow, store, ipcMain });
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

    const assetsRoot = app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'assets', 'dekstop', 'riv')
      : path.join(repoRoot, 'assets', 'dekstop', 'riv');
    const assetPath = path.join(assetsRoot, assetName);

    if (!fs.existsSync(assetPath)) {
      throw new Error('Rive asset is unavailable');
    }
    return pathToFileURL(assetPath).href;
  });

  // Window controls
  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('window:toggle-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow) mainWindow.hide();
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
    mainWindow,
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
}
