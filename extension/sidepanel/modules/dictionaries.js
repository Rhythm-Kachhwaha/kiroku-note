// ==========================================================================
// Yomitan Reference Dictionaries Management
// ==========================================================================

function updateDictionaryCountLabel() {
  if (dictSelectedCountLabel) {
    dictSelectedCountLabel.textContent = `Selected: ${selectedDictionaries.size}`;
  }
}

function reRenderActiveReferenceView() {
  const cachedEntries = Array.isArray(currentDictionaryEntries) ? [...currentDictionaryEntries] : [];
  const cachedKanji = Array.isArray(currentKanjiEntries) ? [...currentKanjiEntries] : [];
  if (cachedEntries.length || cachedKanji.length) {
    const rawObj = {
      entries: cachedEntries,
      kanji_entries: cachedKanji,
      jlpt_level: currentJlptLevel,
      expression: (typeof fieldExpression !== "undefined" && fieldExpression) ? fieldExpression.value : "",
      reading: (typeof fieldReading !== "undefined" && fieldReading) ? fieldReading.value : "",
    };
    renderDetails(rawObj);
  }
}

function renderDictionarySelectionUI() {
  if (!dictSelectionItems) return;
  dictSelectionItems.replaceChildren();

  const dictList = Array.from(discoveredDictionaries);
  if (dictList.length === 0) {
    if (dictSelectionEmpty) dictSelectionEmpty.hidden = false;
    dictSelectionItems.hidden = true;
    updateDictionaryCountLabel();
    return;
  }

  if (dictSelectionEmpty) dictSelectionEmpty.hidden = true;
  dictSelectionItems.hidden = false;

  dictList.forEach(dictName => {
    const label = document.createElement("label");
    label.className = "dict-item-label";
    label.title = dictName;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "setting-checkbox dict-select-checkbox";
    if (!checkbox.dataset) checkbox.dataset = {};
    checkbox.dataset.dictionary = dictName;
    if (typeof checkbox.setAttribute === "function") {
      checkbox.setAttribute("data-dictionary", dictName);
    }
    checkbox.checked = selectedDictionaries.has(dictName);

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedDictionaries.add(dictName);
      } else {
        selectedDictionaries.delete(dictName);
      }
      saveStoredDictionarySettings();
    });

    const span = document.createElement("span");
    span.textContent = dictName;

    label.append(checkbox, span);
    dictSelectionItems.append(label);
  });

  updateDictionaryCountLabel();
}

async function loadStoredDictionarySettings() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get([
        STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION,
        STORAGE_KEY_DISCOVERED_DICTIONARIES,
        STORAGE_KEY_HAS_EXPLICIT_DICTIONARY_SELECTION,
      ]);
      const storedDiscovered = Array.isArray(data?.[STORAGE_KEY_DISCOVERED_DICTIONARIES])
        ? data[STORAGE_KEY_DISCOVERED_DICTIONARIES]
        : [];
      discoveredDictionaries = new Set(storedDiscovered);

      hasExplicitDictionarySelection = Boolean(data?.[STORAGE_KEY_HAS_EXPLICIT_DICTIONARY_SELECTION]);
      if (hasExplicitDictionarySelection) {
        const storedSelected = Array.isArray(data?.[STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION])
          ? data[STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION]
          : [];
        selectedDictionaries = new Set(storedSelected.filter(d => discoveredDictionaries.has(d)));
      } else {
        selectedDictionaries = new Set(discoveredDictionaries);
      }
    } else if (typeof localStorage !== "undefined") {
      const storedDisc = localStorage.getItem(STORAGE_KEY_DISCOVERED_DICTIONARIES);
      if (storedDisc) {
        try {
          const parsed = JSON.parse(storedDisc);
          if (Array.isArray(parsed)) discoveredDictionaries = new Set(parsed);
        } catch (_) {}
      }
      hasExplicitDictionarySelection = localStorage.getItem(STORAGE_KEY_HAS_EXPLICIT_DICTIONARY_SELECTION) === "true";
      const storedSel = localStorage.getItem(STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION);
      if (hasExplicitDictionarySelection && storedSel) {
        try {
          const parsed = JSON.parse(storedSel);
          if (Array.isArray(parsed)) {
            selectedDictionaries = new Set(parsed.filter(d => discoveredDictionaries.has(d)));
          }
        } catch (_) {}
      } else if (!hasExplicitDictionarySelection) {
        selectedDictionaries = new Set(discoveredDictionaries);
      }
    }
  } catch (err) {
    console.warn("Failed to load stored dictionary settings:", err);
  }
  renderDictionarySelectionUI();
}

async function saveStoredDictionarySettings() {
  hasExplicitDictionarySelection = true;
  const selArr = Array.from(selectedDictionaries);
  const discArr = Array.from(discoveredDictionaries);
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({
        [STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION]: selArr,
        [STORAGE_KEY_DISCOVERED_DICTIONARIES]: discArr,
        [STORAGE_KEY_HAS_EXPLICIT_DICTIONARY_SELECTION]: true,
      });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION, JSON.stringify(selArr));
      localStorage.setItem(STORAGE_KEY_DISCOVERED_DICTIONARIES, JSON.stringify(discArr));
      localStorage.setItem(STORAGE_KEY_HAS_EXPLICIT_DICTIONARY_SELECTION, "true");
    }
  } catch (err) {
    console.warn("Failed to save dictionary settings:", err);
  }
  updateDictionaryCountLabel();
  reRenderActiveReferenceView();
}

function harvestDiscoveredDictionaries(entries = [], kanjiEntries = []) {
  let hasNew = false;
  const processDict = (dictName) => {
    if (!dictName || typeof dictName !== "string") return;
    const trimmed = dictName.trim();
    if (trimmed && !discoveredDictionaries.has(trimmed)) {
      discoveredDictionaries.add(trimmed);
      hasNew = true;
      if (!hasExplicitDictionarySelection) {
        selectedDictionaries.add(trimmed);
      }
    }
  };

  if (Array.isArray(entries)) {
    entries.forEach(e => {
      if (e) processDict(e.dictionary);
    });
  }
  if (Array.isArray(kanjiEntries)) {
    kanjiEntries.forEach(k => {
      if (k) processDict(k.dictionary);
    });
  }

  if (hasNew) {
    try {
      const discArr = Array.from(discoveredDictionaries);
      const selArr = Array.from(selectedDictionaries);
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          [STORAGE_KEY_DISCOVERED_DICTIONARIES]: discArr,
          ...(hasExplicitDictionarySelection ? {} : { [STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION]: selArr }),
        });
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY_DISCOVERED_DICTIONARIES, JSON.stringify(discArr));
        if (!hasExplicitDictionarySelection) {
          localStorage.setItem(STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION, JSON.stringify(selArr));
        }
      }
    } catch (_) {}
    renderDictionarySelectionUI();
  }
}

