# Sidepanel Module Architecture Map

This document catalogs every extracted sidepanel module, detailing its purpose, top-level globals defined and consumed, interactive DOM IDs, corresponding CSS file, and covering tests.

---

## 1. `modules/core.js`
- **Lines:** 857
- **Purpose:** Core environment configuration, backend API endpoints, fetch interception/error banner, base application state variables, service connection indicators, and card template settings.
- **Top-Level Globals Defined:**
  - `BACKEND_BASE_URL`, `API_*` endpoint constants
  - `showBackendBanner`, `hideBackendBanner`, `isLocalKirokuApi`
  - `kanjiStrokesCache`, `annotatedCuesCache`, `minedWordsSet`, `markedKnownSet`, `missedWordsMap`, `grammarCueCache`
  - `GRAMMAR_SETTINGS_KEY`, `DEFAULT_GRAMMAR_SETTINGS`, `currentGrammarSettings`
  - `lastCaptureSource`, `DEFAULT_CARD_TEMPLATE_SETTINGS`, `currentCardTemplateSettings`
  - `loadStoredCardTemplateSettings`, `saveStoredCardTemplateSettings`
- **Top-Level Globals Consumed:**
  - `globalThis.fetch`
  - `chrome.storage.local`, `chrome.storage.sync`
- **DOM IDs:**
  - `#backend-error-banner`, `#backend-error-banner-message`, `#backend-error-banner-action`
  - `#field-deck-select`, `#field-model-select`, `#field-deck-name`, `#field-model-name`
  - `#btn-save-deck-template`, `#deck-template-status`
- **CSS File:** `css/base.css`, `css/shell.css`
- **Covering Tests:** `backend-port-centralization.test.js`, `boot_real_mode.test.js`, `sidepanel.test.js`

---

## 2. `modules/dictionaries.js`
- **Lines:** 1476
- **Purpose:** Yomitan dictionary discovery, reference dictionary selection management, definitions rendering, study sense items, pitch accent badges, and OCR screen crop processing.
- **Top-Level Globals Defined:**
  - `STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION`, `STORAGE_KEY_DISCOVERED_DICTIONARIES`, `STORAGE_KEY_HAS_EXPLICIT_DICTIONARY_SELECTION`
  - `discoveredDictionaries`, `selectedDictionaries`, `hasExplicitDictionarySelection`
  - `updateDictionaryCountLabel`, `renderDictionarySelectionUI`, `loadStoredDictionarySettings`, `saveStoredDictionarySettings`
  - `renderDetails`, `clearDictionaryView`, `renderStudySenseItem`, `formatPitchBadge`, `getPitchCircleNumber`
  - `handleOcrCropProcess`, `applyJapaneseFont`, `loadFontPreference`
- **Top-Level Globals Consumed:**
  - `API_YOMITAN_DICTIONARIES_URL`, `API_OCR_RECOGNIZE_URL`, `BACKEND_BASE_URL` (from `core.js`)
  - `KirokuOcrCropper` (from `lib/ocr-cropper.js`)
- **DOM IDs:**
  - `#dict-selection-list`, `#dict-selected-count`, `#dict-loading-indicator`, `#dict-empty-notice`
  - `#meanings`, `#examples`, `#panel-dictionary-content`
- **CSS File:** `css/dictionaries.css`
- **Covering Tests:** `dictionary-selection.test.js`, `dictionary-study-view.test.js`, `kanji-rendering.test.js`, `ocr-sidepanel-integration.test.js`

---

## 3. `modules/card-preview.js`
- **Lines:** 844
- **Purpose:** Live Anki Card Preview DOM rendering, front/back card presentation states, field preview generation, pitch accent pills, and drag-and-drop block reordering.
- **Top-Level Globals Defined:**
  - `currentPreviewSide`, `currentPreviewPresentation`, `previewContextKey`, `isPreviewEditing`
  - `emptyPreviewPresentation`, `setPreviewSide`, `scheduleCardPreviewUpdate`, `getCardPreviewData`, `renderCardPreviewDOM`, `updateCardPreview`
- **Top-Level Globals Consumed:**
  - `currentCardTemplateSettings` (from `core.js`)
  - `formatPitchBadge` (from `dictionaries.js`)
