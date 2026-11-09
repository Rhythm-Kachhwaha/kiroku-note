/**
 * Kiroku Note - HTML5 Generic Player Adapter
 */

(function (root, factory) {
  const exports = factory(
    typeof require === "function" ? require("./player-adapter.js") : { PlayerAdapter: root.PlayerAdapter, defaultPlayerRegistry: root.defaultPlayerRegistry }
  );
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.HTML5PlayerAdapter = exports.HTML5PlayerAdapter;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (base) {
  "use strict";

  const PlayerAdapter = base.PlayerAdapter;

  class HTML5PlayerAdapter extends PlayerAdapter {
    static detect(video) {
      return Boolean(video && video.tagName === "VIDEO");
    }

    getCapabilities() {
      return {
        seek: true,
        playbackRate: true,
        captureFrame: true,
        dualSubtitles: false
      };
    }
  }

  if (base.defaultPlayerRegistry) {
    base.defaultPlayerRegistry.register(HTML5PlayerAdapter);
  }

  return { HTML5PlayerAdapter };
});