async function refreshAvailableDictionaries() {
  if (btnRefreshDictList) {
    btnRefreshDictList.classList.add("scanning");
    btnRefreshDictList.textContent = "Scanning…";
  }
  try {
    const res = await fetch(API_YOMITAN_DICTIONARIES_URL);
    if (res.ok) {
      const data = await res.json();
      const available = Array.isArray(data.available_dictionaries) ? data.available_dictionaries : [];
      let updated = false;
      available.forEach(dictName => {
        const trimmed = String(dictName).trim();
        if (trimmed && !discoveredDictionaries.has(trimmed)) {
          discoveredDictionaries.add(trimmed);
          updated = true;
          if (!hasExplicitDictionarySelection) {
            selectedDictionaries.add(trimmed);
          }
        }
      });
      if (available.length > 0) {
        for (const sel of Array.from(selectedDictionaries)) {
          if (!discoveredDictionaries.has(sel)) {
            selectedDictionaries.delete(sel);
            updated = true;
          }
        }
      }
      renderDictionarySelectionUI();
      if (updated) {
        await saveStoredDictionarySettings();
      }
    }
  } catch (err) {
    console.warn("Failed to refresh Yomitan dictionaries:", err);
  } finally {
    if (btnRefreshDictList) {
      btnRefreshDictList.classList.remove("scanning");
      btnRefreshDictList.textContent = "↻ Refresh";
    }
  }
}

if (btnRefreshDictList) {
  btnRefreshDictList.addEventListener("click", () => {
    refreshAvailableDictionaries();
  });
}

if (btnDictSelectAll) {
  btnDictSelectAll.addEventListener("click", () => {
    discoveredDictionaries.forEach(d => selectedDictionaries.add(d));
    renderDictionarySelectionUI();
    saveStoredDictionarySettings();
  });
}

if (btnDictClearAll) {
  btnDictClearAll.addEventListener("click", () => {
    selectedDictionaries.clear();
    renderDictionarySelectionUI();
    saveStoredDictionarySettings();
  });
}

let currentCardSectionOrder = [...DEFAULT_CARD_SECTION_ORDER];
let draggedSectionIndex = null;

// History & Card Library elements
const historySection = document.querySelector("#history-section");
const historyCount = document.querySelector("#history-count");
const historySyncLabel = document.querySelector("#history-sync-label");
const historyProgressBar = document.querySelector("#history-progress-bar");
const historySearchInput = document.querySelector("#history-search-input");
const historyDeckFilter = document.querySelector("#history-deck-filter");
const historySyncFilter = document.querySelector("#history-sync-filter");
const historyListContainer = document.querySelector("#history-list-container");
const historyCardsList = document.querySelector("#history-cards-list");
const historyEmpty = document.querySelector("#history-empty");
const btnSyncAll = document.querySelector("#btn-sync-all");
const btnSyncCloudAll = document.querySelector("#btn-sync-cloud-all");
const historySourceAll = document.querySelector("#history-source-all");
const historySourceLocal = document.querySelector("#history-source-local");
const historySourceCloud = document.querySelector("#history-source-cloud");
const historyCloudCountBadge = document.querySelector("#history-cloud-count-badge");
const btnRefreshCloudQueue = document.querySelector("#btn-refresh-cloud-queue");
let currentHistorySource = "all"; // "all" | "local" | "cloud"
const btnExportCards = document.querySelector("#btn-export-cards");
const syncAllStatus = document.querySelector("#sync-all-status");

// Live Sync Progress Modal Elements (T3-J)
const syncProgressModal = document.querySelector("#sync-progress-modal");
const btnCloseSyncModal = document.querySelector("#btn-close-sync-modal");
const syncProgressSummary = document.querySelector("#sync-progress-summary");
const syncModalProgressBar = document.querySelector("#sync-modal-progress-bar");
const syncProgressList = document.querySelector("#sync-progress-list");
const btnDismissSyncModal = document.querySelector("#btn-dismiss-sync-modal");

// Undo Toast Elements (T3-C)
const undoToast = document.querySelector("#undo-toast");
const undoToastMessage = document.querySelector("#undo-toast-message");
const btnUndoDelete = document.querySelector("#btn-undo-delete");

// Bulk Operations Elements (T4-A)
const bulkActionBar = typeof document !== "undefined" && document ? document.querySelector("#bulk-action-bar") : null;
const bulkSelectAllCb = typeof document !== "undefined" && document ? document.querySelector("#bulk-select-all-cb") : null;
const bulkSelectedCount = typeof document !== "undefined" && document ? document.querySelector("#bulk-selected-count") : null;
const btnBulkSync = typeof document !== "undefined" && document ? document.querySelector("#btn-bulk-sync") : null;
const btnBulkDelete = typeof document !== "undefined" && document ? document.querySelector("#btn-bulk-delete") : null;
const btnBulkCancel = typeof document !== "undefined" && document ? document.querySelector("#btn-bulk-cancel") : null;
const bulkDeckSelect = typeof document !== "undefined" && document ? document.querySelector("#bulk-deck-select") : null;

// History Collapse Management (Guardrail 4)
const STORAGE_KEY_HISTORY_COLLAPSED = "kiroku.history_collapsed";
const historyCollapseBtn = document.querySelector("#history-collapse-btn");
const historyContentContainer = document.querySelector("#history-content-container");
const historyStatsDetails = document.querySelector("#history-stats-details");
const historyStatsSummary = document.querySelector("#history-stats-summary");
const historyStatsContent = document.querySelector("#history-stats-content");

function setHistoryCollapsed(collapsed) {
  if (historyContentContainer) {
    historyContentContainer.hidden = collapsed;
  }
  if (historyCollapseBtn) {
    historyCollapseBtn.setAttribute("aria-expanded", String(!collapsed));
  }
}

async function loadStoredHistoryCollapseState() {
  let isCollapsed = true; // Default collapsed as per UX spec
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get(STORAGE_KEY_HISTORY_COLLAPSED);
      if (data && typeof data[STORAGE_KEY_HISTORY_COLLAPSED] === "boolean") {
        isCollapsed = data[STORAGE_KEY_HISTORY_COLLAPSED];
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY_HISTORY_COLLAPSED);
      if (stored !== null) {
        isCollapsed = JSON.parse(stored);
      }
    }
  } catch (err) {
    console.warn("Failed to load history collapse state:", err);
  }
  setHistoryCollapsed(isCollapsed);
}

async function toggleHistoryCollapsed() {
  const currentlyCollapsed = historyContentContainer ? historyContentContainer.hidden : true;
  const nextState = !currentlyCollapsed;
  setHistoryCollapsed(nextState);
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [STORAGE_KEY_HISTORY_COLLAPSED]: nextState });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_HISTORY_COLLAPSED, JSON.stringify(nextState));
    }
  } catch (err) {
    console.warn("Failed to save history collapse state:", err);
  }
}

