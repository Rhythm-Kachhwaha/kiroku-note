// ==========================================================================
// Module: video-hero.js
// Video tab hero/workspace auto-collapse state machine and controls
// ==========================================================================

/* ==========================================================================
   VIDEO TAB HERO / CARD WORKSPACE AUTO-COLLAPSE STATE MACHINE
   ========================================================================== */

function isCardEditorFocused() {
  const active = document.activeElement;
  if (!active || !cardEditorSection) return false;
  const inEditor = typeof cardEditorSection.contains === "function"
    ? cardEditorSection.contains(active)
    : (active.closest ? active.closest("#card-editor-section") : false);
  if (!inEditor) return false;
  const tag = (active.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function updateCollapsedCardChip(expressionText, readingText, statusText) {
  lastVideoCapturedCard = {
    expression: expressionText || "",
    reading: readingText || "",
    status: statusText || ""
  };
  if (collapsedChipWord) collapsedChipWord.textContent = lastVideoCapturedCard.expression;
  if (collapsedChipReading) collapsedChipReading.textContent = lastVideoCapturedCard.reading;
  if (collapsedChipStatus) collapsedChipStatus.textContent = lastVideoCapturedCard.status;
}

function clearVideoCollapseTimer() {
  if (videoCollapseTimer) {
    clearTimeout(videoCollapseTimer);
    videoCollapseTimer = null;
  }
}

function collapseVideoWorkspace() {
  if (currentMiningTab !== "video") return;
  if (videoWorkspaceCollapseMode === "keep_open") return;
  if (isCardEditorFocused()) return;
  clearVideoCollapseTimer();
  if (cardEditorSection) {
    cardEditorSection.classList.add("video-collapsed");
  }
  if (videoCollapsedCardChip) {
    videoCollapsedCardChip.style.display = "flex";
  }
}

function expandVideoWorkspace() {
  clearVideoCollapseTimer();
  if (cardEditorSection) {
    cardEditorSection.classList.remove("video-collapsed");
  }
  if (videoCollapsedCardChip) {
    videoCollapsedCardChip.style.display = "none";
  }
}

function scheduleVideoWorkspaceCollapse(delayMs = 5000) {
  clearVideoCollapseTimer();
  if (currentMiningTab !== "video") return;
  if (videoWorkspaceCollapseMode === "keep_open") return;
  if (videoWorkspaceCollapseMode === "dont_show") {
    if (!isCardEditorFocused()) {
      collapseVideoWorkspace();
    }
    return;
  }
  videoCollapseTimer = setTimeout(() => {
    videoCollapseTimer = null;
    if (currentMiningTab !== "video" || videoWorkspaceCollapseMode === "keep_open") return;
    if (isCardEditorFocused()) {
      return;
    }
    collapseVideoWorkspace();
  }, delayMs);
}

function handleVideoCueChanged(cue) {
  if (cue && typeof harvestMissedWords === "function") {
    harvestMissedWords(cue);
  }
  if (cue && typeof animeTranscriptInstance !== "undefined" && animeTranscriptInstance) {
    animeTranscriptInstance.setActiveCue(cue);
  }
  if (cue && typeof animeSessionLoggerInstance !== "undefined" && animeSessionLoggerInstance) {
    animeSessionLoggerInstance.recordCueSeen(cue);
  }
  if (currentMiningTab === "video" && videoWorkspaceCollapseMode === "auto_collapse" && lastVideoCapturedCard) {
    if (isCardEditorFocused()) {
      return;
    }
    collapseVideoWorkspace();
  }
}

async function loadVideoWorkspaceCollapsePreferences() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const data = await chrome.storage.local.get([STORAGE_KEY_VIDEO_WORKSPACE_COLLAPSE_MODE]);
      const stored = data?.[STORAGE_KEY_VIDEO_WORKSPACE_COLLAPSE_MODE];
      if (stored === "keep_open" || stored === "dont_show" || stored === "auto_collapse") {
        videoWorkspaceCollapseMode = stored;
      }
    }
  } catch (_) {}
  if (settingVideoCollapseMode) {
    settingVideoCollapseMode.value = videoWorkspaceCollapseMode;
  }
}

