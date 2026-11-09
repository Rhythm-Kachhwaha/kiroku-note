/**
 * Kiroku Note - Extension Clip Capture Handler (G4 update)
 *
 * Captures video snapshot (image) and audio range from HTMLVideoElement / active tab.
 * Never reports success without non-empty dataUrl.
 * captureAudio returns { ok: false, reason: "NOT_SUPPORTED" }.
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
     * Process clip payload and extract requested media.
     * @param {Object} payload - { reqId, s, e, want: ['image', 'audio'] }
     * @returns {Promise<Object>} - { reqId, image_b64, audio_b64, ok, error }
     */
    async handleClipCommand(payload = {}) {
      const reqId = payload.reqId || `clip-${Date.now()}`;
      const s = typeof payload.s === "number" ? payload.s : 0;
      const e = typeof payload.e === "number" ? payload.e : s + 3;
      const want = Array.isArray(payload.want) ? payload.want : ["image", "audio"];

      let image_b64 = null;
      let audio_b64 = null;
      let captureError = null;

      // 1. Capture Image if requested
      if (want.includes("image")) {
        const frameRes = await this.captureFrame(s);
        if (frameRes.ok && frameRes.dataUrl) {
          image_b64 = frameRes.dataUrl;
        } else {
          captureError = frameRes.reason || "FRAME_CAPTURE_FAILED";
        }
      }

      // 2. Capture Audio if requested
      if (want.includes("audio")) {
        const audioRes = await this.captureAudio(s, e);
        if (audioRes.ok && audioRes.dataUrl) {
          audio_b64 = audioRes.dataUrl;
        }
      }

      const isOk = want.includes("image") ? Boolean(image_b64) : true;

      return {
        reqId,
        image_b64: image_b64 || null,
        audio_b64: audio_b64 || null,
        ok: isOk,
        ...(captureError && !isOk ? { error: captureError } : {})
      };
    }

    /**
     * Capture frame snapshot from HTMLVideoElement via canvas.
     * Guaranteed contract: { ok: boolean, dataUrl?: string, reason?: string }
     */
    async captureFrame(timeSeconds) {
      const video = this.getVideoElement();
      if (!video) {
        if (this.captureVisibleTab) {
          try {
            const dataUrl = await this.captureVisibleTab();
            if (dataUrl && typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
              return { ok: true, dataUrl };
            }
            return { ok: false, reason: "EMPTY_CAPTURE_RESULT" };
          } catch (err) {
            return { ok: false, reason: err?.message || "CAPTURE_VISIBLE_TAB_FAILED" };
          }
        }
        return { ok: false, reason: "NO_VIDEO_ELEMENT" };
      }

      if (typeof document === "undefined") {
        return { ok: false, reason: "NO_DOCUMENT_ENVIRONMENT" };
      }

      try {
        const canvas = document.createElement("canvas");
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 360;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return { ok: false, reason: "CANVAS_CONTEXT_UNAVAILABLE" };
        }

        ctx.drawImage(video, 0, 0, width, height);

        // Security check for tainted canvas
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        if (dataUrl && typeof dataUrl === "string" && dataUrl.length > 30) {
          return { ok: true, dataUrl };
        }
        return { ok: false, reason: "EMPTY_DATA_URL" };
      } catch (err) {
        // Fallback if canvas is tainted by cross-origin video or DRM
        if (this.captureVisibleTab) {
          try {
            const dataUrl = await this.captureVisibleTab();
            if (dataUrl && typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
              return { ok: true, dataUrl };
            }
            return { ok: false, reason: "EMPTY_CAPTURE_RESULT" };
          } catch (fallbackErr) {
            return { ok: false, reason: fallbackErr?.message || "CANVAS_TAINTED_AND_FALLBACK_FAILED" };
          }
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
              return { ok: true, dataUrl: resp.dataUrl };
            }
            return { ok: false, reason: resp?.error || "BACKGROUND_CAPTURE_FAILED" };
          } catch (bgErr) {
            return { ok: false, reason: bgErr?.message || "BACKGROUND_MESSAGE_FAILED" };
          }
        }

        return { ok: false, reason: err?.message || "CANVAS_TAINTED" };
      }
    }

    /**
     * Capture audio segment between start and end timestamps.
     * Guaranteed contract: { ok: false, reason: string }
     */
    async captureAudio(startSec, endSec) {
      // Audio capture is explicitly not supported in this release
      return {
        ok: false,
        reason: "AUDIO_CAPTURE_NOT_SUPPORTED"
      };
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
          audio_b64: resultData.audio_b64 || null,
          ok: Boolean(resultData.ok)
        }
      };
    }
  }

  return {
    LinkClipHandler,
    clipHandler: new LinkClipHandler()
  };
});