if (historyCollapseBtn) {
  historyCollapseBtn.addEventListener("click", () => {
    toggleHistoryCollapsed();
  });
}



// Navigation tab elements
const tabBtnText = document.querySelector("#tab-btn-text");
const tabBtnVideo = document.querySelector("#tab-btn-video");
const tabBtnQuickAdd = document.querySelector("#tab-btn-quickadd");
const tabBtnAsk = document.querySelector("#tab-btn-ask");
const tabBtnHistory = document.querySelector("#tab-btn-history");
const tabBtnSettings = document.querySelector("#tab-btn-settings");
const textMiningView = document.querySelector("#text-mining-view");
const videoMiningView = document.querySelector("#video-mining-view");
const quickAddMiningView = document.querySelector("#quickadd-mining-view");
const askMiningView = document.querySelector("#ask-mining-view");

// Ask (AI Assistant) elements
const askProviderPill = document.querySelector("#ask-provider-pill");
const askStatusDot = document.querySelector("#ask-status-dot");
const askProviderName = document.querySelector("#ask-provider-name");
const askModelTag = document.querySelector("#ask-model-tag");
const btnAskNewChat = document.querySelector("#btn-ask-new-chat");
const askContextBanner = document.querySelector("#ask-context-banner");
const contextTypeBadge = document.querySelector("#context-type-badge");
const contextSourceBadge = document.querySelector("#context-source-badge");
const btnDismissContext = document.querySelector("#btn-dismiss-context");
const askContextText = document.querySelector("#ask-context-text");
const btnCtxInsert = document.querySelector("#btn-ctx-insert");
const btnCtxSolve = document.querySelector("#btn-ctx-solve");
const btnCtxGrammar = document.querySelector("#btn-ctx-grammar");
const btnCtxTranslate = document.querySelector("#btn-ctx-translate");
const askChatStream = document.querySelector("#ask-chat-stream");
const askEmptyState = document.querySelector("#ask-empty-state");
const askPromptChipsWrap = document.querySelector("#ask-prompt-chips-wrap");
const askModePicker = document.querySelector("#ask-mode-picker");
const askResponseModeToggle = document.querySelector("#ask-response-mode-toggle");
const btnModeShort = document.querySelector("#btn-mode-short");
const btnModeDetailed = document.querySelector("#btn-mode-detailed");
const askInputBox = document.querySelector("#ask-input-box");
const askCharCount = document.querySelector("#ask-char-count");
const btnAskSubmit = document.querySelector("#btn-ask-submit");
const llmProviderDisplay = document.querySelector("#llm-provider-display");
const llmStatusLabel = document.querySelector("#llm-status-label");
const settingLlmProvider = document.querySelector("#setting-llm-provider");
const settingLlmModel = document.querySelector("#setting-llm-model");
const settingLlmJlptLevel = document.querySelector("#setting-llm-jlpt-level");
const settingLlmKeyName = document.querySelector("#setting-llm-key-name");
const settingLlmKey = document.querySelector("#setting-llm-key");
const llmKeyStatusMsg = document.querySelector("#llm-key-status-msg");
const llmKeyStatusText = document.querySelector("#llm-key-status-text");
const btnSaveLlmKey = document.querySelector("#btn-save-llm-key");
const btnReplaceLlmKey = document.querySelector("#btn-replace-llm-key");
const btnRemoveLlmKey = document.querySelector("#btn-remove-llm-key");
const btnCancelReplaceLlmKey = document.querySelector("#btn-cancel-replace-llm-key");
const cardEditorSection = document.querySelector("#card-editor-section");
const btnNavCollapseToggle = document.querySelector("#btn-nav-collapse-toggle");
const panelHeader = document.querySelector("#panel-header");
const quickAddInput = document.querySelector("#quickadd-input");
const quickAddClearBtn = document.querySelector("#quickadd-clear-btn");
const quickAddSuggestionsContainer = document.querySelector("#quickadd-suggestions-container");
const quickAddSuggestionsList = document.querySelector("#quickadd-suggestions-list");
const quickAddModeHiragana = document.querySelector("#quickadd-mode-hiragana");
const quickAddModeEnglish = document.querySelector("#quickadd-mode-english");
const quickAddModeKatakana = document.querySelector("#quickadd-mode-katakana");

let currentMiningTab = "text";
let activeAskContext = { text: "", source: "" };
let currentQuickAddKanaMode = "hiragana";
let currentQuickAddSearchMode = "kana";
let quickAddCandidates = [];
let quickAddHighlightedIndex = -1;
let quickAddDebounceTimer = null;
let currentQuickAddLookupId = 0;
let quickAddAbortController = null;

// Video Mining elements
const videoMiningSection = document.querySelector("#video-mining-section");
const subtitlesFileStatus = document.querySelector("#subtitles-file-status");
const loadSubtitlesBtn = document.querySelector("#load-subtitles-btn");
const btnSelectSubtitlesFolder = document.querySelector("#btn-select-subtitles-folder");
const btnSearchSubtitles = document.querySelector("#btn-search-subtitles");
const clearSubtitlesBtn = document.querySelector("#clear-subtitles-btn");
const subtitlesFileInput = document.querySelector("#subtitles-file-input");
const subtitlesDirInput = document.querySelector("#subtitles-dir-input");
const subtitleFolderBar = document.querySelector("#subtitle-folder-bar");
const folderNameLabel = document.querySelector("#folder-name-label");
const folderSubtitlesSelect = document.querySelector("#folder-subtitles-select");
const videoTrackSelect = document.querySelector("#video-track-select");
const offsetMinusBtn = document.querySelector("#offset-minus-btn");
const offsetResetBtn = document.querySelector("#offset-reset-btn");
const offsetPlusBtn = document.querySelector("#offset-plus-btn");
const offsetDisplay = document.querySelector("#offset-display");
const videoCurrentCuePreview = document.querySelector("#video-current-cue-preview");
const activeSubSizeControls = document.querySelector("#active-sub-size-controls");
const toggleAutoPauseHover = document.querySelector("#toggle-auto-pause-hover");
const toggleSubtitlesDisplay = document.querySelector("#toggle-subtitles-display");
const toggleAutoCaptureFrame = document.querySelector("#toggle-auto-capture-frame");

// Subtitle Search, Recent Cues & Sentence Mining (T4-B, T4-C, T4-F)
const btnMineFullSentence = document.querySelector("#btn-mine-full-sentence");
const subtitleSearchSection = document.querySelector("#subtitle-search-section");
const subtitleSearchInput = document.querySelector("#subtitle-search-input");
const subtitleSearchResults = document.querySelector("#subtitle-search-results");
const btnClearSubtitleSearch = document.querySelector("#btn-clear-subtitle-search");
const recentCuesSection = document.querySelector("#recent-cues-section");
const recentCuesList = document.querySelector("#recent-cues-list");
const toggleShowRecentSubs = document.querySelector("#toggle-show-recent-subs");

