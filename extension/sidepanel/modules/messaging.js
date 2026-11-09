// ==========================================================================
// Module: messaging.js
// Runtime message listener (JAPANESE_TEXT_CAPTURED, screenshots) and storage sync
// ==========================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ANALYZE_GRAMMAR_SELECTION") {
    const sentence = String(message.sentence || message.selection || "").trim();
    renderTextGrammar(sentence);
    sendResponse?.({ ok: true });
    return true;
  }
  if (message?.type === "SCREENSHOT_CAPTURED") {
    if (message.captureId && currentCaptureId && message.captureId !== currentCaptureId) {
      sendResponse?.({ok: false, error: "STALE_CAPTURE"});
      return true;
    }
    if (message.dataUrl) {
      currentDraftMedia.imageBase64 = message.dataUrl;
      currentDraftMedia.captureId = currentCaptureId;
      if (cardEditor && cardEditor.hidden) cardEditor.hidden = false;
      if (fieldImage && !fieldImage.value) {
        fieldImage.value = "captured_frame.jpg";
      }
      updateMediaPreviews();
      setStatus("Screenshot captured.");
    }
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "SCREENSHOT_CAPTURE_STATUS") {
    if (message.captureId && currentCaptureId && message.captureId !== currentCaptureId) {
      sendResponse?.({ok: false, error: "STALE_CAPTURE"});
      return true;
    }
    if (!message.ok) {
      const isDrm = message.error === "DRM_PROTECTED" || message.error === "DRM_IMAGE_RESTRICTED";
      const statusText = isDrm
        ? "Image unavailable for this source (DRM protected)."
        : (message.message || "Image unavailable for this source.");
      setStatus(statusText);
    }
    sendResponse?.({ ok: true });
    return true;
  }
  if (message?.type === "JAPANESE_TEXT_CAPTURED") {
    if (sender?.tab?.id) {
      lastCaptureSource.tabId = sender.tab.id;
      lastCaptureSource.frameId = typeof sender.frameId === "number" ? sender.frameId : null;
      lastCaptureSource.url = sender.tab.url || message.url || "";
      lastCaptureSource.title = sender.tab.title || message.title || "";
    } else {
      if (message.url) lastCaptureSource.url = message.url;
      if (message.title) lastCaptureSource.title = message.title;
    }
    if (message.cue) {
      currentActiveCue = message.cue;
    }
    if (message.timelineId) {
      lastCaptureSource.timelineId = message.timelineId;
    }
    const contextOptions = getVideoCaptureContextOptions(message);
    lastCaptureSource.type = message.sourceType || (contextOptions.videoContext ? "video" : "text");
    if (message.text) {
      lastVideoHighlightTerm = message.text.trim();
      updateVideoCuePreviewText(currentActiveCue?.text, lastVideoHighlightTerm);
    }
    if (contextOptions.contextSentence) insertExampleToCard(contextOptions.contextSentence, "");
    identify(message.text, contextOptions);
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "HIGHLIGHT_SUBTITLE_WORD") {
    if (message.text) {
      lastVideoHighlightTerm = message.text.trim();
      updateVideoCuePreviewText(currentActiveCue?.text, lastVideoHighlightTerm);
    }
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "CAPTURE_DIAGNOSTIC") {
    setStatus(`${message.stage}: ${message.error}`, true);
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "SUBTITLE_OFFSET_CHANGED") {
    const offsetVal = typeof message.offsetMs === "number"
      ? message.offsetMs
      : (typeof message.offset === "number" ? message.offset * 1000 : 0);
    updateOffsetDisplay(offsetVal);
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "RECENT_CUES_UPDATED") {
    if (Array.isArray(message.cues)) {
      recentSubtitleCues = message.cues;
      renderRecentCuesList();
      if (typeof harvestMissedWords === "function") {
        harvestMissedWords(recentSubtitleCues);
      }
    }
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "SUBTITLE_CUE_CHANGED") {
    if (message.cue !== undefined) {
      currentActiveCue = message.cue;
    }
    const highlight = typeof message.highlightTerm === "string" ? message.highlightTerm : undefined;
    updateVideoCuePreviewText(message.cue?.text, highlight);
    renderRecentCuesList();
    if (typeof handleVideoCueChanged === "function") {
      handleVideoCueChanged(message.cue);
    }
    renderVideoGrammar(message.cue).catch(() => {});
    if (message.cue?.text && typeof setAskContext === "function" && (!activeAskContext || !activeAskContext.text || currentMiningTab === "ask")) {
      setAskContext(message.cue.text, "Video Subtitle");
    }
    if (typeof btnMineFullSentence !== "undefined" && btnMineFullSentence) {
      btnMineFullSentence.disabled = !Boolean(message.cue?.text);
    }
    if (typeof message.offsetMs === "number") {
      if (message.offsetMs !== currentSubtitleOffsetMs) {
        updateOffsetDisplay(message.offsetMs);
      }
    } else if (typeof message.offset === "number" && message.offset !== currentSubtitleOffset) {
      updateOffsetDisplay(message.offset);
    }
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "SUBTITLE_FILE_LOADED") {
    if (subtitlesFileStatus && message.filename) {
      subtitlesFileStatus.textContent = message.filename;
      subtitlesFileStatus.classList.add("active");
    }
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "YOUTUBE_TRACKS_FOUND") {
    if (videoTrackSelect && Array.isArray(message.tracks) && message.tracks.length > 0) {
      availableCaptionTracks = message.tracks;
      videoTrackSelect.replaceChildren();
      message.tracks.forEach((t, idx) => {
        const opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = `${t.name || t.languageCode || `Track ${idx + 1}`}${t.isAuto ? " (auto)" : ""}`;
        if (t.selected) opt.selected = true;
        videoTrackSelect.appendChild(opt);
      });
      videoTrackSelect.hidden = false;
      if (subtitlesFileStatus) {
        subtitlesFileStatus.textContent = "YouTube CC";
        subtitlesFileStatus.classList.add("active");
      }
    }
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "PROCESS_OCR_CROP") {
    handleOcrCropProcess(message);
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "OCR_SELECTION_CANCELLED") {
    setStatus("OCR selection cancelled.");
    sendResponse?.({ok: true});
    return true;
  }
});

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes?.subtitle_timing_offset && typeof changes.subtitle_timing_offset.newValue === "number") {
      updateOffsetDisplay(changes.subtitle_timing_offset.newValue);
    }

    if (areaName === "local" && changes?.[GRAMMAR_SETTINGS_KEY]) {
      loadGrammarSettings().catch(() => {});
    }
    if (areaName === "local" && changes?.active_subtitle_cues) {
      loadedSubtitleCues = Array.isArray(changes.active_subtitle_cues.newValue)
        ? changes.active_subtitle_cues.newValue
        : [];
      if (loadedSubtitleCues.length > 0) {
        annotateLoadedSubtitles(loadedSubtitleCues).catch(() => {});
      }
      if (changes.active_subtitle_filename?.newValue && subtitlesFileStatus) {
        subtitlesFileStatus.textContent = changes.active_subtitle_filename.newValue;
        subtitlesFileStatus.classList.add("active");
        subtitlesFileStatus.title = `${changes.active_subtitle_filename.newValue} (${loadedSubtitleCues.length} cues)`;
      }
    }
    if (areaName === "local" && changes?.active_sub_size?.newValue) {
      setActiveSubSize(changes.active_sub_size.newValue, false);
    }
  });
}

