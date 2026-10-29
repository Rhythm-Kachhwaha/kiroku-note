/**
 * Kiroku Note - Electron Main Process Entrypoint
 * Windows Desktop Shell with Subprocess Lifecycle Supervision, System Tray, and Close-to-Tray.
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { ProcessManager } = require('./process_manager');
const { DesktopStore } = require('./store');

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

const repoRoot = path.resolve(__dirname, '..', '..');
const processManager = new ProcessManager({
  repoRoot,
  isPackaged: app.isPackaged
});
const desktopStore = new DesktopStore();

// Set native theme to dark by default
nativeTheme.themeSource = 'dark';
Menu.setApplicationMenu(null);

function resolveIconPath() {
  const icoPath = path.join(repoRoot, 'assets', 'icon.ico');
  const pngPath = path.join(repoRoot, 'assets', 'icon.png');
  if (process.platform === 'win32' && fs.existsSync(icoPath)) {
    return icoPath;
  }
  if (fs.existsSync(pngPath)) {
    return pngPath;
  }
  return null;
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
  
  tray = new Tray(trayIcon);
  tray.setToolTip('Kiroku Note');

  const contextMenu = Menu.buildFromTemplate([
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
              const qTab = document.querySelector('#tab-btn-quickadd');
              if (qTab) qTab.click();
              const input = document.querySelector('#quickadd-input');
              if (input) input.focus();
            })();
          `).catch(() => {});
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Kiroku',
      click: () => quitApplication()
    }
  ]);

  tray.setContextMenu(contextMenu);

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

    // Backend is verified healthy. Load Side Panel UI.
    const sidepanelPath = path.join(repoRoot, 'extension', 'sidepanel', 'sidepanel.html');
    if (mainWindow) {
      mainWindow.loadFile(sidepanelPath);
    }
  } catch (err) {
    console.error('[Main] Failed to start backend:', err);
    if (mainWindow) {
      mainWindow.loadFile(path.join(__dirname, 'error.html'));
    }
  }
}

function quitApplication() {
  isQuitting = true;
  try {
    processManager.stopBackend();
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
          backendExternal: processManager.isExternal
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

  ipcMain.handle('app:quit', () => {
    quitApplication();
  });

  // Backend state & retry
  ipcMain.handle('backend:info', () => ({
    status: processManager.status,
    external: processManager.isExternal,
    port: processManager.port
  }));

  ipcMain.handle('backend:retry', async () => {
    await startBackendAndLoadUI();
    return true;
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
}
