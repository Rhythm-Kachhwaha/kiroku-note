/**
 * Kiroku Note Desktop — Theater View Controller (Slice 43)
 *
 * Tier 2: Non-DRM site playback directly inside Kiroku Desktop using WebContentsView.
 * Security specifications:
 * - sandbox: true, contextIsolation: true, nodeIntegration: false
 * - partition: 'persist:theater'
 * - setWindowOpenHandler: deny
 * - Strict host allowlist (user approval required on first host visit)
 * - Navigation locked to approved hosts
 * - Strict DRM detection: if protected media / EME is detected, immediately stops and
 *   shows plain message "Protected video: play in browser, Kiroku will follow via Link",
 *   keeping Link companion mode. NEVER attempts Widevine/DRM bypass.
 */

const path = require('node:path');

const KNOWN_DRM_HOSTS = new Set([
  'netflix.com',
  'www.netflix.com',
  'disneyplus.com',
  'www.disneyplus.com',
  'hulu.com',
  'www.hulu.com',
  'primevideo.com',
  'www.primevideo.com',
  'amazon.com',
  'www.amazon.com',
  'hbomax.com',
  'max.com'
]);

const DRM_PROTECTED_MESSAGE = 'Protected video: play in browser, Kiroku will follow via Link';

class TheaterViewController {
  constructor(options = {}) {
    this.mainWindow = options.mainWindow || null;
    this.electron = options.electron || (function () {
      try {
        return require('electron');
      } catch (_) {
        return null;
      }
    })();
    this.preloadPath = options.preloadPath || path.join(__dirname, 'theater_preload.js');
    this.onAskHostApproval = options.onAskHostApproval || (async () => true);
    this.onDrmDetected = options.onDrmDetected || null;
    this.onBridgeEvent = options.onBridgeEvent || null;

    this.approvedHosts = new Set(options.initialApprovedHosts || []);
    this.view = null;
    this.activeUrl = null;
    this.isDrmProtected = false;
    this.lastError = null;
    this.isOpen = false;
  }

  isKnownDrmHost(hostnameOrUrl) {
    if (!hostnameOrUrl) return false;
    let host = hostnameOrUrl.toLowerCase();
    try {
      if (host.includes('://')) {
        host = new URL(host).hostname.toLowerCase();
      }
    } catch (_) {}

    for (const drmHost of KNOWN_DRM_HOSTS) {
      if (host === drmHost || host.endsWith(`.${drmHost}`)) {
        return true;
      }
    }
    return false;
  }

  initView() {
    if (this.view) return this.view;
    if (!this.electron?.WebContentsView) {
      throw new Error('WebContentsView is not supported by the current Electron environment');
    }

    const { WebContentsView } = this.electron;
    this.view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:theater',
        preload: this.preloadPath
      }
    });

    const wc = this.view.webContents;

    // Deny all popup / child window creation
    if (typeof wc.setWindowOpenHandler === 'function') {
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    }

    // Limit navigation strictly to approved hosts
    const handleNavigation = (event, navUrl) => {
      let hostname = '';
      try {
        hostname = new URL(navUrl).hostname.toLowerCase();
      } catch (_) {
        event.preventDefault?.();
        return;
      }

      if (this.isKnownDrmHost(hostname)) {
        event.preventDefault?.();
        this.handleDrmDetection({ hostname, reason: 'known_drm_host' });
        return;
      }

      if (!this.approvedHosts.has(hostname)) {
        event.preventDefault?.();
        this.askAndNavigate(navUrl, hostname);
      }
    };

    wc.on?.('will-navigate', handleNavigation);
    wc.on?.('will-redirect', handleNavigation);

    return this.view;
  }

  async askAndNavigate(url, hostname) {
    const approved = await this.onAskHostApproval(hostname);
    if (approved) {
      this.approvedHosts.add(hostname);
      this.view?.webContents?.loadURL?.(url);
    } else {
      this.lastError = `Host not approved: ${hostname}`;
    }
  }

  async openUrl(rawUrl, bounds = null) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return { ok: false, error: 'Invalid URL' };
    }

    let urlObj;
    try {
      urlObj = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    } catch (_) {
      return { ok: false, error: 'Malformed URL' };
    }

    const targetUrl = urlObj.href;
    const hostname = urlObj.hostname.toLowerCase();

    // 1. DRM pre-check
    if (this.isKnownDrmHost(hostname)) {
      this.isDrmProtected = true;
      if (this.onDrmDetected) {
        this.onDrmDetected({ url: targetUrl, hostname, reason: 'known_drm_host' });
      }
      return {
        ok: false,
        drm: true,
        message: DRM_PROTECTED_MESSAGE
      };
    }

    // 2. Host Approval check
    if (!this.approvedHosts.has(hostname)) {
      const approved = await this.onAskHostApproval(hostname);
      if (!approved) {
        return {
          ok: false,
          approved: false,
          error: `Host permission denied by user for ${hostname}`
        };
      }
      this.approvedHosts.add(hostname);
    }

    this.initView();
    this.activeUrl = targetUrl;
    this.isDrmProtected = false;
    this.lastError = null;
    this.isOpen = true;

    // Attach view to main window
    if (this.mainWindow) {
      if (this.mainWindow.contentView?.addChildView) {
        this.mainWindow.contentView.addChildView(this.view);
      } else if (this.mainWindow.setBrowserView) {
        this.mainWindow.setBrowserView(this.view);
      }

      if (bounds && this.view.setBounds) {
        this.view.setBounds(bounds);
      }
    }

    await this.view.webContents.loadURL(targetUrl);
    return { ok: true, url: targetUrl };
  }

  handleDrmDetection(info = {}) {
    this.isDrmProtected = true;
    this.close();

    if (typeof this.onDrmDetected === 'function') {
      this.onDrmDetected({
        ...info,
        message: DRM_PROTECTED_MESSAGE
      });
    }

    return {
      drm: true,
      message: DRM_PROTECTED_MESSAGE
    };
  }

  close() {
    if (!this.view) return;
    this.isOpen = false;
    if (this.mainWindow) {
      if (this.mainWindow.contentView?.removeChildView) {
        this.mainWindow.contentView.removeChildView(this.view);
      } else if (this.mainWindow.setBrowserView) {
        this.mainWindow.setBrowserView(null);
      }
    }
  }

  sendCommand(cmd, payload = {}) {
    if (!this.view || !this.view.webContents?.send) {
      return { ok: false, error: 'WebContentsView is not active' };
    }
    this.view.webContents.send('theater:bridge:command', { cmd, payload });
    return { ok: true };
  }

  getStatus() {
    return {
      isOpen: this.isOpen,
      activeUrl: this.activeUrl,
      isDrmProtected: this.isDrmProtected,
      drmMessage: this.isDrmProtected ? DRM_PROTECTED_MESSAGE : null,
      approvedHosts: Array.from(this.approvedHosts)
    };
  }
}

module.exports = {
  TheaterViewController,
  KNOWN_DRM_HOSTS,
  DRM_PROTECTED_MESSAGE
};

