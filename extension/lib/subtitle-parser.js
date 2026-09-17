/**
 * Kiroku Note - Subtitle Parser
 * 
 * Standalone client-side parser for SRT (SubRip) and WebVTT subtitle formats.
 * Normalizes all cues into:
 * {
 *   id: number,
 *   startTime: number, // seconds (float)
 *   endTime: number,   // seconds (float)
 *   text: string       // cleaned subtitle string
 * }
 */

(() => {
  function stripHtmlTags(str) {
    if (!str) return "";
    return str
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .trim();
  }

  /**
   * Parse timestamp string to seconds
   * Supports:
   * - 00:01:20,500 (SRT standard)
   * - 00:01:20.500 (VTT standard)
   * - 01:20.500 (VTT short form)
   */
  function parseTimestamp(timeStr) {
    if (!timeStr) return null;
    const cleanStr = timeStr.trim().replace(",", ".");
    const parts = cleanStr.split(":");
    if (parts.length === 3) {
      const hours = parseFloat(parts[0]);
      const minutes = parseFloat(parts[1]);
      const seconds = parseFloat(parts[2]);
      if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return null;
      return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
      const minutes = parseFloat(parts[0]);
      const seconds = parseFloat(parts[1]);
      if (isNaN(minutes) || isNaN(seconds)) return null;
      return minutes * 60 + seconds;
    }
    return null;
  }

  /**
   * Parse SRT format subtitle text
   */
  function parseSRT(rawText) {
    if (!rawText || typeof rawText !== "string") return [];
    
    // Normalize newlines
    const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!normalized) return [];

    const blocks = normalized.split(/\n\n+/);
    const cues = [];
    let defaultId = 1;

    for (const block of blocks) {
      const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;

      let timeLineIdx = 0;
      let cueId = defaultId;

      // Check if first line is a numeric cue index
      if (/^\d+$/.test(lines[0])) {
        cueId = parseInt(lines[0], 10);
        timeLineIdx = 1;
      }

      if (timeLineIdx >= lines.length) continue;

      const timeLine = lines[timeLineIdx];
      const match = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})/);
      if (!match) continue;

      const startTime = parseTimestamp(match[1]);
      const endTime = parseTimestamp(match[2]);

      if (startTime === null || endTime === null || startTime > endTime) continue;

      const textLines = lines.slice(timeLineIdx + 1);
      const text = stripHtmlTags(textLines.join("\n"));
      if (!text) continue;

      cues.push({
        id: cueId,
        startTime,
        endTime,
        text
      });
      defaultId++;
    }

    return cues;
  }

  /**
   * Parse WebVTT format subtitle text
   */
  function parseVTT(rawText) {
    if (!rawText || typeof rawText !== "string") return [];

    const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!normalized) return [];

    const blocks = normalized.split(/\n\n+/);
    const cues = [];
    let defaultId = 1;

    for (const block of blocks) {
      const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      // Skip initial WEBVTT / NOTE / STYLE header line(s)
      if (lines[0].startsWith("WEBVTT") || lines[0].startsWith("NOTE") || lines[0].startsWith("STYLE")) {
        lines.shift();
        if (lines.length === 0) continue;
      }

      let timeLineIdx = 0;
      let cueId = defaultId;

      // If first line does not contain '-->', it might be a cue identifier
      if (!lines[0].includes("-->")) {
        cueId = isNaN(parseInt(lines[0], 10)) ? defaultId : parseInt(lines[0], 10);
        timeLineIdx = 1;
      }

      if (timeLineIdx >= lines.length) continue;

      const timeLine = lines[timeLineIdx];
      const match = timeLine.match(/((?:\d{1,2}:)?\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[,\.]\d{1,3})/);
      if (!match) continue;

      const startTime = parseTimestamp(match[1]);
      const endTime = parseTimestamp(match[2]);

      if (startTime === null || endTime === null || startTime > endTime) continue;

      const textLines = lines.slice(timeLineIdx + 1);
      const text = stripHtmlTags(textLines.join("\n"));
      if (!text) continue;

      cues.push({
        id: cueId,
        startTime,
        endTime,
        text
      });
      defaultId++;
    }

    return cues;
  }

  /**
   * Calculate a sensible display duration for a subtitle cue based on text length
   * and optional <s> tag offsets, preventing cues from lingering across silence until the next sub.
   */
  function calculateSensibleDuration(text, explicitDurationMs, sTags = null) {
    if (!text) return 0;

    // 1. If child <s> tags with timestamps exist (YouTube SRV3 format):
    if (sTags && sTags.length > 0) {
      let maxSOffsetMs = 0;
      let lastSTextLen = 0;
      for (let i = 0; i < sTags.length; i++) {
        const s = sTags[i];
        const tVal = s.getAttribute ? s.getAttribute("t") : null;
        if (tVal !== null) {
          const off = parseFloat(tVal);
          if (!isNaN(off) && off >= maxSOffsetMs) {
            maxSOffsetMs = off;
            lastSTextLen = (s.textContent || "").trim().length;
          }
        }
      }
      if (maxSOffsetMs > 0) {
        // Last word duration (~200ms per char, min 400ms) + 1000ms comfortable post-speech reading buffer
        const lastWordDur = Math.max(400, lastSTextLen * 200);
        const speechEndEstimateMs = maxSOffsetMs + lastWordDur + 1000;
        if (typeof explicitDurationMs === "number" && !isNaN(explicitDurationMs) && explicitDurationMs > 0) {
          return Math.min(explicitDurationMs, speechEndEstimateMs);
        }
        return speechEndEstimateMs;
      }
    }

    // 2. Character-based sensible duration calculation
    let cjkCount = 0;
    let otherCount = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      // CJK Unified Ideographs, Hiragana, Katakana, Hangul, CJK symbols
      if ((code >= 0x3000 && code <= 0x9FFF) || (code >= 0xAC00 && code <= 0xD7AF) || (code >= 0xFF00 && code <= 0xFFEF)) {
        cjkCount++;
      } else if (!/\s/.test(text[i])) {
        otherCount++;
      }
    }

    // Base time: 1.8s for fast reading of short cues ("はい", "OK", "Yes")
    // CJK characters: ~0.28s per char
    // Non-CJK characters: ~0.08s per char
    const textReadingDurationSeconds = 1.8 + (cjkCount * 0.28) + (otherCount * 0.08);
    // Standard subtitle display ceiling is 6.5s (max 7.0s with buffer)
    const maxSensibleSeconds = Math.min(7.0, Math.max(2.0, textReadingDurationSeconds + 0.8));
    const maxSensibleMs = Math.round(maxSensibleSeconds * 1000);

    if (typeof explicitDurationMs === "number" && !isNaN(explicitDurationMs) && explicitDurationMs > 0) {
      // If the explicit duration is excessively large (e.g. YouTube ASR spanning silence until next line),
      // clamp to maxSensibleMs. If within sensible limits, preserve it.
      return Math.min(explicitDurationMs, maxSensibleMs);
    }

    return maxSensibleMs;
  }

  /**
   * Parse YouTube JSON3 transcript format
   */
  function parseYouTubeJson3(rawText) {
    if (!rawText || typeof rawText !== "string") return [];
    try {
      const data = typeof rawText === "object" ? rawText : JSON.parse(rawText);
      const events = Array.isArray(data?.events) ? data.events : [];
      const cues = [];
      let defaultId = 1;

      for (const ev of events) {
        if (typeof ev.tStartMs !== "number") continue;
        const startTime = +(ev.tStartMs / 1000).toFixed(3);
        const rawDurMs = typeof ev.dDurationMs === "number" ? ev.dDurationMs : 3000;

        let text = "";
        if (Array.isArray(ev.segs)) {
          text = ev.segs.map(s => s.utf8 || "").join("");
        } else if (typeof ev.utf8 === "string") {
          text = ev.utf8;
        }

        text = stripHtmlTags(text).replace(/\n\n+/g, "\n");
        if (!text || text === "\n") continue;

        const durMs = calculateSensibleDuration(text, rawDurMs);
        const endTime = +(startTime + durMs / 1000).toFixed(3);

        cues.push({
          id: defaultId++,
          startTime,
          endTime,
          text
        });
      }

      return cues;
    } catch (_) {
      return [];
    }
  }

  /**
   * Parse YouTube XML transcript format
   */
  function parseYouTubeXml(rawText) {
    if (!rawText || typeof rawText !== "string") return [];
    if (!rawText.includes("<transcript") && !rawText.includes("<timedtext") && !rawText.includes("<text")) return [];

    const cues = [];
    let defaultId = 1;
    const tagRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    let match;

    while ((match = tagRegex.exec(rawText)) !== null) {
      const attrs = match[1] || "";
      const startMatch = attrs.match(/\bstart="([\d\.]+)"/i);
      const durMatch = attrs.match(/\bdur="([\d\.]+)"/i);

      if (!startMatch) continue;
      const startTime = parseFloat(startMatch[1]);
      if (isNaN(startTime)) continue;

      const duration = durMatch ? parseFloat(durMatch[1]) : 3.0;
      const rawContent = match[2] || "";
      const text = stripHtmlTags(rawContent);
      if (!text) continue;

      const rawDurMs = (isNaN(duration) ? 3.0 : duration) * 1000;
      const durMs = calculateSensibleDuration(text, rawDurMs);
      const endTime = +(startTime + durMs / 1000).toFixed(3);

      cues.push({
        id: defaultId++,
        startTime,
        endTime,
        text
      });
    }

    return cues;
  }

  /**
   * Parse YouTube SRV3 (TimedText XML format 3)
   * Elements: <p t="[startMs]" d="[durationMs]">text or <s>segments</s></p>
   */
  function parseSRV3(rawText) {
    if (!rawText || typeof rawText !== "string") return [];
    if (!rawText.includes("<timedtext") && !rawText.includes("<p ") && !rawText.includes("<p>")) return [];

    const cues = [];
    let defaultId = 1;

    // Use DOMParser if available in browser
    if (typeof DOMParser !== "undefined") {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(rawText, "text/xml");
        const pElements = Array.from(doc.querySelectorAll("p"));

        for (let i = 0; i < pElements.length; i++) {
          const p = pElements[i];
          const tAttr = p.getAttribute("t");
          const dAttr = p.getAttribute("d");
          if (tAttr === null) continue;

          const startMs = parseFloat(tAttr);
          if (isNaN(startMs)) continue;

          let durMs = dAttr !== null ? parseFloat(dAttr) : 3000;
          if (isNaN(durMs)) durMs = 3000;

          // Look ahead to prevent overlap
          if (i + 1 < pElements.length) {
            const nextP = pElements[i + 1];
            const nextT = nextP.getAttribute("t");
            if (nextT !== null) {
              const nextStartMs = parseFloat(nextT);
              if (!isNaN(nextStartMs) && nextStartMs > startMs) {
                durMs = Math.min(durMs, nextStartMs - startMs);
              }
            }
          }

          // Extract text from child <s> tags or direct textContent
          const sTags = p.querySelectorAll("s");
          let rawTextContent = "";
          if (sTags.length > 0) {
            rawTextContent = Array.from(sTags).map(s => s.textContent || "").join("");
          } else {
            rawTextContent = p.textContent || "";
          }

          const text = stripHtmlTags(rawTextContent);
          if (!text) continue;

          // Clamp excessively long cue duration so it doesn't linger across silence until next sub
          durMs = calculateSensibleDuration(text, durMs, sTags);

          const startTime = +(startMs / 1000).toFixed(3);
          const endTime = +((startMs + durMs) / 1000).toFixed(3);

          cues.push({
            id: defaultId++,
            startTime,
            endTime,
            text
          });
        }

        if (cues.length > 0) return cues;
      } catch (_) {}
    }

    // Regex fallback (for Node tests or malformed XML)
    const pTagRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    const rawMatches = [];
    let match;

    while ((match = pTagRegex.exec(rawText)) !== null) {
      const attrs = match[1] || "";
      const content = match[2] || "";
      const tMatch = attrs.match(/\bt="(\d+)"/i) || attrs.match(/\bt=([0-9\.]+)/i);
      const dMatch = attrs.match(/\bd="(\d+)"/i) || attrs.match(/\bd=([0-9\.]+)/i);

      if (!tMatch) continue;
      const startMs = parseFloat(tMatch[1]);
      if (isNaN(startMs)) continue;
      let durMs = dMatch ? parseFloat(dMatch[1]) : 3000;
      if (isNaN(durMs)) durMs = 3000;

      rawMatches.push({ startMs, durMs, content });
    }

    for (let i = 0; i < rawMatches.length; i++) {
      const { startMs, content } = rawMatches[i];
      let durMs = rawMatches[i].durMs;

      if (i + 1 < rawMatches.length) {
        const nextStart = rawMatches[i + 1].startMs;
        if (nextStart > startMs) {
          durMs = Math.min(durMs, nextStart - startMs);
        }
      }

      // Check for <s> tags inside
      let textContent = content;
      let hasSTags = false;
      const sMatches = content.match(/<s\b[^>]*>([\s\S]*?)<\/s>/gi);
      if (sMatches) {
        hasSTags = true;
        textContent = sMatches.map(s => s.replace(/<[^>]+>/g, "")).join("");
      }

      const text = stripHtmlTags(textContent);
      if (!text) continue;

      // Also check if last <s> has a t attribute in regex
      let sTagsData = null;
      if (hasSTags && sMatches) {
        sTagsData = sMatches.map(rawS => {
          const tM = rawS.match(/\bt="(\d+)"/i);
          return {
            getAttribute: (attr) => attr === "t" && tM ? tM[1] : null,
            textContent: rawS.replace(/<[^>]+>/g, "")
          };
        });
      }

      durMs = calculateSensibleDuration(text, durMs, sTagsData);

      const startTime = +(startMs / 1000).toFixed(3);
      const endTime = +((startMs + durMs) / 1000).toFixed(3);

      cues.push({
        id: defaultId++,
        startTime,
        endTime,
        text
      });
    }

    return cues;
  }

  /**
   * Auto-detect format from filename or content
   */
  function parseSubtitles(rawText, formatOrFilename = "") {
    if (!rawText || typeof rawText !== "string") return [];

    const hint = String(formatOrFilename).toLowerCase();
    if (hint.endsWith(".srv3") || hint.endsWith(".ytsrv3") || hint === "srv3" || hint === "ytsrv3") {
      const cues = parseSRV3(rawText);
      if (cues.length > 0) return cues;
    }
    if (hint.endsWith(".vtt") || hint === "vtt") {
      const cues = parseVTT(rawText);
      if (cues.length > 0) return cues;
    }
    if (hint.endsWith(".srt") || hint === "srt") {
      const cues = parseSRT(rawText);
      if (cues.length > 0) return cues;
    }
    if (hint.endsWith(".json") || hint.includes("json") || hint === "json3") {
      const cues = parseYouTubeJson3(rawText);
      if (cues.length > 0) return cues;
    }
    if (hint.endsWith(".xml") || hint === "xml") {
      const cues = parseSRV3(rawText);
      if (cues.length > 0) return cues;
      const xmlCues = parseYouTubeXml(rawText);
      if (xmlCues.length > 0) return xmlCues;
    }

    // Sniff content
    const trimmed = rawText.trim();
    if (trimmed.startsWith("{") && (trimmed.includes('"events"') || trimmed.includes('"wireMagic"'))) {
      const jsonCues = parseYouTubeJson3(trimmed);
      if (jsonCues.length > 0) return jsonCues;
    }
    if (trimmed.includes('<timedtext format="3"') || (trimmed.includes("<timedtext") && trimmed.includes("<p "))) {
      const srv3Cues = parseSRV3(trimmed);
      if (srv3Cues.length > 0) return srv3Cues;
    }
    if (trimmed.startsWith("<?xml") || trimmed.includes("<transcript") || trimmed.includes("<timedtext") || trimmed.includes("<text")) {
      const srv3Cues = parseSRV3(trimmed);
      if (srv3Cues.length > 0) return srv3Cues;
      const xmlCues = parseYouTubeXml(trimmed);
      if (xmlCues.length > 0) return xmlCues;
    }
    if (trimmed.startsWith("WEBVTT") || trimmed.includes("-->")) {
      const vttCues = parseVTT(rawText);
      if (vttCues.length > 0) return vttCues;
    }

    // Default to SRT parser (also handles loose VTT timestamps)
    const srtResult = parseSRT(rawText);
    if (srtResult.length > 0) return srtResult;

    // Fallback: try SRV3 then XML
    const srv3Fallback = parseSRV3(rawText);
    if (srv3Fallback.length > 0) return srv3Fallback;

    const xmlFallback = parseYouTubeXml(rawText);
    if (xmlFallback.length > 0) return xmlFallback;

    return parseVTT(rawText);
  }

  /**
   * Shift cue timings by given offset in seconds
   */
  function shiftCues(cues, offsetSeconds = 0) {
    if (!Array.isArray(cues) || offsetSeconds === 0) return cues;
    return cues.map(cue => ({
      ...cue,
      startTime: Math.max(0, +(cue.startTime + offsetSeconds).toFixed(3)),
      endTime: Math.max(0, +(cue.endTime + offsetSeconds).toFixed(3))
    }));
  }

  const SubtitleParser = {
    parseSRT,
    parseVTT,
    parseSRV3,
    parseYouTubeJson3,
    parseYouTubeXml,
    parseSubtitles,
    parseTimestamp,
    shiftCues,
    stripHtmlTags,
    calculateSensibleDuration
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SubtitleParser;
  } else {
    globalThis.SubtitleParser = SubtitleParser;
  }
})();
