// ==========================================================================
// Module: video-messaging.js
// Video mining messaging and offset formatting
// ==========================================================================

// -------------------------------------------------------------
// Video Mining Logic & Messaging
// -------------------------------------------------------------
function formatOffset(offsetMs) {
  const ms = Math.round(offsetMs || 0);
  if (ms === 0) return "0 ms";
  const sign = ms > 0 ? "+" : "";
  return `${sign}${ms} ms`;
}

function updateOffsetDisplay(offset) {
  let ms = 0;
  if (typeof offset === "number" && !isNaN(offset)) {
    if (Math.abs(offset) > 0 && Math.abs(offset) < 20 && !Number.isInteger(offset)) {
      ms = Math.round(offset * 1000);
    } else {
      ms = Math.round(offset);
    }
  }
  currentSubtitleOffsetMs = ms;
  currentSubtitleOffset = ms / 1000;
  if (offsetDisplay) {
    offsetDisplay.textContent = formatOffset(currentSubtitleOffsetMs);
  }
}

function persistSubtitleOffset(offsetMs) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ subtitle_timing_offset: offsetMs });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("subtitle_timing_offset", String(offsetMs));
    }
  } catch (_) {}
}

async function loadSubtitleOffsetPreference() {
  try {
    let offsetMs = 0;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("subtitle_timing_offset");
      if (typeof stored?.subtitle_timing_offset === "number" && !isNaN(stored.subtitle_timing_offset)) {
        offsetMs = stored.subtitle_timing_offset;
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("subtitle_timing_offset");
      if (stored !== null) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) offsetMs = parsed;
      }
    }
    updateOffsetDisplay(offsetMs);
  } catch (_) {}
}

async function broadcastToActiveVideo(message, targetFrame = null) {
  const frameInfo = targetFrame || lastCaptureSource;
  try {
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const targetTabId = frameInfo?.tabId || tab?.id;
      if (targetTabId) {
        const sendOptions = typeof frameInfo?.frameId === "number" ? { frameId: frameInfo.frameId } : undefined;
        if (sendOptions) {
          chrome.tabs.sendMessage(targetTabId, message, sendOptions).catch(() => {});
        } else {
          chrome.tabs.sendMessage(targetTabId, message).catch(() => {});
        }
      }
    }
  } catch (_) {}
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(message).catch(() => {});
    }
  } catch (_) {}
}

async function handleSubtitleFileSelect(file) {
  if (!file) return;
  try {
    const text = typeof file.text === "function" ? await file.text() : (file.content || "");
    const filename = file.name || "subtitles.srt";
    const parser = typeof SubtitleParser !== "undefined" ? SubtitleParser : (globalThis.SubtitleParser || null);
    if (!parser) {
      setStatus("Subtitle parser unavailable.", true);
      return;
    }
    const rawCues = parser.parseSubtitles(text, filename);
    const cues = typeof parser.normalizeCues === "function" ? parser.normalizeCues(rawCues) : rawCues;
    if (!cues || cues.length === 0) {
      setStatus(`No valid subtitle cues found in "${filename}".`, true);
      return;
    }
    loadedSubtitlesFilename = filename;
    loadedSubtitleCues = cues;
    recentSubtitleCues = [];
    renderRecentCuesList();
    clearSubtitleSearchResults();
    if (subtitlesFileStatus) {
      subtitlesFileStatus.textContent = filename;
      subtitlesFileStatus.classList.add("active");
      subtitlesFileStatus.title = `${filename} (${cues.length} cues)`;
    }
    setStatus(`Loaded ${cues.length} subtitle cues from "${filename}".`);
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({
          active_subtitle_cues: cues,
          active_subtitle_filename: filename
        });
      }
    } catch (_) {}
    await broadcastToActiveVideo({
      type: "LOAD_SUBTITLE_CUES",
      cues,
      filename: filename
    });
    annotateLoadedSubtitles(cues).catch(() => {});
  } catch (err) {
    setStatus(`Failed to read subtitle file: ${err.message}`, true);
  }
}