- **DOM IDs:**
  - `#card-preview-section`, `#card-preview-container`, `#card-preview-card`
  - `#preview-tab-front`, `#preview-tab-back`, `#preview-edit-toggle`
- **CSS File:** `css/text-card.css`, `css/misc.css`
- **Covering Tests:** `card-preview.test.js`, `front-toggle-and-edit.test.js`

---

## 4. `modules/card-editor.js`
- **Lines:** 2242
- **Purpose:** Form field binding, Japanese furigana density filtering (JLPT N4/N5 kanji set), optional field toggling, duplicate card check, and media previews.
- **Top-Level Globals Defined:**
  - `JLPT_N4_N5_KANJI`, `isN4N5KanjiString`, `updateMediaPreviews`, `refreshDuplicateState`
  - `fieldExpression`, `fieldReading`, `fieldMeaning`, `fieldHint`, `fieldExampleSentence`, `fieldExampleTranslation`
  - `fieldImage`, `fieldAudio`, `fieldTags`, `fieldNotes`, `fieldCardId`
- **Top-Level Globals Consumed:**
  - `currentDraftMedia`, `lastCaptureSource` (from `core.js`)
  - `scheduleCardPreviewUpdate` (from `card-preview.js`)
- **DOM IDs:**
  - `#field-expression`, `#field-reading`, `#field-meaning`, `#field-hint`
  - `#field-example-sentence`, `#field-example-translation`, `#field-image`, `#field-audio`, `#field-tags`, `#field-notes`
  - `#save-card-badge`, `#optional-details-toggle`, `#optional-fields-container`
- **CSS File:** `css/text-card.css`
- **Covering Tests:** `deck-aware-duplicate-ui.test.js`, `front-toggle-and-edit.test.js`, `save-card-entries.test.js`

---

## 5. `modules/text-mining.js`
- **Lines:** 1014
- **Purpose:** Card save form submission (`saveCard`), grammar card generation (`createGrammarCard`), Romaji-to-Kana Japanese input mode (IME assistance), and global keyboard shortcuts.
- **Top-Level Globals Defined:**
  - `createGrammarCard`, `saveCard`, `triggerSyncAll`
  - `setEditorJapaneseMode`, `initEditorJapaneseMode`, `updateDestinationIndicator`
- **Top-Level Globals Consumed:**
  - `API_SAVE_URL`, `API_CARD_SYNC_ALL_URL` (from `core.js`)
  - `fieldExpression`, `fieldReading`, `fieldMeaning`, `fieldDeckSelect` (from `card-editor.js`)
  - `wanakana` (from `lib/wanakana.js`)
- **DOM IDs:**
  - `#save-card-btn`, `#sync-anki-btn`, `#btn-editor-jp-mode`, `#destination-deck-val`, `#destination-model-val`
- **CSS File:** `css/text-card.css`, `css/shell.css`
- **Covering Tests:** `save-card-entries.test.js`, `sync-all-and-duplicates.test.js`, `jp-mode-regression.test.js`

---

## 6. `modules/history.js`
- **Lines:** 1399
- **Purpose:** Mining history list rendering, card sorting/filtering, batch card selection and operations (sync, bulk deck change, bulk delete), and 5-second undo toast.
- **Top-Level Globals Defined:**
  - `loadHistory`, `renderHistoryCards`, `sortHistoryCards`, `loadStoredHistorySort`, `saveStoredHistorySort`
  - `selectedHistoryCardIds`, `updateBulkActionBarState`, `deleteLocalCard`, `showUndoToast`, `exportCardsCsv`
- **Top-Level Globals Consumed:**
  - `API_CARDS_URL`, `API_CARDS_BULK_DELETE_URL`, `API_CARDS_BULK_SYNC_URL` (from `core.js`)
- **DOM IDs:**
  - `#history-section`, `#history-cards-list`, `#history-search-input`, `#history-deck-filter`
  - `#bulk-action-bar`, `#bulk-selected-count`, `#undo-toast`, `#btn-undo-delete`
- **CSS File:** `css/misc.css`
- **Covering Tests:** `sidepanel.test.js`, `cloud-queue-history-dom.test.js`, `tier1-features.test.js`

---

