// ==========================================================================
// Module: annotation.js
// Subtitle font sizing and backend annotation client
// ==========================================================================

// -------------------------------------------------------------
// Subtitle Font Sizing & Annotation Client (Spec Sections 1 & 5)
// -------------------------------------------------------------
const VALID_SUB_SIZES = ["small", "medium", "large", "xlarge"];
const DEFAULT_SUB_SIZE = "large";
let currentActiveSubSize = DEFAULT_SUB_SIZE;

function setActiveSubSize(size, persist = true) {
  const targetSize = VALID_SUB_SIZES.includes(size) ? size : DEFAULT_SUB_SIZE;
  currentActiveSubSize = targetSize;

  if (videoCurrentCuePreview) {
    for (const s of VALID_SUB_SIZES) {
      videoCurrentCuePreview.classList.remove(`active-sub-size-${s}`);
    }
    videoCurrentCuePreview.classList.add(`active-sub-size-${targetSize}`);
  }

  const controls = activeSubSizeControls || document.querySelector("#active-sub-size-controls");
  if (controls) {
    const btns = controls.querySelectorAll ? controls.querySelectorAll(".sub-size-btn, [data-size]") : [];
    btns.forEach(btn => {
      const btnSize = btn.dataset?.size || (btn.getAttribute && btn.getAttribute("data-size"));
      const isActive = btnSize === targetSize;
      if (isActive) {
        btn.classList.add("active");
        if (btn.setAttribute) btn.setAttribute("aria-pressed", "true");
      } else {
        btn.classList.remove("active");
        if (btn.removeAttribute) btn.removeAttribute("aria-pressed");
        else if (btn.setAttribute) btn.setAttribute("aria-pressed", "false");
      }
    });
  }

  if (persist) {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ active_sub_size: targetSize });
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem("active_sub_size", targetSize);
      }
    } catch (_) {}
  }
}

async function loadActiveSubSizeFromStorage() {
  let savedSize = DEFAULT_SUB_SIZE;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("active_sub_size");
      if (stored && stored.active_sub_size) {
        savedSize = stored.active_sub_size;
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("active_sub_size");
      if (stored) savedSize = stored;
    }
  } catch (_) {}
  setActiveSubSize(savedSize, false);
}

if (activeSubSizeControls) {
  activeSubSizeControls.addEventListener("click", (e) => {
    const btn = e.target && typeof e.target.closest === "function"
      ? e.target.closest(".sub-size-btn, [data-size]")
      : null;
    if (btn) {
      const size = btn.dataset?.size || (btn.getAttribute && btn.getAttribute("data-size"));
      if (size) {
        setActiveSubSize(size, true);
      }
    }
  });
}

const selectSubFurigana = document.querySelector("#select-sub-furigana");
if (selectSubFurigana) {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get("kiroku.anime.prefs.furigana", (res) => {
      if (res && res["kiroku.anime.prefs.furigana"]) {
        selectSubFurigana.value = res["kiroku.anime.prefs.furigana"];
      }
    });
  }
  selectSubFurigana.addEventListener("change", (e) => {
    const mode = e.target.value;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ "kiroku.anime.prefs.furigana": mode });
    }
    if (typeof chrome !== "undefined") {
      if (chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "KIROKU_FURIGANA_MODE_CHANGED",
          mode: mode
        }).catch(() => {});
      }
      if (chrome.tabs?.query) {
        chrome.tabs.query({}, (tabs) => {
          if (!Array.isArray(tabs)) return;
          for (const tab of tabs) {
            if (tab?.id) {
              chrome.tabs.sendMessage(tab.id, {
                type: "KIROKU_FURIGANA_MODE_CHANGED",
                mode: mode
              }).catch(() => {});
            }
          }
        });
      }
    }
  });
}

async function annotateLoadedSubtitles(cues) {
  const cueList = Array.isArray(cues) ? cues : loadedSubtitleCues;
  if (!Array.isArray(cueList) || cueList.length === 0) return;

  const payload = {
    cues: cueList.map((cue, idx) => ({
      id: cue.id !== undefined && cue.id !== null ? String(cue.id) : String(idx),
      text: cue.text || "",
      start: typeof cue.startTime === "number" ? cue.startTime : (typeof cue.startMs === "number" ? cue.startMs / 1000 : (typeof cue.start === "number" ? cue.start : undefined)),
      end: typeof cue.endTime === "number" ? cue.endTime : (typeof cue.endMs === "number" ? cue.endMs / 1000 : (typeof cue.end === "number" ? cue.end : undefined)),
    }))
  };

  try {
    const res = await fetch(API_SUBTITLE_ANNOTATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data?.cues)) return;

    for (const resCue of data.cues) {
      if (!resCue) continue;
      const cueIdStr = resCue.id !== undefined && resCue.id !== null ? String(resCue.id) : null;
      if (cueIdStr !== null) {
        annotatedCuesCache.set(cueIdStr, resCue.tokens || []);
      }
      const origCue = cueList.find((c, idx) => String(c.id ?? idx) === cueIdStr);
      if (origCue) {
        origCue.tokens = resCue.tokens || [];
        if (origCue.text) {
          annotatedCuesCache.set(origCue.text, resCue.tokens || []);
        }
      }
    }

    if (currentActiveCue) {
      const activeIdStr = currentActiveCue.id !== undefined && currentActiveCue.id !== null ? String(currentActiveCue.id) : null;
      const activeTokens = (activeIdStr && annotatedCuesCache.get(activeIdStr)) || (currentActiveCue.text && annotatedCuesCache.get(currentActiveCue.text));
      if (activeTokens) {
        currentActiveCue.tokens = activeTokens;
      }
      updateVideoCuePreviewText();
      if (typeof harvestMissedWords === "function") {
        harvestMissedWords(currentActiveCue);
      }
    }
    if (Array.isArray(recentSubtitleCues) && recentSubtitleCues.length > 0 && typeof harvestMissedWords === "function") {
      harvestMissedWords(recentSubtitleCues);
    }

    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "UPDATE_ANNOTATED_CUES",
          cues: cueList
        }).catch(() => {});
      }
    } catch (_) {}
  } catch (err) {
    // Offline backend or network error: graceful degradation
  }
}

