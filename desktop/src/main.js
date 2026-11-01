/**
 * Kiroku Note - Electron Main Process Entrypoint
 * Windows Desktop Shell with Subprocess Lifecycle Supervision, System Tray,
 * Authenticated Study HTTP API Bridge, and Secure IPC Communication.
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeTheme, nativeImage, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { pathToFileURL } = require('url');
const { ProcessManager } = require('./process_manager');
const { DesktopStore } = require('./store');
const { StudyApiClient } = require('./study_api_client');

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
let lastMenuState = null;
let trayServicesStatus = {
  backendRunning: false,
  yomitanConnected: false,
  ankiConnected: false,
  ocrInstalled: false,
  ocrAvailable: false
};

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
      timeout: 1000
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

  // Show window immediately so user sees the loading state
  mainWindow.show();
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));
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

async function startBackendAndLoadUI() {
  try {
    if (mainWindow) {
      mainWindow.loadFile(path.join(__dirname, 'loading.html'));
    }

    await processManager.startBackend();
    await processManager.waitForBackend(25000, 400);

    // Refresh system tray status indicators with live backend responses
    refreshServicesStatus(true).catch(() => {});

    // Backend and authenticated Study API are verified ready.
    // Load Kiroku Native Desktop Shell (or diagnostic shell/sidepanel if requested).
    const isSidepanelView = process.env.KIROKU_DESKTOP_VIEW === 'sidepanel';
    const isDiagnosticsShell = process.env.KIROKU_DESKTOP_VIEW === 'shell';
    const targetFile = isSidepanelView
      ? path.join(repoRoot, 'extension', 'sidepanel', 'sidepanel.html')
      : isDiagnosticsShell
      ? path.join(__dirname, 'shell.html')
      : path.join(__dirname, 'index.html');

    if (mainWindow) {
      mainWindow.loadFile(targetFile);
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
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
    statusPollingInterval = null;
  }
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

// Second instance detection - focus existing window
app.on('second-instance', () => {
  showMainWindow();
});

// App lifecycle
app.whenReady().then(() => {
  setupIpcHandlers();
  createSystemTray();
  createMainWindow();

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
    try {
      if (!req || typeof req !== 'object') {
        throw new Error('Invalid request payload');
      }

      const { method = 'GET', path: reqPath, query, body, headers = {}, timeoutMs = 15000 } = req;

      if (typeof reqPath !== 'string' || !reqPath.startsWith('/api/')) {
        throw new Error('Unauthorized or invalid API path: ' + reqPath);
      }

      if (reqPath.includes('..') || reqPath.includes('://')) {
        throw new Error('Path traversal or arbitrary URL not allowed');
      }

      const allowedMethods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
      const upperMethod = String(method).toUpperCase();
      if (!allowedMethods.includes(upperMethod)) {
        throw new Error('Method ' + method + ' is not permitted');
      }

      const host = processManager.host || '127.0.0.1';
      const port = processManager.port || 21828;

      let fullPath = reqPath;
      if (query && typeof query === 'object') {
        const searchParams = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) {
          if (v !== undefined && v !== null) {
            searchParams.append(k, String(v));
          }
        }
        const qs = searchParams.toString();
        if (qs) {
          fullPath += (fullPath.includes('?') ? '&' : '?') + qs;
        }
      }

      const requestHeaders = {
        'Accept': 'application/json',
        ...headers
      };

      let requestPayload = null;
      if (body !== undefined && body !== null) {
        if (typeof body === 'object') {
          requestPayload = JSON.stringify(body);
          if (!requestHeaders['Content-Type']) {
            requestHeaders['Content-Type'] = 'application/json';
          }
        } else {
          requestPayload = String(body);
        }
        requestHeaders['Content-Length'] = Buffer.byteLength(requestPayload);
      }

      return await new Promise((resolve) => {
        const requestOptions = {
          hostname: host,
          port: port,
          path: fullPath,
          method: upperMethod,
          headers: requestHeaders,
          timeout: timeoutMs
        };

        const httpRequest = http.request(requestOptions, (httpResponse) => {
          const chunks = [];
          httpResponse.on('data', chunk => chunks.push(chunk));
          httpResponse.on('end', () => {
            const buffer = Buffer.concat(chunks);
            let parsedData = null;
            const contentType = httpResponse.headers['content-type'] || '';
            if (contentType.includes('application/json')) {
              try {
                parsedData = JSON.parse(buffer.toString('utf8'));
              } catch (_) {
                parsedData = buffer.toString('utf8');
              }
            } else {
              parsedData = buffer.toString('utf8');
            }

            const isSuccess = httpResponse.statusCode >= 200 && httpResponse.statusCode < 300;
            if (isSuccess) {
              resolve({
                success: true,
                status: httpResponse.statusCode,
                headers: httpResponse.headers,
                data: parsedData
              });
            } else {
              resolve({
                success: false,
                status: httpResponse.statusCode,
                headers: httpResponse.headers,
                data: parsedData,
                error: {
                  statusCode: httpResponse.statusCode,
                  message: (parsedData && (parsedData.detail || parsedData.message)) || ('HTTP ' + httpResponse.statusCode) 
                }
              });
            }
          });
        });

        httpRequest.on('timeout', () => {
          httpRequest.destroy();
          resolve({
            success: false,
            status: 0,
            error: {
              code: 'TIMEOUT',
              message: 'Request to ' + reqPath + ' timed out after ' + timeoutMs + 'ms'
            }
          });
        });

        httpRequest.on('error', (err) => {
          resolve({
            success: false,
            status: 0,
            error: {
              code: 'NETWORK_ERROR',
              message: err.message
            }
          });
        });

        if (requestPayload) {
          httpRequest.write(requestPayload);
        }
        httpRequest.end();
      });
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'REQUEST_FAILED',
          message: err.message
        }
      };
    }
  });

  // Secure Study API bridge handler
  ipcMain.handle('study:request', async (event, req = {}) => {
    try {
      if (!req || typeof req !== 'object') {
        throw new Error('Invalid request payload');
      }

      const { method = 'GET', path: reqPath, query, body, headers, timeoutMs, clientRequestId, range } = req;

      // Strict IPC validation: Only permit /api/study/v1 or /api/health
      if (typeof reqPath !== 'string' || (!reqPath.startsWith('/api/study/v1') && reqPath !== '/api/health')) {
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
}