## 7. `modules/video-messaging.js`
- **Lines:** 130
- **Purpose:** Video mining timing offset formatting, runtime communication with content script video mining layer.
- **Top-Level Globals Defined:**
  - `formatOffset`, `sendVideoMiningCommand`
- **Top-Level Globals Consumed:**
  - `chrome.tabs`, `chrome.runtime`
- **DOM IDs:**
  - `#video-mining-view`, `#video-offset-display`
- **CSS File:** `css/video.css`
- **Covering Tests:** `subtitle-sync-offset.test.js`

---

## 8. `modules/subtitle-source.js`
- **Lines:** 152
- **Purpose:** Subtitle local disk folder selection, disk saving, and local subtitle file selection dropdown.
- **Top-Level Globals Defined:**
  - `saveSubtitleToDisk`, `loadSubtitleFolderPreferences`, `populateFolderSubtitlesSelect`
- **Top-Level Globals Consumed:**
  - `chrome.storage.local`
- **DOM IDs:**
  - `#folder-subtitles-select`, `#btn-select-sub-folder`, `#subtitle-folder-bar`
- **CSS File:** `css/video.css`
- **Covering Tests:** `subtitle-folder-and-jimaku.test.js`

---

## 9. `modules/jimaku.js`
- **Lines:** 837
- **Purpose:** Jimaku Japanese subtitle search API integration, API key storage, search results rendering, and subtitle track downloads.
- **Top-Level Globals Defined:**
  - `loadJimakuApiKey`, `saveJimakuApiKey`, `openJimakuModal`, `closeJimakuModal`, `searchJimakuSubtitles`
- **Top-Level Globals Consumed:**
  - `jimakuProvider` (from `lib/jimaku-provider.js`)
- **DOM IDs:**
  - `#jimaku-search-modal`, `#jimaku-api-key-input`, `#btn-save-jimaku-key`, `#jimaku-search-input`
  - `#jimaku-results-list`, `#btn-close-jimaku-modal`
- **CSS File:** `css/video.css`, `css/layout.css`
- **Covering Tests:** `subtitle-folder-and-jimaku.test.js`, `jimaku-provider.test.js`

---

## 10. `modules/annotation.js`
- **Lines:** 245
- **Purpose:** Subtitle font sizing preferences and backend annotation client for tokenization/parsing of subtitles.
- **Top-Level Globals Defined:**
  - `VALID_SUB_SIZES`, `DEFAULT_SUB_SIZE`, `currentActiveSubSize`, `setActiveSubSize`, `loadActiveSubSizeFromStorage`, `annotateLoadedSubtitles`
- **Top-Level Globals Consumed:**
  - `API_SUBTITLE_ANNOTATE_URL`, `annotatedCuesCache` (from `core.js`)
- **DOM IDs:**
  - `#sub-size-select`, `#subtitles-file-status`
- **CSS File:** `css/video.css`
- **Covering Tests:** `sidepanel-annotation-client.test.js`, `sidepanel-subtitles-ui.test.js`

---

## 11. `modules/missed-words.js`
- **Lines:** 270
- **Purpose:** Missed should-know words drawer management, known words mark actions, and vocabulary harvesting from subtitle tracks.
- **Top-Level Globals Defined:**
  - `toggleMissedWordsDrawer`, `harvestMissedWords`, `renderMissedWordsDrawer`, `markWordAsKnown`, `mineMissedWord`, `fetchKnownWords`
- **Top-Level Globals Consumed:**
  - `API_KNOWN_WORDS_URL`, `API_KNOWN_WORDS_MARK_URL`, `markedKnownSet`, `minedWordsSet`, `missedWordsMap` (from `core.js`)
- **DOM IDs:**
  - `#video-missed-words-drawer`, `#video-missed-words-header`, `#video-missed-words-badge`, `#video-missed-words-body`, `#video-missed-words-list`
- **CSS File:** `css/video.css`
- **Covering Tests:** `missed-words-drawer.test.js`

---

## 12. `modules/cue-search.js`
- **Lines:** 414
- **Purpose:** In-track subtitle full-text search, recent subtitle cues buffer, and sentence mining from previous cues.
- **Top-Level Globals Defined:**
  - `loadActiveSubtitleCuesFromStorage`, `searchSubtitles`, `renderRecentSubtitleCues`, `handleMineFullSentence`
