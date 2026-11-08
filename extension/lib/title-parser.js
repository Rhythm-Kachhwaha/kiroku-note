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
    // Site name prefixes
    text = text.replace(/^(?:Crunchyroll|Bilibili|Netflix|HiAnime|Zoro|Aniwatch|Gogoanime|9anime|KickAssAnime)\s*[-|–—:]\s*/i, "");
    // Release groups: [SubsPlease], [Erai-raws], [HorribleSubs], [Judas], etc.
    text = text.replace(/^\[[^\]]+\]\s*/g, "");

    // Suffix site watermarks and quality tags
    text = text.replace(/\s*(?:online\s+)?(?:Free\s+)?on\s+(?:HiAnime|HiAnime\.to|Crunchyroll|Bilibili|Zoro|Gogoanime|9anime).*$/i, "");
    text = text.replace(/\s*[-|–—:]\s*(?:Watch\s+on\s+)?(?:Crunchyroll|Bilibili|Netflix|HiAnime|YouTube).*$/i, "");
    text = text.replace(/\s*\|\s*.*$/, ""); // trailing pipes like "| Crunchyroll"
    text = text.replace(/\s*(?:\[|\()?(?:English\s+Sub(?:\/Dub)?|Eng\s+Sub|Sub\/Dub|Dual\s+Audio|Dub)(?:\]|\))?/gi, "");
    text = text.replace(/\s*\[(?:1080p|720p|480p|Web-DL|WEBRip|Bluray|BD|Netflix|Crunchyroll)[^\]]*\]/gi, "");
    text = text.replace(/\s*\((?:1080p|720p|480p|Web-DL|WEBRip|Bluray|BD|TV)\)/gi, "");
    text = text.replace(/\s*\[[0-9a-fA-F]{8}\]/g, ""); // CRC32 hashes like [ABCD1234]

    let episode = null;
    let episodeTitle = "";

    // 2. Identify episode patterns
    // Pattern A: "Episode 1085", "Ep. 2", "Ep 11", "E05", "E2"
    const epWordMatch = text.match(/\b(?:Episode|Ep\.?|E)\s*(\d+)(?:\s*[-–—:]\s*(.*))?$/i);
    if (epWordMatch) {
      episode = parseInt(epWordMatch[1], 10);
      if (epWordMatch[2]) {
        episodeTitle = epWordMatch[2].trim();
      }
      text = text.substring(0, epWordMatch.index).trim();
    } else {
      // Pattern B: "Show Name - 03" or "Show Name - 138"
      const dashNumMatch = text.match(/\s*[-–—]\s*(\d{1,4})(?:\s*\(\d+\))?(?:\s*[-–—:]\s*(.*))?$/);
      if (dashNumMatch) {
        episode = parseInt(dashNumMatch[1], 10);
        if (dashNumMatch[2]) {
          episodeTitle = dashNumMatch[2].trim();
        }
        text = text.substring(0, dashNumMatch.index).trim();
      } else {
        // Pattern C: URL fallback if episode wasn't found in title
        if (url && typeof url === "string") {
          const urlEpMatch = url.match(/[?&/](?:ep|episode|e)[=/-]?(\d+)/i) || url.match(/-(\d+)(?:[#?].*)?$/);
          if (urlEpMatch) {
            episode = parseInt(urlEpMatch[1], 10);
          }
        }
      }
    }

    // Clean up residual dashes/colons on show title
    text = text.replace(/\s*[-–—:]\s*$/, "").trim();

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

  const TitleParser = {
    cleanAnimeTitle,
    parseAnimeTitleAndEpisode: cleanAnimeTitle,
    hashTitleKey
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = TitleParser;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.TitleParser = TitleParser;
  }
})();