// Missed Should-Know Words Drawer
const videoMissedWordsDrawer = document.querySelector("#video-missed-words-drawer");
const videoMissedWordsHeader = document.querySelector("#video-missed-words-header");
const videoMissedWordsBadge = document.querySelector("#video-missed-words-badge") || document.querySelector("#video-missed-words-count");
const videoMissedWordsBody = document.querySelector("#video-missed-words-body");
const videoMissedWordsList = document.querySelector("#video-missed-words-list");

// Video Tab Card Workspace Auto-Collapse (1-line chip)
const videoCollapsedCardChip = document.querySelector("#video-collapsed-card-chip");
const collapsedChipWord = document.querySelector("#collapsed-chip-word");
const collapsedChipReading = document.querySelector("#collapsed-chip-reading");
const collapsedChipStatus = document.querySelector("#collapsed-chip-status");
const btnExpandCollapsedChip = document.querySelector("#btn-expand-collapsed-chip");
const settingVideoCollapseMode = document.querySelector("#setting-video-collapse-mode");

const STORAGE_KEY_VIDEO_WORKSPACE_COLLAPSE_MODE = "video_workspace_collapse_mode";
let videoWorkspaceCollapseMode = "auto_collapse";
let videoCollapseTimer = null;
let lastVideoCapturedCard = null;

let loadedSubtitleCues = [];
let recentSubtitleCues = [];
let isRecentSubsEnabled = true;
let subtitleSearchDebounceTimer = null;

// Jimaku Search Modal Elements
const jimakuSearchModal = document.querySelector("#jimaku-search-modal");
const btnCloseJimakuModal = document.querySelector("#btn-close-jimaku-modal");
const jimakuApiKeyInput = document.querySelector("#jimaku-api-key-input");
const btnSaveJimakuKey = document.querySelector("#btn-save-jimaku-key");
const jimakuKeyStatus = document.querySelector("#jimaku-key-status");
const jimakuDownloadFolderInput = document.querySelector("#jimaku-download-folder-input");
const toggleSaveSubtitleDisk = document.querySelector("#toggle-save-subtitle-disk");
const jimakuSearchInput = document.querySelector("#jimaku-search-input");
const btnJimakuSearch = document.querySelector("#btn-jimaku-search");
const jimakuStatusMessage = document.querySelector("#jimaku-status-message");
const jimakuResultsContainer = document.querySelector("#jimaku-results-container");
const jimakuResultsList = document.querySelector("#jimaku-results-list");
const jimakuFilesContainer = document.querySelector("#jimaku-files-container");
const jimakuSelectedEntryTitle = document.querySelector("#jimaku-selected-entry-title");
const btnBackToResults = document.querySelector("#btn-back-to-results");
const jimakuFilesList = document.querySelector("#jimaku-files-list");

const jimakuProvider = typeof JimakuProvider !== "undefined" && JimakuProvider.JimakuSubtitleProvider
  ? new JimakuProvider.JimakuSubtitleProvider()
  : null;

let selectedSubtitleFolderFiles = new Map();
let currentSubtitleDirectoryName = "";

let currentSubtitleOffsetMs = 0;
let currentSubtitleOffset = 0.0;
let loadedSubtitlesFilename = "";
let availableCaptionTracks = [];
let lastCaptureSource = { tabId: null, frameId: null, type: "text", url: "", title: "" };
let currentActiveCue = null;
let lastVideoHighlightTerm = "";

let selectedHistoryCardId = null;
let searchDebounceTimeout = null;

let miningMode = false;
let currentCaptureId = 0;
let sessionCardCount = 0;
let ankiConnected = false;
let currentDraftMedia = {
  imageBase64: null,
  audioBase64: null,
  captureId: null
};

function setIndicatorStatus(indicatorEl, state, titleText) {
  if (!indicatorEl) return;
  indicatorEl.className = `indicator-pill ${state}`;
  if (titleText) indicatorEl.title = titleText;
  if (titleText && typeof indicatorEl.querySelector === "function") {
    const statusValue = indicatorEl.querySelector(".system-status-value");
    if (statusValue) {
      const separatorIndex = titleText.indexOf(":");
      statusValue.textContent = separatorIndex >= 0
        ? titleText.slice(separatorIndex + 1).trim()
        : titleText;
    }
  }
}

function updateSyncUI(state, error = "") {
  if (!ankiSyncStatus || !syncAnkiBtn) return;
  ankiSyncStatus.title = error || "";

  switch (state) {
    case "ready":
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Send to Anki";
      ankiSyncStatus.textContent = "Anki: Ready";
      ankiSyncStatus.className = "sync-status-label";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, "connected", "Anki: Connected");
      break;
    case "not_connected":
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Send to Anki";
      ankiSyncStatus.textContent = "Anki: Not connected";
      ankiSyncStatus.className = "sync-status-label";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, "unavailable", "Anki: Not connected");
      break;
    case "pending":
      syncAnkiBtn.disabled = false;
      syncAnkiBtn.textContent = "Send to Anki";
      ankiSyncStatus.textContent = "Anki: Pending";
      ankiSyncStatus.className = "sync-status-label pending";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, ankiConnected ? "connected" : "unavailable", ankiConnected ? "Anki: Connected" : "Anki: Not connected");
      break;
    case "syncing":
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Sending…";
      ankiSyncStatus.textContent = "Anki: Syncing…";
      ankiSyncStatus.className = "sync-status-label syncing";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, "checking", "Anki: Syncing…");
      break;
    case "synced":
      syncAnkiBtn.disabled = false;
      syncAnkiBtn.textContent = "Resync to Anki";
      ankiSyncStatus.textContent = "Anki: Synced";
      ankiSyncStatus.className = "sync-status-label synced";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, "connected", "Anki: Connected");
      break;
    case "failed":
      syncAnkiBtn.disabled = false;
      syncAnkiBtn.textContent = "Retry Send to Anki";
      ankiSyncStatus.textContent = "Anki: Failed — retry";
      ankiSyncStatus.className = "sync-status-label failed";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, "unavailable", error ? `Anki error: ${error}` : "Anki: Failed");
      break;
    default:
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Send to Anki";
      ankiSyncStatus.textContent = ankiConnected ? "Anki: Ready" : "Anki: Not connected";
      ankiSyncStatus.className = "sync-status-label";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, ankiConnected ? "connected" : "unavailable", ankiConnected ? "Anki: Connected" : "Anki: Not connected");
  }
}

let ankiStatusPollInterval = null;

