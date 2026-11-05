/**
 * Kiroku Note Desktop — Theater Preload (Slice 43)
 *
 * Runs inside WebContentsView for non-DRM streaming sites.
 * Sandbox: true, contextIsolation: true, nodeIntegration: false.
 * Exposes ONLY the link-bridge logic so the browser extension is not needed inside Kiroku.
 * Intercepts EME and encrypted events for non-DRM enforcement.
 */

const { contextBridge, ipcRenderer } = require('electron');

// 1. DRM Detection Interceptors (Strictly enforce non-DRM policy)
(function setupDrmDetection() {
  const notifyDrm = (reason) => {
    try {
      ipcRenderer.send('theater:drm-detected', {
        reason,
        url: window.location.href,
        hostname: window.location.hostname
      });
    } catch (_) {}
  };

  // Check known DRM hosts
  try {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('netflix.com') || host.includes('disneyplus.com') || host.includes('hulu.com') || host.includes('primevideo.com')) {
      notifyDrm('known_drm_host');
    }
  } catch (_) {}

  // Intercept Encrypted Media Extensions (EME)
  if (typeof navigator !== 'undefined' && navigator.requestMediaKeySystemAccess) {
    const originalRequestMediaKeySystemAccess = navigator.requestMediaKeySystemAccess.bind(navigator);
    navigator.requestMediaKeySystemAccess = function (keySystem, supportedConfigurations) {
      notifyDrm(`eme_request:${keySystem}`);
      return originalRequestMediaKeySystemAccess(keySystem, supportedConfigurations);
    };
  }

  // Intercept Media 'encrypted' event on document
  if (typeof document !== 'undefined') {
    document.addEventListener('encrypted', (event) => {
      notifyDrm('media_encrypted_event');
    }, true);
  }
})();

// 2. Link Bridge In-Page Video Observation
(function setupLinkBridge() {
  let activeVideo = null;
  let pollInterval = null;
  let lastTimeEmit = 0;

  function findVideo() {
    return document.querySelector('video');
  }

  function emitToMain(type, payload = {}) {
    try {
      ipcRenderer.send('theater:bridge:event', {
        type,
        payload
      });
    } catch (_) {}
  }

  function emitState() {
    if (!activeVideo) return;
    emitToMain('video.state', {
      t: typeof activeVideo.currentTime === 'number' ? activeVideo.currentTime : 0,
      paused: Boolean(activeVideo.paused),
      rate: typeof activeVideo.playbackRate === 'number' ? activeVideo.playbackRate : 1,
      duration: typeof activeVideo.duration === 'number' && !isNaN(activeVideo.duration) ? activeVideo.duration : 0
    });
  }

  function onTimeUpdate() {
    const now = Date.now();
    if (now - lastTimeEmit < 100) return; // 10Hz throttle
    lastTimeEmit = now;
    emitState();
  }

  function attachVideo(video) {
    if (!video || activeVideo === video) return;
    detachVideo();
    activeVideo = video;

    try {
      video.addEventListener('play', emitState);
      video.addEventListener('pause', emitState);
      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('ratechange', emitState);
      video.addEventListener('ended', emitState);
    } catch (_) {}

    emitToMain('video.attach', {
      title: document.title || '',
      site: window.location.hostname || 'WEB',
      duration: video.duration || 0,
      drm: false
    });
    emitState();
  }

  function detachVideo() {
    if (!activeVideo) return;
    try {
      activeVideo.removeEventListener('play', emitState);
      activeVideo.removeEventListener('pause', emitState);
      activeVideo.removeEventListener('timeupdate', onTimeUpdate);
      activeVideo.removeEventListener('ratechange', emitState);
      activeVideo.removeEventListener('ended', emitState);
    } catch (_) {}
    activeVideo = null;
    emitToMain('video.detach', {});
  }

  function startObservation() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
      const vid = findVideo();
      if (vid && !activeVideo) {
        attachVideo(vid);
      } else if (!vid && activeVideo) {
        detachVideo();
      }
    }, 1000);

    const initialVid = findVideo();
    if (initialVid) attachVideo(initialVid);
  }

  // Listen for commands relayed from desktop main process
  ipcRenderer.on('theater:bridge:command', (_event, { cmd, payload = {} }) => {
    const vid = activeVideo || findVideo();
    if (!vid) return;

    switch (cmd) {
      case 'cmd.play':
        vid.play?.().catch(() => {});
        emitState();
        break;
      case 'cmd.pause':
        vid.pause?.();
        emitState();
        break;
      case 'cmd.seek':
        if (typeof payload.t === 'number') {
          vid.currentTime = Math.max(0, payload.t);
        } else if (typeof payload.delta === 'number') {
          vid.currentTime = Math.max(0, (vid.currentTime || 0) + payload.delta);
        }
        emitState();
        break;
      case 'cmd.jump':
        if (typeof payload.delta === 'number') {
          vid.currentTime = Math.max(0, (vid.currentTime || 0) + payload.delta);
        }
        emitState();
        break;
      case 'cmd.rate':
        if (typeof payload.v === 'number') {
          vid.playbackRate = payload.v;
        }
        emitState();
        break;
      default:
        break;
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObservation);
  } else {
    startObservation();
  }
})();

// Expose safe link-bridge marker to isolated world
contextBridge.exposeInMainWorld('__kirokuTheaterBridge', {
  version: '1.0.0',
  isTheaterView: true
});
