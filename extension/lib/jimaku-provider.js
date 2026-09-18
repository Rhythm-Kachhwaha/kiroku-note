/**
 * Kiroku Note - Jimaku Subtitle Provider
 * 
 * Optional external subtitle acquisition provider connecting to Jimaku.cc API.
 * Safely manages API keys (persisted in chrome.storage.local), executes
 * queries and downloads via background script message passing, and normalizes
 * subtitle tracks into standard Kiroku cues.
 */

(() => {
  const BaseSubtitleProvider = (typeof SubtitleProvider !== "undefined" && SubtitleProvider.BaseSubtitleProvider)
    ? SubtitleProvider.BaseSubtitleProvider
    : (typeof require !== "undefined" ? require("./subtitle-provider.js").BaseSubtitleProvider : class BaseSubtitleProvider {});

  function resolveJimakuUrl(url) {
    if (!url || typeof url !== "string") return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    const path = url.startsWith("/") ? url : `/${url}`;
    return `https://jimaku.cc${path}`;
  }

  class JimakuSubtitleProvider extends BaseSubtitleProvider {
    constructor({ parser, fetchFunction } = {}) {
      super("jimaku_search", "Jimaku Subtitles", "service");
      this.parser = parser || (typeof SubtitleParser !== "undefined" ? SubtitleParser : (globalThis.SubtitleParser || null));
      this.fetchFunction = fetchFunction || null;
      this.apiKey = "";
      this.activeTrackData = null;
    }

    setApiKey(key) {
      this.apiKey = typeof key === "string" ? key.trim() : "";
    }

    getApiKey() {
      return this.apiKey;
    }

    async loadSavedApiKey() {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const stored = await chrome.storage.local.get("jimaku_api_key");
          if (stored?.jimaku_api_key) {
            this.setApiKey(stored.jimaku_api_key);
          }
        } else if (typeof localStorage !== "undefined") {
          const stored = localStorage.getItem("jimaku_api_key");
          if (stored) this.setApiKey(stored);
        }
      } catch (_) {}
      return this.apiKey;
    }

    async isAvailable() {
      return Boolean(this.apiKey && this.apiKey.length > 0);
    }

    async _callApi(url) {
      if (!this.apiKey) {
        throw new Error("MISSING_API_KEY: Jimaku API key is required");
      }

      const targetUrl = resolveJimakuUrl(url);

      if (this.fetchFunction) {
        const res = await this.fetchFunction({ url: targetUrl, apiKey: this.apiKey });
        if (!res || res.ok === false) {
          throw new Error(res?.error || "API request failed");
        }
        return res;
      }

      // Route via Chrome runtime messaging to background script
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({
          type: "FETCH_JIMAKU_API",
          url: targetUrl,
          apiKey: this.apiKey
        });
        if (!response || response.ok === false) {
          throw new Error(response?.error || "Failed to communicate with Jimaku API");
        }
        return response;
      }

      // Fallback: direct fetch
      if (typeof fetch !== "undefined") {
        const res = await fetch(targetUrl, {
          headers: {
            "Authorization": this.apiKey,
            "Accept": "application/json, text/plain, text/vtt, text/x-ssa, */*"
          }
        });
        if (!res.ok) {
          if (res.status === 401) throw new Error("UNAUTHORIZED: Invalid Jimaku API key");
          if (res.status === 429) throw new Error("RATE_LIMITED: Jimaku API rate limit reached");
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await res.json();
          return { ok: true, data, isJson: true };
        } else {
          const text = await res.text();
          return { ok: true, text, isJson: false };
        }
      }

      throw new Error("No network transport available for Jimaku API");
    }

    async searchEntries(query) {
      if (!query || typeof query !== "string") return [];
      const trimmed = query.trim();
      if (!trimmed) return [];

      const url = `https://jimaku.cc/api/entries/search?query=${encodeURIComponent(trimmed)}`;
      const result = await this._callApi(url);
      if (result && Array.isArray(result.data)) {
        return result.data;
      }
      return [];
    }

    async getFilesForEntry(entryId) {
      if (!entryId) return [];
      const url = `https://jimaku.cc/api/entries/${entryId}/files`;
      const result = await this._callApi(url);
      if (result && Array.isArray(result.data)) {
        return result.data;
      }
      return [];
    }

    async downloadSubtitle(fileUrl, filename = "subtitles.ass") {
      if (!fileUrl) throw new Error("Download URL is required");

      const resolvedUrl = resolveJimakuUrl(fileUrl);
      const result = await this._callApi(resolvedUrl);
      const rawText = result.text || (typeof result.data === "string" ? result.data : JSON.stringify(result.data || ""));

      if (!this.parser) {
        throw new Error("SubtitleParser is not available");
      }

      const parsedCues = this.parser.parseSubtitles(rawText, filename);
      const normalizedCues = typeof this.parser.normalizeCues === "function"
        ? this.parser.normalizeCues(parsedCues)
        : parsedCues;

      const format = filename.toLowerCase().endsWith(".ass") ? "ass"
        : filename.toLowerCase().endsWith(".ssa") ? "ssa"
        : filename.toLowerCase().endsWith(".vtt") ? "vtt"
        : "srt";

      this.activeTrackData = {
        source: "jimaku_search",
        language: "ja",
        format,
        filename,
        rawText,
        cues: normalizedCues
      };

      return this.activeTrackData;
    }

    async getTracks() {
      if (!this.activeTrackData) return [];
      return [
        {
          id: this.activeTrackData.filename || "jimaku_active",
          name: `Jimaku: ${this.activeTrackData.filename || "Subtitles"} (${this.activeTrackData.cues.length} cues)`,
          languageCode: this.activeTrackData.language || "ja",
          providerId: this.id
        }
      ];
    }

    async loadTrack(trackId) {
      if (this.activeTrackData && (this.activeTrackData.filename === trackId || trackId === "jimaku_active")) {
        return this.activeTrackData;
      }
      return this.activeTrackData;
    }
  }

  const JimakuModule = {
    JimakuSubtitleProvider,
    resolveJimakuUrl
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = JimakuModule;
  } else {
    globalThis.JimakuProvider = JimakuModule;
  }
})();