async function checkAnkiStatus() {
  try {
    const res = await fetch(API_ANKI_DECKS_URL);
    const data = await res.json().catch(() => ({}));
    const isNowConnected = Boolean(data.connected);
    const wasOffline = prevAnkiStatus === false;
    const isInitial = prevAnkiStatus === null;

    prevAnkiStatus = isNowConnected;
    ankiConnected = isNowConnected;

    if (isNowConnected) {
      setIndicatorStatus(indicatorAnki, "connected", "Anki: Connected");
      if (ankiSyncStatus && ankiSyncStatus.textContent === "Anki: Not connected") {
        ankiSyncStatus.textContent = "Anki: Ready";
      }
      if (wasOffline && !isInitial && !isSyncAllRunning) {
        checkAndAutoSyncPendingCards().catch(() => {});
      }
    } else {
      setIndicatorStatus(indicatorAnki, "unavailable", "Anki: Not connected");
    }
    return isNowConnected;
  } catch (_) {
    prevAnkiStatus = false;
    ankiConnected = false;
    setIndicatorStatus(indicatorAnki, "unavailable", "Anki: Not connected");
    return false;
  }
}

async function checkAndAutoSyncPendingCards() {
  try {
    const res = await fetch(`${API_CARDS_URL}?sync_status=pending&limit=1`);
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    if (Array.isArray(data.cards) && data.cards.length > 0) {
      await triggerSyncAll({ silent: true });
    }
  } catch (_) {}
}

function startAnkiStatusPolling() {
  if (typeof clearInterval !== "undefined" && ankiStatusPollInterval) clearInterval(ankiStatusPollInterval);
  if (typeof setInterval !== "undefined") {
    ankiStatusPollInterval = setInterval(() => {
      checkAnkiStatus().catch(() => {});
    }, 10000);
  }
}

async function loadDecks() {
  try {
    setIndicatorStatus(indicatorAnki, "checking", "Anki: Checking connection…");
    const res = await fetch(API_ANKI_DECKS_URL);
    const data = await res.json().catch(() => ({}));
    const isNowConnected = Boolean(data.connected);
    const wasOffline = prevAnkiStatus === false;
    const isInitial = prevAnkiStatus === null;

    prevAnkiStatus = isNowConnected;
    ankiConnected = isNowConnected;
    const decks = Array.isArray(data.decks) && data.decks.length ? data.decks : ["Default"];

    if (ankiConnected) {
      setIndicatorStatus(indicatorAnki, "connected", "Anki: Connected");
      if (ankiSyncStatus && ankiSyncStatus.textContent === "Anki: Not connected") {
        ankiSyncStatus.textContent = "Anki: Ready";
      }
      if (wasOffline && !isInitial && !isSyncAllRunning) {
        checkAndAutoSyncPendingCards().catch(() => {});
      }
    } else {
      setIndicatorStatus(indicatorAnki, "unavailable", "Anki: Not connected");
    }

    if (fieldDeckSelect) {
      const currentSelected = fieldDeckSelect.value;
      fieldDeckSelect.replaceChildren();
      decks.forEach(deck => {
        const opt = document.createElement("option");
        opt.value = deck;
        opt.textContent = deck;
        fieldDeckSelect.append(opt);
      });

      // Restore last used deck if available
      let lastDeck = "";
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const stored = await chrome.storage.local.get("last_used_deck");
          lastDeck = stored?.last_used_deck;
        } else if (typeof localStorage !== "undefined") {
          lastDeck = localStorage.getItem("last_used_deck");
        }
      } catch (_) {}

      if (lastDeck && !decks.includes(lastDeck)) {
        decks.push(lastDeck);
        const opt = document.createElement("option");
        opt.value = lastDeck;
        opt.textContent = lastDeck;
        fieldDeckSelect.append(opt);
      }

      // Prioritize stored lastDeck if present in decks, otherwise currentSelected if present, then Default or first deck
      let targetDeck = "";
      if (lastDeck && decks.includes(lastDeck)) {
        targetDeck = lastDeck;
      } else if (currentSelected && decks.includes(currentSelected)) {
        targetDeck = currentSelected;
      } else if (decks.includes("Default")) {
        targetDeck = "Default";
      } else {
        targetDeck = decks[0] || "Default";
      }

      fieldDeckSelect.value = targetDeck;
      if (fieldDeckName) fieldDeckName.value = fieldDeckSelect.value;
      updateDestinationIndicator();
    }
  } catch (_) {
    ankiConnected = false;
    setIndicatorStatus(indicatorAnki, "unavailable", "Anki: Not connected");
  }
}

async function loadModels() {
  try {
    const res = await fetch(API_ANKI_MODELS_URL);
    const data = await res.json().catch(() => ({}));
    const models = Array.isArray(data.models) && data.models.length ? data.models : ["Basic"];

    if (fieldModelSelect) {
      const currentSelected = fieldModelSelect.value;
      fieldModelSelect.replaceChildren();
      models.forEach(model => {
        const opt = document.createElement("option");
        opt.value = model;
        opt.textContent = model;
        fieldModelSelect.append(opt);
      });

      // Restore last used / preferred note type if available
      let preferredModel = "";
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const stored = await chrome.storage.local.get("preferred_anki_model");
          preferredModel = stored?.preferred_anki_model;
        } else if (typeof localStorage !== "undefined") {
          preferredModel = localStorage.getItem("preferred_anki_model");
        }
      } catch (_) {}

      if (preferredModel && !models.includes(preferredModel)) {
        models.push(preferredModel);
        const opt = document.createElement("option");
        opt.value = preferredModel;
        opt.textContent = preferredModel;
        fieldModelSelect.append(opt);
      }

      // Prioritize stored preferredModel if present in models, otherwise currentSelected if present, then Basic or first model
      let targetModel = "";
      if (preferredModel && models.includes(preferredModel)) {
        targetModel = preferredModel;
      } else if (currentSelected && models.includes(currentSelected)) {
        targetModel = currentSelected;
      } else if (models.includes("Basic")) {
        targetModel = "Basic";
      } else {
        targetModel = models[0] || "Basic";
      }

      fieldModelSelect.value = targetModel;
      if (fieldModelName) fieldModelName.value = fieldModelSelect.value;
      updateDestinationIndicator();
      loadModelCapabilities(fieldModelSelect.value).catch(() => {});
    }
  } catch (_) {
    if (fieldModelSelect && !fieldModelSelect.options.length) {
      const opt = document.createElement("option");
      opt.value = "Basic";
      opt.textContent = "Basic";
      fieldModelSelect.append(opt);
    }
    updateDestinationIndicator();
  }
}

let currentModelCapabilities = {
  supports_image: true,
  supports_audio: true,
  supports_sentence: true
};

async function loadModelCapabilities(modelName) {
  try {
    const url = modelName
      ? `${BACKEND_BASE_URL}/api/anki/model-capabilities?model_name=${encodeURIComponent(modelName)}`
      : `${BACKEND_BASE_URL}/api/anki/model-capabilities`;
    const res = await fetch(url);
    if (res.ok) {
      const caps = await res.json();
      currentModelCapabilities = {
        supports_image: Boolean(caps.supports_image),
        supports_audio: Boolean(caps.supports_audio),
        supports_sentence: Boolean(caps.supports_sentence)
      };
      updateModelCapabilityWarnings();
    }
  } catch (_) {}
}

