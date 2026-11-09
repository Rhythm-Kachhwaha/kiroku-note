// ==========================================================================
// Module: sidepanel.js (Bootstrap Entry Point)
// Initializes tabs, loads preferences, runs startup checks, exports module API
// ==========================================================================

initAskResponseMode();

initGrammarUI();
loadAutoCapturePreferences();
loadRecentSubsPreferences();
loadVideoWorkspaceCollapsePreferences().catch(() => {});
initVideoCardCollapse();
checkLLMStatus().catch(() => {});
initLlmSettingsUI();
loadLlmConfigToSettings().catch(() => {});
loadJimakuApiKey().catch(() => {});
loadSubtitleFolderPreferences().catch(() => {});
checkHealthStatus().catch(() => {});
loadStoredCardTemplateSettings().catch(() => {});
loadStoredHistoryCollapseState().catch(() => {});
loadStoredDictionarySettings().catch(() => {});
initEditorJapaneseMode().catch(() => {});
updateDestinationIndicator();
loadStoredSectionOrder().then(order => {
  applySectionOrder(order);
}).catch(() => {});
if (typeof updateCardPreview === "function") updateCardPreview();
initQuickAdd();

// Group 5: Initialize Anime Transcript, Episode Map, and Session Logger
let animeTranscriptInstance = null;
let animeEpisodeMapInstance = null;
let animeSessionLoggerInstance = null;