async function setVideoWorkspaceCollapseMode(mode) {
  const validModes = ["auto_collapse", "keep_open", "dont_show"];
  const targetMode = validModes.includes(mode) ? mode : "auto_collapse";
  videoWorkspaceCollapseMode = targetMode;
  if (settingVideoCollapseMode) {
    settingVideoCollapseMode.value = targetMode;
  }
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY_VIDEO_WORKSPACE_COLLAPSE_MODE]: targetMode });
    }
  } catch (_) {}
  if (targetMode === "keep_open") {
    clearVideoCollapseTimer();
  } else if (targetMode === "dont_show" && currentMiningTab === "video" && lastVideoCapturedCard) {
    collapseVideoWorkspace();
  }
}

function initVideoCardCollapse() {
  if (videoCollapsedCardChip) {
    videoCollapsedCardChip.addEventListener("click", () => {
      expandVideoWorkspace();
    });
    videoCollapsedCardChip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        expandVideoWorkspace();
      }
    });
  }
  if (btnExpandCollapsedChip) {
    btnExpandCollapsedChip.addEventListener("click", (e) => {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      expandVideoWorkspace();
    });
  }
  if (cardEditorSection) {
    cardEditorSection.addEventListener("focusin", (e) => {
      const tag = (e.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        clearVideoCollapseTimer();
      }
    });
    cardEditorSection.addEventListener("focusout", (e) => {
      setTimeout(() => {
        if (!isCardEditorFocused() && currentMiningTab === "video" && videoWorkspaceCollapseMode === "auto_collapse" && lastVideoCapturedCard) {
          scheduleVideoWorkspaceCollapse(5000);
        }
      }, 50);
    });
  }
  if (settingVideoCollapseMode) {
    settingVideoCollapseMode.addEventListener("change", (e) => {
      setVideoWorkspaceCollapseMode(e.target.value);
    });
  }
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORAGE_KEY_VIDEO_WORKSPACE_COLLAPSE_MODE]) {
        const newVal = changes[STORAGE_KEY_VIDEO_WORKSPACE_COLLAPSE_MODE].newValue;
        if (newVal === "keep_open" || newVal === "dont_show" || newVal === "auto_collapse") {
          videoWorkspaceCollapseMode = newVal;
          if (settingVideoCollapseMode) settingVideoCollapseMode.value = newVal;
          if (newVal === "keep_open") {
            clearVideoCollapseTimer();
          } else if (newVal === "dont_show" && currentMiningTab === "video" && lastVideoCapturedCard) {
            collapseVideoWorkspace();
          }
        }
      }
    });
  }
}

let RETIRED_UI_ENABLED = false;
const RETIRED_TABS = ["quickadd", "ask", "history"];
function isRetiredUiEnabled() {
  if (typeof globalThis !== "undefined" && typeof globalThis.RETIRED_UI_ENABLED === "boolean") {
    return globalThis.RETIRED_UI_ENABLED;
  }
  return RETIRED_UI_ENABLED;
}

