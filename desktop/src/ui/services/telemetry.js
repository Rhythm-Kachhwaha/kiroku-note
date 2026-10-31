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
      } catch (_) {}
    }

    // 2. Fallback to direct HTTP checks against 127.0.0.1:21828
    try {
      const healthRes = await fetch('http://127.0.0.1:21828/api/health', { method: 'GET' });
      this.status.backend = healthRes.ok;
    } catch (_) {
      this.status.backend = false;
    }

    if (this.status.backend) {
      try {
        const [ankiRes, yomitanRes, ocrRes] = await Promise.allSettled([
          fetch('http://127.0.0.1:21828/api/anki/status'),
          fetch('http://127.0.0.1:21828/api/dictionary/status'),
          fetch('http://127.0.0.1:21828/api/ocr/status')
        ]);

        this.status.anki = ankiRes.status === 'fulfilled' && ankiRes.value.ok;
        this.status.yomitan = yomitanRes.status === 'fulfilled' && yomitanRes.value.ok;
        this.status.ocr = ocrRes.status === 'fulfilled' && ocrRes.value.ok;
      } catch (_) {}
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

