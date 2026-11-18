/**
 * Kiroku Note - Fullscreen Interceptor Script
 * 
 * Runs in the MAIN execution world (page context) across all pages at document_start.
 * Intercepts HTMLVideoElement.prototype.requestFullscreen and webkitRequestFullscreen
 * so that when a web video player requests fullscreen, it fullscreens the player container
 * rather than the raw <video> element. This ensures the subtitle overlay element (and any custom controls)
 * remains visible inside the browser's Fullscreen Top Layer.
 */
(() => {
  if (typeof window === "undefined") return;
  if (window.__KIROKU_FS_HOOK_INITIALIZED__) return;
  window.__KIROKU_FS_HOOK_INITIALIZED__ = true;

  if (typeof HTMLVideoElement !== "undefined" && HTMLVideoElement.prototype) {
    const origRequestFs = HTMLVideoElement.prototype.requestFullscreen;
    const origWebkitRequestFs = HTMLVideoElement.prototype.webkitRequestFullscreen;

    function getPlayerContainer(video) {
      if (!video) return null;
      const selector = ".jwplayer, #player, .video-js, [class*='player'], .art-video-player, #megacloud-player, .html5-video-player, .watch-video, .player-container, [id*='player']";
      let container = (typeof video.closest === "function" && video.closest(selector)) || null;
      if (!container && video.parentElement && video.parentElement !== document.body && video.parentElement !== document.documentElement) {
        container = video.parentElement;
      }
      return container;
    }

    let inRedirect = false;

    if (origRequestFs) {
      HTMLVideoElement.prototype.requestFullscreen = function(options) {
        if (!inRedirect) {
          try {
            const container = getPlayerContainer(this);
            if (container && container !== this && typeof container.requestFullscreen === "function") {
              inRedirect = true;
              try {
                return container.requestFullscreen(options);
              } finally {
                inRedirect = false;
              }
            }
          } catch (_) {
            inRedirect = false;
          }
        }
        return origRequestFs.call(this, options);
      };
    }

    if (origWebkitRequestFs) {
      HTMLVideoElement.prototype.webkitRequestFullscreen = function() {
        if (!inRedirect) {
          try {
            const container = getPlayerContainer(this);
            if (container && container !== this && typeof container.webkitRequestFullscreen === "function") {
              inRedirect = true;
              try {
                return container.webkitRequestFullscreen();
              } finally {
                inRedirect = false;
              }
            }
          } catch (_) {
            inRedirect = false;
          }
        }
        return origWebkitRequestFs.call(this);
      };
    }
  }

  if (typeof Element !== "undefined" && Element.prototype) {
    const origElemRequestFs = Element.prototype.requestFullscreen;
    const origElemWebkitRequestFs = Element.prototype.webkitRequestFullscreen;

    function getPlayerContainerForElem(video) {
      if (!video) return null;
      const selector = ".jwplayer, #player, .video-js, [class*='player'], .art-video-player, #megacloud-player, .html5-video-player, .watch-video, .player-container, [id*='player']";
      let container = (typeof video.closest === "function" && video.closest(selector)) || null;
      if (!container && video.parentElement && video.parentElement !== document.body && video.parentElement !== document.documentElement) {
        container = video.parentElement;
      }
      return container;
    }

    let inElemRedirect = false;

    if (origElemRequestFs) {
      Element.prototype.requestFullscreen = function(options) {
        if (!inElemRedirect && this && (this.tagName === "VIDEO" || (typeof HTMLVideoElement !== "undefined" && this instanceof HTMLVideoElement))) {
          try {
            const container = getPlayerContainerForElem(this);
            if (container && container !== this && typeof container.requestFullscreen === "function") {
              inElemRedirect = true;
              try {
                return container.requestFullscreen(options);
              } finally {
                inElemRedirect = false;
              }
            }
          } catch (_) {
            inElemRedirect = false;
          }
        }
        return origElemRequestFs.call(this, options);
      };
    }

    if (origElemWebkitRequestFs) {
      Element.prototype.webkitRequestFullscreen = function() {
        if (!inElemRedirect && this && (this.tagName === "VIDEO" || (typeof HTMLVideoElement !== "undefined" && this instanceof HTMLVideoElement))) {
          try {
            const container = getPlayerContainerForElem(this);
            if (container && container !== this && typeof container.webkitRequestFullscreen === "function") {
              inElemRedirect = true;
              try {
                return container.webkitRequestFullscreen();
              } finally {
                inElemRedirect = false;
              }
            }
          } catch (_) {
            inElemRedirect = false;
          }
        }
        return origElemWebkitRequestFs.call(this);
      };
    }
  }
})();
