/**
 * Kiroku Note - Subtitle Acquisition & Provider Abstraction Layer
 * 
 * Defines standard interfaces for acquiring, normalizing, and managing
 * subtitle sources from local files, web streaming sites, and external databases.
 */

(() => {
  /**
   * Base class for all Subtitle Providers
   */
  class BaseSubtitleProvider {
    constructor(id, name, type = "custom") {
      this.id = id;
      this.name = name;
      this.type = type; // "site" | "file" | "service" | "custom"
    }

    async isAvailable() {
      return false;
    }

    async getTracks() {
      return [];
    }

    async loadTrack(_trackId) {
      throw new Error(`Not implemented in ${this.constructor.name}`);
    }
  }

  /**
   * Local File Subtitle Provider (.srt, .vtt, .ass, .ssa)
   */
  class LocalFileSubtitleProvider extends BaseSubtitleProvider {
    constructor({ parser } = {}) {
      super("local_file", "Local Subtitle File", "file");
      this.parser = parser || (typeof SubtitleParser !== "undefined" ? SubtitleParser : (globalThis.SubtitleParser || null));
      this.activeTrackData = null;
    }

    async isAvailable() {
      return true;
    }

    async loadFile(fileOrText, filename = "") {
      let text = "";
      let fname = filename;

      if (typeof fileOrText === "string") {
        text = fileOrText;
      } else if (fileOrText && typeof fileOrText.text === "function") {
        text = await fileOrText.text();
        fname = fname || fileOrText.name || "subtitles.srt";
      }

      if (!this.parser) {
        throw new Error("SubtitleParser is not available");
      }

      const parsedCues = this.parser.parseSubtitles(text, fname);
      const normalizedCues = typeof this.parser.normalizeCues === "function"
        ? this.parser.normalizeCues(parsedCues)
        : parsedCues;

      const format = fname.toLowerCase().endsWith(".ass") ? "ass"
        : fname.toLowerCase().endsWith(".ssa") ? "ssa"
        : fname.toLowerCase().endsWith(".vtt") ? "vtt"
        : "srt";

      this.activeTrackData = {
        source: "local_file",
        language: "ja",
        format,
        filename: fname,
        cues: normalizedCues
      };

      return this.activeTrackData;
    }

    async getTracks() {
      if (!this.activeTrackData) return [];
      return [
        {
          id: this.activeTrackData.filename || "local_file",
          name: `${this.activeTrackData.filename || "Local File"} (${this.activeTrackData.cues.length} cues)`,
          languageCode: this.activeTrackData.language || "ja",
          providerId: this.id
        }
      ];
    }

    async loadTrack(trackId) {
      if (this.activeTrackData && (this.activeTrackData.filename === trackId || trackId === "local_file")) {
        return this.activeTrackData;
      }
      return this.activeTrackData;
    }

    clear() {
      this.activeTrackData = null;
    }
  }

  /**
   * YouTube Captions Subtitle Provider
   */
  class YouTubeSubtitleProvider extends BaseSubtitleProvider {
    constructor({ parser, adapter, fetchFunction } = {}) {
      super("youtube_cc", "YouTube Captions", "site");
      this.parser = parser || (typeof SubtitleParser !== "undefined" ? SubtitleParser : (globalThis.SubtitleParser || null));
      this.adapter = adapter || (typeof YouTubeAdapter !== "undefined" ? YouTubeAdapter : (globalThis.YouTubeAdapter || null));
      this.fetchFunction = fetchFunction || null;
      this.tracks = [];
      this.activeTrack = null;
      this.loadedData = null;
    }

    async isAvailable() {
      if (typeof location === "undefined") return false;
      return location.hostname.includes("youtube.com");
    }

    setRawTracks(rawTracks) {
      if (!Array.isArray(rawTracks)) {
        this.tracks = [];
        return;
      }

      const ytMod = this.adapter || (typeof YouTubeAdapter !== "undefined" ? YouTubeAdapter : (globalThis.YouTubeAdapter || null));
      if (ytMod && typeof ytMod.prioritizeTracks === "function") {
        this.tracks = ytMod.prioritizeTracks(rawTracks);
      } else {
        this.tracks = rawTracks.map((t, idx) => ({
          id: String(idx),
          languageCode: t.languageCode || "unknown",
          name: t.name?.simpleText || t.name || t.languageCode || `Track ${idx + 1}`,
          baseUrl: t.baseUrl || "",
          srv3Url: t.srv3Url || t.baseUrl || "",
          isAuto: Boolean(t.isAuto)
        }));
      }
    }

    async getTracks() {
      return this.tracks.map((t, idx) => ({
        id: String(idx),
        name: t.name || t.languageCode || `Track ${idx + 1}`,
        languageCode: t.languageCode || "unknown",
        isAuto: Boolean(t.isAuto),
        providerId: this.id
      }));
    }

    async loadTrack(trackId) {
      const idx = parseInt(trackId, 10);
      const track = this.tracks[idx];
      if (!track) {
        throw new Error(`YouTube track not found at index ${trackId}`);
      }
      this.activeTrack = track;

      const targetUrl = track.srv3Url || track.baseUrl;
      let rawText = "";

      if (this.fetchFunction) {
        rawText = await this.fetchFunction(targetUrl);
      } else {
        const ytMod = typeof YouTubeAdapter !== "undefined" ? YouTubeAdapter : (globalThis.YouTubeAdapter || null);
        if (ytMod && typeof ytMod.fetchCaptionSRV3 === "function") {
          rawText = await ytMod.fetchCaptionSRV3(targetUrl);
        } else if (typeof fetch !== "undefined") {
          const res = await fetch(targetUrl);
          if (res.ok) rawText = await res.text();
        }
      }

      if (!this.parser) {
        throw new Error("SubtitleParser is not available");
      }

      const parsedCues = this.parser.parseSubtitles(rawText, "srv3");
      const normalizedCues = typeof this.parser.normalizeCues === "function"
        ? this.parser.normalizeCues(parsedCues)
        : parsedCues;

      this.loadedData = {
        source: "youtube_cc",
        language: track.languageCode || "ja",
        format: "srv3",
        filename: `YouTube CC (${track.name || track.languageCode})`,
        cues: normalizedCues
      };

      return this.loadedData;
    }
  }

  /**
   * Netflix Live Subtitles Provider
   */
  class NetflixSubtitleProvider extends BaseSubtitleProvider {
    constructor() {
      super("netflix_live", "Netflix Live Subtitles", "site");
    }

    async isAvailable() {
      if (typeof location === "undefined") return false;
      return location.hostname.includes("netflix.com");
    }

    async getTracks() {
      if (!(await this.isAvailable())) return [];
      return [
        {
          id: "live",
          name: "Japanese Subtitles (Live DOM)",
          languageCode: "ja",
          providerId: this.id
        }
      ];
    }

    async loadTrack(_trackId) {
      return {
        source: "netflix_live",
        language: "ja",
        format: "live",
        filename: "Netflix Subtitles (Live)",
        cues: []
      };
    }
  }

  /**
   * Subtitle Provider Registry
   */
  class SubtitleProviderRegistry {
    constructor() {
      this.providers = new Map();
      this.activeTrackInfo = null;
    }

    registerProvider(provider) {
      if (!provider || !provider.id) return;
      this.providers.set(provider.id, provider);
    }

    getProvider(id) {
      return this.providers.get(id) || null;
    }

    getAllProviders() {
      return Array.from(this.providers.values());
    }

    async getAvailableProviders() {
      const available = [];
      for (const provider of this.providers.values()) {
        if (await provider.isAvailable()) {
          available.push(provider);
        }
      }
      return available;
    }

    async getAllAvailableTracks() {
      const allTracks = [];
      for (const provider of this.providers.values()) {
        try {
          if (await provider.isAvailable()) {
            const tracks = await provider.getTracks();
            if (Array.isArray(tracks)) {
              for (const t of tracks) {
                allTracks.push({
                  ...t,
                  providerId: provider.id,
                  providerName: provider.name
                });
              }
            }
          }
        } catch (_) {}
      }
      return allTracks;
    }

    async loadTrack(providerId, trackId) {
      const provider = this.getProvider(providerId);
      if (!provider) {
        throw new Error(`Provider not found: ${providerId}`);
      }
      const data = await provider.loadTrack(trackId);
      this.activeTrackInfo = { providerId, trackId, data };
      return data;
    }
  }

  const SubtitleProviderModule = {
    BaseSubtitleProvider,
    LocalFileSubtitleProvider,
    YouTubeSubtitleProvider,
    NetflixSubtitleProvider,
    SubtitleProviderRegistry
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SubtitleProviderModule;
  } else {
    globalThis.SubtitleProvider = SubtitleProviderModule;
  }
})();
