import { apiClient } from './api_client.js';
/**
 * Kiroku Note Desktop — Live Telemetry Service
 * Monitors loopback connection status for Backend (21828), AnkiConnect, Yomitan, and OCR.
 */

class TelemetryService {
  constructor() {
    this.status = {
      backend: false,
      anki: false,
      yomitan: false,
      ocr: false,
      lastChecked: null
    };
    this.listeners = new Set();
    this.pollInterval = null;
  }

  subscribe(callback) {
    this.listeners.add(callback);
    callback(this.status);
    return () => this.listeners.delete(callback);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.status);
      } catch (e) {
        console.warn('[Telemetry] Error in listener:', e);
      }
    }
  }

  async checkStatus() {
    // 1. Try desktopAPI IPC bridge first if running inside Electron
    if (typeof window !== 'undefined' && window.desktopAPI?.getServicesStatus) {
      try {
        const ipcStatus = await window.desktopAPI.getServicesStatus();
        if (ipcStatus) {
          this.status = {
            backend: Boolean(ipcStatus.backend),
            anki: Boolean(ipcStatus.anki),
            yomitan: Boolean(ipcStatus.yomitan),
            ocr: Boolean(ipcStatus.ocr),
            lastChecked: new Date()
          };
          this.notify();
          return this.status;
        }
      } catch (bridgeErr) {
        console.warn('[Telemetry] Bridge services status error:', bridgeErr);
      }
    }

    // 2. Fallback to direct HTTP checks against dynamic host:port
    let baseUrl = 'http://127.0.0.1:21828';
    try {
      const backendInfo = await apiClient.getBackendInfo();
      if (backendInfo?.port) {
        baseUrl = `http://${backendInfo.host || '127.0.0.1'}:${backendInfo.port}`;
      }
    } catch (_) {}

    try {
      const healthRes = await fetch(`${baseUrl}/api/health`, { method: 'GET' });
      this.status.backend = healthRes.ok;
    } catch (healthErr) {
      console.warn('[Telemetry] Backend health fetch error:', healthErr);
      this.status.backend = false;
    }

    if (this.status.backend) {
      try {
        const [ankiRes, yomitanRes, ocrRes] = await Promise.allSettled([
          fetch(`${baseUrl}/api/anki/status`),
          fetch(`${baseUrl}/api/yomitan/dictionaries`),
          fetch(`${baseUrl}/api/ocr/status`)
        ]);

        this.status.anki = ankiRes.status === 'fulfilled' && ankiRes.value.ok;

        if (yomitanRes.status === 'fulfilled' && yomitanRes.value.ok) {
          try {
            const data = await yomitanRes.value.json();
            this.status.yomitan = Boolean(data && (data.available_dictionaries?.length > 0 || data.enabled));
          } catch (_) {
            this.status.yomitan = false;
          }
        } else {
          this.status.yomitan = false;
        }

        this.status.ocr = ocrRes.status === 'fulfilled' && ocrRes.value.ok;
      } catch (subErr) {
        console.warn('[Telemetry] Secondary service checks error:', subErr);
      }
    } else {
      this.status.anki = false;
      this.status.yomitan = false;
      this.status.ocr = false;
    }

    this.status.lastChecked = new Date();
    this.notify();
    return this.status;
  }

  startPolling(intervalMs = 6000) {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.checkStatus();
    this.pollInterval = setInterval(() => this.checkStatus(), intervalMs);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

export const telemetryService = new TelemetryService();

