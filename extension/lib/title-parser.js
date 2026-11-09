/**
 * Kiroku Note - Anime Title and Episode Parser (Slice A7)
 * 
 * Accurately extracts canonical anime show title, episode number, and optional episode subtitle
 * from messy web page titles, streaming platform headers, filenames, and URLs.
 */

(() => {
  function cleanAnimeTitle(rawTitle, url = "") {
    if (!rawTitle || typeof rawTitle !== "string") return { title: "", episode: null };

    let text = rawTitle.trim();

    // 1. Strip common streaming site wrappers and prefixes/suffixes
    // Prefix patterns like "Watch Attack on Titan..."
    text = text.replace(/^Watch\s+/i, "");
    // Official video tags: 【公式】, 【予告】, 【PV】, etc.
    text = text.replace(/^【(?:公式|PV|予告|本編)】\s*/, "");
    // Site name prefixes
    text = text.replace(/^(?:Crunchyroll|Bilibili|Netflix|HiAnime|Zoro|Aniwatch|Gogoanime|9anime|KickAssAnime)\s*[-|–—:]\s*/i, "");
    // Release groups: [SubsPlease], [Erai-raws], [HorribleSubs], [Judas], etc.
    text = text.replace(/^\[[^\]]+\]\s*/g, "");

    // Suffix site watermarks and quality tags
    text = text.replace(/\s*(?:online\s+)?(?:Free\s+)?on\s+(?:HiAnime|HiAnime\.to|Crunchyroll|Bilibili|Zoro|Gogoanime|9anime).*$/i, "");
    text = text.replace(/\s*[-|–—:]\s*(?:Watch\s+on\s+)?(?:Crunchyroll|Bilibili|Netflix|HiAnime|YouTube).*$/i, "");
    text = text.replace(/\s*\|\s*.*$/, ""); // trailing pipes like "| Crunchyroll"
    text = text.replace(/\s*[\(\[]?\s*(?:English\s+Sub(?:\/Dub)?|English\s+Dub|Eng\s+Sub|Sub\/Dub|Dual\s+Audio|Dub|Sub)\s*[\)\]]?/gi, "");
    text = text.replace(/\s*(?:online\s+free|watch\s+online|free\s+online|online)(?:\s*[-|–—:]|\s*$)/gi, "");
    text = text.replace(/\s*\[(?:1080p|720p|480p|Web-DL|WEBRip|Bluray|BD|Netflix|Crunchyroll)[^\]]*\]/gi, "");
    text = text.replace(/\s*\((?:1080p|720p|480p|Web-DL|WEBRip|Bluray|BD|TV)\)/gi, "");
    text = text.replace(/\s*\[[0-9a-fA-F]{8}\]/g, ""); // CRC32 hashes like [ABCD1234]

    let episode = null;
    let episodeTitle = "";

    // 2. Identify episode patterns
    // Pattern A: Japanese episode notation: "第11話", "第51話「タイトル」"
    const jpEpMatch = text.match(/\s*(?:[-–—:]\s*)?第\s*(\d{1,4})\s*[話回](?:\s*[「『](.*?)[」』]|\s*[-–—:]\s*(.*))?$/);
    if (jpEpMatch) {
      episode = parseInt(jpEpMatch[1], 10);
      episodeTitle = (jpEpMatch[2] || jpEpMatch[3] || "").trim();
      text = text.substring(0, jpEpMatch.index).trim();
    } else {
      // Pattern B: Hash notation: "#12", "#05"
      const hashEpMatch = text.match(/\s*(?:[-–—:]\s*)?#\s*(\d{1,4})(?:\s*[-–—:]\s*(.*))?$/);
      if (hashEpMatch) {
        episode = parseInt(hashEpMatch[1], 10);
        if (hashEpMatch[2]) episodeTitle = hashEpMatch[2].trim();
        text = text.substring(0, hashEpMatch.index).trim();
      } else {
        // Pattern C: "Episode 1085", "Ep. 2", "Ep 11", "E05", "E2", "S02E05", "S2E5"
        const epWordMatch = text.match(/(?:\b(?:Episode|Ep\.?)|(?:^|[\s\-_]|S\d+)E)\s*(\d+)(?:\s*[-–—:]\s*(.*))?$/i);
        if (epWordMatch) {
          episode = parseInt(epWordMatch[1], 10);
          if (epWordMatch[2]) {
            episodeTitle = epWordMatch[2].trim();
          }
          text = text.substring(0, epWordMatch.index).trim();
        } else {
          // Pattern D: "Show Name - 03" or "Show Name - 138"
          const dashNumMatch = text.match(/\s*[-–—]\s*(\d{1,4})(?:\s*\(\d+\))?(?:\s*[-–—:]\s*(.*))?$/);
          if (dashNumMatch) {
            episode = parseInt(dashNumMatch[1], 10);
            if (dashNumMatch[2]) {
              episodeTitle = dashNumMatch[2].trim();
            }
            text = text.substring(0, dashNumMatch.index).trim();
          } else {
            // Pattern E: URL fallback if episode wasn't found in title
            if (url && typeof url === "string") {
              const urlEpMatch = url.match(/[?&/](?:ep|episode|e)[=/-]?(\d+)(?:[&/?#]|$)/i) ||
                                 url.match(/\/episode-(\d+)/i) ||
                                 url.match(/-ep-(\d+)/i);
              if (urlEpMatch) {
                episode = parseInt(urlEpMatch[1], 10);
              }
            }
          }
        }
      }
    }

    // Clean up residual dashes/colons/commas on show title
    text = text.replace(/\s*[-–—:,]\s*$/, "").trim();

    return {
      title: text,
      episode: typeof episode === "number" && !isNaN(episode) ? episode : null,
      episodeTitle: episodeTitle || ""
    };
  }

  function hashTitleKey(site, title) {
    const cleanSite = (site || "unknown").toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanShow = (title || "unknown").toLowerCase().trim();
    let h = 0x811c9dc5;
    for (let i = 0; i < cleanShow.length; i++) {
      h = (h ^ cleanShow.charCodeAt(i)) * 0x01000193;
      h = h >>> 0;
    }
    const hashStr = h.toString(16).padStart(8, "0");
    return `kiroku.sub_choice.${cleanSite}.${hashStr}`;
  }

  function slugify(text) {
    if (!text || typeof text !== "string") return "";
    return text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // strip diacritics
      .replace(/['"’‘`]/g, "") // strip apostrophes and quotes
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /**
   * Episode identity contract (Section B):
   * Format: {providerSlug}/{seriesId}/{episodeId}
   * providerSlug: crunchyroll | netflix | youtube | hidive | amazon | generic
   */
  function parseEpisodeKey(url = "", titleText = "") {
    const rawUrl = typeof url === "string" ? url.trim() : "";
    const rawTitle = typeof titleText === "string" ? titleText.trim() : "";

    let providerSlug = "generic";
    let seriesId = "";
    let episodeId = "";

    let parsedUrl = null;
    try {
      if (rawUrl) {
        parsedUrl = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
      }
    } catch (_) {
      parsedUrl = null;
    }

    const host = (parsedUrl?.hostname || "").toLowerCase();
    const pathname = parsedUrl?.pathname || "";
    const searchParams = parsedUrl?.searchParams;

    // 1. Identify provider
    if (host.includes("crunchyroll.com")) {
      providerSlug = "crunchyroll";
    } else if (host.includes("netflix.com")) {
      providerSlug = "netflix";
    } else if (host.includes("youtube.com") || host.includes("youtu.be")) {
      providerSlug = "youtube";
    } else if (host.includes("hidive.com")) {
      providerSlug = "hidive";
    } else if (host.includes("amazon.") || host.includes("primevideo.com")) {
      providerSlug = "amazon";
    } else {
      providerSlug = "generic";
    }

    // 2. Provider-specific extraction
    if (providerSlug === "crunchyroll") {
      // crunchyroll.com/watch/{episodeId}/{title-slug} or /series/{seriesId}/...
      const watchMatch = pathname.match(/\/watch\/([a-zA-Z0-9]+)(?:\/([^\/?#]+))?/i);
      const seriesMatch = pathname.match(/\/series\/([a-zA-Z0-9]+)/i);
      if (watchMatch) {
        episodeId = watchMatch[1];
        if (watchMatch[2]) {
          seriesId = slugify(watchMatch[2]);
        }
      } else if (seriesMatch) {
        seriesId = seriesMatch[1];
      }
    } else if (providerSlug === "netflix") {
      // netflix.com/watch/{episodeId}?trackId=...
      const netflixMatch = pathname.match(/\/watch\/(\d+)/i);
      if (netflixMatch) {
        episodeId = netflixMatch[1];
      }
      const titleMatch = pathname.match(/\/title\/(\d+)/i);
      if (titleMatch) {
        seriesId = titleMatch[1];
      }
    } else if (providerSlug === "youtube") {
      // youtube.com/watch?v={id} or youtu.be/{id}
      let v = searchParams?.get("v");
      if (!v && host.includes("youtu.be")) {
        v = pathname.replace(/^\/+/, "").split("/")[0];
      }
      if (v) {
        seriesId = v;
        episodeId = "unknown";
      }
    } else if (providerSlug === "hidive") {
      // hidive.com/stream/{series-name}/s{season}e{episode} or /stream/{series-id}/{ep-id}
      const streamMatch = pathname.match(/\/stream\/([^\/?#]+)\/([^\/?#]+)/i);
      if (streamMatch) {
        seriesId = slugify(streamMatch[1]);
        episodeId = slugify(streamMatch[2]);
      }
    } else if (providerSlug === "amazon") {
      // primevideo.com/detail/{titleId} or /gp/video/detail/{titleId}
      const amzMatch = pathname.match(/\/(?:gp\/video\/detail|detail)\/([a-zA-Z0-9]+)/i);
      if (amzMatch) {
        seriesId = amzMatch[1];
      }
    }

    // Fallbacks using cleanAnimeTitle
    const cleaned = cleanAnimeTitle(rawTitle, rawUrl);
    if (!seriesId && cleaned.title) {
      seriesId = slugify(cleaned.title);
    }

    if (!episodeId) {
      if (typeof cleaned.episode === "number" && !isNaN(cleaned.episode)) {
        episodeId = `ep${cleaned.episode}`;
      } else {
        // Try to match s1e3 or ep12 in URL if any
        const epUrlMatch = pathname.match(/(?:s(\d+)e(\d+)|(?:ep|episode)[-_]?(\d+))/i);
        if (epUrlMatch) {
          if (epUrlMatch[1] && epUrlMatch[2]) {
            episodeId = `s${parseInt(epUrlMatch[1], 10)}e${parseInt(epUrlMatch[2], 10)}`;
          } else if (epUrlMatch[3]) {
            episodeId = `ep${parseInt(epUrlMatch[3], 10)}`;
          }
        }
      }
    }

    // Final fallback checks per contract
    if (!seriesId) seriesId = "unknown";
    if (!episodeId) episodeId = "unknown";

    if (seriesId === "unknown" && episodeId === "unknown" && providerSlug === "generic") {
      console.warn?.("[TitleParser] Could not compute episodeKey, falling back to generic/unknown/unknown");
      return "generic/unknown/unknown";
    }

    return `${providerSlug}/${seriesId}/${episodeId}`;
  }

  const TitleParser = {
    cleanAnimeTitle,
    parseAnimeTitleAndEpisode: cleanAnimeTitle,
    hashTitleKey,
    parseEpisodeKey,
    slugify
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = TitleParser;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.TitleParser = TitleParser;
  }
})();