function switchMiningTab(targetTab) {
  const validTabs = ["text", "video", "quickadd", "ask", "history", "settings"];
  let tab = validTabs.includes(targetTab) ? targetTab : "text";
  if (!isRetiredUiEnabled() && RETIRED_TABS.includes(tab)) {
    tab = "text";
  }
  const previousTab = currentMiningTab;
  const settingsPanel = layoutSettingsPopover || cardSettingsPopover;
  const prioritizeVideoSettings = tab === "settings" && (
    previousTab === "video" || (previousTab === "settings" && settingsPanel?.classList.contains("video-settings-priority"))
  );
  currentMiningTab = tab;

  if (tab !== "video") {
    expandVideoWorkspace();
    clearVideoCollapseTimer();
  } else if (tab === "video") {
    if (videoWorkspaceCollapseMode === "dont_show" && lastVideoCapturedCard) {
      collapseVideoWorkspace();
    }
  }

  if (cardEditorSection) {
    const hideEditor = tab === "history" || tab === "ask" || tab === "settings";
    cardEditorSection.hidden = hideEditor;
    cardEditorSection.style.display = hideEditor ? "none" : "";
  }

  // Settings is now a full tab; no separate popover logic needed

  if (tabBtnText) {
    const isText = tab === "text";
    tabBtnText.classList.toggle("active", isText);
    tabBtnText.setAttribute("aria-selected", String(isText));
  }
  if (textMiningView) {
    textMiningView.hidden = tab !== "text";
  }

  if (tabBtnVideo) {
    const isVideo = tab === "video";
    tabBtnVideo.classList.toggle("active", isVideo);
    tabBtnVideo.setAttribute("aria-selected", String(isVideo));
    if (isVideo) {
      updateVideoCuePreviewText();
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: "ENSURE_VIDEO_MINING" }).catch(() => {});
        }
      } catch (_) {}
    }
  }
  if (videoMiningView) {
    videoMiningView.hidden = tab !== "video";
  }

  if (tabBtnQuickAdd) {
    const isQuickAdd = tab === "quickadd";
    tabBtnQuickAdd.classList.toggle("active", isQuickAdd);
    tabBtnQuickAdd.setAttribute("aria-selected", String(isQuickAdd));
  }
  if (quickAddMiningView) {
    quickAddMiningView.hidden = tab !== "quickadd";
    if (tab === "quickadd" && quickAddInput) {
      setTimeout(() => quickAddInput.focus(), 50);
    }
  }

  if (tabBtnAsk) {
    const isAsk = tab === "ask";
    tabBtnAsk.classList.toggle("active", isAsk);
    tabBtnAsk.setAttribute("aria-selected", String(isAsk));
  }
  if (askMiningView) {
    askMiningView.hidden = tab !== "ask";
    if (tab === "ask") {
      if (askInputBox) {
        setTimeout(() => askInputBox.focus(), 50);
      }
      if (typeof checkLLMStatus === "function") {
        checkLLMStatus().catch(() => {});
      }
      if (typeof setAskContext === "function" && (!activeAskContext || !activeAskContext.text) && currentActiveCue?.text) {
        setAskContext(currentActiveCue.text, "Video Subtitle");
      }
    }
  }

  if (tabBtnHistory) {
    const isHistory = tab === "history";
    tabBtnHistory.classList.toggle("active", isHistory);
    tabBtnHistory.setAttribute("aria-selected", String(isHistory));
  }
  if (historySection) {
    const showHistory = tab === "history" && currentCardTemplateSettings?.show_history !== false;
    if (showHistory) {
      historySection.hidden = false;
      historySection.style.display = "";
      if (historyContentContainer) {
        historyContentContainer.hidden = false;
      }
      if (typeof loadHistory === "function") {
        try { loadHistory().catch(() => {}); } catch (_) {}
      }
    } else {
      historySection.hidden = true;
      historySection.style.display = "none";
    }
  }

  if (tabBtnSettings) {
    const isSettings = tab === "settings";
    tabBtnSettings.classList.toggle("active", isSettings);
    tabBtnSettings.setAttribute("aria-selected", String(isSettings));
  }
  if (btnLayoutSettings) {
    const isSettings = tab === "settings";
    btnLayoutSettings.setAttribute("aria-expanded", String(isSettings));
    btnLayoutSettings.classList.toggle("active", isSettings);
  }
  if (settingsPanel) {
    const isSettings = tab === "settings";
    settingsPanel.classList.toggle("video-settings-priority", prioritizeVideoSettings);
    settingsPanel.hidden = !isSettings;
    settingsPanel.style.display = isSettings ? "" : "none";
    if (isSettings) {
      syncCardTemplateSettingsUI();
      renderLayoutSettingsList(currentCardSectionOrder);
      if (typeof checkLLMStatus === "function") checkLLMStatus().catch(() => {});
      if (typeof loadHistory === "function") {
        try { loadHistory().catch(() => {}); } catch (_) {}
      }
    }
  }

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ active_mining_tab: tab });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("active_mining_tab", tab);
    }
  } catch (_) {}
}

async function loadTabPreference() {
  try {
    let savedTab = "text";
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("active_mining_tab");
      if (stored?.active_mining_tab) savedTab = stored.active_mining_tab;
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("active_mining_tab");
      if (stored) savedTab = stored;
    }
    if (!isRetiredUiEnabled() && RETIRED_TABS.includes(savedTab)) {
      savedTab = "text";
    }
    switchMiningTab(savedTab);
  } catch (_) {}
}

const STORAGE_KEY_NAV_COLLAPSED = "kiroku.nav_collapsed";