try {
  const transcriptHost = document.querySelector("#anime-transcript-container");
  if (transcriptHost && typeof AnimeTranscript !== "undefined") {
    animeTranscriptInstance = new AnimeTranscript({
      container: transcriptHost,
      cues: typeof loadedSubtitleCues !== "undefined" ? loadedSubtitleCues : [],
      onSeek: (cue, ms) => {
        if (typeof seekToSubtitleCue === "function") {
          seekToSubtitleCue(cue);
        } else if (typeof broadcastToActiveVideo === "function") {
          broadcastToActiveVideo({ type: "SEEK_TO", ms });
        }
      }
    });
  }

  const episodeMapHost = document.querySelector("#anime-episode-map-container");
  if (episodeMapHost && typeof AnimeEpisodeMap !== "undefined") {
    animeEpisodeMapInstance = new AnimeEpisodeMap({
      container: episodeMapHost,
      onWordClick: (word) => {
        if (typeof identify === "function") {
          identify(word);
        }
      },
      onSeek: (ms) => {
        if (typeof broadcastToActiveVideo === "function") {
          broadcastToActiveVideo({ type: "SEEK_TO", ms });
        }
      }
    });
  }

  if (typeof AnimeSessionLogger !== "undefined") {
    animeSessionLoggerInstance = new AnimeSessionLogger({
      site: typeof lastCaptureSource !== "undefined" && lastCaptureSource?.site ? lastCaptureSource.site : "generic"
    });
  }
} catch (_) {}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
  chrome.runtime.sendMessage({type: "GET_MINING_MODE"}).then(res => {
    if (res?.enabled) updateMiningUI(true);
  }).catch(() => {});
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_CARD_TEMPLATE_SETTINGS,
    currentCardTemplateSettings,
    loadStoredCardTemplateSettings,
    saveStoredCardTemplateSettings,
    setHistoryCollapsed,
    loadStoredHistoryCollapseState,
    toggleHistoryCollapsed,
    updateDestinationIndicator,
    setEditorJapaneseMode,
    initEditorJapaneseMode,
    selectEditorCandidate,
    renderEditorSuggestions,
    clearEditorSuggestions,
    STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION,
    STORAGE_KEY_DISCOVERED_DICTIONARIES,
    STORAGE_KEY_HAS_EXPLICIT_DICTIONARY_SELECTION,
    getDiscoveredDictionaries: () => discoveredDictionaries,
    getSelectedDictionaries: () => selectedDictionaries,
    getHasExplicitDictionarySelection: () => hasExplicitDictionarySelection,
    setDiscoveredDictionaries: (s) => { discoveredDictionaries = new Set(s); },
    setSelectedDictionaries: (s) => { selectedDictionaries = new Set(s); },
    setHasExplicitDictionarySelection: (b) => { hasExplicitDictionarySelection = Boolean(b); },
    loadStoredDictionarySettings,
    saveStoredDictionarySettings,
    harvestDiscoveredDictionaries,
    refreshAvailableDictionaries,
    renderDictionarySelectionUI,
    reRenderActiveReferenceView,
    renderDetails,
    clearDictionaryView,
    btnTtsPlay,
    updateTtsPlayButton,
    checkClipboardForJapanese,
    showClipboardSuggestion,
    hideClipboardSuggestion,
    sortHistoryCards,
    loadStoredHistorySort,
    saveStoredHistorySort,
    checkAnkiStatus,
    triggerSyncAll,
    checkHealthStatus,
    checkSetupChecklist,
    showBackendBanner,
    hideBackendBanner,
    exportCardsCsv,
    btnExportCards,
    settingShowVerbType,
    updateHeroBadges,
    getCardPreviewData,
    settingFuriganaMode,
    JLPT_N4_N5_KANJI,
    isN4N5KanjiString,
    renderRubyText,
    renderStudySenseItem,
    renderHistoryCards,
    historyCardsList,
    getLastCaptureSource: () => lastCaptureSource,
    setLastCaptureSource: (s) => { lastCaptureSource = s; },
    switchMiningTab,
    checkLLMStatus,
    loadLlmConfigToSettings,
    applyLlmConfiguredState,
    saveLlmSecretFromSettings,
    startReplaceLlmKey,
    cancelReplaceLlmKey,
    removeLlmSecretFromSettings,
    initLlmSettingsUI,
    sendAskQuery,
    condenseNotes,
    openNotesComposer,
    setAskContext,
    clearAskContext,
    formatAIResponse,
    getAskChatHistory: () => askChatHistory,
    setAskChatHistory: (h) => { askChatHistory = h; },
    getAskResponseMode: () => currentAskResponseMode,
    setAskResponseMode,
    getCurrentAskTask: () => currentAskTask,
    setCurrentAskTask: (t) => { currentAskTask = t; },
    btnRefreshCloudQueue,
    triggerRefreshCloudQueue,
    annotatedCuesCache,
    annotateLoadedSubtitles,
    updateVideoCuePreviewText,
    setActiveSubSize,
    loadActiveSubSizeFromStorage,
    getActiveSubSize: () => currentActiveSubSize,
    API_SUBTITLE_ANNOTATE_URL,
    getCurrentActiveCue: () => currentActiveCue,
    setCurrentActiveCue: (c) => { currentActiveCue = c; },
    identify,
    mineSubtitleCueWord,
    getVideoWorkspaceCollapseMode: () => videoWorkspaceCollapseMode,
    setVideoWorkspaceCollapseMode,
    loadVideoWorkspaceCollapsePreferences,
    collapseVideoWorkspace,
    expandVideoWorkspace,
    scheduleVideoWorkspaceCollapse,
    updateCollapsedCardChip,
    getLastVideoCapturedCard: () => lastVideoCapturedCard,
    isCardEditorFocused,
    onSubtitleCueChanged: handleVideoCueChanged,
    saveCard,
    createGrammarCard,
    videoMissedWordsDrawer,
    videoMissedWordsHeader,
    videoMissedWordsBadge,
    videoMissedWordsBody,
    videoMissedWordsList,
    toggleMissedWordsDrawer,
    harvestMissedWords,
    renderMissedWordsDrawer,
    markWordAsKnown,
    mineMissedWord,
    getMissedWords: () => Array.from(missedWordsMap.values()),
    getMissedWordsMap: () => missedWordsMap,
    getMinedWordsSet: () => minedWordsSet,
    getMarkedKnownSet: () => markedKnownSet,
    setKnownWords,
    fetchKnownWords,
    API_KNOWN_WORDS_URL,
    API_KNOWN_WORDS_MARK_URL,
    getAnimeTranscript: () => animeTranscriptInstance,
    getAnimeEpisodeMap: () => animeEpisodeMapInstance,
    getAnimeSessionLogger: () => animeSessionLoggerInstance,
  };
}
