/**
 * Kiroku Note Desktop — Global Settings & Telemetry View Controller
 * Service integrations (AnkiConnect, Yomitan, OCR, LLM), encrypted DPAPI keys,
 * doctor diagnostics report, app data affordances, and backend supervisor controls.
 */

import { apiClient } from '../services/api_client.js';
import { studyClient } from '../services/study_client.js';
import { renderAssetSlot } from '../assets_map.js';

export class SettingsView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.ocrRunning = false;
  }

  async mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
    await this.loadInitialSettings();
  }

  render() {
    this.container.innerHTML = `
      <div class="settings-view-wrapper">
        <div class="settings-view-container">
          <!-- Page Header -->
          <div class="settings-header-row">
            <div>
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-gold-eye"></span>
                <span class="font-mono text-sm tracking-widest text-gold uppercase">GLOBAL SETTINGS · 環境設定</span>
              </div>
              <h1 class="settings-title">Integrations &amp; System Health</h1>
              <p class="settings-subtitle">Manage loopback connection endpoints, encrypted credentials, and system diagnostics.</p>
            </div>
            ${renderAssetSlot('settings-mechanic-cat', 'settings-mascot-box')}
          </div>

          <div class="settings-cards-grid">
            <!-- Card 1: AnkiConnect Integration -->
            <div class="settings-card tactile-card">
              <div class="card-header-row">
                <h3 class="card-title">AnkiConnect Sync</h3>
                <span class="tactile-pill" id="anki-status-tag">Checking...</span>
              </div>
              <p class="card-desc">Direct local HTTP synchronization to Anki desktop client.</p>

              <div class="form-field mt-3">
                <label for="anki-url-input">AnkiConnect Endpoint URL</label>
                <input type="text" id="anki-url-input" class="tactile-input font-mono text-sm" value="http://127.0.0.1:8765" />
              </div>

              <div class="card-actions-row mt-3">
                <button type="button" class="tactile-btn tactile-btn-primary" id="btn-test-anki">Test Connection</button>
              </div>
            </div>

            <!-- Card 2: OCR Daemon Controls (Port 21829) -->
            <div class="settings-card tactile-card">
              <div class="card-header-row">
                <h3 class="card-title">Manga-OCR Daemon</h3>
                <span class="tactile-pill" id="ocr-status-tag">Stopped</span>
              </div>
              <p class="card-desc">Isolated, optional CPU-only manga-ocr background server on loopback port 21829.</p>

              <div class="card-actions-row mt-3">
                <button type="button" class="tactile-btn" id="btn-toggle-ocr">Start OCR Server</button>
              </div>
            </div>

            <!-- Card 3: LLM Provider Configuration -->
            <div class="settings-card tactile-card">
              <div class="card-header-row">
                <h3 class="card-title">AI Explanation Provider</h3>
                <span class="tactile-pill tactile-pill-gold">Windows DPAPI Encrypted</span>
              </div>
              <p class="card-desc">Generates nuanced pedagogical grammar explanations and disambiguation advice.</p>

              <div class="form-row-pair mt-3">
                <div class="form-field">
                  <label for="llm-provider-select">Provider</label>
                  <select id="llm-provider-select" class="tactile-input">
                    <option value="none">None (Offline Pure Rule-Based)</option>
                    <option value="groq" selected>Groq (Ultra-Fast Llama-3)</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="ollama">Ollama (Local Offline)</option>
                  </select>
                </div>
                <div class="form-field">
                  <label for="llm-model-input">Model Name</label>
                  <input type="text" id="llm-model-input" class="tactile-input font-mono text-sm" value="llama-3.3-70b-versatile" />
                </div>
              </div>

              <div class="form-field mt-3">
                <label for="llm-key-input">API Key (Protected by Windows DPAPI)</label>
                <input type="password" id="llm-key-input" class="tactile-input font-mono text-sm" placeholder="••••••••••••••••••••••••" />
              </div>

              <div class="card-actions-row mt-3">
                <button type="button" class="tactile-btn tactile-btn-primary" id="btn-save-llm">Save Settings</button>
                <button type="button" class="tactile-btn" id="btn-test-llm">Test Latency</button>
              </div>
            </div>

            <!-- Card 4: Doctor Diagnostics & Maintenance -->
            <div class="settings-card tactile-card">
              <div class="card-header-row">
                <h3 class="card-title">System Doctor Diagnostics</h3>
                <span class="tactile-pill tactile-pill-gold">Read-Only</span>
              </div>
              <p class="card-desc">Non-mutating verification of SQLite database integrity, sealed triggers, and media assets.</p>

              <div class="doctor-results-box mt-3" id="doctor-results" style="display: none;">
                <pre class="doctor-pre font-mono text-xs" id="doctor-output"></pre>
              </div>

              <div class="card-actions-row mt-3">
                <button type="button" class="tactile-btn tactile-btn-primary" id="btn-run-doctor">Run Doctor Check</button>
                <button type="button" class="tactile-btn" id="btn-open-appdata">Open App Data</button>
                <button type="button" class="tactile-btn" id="btn-restart-backend">Restart Backend</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEvents() {
    // Test Anki button
    const btnAnki = document.getElementById('btn-test-anki');
    if (btnAnki) {
      btnAnki.addEventListener('click', async () => {
        btnAnki.disabled = true;
        btnAnki.textContent = 'Testing...';
        try {
          const url = document.getElementById('anki-url-input')?.value || 'http://127.0.0.1:8765';
          const res = await apiClient.testAnki(url);
          const tag = document.getElementById('anki-status-tag');
          if (tag) {
            tag.textContent = res.connected ? 'Connected' : 'Unavailable';
            tag.className = `tactile-pill ${res.connected ? 'tactile-pill-gold' : ''}`;
          }
        } catch (_) {
          const tag = document.getElementById('anki-status-tag');
          if (tag) tag.textContent = 'Connection Failed';
        } finally {
          btnAnki.disabled = false;
          btnAnki.textContent = 'Test Connection';
        }
      });
    }

    // Toggle OCR
    const btnOcr = document.getElementById('btn-toggle-ocr');
    if (btnOcr) {
      btnOcr.addEventListener('click', async () => {
        btnOcr.disabled = true;
        try {
          if (this.ocrRunning) {
            await apiClient.stopOcr();
            this.ocrRunning = false;
          } else {
            await apiClient.startOcr();
            this.ocrRunning = true;
          }
          this.updateOcrStatus();
        } catch (_) {}
        finally {
          btnOcr.disabled = false;
        }
      });
    }

    // Doctor Diagnostics Check
    const btnDoctor = document.getElementById('btn-run-doctor');
    if (btnDoctor) {
      btnDoctor.addEventListener('click', async () => {
        btnDoctor.disabled = true;
        btnDoctor.textContent = 'Checking...';
        try {
          const report = await studyClient.getDiagnostics();
          const box = document.getElementById('doctor-results');
          const out = document.getElementById('doctor-output');
          if (box && out) {
            box.style.display = 'block';
            out.textContent = JSON.stringify(report, null, 2);
          }
        } catch (err) {
          const box = document.getElementById('doctor-results');
          const out = document.getElementById('doctor-output');
          if (box && out) {
            box.style.display = 'block';
            out.textContent = `Doctor Check Error: ${err.message}`;
          }
        } finally {
          btnDoctor.disabled = false;
          btnDoctor.textContent = 'Run Doctor Check';
        }
      });
    }

    // Open AppData Folder
    const btnAppData = document.getElementById('btn-open-appdata');
    if (btnAppData) {
      btnAppData.addEventListener('click', () => {
        if (window.desktopAPI?.openUserDataFolder) {
          window.desktopAPI.openUserDataFolder();
        }
      });
    }

    // Restart Backend
    const btnRestart = document.getElementById('btn-restart-backend');
    if (btnRestart) {
      btnRestart.addEventListener('click', () => {
        if (window.desktopAPI?.retryBackend) {
          window.desktopAPI.retryBackend();
        }
      });
    }
  }

  async loadInitialSettings() {
    try {
      const ocrRes = await apiClient.getOcrStatus();
      if (ocrRes) {
        this.ocrRunning = Boolean(ocrRes.running);
        this.updateOcrStatus();
      }
    } catch (_) {}
  }

  updateOcrStatus() {
    const tag = document.getElementById('ocr-status-tag');
    const btn = document.getElementById('btn-toggle-ocr');
    if (tag) {
      tag.textContent = this.ocrRunning ? 'Running (Port 21829)' : 'Stopped';
      tag.className = `tactile-pill ${this.ocrRunning ? 'tactile-pill-gold' : ''}`;
    }
    if (btn) {
      btn.textContent = this.ocrRunning ? 'Stop OCR Server' : 'Start OCR Server';
    }
  }

  unmount() {
    if (this.container) this.container.innerHTML = '';
  }
}

