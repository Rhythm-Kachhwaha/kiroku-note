/**
 * Kiroku Note - YouTube Player Adapter
 */

(function (root, factory) {
  const exports = factory(
    typeof require === "function" ? require("./player-adapter.js") : { PlayerAdapter: root.PlayerAdapter, defaultPlayerRegistry: root.defaultPlayerRegistry }
  );
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.YouTubePlayerAdapter = exports.YouTubePlayerAdapter;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (base) {
  "use strict";

  const PlayerAdapter = base.PlayerAdapter;

  class YouTubePlayerAdapter extends PlayerAdapter {
    static detect(video) {
      if (typeof location !== "undefined" && location.hostname && location.hostname.includes("youtube.com")) {
        return Boolean(video);
      }
      return Boolean(video && (video.closest?.(".html5-video-player") || video.classList?.contains("html5-main-video")));
    }

    _getYtPlayer() {
      if (typeof document !== "undefined") {
        return document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
      }
      return null;
    }

    play() {
      const yt = this._getYtPlayer();
      if (yt && typeof yt.playVideo === "function") {
        try {
          yt.playVideo();
          return;
        } catch (_) {}
      }
      super.play();
    }

    pause() {
      const yt = this._getYtPlayer();
      if (yt && typeof yt.pauseVideo === "function") {
        try {
          yt.pauseVideo();
          return;
        } catch (_) {}
      }
      super.pause();
    }

    seek(timeSeconds) {
      const yt = this._getYtPlayer();
      if (yt && typeof yt.seekTo === "function") {
        try {
          yt.seekTo(timeSeconds, true);
          return;
        } catch (_) {}
      }
      super.seek(timeSeconds);
    }

    setPlaybackRate(rate) {
      const yt = this._getYtPlayer();
      if (yt && typeof yt.setPlaybackRate === "function") {
        try {
          yt.setPlaybackRate(rate);
          return;
        } catch (_) {}
      }
      super.setPlaybackRate(rate);
    }

    getCapabilities() {
      return {
        seek: true,
        playbackRate: true,
        captureFrame: true,
        dualSubtitles: true
      };
    }
  }

  if (base.defaultPlayerRegistry) {
    base.defaultPlayerRegistry.register(YouTubePlayerAdapter);
  }

  return { YouTubePlayerAdapter };
});

