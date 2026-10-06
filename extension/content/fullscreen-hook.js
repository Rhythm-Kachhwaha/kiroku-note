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

    if (origRequestFs) {
      HTMLVideoElement.prototype.requestFullscreen = function(options) {
        const container = getPlayerContainer(this);
        if (container && container !== this && typeof container.requestFullscreen === "function") {
          return container.requestFullscreen(options);
        }
        return origRequestFs.call(this, options);
      };
    }

    if (origWebkitRequestFs) {
      HTMLVideoElement.prototype.webkitRequestFullscreen = function() {
        const container = getPlayerContainer(this);
        if (container && container !== this && typeof container.webkitRequestFullscreen === "function") {
          return container.webkitRequestFullscreen();
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

    if (origElemRequestFs) {
      Element.prototype.requestFullscreen = function(options) {
        if (this && (this.tagName === "VIDEO" || (typeof HTMLVideoElement !== "undefined" && this instanceof HTMLVideoElement))) {
          const container = getPlayerContainerForElem(this);
          if (container && container !== this && typeof container.requestFullscreen === "function") {
            return container.requestFullscreen(options);
          }
        }
        return origElemRequestFs.call(this, options);
      };
    }

    if (origElemWebkitRequestFs) {
      Element.prototype.webkitRequestFullscreen = function() {
        if (this && (this.tagName === "VIDEO" || (typeof HTMLVideoElement !== "undefined" && this instanceof HTMLVideoElement))) {
          const container = getPlayerContainerForElem(this);
          if (container && container !== this && typeof container.webkitRequestFullscreen === "function") {
            return container.webkitRequestFullscreen();
          }
        }
        return origElemWebkitRequestFs.call(this);
      };
    }
  }
})();
