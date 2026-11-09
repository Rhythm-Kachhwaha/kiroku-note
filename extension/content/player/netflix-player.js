/**
 * Kiroku Note - Netflix Player Adapter
 */

(function (root, factory) {
  const exports = factory(
    typeof require === "function" ? require("./player-adapter.js") : { PlayerAdapter: root.PlayerAdapter, defaultPlayerRegistry: root.defaultPlayerRegistry }
  );
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.NetflixPlayerAdapter = exports.NetflixPlayerAdapter;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (base) {
  "use strict";

  const PlayerAdapter = base.PlayerAdapter;

  class NetflixPlayerAdapter extends PlayerAdapter {
    static detect(video) {
      if (typeof location !== "undefined" && location.hostname && location.hostname.includes("netflix.com")) {
        return Boolean(video);
      }
      return Boolean(video && (video.closest?.(".watch-video") || video.closest?.(".AkiraPlayer")));
    }

    getCapabilities() {
      // Seek capability is false until proven safe/working in Netflix sandbox
      return {
        seek: false,
        playbackRate: false,
        captureFrame: true,
        dualSubtitles: true
      };
    }

    seek(timeSeconds) {
      // Netflix uses custom streaming engine; direct video.currentTime mutation usually desyncs or fails
      // Keep disabled as per capability spec
    }
  }

  if (base.defaultPlayerRegistry) {
    base.defaultPlayerRegistry.register(NetflixPlayerAdapter);
  }

  return { NetflixPlayerAdapter };
});

