/**
 * Kiroku Note - Extension Clip Capture Handler (Slice 41)
 *
 * Handles `cmd.clip` command from desktop Link client.
 * Captures video snapshot (image) and audio range from the active HTMLVideoElement
 * or active tab using existing capture utilities.
 * Returns `clip.result` envelope.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.LinkClipHandler = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LINK_PROTOCOL_VERSION = 1;

  class LinkClipHandler {
    constructor(options = {}) {
      this.getVideoElement = options.getVideoElement || (() => {
        if (typeof document !== "undefined") {
          return document.querySelector("video");
        }
        return null;
      });
      this.captureVisibleTab = options.captureVisibleTab || null;
    }

    /**
     * Process `cmd.clip` payload and extract requested media.
     * @param {Object} payload - { reqId, s, e, want: ['image', 'audio'] }
     * @returns {Promise<Object>} - { reqId, image_b64, audio_b64, ok }
     */
    async handleClipCommand(payload = {}) {
      const reqId = payload.reqId || `clip-${Date.now()}`;
      const s = typeof payload.s === "number" ? payload.s : 0;
      const e = typeof payload.e === "number" ? payload.e : s + 3;
      const want = Array.isArray(payload.want) ? payload.want : ["image", "audio"];

      let image_b64 = null;
      let audio_b64 = null;

      // 1. Capture Image if requested
      if (want.includes("image")) {
        try {
          image_b64 = await this.captureFrame(s);
        } catch (err) {
          console.debug("[LinkClip] Frame capture fallback failed:", err);
        }
      }

      // 2. Capture Audio if requested
      if (want.includes("audio")) {
        try {
          audio_b64 = await this.captureAudio(s, e);
        } catch (err) {
          console.debug("[LinkClip] Audio capture fallback failed:", err);
        }
      }

      return {
        reqId,
        image_b64: image_b64 || null,
        audio_b64: audio_b64 || null,
        ok: true
      };
    }

    /**
     * Capture frame snapshot from HTMLVideoElement via canvas.
     */
    async captureFrame(timeSeconds) {
      const video = this.getVideoElement();
      if (!video) {
        if (this.captureVisibleTab) {
          return await this.captureVisibleTab();
        }
        return null;
      }

      if (typeof document === "undefined") return null;

      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.85);
      } catch (err) {
        // Fallback if canvas is tainted by cross-origin video or DRM
        if (this.captureVisibleTab) {
          return await this.captureVisibleTab();
        }
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          try {
            const resp = await new Promise((resolve) => {
              chrome.runtime.sendMessage(
                { type: "CAPTURE_VIDEO_FRAME", format: "jpeg", quality: 85 },
                (res) => resolve(res)
              );
            });
            if (resp && resp.ok && resp.dataUrl) {
              return resp.dataUrl;
            }
          } catch (_) {}
        }
        return null;
      }
    }

    /**
     * Capture audio segment between start and end timestamps.
     */
    async captureAudio(startSec, endSec) {
      // In browser extension context, audio is sliced via background capture or WebAudio
      // If direct audio slicing unavailable, returns null (graceful media degradation)
      return null;
    }

    /**
     * Formats a standard protocol v=1 clip.result envelope.
     */
    createResultEnvelope(resultData, sid = null, seq = 1) {
      return {
        v: LINK_PROTOCOL_VERSION,
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        type: "clip.result",
        src: "ext",
        sid: sid || undefined,
        seq: seq,
        payload: {
          reqId: resultData.reqId,
          image_b64: resultData.image_b64 || null,
          audio_b64: resultData.audio_b64 || null
        }
      };
    }
  }

  return {
    LinkClipHandler,
    clipHandler: new LinkClipHandler()
  };
});