async function loadNavCollapsePreference() {
  try {
    let isCollapsed = false;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(STORAGE_KEY_NAV_COLLAPSED);
      isCollapsed = !!stored?.[STORAGE_KEY_NAV_COLLAPSED];
    } else if (typeof localStorage !== "undefined") {
      isCollapsed = localStorage.getItem(STORAGE_KEY_NAV_COLLAPSED) === "true";
    }
    const header = panelHeader || document.querySelector(".panel-header");
    if (header) {
      header.classList.toggle("nav-collapsed", isCollapsed);
    }
    if (btnNavCollapseToggle) {
      btnNavCollapseToggle.setAttribute("aria-expanded", String(!isCollapsed));
    }
  } catch (_) {}
}

if (tabBtnText) {
  tabBtnText.addEventListener("click", () => switchMiningTab("text"));
}
if (tabBtnVideo) {
  tabBtnVideo.addEventListener("click", () => switchMiningTab("video"));
}
if (tabBtnQuickAdd) {
  tabBtnQuickAdd.addEventListener("click", () => {
    if (!isRetiredUiEnabled()) return;
    switchMiningTab("quickadd");
  });
}
if (tabBtnAsk) {
  tabBtnAsk.addEventListener("click", () => {
    if (!isRetiredUiEnabled()) return;
    switchMiningTab("ask");
  });
}
if (btnAskFromText) {
  if (!isRetiredUiEnabled()) {
    btnAskFromText.hidden = true;
    if (typeof btnAskFromText.setAttribute === "function") {
      btnAskFromText.setAttribute("data-retired", "1");
    }
  }
  btnAskFromText.addEventListener("click", () => {
    if (!isRetiredUiEnabled()) return;
    const context = buildTextAskContext();
    clearAskContext();
    currentAskTask = "chat";
    if (askInputBox && context) {
      askInputBox.value = `Explain this mined word and how it is used:\n${context}`;
      resizeAskInputBox();
      updateAskCharCount();
    }
    switchMiningTab("ask");
  });
}
if (tabBtnHistory) {
  tabBtnHistory.addEventListener("click", () => {
    if (!isRetiredUiEnabled()) return;
    switchMiningTab("history");
  });
}
if (tabBtnSettings) {
  tabBtnSettings.addEventListener("click", () => switchMiningTab("settings"));
}

if (btnNavCollapseToggle) {
  btnNavCollapseToggle.addEventListener("click", async () => {
    const header = panelHeader || document.querySelector(".panel-header");
    if (!header) return;
    const isCurrentlyCollapsed = header.classList.toggle("nav-collapsed");
    btnNavCollapseToggle.setAttribute("aria-expanded", String(!isCurrentlyCollapsed));
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({ [STORAGE_KEY_NAV_COLLAPSED]: isCurrentlyCollapsed });
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY_NAV_COLLAPSED, String(isCurrentlyCollapsed));
      }
    } catch (_) {}
  });
}

if (clearSubtitlesBtn) {
  clearSubtitlesBtn.addEventListener("click", clearSubtitles);
}

if (btnSearchSubtitles && jimakuSearchModal) {
  btnSearchSubtitles.addEventListener("click", () => {
    jimakuSearchModal.hidden = !jimakuSearchModal.hidden;
    if (!jimakuSearchModal.hidden && jimakuSearchInput) {
      jimakuSearchInput.focus();
    }
  });
}

if (btnCloseJimakuModal && jimakuSearchModal) {
  btnCloseJimakuModal.addEventListener("click", () => {
    jimakuSearchModal.hidden = true;
  });
}

if (btnSaveJimakuKey) {
  btnSaveJimakuKey.addEventListener("click", saveJimakuApiKey);
}

if (btnJimakuSearch) {
  btnJimakuSearch.addEventListener("click", handleJimakuSearch);
}

if (jimakuSearchInput) {
  jimakuSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleJimakuSearch();
    }
  });
}

if (btnBackToResults) {
  btnBackToResults.addEventListener("click", () => {
    if (jimakuFilesContainer) jimakuFilesContainer.hidden = true;
    if (jimakuResultsContainer) jimakuResultsContainer.hidden = false;
  });
}