function updateModelCapabilityWarnings() {
  if (btnRetakeImage) {
    if (!currentModelCapabilities.supports_image && ankiConnected) {
      btnRetakeImage.title = "Selected Anki model lacks image field (saved locally only)";
    }
  }
}

async function checkOcrStatus() {
  try {
    setIndicatorStatus(indicatorOcr, "checking", "OCR: Checking connection…");
    const res = await fetch(API_OCR_STATUS_URL);
    const data = await res.json().catch(() => ({}));
    ocrAvailable = Boolean(data.available);
    const ocrInstalled = Boolean(data.installed);
    ocrLoaded = Boolean(data.model_loaded);

    if (ocrAvailable) {
      setIndicatorStatus(
        indicatorOcr,
        "connected",
        ocrLoaded ? "OCR: Ready (Loaded)" : "OCR: Ready (Idle)"
      );
    } else if (!ocrInstalled) {
      setIndicatorStatus(indicatorOcr, "unavailable", "OCR: Not installed");
    } else {
      setIndicatorStatus(
        indicatorOcr,
        "unavailable",
        data.error ? `OCR: Offline (${data.error})` : (data.message || "OCR: Offline")
      );
    }
    return data;
  } catch (_) {
    ocrAvailable = false;
    ocrLoaded = false;
    setIndicatorStatus(indicatorOcr, "unavailable", "OCR: Backend unreachable");
    return { available: false, installed: false, model_loaded: false };
  }
}

async function checkHealthStatus() {
  try {
    const res = await fetch(API_HEALTH_URL);
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
    const data = await res.json().catch(() => ({}));

    if (data.yomitan) {
      setIndicatorStatus(indicatorYomitan, "connected", "Yomitan: Connected");
    } else {
      setIndicatorStatus(indicatorYomitan, "unavailable", "Yomitan: Offline");
    }

    const isAnkiConnected = Boolean(data.ankiconnect);
    ankiConnected = isAnkiConnected;
    prevAnkiStatus = isAnkiConnected;
    if (isAnkiConnected) {
      setIndicatorStatus(indicatorAnki, "connected", "Anki: Connected");
      if (ankiSyncStatus && ankiSyncStatus.textContent === "Anki: Not connected") {
        ankiSyncStatus.textContent = "Anki: Ready";
      }
    } else {
      setIndicatorStatus(indicatorAnki, "unavailable", "Anki: Not connected");
    }

    ocrAvailable = Boolean(data.ocr);
    if (ocrAvailable) {
      setIndicatorStatus(indicatorOcr, "connected", "OCR: Ready");
    } else {
      setIndicatorStatus(indicatorOcr, "unavailable", "OCR: Offline");
    }

    return data;
  } catch (_) {
    setIndicatorStatus(indicatorYomitan, "unavailable", "Yomitan: Offline");
    setIndicatorStatus(indicatorAnki, "unavailable", "Anki: Not connected");
    setIndicatorStatus(indicatorOcr, "unavailable", "OCR: Offline");
    return { status: "error", yomitan: false, ankiconnect: false, ocr: false, db: false };
  }
}

async function handleOcrCropProcess({ dataUrl, cropRect, rect, viewport }) {
  try {
    const rawRect = cropRect || rect;
    if (!rawRect) {
      throw new Error("No selection region provided");
    }

    setStatus("Processing OCR capture…");
    setIndicatorStatus(indicatorOcr, "checking", "OCR: Processing…");

    // Decode screenshot image
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Failed to decode screenshot image"));
      img.src = dataUrl;
    });

    const cropBounds = (typeof KirokuOcrCropper !== "undefined" && KirokuOcrCropper.calculateOcrCropBounds)
      ? KirokuOcrCropper.calculateOcrCropBounds(
          rawRect,
          viewport || {},
          { naturalWidth: img.naturalWidth || img.width, naturalHeight: img.naturalHeight || img.height }
        )
      : {
          x: Math.round(rawRect.left ?? rawRect.x ?? 0),
          y: Math.round(rawRect.top ?? rawRect.y ?? 0),
          width: Math.round(rawRect.width),
          height: Math.round(rawRect.height)
        };

    if (cropBounds.width <= 0 || cropBounds.height <= 0) {
      throw new Error("Selection area is too small");
    }

    const canvas = document.createElement("canvas");
    canvas.width = cropBounds.width;
    canvas.height = cropBounds.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to initialize canvas context");

    ctx.drawImage(
      img,
      cropBounds.x,
      cropBounds.y,
      cropBounds.width,
      cropBounds.height,
      0,
      0,
      cropBounds.width,
      cropBounds.height
    );

    const croppedDataUrl = canvas.toDataURL("image/png");

    const response = await fetch(API_OCR_RECOGNIZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: croppedDataUrl })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errMsg = result.detail || `OCR failed (status ${response.status})`;
      setIndicatorStatus(indicatorOcr, "error", `OCR: ${errMsg}`);
      setStatus(`OCR failed: ${errMsg}`, true);
      return;
    }

    setIndicatorStatus(indicatorOcr, "connected", "OCR: Ready (Loaded)");
    ocrAvailable = true;
    ocrLoaded = true;

    const recognizedText = typeof result.text === "string" ? result.text.trim() : "";
    if (!recognizedText) {
      setStatus("No Japanese text detected in selected region.");
      return;
    }

    setStatus(`OCR recognized: "${recognizedText}" — looking up dictionary…`);

    if (currentMiningTab === "ask") {
      if (askInputBox) {
        askInputBox.value = recognizedText;
        if (typeof resizeAskInputBox === "function") resizeAskInputBox();
        if (typeof updateAskCharCount === "function") updateAskCharCount();
      }
      if (typeof setAskContext === "function") {
        setAskContext(recognizedText, "OCR Capture");
      }
    }

    // OCR keeps the established single-word capture path. Whole Japanese lines
    // are routed to grammar analysis instead of forcing a dictionary lookup.
    if (/[\s。！？!?]/u.test(recognizedText) || recognizedText.length > 12) {
      await renderTextGrammar(recognizedText);
      setStatus("OCR sentence captured for grammar analysis.");
      return;
    }

    // Track provenance
    if (typeof lastCaptureSource !== "undefined") {
      lastCaptureSource.type = "ocr";
    }

    // Feed directly into canonical capture pipeline
    await identify(recognizedText);

    // Attach cropped image snippet to card draft
    currentDraftMedia.imageBase64 = croppedDataUrl;
    currentDraftMedia.captureId = currentCaptureId;
    if (fieldImage && !fieldImage.value) {
      fieldImage.value = "ocr_crop.png";
    }
    updateMediaPreviews();
    scheduleCardPreviewUpdate();
    refreshDuplicateState();
    setStatus(`OCR captured: "${recognizedText}"`);

  } catch (err) {
    setIndicatorStatus(indicatorOcr, "error", `OCR: ${err.message}`);
    setStatus(`OCR capture failed: ${err.message}`, true);
  }
}

