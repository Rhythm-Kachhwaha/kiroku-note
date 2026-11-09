// ==========================================================================
// Module: cue-search.js
// In-track subtitle cue search and recent cue mining
// ==========================================================================

// -------------------------------------------------------------
// Subtitle In-Track Search, Recent Cues & Sentence Mining (T4-B, T4-C, T4-F)
// -------------------------------------------------------------
async function loadActiveSubtitleCuesFromStorage() {
  fetchKnownWords().catch(() => {});
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const result = await chrome.storage.local.get(["active_subtitle_cues", "active_subtitle_filename"]);
      if (Array.isArray(result?.active_subtitle_cues)) {
        loadedSubtitleCues = result.active_subtitle_cues;
        if (loadedSubtitleCues.length > 0) {
          annotateLoadedSubtitles(loadedSubtitleCues).catch(() => {});
        }
      }
      if (result?.active_subtitle_filename && subtitlesFileStatus) {
        subtitlesFileStatus.textContent = result.active_subtitle_filename;
        subtitlesFileStatus.classList.add("active");
        subtitlesFileStatus.title = `${result.active_subtitle_filename} (${loadedSubtitleCues.length} cues)`;
      }
    }
  } catch (_) {}
}

function formatSubtitleTimestamp(sec) {
  if (typeof sec !== "number" || isNaN(sec) || sec < 0) return "00:00";
  const totalSec = Math.floor(sec);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  if (hrs > 0) {
    return `${hrs}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

async function seekToSubtitleCue(cue) {
  if (!cue) return;
  const startMs = typeof cue.startMs === "number"
    ? cue.startMs
    : (typeof cue.startTime === "number" ? Math.round(cue.startTime * 1000) : 0);
  await broadcastToActiveVideo({ type: "SEEK_TO", ms: startMs });
  if (lastCaptureSource?.tabId && typeof chrome !== "undefined" && chrome.tabs?.sendMessage) {
    chrome.tabs.sendMessage(lastCaptureSource.tabId, { type: "SEEK_TO", ms: startMs }).catch(() => {});
  }
}

function getSubtitleCueTargetTime(cue) {
  if (typeof cue?.startTime === "number") return cue.startTime + 0.2;
  if (typeof cue?.startMs === "number") return (cue.startMs / 1000) + 0.2;
  return null;
}

function getVideoCaptureContextOptions(message) {
  const isSubtitleCapture = currentMiningTab === "video"
    || message?.source === "subtitle_hover"
    || message?.source === "subtitle_click"
    || message?.source === "subtitle_selection"
    || message?.sourceType === "video";
  const cue = message?.cue || (isSubtitleCapture ? currentActiveCue : null);
  const contextSentence = typeof message?.contextSentence === "string" && message.contextSentence.trim()
    ? message.contextSentence.trim()
    : (isSubtitleCapture ? String(cue?.text || "").trim() : "");
  return {
    ...(cue ? { cue } : {}),
    contextSentence,
    videoContext: isSubtitleCapture,
  };
}

if (typeof window !== "undefined") {
  window.getVideoCaptureContextOptions = getVideoCaptureContextOptions;
}

async function mineSubtitleCueWord(cue, word) {
  if (!cue || !word) return;
  if (typeof insertExampleToCard === "function") {
    insertExampleToCard(cue.text || "", "");
  } else if (typeof fieldExampleSentence !== "undefined" && fieldExampleSentence) {
    fieldExampleSentence.value = cue.text || "";
    if (typeof Event !== "undefined") {
      fieldExampleSentence.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  if (typeof fieldSourceText !== "undefined" && fieldSourceText) fieldSourceText.value = cue.text || "";

  const targetTime = getSubtitleCueTargetTime(cue);
  currentActiveCue = cue;
  updateVideoCuePreviewText(cue.text);
  renderRecentCuesList();

  await identify(word, { targetTime, cue, contextSentence: cue.text || "", videoContext: true });
}

function clearSubtitleSearchResults() {
  if (subtitleSearchResults) {
    subtitleSearchResults.replaceChildren();
    subtitleSearchResults.hidden = true;
  }
  if (btnClearSubtitleSearch) {
    btnClearSubtitleSearch.hidden = true;
  }
}

function searchSubtitles(query) {
  if (!subtitleSearchResults) return;
  const term = (query || "").trim();
  if (!term) {
    clearSubtitleSearchResults();
    return;
  }
  if (btnClearSubtitleSearch) {
    btnClearSubtitleSearch.hidden = false;
  }
  const lowerTerm = term.toLowerCase();
  const matches = (loadedSubtitleCues || []).filter(cue =>
    cue && typeof cue.text === "string" && cue.text.toLowerCase().includes(lowerTerm)
  );

  subtitleSearchResults.replaceChildren();
  subtitleSearchResults.hidden = false;

  if (matches.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-item";
    li.textContent = `No cues found matching "${term}"`;
    subtitleSearchResults.appendChild(li);
    return;
  }

  const displayLimit = Math.min(matches.length, 50);
  for (let i = 0; i < displayLimit; i++) {
    const cue = matches[i];
    const li = document.createElement("li");
    li.title = "Click to jump video to this subtitle cue";

    const timeSpan = document.createElement("span");
    timeSpan.className = "search-cue-time";
    timeSpan.textContent = formatSubtitleTimestamp(cue.startTime !== undefined ? cue.startTime : (cue.startMs / 1000));
    li.appendChild(timeSpan);

    const textSpan = document.createElement("span");
    textSpan.className = "search-cue-text";

    const cueText = cue.text || "";
    const matchIdx = cueText.toLowerCase().indexOf(lowerTerm);
    if (matchIdx !== -1) {
      const before = cueText.slice(0, matchIdx);
      const matched = cueText.slice(matchIdx, matchIdx + term.length);
      const after = cueText.slice(matchIdx + term.length);
      if (before) textSpan.appendChild(document.createTextNode(before));
      const mark = document.createElement("span");
      mark.className = "search-match";
      mark.textContent = matched;
      textSpan.appendChild(mark);
      if (after) textSpan.appendChild(document.createTextNode(after));
    } else {
      textSpan.textContent = cueText;
    }
    li.appendChild(textSpan);

    li.addEventListener("click", () => {
      seekToSubtitleCue(cue);
    });

    subtitleSearchResults.appendChild(li);
  }
}

function renderRecentCuesList() {
  if (!recentCuesList) return;
  const enabled = typeof isRecentSubsEnabled !== "undefined" ? isRecentSubsEnabled : true;

  if (!enabled) {
    if (recentCuesSection) recentCuesSection.hidden = true;
    recentCuesList.replaceChildren();
    return;
  }

  if (recentCuesSection) recentCuesSection.hidden = false;
  recentCuesList.replaceChildren();

  const cuesToRender = Array.isArray(recentSubtitleCues)
    ? recentSubtitleCues.filter(cue => {
        if (!currentActiveCue || !cue || cue.text !== currentActiveCue.text) return true;
        const cueTime = typeof cue.startTime === "number" ? cue.startTime : (cue.startMs || 0) / 1000;
        const activeTime = typeof currentActiveCue.startTime === "number" ? currentActiveCue.startTime : (currentActiveCue.startMs || 0) / 1000;
        return Math.abs(cueTime - activeTime) >= 0.05;
      }).slice(0, 8)
    : [];
  cuesToRender.forEach(cue => {
    if (!cue || !cue.text) return;
    const li = document.createElement("li");
    li.className = "recent-cue-item";

    const timeSpan = document.createElement("span");
    timeSpan.className = "recent-cue-time";
    timeSpan.textContent = formatSubtitleTimestamp(cue.startTime !== undefined ? cue.startTime : ((cue.startMs || 0) / 1000));
    timeSpan.title = "Click to jump video to this cue";
    timeSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      if (typeof seekToSubtitleCue === "function") {
        seekToSubtitleCue(cue);
      }
    });
    li.appendChild(timeSpan);

    const textSpan = document.createElement("span");
    textSpan.className = "recent-cue-text";

    function segmentSubtitleCueTokens(text) {
      if (!text || typeof text !== "string") return [];
      if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
        return [{ text, isWord: /[\u3040-\u30ff\u4e00-\u9faf]/.test(text) }];
      }

      const isKanji = (ch) => /[\u4e00-\u9faf]/.test(ch);
      const isHiragana = (ch) => /[\u3040-\u309f]/.test(ch);
      const isJapanese = (ch) => /[\u3040-\u30ff\u4e00-\u9faf]/.test(ch);
      const loneParticles = new Set(["に", "を", "は", "で", "が", "と", "へ", "も", "よ", "ね", "か", "の", "や"]);
      const compoundParticles = new Set(["から", "まで", "より", "について", "にとって", "として", "ばかり", "くらい", "ぐらい", "ほど", "だけ", "など"]);

      try {
        const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
        const rawSegments = Array.from(segmenter.segment(text));
        const tokens = [];

        for (let i = 0; i < rawSegments.length; i++) {
          let seg = rawSegments[i].segment;
          const hasJp = Array.from(seg).some(isJapanese);

          if (!hasJp) {
            tokens.push({ text: seg, isWord: false });
            continue;
          }

          // 1. Contiguous Kanji expansion (e.g. 学校 + 生活 -> 学校生活, 東京 + 大学 -> 東京大学)
          if (Array.from(seg).every(isKanji)) {
            while (i + 1 < rawSegments.length) {
              const nextSeg = rawSegments[i + 1].segment;
              if (Array.from(nextSeg).every(isKanji)) {
                seg += nextSeg;
                i++;
              } else {
                break;
              }
            }
          }

          // 2. Verb / adjective inflection suffix attachment (e.g. 話 + しま + しょう -> 話しましょう, 食 + べた -> 食べた, 行 + った -> 行った)
          if (Array.from(seg).some(isKanji)) {
            while (i + 1 < rawSegments.length) {
              const nextSeg = rawSegments[i + 1].segment;
              if (!nextSeg || !Array.from(nextSeg).every(isHiragana)) break;
              if (loneParticles.has(nextSeg) || compoundParticles.has(nextSeg)) {
                if (!(/^[てでただ]$/.test(nextSeg) && /[っん]$/.test(seg))) {
                  break;
                }
              }
              seg += nextSeg;
              i++;
            }
          }

          // 3. Lone 1-character particle check (e.g. に, を, は, で)
          if (seg.length === 1 && isHiragana(seg) && loneParticles.has(seg)) {
            tokens.push({ text: seg, isWord: false });
            continue;
          }

          tokens.push({ text: seg, isWord: true });
        }

        return tokens;
      } catch (_) {
        return [{ text, isWord: /[\u3040-\u30ff\u4e00-\u9faf]/.test(text) }];
      }
    }

    // Support drag-selection across words in recent subtitle cue history
    textSpan.addEventListener("mouseup", (e) => {
      if (typeof window !== "undefined" && window.getSelection) {
        const sel = window.getSelection();
        const selText = sel ? sel.toString().trim() : "";
        if (selText && selText.length > 0) {
          e.stopPropagation();
          mineSubtitleCueWord(cue, selText).catch(() => {});
        }
      }
    });

    const tokens = segmentSubtitleCueTokens(cue.text);
    tokens.forEach(tok => {
      if (tok.isWord) {
        const wordSpan = document.createElement("span");
        wordSpan.className = "recent-cue-word";
        wordSpan.textContent = tok.text;
        wordSpan.title = `Click to mine "${tok.text}"`;
        wordSpan.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (typeof window !== "undefined" && window.getSelection) {
            const sel = window.getSelection();
            const selText = sel ? sel.toString().trim() : "";
            if (selText && selText.length > 0) return; // User was drag-selecting
          }
          await mineSubtitleCueWord(cue, tok.text).catch(() => {});
        });
        textSpan.appendChild(wordSpan);
      } else {
        textSpan.appendChild(document.createTextNode(tok.text));
      }
    });

    li.appendChild(textSpan);
    recentCuesList.appendChild(li);
  });
}

function findMostProminentWord(text) {
  if (!text || typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";

  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    try {
      const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
      const segments = Array.from(segmenter.segment(trimmed));

      // 1. Longest segment containing kanji (kanji compound heuristic)
      const kanjiWords = segments
        .map(s => s.segment.trim())
        .filter(s => s.length > 0 && /[\u4e00-\u9faf\u3400-\u4dbf]/.test(s));
      if (kanjiWords.length > 0) {
        kanjiWords.sort((a, b) => b.length - a.length);
        return kanjiWords[0];
      }

      // 2. Longest segment that is not pure punctuation or symbols
      const isPunctuation = (str) => /^[\s\p{P}\p{S}、。！？「」『』（）〜…ー・]+$/u.test(str);
      const validWords = segments
        .map(s => s.segment.trim())
        .filter(s => s.length > 0 && !isPunctuation(s));
      if (validWords.length > 0) {
        validWords.sort((a, b) => b.length - a.length);
        return validWords[0];
      }
    } catch (_) {}
  }

  const kanjiMatches = trimmed.match(/[\u4e00-\u9faf\u3400-\u4dbf]+/g);
  if (kanjiMatches && kanjiMatches.length > 0) {
    kanjiMatches.sort((a, b) => b.length - a.length);
    return kanjiMatches[0];
  }
  const jpMatches = trimmed.match(/[\u3040-\u30ff\u4e00-\u9faf]+/g);
  if (jpMatches && jpMatches.length > 0) {
    jpMatches.sort((a, b) => b.length - a.length);
    return jpMatches[0];
  }
  return trimmed;
}

function handleMineFullSentence() {
  const cueText = (
    currentActiveCue?.text ||
    (videoCurrentCuePreview && !videoCurrentCuePreview.classList.contains("waiting")
      ? videoCurrentCuePreview.textContent
      : "")
  ).trim();
  if (!cueText || cueText === "—" || cueText === "Waiting for playback…") {
    setStatus("No active subtitle cue to mine.", true);
    return;
  }
  const word = findMostProminentWord(cueText) || cueText;
  if (typeof insertExampleToCard === "function") {
    insertExampleToCard(cueText, "");
  } else if (fieldExampleSentence) {
    fieldExampleSentence.value = cueText;
    fieldExampleSentence.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (fieldSourceText) {
    fieldSourceText.value = cueText;
  }
  const targetTime = currentActiveCue
    ? ((typeof currentActiveCue.startTime === "number") ? currentActiveCue.startTime + 0.2 : ((typeof currentActiveCue.startMs === "number") ? (currentActiveCue.startMs / 1000) + 0.2 : null))
    : null;
  return identify(word, {
    targetTime,
    cue: currentActiveCue,
    contextSentence: cueText,
    videoContext: true,
  });
}

if (typeof window !== "undefined") {
  window.findMostProminentWord = findMostProminentWord;
  window.formatSubtitleTimestamp = formatSubtitleTimestamp;
  window.searchSubtitles = searchSubtitles;
  window.renderRecentCuesList = renderRecentCuesList;
  window.mineSubtitleCueWord = mineSubtitleCueWord;
  window.handleMineFullSentence = handleMineFullSentence;
  window.setLoadedSubtitleCues = (cues) => {
    loadedSubtitleCues = cues;
    if (typeof animeTranscriptInstance !== "undefined" && animeTranscriptInstance) {
      animeTranscriptInstance.setCues(cues);
    }
  };
  window.setRecentSubtitleCues = (cues) => { recentSubtitleCues = cues; };
  window.setRecentSubsEnabled = (enabled) => { isRecentSubsEnabled = enabled; };
  window.loadRecentSubsPreferences = loadRecentSubsPreferences;
}