const subtitlesMenuDropdown = document.querySelector("#subtitles-menu-dropdown");
const subtitlesMenuFile = document.querySelector("#subtitles-menu-file");

if (loadSubtitlesBtn) {
  if (subtitlesMenuDropdown) {
    loadSubtitlesBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      subtitlesMenuDropdown.hidden = !subtitlesMenuDropdown.hidden;
    });
    subtitlesMenuDropdown.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    document.addEventListener("click", () => {
      if (subtitlesMenuDropdown) subtitlesMenuDropdown.hidden = true;
    });
  } else if (subtitlesFileInput) {
    loadSubtitlesBtn.addEventListener("click", (e) => {
      e.preventDefault();
      subtitlesFileInput.click();
    });
  }
}

if (subtitlesMenuFile && subtitlesFileInput) {
  subtitlesMenuFile.addEventListener("click", () => {
    subtitlesFileInput.click();
    if (subtitlesMenuDropdown) subtitlesMenuDropdown.hidden = true;
  });
}

[btnSelectSubtitlesFolder, btnSearchSubtitles, clearSubtitlesBtn].forEach(btn => {
  if (btn && subtitlesMenuDropdown) {
    btn.addEventListener("click", () => {
      subtitlesMenuDropdown.hidden = true;
    });
  }
});

if (subtitlesFileInput) {
  subtitlesFileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleSubtitleFileSelect(file);
  });
}

if (btnSelectSubtitlesFolder && subtitlesDirInput) {
  btnSelectSubtitlesFolder.addEventListener("click", () => subtitlesDirInput.click());
  subtitlesDirInput.addEventListener("change", (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleSubtitleFolderSelect(files);
    }
  });
}

if (folderSubtitlesSelect) {
  folderSubtitlesSelect.addEventListener("change", (e) => {
    const selectedFilename = e.target.value;
    if (!selectedFilename) return;
    const fileOrObj = selectedSubtitleFolderFiles.get(selectedFilename);
    if (fileOrObj) {
      handleSubtitleFileSelect(fileOrObj);
    }
  });
}

if (jimakuDownloadFolderInput) {
  jimakuDownloadFolderInput.addEventListener("input", saveSubtitleFolderPreferences);
}
if (toggleSaveSubtitleDisk) {
  toggleSaveSubtitleDisk.addEventListener("change", saveSubtitleFolderPreferences);
}

if (offsetMinusBtn) {
  offsetMinusBtn.addEventListener("click", () => adjustOffset(-100));
}
if (offsetPlusBtn) {
  offsetPlusBtn.addEventListener("click", () => adjustOffset(100));
}
if (offsetResetBtn) {
  offsetResetBtn.addEventListener("click", () => resetOffset());
}

if (videoTrackSelect) {
  videoTrackSelect.addEventListener("change", () => {
    const trackIndex = parseInt(videoTrackSelect.value, 10);
    broadcastToActiveVideo({
      type: "SELECT_YOUTUBE_TRACK",
      trackIndex
    });
  });
}

async function loadAutoPausePreference() {
  try {
    let autoPause = false;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("auto_pause_on_hover");
      if (typeof stored?.auto_pause_on_hover === "boolean") {
        autoPause = stored.auto_pause_on_hover;
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("auto_pause_on_hover");
      if (stored !== null) {
        autoPause = stored === "true";
      }
    }
    if (toggleAutoPauseHover) {
      toggleAutoPauseHover.checked = autoPause;
    }
  } catch (_) {}
}

function setAutoPausePreference(enabled) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ auto_pause_on_hover: enabled });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("auto_pause_on_hover", String(enabled));
    }
  } catch (_) {}
  broadcastToActiveVideo({
    type: "SET_AUTO_PAUSE_ON_HOVER",
    enabled
  });
}

async function loadSubtitlesDisplayPreference() {
  try {
    let enabled = false;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("subtitles_display_enabled");
      if (typeof stored?.subtitles_display_enabled === "boolean") {
        enabled = stored.subtitles_display_enabled;
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("subtitles_display_enabled");
      if (stored !== null) {
        enabled = stored === "true";
      }
    }
    if (toggleSubtitlesDisplay) {
      toggleSubtitlesDisplay.checked = enabled;
    }
  } catch (_) {}
}

