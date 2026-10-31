/**
 * Phase 0 Reproduction Script: Real Electron Window CORS & Route Failure Test
 * Launches Electron with file:// and attempts fetch() to the live backend.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const PORT = 21828;
const outputEvidencePath = path.join(repoRoot, 'docs', 'desktop-wireup', 'reproduce_cors_evidence.json');

app.whenReady().then(async () => {
  const consoleMessages = [];
  const networkEvents = [];

  // Create real Electron window with production preload and webPreferences
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(repoRoot, 'desktop', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    consoleMessages.push({ level, message, line, sourceId });
  });

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    networkEvents.push({
      type: 'response',
      method: details.method,
      url: details.url,
      statusCode: details.statusCode,
      responseHeaders: details.responseHeaders
    });
    callback({ responseHeaders: details.responseHeaders });
  });

  win.webContents.session.webRequest.onErrorOccurred((details) => {
    networkEvents.push({
      type: 'error',
      method: details.method,
      url: details.url,
      error: details.error
    });
  });

  const indexHtmlPath = path.join(repoRoot, 'desktop', 'src', 'index.html');
  await win.loadFile(indexHtmlPath);

  // Wait a moment for DOM and scripts to settle
  await new Promise(r => setTimeout(r, 1000));

  // Now execute fetch() tests from inside renderer running under file:// origin
  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const evidence = {
        windowOrigin: window.origin || window.location.origin,
        windowProtocol: window.location.protocol,
        tests: {}
      };

      // 1. GET /api/health
      try {
        const res = await fetch('http://127.0.0.1:${PORT}/api/health', {
          headers: { 'Accept': 'application/json' }
        });
        evidence.tests.getHealth = {
          status: res.status,
          ok: res.ok,
          headers: Object.fromEntries(res.headers.entries()),
          body: await res.json()
        };
      } catch (err) {
        evidence.tests.getHealth = {
          errorName: err.name,
          errorMessage: err.message,
          errorStack: err.stack
        };
      }

      // 2. GET /api/cards/stats
      try {
        const res = await fetch('http://127.0.0.1:${PORT}/api/cards/stats', {
          headers: { 'Accept': 'application/json' }
        });
        evidence.tests.getStats = {
          status: res.status,
          ok: res.ok,
          headers: Object.fromEntries(res.headers.entries()),
          body: await res.json()
        };
      } catch (err) {
        evidence.tests.getStats = {
          errorName: err.name,
          errorMessage: err.message,
          errorStack: err.stack
        };
      }

      // 3. POST /api/cards (the old broken route from api_client.js)
      try {
        const res = await fetch('http://127.0.0.1:${PORT}/api/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ expression: 'テスト', reading: 'てすと' })
        });
        evidence.tests.postOldCardsRoute = {
          status: res.status,
          ok: res.ok,
          headers: Object.fromEntries(res.headers.entries())
        };
      } catch (err) {
        evidence.tests.postOldCardsRoute = {
          errorName: err.name,
          errorMessage: err.message,
          errorStack: err.stack
        };
      }

      // 4. POST /api/cards/save (the real backend route, testing CORS preflight/post)
      try {
        const res = await fetch('http://127.0.0.1:${PORT}/api/cards/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ expression: 'テスト', reading: 'てすと' })
        });
        evidence.tests.postRealCardsSaveRoute = {
          status: res.status,
          ok: res.ok,
          headers: Object.fromEntries(res.headers.entries())
        };
      } catch (err) {
        evidence.tests.postRealCardsSaveRoute = {
          errorName: err.name,
          errorMessage: err.message,
          errorStack: err.stack
        };
      }

      return evidence;
    })()
  `);

  const fullEvidence = {
    rendererResults: results,
    consoleMessages,
    networkEvents
  };

  fs.mkdirSync(path.dirname(outputEvidencePath), { recursive: true });
  fs.writeFileSync(outputEvidencePath, JSON.stringify(fullEvidence, null, 2), 'utf8');

  console.log('=== EVIDENCE GATHERED ===');
  console.log(JSON.stringify(results, null, 2));
  console.log('Console Errors/Messages Count:', consoleMessages.length);
  for (const msg of consoleMessages) {
    if (msg.message.includes('CORS') || msg.message.includes('fetch') || msg.message.includes('Failed')) {
      console.log(`  CONSOLE: ${msg.message}`);
    }
  }

  win.destroy();
  app.quit();
});