- **Top-Level Globals Consumed:**
  - `loadedSubtitleCues`, `recentSubtitleCues`
- **DOM IDs:**
  - `#subtitle-search-input`, `#subtitle-search-results`, `#recent-cues-list`
- **CSS File:** `css/video.css`
- **Covering Tests:** `subtitle-selection-and-ask-mode.test.js`, `video-tab-declutter-dom.test.js`

---

## 13. `modules/video-hero.js`
- **Lines:** 767
- **Purpose:** Video tab hero view, card workspace auto-collapse state machine, video playback state handlers, and fullscreen controls.
- **Top-Level Globals Defined:**
  - `isCardEditorFocused`, `collapseVideoWorkspace`, `expandVideoWorkspace`, `scheduleVideoWorkspaceCollapse`, `handleVideoCueChanged`
- **Top-Level Globals Consumed:**
  - `lastVideoCapturedCard`, `videoWorkspaceCollapseMode`
- **DOM IDs:**
  - `#video-hero-container`, `#video-card-chip`, `#video-cue-text`
- **CSS File:** `css/video.css`, `css/layout.css`
- **Covering Tests:** `video-card-collapse.test.js`, `video-mode-declutter-and-fullscreen.test.js`

---

## 14. `modules/messaging.js`
- **Lines:** 200
- **Purpose:** Runtime `chrome.runtime.onMessage` listener router (handling `JAPANESE_TEXT_CAPTURED`, screenshot captures, grammar triggers) and `chrome.storage.onChanged` sync.
- **Top-Level Globals Defined:**
  - Message routing event listeners
- **Top-Level Globals Consumed:**
  - `identify` (from `dictionaries.js`), `renderTextGrammar` (from `ask.js`), `updateOffsetDisplay` (from `video-messaging.js`)
- **DOM IDs:**
  - None directly (routes to specific module handlers)
- **CSS File:** N/A
- **Covering Tests:** `sidepanel.test.js`, `ocr-background-routing.test.js`

---

## 15. `modules/layout.js`
- **Lines:** 377
- **Purpose:** Customizable card section layout ordering (drag-and-drop or move buttons) and persistence in storage.
- **Top-Level Globals Defined:**
  - `resolveValidSectionOrder`, `applySectionOrder`, `loadStoredSectionOrder`, `saveStoredSectionOrder`, `moveSectionByDelta`, `resetSectionOrder`
- **Top-Level Globals Consumed:**
  - `chrome.storage.local`
- **DOM IDs:**
  - `#layout-sections-list`, `#btn-reset-layout`, `#btn-layout-settings`, `#layout-settings-popover`
- **CSS File:** `css/layout.css`
- **Covering Tests:** `customizable-layout.test.js`

---

## 16. `modules/ask.js`
- **Lines:** 1010
- **Purpose:** Tier 5 AI Assistant Ask tab, LLM configuration, prompt chips, notes condenser, and grammar breakdown integration.
- **Top-Level Globals Defined:**
  - `askChatHistory`, `sendAskQuery`, `condenseNotes`, `setAskContext`, `clearAskContext`, `formatAIResponse`, `initLlmSettingsUI`
- **Top-Level Globals Consumed:**
  - `API_LLM_ASK_URL`, `API_LLM_STATUS_URL`, `API_LLM_CONFIG_URL` (from `core.js`)
- **DOM IDs:**
  - `#ask-mining-view`, `#ask-input-box`, `#btn-ask-submit`, `#ask-chat-history`, `#ask-mode-picker`, `#btn-ask-new-chat`
- **CSS File:** `css/ask.css`
- **Covering Tests:** `tier5-ask-tab.test.js`, `ask-tab-notes-condenser.test.js`, `text-ask-transfer.test.js`

---

## 17. `sidepanel.js` (Bootstrap Entry Point)
- **Lines:** 162
- **Purpose:** Minimal top-level startup script. Initializes active tab states, loads stored settings (fonts, history collapse, dictionaries, layouts), registers root listener hooks, and exports testing module API.
- **Covering Tests:** `boot_real_mode.test.js`, `end-user-dry-run.test.js`, `sidepanel.test.js`