function setSubtitlesDisplayPreference(enabled) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ subtitles_display_enabled: enabled });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("subtitles_display_enabled", String(enabled));
    }
  } catch (_) {}
  broadcastToActiveVideo({
    type: "SET_SUBTITLES_DISPLAY",
    enabled
  });
}

async function loadAutoCapturePreferences() {
  try {
    let autoFrame = true;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(["auto_capture_frame"]);
      if (typeof stored?.auto_capture_frame === "boolean") autoFrame = stored.auto_capture_frame;
    } else if (typeof localStorage !== "undefined") {
      const sf = localStorage.getItem("auto_capture_frame");
      if (sf !== null) autoFrame = sf === "true";
    }
    if (toggleAutoCaptureFrame) toggleAutoCaptureFrame.checked = autoFrame;
  } catch (_) {}
}

function setAutoCapturePreference(key, enabled) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [key]: enabled });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, String(enabled));
    }
  } catch (_) {}
}

async function loadRecentSubsPreferences() {
  try {
    let showRecent = true;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(["kiroku_show_recent_subs"]);
      if (typeof stored?.kiroku_show_recent_subs === "boolean") showRecent = stored.kiroku_show_recent_subs;
    } else if (typeof localStorage !== "undefined") {
      const sr = localStorage.getItem("kiroku_show_recent_subs");
      if (sr !== null) showRecent = sr === "true";
    }
    isRecentSubsEnabled = showRecent;
    if (toggleShowRecentSubs) toggleShowRecentSubs.checked = isRecentSubsEnabled;
    renderRecentCuesList();
  } catch (_) {}
}

function setRecentSubsPreference(key, val) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [key]: val });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, String(val));
    }
  } catch (_) {}
}

if (toggleAutoPauseHover) {
  toggleAutoPauseHover.addEventListener("change", (e) => {
    setAutoPausePreference(Boolean(e.target.checked));
  });
}

if (toggleSubtitlesDisplay) {
  toggleSubtitlesDisplay.addEventListener("change", (e) => {
    setSubtitlesDisplayPreference(Boolean(e.target.checked));
  });
}

if (toggleAutoCaptureFrame) {
  toggleAutoCaptureFrame.addEventListener("change", (e) => {
    setAutoCapturePreference("auto_capture_frame", Boolean(e.target.checked));
  });
}

if (toggleShowRecentSubs) {
  toggleShowRecentSubs.addEventListener("change", (e) => {
    isRecentSubsEnabled = Boolean(e.target.checked);
    setRecentSubsPreference("kiroku_show_recent_subs", isRecentSubsEnabled);
    renderRecentCuesList();
  });
}

if (typeof btnMineFullSentence !== "undefined" && btnMineFullSentence) {
  btnMineFullSentence.addEventListener("click", () => {
    handleMineFullSentence();
  });
}

if (typeof subtitleSearchInput !== "undefined" && subtitleSearchInput) {
  subtitleSearchInput.addEventListener("input", () => {
    clearTimeout(subtitleSearchDebounceTimer);
    subtitleSearchDebounceTimer = setTimeout(() => {
      searchSubtitles(subtitleSearchInput.value);
    }, 300);
  });
}

if (typeof btnClearSubtitleSearch !== "undefined" && btnClearSubtitleSearch) {
  btnClearSubtitleSearch.addEventListener("click", () => {
    if (subtitleSearchInput) subtitleSearchInput.value = "";
    clearSubtitleSearchResults();
    if (subtitleSearchInput) subtitleSearchInput.focus();
  });
}

// Default dictionary indicator to ready state
setIndicatorStatus(indicatorYomitan, "connected", "Dictionary: Ready");

toggle.addEventListener("click", () => {
  setMiningMode(!miningMode).catch(error => {
    setStatus(`Capture setup failed: ${error.message}`, true);
  });
});

if (ocrCaptureBtn) {
  ocrCaptureBtn.addEventListener("click", () => {
    setStatus("Select Japanese text on the page (Escape to cancel)…");
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "START_OCR_CAPTURE" }).catch(err => {
          setStatus(`Failed to start OCR: ${err.message}`, true);
        });
      }
    } catch (err) {
      setStatus(`Failed to start OCR: ${err.message}`, true);
    }
  });
}