// Japanese Font Selection handling
function applyJapaneseFont(fontFamily) {
  let fontStack = "var(--font-noto-sans)";
  if (fontFamily === "Noto Serif JP") {
    fontStack = "var(--font-noto-serif)";
  } else if (fontFamily === "system-ui") {
    fontStack = "var(--font-system)";
  }
  document.documentElement.style.setProperty("--japanese-font", fontStack);
}

async function loadFontPreference() {
  let savedFont = "Noto Sans JP";
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("preferred_japanese_font");
      if (stored?.preferred_japanese_font) savedFont = stored.preferred_japanese_font;
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("preferred_japanese_font");
      if (stored) savedFont = stored;
    }
  } catch (_) {}

  if (fieldFontSelect) {
    fieldFontSelect.value = savedFont;
  }
  applyJapaneseFont(savedFont);
}

if (fieldFontSelect) {
  fieldFontSelect.addEventListener("change", () => {
    const val = fieldFontSelect.value;
    applyJapaneseFont(val);
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({preferred_japanese_font: val});
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem("preferred_japanese_font", val);
      }
    } catch (_) {}
  });
}

if (fieldDeckSelect) {
  fieldDeckSelect.addEventListener("change", () => {
    const val = fieldDeckSelect.value;
    loadDeckTemplateSettings(val);
    if (fieldDeckName) fieldDeckName.value = val;
    updateDestinationIndicator();
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({last_used_deck: val});
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem("last_used_deck", val);
      }
    } catch (_) {}
    scheduleDuplicateCheck(true);
  });
}

if (fieldDeckName) {
  fieldDeckName.addEventListener("input", () => {
    updateDestinationIndicator();
    scheduleDuplicateCheck(false);
  });
  fieldDeckName.addEventListener("change", () => {
    const val = fieldDeckName.value.trim();
    if (val) loadDeckTemplateSettings(val);
    updateDestinationIndicator();
    scheduleDuplicateCheck(true);
  });
}

if (fieldModelSelect) {
  fieldModelSelect.addEventListener("change", () => {
    const val = fieldModelSelect.value;
    if (fieldModelName) fieldModelName.value = val;
    updateDestinationIndicator();
    if (!canReorderPreviewBlocks()) setPreviewEditMode(false);
    else updatePreviewEditButton();
    scheduleCardPreviewUpdate();
    loadModelCapabilities(val).catch(() => {});
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({preferred_anki_model: val});
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem("preferred_anki_model", val);
      }
    } catch (_) {}
  });
}

if (fieldModelName) {
  fieldModelName.addEventListener("input", () => {
    updateDestinationIndicator();
  });
  fieldModelName.addEventListener("change", () => {
    updateDestinationIndicator();
  });
}

// Keep live hero display synced as user edits expression or reading
if (fieldExpression) {
  fieldExpression.addEventListener("input", () => {
    if (expression) expression.textContent = fieldExpression.value || "—";
    updateHeroReading(fieldReading ? fieldReading.value : "", fieldExpression.value);
    scheduleDuplicateCheck(false);
    if (currentMiningTab === "video") {
      updateVideoCuePreviewText();
    }
  });
  fieldExpression.addEventListener("change", () => {
    updateHeroReading(fieldReading ? fieldReading.value : "", fieldExpression.value);
    scheduleDuplicateCheck(true);
    if (currentMiningTab === "video") {
      updateVideoCuePreviewText();
    }
  });
}

if (fieldReading) {
  fieldReading.addEventListener("input", () => {
    updateHeroReading(fieldReading.value, fieldExpression ? fieldExpression.value : "");
    scheduleDuplicateCheck(false);
  });
  fieldReading.addEventListener("change", () => {
    updateHeroReading(fieldReading.value, fieldExpression ? fieldExpression.value : "");
    scheduleDuplicateCheck(true);
  });
}

if (fieldMeaning) {
  fieldMeaning.addEventListener("input", () => {
    updateHeroMeanings({ meaning: fieldMeaning.value });
  });
}

function updateTtsPlayButton(exprText) {
  if (!btnTtsPlay) return;
  btnTtsPlay.hidden = true;
  btnTtsPlay.style.display = "none";
}

if (btnTtsPlay) {
  btnTtsPlay.addEventListener("click", () => {
    const text = (fieldExpression?.value || expression?.textContent || "").trim();
    if (!text || text === "—") return;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = "ja-JP";
      window.speechSynthesis.speak(utt);
    }
  });
}

function updateHeroReading(readingText, expressionText) {
  if (typeof updateTtsPlayButton === "function") updateTtsPlayButton(expressionText);
  if (!reading) return;
  const rawReading = (readingText || "").trim();
  const rawExpr = (expressionText || "").trim();
  const text = rawReading || rawExpr;
  if (!text) {
    reading.textContent = "";
    return;
  }
  const hasKana = /[\u3040-\u309f\u30a0-\u30ff]/.test(text);
  if (hasKana && typeof wanakana !== "undefined" && typeof wanakana.toRomaji === "function") {
    const romaji = wanakana.toRomaji(text);
    if (romaji && romaji.toLowerCase() !== text.toLowerCase()) {
      reading.textContent = `${text} · ${romaji}`;
      return;
    }
  }
  reading.textContent = text;
}

function updateHeroMeanings(data) {
  if (!wordMeaningsSummary) return;
  const meaning = (data && data.meaning ? String(data.meaning) : "").trim();
  if (!meaning) {
    wordMeaningsSummary.textContent = "";
    wordMeaningsSummary.hidden = true;
    return;
  }
  let rawParts = [];
  if (meaning.includes("\n")) {
    rawParts = meaning
      .split(/\r?\n/)
      .map(s => s.trim().replace(/^\d+[\.\)]\s*/, "").trim())
      .filter(Boolean);
  } else if (/^\s*\d+[\.\)]/.test(meaning)) {
    rawParts = meaning
      .split(/(?:^|\s+)\d+[\.\)]\s*/)
      .map(s => s.trim())
      .filter(Boolean);
  } else {
    rawParts = meaning
      .split(/;/)
      .map(s => s.trim().replace(/^\d+[\.\)]\s*/, "").trim())
      .filter(Boolean);
  }

  const uniqueParts = [];
  for (const p of rawParts) {
    if (!uniqueParts.includes(p)) uniqueParts.push(p);
  }

  const top3 = uniqueParts.slice(0, 3);
  if (top3.length === 0) {
    wordMeaningsSummary.textContent = "";
    wordMeaningsSummary.hidden = true;
    return;
  }
  const formatted = top3.map((s, idx) => `${idx + 1}. ${s}`).join(" · ");
  wordMeaningsSummary.textContent = formatted;
  wordMeaningsSummary.hidden = false;
}

