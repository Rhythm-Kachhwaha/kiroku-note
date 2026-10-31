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

          <!-- Visible Error Banner -->
          <div class="settings-error-banner" id="settings-error-banner" style="display: none;">
            <span class="error-msg" id="settings-error-msg"></span>
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-settings-error" aria-label="Dismiss error"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
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
                <span class="tactile-pill tactile-pill-gold" id="llm-status-tag">Key Protected</span>
              </div>
              <p class="card-desc">Generates nuanced pedagogical grammar explanations and disambiguation advice.</p>

              <div class="form-row-pair mt-3">
                <div class="form-field">
                  <label for="llm-provider-select">Provider</label>
                  <select id="llm-provider-select" class="tactile-input">
                    <option value="none">None (Offline Pure Rule-Based)</option>
                    <option value="groq">Groq (Ultra-Fast Llama-3)</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="ollama">Ollama (Local Offline)</option>
                  </select>
                </div>
                <div class="form-field">
                  <label for="llm-model-input">Model Name</label>
                  <input type="text" id="llm-model-input" class="tactile-input font-mono text-sm" placeholder="e.g. llama-3.3-70b-versatile" />
                </div>
              </div>

              <div class="form-field mt-3">
                <label for="llm-key-input">API Key (Protected by Windows DPAPI)</label>
                <input type="password" id="llm-key-input" class="tactile-input font-mono text-sm" placeholder="Enter API key to update..." />
              </div>

              <div class="card-actions-row mt-3">
                <button type="button" class="tactile-btn tactile-btn-primary" id="btn-save-llm">Save Settings</button>
                <button type="button" class="tactile-btn" id="btn-test-llm">Test LLM Connection</button>
              </div>

              <div class="llm-test-result-box mt-3" id="llm-test-result" style="display: none;">
                <span class="font-mono text-xs text-muted" id="llm-test-output"></span>
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

  showError(message) {
    const banner = document.getElementById('settings-error-banner');
    const msg = document.getElementById('settings-error-msg');
    if (banner && msg) {
      msg.textContent = message;
      banner.style.display = 'flex';
    }
  }

  clearError() {
    const banner = document.getElementById('settings-error-banner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  setupEvents() {
    const btnDismiss = document.getElementById('btn-dismiss-settings-error');
    if (btnDismiss) {
      btnDismiss.addEventListener('click', () => this.clearError());
    }

    // Test Anki button
    const btnAnki = document.getElementById('btn-test-anki');
    if (btnAnki) {
      btnAnki.addEventListener('click', async () => {
        btnAnki.disabled = true;
        btnAnki.textContent = 'Testing...';
        this.clearError();

        try {
          const res = await apiClient.getAnkiStatus();
          const tag = document.getElementById('anki-status-tag');
          if (tag) {
            const connected = Boolean(res?.connected);
            tag.textContent = connected ? `Connected (v${res.version || '?'})` : 'Unavailable';
            tag.className = `tactile-pill ${connected ? 'tactile-pill-gold' : ''}`;
          }
        } catch (err) {
          console.warn('[Settings] Anki status test failed:', err);
          const tag = document.getElementById('anki-status-tag');
          if (tag) {
            tag.textContent = 'Connection Failed';
            tag.className = 'tactile-pill';
          }
          this.showError('AnkiConnect test failed: ' + (err.message || 'Make sure Anki is running with AnkiConnect'));
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
        this.clearError();

        try {
          if (this.ocrRunning) {
            await apiClient.stopOcr();
            this.ocrRunning = false;
          } else {
            await apiClient.startOcr();
            this.ocrRunning = true;
          }
          this.updateOcrStatus();
        } catch (err) {
          console.warn('[Settings] OCR toggle failed:', err);
          this.showError('OCR daemon error: ' + (err.message || 'Could not toggle OCR server'));
        } finally {
          btnOcr.disabled = false;
        }
      });
    }

    // Save LLM Config
    const btnSaveLlm = document.getElementById('btn-save-llm');
    if (btnSaveLlm) {
      btnSaveLlm.addEventListener('click', async () => {
        const provider = document.getElementById('llm-provider-select')?.value || 'none';
        const model = document.getElementById('llm-model-input')?.value.trim() || undefined;
        const keyInput = document.getElementById('llm-key-input')?.value.trim();

        btnSaveLlm.disabled = true;
        btnSaveLlm.textContent = 'Saving...';
        this.clearError();

        try {
          const payload = { provider };
          if (model) payload.model = model;
          if (keyInput) payload.api_key = keyInput;

          await apiClient.updateLlmConfig(payload);

          const tag = document.getElementById('llm-status-tag');
          if (tag) {
            tag.textContent = 'Saved';
            setTimeout(() => {
              tag.textContent = 'Key Protected';
            }, 3000);
          }
          // Clear secret from DOM input for security
          const keyEl = document.getElementById('llm-key-input');
          if (keyEl && keyInput) {
            keyEl.value = '';
            keyEl.placeholder = '•••••••• (Encrypted in DPAPI)';
          }
        } catch (err) {
          console.error('[Settings] Save LLM config failed:', err);
          this.showError('Failed to save LLM settings: ' + (err.message || 'Validation error'));
        } finally {
          btnSaveLlm.disabled = false;
          btnSaveLlm.textContent = 'Save Settings';
        }
      });
    }

    // Test LLM Latency
    const btnTestLlm = document.getElementById('btn-test-llm');
    if (btnTestLlm) {
      btnTestLlm.addEventListener('click', async () => {
        btnTestLlm.disabled = true;
        btnTestLlm.textContent = 'Testing...';
        this.clearError();

        const resultBox = document.getElementById('llm-test-result');
        const outputEl = document.getElementById('llm-test-output');
        if (resultBox && outputEl) {
          resultBox.style.display = 'block';
          outputEl.textContent = 'Testing model latency...';
        }

        const startTime = Date.now();
        try {
          const res = await apiClient.testLlm('Hello, test connection.');
          const latencyMs = Date.now() - startTime;
          if (outputEl) {
            outputEl.textContent = `Latency: ${latencyMs}ms · Response: ${res?.result || JSON.stringify(res)}`;
          }
        } catch (err) {
          console.warn('[Settings] Test LLM failed:', err);
          if (outputEl) {
            outputEl.textContent = `Error (${Date.now() - startTime}ms): ${err.message || 'Request failed'}`;
          }
          this.showError('LLM test failed: ' + (err.message || 'Check provider key and network'));
        } finally {
          btnTestLlm.disabled = false;
          btnTestLlm.textContent = 'Test LLM Connection';
        }
      });
    }

    // Doctor Diagnostics Check
    const btnDoctor = document.getElementById('btn-run-doctor');
    if (btnDoctor) {
      btnDoctor.addEventListener('click', async () => {
        btnDoctor.disabled = true;
        btnDoctor.textContent = 'Checking...';
        this.clearError();

        try {
          const report = await studyClient.getDiagnostics();
          const box = document.getElementById('doctor-results');
          const out = document.getElementById('doctor-output');
          if (box && out) {
            box.style.display = 'block';
            out.textContent = JSON.stringify(report, null, 2);
          }
        } catch (err) {
          console.warn('[Settings] Run doctor failed:', err);
          const box = document.getElementById('doctor-results');
          const out = document.getElementById('doctor-output');
          if (box && out) {
            box.style.display = 'block';
            out.textContent = `Doctor Check Error: ${err.message}`;
          }
          this.showError('Doctor check error: ' + (err.message || 'Diagnostics failed'));
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
        if (btnRestart.dataset.confirming !== 'true') {
          btnRestart.dataset.confirming = 'true';
          btnRestart.textContent = 'Confirm Restart?';
          btnRestart.classList.add('tactile-btn-primary');
          setTimeout(() => {
            if (btnRestart && btnRestart.dataset.confirming === 'true') {
              btnRestart.dataset.confirming = 'false';
              btnRestart.textContent = 'Restart Backend Service';
              btnRestart.classList.remove('tactile-btn-primary');
            }
          }, 4000);
          return;
        }

        btnRestart.disabled = true;
        btnRestart.textContent = 'Restarting...';
        if (true) {
          if (window.desktopAPI?.retryBackend) {
            window.desktopAPI.retryBackend();
          }
        }
      });
    }
  }

  async loadInitialSettings() {
    // 1. OCR status
    try {
      const ocrRes = await apiClient.getOcrStatus();
      if (ocrRes) {
        this.ocrRunning = Boolean(ocrRes.running);
        this.updateOcrStatus();
      }
    } catch (err) {
      console.warn('[Settings] Initial OCR status error:', err);
    }

    // 2. Anki status
    try {
      const ankiRes = await apiClient.getAnkiStatus();
      const tag = document.getElementById('anki-status-tag');
      if (tag && ankiRes) {
        const connected = Boolean(ankiRes.connected);
        tag.textContent = connected ? `Connected (v${ankiRes.version || '?'})` : 'Unavailable';
        tag.className = `tactile-pill ${connected ? 'tactile-pill-gold' : ''}`;
      }
    } catch (err) {
      console.warn('[Settings] Initial Anki status error:', err);
    }

    // 3. LLM config
    try {
      const llmConf = await apiClient.getLlmConfig();
      if (llmConf) {
        const provSelect = document.getElementById('llm-provider-select');
        const modelInput = document.getElementById('llm-model-input');
        const keyInput = document.getElementById('llm-key-input');

        if (provSelect && llmConf.provider) {
          provSelect.value = llmConf.provider;
        }
        if (modelInput && llmConf.model) {
          modelInput.value = llmConf.model;
        }
        if (keyInput && llmConf.has_key) {
          keyInput.placeholder = '•••••••• (Configured in Windows DPAPI)';
        }
      }
    } catch (err) {
      console.warn('[Settings] Initial LLM config error:', err);
    }
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
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