function updateVideoCuePreviewText(cueText, highlightTerm) {
  if (!videoCurrentCuePreview) return;
  const text = (typeof cueText === "string" ? cueText : (currentActiveCue?.text || "")).trim();
  if (!text) {
    videoCurrentCuePreview.textContent = "Waiting for playback…";
    videoCurrentCuePreview.classList.add("waiting");
    return;
  }
  videoCurrentCuePreview.classList.remove("waiting");

  if (typeof highlightTerm === "string") {
    lastVideoHighlightTerm = highlightTerm.trim();
  }

  // Check if tokens exist for the active cue in annotatedCuesCache or currentActiveCue.tokens
  const activeCue = currentActiveCue;
  const activeIdStr = activeCue?.id !== undefined && activeCue?.id !== null ? String(activeCue.id) : null;
  const tokens = (Array.isArray(activeCue?.tokens) && activeCue.tokens.length > 0)
    ? activeCue.tokens
    : (
        (activeIdStr && annotatedCuesCache.get(activeIdStr)) ||
        (text && annotatedCuesCache.get(text)) ||
        (activeCue?.text && annotatedCuesCache.get(activeCue.text)) ||
        null
      );

  if (Array.isArray(tokens) && tokens.length > 0) {
    videoCurrentCuePreview.replaceChildren();
    for (const token of tokens) {
      const span = document.createElement("span");
      const rawStatus = token.status || "unstyled";
      const normalizedStatus = rawStatus === "should_know" ? "should-know" : rawStatus;
      const statusClass = rawStatus === normalizedStatus ? rawStatus : `${normalizedStatus} ${rawStatus}`;
      span.className = `sub-token ${statusClass}`;
      span.setAttribute("data-surface", token.surface || "");
      span.setAttribute("data-lemma", token.lemma || "");
      span.setAttribute("data-status", rawStatus);
      if (token.reading) span.setAttribute("data-reading", token.reading);
      if (token.jlpt_level) span.setAttribute("data-jlpt-level", token.jlpt_level);
      span.textContent = token.surface || "";
      videoCurrentCuePreview.appendChild(span);
    }
    return;
  }

  // Fallback: Highlight currently hovered term, mined expression, or draft expression if present in the cue text
  const currentTerm = (
    lastVideoHighlightTerm ||
    fieldExpression?.value ||
    (expression && expression.textContent !== "—" ? expression.textContent : "") ||
    ""
  ).trim();

  if (currentTerm && text.includes(currentTerm)) {
    videoCurrentCuePreview.replaceChildren();
    const parts = text.split(currentTerm);
    parts.forEach((part, idx) => {
      if (part) {
        videoCurrentCuePreview.appendChild(document.createTextNode(part));
      }
      if (idx < parts.length - 1) {
        const highlightSpan = document.createElement("span");
        highlightSpan.className = "video-sub-highlight";
        highlightSpan.textContent = currentTerm;
        videoCurrentCuePreview.appendChild(highlightSpan);
      }
    });
  } else {
    videoCurrentCuePreview.textContent = text;
  }
}

if (videoCurrentCuePreview) {
  videoCurrentCuePreview.addEventListener("click", (e) => {
    const tokenSpan = e.target && typeof e.target.closest === "function"
      ? e.target.closest(".sub-token")
      : null;
    if (!tokenSpan) return;
    const surface = tokenSpan.dataset?.surface || (tokenSpan.getAttribute && tokenSpan.getAttribute("data-surface")) || tokenSpan.textContent;
    if (!surface) return;
    if (typeof window !== "undefined" && typeof window.identify === "function" && window.identify !== identify) {
      window.identify(surface);
    } else if (typeof mineSubtitleCueWord === "function" && currentActiveCue) {
      mineSubtitleCueWord(currentActiveCue, surface);
    } else if (typeof identify === "function") {
      const cue = currentActiveCue;
      const targetTime = typeof getSubtitleCueTargetTime === "function" ? getSubtitleCueTargetTime(cue) : null;
      identify(surface, {
        targetTime,
        cue,
        contextSentence: cue?.text || "",
        videoContext: true,
      });
    }
  });
}