function updateHeroBadges(body) {
  const rawObj = body?.term || body;
  const entries = Array.isArray(rawObj?.entries) ? rawObj.entries : (Array.isArray(currentDictionaryEntries) ? currentDictionaryEntries : []);
  const kanjiEntries = Array.isArray(rawObj?.kanji_entries) ? rawObj.kanji_entries : (Array.isArray(currentKanjiEntries) ? currentKanjiEntries : []);

  // 1. JLPT Level
  let jlpt = body?.jlpt_level || rawObj?.jlpt_level || currentJlptLevel;
  if (!jlpt && entries.length) {
    for (const e of entries) {
      for (const t of (e.tags || [])) {
        const m = String(t).match(/^jlpt-n([1-5])$/i) || String(t).match(/^n([1-5])$/i);
        if (m) { jlpt = `N${m[1]}`; break; }
      }
      if (jlpt) break;
    }
  }
  if (!jlpt && kanjiEntries.length) {
    for (const k of kanjiEntries) {
      if (k.stats && k.stats.jlpt && String(k.stats.jlpt).toUpperCase().startsWith("N")) {
        jlpt = String(k.stats.jlpt).toUpperCase();
        break;
      }
      for (const t of (k.tags || [])) {
        const m = String(t).match(/^jlpt-n([1-5])$/i) || String(t).match(/^n([1-5])$/i);
        if (m) { jlpt = `N${m[1]}`; break; }
      }
      if (jlpt) break;
    }
  }
  if (showcaseJlptBadge) {
    if (jlpt) {
      const displayJlpt = String(jlpt).trim().toUpperCase();
      const cleanJlpt = displayJlpt.startsWith("JLPT") ? displayJlpt.replace("JLPT", "").trim() : displayJlpt;
      const normalizedNum = cleanJlpt.match(/^[1-5]$/) ? `N${cleanJlpt}` : cleanJlpt;
      showcaseJlptBadge.textContent = `JLPT ${normalizedNum}`;
      showcaseJlptBadge.hidden = false;
    } else {
      showcaseJlptBadge.hidden = true;
      showcaseJlptBadge.textContent = "";
    }
  }

  // 2. POS (Part of Speech) / Verb Metadata
  if (showcasePosBadge) {
    let posLabel = "";
    const verbMeta = body?.verb_metadata || rawObj?.verb_metadata || (typeof currentVerbMetadata !== "undefined" ? currentVerbMetadata : null);

    const allPosTokens = [
      ...(Array.isArray(rawObj?.parts_of_speech) ? rawObj.parts_of_speech : []),
      ...(Array.isArray(rawObj?.tags) ? rawObj.tags : []),
    ];
    if (entries.length) {
      for (const e of entries) {
        if (Array.isArray(e.parts_of_speech)) allPosTokens.push(...e.parts_of_speech);
        if (Array.isArray(e.tags)) allPosTokens.push(...e.tags);
        if (Array.isArray(e.senses)) {
          for (const s of e.senses) {
            if (Array.isArray(s.parts_of_speech)) allPosTokens.push(...s.parts_of_speech);
            if (Array.isArray(s.pos)) allPosTokens.push(...s.pos);
            if (Array.isArray(s.tags)) allPosTokens.push(...s.tags);
          }
        }
      }
    }
    const normTokens = allPosTokens.map(t => String(t).toLowerCase().trim());
    const isNoun = normTokens.some(t => t === "noun" || t.includes("noun") || t === "n" || t.startsWith("n-"));
    const isAdverb = normTokens.some(t => t === "adverb" || t.includes("adverb") || t === "adv" || t.startsWith("adv-"));
    const isAux = normTokens.some(t => t === "aux" || t.includes("aux") || t === "cop" || t.includes("copula"));

    if (isNoun) {
      if (verbMeta && verbMeta.is_verb) {
        posLabel = "noun · suru";
      } else {
        posLabel = "noun";
      }
    } else if (isAdverb) {
      posLabel = "adverb";
    } else if (verbMeta && verbMeta.is_verb) {
      const vType = verbMeta.verb_type ? String(verbMeta.verb_type).toLowerCase() : "";
      posLabel = vType ? `verb · ${vType}` : "verb";
    } else if (normTokens.some(t => t.includes("5-dan") || t.includes("godan") || t.startsWith("v5"))) {
      posLabel = "verb · godan";
    } else if (normTokens.some(t => t.includes("1-dan") || t.includes("ichidan") || t.startsWith("v1"))) {
      posLabel = "verb · ichidan";
    } else if (normTokens.some(t => t === "suru" || t.includes("suru verb") || t === "vs" || t.startsWith("vs-"))) {
      posLabel = "verb · suru";
    } else if (normTokens.some(t => t === "kuru" || t.includes("kuru verb") || t === "vk")) {
      posLabel = "verb · kuru";
    } else if (normTokens.some(t => t === "verb" || t.startsWith("v-") || (t.startsWith("v") && t.length <= 3))) {
      posLabel = "verb";
    } else if (isAux) {
      posLabel = "aux";
    } else if (normTokens.length) {
      posLabel = normTokens[0];
    }

    if (posLabel) {
      showcasePosBadge.textContent = posLabel;
      showcasePosBadge.className = "kn-badge pos";
      showcasePosBadge.hidden = false;
    } else {
      showcasePosBadge.hidden = true;
      showcasePosBadge.textContent = "";
    }
  }

  // 3. Pitch Accent
  if (showcasePitchBadge) {
    let pitchText = "";
    if (entries.length) {
      for (const e of entries) {
        if (Array.isArray(e.pitches) && e.pitches.length) {
          const p = e.pitches[0];
          if (p && (typeof p.position === "number" || p.pattern_name)) {
            const pat = (p.pattern_name || "").toLowerCase().trim();
            if (p.position === 0 || pat === "heiban") {
              pitchText = "⊚ heiban";
            } else if (pat) {
              const circle = typeof getPitchCircleNumber === "function" ? getPitchCircleNumber(p.position) : `[${p.position}]`;
              pitchText = `${circle} ${pat}`;
            } else if (typeof p.position === "number") {
              pitchText = typeof getPitchCircleNumber === "function" ? getPitchCircleNumber(p.position) : `[${p.position}]`;
            }
            break;
          }
        }
      }
    }
    if (pitchText) {
      showcasePitchBadge.textContent = pitchText;
      showcasePitchBadge.className = "kn-badge pitch";
      showcasePitchBadge.hidden = false;
    } else {
      showcasePitchBadge.hidden = true;
      showcasePitchBadge.textContent = "";
    }
  }
}
