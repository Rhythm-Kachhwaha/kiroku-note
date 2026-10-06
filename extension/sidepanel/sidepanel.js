const BACKEND_BASE_URL = "http://127.0.0.1:21828";
const API_CAPTURE_URL = `${BACKEND_BASE_URL}/api/capture`;
const API_SAVE_URL = `${BACKEND_BASE_URL}/api/cards/save`;
const API_ANKI_STATUS_URL = `${BACKEND_BASE_URL}/api/anki/status`;
const API_ANKI_DECKS_URL = `${BACKEND_BASE_URL}/api/anki/decks`;
const API_ANKI_MODELS_URL = `${BACKEND_BASE_URL}/api/anki/models`;
const API_CARD_SYNC_URL = (id) => `${BACKEND_BASE_URL}/api/cards/${id}/sync`;
const API_CARD_SYNC_ALL_URL = `${BACKEND_BASE_URL}/api/cards/sync-all`;
const API_CARDS_URL = `${BACKEND_BASE_URL}/api/cards`;
const API_CARD_DETAIL_URL = (id) => `${BACKEND_BASE_URL}/api/cards/${id}`;
const API_OCR_STATUS_URL = `${BACKEND_BASE_URL}/api/ocr/status`;
const API_OCR_RECOGNIZE_URL = `${BACKEND_BASE_URL}/api/ocr/recognize`;
const API_YOMITAN_DICTIONARIES_URL = `${BACKEND_BASE_URL}/api/yomitan/dictionaries`;
const API_HEALTH_URL = `${BACKEND_BASE_URL}/api/health`;
const API_CARDS_STATS_URL = `${BACKEND_BASE_URL}/api/cards/stats`;
const API_CARDS_BULK_DELETE_URL = `${BACKEND_BASE_URL}/api/cards/bulk`;
const API_CARDS_BULK_SYNC_URL = `${BACKEND_BASE_URL}/api/cards/bulk-sync`;
const API_CARDS_BULK_DECK_URL = `${BACKEND_BASE_URL}/api/cards/bulk-deck`;
const API_KANJI_STROKES_URL = (char) => `${BACKEND_BASE_URL}/api/kanji/strokes/${encodeURIComponent(char)}`;
const API_LLM_STATUS_URL = `${BACKEND_BASE_URL}/api/llm/status`;
const API_LLM_ASK_URL = `${BACKEND_BASE_URL}/api/llm/ask`;
const API_LLM_CONFIG_URL = `${BACKEND_BASE_URL}/api/llm/config`;
const API_LLM_SECRET_URL = `${BACKEND_BASE_URL}/api/llm/secret`;

const kanjiStrokesCache = new Map();

async function getKanjiStrokeSvg(character) {
  if (!character) return null;
  const cleanChar = String(character).trim();
  const char = cleanChar.length > 1 ? cleanChar[0] : cleanChar;
  if (kanjiStrokesCache.has(char)) {
    return kanjiStrokesCache.get(char);
  }
  try {
    const res = await fetch(API_KANJI_STROKES_URL(char));
    if (!res.ok) {
      kanjiStrokesCache.set(char, null);
      return null;
    }
    const svgText = await res.text();
    kanjiStrokesCache.set(char, svgText);
    return svgText;
  } catch (err) {
    return null;
  }
}

function createStrokeSvgElement(svgText) {
  if (!svgText) return null;
  if (typeof DOMParser !== "undefined") {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, "image/svg+xml");
      if (!doc.querySelector("parsererror")) {
        const svg = doc.documentElement;
        if (svg && svg.tagName && svg.tagName.toLowerCase() === "svg") {
          svg.classList.add("stroke-order-svg");
          return svg;
        }
      }
    } catch (err) {
      // fallback below
    }
  }
  if (typeof document !== "undefined") {
    try {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = svgText;
      const svg = tempDiv.querySelector("svg");
      if (svg) {
        svg.classList.add("stroke-order-svg");
        return svg;
      }
    } catch (e) {
      // ignore
    }
  }
  return null;
}

if (typeof chrome === "undefined") {
  const _listeners = [];
  globalThis.chrome = {
    runtime: {
      sendMessage: (msg) => {
        _listeners.forEach(fn => { try { fn(msg, {}, () => {}); } catch (_) {} });
        return Promise.resolve({ ok: true });
      },
      onMessage: {
        addListener: (fn) => { _listeners.push(fn); },
        removeListener: (fn) => {
          const idx = _listeners.indexOf(fn);
          if (idx !== -1) _listeners.splice(idx, 1);
        },
        _dispatch: (msg) => {
          _listeners.forEach(fn => { try { fn(msg, {}, () => {}); } catch (_) {} });
        }
      }
    },
    storage: {
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() },
      onChanged: { addListener: () => {} }
    }
  };
}

const toggle = document.querySelector("#mining-toggle");
const ocrCaptureBtn = document.querySelector("#ocr-capture-btn");
const mode = document.querySelector("#mode");
const sessionCountEl = document.querySelector("#session-count");
const quickAddSessionCountEl = document.querySelector("#quickadd-session-count");
const status = document.querySelector("#capture-status");
const saveBadge = document.querySelector("#save-badge");
const quickAddSaveBadge = document.querySelector("#quickadd-save-badge");

function setSaveBadge(text, className = "badge", isVisible = true) {
  [saveBadge, quickAddSaveBadge].forEach(badge => {
    if (badge) {
      badge.textContent = isVisible ? text : "";
      badge.className = isVisible ? className : "badge";
      badge.hidden = !isVisible;
    }
  });
}
const expression = document.querySelector("#expression");
const reading = document.querySelector("#reading");
const wordMeaningsSummary = document.querySelector("#word-meanings-summary");
const showcaseJlptBadge = document.querySelector("#showcase-jlpt-badge");
const showcasePosBadge = document.querySelector("#showcase-pos-badge");
const showcasePitchBadge = document.querySelector("#showcase-pitch-badge");
const btnTtsPlay = document.querySelector("#btn-tts-play");
const clipboardSuggestionBar = document.querySelector("#clipboard-suggestion-bar");
const clipboardSuggestionText = document.querySelector("#clipboard-suggestion-text");
const btnClipboardCapture = document.querySelector("#btn-clipboard-capture");
const btnClipboardDismiss = document.querySelector("#btn-clipboard-dismiss");
const historySortSelect = document.querySelector("#history-sort-select");
const STORAGE_KEY_HISTORY_SORT = "kiroku.history.sortOrder";
let currentHistorySort = "date-desc";
let lastSeenClipboardText = "";
let lastDismissedClipboardText = "";
let prevAnkiStatus = null;
const meanings = document.querySelector("#meanings");
const examples = document.querySelector("#examples");
const dictActionsBar = document.querySelector("#dict-actions-bar");
const btnCopyRawDict = document.querySelector("#btn-copy-raw-dict");
const dictLoadingIndicator = document.querySelector("#dict-loading-indicator");
const dictEmptyNotice = document.querySelector("#dict-empty-notice");
const firstRunGuide = document.querySelector("#first-run-guide");
const btnDismissFirstRun = document.querySelector("#btn-dismiss-first-run");
let currentDictionaryEntries = [];
let currentKanjiEntries = [];

// Indicators
const indicatorYomitan = document.querySelector("#indicator-yomitan");
const indicatorAnki = document.querySelector("#indicator-anki");
const indicatorOcr = document.querySelector("#indicator-ocr");

let ocrAvailable = false;
let ocrLoaded = false;

// Card Editor elements
const cardEditor = document.querySelector("#card-editor");
const fieldCardId = document.querySelector("#field-card-id");
const fieldDeckName = document.querySelector("#field-deck-name");
const fieldDeckSelect = document.querySelector("#field-deck-select");
const fieldModelName = document.querySelector("#field-model-name");
const fieldModelSelect = document.querySelector("#field-model-select");
const fieldFontSelect = document.querySelector("#field-font-select");
const fieldSourceText = document.querySelector("#field-source-text");
const fieldDeinflectedText = document.querySelector("#field-deinflected-text");
const fieldExpression = document.querySelector("#field-expression");
const fieldReading = document.querySelector("#field-reading");
const fieldMeaning = document.querySelector("#field-meaning");
const toggleOptionalBtn = document.querySelector("#toggle-optional");
const optionalDetails = document.querySelector("#optional-details");
const optionalFields = document.querySelector("#optional-fields");
const fieldHint = document.querySelector("#field-hint");
const fieldExampleSentence = document.querySelector("#field-example-sentence");
const fieldExampleTranslation = document.querySelector("#field-example-translation");
const fieldImage = document.querySelector("#field-image");
const fieldAudio = document.querySelector("#field-audio");
const fieldTags = document.querySelector("#field-tags");
const fieldNotes = document.querySelector("#field-notes");
const saveCardBtn = document.querySelector("#save-card-btn");
const syncAnkiBtn = document.querySelector("#sync-anki-btn");
const btnAskFromText = document.querySelector("#btn-ask-from-text");
const ankiSyncStatus = document.querySelector("#anki-sync-status");

// 1-Click Card Front Toggle (Kanji vs. Kana)
const frontToggleRow = document.querySelector("#front-toggle-row");
const btnFrontKanji = document.querySelector("#btn-front-kanji");
const btnFrontKana = document.querySelector("#btn-front-kana");
let currentActiveKanji = "";
let currentActiveKana = "";
let currentFrontPreference = "kanji"; // "kanji" | "kana"

function isKanaOnly(str) {
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  if (!s) return false;
  return typeof wanakana !== "undefined" && typeof wanakana.isKana === "function"
    ? wanakana.isKana(s)
    : /^[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9f\u30fc\u30fb\s]+$/.test(s);
}

function hasKanji(str) {
  if (!str || typeof str !== "string") return false;
  return /[\u4e00-\u9faf\u3400-\u4dbf]/.test(str);
}

function updateFrontToggleUI(kanji, kana, currentFront) {
  currentActiveKanji = kanji ? String(kanji).trim() : "";
  currentActiveKana = kana ? String(kana).trim() : "";
  currentFrontPreference = currentFront === "kana" ? "kana" : "kanji";

  if (!frontToggleRow) return;

  const hasBoth = Boolean(
    currentActiveKanji &&
    currentActiveKana &&
    currentActiveKanji !== currentActiveKana &&
    hasKanji(currentActiveKanji)
  );

  frontToggleRow.hidden = !hasBoth;
  if (!hasBoth) return;

  if (btnFrontKanji) {
    btnFrontKanji.textContent = "漢";
    btnFrontKanji.classList.toggle("active", currentFrontPreference === "kanji");
    btnFrontKanji.setAttribute("aria-pressed", String(currentFrontPreference === "kanji"));
  }
  if (btnFrontKana) {
    btnFrontKana.textContent = "あ";
    btnFrontKana.classList.toggle("active", currentFrontPreference === "kana");
    btnFrontKana.setAttribute("aria-pressed", String(currentFrontPreference === "kana"));
  }
}

function setCardFrontPreference(preference) {
  if (preference !== "kana" && preference !== "kanji") return;
  if (!currentActiveKanji && !currentActiveKana) return;

  currentFrontPreference = preference;
  const isKana = preference === "kana";
  const newFront = isKana && currentActiveKana ? currentActiveKana : (currentActiveKanji || currentActiveKana);
  const newReading = currentActiveKana || currentActiveKanji;

  if (typeof fieldExpression !== "undefined" && fieldExpression) fieldExpression.value = newFront;
  if (typeof fieldReading !== "undefined" && fieldReading) fieldReading.value = newReading;
  if (typeof expression !== "undefined" && expression) expression.textContent = newFront || "—";
  if (typeof updateHeroReading === "function") {
    updateHeroReading(currentActiveKana || currentActiveKanji || "", newFront);
  }

  updateFrontToggleUI(currentActiveKanji, currentActiveKana, preference);
  if (typeof scheduleCardPreviewUpdate === "function") scheduleCardPreviewUpdate();
  if (typeof isCardDraftDirtyState !== "undefined") isCardDraftDirtyState = true;
}

if (btnFrontKanji) {
  btnFrontKanji.addEventListener("click", () => setCardFrontPreference("kanji"));
}
if (btnFrontKana) {
  btnFrontKana.addEventListener("click", () => setCardFrontPreference("kana"));
}

// Card preview elements
const cardPreviewSection = document.querySelector("#card-preview-section");
const cardPreviewContainer = document.querySelector("#card-preview-container");
const cardPreviewCard = document.querySelector("#card-preview-card");
const previewTabFront = document.querySelector("#preview-tab-front");
const previewTabBack = document.querySelector("#preview-tab-back");
const previewEditToggle = document.querySelector("#preview-edit-toggle");

// Media preview elements
const mediaPreviewContainer = document.querySelector("#media-preview-container");
const imagePreviewContainer = document.querySelector("#image-preview-container");
const imagePreview = document.querySelector("#image-preview");
const imageEmptyPlaceholder = document.querySelector("#image-empty-placeholder");
const btnClearImage = document.querySelector("#btn-clear-image");
const audioPreviewContainer = document.querySelector("#audio-preview-container");
const audioPreview = document.querySelector("#audio-preview");
const audioEmptyPlaceholder = document.querySelector("#audio-empty-placeholder");
const audioPlaceholderText = document.querySelector("#audio-placeholder-text");
const audioStatusBadge = document.querySelector("#audio-status-badge");
const btnReplayAudio = document.querySelector("#btn-replay-audio");
const btnClearAudio = document.querySelector("#btn-clear-audio");
const mediaPreviewCollapsible = document.querySelector("#media-preview-collapsible");
const mediaSummaryBadge = document.querySelector("#media-summary-badge");

// Layout Settings & Reordering elements
const STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER = "kiroku.layout.cardSectionOrder";
const DEFAULT_CARD_SECTION_ORDER = [
  "fields",
  "preview",
  "media",
  "settings",
  "optional",
  "dictionary"
];
const DEFAULT_CARD_SECTION_VISIBILITY = {
  fields: true,
  preview: true,
  media: true,
  settings: true,
  optional: true,
  dictionary: true
};
let currentCardSectionVisibility = { ...DEFAULT_CARD_SECTION_VISIBILITY };

const SECTION_METADATA = {
  fields: { id: "fields", name: "Card Fields" },
  preview: { id: "preview", name: "Card Preview" },
  media: { id: "media", name: "Media" },
  settings: { id: "settings", name: "Card Settings" },
  optional: { id: "optional", name: "Optional Fields" },
  dictionary: { id: "dictionary", name: "Dictionary" }
};

const cardLayoutContainer = document.querySelector("#card-layout-container");
const btnLayoutSettings = document.querySelector("#btn-layout-settings");
const layoutSettingsPopover = document.querySelector("#layout-settings-popover") || document.querySelector("#card-settings-popover");
const btnCloseLayoutSettings = document.querySelector("#btn-close-layout-settings") || document.querySelector("#btn-close-card-settings");
const layoutSectionsList = document.querySelector("#layout-sections-list");
const btnResetLayout = document.querySelector("#btn-reset-layout");

// Card Settings elements
const cardSettingsPopover = document.querySelector("#card-settings-popover") || layoutSettingsPopover;
const btnCloseCardSettings = document.querySelector("#btn-close-card-settings") || btnCloseLayoutSettings;
const settingFrontReading = document.querySelector("#setting-front-reading");
const settingFrontMeaning = document.querySelector("#setting-front-meaning");
const settingFrontKanjiReading = document.querySelector("#setting-front-kanji-reading");
const settingFrontHint = document.querySelector("#setting-front-hint");
const settingBackReading = document.querySelector("#setting-back-reading");
const settingBackMeaning = document.querySelector("#setting-back-meaning");
const settingBackHint = document.querySelector("#setting-back-hint");
const settingFuriganaMode = document.querySelector("#setting-furigana-mode");
const settingShowJlpt = document.querySelector("#setting-show-jlpt");
const settingShowVerbType = document.querySelector("#setting-show-verb-type");
const settingShowHistory = document.querySelector("#setting-show-history");
const btnSaveDeckTemplate = document.querySelector("#btn-save-deck-template");
const deckTemplateStatus = document.querySelector("#deck-template-status");

// Yomitan Dictionaries Settings elements
const btnRefreshDictList = document.querySelector("#btn-refresh-dict-list");
const btnDictSelectAll = document.querySelector("#btn-dict-select-all");
const btnDictClearAll = document.querySelector("#btn-dict-clear-all");
const dictSelectedCountLabel = document.querySelector("#dict-selected-count-label");
const dictSelectionItems = document.querySelector("#dict-selection-items");
const dictSelectionEmpty = document.querySelector("#dict-selection-empty");

const STORAGE_KEY_REFERENCE_DICTIONARY_SELECTION = "kiroku.reference_dictionary_selection";
const STORAGE_KEY_DISCOVERED_DICTIONARIES = "kiroku.discovered_dictionaries";
const STORAGE_KEY_HAS_EXPLICIT_DICTIONARY_SELECTION = "kiroku.has_explicit_dictionary_selection";

let discoveredDictionaries = new Set();
let selectedDictionaries = new Set();
let hasExplicitDictionarySelection = false;

// Destination & Japanese input elements
const cardTargetDestination = document.querySelector("#card-target-destination");
const destDeckVal = document.querySelector("#dest-deck-val");
const destModelVal = document.querySelector("#dest-model-val");
const btnEditorJpMode = document.querySelector("#btn-editor-jp-mode");
const editorSuggestionsContainer = document.querySelector("#editor-suggestions-container");
const editorSuggestionsList = document.querySelector("#editor-suggestions-list");

const STORAGE_KEY_CARD_TEMPLATE_SETTINGS = "kiroku.card_template_settings";
const STORAGE_KEY_SHOW_JLPT_LEVEL = "kiroku.settings.showJlptLevel";
const DEFAULT_CARD_TEMPLATE_SETTINGS = {
  front: {
    show_reading: false,
    show_meaning: false,
    show_kanji_reading: false,
    show_hint: false,
  },
  back: {
    show_reading: true,
    show_meaning: true,
    show_hint: true,
  },
  furigana_mode: "all",
  show_jlpt: true,
  show_verb_type: true,
  show_history: true,
};
let currentCardTemplateSettings = JSON.parse(JSON.stringify(DEFAULT_CARD_TEMPLATE_SETTINGS));
let storedDeckTemplateProfiles = {};

function getCurrentDeckName() {
  return (typeof fieldDeckSelect !== "undefined" && fieldDeckSelect && fieldDeckSelect.value && fieldDeckSelect.value.trim()) ||
         (typeof fieldDeckName !== "undefined" && fieldDeckName && fieldDeckName.value && fieldDeckName.value.trim()) ||
         (typeof destDeckVal !== "undefined" && destDeckVal && destDeckVal.textContent && destDeckVal.textContent.trim()) ||
         "Default";
}

function getDeckTemplateProfile(deckName) {
  const targetDeck = (deckName && deckName.trim()) || getCurrentDeckName();
  if (storedDeckTemplateProfiles && storedDeckTemplateProfiles[targetDeck]) {
    return storedDeckTemplateProfiles[targetDeck];
  }
  if (storedDeckTemplateProfiles && storedDeckTemplateProfiles["Default"]) {
    return storedDeckTemplateProfiles["Default"];
  }
  return DEFAULT_CARD_TEMPLATE_SETTINGS;
}

function loadDeckTemplateSettings(deckName) {
  const profile = getDeckTemplateProfile(deckName);
  currentCardTemplateSettings = {
    front: { ...DEFAULT_CARD_TEMPLATE_SETTINGS.front, ...(profile.front || {}) },
    back: { ...DEFAULT_CARD_TEMPLATE_SETTINGS.back, ...(profile.back || {}) },
    furigana_mode: profile.furigana_mode || DEFAULT_CARD_TEMPLATE_SETTINGS.furigana_mode,
    show_jlpt: typeof profile.show_jlpt === "boolean" ? profile.show_jlpt : true,
    show_verb_type: typeof profile.show_verb_type === "boolean" ? profile.show_verb_type : true,
    show_history: typeof profile.show_history === "boolean" ? profile.show_history : true,
  };
  syncCardTemplateSettingsUI();
  if (typeof updateCardPreview === "function") {
    updateCardPreview();
  }
}

function applyHistoryVisibility() {
  const historySec = document.querySelector("#history-section");
  if (!historySec) return;
  const showHistory = currentMiningTab === "history" && currentCardTemplateSettings?.show_history !== false;
  historySec.hidden = !showHistory;
  historySec.style.display = showHistory ? "" : "none";
}

async function loadStoredCardTemplateSettings() {
  try {
    let rawStored = null;
    let storedJlpt = null;
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get([STORAGE_KEY_CARD_TEMPLATE_SETTINGS, STORAGE_KEY_SHOW_JLPT_LEVEL]);
      if (data) {
        rawStored = data[STORAGE_KEY_CARD_TEMPLATE_SETTINGS];
        storedJlpt = data[STORAGE_KEY_SHOW_JLPT_LEVEL];
      }
    } else if (typeof localStorage !== "undefined") {
      const s = localStorage.getItem(STORAGE_KEY_CARD_TEMPLATE_SETTINGS);
      if (s) {
        try { rawStored = JSON.parse(s); } catch (_) {}
      }
      const j = localStorage.getItem(STORAGE_KEY_SHOW_JLPT_LEVEL);
      if (j !== null) {
        try { storedJlpt = JSON.parse(j); } catch (_) {}
      }
    }

    if (rawStored && typeof rawStored === "object") {
      if (rawStored.front || rawStored.back || typeof rawStored.show_jlpt === "boolean" || rawStored.furigana_mode) {
        // Migrate legacy flat structure to Default profile
        storedDeckTemplateProfiles = {
          "Default": {
            front: { ...DEFAULT_CARD_TEMPLATE_SETTINGS.front, ...(rawStored.front || {}) },
            back: { ...DEFAULT_CARD_TEMPLATE_SETTINGS.back, ...(rawStored.back || {}) },
            furigana_mode: rawStored.furigana_mode || DEFAULT_CARD_TEMPLATE_SETTINGS.furigana_mode,
            show_jlpt: typeof rawStored.show_jlpt === "boolean"
              ? rawStored.show_jlpt
              : (typeof storedJlpt === "boolean" ? storedJlpt : true),
            show_verb_type: typeof rawStored.show_verb_type === "boolean" ? rawStored.show_verb_type : true,
            show_history: typeof rawStored.show_history === "boolean" ? rawStored.show_history : true,
          }
        };
      } else {
        storedDeckTemplateProfiles = rawStored;
      }
    } else {
      storedDeckTemplateProfiles = {
        "Default": JSON.parse(JSON.stringify(DEFAULT_CARD_TEMPLATE_SETTINGS))
      };
      if (typeof storedJlpt === "boolean") {
        storedDeckTemplateProfiles["Default"].show_jlpt = storedJlpt;
      }
    }

    const currentDeck = getCurrentDeckName();
    loadDeckTemplateSettings(currentDeck);
  } catch (err) {
    console.warn("Failed to load stored card template settings:", err);
    syncCardTemplateSettingsUI();
  }
}

async function saveStoredCardTemplateSettings(targetDeckName) {
  const deckName = (targetDeckName && targetDeckName.trim()) || getCurrentDeckName();
  if (!storedDeckTemplateProfiles || typeof storedDeckTemplateProfiles !== "object") {
    storedDeckTemplateProfiles = {};
  }
  storedDeckTemplateProfiles[deckName] = JSON.parse(JSON.stringify(currentCardTemplateSettings));
  if (!storedDeckTemplateProfiles["Default"]) {
    storedDeckTemplateProfiles["Default"] = JSON.parse(JSON.stringify(currentCardTemplateSettings));
  }
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({
        [STORAGE_KEY_CARD_TEMPLATE_SETTINGS]: storedDeckTemplateProfiles,
        [STORAGE_KEY_SHOW_JLPT_LEVEL]: currentCardTemplateSettings.show_jlpt !== false,
      });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_CARD_TEMPLATE_SETTINGS, JSON.stringify(storedDeckTemplateProfiles));
      localStorage.setItem(STORAGE_KEY_SHOW_JLPT_LEVEL, JSON.stringify(currentCardTemplateSettings.show_jlpt !== false));
    }
  } catch (err) {
    console.warn("Failed to save card template settings:", err);
  }
  applyHistoryVisibility();
  if (typeof updateCardPreview === "function") {
    updateCardPreview();
  }
}

function syncCardTemplateSettingsUI() {
  if (settingFrontReading) settingFrontReading.checked = Boolean(currentCardTemplateSettings?.front?.show_reading);
  if (settingFrontMeaning) settingFrontMeaning.checked = Boolean(currentCardTemplateSettings?.front?.show_meaning);
  if (settingFrontKanjiReading) settingFrontKanjiReading.checked = Boolean(currentCardTemplateSettings?.front?.show_kanji_reading);
  if (settingFrontHint) settingFrontHint.checked = Boolean(currentCardTemplateSettings?.front?.show_hint);
  if (settingBackReading) settingBackReading.checked = currentCardTemplateSettings?.back?.show_reading !== false;
  if (settingBackMeaning) settingBackMeaning.checked = currentCardTemplateSettings?.back?.show_meaning !== false;
  if (settingBackHint) settingBackHint.checked = currentCardTemplateSettings?.back?.show_hint !== false;
  if (settingFuriganaMode) settingFuriganaMode.value = currentCardTemplateSettings?.furigana_mode || "all";
  if (settingShowJlpt) settingShowJlpt.checked = currentCardTemplateSettings?.show_jlpt !== false;
  if (settingShowVerbType) settingShowVerbType.checked = currentCardTemplateSettings?.show_verb_type !== false;
  if (settingShowHistory) settingShowHistory.checked = currentCardTemplateSettings?.show_history !== false;
  applyHistoryVisibility();
}

[
  { el: settingFrontReading, section: "front", key: "show_reading" },
  { el: settingFrontMeaning, section: "front", key: "show_meaning" },
  { el: settingFrontKanjiReading, section: "front", key: "show_kanji_reading" },
  { el: settingFrontHint, section: "front", key: "show_hint" },
  { el: settingBackReading, section: "back", key: "show_reading" },
  { el: settingBackMeaning, section: "back", key: "show_meaning" },
  { el: settingBackHint, section: "back", key: "show_hint" },
].forEach(({ el, section, key }) => {
  if (el) {
    el.addEventListener("change", () => {
      if (!currentCardTemplateSettings[section]) currentCardTemplateSettings[section] = {};
      currentCardTemplateSettings[section][key] = el.checked;
      saveStoredCardTemplateSettings();
    });
  }
});

if (settingFuriganaMode) {
  settingFuriganaMode.addEventListener("change", () => {
    currentCardTemplateSettings.furigana_mode = settingFuriganaMode.value;
    saveStoredCardTemplateSettings();
    if (typeof updateCardPreview === "function") {
      updateCardPreview();
    }
  });
}

if (settingShowJlpt) {
  settingShowJlpt.addEventListener("change", () => {
    currentCardTemplateSettings.show_jlpt = settingShowJlpt.checked;
    saveStoredCardTemplateSettings();
  });
}

if (settingShowVerbType) {
  settingShowVerbType.addEventListener("change", () => {
    currentCardTemplateSettings.show_verb_type = settingShowVerbType.checked;
    saveStoredCardTemplateSettings();
  });
}

if (settingShowHistory) {
  settingShowHistory.addEventListener("change", () => {
    currentCardTemplateSettings.show_history = settingShowHistory.checked;
    saveStoredCardTemplateSettings();
  });
}

if (btnSaveDeckTemplate) {
  btnSaveDeckTemplate.addEventListener("click", async () => {
    const deckName = getCurrentDeckName();
    await saveStoredCardTemplateSettings(deckName);
    if (deckTemplateStatus) {
      deckTemplateStatus.textContent = `Saved for ${deckName}!`;
      deckTemplateStatus.hidden = false;
      setTimeout(() => {
        if (deckTemplateStatus) deckTemplateStatus.hidden = true;
      }, 2500);
    }
  });
}

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
const historyEmpty = document.querySelector("#history-empty");
const historyCardsList = document.querySelector("#history-cards-list");
const btnSyncAll = document.querySelector("#btn-sync-all");
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
const toggleAutoPauseHover = document.querySelector("#toggle-auto-pause-hover");
const toggleSubtitlesDisplay = document.querySelector("#toggle-subtitles-display");
const toggleAutoCaptureFrame = document.querySelector("#toggle-auto-capture-frame");
const toggleAutoCaptureAudio = document.querySelector("#toggle-auto-capture-audio");

// Subtitle Search, Recent Cues & Sentence Mining (T4-B, T4-C, T4-F)
const btnMineFullSentence = document.querySelector("#btn-mine-full-sentence");
const subtitleSearchSection = document.querySelector("#subtitle-search-section");
const subtitleSearchInput = document.querySelector("#subtitle-search-input");
const subtitleSearchResults = document.querySelector("#subtitle-search-results");
const btnClearSubtitleSearch = document.querySelector("#btn-clear-subtitle-search");
const recentCuesSection = document.querySelector("#recent-cues-section");
const recentCuesList = document.querySelector("#recent-cues-list");
const toggleShowRecentSubs = document.querySelector("#toggle-show-recent-subs");

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
  audioStatus: "idle", // "available" | "pending" | "unavailable" | "expired" | "discontinuity" | "idle"
  audioError: null,
  mimeType: null,
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
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Sent to Anki";
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
  if (btnRetakeAudio) {
    if (!currentModelCapabilities.supports_audio && ankiConnected) {
      btnRetakeAudio.title = "Selected Anki model lacks audio field (saved locally only)";
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
  const text = (exprText !== undefined ? exprText : (fieldExpression ? fieldExpression.value : (expression ? expression.textContent : ""))).trim();
  if (text && text !== "—") {
    btnTtsPlay.hidden = false;
  } else {
    btnTtsPlay.hidden = true;
  }
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

// ==========================================================================
// Card Preview (Stage 5.4)
// ==========================================================================
var currentPreviewSide = "back"; // "front" | "back"
var previewUpdateTimer = null;
var currentPreviewPresentation = { front: { text: {}, order: null }, back: { text: {}, order: null } };
var previewContextKey = "";
var isPreviewEditing = false;
var draggedPreviewBlock = null;
var isSubtitleContextDraft = false;

function emptyPreviewPresentation() {
  return { front: { text: {}, order: null }, back: { text: {}, order: null } };
}

function normalizePreviewPresentation(value) {
  const normalized = emptyPreviewPresentation();
  if (!value || typeof value !== "object") return normalized;
  for (const side of ["front", "back"]) {
    const source = value[side];
    if (!source || typeof source !== "object") continue;
    normalized[side].text = source.text && typeof source.text === "object" ? { ...source.text } : {};
    normalized[side].order = Array.isArray(source.order) ? source.order.filter(key => typeof key === "string") : null;
  }
  return normalized;
}

function prioritizeSubtitleContextOnBack() {
  const backOrder = Array.isArray(currentPreviewPresentation.back.order)
    ? currentPreviewPresentation.back.order
    : [];
  currentPreviewPresentation.back.order = ["example", ...backOrder.filter(key => key !== "example")];
}

function getPreviewContextKey() {
  const cardId = typeof fieldCardId !== "undefined" && fieldCardId ? String(fieldCardId.value || "").trim() : "";
  if (cardId) return `card:${cardId}`;
  const expressionValue = typeof fieldExpression !== "undefined" && fieldExpression ? String(fieldExpression.value || "").trim() : "";
  return `draft:${expressionValue}`;
}

function ensurePreviewContext() {
  const contextKey = getPreviewContextKey();
  if (previewContextKey && contextKey !== previewContextKey && !isPreviewEditing) {
    currentPreviewPresentation = emptyPreviewPresentation();
    isPreviewEditing = false;
    updatePreviewEditButton();
  }
  previewContextKey = contextKey;
}

function restorePreviewPresentation(value) {
  currentPreviewPresentation = normalizePreviewPresentation(value);
  isSubtitleContextDraft = false;
  previewContextKey = getPreviewContextKey();
  isPreviewEditing = false;
  updatePreviewEditButton();
}

function getCardSettingsWithPreview() {
  ensurePreviewContext();
  return {
    ...(typeof currentCardTemplateSettings !== "undefined" && currentCardTemplateSettings ? currentCardTemplateSettings : {}),
    preview_presentation: currentPreviewPresentation,
  };
}

function canReorderPreviewBlocks() {
  const model = (typeof fieldModelSelect !== "undefined" && fieldModelSelect && fieldModelSelect.value)
    || (typeof fieldModelName !== "undefined" && fieldModelName && fieldModelName.value)
    || "Basic";
  return String(model).trim().toLowerCase() === "basic";
}

function updatePreviewEditButton() {
  const button = previewEditToggle;
  if (!button) return;
  button.disabled = false;
  button.setAttribute("aria-pressed", String(isPreviewEditing));
  button.setAttribute("aria-label", isPreviewEditing ? "Finish preview editing" : "Edit card preview");
  button.title = isPreviewEditing ? "Finish editing" : "Edit preview";
  button.innerHTML = isPreviewEditing
    ? '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 8 3.1 3.1L13 4.5" /></svg>'
    : '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.7 2.3a1.6 1.6 0 0 1 2.3 2.3L6 12.6 3 13l.4-3z"/><path d="m10.7 3.3 2 2"/></svg>';
}

function collectPreviewNodes(root, callback) {
  for (const child of Array.from(root.children || [])) {
    callback(child);
    collectPreviewNodes(child, callback);
  }
}

function previewClassHas(element, className) {
  return String(element.className || "").split(/\s+/).includes(className);
}

function applyPreviewBlockOrder(container, order) {
  if (!Array.isArray(order) || !order.length || typeof container.replaceChildren !== "function") return;
  const originalChildren = Array.from(container.children || []);
  const blocks = new Map();
  for (const child of originalChildren) {
    const blockKey = child.getAttribute?.("data-preview-block");
    if (!blockKey) continue;
    if (!blocks.has(blockKey)) blocks.set(blockKey, []);
    blocks.get(blockKey).push(child);
  }
  const orderedChildren = [];
  for (const key of order) {
    const block = blocks.get(key);
    if (!block) continue;
    orderedChildren.push(...block);
    blocks.delete(key);
  }
  for (const child of originalChildren) {
    const key = child.getAttribute?.("data-preview-block");
    if (!key) orderedChildren.push(child);
    else if (blocks.has(key)) {
      orderedChildren.push(...blocks.get(key));
      blocks.delete(key);
    }
  }
  container.replaceChildren(...orderedChildren);
}

function decoratePreviewForEditing(container, side, sidePresentation) {
  const directChildren = Array.from(container.children || []);
  for (const child of directChildren) {
    const key = side === "front"
      ? (previewClassHas(child, "kn-front-expression") ? "expression"
        : previewClassHas(child, "kn-front-tags") ? "jlpt"
          : previewClassHas(child, "kn-front-reading") ? "reading"
            : previewClassHas(child, "kn-front-kanji-reading") ? "kanji_reading"
              : previewClassHas(child, "kn-front-meaning") ? "meaning"
                : previewClassHas(child, "kn-hint") ? "hint" : "")
      : (previewClassHas(child, "kn-reading") || previewClassHas(child, "kn-divider") ? "header"
        : previewClassHas(child, "kn-meaning") || previewClassHas(child, "kn-meanings") ? "meaning"
          : previewClassHas(child, "kn-kanji-card") ? "kanji"
            : previewClassHas(child, "kn-example-block") ? "example"
              : previewClassHas(child, "kn-hint") ? "hint"
                : previewClassHas(child, "kn-notes") ? "notes"
                  : previewClassHas(child, "kn-media") ? "media" : "");
    if (key) child.setAttribute("data-preview-block", key);
    child.draggable = Boolean(key && isPreviewEditing && canReorderPreviewBlocks());
    if (key) child.setAttribute("draggable", String(child.draggable));
  }

  collectPreviewNodes(container, element => {
    let editKey = "";
    if (side === "front") {
      if (previewClassHas(element, "kn-front-expression")) editKey = "expression";
      else if (previewClassHas(element, "kn-front-reading")) editKey = "reading";
      else if (previewClassHas(element, "kn-meaning") || previewClassHas(element, "kn-meanings")) editKey = "meaning";
      else if (previewClassHas(element, "kn-hint")) editKey = "hint";
    } else {
      if (previewClassHas(element, "kn-kana")) editKey = "reading";
      else if (previewClassHas(element, "kn-meaning") || previewClassHas(element, "kn-meanings")) editKey = "meaning";
      else if (previewClassHas(element, "kn-example-ja")) editKey = "example_sentence";
      else if (previewClassHas(element, "kn-example-en")) editKey = "example_translation";
      else if (previewClassHas(element, "kn-hint")) editKey = "hint";
      else if (previewClassHas(element, "kn-notes")) editKey = "notes";
    }
    if (editKey && isPreviewEditing) {
      element.setAttribute("data-preview-edit-key", editKey);
      element.setAttribute("contenteditable", "plaintext-only");
      element.setAttribute("spellcheck", "false");
    }
  });

  if (Array.isArray(sidePresentation.order)) applyPreviewBlockOrder(container, sidePresentation.order);
}

function setPreviewEditMode(enabled) {
  isPreviewEditing = Boolean(enabled);
  updatePreviewEditButton();
  if (typeof cardPreviewCard !== "undefined" && typeof cardPreviewCard?.classList?.toggle === "function") {
    cardPreviewCard.classList.toggle("preview-editing", isPreviewEditing);
  }
  updateCardPreview();
}

function handlePreviewInlineEdit(event) {
  const target = event?.target;
  const editKey = target?.getAttribute?.("data-preview-edit-key");
  if (!isPreviewEditing || !editKey) return;
  ensurePreviewContext();
  const sidePresentation = currentPreviewPresentation[currentPreviewSide];
  let value = String(target.innerText !== undefined ? target.innerText : target.textContent || "").trim();
  if (editKey === "hint") value = value.replace(/^Hint:\s*/i, "");
  if (editKey === "notes") value = value.replace(/^Notes:\s*/i, "");
  sidePresentation.text[editKey] = value;

  // Two-way synchronization with form fields and hero showcase
  if (editKey === "expression") {
    if (typeof fieldExpression !== "undefined" && fieldExpression) fieldExpression.value = value;
    if (typeof expression !== "undefined" && expression) expression.textContent = value || "—";
    previewContextKey = getPreviewContextKey();
  } else if (editKey === "reading") {
    if (typeof fieldReading !== "undefined" && fieldReading) fieldReading.value = value;
    if (typeof updateHeroReading === "function") {
      updateHeroReading(value, typeof fieldExpression !== "undefined" && fieldExpression ? fieldExpression.value : "");
    }
  } else if (editKey === "meaning") {
    if (typeof fieldMeaning !== "undefined" && fieldMeaning) fieldMeaning.value = value;
  } else if (editKey === "hint") {
    if (typeof fieldHint !== "undefined" && fieldHint) fieldHint.value = value;
  } else if (editKey === "notes") {
    if (typeof fieldNotes !== "undefined" && fieldNotes) fieldNotes.value = value;
  } else if (editKey === "example_sentence") {
    if (typeof fieldExampleSentence !== "undefined" && fieldExampleSentence) fieldExampleSentence.value = value;
  } else if (editKey === "example_translation") {
    if (typeof fieldExampleTranslation !== "undefined" && fieldExampleTranslation) fieldExampleTranslation.value = value;
  }

  if (typeof isCardDraftDirtyState !== "undefined") isCardDraftDirtyState = true;
}

function reorderPreviewBlocks(sourceKey, targetKey, placeAfter) {
  if (!canReorderPreviewBlocks() || !sourceKey || !targetKey || sourceKey === targetKey) return;
  ensurePreviewContext();
  const sidePresentation = currentPreviewPresentation[currentPreviewSide];
  const keys = [];
  for (const child of Array.from(cardPreviewCard.children || [])) {
    const key = child.getAttribute?.("data-preview-block");
    if (key && !keys.includes(key)) keys.push(key);
  }
  const sourceIndex = keys.indexOf(sourceKey);
  const targetIndex = keys.indexOf(targetKey);
  if (sourceIndex < 0 || targetIndex < 0) return;
  keys.splice(sourceIndex, 1);
  let insertIndex = keys.indexOf(targetKey) + (placeAfter ? 1 : 0);
  keys.splice(insertIndex, 0, sourceKey);
  sidePresentation.order = keys;
  if (typeof isCardDraftDirtyState !== "undefined") isCardDraftDirtyState = true;
  updateCardPreview();
}
var currentJlptLevel = null;
var currentVerbMetadata = null;

function formatKunyomi(kunStr) {
  if (!kunStr) return "";
  const s = String(kunStr).trim();
  if (s.includes(".")) {
    const parts = s.split(".");
    if (parts.length === 2) {
      return `${parts[0]}(${parts[1]})`;
    }
  }
  return s;
}

function formatPitchBadge(pitch) {
  if (!pitch || typeof pitch.position !== "number") return "";
  const circle = typeof getPitchCircleNumber === "function" ? getPitchCircleNumber(pitch.position) : `[${pitch.position}]`;
  const pat = typeof formatPitchPatternName === "function" ? formatPitchPatternName(pitch.pattern_name) : "";
  return pat ? `[${circle} ${pat}]` : `[${circle}]`;
}

function setPreviewSide(side) {
  currentPreviewSide = side === "front" ? "front" : "back";
  if (previewTabFront && previewTabBack) {
    const isFront = currentPreviewSide === "front";
    if (previewTabFront.classList) previewTabFront.classList.toggle("active", isFront);
    if (typeof previewTabFront.setAttribute === "function") previewTabFront.setAttribute("aria-selected", String(isFront));
    if (previewTabBack.classList) previewTabBack.classList.toggle("active", !isFront);
    if (typeof previewTabBack.setAttribute === "function") previewTabBack.setAttribute("aria-selected", String(!isFront));
  }
  updateCardPreview();
}

function scheduleCardPreviewUpdate() {
  if (previewUpdateTimer) clearTimeout(previewUpdateTimer);
  previewUpdateTimer = setTimeout(() => {
    updateCardPreview();
  }, 40);
}

function getCardPreviewData() {
  ensurePreviewContext();
  const expr = fieldExpression ? (fieldExpression.value || "").trim() : "";
  const read = fieldReading ? (fieldReading.value || "").trim() : "";
  const mean = fieldMeaning ? (fieldMeaning.value || "").trim() : "";
  const hnt = fieldHint ? (fieldHint.value || "").trim() : "";
  const exJa = fieldExampleSentence ? (fieldExampleSentence.value || "").trim() : "";
  const exEn = fieldExampleTranslation ? (fieldExampleTranslation.value || "").trim() : "";
  const nts = fieldNotes ? (fieldNotes.value || "").trim() : "";
  const img = fieldImage ? (fieldImage.value || "").trim() : "";
  const aud = fieldAudio ? (fieldAudio.value || "").trim() : "";

  // Image source resolution
  let resolvedImage = (currentDraftMedia && currentDraftMedia.imageBase64) || "";
  if (!resolvedImage && img) {
    resolvedImage = (img.startsWith("http://") || img.startsWith("https://") || img.startsWith("data:"))
      ? img
      : `${BACKEND_BASE_URL}/api/media/${encodeURIComponent(img)}`;
  }

  // Audio source resolution
  let resolvedAudio = (currentDraftMedia && currentDraftMedia.audioBase64) || "";
  if (!resolvedAudio && aud) {
    resolvedAudio = (aud.startsWith("http://") || aud.startsWith("https://") || aud.startsWith("data:"))
      ? aud
      : `${BACKEND_BASE_URL}/api/media/${encodeURIComponent(aud)}`;
  }

  // Pitch resolution from currentDictionaryEntries
  let pitchBadge = "";
  if (Array.isArray(currentDictionaryEntries) && currentDictionaryEntries.length) {
    for (const e of currentDictionaryEntries) {
      if (Array.isArray(e.pitches) && e.pitches.length && e.pitches[0]) {
        pitchBadge = formatPitchBadge(e.pitches[0]);
        if (pitchBadge) break;
      }
    }
  }

  // Kanji readings extraction (Onyomi & Kunyomi separate from word reading)
  const kanjiReadings = [];
  if (Array.isArray(currentKanjiEntries) && currentKanjiEntries.length) {
    for (const k of currentKanjiEntries) {
      if (!k) continue;
      const on = Array.isArray(k.onyomi) ? k.onyomi.map(x => String(x).trim()).filter(Boolean) : [];
      const kun = Array.isArray(k.kunyomi) ? k.kunyomi.map(x => String(x).trim()).filter(Boolean) : [];
      if (on.length || kun.length) {
        kanjiReadings.push({
          character: k.character || "",
          onyomi: on,
          kunyomi: kun,
        });
      }
    }
  }

  let resolvedJlpt = typeof currentJlptLevel !== "undefined" && currentJlptLevel ? currentJlptLevel : null;
  if (!resolvedJlpt && typeof currentDictionaryEntries !== "undefined" && Array.isArray(currentDictionaryEntries)) {
    for (const e of currentDictionaryEntries) {
      for (const t of (e.tags || [])) {
        const m = String(t).match(/^jlpt-n([1-5])$/i) || String(t).match(/^n([1-5])$/i);
        if (m) { resolvedJlpt = `N${m[1]}`; break; }
      }
      if (resolvedJlpt) break;
    }
  }
  if (!resolvedJlpt && typeof currentKanjiEntries !== "undefined" && Array.isArray(currentKanjiEntries)) {
    for (const k of currentKanjiEntries) {
      if (k.stats && k.stats.jlpt && String(k.stats.jlpt).toUpperCase().startsWith("N")) {
        resolvedJlpt = String(k.stats.jlpt).toUpperCase();
        break;
      }
      for (const t of (k.tags || [])) {
        const m = String(t).match(/^jlpt-n([1-5])$/i) || String(t).match(/^n([1-5])$/i);
        if (m) { resolvedJlpt = `N${m[1]}`; break; }
      }
      if (resolvedJlpt) break;
    }
  }

  return {
    expression: expr,
    reading: read,
    meaning: mean,
    hint: hnt,
    example_sentence: exJa,
    example_translation: exEn,
    notes: nts,
    image: resolvedImage,
    audio: resolvedAudio,
    pitch_badge: pitchBadge,
    jlpt_level: resolvedJlpt,
    verb_metadata: (typeof currentVerbMetadata !== "undefined" && currentVerbMetadata) ? currentVerbMetadata : null,
    entries: (typeof currentDictionaryEntries !== "undefined" && Array.isArray(currentDictionaryEntries)) ? currentDictionaryEntries : [],
    kanji_entries: (typeof currentKanjiEntries !== "undefined" && Array.isArray(currentKanjiEntries)) ? currentKanjiEntries : [],
    kanji_readings: kanjiReadings,
    template_settings: currentCardTemplateSettings,
    preview_presentation: currentPreviewPresentation,
  };
}

function renderPreviewKanjiCard(k, isIsolated = false) {
  if (typeof renderKanjiCard === "function") {
    return renderKanjiCard(k, {
      mode: "compact",
      isProminent: isIsolated,
      showJlpt: currentCardTemplateSettings?.show_jlpt !== false,
    });
  }
  const div = document.createElement("div");
  div.className = "kn-kanji-card" + (isIsolated ? " prominent" : " compact");
  const char = k?.character || "";
  div.textContent = char;
  return div;
}

function renderPreviewMeanings(container, data) {
  // 1. Primary path: render from user's actual edited meaning field
  const rawMeaning = (data.meaning || "").trim();
  if (rawMeaning) {
    const lines = rawMeaning.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;

    if (lines.length === 1) {
      const cleanLine = lines[0].replace(/^(?:\d+[\.\)]|\(\d+\))\s*/, "");
      const meanDiv = document.createElement("div");
      meanDiv.className = "kn-meaning";
      meanDiv.textContent = cleanLine;
      container.append(meanDiv);
    } else {
      const ol = document.createElement("ol");
      ol.className = "kn-meanings";
      for (const line of lines) {
        const cleanLine = line.replace(/^(?:\d+[\.\)]|\(\d+\))\s*/, "");
        const li = document.createElement("li");
        li.textContent = cleanLine;
        ol.append(li);
      }
      container.append(ol);
    }
    return;
  }

  // 2. Fallback path: derive summary from raw dictionary entries only when meaning is empty
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (entries.length) {
    const extractedSenses = [];
    const primaryTerm = entries.find(e => e?.is_primary && e?.term)?.term || entries.find(e => e?.term)?.term;
    const targetEntries = primaryTerm ? entries.filter(e => !e?.term || e.term === primaryTerm) : entries;

    for (const entry of targetEntries) {
      if (!entry) continue;
      const rawSenses = entry.senses || (entry.glosses ? [entry] : []);
      if (!Array.isArray(rawSenses)) continue;
      const totalSenses = rawSenses.length;
      for (let sIdx = 0; sIdx < totalSenses; sIdx++) {
        const s = rawSenses[sIdx];
        if (!s) continue;
        const glosses = Array.isArray(s.glosses) ? s.glosses.filter(Boolean) : (s.glosses ? [String(s.glosses)] : []);
        if (!glosses.length) continue;

        let posList = Array.isArray(s.parts_of_speech) && s.parts_of_speech.length
          ? s.parts_of_speech
          : (totalSenses === 1 && Array.isArray(entry.parts_of_speech) ? entry.parts_of_speech : []);
        posList = posList.map(p => String(p).trim()).filter(Boolean);

        extractedSenses.push({
          glosses,
          posList
        });
      }
    }

    if (extractedSenses.length === 1) {
      const s = extractedSenses[0];
      const meanDiv = document.createElement("div");
      meanDiv.className = "kn-meaning";
      if (s.posList.length) {
        const posSpan = document.createElement("span");
        posSpan.className = "kn-pos";
        posSpan.textContent = `[${s.posList.join(", ")}]`;
        meanDiv.append(posSpan);
        meanDiv.append(document.createTextNode(" "));
      }
      meanDiv.append(document.createTextNode(s.glosses.join(", ")));
      container.append(meanDiv);
      return;
    } else if (extractedSenses.length > 1) {
      const ol = document.createElement("ol");
      ol.className = "kn-meanings";
      for (const s of extractedSenses) {
        const li = document.createElement("li");
        if (s.posList.length) {
          const posSpan = document.createElement("span");
          posSpan.className = "kn-pos";
          posSpan.textContent = `[${s.posList.join(", ")}]`;
          li.append(posSpan);
          li.append(document.createTextNode(" "));
        }
        li.append(document.createTextNode(s.glosses.join(", ")));
        ol.append(li);
      }
      container.append(ol);
      return;
    }
  }
}

function renderCardPreviewDOM(container, data, side = "back") {
  if (!container) return;
  const presentation = data.preview_presentation || currentPreviewPresentation;
  const sidePresentation = presentation?.[side] && typeof presentation[side] === "object"
    ? presentation[side]
    : { text: {}, order: null };
  const textOverrides = sidePresentation.text && typeof sidePresentation.text === "object" ? sidePresentation.text : {};
  const editableKeys = side === "front"
    ? ["expression", "reading", "meaning", "hint"]
    : ["reading", "meaning", "hint", "example_sentence", "example_translation", "notes"];
  data = { ...data };
  for (const key of editableKeys) {
    if (Object.prototype.hasOwnProperty.call(textOverrides, key)) data[key] = String(textOverrides[key]);
  }
  if (Object.prototype.hasOwnProperty.call(textOverrides, "meaning")) data.entries = [];
  if (typeof container.replaceChildren === "function") {
    container.replaceChildren();
  }

  const hasContent = Boolean(
    data.expression || data.reading || data.meaning || data.example_sentence ||
    data.example_translation || data.image || data.audio || data.hint || data.notes
  );

  if (!hasContent) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "card-preview-empty";
    emptyEl.textContent = "Preview will appear as you capture or edit a card.";
    container.append(emptyEl);
    return;
  }

  const settings = data.template_settings || currentCardTemplateSettings || DEFAULT_CARD_TEMPLATE_SETTINGS;
  const frontCfg = settings.front || {};
  const backCfg = settings.back || {};

  if (side === "front") {
    // FRONT SIDE PREVIEW (Default: expression only, NO bracketed reading)
    const exprP = document.createElement("div");
    exprP.className = "kn-front-expression";
    exprP.textContent = data.expression || "—";
    container.append(exprP);

    // JLPT Badge on Front side preview (if enabled and present)
    const showJlpt = settings.show_jlpt !== false;
    if (showJlpt && data.jlpt_level) {
      const jlptWrap = document.createElement("div");
      jlptWrap.className = "kn-front-tags";
      const jlptSpan = document.createElement("span");
      jlptSpan.className = "kn-tag kn-jlpt";
      jlptSpan.textContent = typeof formatJlptLevel === "function"
        ? formatJlptLevel(data.jlpt_level)
        : (String(data.jlpt_level).startsWith("JLPT") ? data.jlpt_level : `JLPT ${data.jlpt_level}`);
      jlptWrap.append(jlptSpan);
      container.append(jlptWrap);
    }

    // 1. Word reading (only if enabled, default false)
    if (frontCfg.show_reading && data.reading) {
      const readP = document.createElement("div");
      readP.className = "kn-front-reading";
      readP.textContent = data.reading;
      container.append(readP);
    }

    // 2. Kanji reading (only if enabled, default false)
    if (frontCfg.show_kanji_reading && Array.isArray(data.kanji_readings) && data.kanji_readings.length) {
      const kanjiDiv = document.createElement("div");
      kanjiDiv.className = "kn-front-kanji-reading";
      for (const k of data.kanji_readings) {
        const row = document.createElement("div");
        row.className = "kn-kanji-reading-row";
        if (k.onyomi && k.onyomi.length) {
          const onLbl = document.createElement("span");
          onLbl.className = "kn-reading-lbl";
          onLbl.textContent = "On: ";
          const onVal = document.createElement("span");
          onVal.className = "kn-onyomi";
          onVal.textContent = k.onyomi.join(", ");
          row.append(onLbl, onVal, document.createTextNode("  "));
        }
        if (k.kunyomi && k.kunyomi.length) {
          const kunLbl = document.createElement("span");
          kunLbl.className = "kn-reading-lbl";
          kunLbl.textContent = "Kun: ";
          const kunVal = document.createElement("span");
          kunVal.className = "kn-kunyomi";
          kunVal.textContent = k.kunyomi.join(", ");
          row.append(kunLbl, kunVal);
        }
        kanjiDiv.append(row);
      }
      container.append(kanjiDiv);
    }

    // 3. Meaning (only if enabled, default false)
    if (frontCfg.show_meaning) {
      const meanWrap = document.createElement("div");
      meanWrap.className = "kn-front-meaning";
      renderPreviewMeanings(meanWrap, data);
      container.append(meanWrap);
    }

    if (frontCfg.show_hint && data.hint) {
      const hintDiv = document.createElement("div");
      hintDiv.className = "kn-hint";
      hintDiv.textContent = `Hint: ${data.hint}`;
      if (hintDiv.style) hintDiv.style.textAlign = "center";
      container.append(hintDiv);
    }
    decoratePreviewForEditing(container, side, sidePresentation);
    return;
  }

  // BACK SIDE PREVIEW
  // 1. Reading & Pitch header (respected via backCfg.show_reading, default true)
  const showJlpt = settings.show_jlpt !== false;
  if (backCfg.show_reading !== false && (data.reading || data.pitch_badge || (showJlpt && data.jlpt_level))) {
    const readingDiv = document.createElement("div");
    readingDiv.className = "kn-reading";

    if (data.reading) {
      const kanaSpan = document.createElement("span");
      kanaSpan.className = "kn-kana";
      kanaSpan.textContent = data.reading;
      readingDiv.append(kanaSpan);
    }

    if (showJlpt && data.jlpt_level) {
      const jlptSpan = document.createElement("span");
      jlptSpan.className = "kn-tag kn-jlpt";
      jlptSpan.textContent = typeof formatJlptLevel === "function" ? formatJlptLevel(data.jlpt_level) : (String(data.jlpt_level).startsWith("JLPT") ? data.jlpt_level : `JLPT ${data.jlpt_level}`);
      readingDiv.append(jlptSpan);
    }

    if (data.pitch_badge) {
      const pitchSpan = document.createElement("span");
      pitchSpan.className = "kn-pitch";
      pitchSpan.textContent = data.pitch_badge;
      readingDiv.append(pitchSpan);
    }

    if (settings.show_verb_type !== false && data.verb_metadata && data.verb_metadata.is_verb) {
      if (data.verb_metadata.verb_type) {
        const vSpan = document.createElement("span");
        vSpan.className = "kn-pos kn-verb-type";
        vSpan.textContent = data.verb_metadata.verb_type;
        readingDiv.append(vSpan);
      }
      if (data.verb_metadata.transitivity) {
        const tSpan = document.createElement("span");
        tSpan.className = "kn-pos kn-transitivity";
        const t = data.verb_metadata.transitivity;
        tSpan.textContent = t === "transitive" ? "他動詞" : (t === "intransitive" ? "自動詞" : (t === "both" ? "自他動詞" : t));
        readingDiv.append(tSpan);
      }
    }

    container.append(readingDiv);

    const divider = document.createElement("hr");
    divider.className = "kn-divider";
    container.append(divider);
  } else if (showJlpt && data.jlpt_level) {
    const readingDiv = document.createElement("div");
    readingDiv.className = "kn-reading";
    const jlptSpan = document.createElement("span");
    jlptSpan.className = "kn-tag kn-jlpt";
    jlptSpan.textContent = typeof formatJlptLevel === "function" ? formatJlptLevel(data.jlpt_level) : (String(data.jlpt_level).startsWith("JLPT") ? data.jlpt_level : `JLPT ${data.jlpt_level}`);
    readingDiv.append(jlptSpan);
    container.append(readingDiv);

    const divider = document.createElement("hr");
    divider.className = "kn-divider";
    container.append(divider);
  }

  // 2. Meanings & Kanji references (matching Anki format_basic_back)
  const isIsolatedKanji = Boolean(
    Array.isArray(data.kanji_entries) &&
    data.kanji_entries.length &&
    data.expression &&
    data.expression.length === 1
  );

  if (isIsolatedKanji) {
    for (const k of data.kanji_entries) {
      const kanjiEl = renderPreviewKanjiCard(k, true);
      if (kanjiEl) container.append(kanjiEl);
    }
    if (backCfg.show_meaning !== false) {
      renderPreviewMeanings(container, data);
    }
  } else {
    if (backCfg.show_meaning !== false) {
      renderPreviewMeanings(container, data);
    }
    if (Array.isArray(data.kanji_entries) && data.kanji_entries.length) {
      for (const k of data.kanji_entries) {
        const kanjiEl = renderPreviewKanjiCard(k, false);
        if (kanjiEl) container.append(kanjiEl);
      }
    }
  }

  // 3. Example Block
  if (data.example_sentence || data.example_translation) {
    const exBlock = document.createElement("div");
    exBlock.className = "kn-example-block";

    if (data.example_sentence) {
      const jaP = document.createElement("p");
      jaP.className = "kn-example-ja";
      if (!isPreviewEditing && typeof renderRubyText === "function") {
        renderRubyText(jaP, data.example_sentence, undefined, { furiganaMode: settings.furigana_mode });
      } else {
        jaP.textContent = data.example_sentence;
      }
      exBlock.append(jaP);
    }

    if (data.example_translation) {
      const enP = document.createElement("p");
      enP.className = "kn-example-en";
      enP.textContent = data.example_translation;
      exBlock.append(enP);
    }

    container.append(exBlock);
  }

  // 4. Hint & Notes
  if (backCfg.show_hint !== false && data.hint) {
    const hintDiv = document.createElement("div");
    hintDiv.className = "kn-hint";
    hintDiv.textContent = `Hint: ${data.hint}`;
    container.append(hintDiv);
  }

  if (data.notes) {
    const notesDiv = document.createElement("div");
    notesDiv.className = "kn-notes";
    notesDiv.textContent = `Notes: ${data.notes}`;
    container.append(notesDiv);
  }

  // 5. Media
  if (data.image || data.audio) {
    const mediaDiv = document.createElement("div");
    mediaDiv.className = "kn-media";

    if (data.image) {
      const img = document.createElement("img");
      img.className = "kn-image";
      img.src = data.image;
      img.alt = "Card image";
      img.onerror = () => { if (img.style) img.style.display = "none"; };
      mediaDiv.append(img);
    }

    if (data.audio) {
      const aud = document.createElement("audio");
      aud.className = "kn-audio-preview";
      aud.src = data.audio;
      aud.controls = true;
      aud.preload = "metadata";
      mediaDiv.append(aud);
    }

    container.append(mediaDiv);
  }

  decoratePreviewForEditing(container, side, sidePresentation);
}

function updateCardPreview() {
  if (!cardPreviewCard) return;
  const data = getCardPreviewData();
  renderCardPreviewDOM(cardPreviewCard, data, currentPreviewSide);
  if (typeof cardPreviewCard.classList?.toggle === "function") cardPreviewCard.classList.toggle("preview-editing", isPreviewEditing);
}

if (previewTabFront) {
  previewTabFront.addEventListener("click", () => setPreviewSide("front"));
}
if (previewTabBack) {
  previewTabBack.addEventListener("click", () => setPreviewSide("back"));
}

if (previewEditToggle) {
  previewEditToggle.addEventListener("click", () => setPreviewEditMode(!isPreviewEditing));
}

if (cardPreviewCard) {
  cardPreviewCard.addEventListener("input", handlePreviewInlineEdit);
  cardPreviewCard.addEventListener("focusout", event => {
    if (isPreviewEditing) return;
    scheduleCardPreviewUpdate();
  });
  cardPreviewCard.addEventListener("dragstart", event => {
    const block = event.target?.closest?.("[data-preview-block]") || event.target;
    const key = block?.getAttribute?.("data-preview-block");
    if (!isPreviewEditing || !canReorderPreviewBlocks() || !key) {
      event.preventDefault?.();
      return;
    }
    draggedPreviewBlock = key;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", key);
    }
  });
  cardPreviewCard.addEventListener("dragover", event => {
    const block = event.target?.closest?.("[data-preview-block]") || event.target;
    if (!draggedPreviewBlock || !block?.getAttribute?.("data-preview-block")) return;
    event.preventDefault?.();
    block.classList?.add("preview-drag-over");
  });
  cardPreviewCard.addEventListener("dragleave", event => {
    const block = event.target?.closest?.("[data-preview-block]") || event.target;
    block?.classList?.remove("preview-drag-over");
  });
  cardPreviewCard.addEventListener("drop", event => {
    const block = event.target?.closest?.("[data-preview-block]") || event.target;
    const targetKey = block?.getAttribute?.("data-preview-block");
    block?.classList?.remove("preview-drag-over");
    event.preventDefault?.();
    if (!draggedPreviewBlock || !targetKey) return;
    const rect = block.getBoundingClientRect?.();
    const placeAfter = rect ? event.clientY > rect.top + rect.height / 2 : false;
    reorderPreviewBlocks(draggedPreviewBlock, targetKey, placeAfter);
    draggedPreviewBlock = null;
  });
  cardPreviewCard.addEventListener("dragend", () => { draggedPreviewBlock = null; });
}

// Live card editor input bindings
[
  fieldExpression,
  fieldReading,
  fieldMeaning,
  fieldHint,
  fieldExampleSentence,
  fieldExampleTranslation,
  fieldImage,
  fieldAudio,
  fieldTags,
  fieldNotes
].forEach(fieldEl => {
  if (fieldEl) {
    fieldEl.addEventListener("input", scheduleCardPreviewUpdate);
    fieldEl.addEventListener("change", scheduleCardPreviewUpdate);
  }
});

function updateSessionCounter() {
  const countText = sessionCardCount === 0 ? "0 today" : `${sessionCardCount} today`;
  if (sessionCountEl) {
    sessionCountEl.textContent = countText;
  }
  if (quickAddSessionCountEl) {
    quickAddSessionCountEl.textContent = countText;
  }
}

function formatErrorMessage(error, defaultMsg = "Backend unavailable.") {
  if (!error) return defaultMsg;
  if (error.message === "Failed to fetch" || error.name === "TypeError") {
    return `Cannot connect to backend. Ensure FastAPI server is running on ${BACKEND_BASE_URL}`;
  }
  return error.message || defaultMsg;
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function updateMiningUI(enabled) {
  miningMode = enabled;
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.setAttribute("aria-label", enabled ? "Stop mining" : "Start mining");
    toggle.textContent = enabled ? "Stop" : "Start";
  }
  if (mode) {
    mode.textContent = enabled
      ? "Mining active"
      : "Select Japanese text on the page";
  }
}

async function setMiningMode(enabled) {
  updateMiningUI(enabled);
  let streamId = null;
  if (enabled && typeof chrome !== "undefined" && chrome.tabCapture?.getMediaStreamId && chrome.tabs?.query) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id) {
        streamId = await Promise.race([
          chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("tabCapture timeout")), 2000))
        ]).catch(() => null);
      }
    } catch (_) {}
  }
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      const result = await chrome.runtime.sendMessage({type: "SET_MINING_MODE", enabled, streamId});
      if (!result?.ok) {
        setStatus(result?.error || "Capture setup failed.", true);
      }
    } catch (err) {
      setStatus(err.message || "Capture setup failed.", true);
    }
  }
}

function add(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function formatRawDictionaryText(entries, kanjiEntries) {
  const lines = [];
  if (Array.isArray(kanjiEntries) && kanjiEntries.length) {
    kanjiEntries.forEach((k) => {
      lines.push(`=== Kanji: ${k.character || ""} [${k.dictionary || "Kanji Dictionary"}] ===`);
      if (k.onyomi && k.onyomi.length) {
        lines.push(`Onyomi: ${k.onyomi.join(", ")}`);
      }
      if (k.kunyomi && k.kunyomi.length) {
        const formattedKun = k.kunyomi.map(formatKunyomi);
        lines.push(`Kunyomi: ${formattedKun.join(", ")}`);
      }
      if (k.nanori && k.nanori.length) {
        lines.push(`Nanori: ${k.nanori.join(", ")}`);
      }
      if (k.meanings && k.meanings.length) {
        lines.push(`Meanings: ${k.meanings.join(", ")}`);
      }
      if (k.stats && Object.keys(k.stats).length) {
        const statPairs = Object.entries(k.stats).map(([sk, sv]) => `${sk}: ${sv}`);
        lines.push(`Stats: ${statPairs.join(", ")}`);
      }
      if (k.tags && k.tags.length) {
        lines.push(`Tags: ${k.tags.join(", ")}`);
      }
      lines.push("");
    });
  }

  if (Array.isArray(entries) && entries.length) {
    entries.forEach((entry, eIdx) => {
      lines.push(`=== ${entry.dictionary || "Dictionary"}${entry.is_primary ? " (Primary)" : ""} ===`);
      if (entry.term || entry.reading) {
        lines.push(`Term: ${entry.term || ""}${entry.reading ? ` [${entry.reading}]` : ""}`);
      }
      if (entry.parts_of_speech && entry.parts_of_speech.length) {
        lines.push(`POS: ${entry.parts_of_speech.join(", ")}`);
      }
      if (entry.tags && entry.tags.length) {
        lines.push(`Tags: ${entry.tags.join(", ")}`);
      }
      if (entry.senses && entry.senses.length) {
        lines.push("Senses:");
        entry.senses.forEach((sense, sIdx) => {
          const glosses = (sense.glosses || []).join("; ");
          lines.push(`  ${sIdx + 1}. ${glosses}`);
          if (sense.notes && sense.notes.length) {
            lines.push(`     Notes: ${sense.notes.join("; ")}`);
          }
          if (sense.examples && sense.examples.length) {
            lines.push("     Examples:");
            sense.examples.forEach(eg => {
              lines.push(`       - ${eg.japanese}${eg.translation ? ` : ${eg.translation}` : ""}`);
            });
          }
        });
      }
      if (eIdx < entries.length - 1) lines.push("");
    });
  }
  return lines.join("\n").trim();
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    // fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const success = document.execCommand("copy");
    document.body.removeChild(ta);
    return success;
  } catch (e) {
    return false;
  }
}

function clearDictionaryView() {
  if (meanings) {
    meanings.replaceChildren();
    meanings.hidden = false;
  }
  if (examples) examples.replaceChildren();
  if (dictActionsBar) dictActionsBar.style.display = "none";
  if (typeof dictLoadingIndicator !== "undefined" && dictLoadingIndicator) dictLoadingIndicator.hidden = true;
  if (typeof dictEmptyNotice !== "undefined" && dictEmptyNotice) dictEmptyNotice.hidden = true;
  const dictJlptBadge = document.querySelector("#dict-jlpt-badge");
  if (dictJlptBadge) {
    dictJlptBadge.hidden = true;
    dictJlptBadge.textContent = "";
  }
  currentDictionaryEntries = [];
  currentKanjiEntries = [];
  currentJlptLevel = null;
  currentVerbMetadata = null;
}

function getPitchCircleNumber(position) {
  const circles = ["⓪", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];
  if (typeof position === "number" && position >= 0 && position < circles.length) {
    return circles[position];
  }
  return `[${position}]`;
}

function formatPitchPatternName(patternName) {
  if (!patternName) return "";
  const lower = String(patternName).toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function formatFrequencyRank(freq) {
  const dict = freq.dictionary || "Freq";
  if (freq.display_value) {
    const disp = String(freq.display_value).trim();
    if (disp.startsWith("#") || disp.startsWith("★")) {
      return `${dict} ${disp}`;
    }
    if (/^\d+$/.test(disp)) {
      return `${dict} #${disp}`;
    }
    return `${dict} ${disp}`;
  }
  if (freq.rank != null && freq.rank > 0) {
    return `${dict} #${freq.rank}`;
  }
  if (freq.frequency != null && freq.frequency > 0) {
    return `${dict} #${freq.frequency}`;
  }
  return dict;
}

function formatJlptLevel(level) {
  if (!level) return "";
  const trimmed = String(level).trim();
  if (trimmed.toUpperCase().startsWith("JLPT")) {
    return trimmed;
  }
  return `JLPT ${trimmed}`;
}

// OpenJLPT N4/N5 kanji set for advanced-only furigana density filtering
const JLPT_N4_N5_KANJI = new Set(
  "一七万三上下不世中主九事二五京人今仕代以休会住体何作使借元兄先入八公六円写冬出切別前力勉動北医十千午半南去友口古台右同名味品員問四図国土地堂場売夏夕外多夜大天女妹姉始子字学安室家小少屋山川工左帰年広店度建弟強待後心思急悪意手持教文料新方旅族日早明映春昼時曜書月有服朝木本来東校業楽歌止正歩死母毎気水注洋海漢火父牛物特犬理生用田男町画界病発白百目真着知研社私秋究空立答紙終習考者聞肉自色花英茶行西見親言計試話語読買貸質赤走起足車転近送通週運道重野金銀長開間院集雨電青音題風食飯飲館駅験高魚鳥黒"
);

function isN4N5KanjiString(str) {
  if (!str) return false;
  const kanjiRegex = /[\u4e00-\u9faf々〆ヶ]/g;
  const chars = str.match(kanjiRegex);
  if (!chars || chars.length === 0) return false;
  return chars.every(ch => JLPT_N4_N5_KANJI.has(ch));
}

function renderRubyText(container, text, rubyText, options = {}) {
  const source = rubyText || text || "";
  if (!source) return;

  const furiganaMode = (options && options.furiganaMode) || (typeof currentCardTemplateSettings !== "undefined" && currentCardTemplateSettings?.furigana_mode) || "all";

  // If no bracket furigana or ruby tags exist, append plain text safely
  if (!source.includes("[") && !source.includes("<ruby>")) {
    container.append(document.createTextNode(text || source));
    return;
  }

  // Handle bracket notation: e.g. "朝[あさ]御[ご]飯[はん]を食[た]べる。"
  if (source.includes("[")) {
    const regex = /([^\s\[\]]+)\[([^\]]+)\]|([^\[\]]+)/g;
    let match;
    let foundRuby = false;

    while ((match = regex.exec(source)) !== null) {
      if (match[1] && match[2]) {
        foundRuby = true;
        const base = match[1];
        const rt = match[2];
        if (furiganaMode === "none") {
          container.append(document.createTextNode(base));
        } else if (furiganaMode === "advanced_only" && isN4N5KanjiString(base)) {
          container.append(document.createTextNode(base));
        } else {
          const rubyEl = document.createElement("ruby");
          rubyEl.append(document.createTextNode(base));
          const rtEl = document.createElement("rt");
          rtEl.textContent = rt;
          rubyEl.append(rtEl);
          container.append(rubyEl);
        }
      } else if (match[3]) {
        container.append(document.createTextNode(match[3]));
      }
    }

    if (!foundRuby && text) {
      container.append(document.createTextNode(text));
    }
    return;
  }

  // Handle <ruby>...<rt>...</rt></ruby> markup safely without innerHTML
  if (source.includes("<ruby>")) {
    const rubyRegex = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>|([^<]+)/g;
    let match;
    while ((match = rubyRegex.exec(source)) !== null) {
      if (match[1] && match[2]) {
        const base = match[1];
        const rt = match[2];
        if (furiganaMode === "none") {
          container.append(document.createTextNode(base));
        } else if (furiganaMode === "advanced_only" && isN4N5KanjiString(base)) {
          container.append(document.createTextNode(base));
        } else {
          const rubyEl = document.createElement("ruby");
          rubyEl.append(document.createTextNode(base));
          const rtEl = document.createElement("rt");
          rtEl.textContent = rt;
          rubyEl.append(rtEl);
          container.append(rubyEl);
        }
      } else if (match[3]) {
        container.append(document.createTextNode(match[3]));
      }
    }
    return;
  }

  container.append(document.createTextNode(text || source));
}

let isCardDraftDirtyState = false;

function isCardDraftDirty() {
  const expr = fieldExpression ? fieldExpression.value.trim() : "";
  if (!expr) return false;
  const hasCardId = Boolean(fieldCardId && fieldCardId.value);
  const isSavedBadge = Boolean(saveBadge && !saveBadge.hidden && (saveBadge.textContent.includes("SAVED") || saveBadge.textContent.includes("ALREADY SAVED")));
  if (!hasCardId || !isSavedBadge || isCardDraftDirtyState) {
    return true;
  }
  return false;
}

function insertSenseToMeaning(glossesText, btn) {
  isCardDraftDirtyState = true;
  if (!glossesText || !fieldMeaning) return;
  const current = fieldMeaning.value ? fieldMeaning.value.trim() : "";
  if (current && current !== glossesText.trim() && btn) {
    if (!btn.classList.contains("confirm-replace")) {
      btn.classList.add("confirm-replace");
      btn.textContent = "Replace?";
      setTimeout(() => {
        if (btn.classList.contains("confirm-replace")) {
          btn.classList.remove("confirm-replace");
          btn.textContent = "Insert";
        }
      }, 3000);
      return;
    }
    btn.classList.remove("confirm-replace");
  }
  fieldMeaning.value = glossesText;
  fieldMeaning.dispatchEvent(new Event("input", { bubbles: true }));
  fieldMeaning.dispatchEvent(new Event("change", { bubbles: true }));

  if (btn) {
    btn.textContent = "Inserted!";
    btn.classList.add("inserted");
    setTimeout(() => {
      btn.textContent = "Insert";
      btn.classList.remove("inserted");
    }, 1200);
  }
}

function insertExampleToCard(japaneseText, translationText, btn) {
  isCardDraftDirtyState = true;
  if (!japaneseText) return;
  const currentSentence = fieldExampleSentence && fieldExampleSentence.value ? fieldExampleSentence.value.trim() : "";
  if (currentSentence && currentSentence !== japaneseText.trim() && btn) {
    if (!btn.classList.contains("confirm-replace")) {
      btn.classList.add("confirm-replace");
      btn._origText = btn.textContent;
      btn.textContent = "Replace?";
      setTimeout(() => {
        if (btn.classList.contains("confirm-replace")) {
          btn.classList.remove("confirm-replace");
          btn.textContent = btn._origText || "→ Sentence";
        }
      }, 3000);
      return;
    }
    btn.classList.remove("confirm-replace");
  }

  if (fieldExampleSentence) {
    fieldExampleSentence.value = japaneseText;
    fieldExampleSentence.dispatchEvent(new Event("input", { bubbles: true }));
    fieldExampleSentence.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (fieldExampleTranslation && translationText) {
    fieldExampleTranslation.value = translationText;
    fieldExampleTranslation.dispatchEvent(new Event("input", { bubbles: true }));
    fieldExampleTranslation.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (typeof optionalDetails !== "undefined" && optionalDetails) {
    optionalDetails.open = true;
  }
  if (optionalFields) {
    optionalFields.hidden = false;
  }
  if (toggleOptionalBtn) {
    toggleOptionalBtn.setAttribute("aria-expanded", "true");
    toggleOptionalBtn.textContent = "− Optional fields";
  }

  if (btn) {
    btn._origText = btn.textContent === "Replace?" ? (btn._origText || "→ Sentence") : btn.textContent;
    btn.textContent = "Inserted!";
    btn.classList.add("inserted");
    setTimeout(() => {
      btn.textContent = btn._origText || "→ Sentence";
      btn.classList.remove("inserted");
    }, 1200);
  }
}

function renderStudySenseItem(sense, sIdx, entry, totalSensesCount) {
  const li = document.createElement("li");
  li.className = "study-sense-item study-sense";

  // Sense number
  const senseNum = sense.index || (sIdx + 1);
  const numSpan = document.createElement("span");
  numSpan.className = "study-sense-num sense-num";
  numSpan.textContent = `${senseNum}.`;
  li.append(numSpan);

  const bodyDiv = document.createElement("div");
  bodyDiv.className = "study-sense-body";

  // Header line inside sense: POS, tags, and quick-insert button
  const headerDiv = document.createElement("div");
  headerDiv.className = "study-sense-header";

  const sensePosList = Array.isArray(sense.parts_of_speech) && sense.parts_of_speech.length
    ? sense.parts_of_speech
    : (totalSensesCount === 1 && Array.isArray(entry.parts_of_speech) ? entry.parts_of_speech : []);

  const senseTagsList = [
    ...(Array.isArray(sense.tags) ? sense.tags : []),
    ...(Array.isArray(sense.field_tags) ? sense.field_tags : []),
    ...(totalSensesCount === 1 && Array.isArray(entry.tags) ? entry.tags : []),
  ];

  const metaDiv = document.createElement("div");
  metaDiv.className = "study-sense-meta dict-sense-tags";

  sensePosList.forEach(pos => {
    if (pos && String(pos).trim()) {
      const posSpan = document.createElement("span");
      posSpan.className = "study-sense-pos study-pos-badge pos-tag kn-pos";
      posSpan.textContent = String(pos).trim();
      metaDiv.append(posSpan);
    }
  });

  senseTagsList.forEach(tag => {
    if (tag && String(tag).trim()) {
      const tagSpan = document.createElement("span");
      tagSpan.className = "study-sense-tag study-tag-badge tag-badge";
      tagSpan.textContent = String(tag).trim();
      metaDiv.append(tagSpan);
    }
  });

  headerDiv.append(metaDiv);

  // Quick-Insert Sense Action Button
  const insertSenseBtn = document.createElement("button");
  insertSenseBtn.className = "btn-dict-insert btn-sense-insert";
  insertSenseBtn.type = "button";
  insertSenseBtn.textContent = "Insert";
  insertSenseBtn.title = "Insert this sense into Meaning";
  insertSenseBtn.onclick = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const glossesList = Array.isArray(sense.glosses) ? sense.glosses.filter(Boolean) : [];
    insertSenseToMeaning(glossesList.join("; "), insertSenseBtn);
  };
  headerDiv.append(insertSenseBtn);

  bodyDiv.append(headerDiv);

  // Glosses
  const glossesList = Array.isArray(sense.glosses) ? sense.glosses.filter(Boolean) : [];
  if (glossesList.length) {
    const glossesSpan = document.createElement("span");
    glossesSpan.className = "study-glosses sense-glosses";
    glossesSpan.textContent = glossesList.join("; ");
    bodyDiv.append(glossesSpan);
  }

  // Notes
  if (Array.isArray(sense.notes) && sense.notes.length) {
    sense.notes.forEach(note => {
      if (note && String(note).trim()) {
        const pNote = document.createElement("p");
        pNote.className = "study-sense-note note";
        pNote.textContent = String(note).trim();
        bodyDiv.append(pNote);
      }
    });
  }

  // Cross-references
  if (Array.isArray(sense.cross_references) && sense.cross_references.length) {
    const xrefsContainer = document.createElement("div");
    xrefsContainer.className = "study-sense-xrefs";

    sense.cross_references.forEach(xref => {
      const targetTerm = typeof xref === "string" ? xref.trim() : (xref?.target_term || "").trim();
      if (!targetTerm) return;
      const displayText = typeof xref === "string"
        ? xref.trim()
        : (xref?.display_text || xref?.target_term || "").trim();

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "study-xref-chip";
      chip.textContent = displayText;
      chip.title = `Look up: ${targetTerm}`;

      chip.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();

        if (isCardDraftDirty()) {
          if (!chip.classList.contains("confirm-replace")) {
            chip.classList.add("confirm-replace");
            chip._origText = chip.textContent;
            chip.textContent = "Replace?";
            setTimeout(() => {
              if (chip.classList.contains("confirm-replace")) {
                chip.classList.remove("confirm-replace");
                chip.textContent = chip._origText || displayText;
              }
            }, 3000);
            return;
          }
          chip.classList.remove("confirm-replace");
        }

        identify(targetTerm);
      };

      xrefsContainer.append(chip);
    });

    if (xrefsContainer.children.length) {
      bodyDiv.append(xrefsContainer);
    }
  }

  // Examples attached to this sense
  if (Array.isArray(sense.examples) && sense.examples.length) {
    const validExamples = (sense.examples || []).filter(eg => eg && (eg.japanese || eg.reading));
    if (validExamples.length > 0) {
      const details = document.createElement("details");
      details.className = "study-examples-accordion";

      const summary = document.createElement("summary");
      summary.className = "study-examples-summary";
      summary.textContent = `Examples (${validExamples.length})`;
      details.append(summary);

      const listDiv = document.createElement("div");
      listDiv.className = "study-examples-list";

      if (validExamples.length === 1) {
        const eg = validExamples[0];
        const card = document.createElement("div");
        card.className = "study-example-card example-card";

        const contentDiv = document.createElement("div");
        contentDiv.className = "study-example-content";

        const jaP = document.createElement("p");
        jaP.className = "study-example-ja example";
        renderRubyText(jaP, eg.japanese, eg.reading);
        contentDiv.append(jaP);

        if (eg.translation) {
          const enP = document.createElement("p");
          enP.className = "study-example-en translation";
          enP.textContent = eg.translation;
          contentDiv.append(enP);
        }

        card.append(contentDiv);

        // Quick-Insert Example Button
        const insertExampleBtn = document.createElement("button");
        insertExampleBtn.className = "btn-dict-insert btn-example-insert btn-insert-sentence";
        insertExampleBtn.type = "button";
        insertExampleBtn.textContent = "→ Sentence";
        insertExampleBtn.title = "Insert this example into Sentence";
        insertExampleBtn.onclick = (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          insertExampleToCard(eg.japanese || "", eg.translation || "", insertExampleBtn);
        };
        card.append(insertExampleBtn);

        listDiv.append(card);
      } else {
        // T3-E: Multiple examples - render stepper controls (◀ 1/3 ▶)
        let currentExampleIdx = 0;

        const stepperBar = document.createElement("div");
        stepperBar.className = "example-stepper-controls";

        const prevBtn = document.createElement("button");
        prevBtn.type = "button";
        prevBtn.className = "btn-example-stepper btn-example-prev";
        prevBtn.textContent = "◀";
        prevBtn.title = "Previous example";
        prevBtn.setAttribute("aria-label", "Previous example sentence");

        const indicator = document.createElement("span");
        indicator.className = "example-stepper-indicator";
        indicator.textContent = `1 / ${validExamples.length}`;

        const nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.className = "btn-example-stepper btn-example-next";
        nextBtn.textContent = "▶";
        nextBtn.title = "Next example";
        nextBtn.setAttribute("aria-label", "Next example sentence");

        stepperBar.append(prevBtn, indicator, nextBtn);
        listDiv.append(stepperBar);

        const cardContainer = document.createElement("div");
        cardContainer.className = "example-stepper-card-container";
        listDiv.append(cardContainer);

        function renderActiveExampleCard(idx) {
          cardContainer.replaceChildren();
          const eg = validExamples[idx];
          if (!eg) return;

          const card = document.createElement("div");
          card.className = "study-example-card example-card";

          const contentDiv = document.createElement("div");
          contentDiv.className = "study-example-content";

          const jaP = document.createElement("p");
          jaP.className = "study-example-ja example";
          renderRubyText(jaP, eg.japanese, eg.reading);
          contentDiv.append(jaP);

          if (eg.translation) {
            const enP = document.createElement("p");
            enP.className = "study-example-en translation";
            enP.textContent = eg.translation;
            contentDiv.append(enP);
          }

          card.append(contentDiv);

          const insertExampleBtn = document.createElement("button");
          insertExampleBtn.className = "btn-dict-insert btn-example-insert btn-insert-sentence";
          insertExampleBtn.type = "button";
          insertExampleBtn.textContent = "→ Sentence";
          insertExampleBtn.title = "Insert this example into Sentence";
          insertExampleBtn.onclick = (e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            insertExampleToCard(eg.japanese || "", eg.translation || "", insertExampleBtn);
          };
          card.append(insertExampleBtn);
          cardContainer.append(card);

          indicator.textContent = `${idx + 1} / ${validExamples.length}`;
        }

        prevBtn.addEventListener("click", (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          currentExampleIdx = (currentExampleIdx - 1 + validExamples.length) % validExamples.length;
          renderActiveExampleCard(currentExampleIdx);
        });

        nextBtn.addEventListener("click", (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          currentExampleIdx = (currentExampleIdx + 1) % validExamples.length;
          renderActiveExampleCard(currentExampleIdx);
        });

        renderActiveExampleCard(0);
      }

      details.append(listDiv);
      bodyDiv.append(details);
    }
  }

  li.append(bodyDiv);
  return li;
}

function cleanReadingForInput(readingStr) {
  if (!readingStr) return "";
  return String(readingStr).replace(/[\.\-\(\)]/g, "").trim();
}

function renderKanjiCard(kanji, options = { mode: "full", isProminent: false }) {
  if (!kanji) return document.createElement("div");
  const opts = typeof options === "boolean"
    ? { mode: "full", isProminent: options }
    : { mode: "full", isProminent: false, ...options };
  const mode = opts.mode || "full";
  const isProminent = !!opts.isProminent;

  if (mode === "compact") {
    const card = document.createElement("div");
    card.className = "kn-kanji-card";

    // Header
    const header = document.createElement("div");
    header.className = "kn-kanji-header";

    if (kanji.character) {
      const charSpan = document.createElement("span");
      charSpan.className = "kn-kanji-char";
      charSpan.textContent = kanji.character;
      header.append(charSpan);
    }

    if (kanji.dictionary) {
      const dictSpan = document.createElement("span");
      dictSpan.className = "kn-tag";
      dictSpan.textContent = kanji.dictionary;
      header.append(dictSpan);
    }

    if (kanji.stats) {
      if (kanji.stats.strokes) {
        const sSpan = document.createElement("span");
        sSpan.className = "kn-tag";
        sSpan.textContent = `${kanji.stats.strokes} strokes`;
        header.append(sSpan);
      }
      if (kanji.stats.grade) {
        const gSpan = document.createElement("span");
        gSpan.className = "kn-tag";
        gSpan.textContent = `Grade ${kanji.stats.grade}`;
        header.append(gSpan);
      }

      // JLPT check
      let modernJlpt = null;
      if (Array.isArray(kanji.tags)) {
        for (const tag of kanji.tags) {
          const m = String(tag).trim().match(/^jlpt-n([1-5])$/i) || String(tag).trim().match(/^n([1-5])$/i);
          if (m) {
            modernJlpt = `N${m[1]}`;
            break;
          }
        }
      }

      const showJlpt = opts.showJlpt !== undefined
        ? opts.showJlpt
        : (typeof currentCardTemplateSettings !== "undefined" ? currentCardTemplateSettings?.show_jlpt !== false : true);
      if (showJlpt) {
        if (modernJlpt) {
          const jSpan = document.createElement("span");
          jSpan.className = "kn-tag kn-jlpt";
          jSpan.textContent = `JLPT ${modernJlpt}`;
          header.append(jSpan);
        } else if (kanji.stats.jlpt) {
          const rawJlpt = String(kanji.stats.jlpt).trim();
          if (rawJlpt.toUpperCase().startsWith("N")) {
            const jSpan = document.createElement("span");
            jSpan.className = "kn-tag kn-jlpt";
            jSpan.textContent = `JLPT ${rawJlpt.toUpperCase()}`;
            header.append(jSpan);
          }
        }
      }

      if (kanji.stats.freq) {
        const fSpan = document.createElement("span");
        fSpan.className = "kn-tag";
        fSpan.textContent = `Freq #${kanji.stats.freq}`;
        header.append(fSpan);
      }
    }
    card.append(header);

    // Readings
    const onyomi = Array.isArray(kanji.onyomi) ? kanji.onyomi.filter(Boolean) : [];
    const kunyomi = Array.isArray(kanji.kunyomi) ? kanji.kunyomi.filter(Boolean) : [];
    const nanori = Array.isArray(kanji.nanori) ? kanji.nanori.filter(Boolean) : [];

    let readingsDiv = null;
    if (onyomi.length || kunyomi.length || nanori.length) {
      readingsDiv = document.createElement("div");
      readingsDiv.className = "kn-kanji-readings";

      if (onyomi.length) {
        const row = document.createElement("div");
        row.className = "kn-kanji-reading-row";
        const lbl = document.createElement("span");
        lbl.className = "kn-reading-lbl";
        lbl.textContent = "Onyomi";
        row.append(lbl);
        const val = document.createElement("span");
        val.className = "kn-onyomi";
        val.textContent = onyomi.join(", ");
        row.append(val);
        readingsDiv.append(row);
      }

      if (kunyomi.length) {
        const row = document.createElement("div");
        row.className = "kn-kanji-reading-row";
        const lbl = document.createElement("span");
        lbl.className = "kn-reading-lbl";
        lbl.textContent = "Kunyomi";
        row.append(lbl);
        const val = document.createElement("span");
        val.className = "kn-kunyomi";
        val.textContent = kunyomi.map(formatKunyomi).join(", ");
        row.append(val);
        readingsDiv.append(row);
      }

      if (nanori.length) {
        const row = document.createElement("div");
        row.className = "kn-kanji-reading-row";
        const lbl = document.createElement("span");
        lbl.className = "kn-reading-lbl";
        lbl.textContent = "Nanori";
        row.append(lbl);
        const val = document.createElement("span");
        val.className = "kn-nanori";
        val.textContent = nanori.join(", ");
        row.append(val);
        readingsDiv.append(row);
      }
    }

    // Meanings
    const meanings = Array.isArray(kanji.meanings) ? kanji.meanings.filter(Boolean) : [];
    let meanDiv = null;
    if (meanings.length) {
      meanDiv = document.createElement("div");
      meanDiv.className = "kn-kanji-meanings";
      meanDiv.textContent = meanings.join(", ");
    }

    if (kanji.character) {
      const char = kanji.character;
      const bodyRow = document.createElement("div");
      bodyRow.className = "kn-kanji-body-row";

      const strokeCol = document.createElement("div");
      strokeCol.className = "kn-kanji-stroke-col";

      const detailsCol = document.createElement("div");
      detailsCol.className = "kn-kanji-details-col";
      if (readingsDiv) detailsCol.append(readingsDiv);
      if (meanDiv) detailsCol.append(meanDiv);

      bodyRow.append(strokeCol, detailsCol);
      card.append(bodyRow);

      getKanjiStrokeSvg(char).then((svgText) => {
        if (svgText) {
          const svgElem = createStrokeSvgElement(svgText);
          if (svgElem) {
            strokeCol.replaceChildren(svgElem);
            return;
          }
        }
        strokeCol.style.display = "none";
      });
    } else {
      if (readingsDiv) card.append(readingsDiv);
      if (meanDiv) card.append(meanDiv);
    }

    return card;
  }

  const card = document.createElement("div");
  card.className = isProminent ? "study-kanji-card prominent" : "study-kanji-card";

  // Header: Character + Dictionary Pill + Stats Pills
  const header = document.createElement("div");
  header.className = "study-kanji-header";

  const charSpan = document.createElement("span");
  charSpan.className = "study-kanji-character";
  charSpan.textContent = kanji.character || "";
  header.append(charSpan);

  const dictPill = document.createElement("span");
  dictPill.className = "dict-source-pill pill-dict study-kanji-dict";
  dictPill.textContent = kanji.dictionary || "Kanji";
  header.append(dictPill);

  let strokePill = null;
  // Stats pills
  if (kanji.stats) {
    if (kanji.stats.strokes) {
      strokePill = document.createElement("button");
      strokePill.type = "button";
      strokePill.className = "badge kanji-stat-badge kanji-stroke-toggle-btn";
      strokePill.textContent = `${kanji.stats.strokes} strokes ✍`;
      strokePill.title = "Click to toggle stroke order diagram";
      header.append(strokePill);
    }
    if (kanji.stats.grade) {
      const gradePill = document.createElement("span");
      gradePill.className = "badge kanji-stat-badge";
      gradePill.textContent = `Grade ${kanji.stats.grade}`;
      header.append(gradePill);
    }
    // JLPT check: check tags for modern jlpt-n*, else check stats
    let modernJlpt = null;
    if (Array.isArray(kanji.tags)) {
      for (const tag of kanji.tags) {
        const m = String(tag).trim().match(/^jlpt-n([1-5])$/i) || String(tag).trim().match(/^n([1-5])$/i);
        if (m) {
          modernJlpt = `N${m[1]}`;
          break;
        }
      }
    }

    if (modernJlpt) {
      const jlptPill = document.createElement("span");
      jlptPill.className = "badge jlpt-badge pill-jlpt kanji-stat-badge badge-jlpt";
      jlptPill.textContent = `JLPT ${modernJlpt}`;
      jlptPill.title = `Modern JLPT Level ${modernJlpt}`;
      header.append(jlptPill);
    } else if (kanji.stats.jlpt) {
      const rawJlpt = String(kanji.stats.jlpt).trim();
      if (rawJlpt.toUpperCase().startsWith("N")) {
        const jlptPill = document.createElement("span");
        jlptPill.className = "badge jlpt-badge pill-jlpt kanji-stat-badge badge-jlpt";
        jlptPill.textContent = `JLPT ${rawJlpt.toUpperCase()}`;
        header.append(jlptPill);
      }
    }
    if (kanji.stats.freq) {
      const freqPill = document.createElement("span");
      freqPill.className = "badge freq-badge pill-freq kanji-stat-badge";
      freqPill.textContent = `Freq #${kanji.stats.freq}`;
      header.append(freqPill);
    }
  }

  if (Array.isArray(kanji.tags) && kanji.tags.length) {
    kanji.tags.forEach(tag => {
      if (tag && String(tag).trim()) {
        const tagBadge = document.createElement("span");
        tagBadge.className = "badge study-tag-badge";
        tagBadge.textContent = String(tag).trim();
        header.append(tagBadge);
      }
    });
  }

  card.append(header);

  const body = document.createElement("div");
  body.className = "study-kanji-body";

  // Onyomi Row
  if (Array.isArray(kanji.onyomi) && kanji.onyomi.length) {
    const onRow = document.createElement("div");
    onRow.className = "kanji-reading-row onyomi-row";

    const label = document.createElement("span");
    label.className = "kanji-reading-label";
    label.textContent = "Onyomi";
    onRow.append(label);

    const pillsDiv = document.createElement("div");
    pillsDiv.className = "kanji-reading-pills";

    kanji.onyomi.forEach(on => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "pill-reading pill-onyomi";
      pill.textContent = on;
      pill.title = `Click to set reading to ${on}`;
      pill.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (fieldReading) {
          fieldReading.value = on;
          fieldReading.dispatchEvent(new Event("input", { bubbles: true }));
          fieldReading.dispatchEvent(new Event("change", { bubbles: true }));
        }
      };
      pillsDiv.append(pill);
    });

    onRow.append(pillsDiv);
    body.append(onRow);
  }

  // Kunyomi Row
  if (Array.isArray(kanji.kunyomi) && kanji.kunyomi.length) {
    const kunRow = document.createElement("div");
    kunRow.className = "kanji-reading-row kunyomi-row";

    const label = document.createElement("span");
    label.className = "kanji-reading-label";
    label.textContent = "Kunyomi";
    kunRow.append(label);

    const pillsDiv = document.createElement("div");
    pillsDiv.className = "kanji-reading-pills";

    kanji.kunyomi.forEach(kun => {
      const formatted = formatKunyomi(kun);
      const clean = cleanReadingForInput(kun);
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "pill-reading pill-kunyomi";
      pill.textContent = formatted;
      pill.title = `Click to set reading to ${clean}`;
      pill.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (fieldReading) {
          fieldReading.value = clean;
          fieldReading.dispatchEvent(new Event("input", { bubbles: true }));
          fieldReading.dispatchEvent(new Event("change", { bubbles: true }));
        }
      };
      pillsDiv.append(pill);
    });

    kunRow.append(pillsDiv);
    body.append(kunRow);
  }

  // Nanori Row
  if (Array.isArray(kanji.nanori) && kanji.nanori.length) {
    const nanoriRow = document.createElement("div");
    nanoriRow.className = "kanji-reading-row nanori-row";

    const label = document.createElement("span");
    label.className = "kanji-reading-label";
    label.textContent = "Nanori";
    nanoriRow.append(label);

    const pillsDiv = document.createElement("div");
    pillsDiv.className = "kanji-reading-pills";

    kanji.nanori.forEach(nan => {
      const pill = document.createElement("span");
      pill.className = "pill-reading pill-nanori";
      pill.textContent = nan;
      pillsDiv.append(pill);
    });

    nanoriRow.append(pillsDiv);
    body.append(nanoriRow);
  }

  // Meanings Row
  if (Array.isArray(kanji.meanings) && kanji.meanings.length) {
    const meaningRow = document.createElement("div");
    meaningRow.className = "kanji-meanings-row";

    const meaningHeader = document.createElement("div");
    meaningHeader.className = "kanji-meanings-header";

    const label = document.createElement("span");
    label.className = "kanji-reading-label";
    label.textContent = "Meanings";
    meaningHeader.append(label);

    const insertBtn = document.createElement("button");
    insertBtn.className = "btn-dict-insert btn-sense-insert btn-kanji-insert";
    insertBtn.type = "button";
    insertBtn.textContent = "Insert";
    insertBtn.title = "Insert kanji meanings into Meaning field";
    insertBtn.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      insertSenseToMeaning(kanji.meanings.join(", "), insertBtn);
    };
    meaningHeader.append(insertBtn);
    meaningRow.append(meaningHeader);

    const glossesSpan = document.createElement("span");
    glossesSpan.className = "kanji-glosses";
    glossesSpan.textContent = kanji.meanings.join(", ");
    meaningRow.append(glossesSpan);

    body.append(meaningRow);
  }

  card.append(body);

  // Progressive disclosure stroke order diagram (only loads & shows when opened)
  if (kanji.character) {
    const char = kanji.character;
    const strokesDetails = document.createElement("details");
    strokesDetails.className = "study-kanji-strokes-accordion";

    const strokesSummary = document.createElement("summary");
    strokesSummary.className = "study-kanji-strokes-summary";
    strokesSummary.title = "View stroke order diagram";

    const iconSpan = document.createElement("span");
    iconSpan.className = "stroke-summary-icon";
    iconSpan.textContent = "✍";

    const labelSpan = document.createElement("span");
    labelSpan.className = "stroke-summary-label";
    labelSpan.textContent = "Stroke Order";

    strokesSummary.append(iconSpan, labelSpan);
    strokesDetails.append(strokesSummary);

    const strokesPanel = document.createElement("div");
    strokesPanel.className = "study-kanji-strokes-panel";

    let hasLoaded = false;
    async function loadStrokes() {
      if (hasLoaded) return;
      hasLoaded = true;
      strokesPanel.textContent = "Loading stroke order…";
      const svgText = await getKanjiStrokeSvg(char);
      if (svgText) {
        const svgElem = createStrokeSvgElement(svgText);
        if (svgElem) {
          strokesPanel.replaceChildren(svgElem);
          return;
        }
      }
      const emptyNotice = document.createElement("span");
      emptyNotice.className = "study-kanji-strokes-empty";
      emptyNotice.textContent = "Stroke diagram unavailable for this character.";
      strokesPanel.replaceChildren(emptyNotice);
    }

    strokesDetails.addEventListener("toggle", () => {
      if (strokesDetails.open) {
        loadStrokes();
      }
    });

    strokesDetails.append(strokesPanel);
    card.append(strokesDetails);

    if (strokePill) {
      strokePill.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        strokesDetails.open = !strokesDetails.open;
        if (strokesDetails.open) loadStrokes();
      };
    }
  }

  return card;
}

function renderDetails(body) {
  clearDictionaryView();
  const rawObj = body?.term || body;
  const entries = Array.isArray(rawObj?.entries) ? rawObj.entries : [];
  const kanjiEntries = Array.isArray(rawObj?.kanji_entries) ? rawObj.kanji_entries : [];
  currentDictionaryEntries = entries;
  currentKanjiEntries = kanjiEntries;

  if (typeof harvestDiscoveredDictionaries === "function") {
    harvestDiscoveredDictionaries(entries, kanjiEntries);
  }

  const isExplicit = typeof hasExplicitDictionarySelection !== "undefined" && hasExplicitDictionarySelection;
  let visibleEntries = entries;
  let visibleKanjiEntries = kanjiEntries;
  if (isExplicit && typeof selectedDictionaries !== "undefined") {
    visibleEntries = entries.filter(e => {
      const dictName = e && e.dictionary ? String(e.dictionary).trim() : "";
      return !dictName || selectedDictionaries.has(dictName);
    });
    visibleKanjiEntries = kanjiEntries.filter(k => {
      const dictName = k && k.dictionary ? String(k.dictionary).trim() : "";
      return !dictName || selectedDictionaries.has(dictName);
    });
  }

  let jlptLevel = body?.jlpt_level || rawObj?.jlpt_level || currentJlptLevel;
  if (!jlptLevel && entries.length) {
    for (const e of entries) {
      for (const t of (e.tags || [])) {
        const m = String(t).match(/^jlpt-n([1-5])$/i) || String(t).match(/^n([1-5])$/i);
        if (m) { jlptLevel = `N${m[1]}`; break; }
      }
      if (jlptLevel) break;
    }
  }
  if (!jlptLevel && kanjiEntries.length) {
    for (const k of kanjiEntries) {
      if (k.stats && k.stats.jlpt && String(k.stats.jlpt).toUpperCase().startsWith("N")) {
        jlptLevel = String(k.stats.jlpt).toUpperCase();
        break;
      }
      for (const t of (k.tags || [])) {
        const m = String(t).match(/^jlpt-n([1-5])$/i) || String(t).match(/^n([1-5])$/i);
        if (m) { jlptLevel = `N${m[1]}`; break; }
      }
      if (jlptLevel) break;
    }
  }
  if (jlptLevel) {
    currentJlptLevel = jlptLevel;
  }

  // Update prominent DICTIONARY section header badge
  const dictJlptBadge = document.querySelector("#dict-jlpt-badge");
  if (dictJlptBadge) {
    if (jlptLevel) {
      dictJlptBadge.textContent = formatJlptLevel(jlptLevel);
      dictJlptBadge.hidden = false;
    } else {
      dictJlptBadge.hidden = true;
      dictJlptBadge.textContent = "";
    }
  }

  const expr = typeof rawObj?.expression === "string" ? rawObj.expression.trim() : (typeof fieldExpression !== "undefined" && fieldExpression?.value ? fieldExpression.value.trim() : "");

  if (!entries.length && !kanjiEntries.length) {
    if (typeof dictEmptyNotice !== "undefined" && dictEmptyNotice) {
      if (typeof dictEmptyNotice.replaceChildren === "function") {
        dictEmptyNotice.replaceChildren();
      } else {
        dictEmptyNotice.textContent = "";
      }
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "empty-state dict-empty-state";
      emptyDiv.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="empty-state-icon" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>` +
        `<p class="empty-state-text">No dictionary entries found for this term.</p>` +
        `<p class="empty-state-hint">Try searching a different expression or reading.</p>`;
      if (jlptLevel && expr) {
        const badgeRow = document.createElement("div");
        badgeRow.className = "dict-empty-jlpt-row";
        const badge = document.createElement("span");
        badge.className = "kn-tag kn-jlpt";
        badge.textContent = formatJlptLevel(jlptLevel);
        badgeRow.append(badge);
        emptyDiv.append(badgeRow);
      }
      dictEmptyNotice.append(emptyDiv);
      dictEmptyNotice.hidden = false;
    }
    return;
  }
  if (typeof dictEmptyNotice !== "undefined" && dictEmptyNotice) dictEmptyNotice.hidden = true;

  if (dictActionsBar) dictActionsBar.style.display = "flex";

  // Check if all dictionaries are deselected or none of the selected dictionaries matched
  if (isExplicit && typeof selectedDictionaries !== "undefined" && selectedDictionaries.size === 0) {
    if (meanings) {
      const notice = document.createElement("div");
      notice.className = "dict-none-selected-notice";
      const p = document.createElement("p");
      p.textContent = "No dictionaries selected for Reference View.";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-open-dict-settings";
      btn.textContent = "Open Dictionary Settings";
      btn.addEventListener("click", () => {
        if (typeof openLayoutSettings === "function") openLayoutSettings();
      });
      notice.append(p, btn);
      meanings.append(notice);
    }
    return;
  }

  if ((entries.length > 0 || kanjiEntries.length > 0) && visibleEntries.length === 0 && visibleKanjiEntries.length === 0) {
    if (meanings) {
      const notice = document.createElement("div");
      notice.className = "dict-none-selected-notice";
      const p = document.createElement("p");
      p.textContent = "No definitions found in your selected dictionaries.";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-open-dict-settings";
      btn.textContent = "Change Dictionary Settings";
      btn.addEventListener("click", () => {
        if (typeof openLayoutSettings === "function") openLayoutSettings();
      });
      notice.append(p, btn);
      meanings.append(notice);
    }
    return;
  }

  const isSingleKanji = visibleKanjiEntries.length > 0 && (visibleEntries.length === 0 || expr.length === 1);

  // 1. Structured Study View rendered into #meanings
  if (meanings) {
    // For single isolated kanji, render prominent kanji card at the top
    if (isSingleKanji) {
      visibleKanjiEntries.forEach(k => {
        meanings.append(renderKanjiCard(k, { mode: "full", isProminent: true }));
      });
    }

    if (visibleEntries.length) {
      const primaryEntry = visibleEntries.find(e => e.is_primary) || visibleEntries[0];

      visibleEntries.forEach((entry, entryIdx) => {
        const isPrimary = Boolean(entry.is_primary || entry === primaryEntry);

        // Meta Strip / Header for this entry
        const header = document.createElement("div");
        header.className = "study-dict-header";

        // Dictionary source pill
        const dictPill = document.createElement("span");
        dictPill.className = "dict-source-pill pill-dict";
        dictPill.textContent = entry.dictionary || "Dictionary";
        header.append(dictPill);

        // Primary badge
        if (entry.is_primary) {
          const primaryBadge = document.createElement("span");
          primaryBadge.className = "badge primary-badge";
          primaryBadge.textContent = "Primary";
          header.append(primaryBadge);
        }

        // If this is the primary entry and there are multiple entries, show count pill
        if (isPrimary && entryIdx === 0 && visibleEntries.length > 1) {
          const moreCount = visibleEntries.length - 1;
          const countPill = document.createElement("span");
          countPill.className = "dict-count-pill dict-extra-dicts-badge";
          countPill.textContent = `+${moreCount} more dict${moreCount > 1 ? "s" : ""}`;
          header.append(countPill);
        }

        // Pitch accent pills from entry.pitches
        if (Array.isArray(entry.pitches) && entry.pitches.length) {
          entry.pitches.forEach(pitch => {
            if (pitch && typeof pitch.position === "number") {
              const circle = getPitchCircleNumber(pitch.position);
              const pat = formatPitchPatternName(pitch.pattern_name);
              const text = pat ? `${circle} ${pat}` : circle;
              const pill = document.createElement("span");
              pill.className = "pill-pitch badge pitch-badge";
              pill.textContent = text;
              const desc = pat ? `${pat} (Downstep: ${pitch.position})` : `Downstep: ${pitch.position}`;
              pill.title = pitch.dictionary ? `${desc} [${pitch.dictionary}]` : desc;
              header.append(pill);
            }
          });
        }

        // JLPT level pill from body.jlpt_level (rendered on primary entry)
        const activeJlpt = jlptLevel;
        if (isPrimary && activeJlpt) {
          const jlptPill = document.createElement("span");
          jlptPill.className = "pill-jlpt badge jlpt-badge kn-tag kn-jlpt";
          jlptPill.textContent = formatJlptLevel(activeJlpt);
          header.append(jlptPill);
        }

        // Word class / Part of Speech badges
        const posSet = new Set();
        if (Array.isArray(entry.parts_of_speech)) {
          entry.parts_of_speech.forEach(p => {
            if (p && String(p).trim()) posSet.add(String(p).trim());
          });
        }
        if (Array.isArray(entry.raw_tags)) {
          entry.raw_tags.forEach(t => {
            const name = t && typeof t === "object" ? String(t.name || "").trim() : String(t || "").trim();
            const cat = t && typeof t === "object" ? String(t.category || "").toLowerCase() : "";
            if (name && (cat === "partofspeech" || cat === "class")) {
              posSet.add(name);
            }
          });
        }
        posSet.forEach(pos => {
          const posPill = document.createElement("span");
          posPill.className = "badge pos-badge study-pos-badge pos-tag";
          posPill.textContent = pos;
          header.append(posPill);
        });

        // Frequency rank pills from entry.frequencies
        if (Array.isArray(entry.frequencies) && entry.frequencies.length) {
          entry.frequencies.forEach(freq => {
            if (freq && (freq.dictionary || freq.rank != null || freq.display_value)) {
              const freqText = formatFrequencyRank(freq);
              const pill = document.createElement("span");
              pill.className = "pill-freq badge freq-badge";
              pill.textContent = freqText;
              pill.title = `${freq.dictionary || "Frequency"} Rank`;
              header.append(pill);
            }
          });
        }

        // Quick-insert meaning button
        const senses = Array.isArray(entry.senses) ? entry.senses : [];
        if (senses.length) {
          const insertBtn = document.createElement("button");
          insertBtn.type = "button";
          insertBtn.className = "btn-dict-insert btn-sense-insert btn-entry-insert";
          insertBtn.textContent = "Insert";
          insertBtn.title = `Insert meaning from ${entry.dictionary || "dictionary"} into Meaning field`;
          insertBtn.onclick = (e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            const glosses = senses.flatMap(s => s.glosses || []).filter(Boolean);
            if (glosses.length) {
              insertSenseToMeaning(glosses.join("; "), insertBtn);
            }
          };
          header.append(insertBtn);
        }

        // Container structure (multi-dictionary accordion or standard container)
        const isMultiDict = visibleEntries.length > 1;
        let entryContainer;
        let bodyHost;

        if (isMultiDict && !isPrimary) {
          const accordion = document.createElement("details");
          accordion.className = "study-entry dict-entry-accordion";
          accordion.open = false;

          const summary = document.createElement("summary");
          summary.className = "dict-entry-summary";

          const summaryLeft = document.createElement("div");
          summaryLeft.className = "dict-entry-summary-left";
          summaryLeft.append(header);

          const arrow = document.createElement("span");
          arrow.className = "dict-entry-summary-arrow";
          arrow.textContent = "▶";

          summary.append(summaryLeft, arrow);
          accordion.append(summary);

          const bodyWrapper = document.createElement("div");
          bodyWrapper.className = "dict-entry-body";
          accordion.append(bodyWrapper);

          entryContainer = accordion;
          bodyHost = bodyWrapper;
        } else {
          entryContainer = document.createElement("div");
          entryContainer.className = "study-entry";
          entryContainer.append(header);
          bodyHost = entryContainer;
        }

        // Headword & reading line if provided
        if (entry.term || entry.reading) {
          const hwDiv = document.createElement("div");
          hwDiv.className = "dict-entry-headword";
          const termSpan = document.createElement("span");
          termSpan.className = "dict-headword-term";
          termSpan.textContent = entry.term || expr;
          hwDiv.append(termSpan);
          if (entry.reading && entry.reading !== entry.term) {
            const readingSpan = document.createElement("span");
            readingSpan.className = "dict-headword-reading";
            readingSpan.textContent = entry.reading;
            hwDiv.append(readingSpan);
          }
          bodyHost.append(hwDiv);
        }

        // Content rendering: Structured content (Reference View) or Normalized Senses fallback
        const hasRawContent = Array.isArray(entry.raw_content) && entry.raw_content.length > 0;
        const renderer = typeof window !== "undefined" && window.YomitanReferenceRenderer
          ? window.YomitanReferenceRenderer
          : (typeof YomitanReferenceRenderer !== "undefined" ? YomitanReferenceRenderer : null);

        if (hasRawContent && renderer && typeof renderer.renderStructuredContent === "function") {
          const refDiv = document.createElement("div");
          refDiv.className = "dict-entry-reference-content";
          renderer.renderStructuredContent(refDiv, entry.raw_content, {
            onDictionaryLinkClick: (targetTerm, targetReading, e) => {
              const linkEl = e && e.target;
              if (typeof isCardDraftDirty === "function" && isCardDraftDirty()) {
                if (linkEl && !linkEl.classList.contains("confirm-replace")) {
                  linkEl.classList.add("confirm-replace");
                  linkEl._origText = linkEl.textContent;
                  linkEl.textContent = "Replace?";
                  setTimeout(() => {
                    if (linkEl.classList.contains("confirm-replace")) {
                      linkEl.classList.remove("confirm-replace");
                      linkEl.textContent = linkEl._origText || targetTerm;
                    }
                  }, 3000);
                  return;
                }
                if (linkEl) linkEl.classList.remove("confirm-replace");
              }
              identify(targetTerm);
            },
          });
          bodyHost.append(refDiv);
        } else if (senses.length) {
          // Normalized senses list fallback with Progressive Disclosure
          const PRIMARY_SENSES_LIMIT = 4;
          const primarySenses = senses.slice(0, PRIMARY_SENSES_LIMIT);
          const overflowSenses = senses.slice(PRIMARY_SENSES_LIMIT);

          const ol = document.createElement("ol");
          ol.className = "study-senses-list";

          primarySenses.forEach((sense, sIdx) => {
            ol.append(renderStudySenseItem(sense, sIdx, entry, senses.length));
          });

          bodyHost.append(ol);

          if (overflowSenses.length > 0) {
            const details = document.createElement("details");
            details.className = "senses-overflow-accordion";

            const summary = document.createElement("summary");
            summary.className = "senses-overflow-summary";
            const overflowCount = overflowSenses.length;
            const countText = `${overflowCount} more sense${overflowCount === 1 ? "" : "s"}`;
            summary.textContent = `Show ${countText}...`;

            details.addEventListener("toggle", () => {
              if (details.open) {
                summary.textContent = "Show fewer senses";
              } else {
                summary.textContent = `Show ${countText}...`;
              }
            });

            details.append(summary);

            const overflowOl = document.createElement("ol");
            overflowOl.setAttribute("start", String(PRIMARY_SENSES_LIMIT + 1));
            overflowOl.className = "study-senses-list senses-overflow-list";

            overflowSenses.forEach((sense, offsetIdx) => {
              const sIdx = PRIMARY_SENSES_LIMIT + offsetIdx;
              overflowOl.append(renderStudySenseItem(sense, sIdx, entry, senses.length));
            });

            details.append(overflowOl);
            bodyHost.append(details);
          }
        }

        meanings.append(entryContainer);
      });
    }

    // For multi-character vocabulary, render kanji entries in a collapsible accordion below term definitions
    if (!isSingleKanji && visibleKanjiEntries.length > 0) {
      const kanjiAccordion = document.createElement("details");
      kanjiAccordion.className = "study-kanji-accordion";

      const summary = document.createElement("summary");
      summary.className = "study-kanji-summary";
      summary.textContent = `Kanji in this word (${visibleKanjiEntries.length})`;
      kanjiAccordion.append(summary);

      const kanjiListDiv = document.createElement("div");
      kanjiListDiv.className = "study-kanji-list";
      visibleKanjiEntries.forEach(k => {
        kanjiListDiv.append(renderKanjiCard(k, { mode: "full", isProminent: false }));
      });
      kanjiAccordion.append(kanjiListDiv);

      meanings.append(kanjiAccordion);
    }
  }

  // Post-render cleanup pass: remove form tables where > 50% of td cells are empty (T1-D)
  if (meanings && typeof meanings.querySelectorAll === "function") {
    meanings.querySelectorAll("table").forEach(table => {
      const cells = Array.from(table.querySelectorAll("td"));
      if (cells.length > 0) {
        const empty = cells.filter(td => td.textContent.trim() === "").length;
        if (empty / cells.length > 0.5) {
          const wrapper = table.closest(".forms-section, .dict-forms-section, tr");
          if (wrapper && typeof wrapper.remove === "function") {
            wrapper.remove();
          } else if (typeof table.remove === "function") {
            table.remove();
          }
        }
      }
    });
  }
}

if (btnCopyRawDict) {
  btnCopyRawDict.addEventListener("click", async () => {
    let entriesToCopy = currentDictionaryEntries;
    let kanjiToCopy = currentKanjiEntries;
    const isExplicit = typeof hasExplicitDictionarySelection !== "undefined" && hasExplicitDictionarySelection;
    if (isExplicit && typeof selectedDictionaries !== "undefined") {
      entriesToCopy = currentDictionaryEntries.filter(e => !e?.dictionary || selectedDictionaries.has(String(e.dictionary).trim()));
      kanjiToCopy = currentKanjiEntries.filter(k => !k?.dictionary || selectedDictionaries.has(String(k.dictionary).trim()));
    }
    const rawText = formatRawDictionaryText(entriesToCopy, kanjiToCopy);
    if (!rawText) return;
    const ok = await copyTextToClipboard(rawText);
    if (ok) {
      const origText = btnCopyRawDict.textContent;
      btnCopyRawDict.textContent = "Copied! ✓";
      btnCopyRawDict.classList.add("copied");
      setTimeout(() => {
        btnCopyRawDict.textContent = origText;
        btnCopyRawDict.classList.remove("copied");
      }, 1500);
    }
  });
}

function notifyVideoHighlightTerm(term) {
  if (!term || typeof chrome === "undefined" || !chrome.tabs?.query) return;
  try {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id && chrome.tabs?.sendMessage) {
        chrome.tabs.sendMessage(tab.id, {
          type: "HIGHLIGHT_SUBTITLE_WORD",
          text: term
        }).catch(() => {});
      }
    }).catch(() => {});
  } catch (_) {}
}

async function identify(text) {
  const options = arguments.length > 1 && arguments[1] ? arguments[1] : {};
  const capturedText = typeof text === "string" ? text.trim() : "";
  if (!capturedText) return;
  const contextSentence = typeof options.contextSentence === "string" ? options.contextSentence.trim() : "";
  isSubtitleContextDraft = Boolean(contextSentence && options.videoContext === true);
  lastVideoHighlightTerm = capturedText;
  notifyVideoHighlightTerm(capturedText);
  if (currentMiningTab === "video" || videoCurrentCuePreview) {
    updateVideoCuePreviewText(currentActiveCue?.text, capturedText);
  }
  if (currentMiningTab === "ask" && typeof setAskContext === "function") {
    setAskContext(capturedText, "Text Selection");
  }
  const requestId = ++currentCaptureId;
  setStatus("Identifying selection…");
  setIndicatorStatus(indicatorYomitan, "checking", "Yomitan: Identifying…");
  setSaveBadge("", "badge", false);
  expression.textContent = "—";
  updateHeroReading("", "");
  if (wordMeaningsSummary) {
    wordMeaningsSummary.textContent = "";
    wordMeaningsSummary.hidden = true;
  }
  if (showcaseJlptBadge) {
    showcaseJlptBadge.hidden = true;
    showcaseJlptBadge.textContent = "";
  }
  if (showcasePosBadge) {
    showcasePosBadge.hidden = true;
    showcasePosBadge.textContent = "";
  }
  if (showcasePitchBadge) {
    showcasePitchBadge.hidden = true;
    showcasePitchBadge.textContent = "";
  }
  clearDictionaryView();
  if (dictLoadingIndicator) dictLoadingIndicator.hidden = false;
  clearAllMedia();

  const targetDeck = (fieldDeckSelect && fieldDeckSelect.value.trim()) || (fieldDeckName && fieldDeckName.value.trim()) || "Default";

  try {
    const response = await fetch(API_CAPTURE_URL, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text: capturedText, auto_save: false, deck_name: targetDeck}),
    });
    const body = await response.json().catch(() => ({}));
    if (requestId !== currentCaptureId) return;
    if (!response.ok) {
      const cause = response.status === 503
        ? "Backend/Yomitan unavailable"
        : response.status === 422
          ? "Invalid capture request"
          : "Backend request failed";
      setIndicatorStatus(indicatorYomitan, "unavailable", "Yomitan: Unavailable");
      throw new Error(`${cause}: ${body.detail || response.statusText}`);
    }

    setIndicatorStatus(indicatorYomitan, "connected", "Yomitan: Connected");

    const inputIsKana = isKanaOnly(capturedText);
    const kanjiForm = hasKanji(body.expression) ? body.expression : (hasKanji(body.deinflected_text) ? body.deinflected_text : "");
    const kanaForm = body.reading || (inputIsKana ? capturedText : "");

    let resolvedFrontPreference = "kanji";
    if (options && (options.preferredFront === "kana" || options.preferredFront === "kanji")) {
      resolvedFrontPreference = options.preferredFront;
    } else if (inputIsKana && kanjiForm) {
      // Hovering or capturing Kana defaults to Kana front with 1-click toggle to Kanji available
      resolvedFrontPreference = "kana";
    }

    const isKanaFront = resolvedFrontPreference === "kana" && Boolean(kanaForm);
    const activeFront = isKanaFront ? kanaForm : (body.expression || "—");
    const activeReading = isKanaFront ? (kanaForm || body.reading || "") : (body.reading || "");

    // Populate prominent hero elements
    expression.textContent = activeFront;
    updateHeroReading(activeReading, activeFront);
    if (body.jlpt_level) {
      currentJlptLevel = body.jlpt_level;
    }
    currentVerbMetadata = body.verb_metadata || null;
    renderDetails(body);
    updateHeroMeanings(body);
    updateHeroBadges(body);
    updateFrontToggleUI(kanjiForm, kanaForm, resolvedFrontPreference);

    // Populate Card Editor form
    if (cardEditor) {
      cardEditor.hidden = false;
      if (fieldCardId) fieldCardId.value = body.id || "";
      const isDraftOrNew = !body.id || body.status === "draft";
      if (fieldDeckSelect && body.deck_name && !isDraftOrNew) {
        fieldDeckSelect.value = body.deck_name;
      }
      if (fieldDeckName) fieldDeckName.value = (fieldDeckSelect && fieldDeckSelect.value) || body.deck_name || "Default";
      if (fieldModelSelect && body.model_name && !isDraftOrNew) {
        let hasOption = Array.from(fieldModelSelect.options).some(o => o.value === body.model_name);
        if (!hasOption) {
          const opt = document.createElement("option");
          opt.value = body.model_name;
          opt.textContent = body.model_name;
          fieldModelSelect.append(opt);
        }
        fieldModelSelect.value = body.model_name;
      }
      if (fieldModelName) fieldModelName.value = (fieldModelSelect && fieldModelSelect.value) || body.model_name || "";
      updateDestinationIndicator();
      if (fieldSourceText) fieldSourceText.value = body.source_text || "";
      if (fieldDeinflectedText) fieldDeinflectedText.value = body.deinflected_text || "";
      if (fieldExpression) fieldExpression.value = isKanaFront ? kanaForm : (body.expression || "");
      if (fieldReading) fieldReading.value = activeReading;
      if (fieldMeaning) fieldMeaning.value = body.meaning || "";
      if (fieldHint) fieldHint.value = body.hint || "";
      if (fieldExampleSentence) fieldExampleSentence.value = contextSentence || body.example_sentence || "";
      if (fieldExampleTranslation) fieldExampleTranslation.value = body.example_translation || "";
      if (fieldImage) fieldImage.value = body.image || "";
      if (fieldAudio) fieldAudio.value = body.audio || "";

      if (body.image) {
        const imgSrc = body.image.startsWith("data:") || body.image.startsWith("http:") || body.image.startsWith("https:")
          ? body.image
          : `${BACKEND_BASE_URL}/api/media/${body.image}`;
        currentDraftMedia.imageBase64 = imgSrc;
      }
      if (body.audio) {
        const audioSrc = body.audio.startsWith("data:") || body.audio.startsWith("http:") || body.audio.startsWith("https:")
          ? body.audio
          : `${BACKEND_BASE_URL}/api/media/${body.audio}`;
        currentDraftMedia.audioBase64 = audioSrc;
        currentDraftMedia.audioStatus = "available";
        currentDraftMedia.audioError = null;
      }
      updateMediaPreviews();
      if (fieldTags) fieldTags.value = body.tags || "";
      if (fieldNotes) fieldNotes.value = body.notes || "";
      if (isSubtitleContextDraft) {
        ensurePreviewContext();
        prioritizeSubtitleContextOnBack();
      }

      // Automatically trigger frame screenshot and sentence audio if enabled and media is not already saved.
      const shouldAutoCaptureFrame = toggleAutoCaptureFrame ? toggleAutoCaptureFrame.checked : true;
      const shouldAutoCaptureAudio = toggleAutoCaptureAudio ? toggleAutoCaptureAudio.checked : true;

      if (!body.image && shouldAutoCaptureFrame && isVideoMiningActive()) {
        retakeScreenshot(requestId, options.targetTime);
      }

      if (!body.audio && shouldAutoCaptureAudio && isVideoMiningActive()) {
        currentDraftMedia.audioStatus = "pending";
        currentDraftMedia.captureId = requestId;
        updateMediaPreviews();
        retakeAudio(requestId, options.cue);
      }

      // Sync state update
      if (body.id) {
        if (body.sync_status === "synced") {
          updateSyncUI("synced");
        } else if (body.sync_status === "failed") {
          updateSyncUI("failed", body.sync_error);
        } else {
          updateSyncUI("pending");
        }
      } else {
        updateSyncUI(ankiConnected ? "ready" : "not_connected");
      }
    }

    if (body.is_duplicate) {
      setSaveBadge("ALREADY SAVED", "badge already-saved", true);
      setStatus(body.dictionary_error || "Card already saved.");
    } else {
      setSaveBadge("", "badge", false);
      setStatus(body.dictionary_error || "Card draft ready. Edit and save.");
    }

    // Immediately trigger Card Preview update so hovered term and JLPT badge appear instantly!
    if (typeof updateCardPreview === "function") {
      updateCardPreview();
    }
    if (typeof scheduleCardPreviewUpdate === "function") {
      scheduleCardPreviewUpdate();
    }
  } catch (error) {
    if (requestId !== currentCaptureId) return;
    if (dictLoadingIndicator) dictLoadingIndicator.hidden = true;
    if (dictEmptyNotice) {
      if (typeof dictEmptyNotice.replaceChildren === "function") {
        dictEmptyNotice.replaceChildren();
      } else {
        dictEmptyNotice.textContent = "";
      }
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "empty-state dict-empty-state";
      emptyDiv.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="empty-state-icon" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>` +
        `<p class="empty-state-text">Yomitan is offline.</p>` +
        `<p class="empty-state-hint">Connect Yomitan to get dictionary enrichment.</p>`;
      dictEmptyNotice.append(emptyDiv);
      dictEmptyNotice.hidden = false;
    }
    setSaveBadge("", "badge", false);
    setIndicatorStatus(indicatorYomitan, "unavailable", "Yomitan: Unavailable");
    setStatus(formatErrorMessage(error), true);
  }
}

// Media preview management
function isVideoMiningActive() {
  if (currentMiningTab === "video") return true;
  if (videoMiningView && !videoMiningView.hidden) return true;
  if (lastCaptureSource?.tabId || currentActiveCue) return true;
  return false;
}

function updateMediaPreviews() {
  const hasImage = Boolean(currentDraftMedia.imageBase64);
  const hasAudio = Boolean(currentDraftMedia.audioBase64);
  const audioStatus = currentDraftMedia.audioStatus || (hasAudio ? "available" : "idle");

  if (imagePreview) {
    if (hasImage) {
      imagePreview.src = currentDraftMedia.imageBase64;
      imagePreview.hidden = false;
      if (imagePreview.style) imagePreview.style.display = "";
      imagePreview.alt = "Captured video frame";
    } else {
      imagePreview.removeAttribute("src");
      imagePreview.hidden = true;
      if (imagePreview.style) imagePreview.style.display = "none";
      imagePreview.alt = "";
    }
  }

  if (imageEmptyPlaceholder) {
    imageEmptyPlaceholder.hidden = hasImage;
  }

  if (btnClearImage) {
    btnClearImage.hidden = !hasImage;
  }

  // Audio preview & status handling
  if (audioPreview) {
    if (hasAudio) {
      if (audioPreview.src !== currentDraftMedia.audioBase64) {
        audioPreview.src = currentDraftMedia.audioBase64;
      }
      audioPreview.hidden = false;
    } else {
      if (typeof audioPreview.pause === "function") {
        try { audioPreview.pause(); } catch (_) {}
      }
      audioPreview.removeAttribute("src");
      audioPreview.hidden = true;
    }
  }

  if (audioEmptyPlaceholder) {
    audioEmptyPlaceholder.hidden = hasAudio;
  }

  if (btnClearAudio) {
    btnClearAudio.hidden = !hasAudio;
  }

  if (btnReplayAudio) {
    btnReplayAudio.hidden = !hasAudio;
  }

  if (audioStatusBadge) {
    audioStatusBadge.className = "media-status-pill";
    switch (audioStatus) {
      case "available":
        audioStatusBadge.textContent = "Ready";
        audioStatusBadge.classList.add("badge-ready");
        audioStatusBadge.title = "Audio clip extracted and ready";
        audioStatusBadge.hidden = false;
        break;
      case "pending":
        audioStatusBadge.textContent = "Pending…";
        audioStatusBadge.classList.add("badge-pending");
        audioStatusBadge.title = "Waiting for natural playback to finish sentence";
        audioStatusBadge.hidden = false;
        if (audioPlaceholderText) audioPlaceholderText.textContent = "Waiting for playback…";
        break;
      case "expired":
        audioStatusBadge.textContent = "Expired (>30s)";
        audioStatusBadge.classList.add("badge-expired");
        audioStatusBadge.title = "Audio fell outside the 30-second rolling buffer";
        audioStatusBadge.hidden = false;
        if (audioPlaceholderText) audioPlaceholderText.textContent = "Audio expired (>30s in past)";
        break;
      case "discontinuity":
        audioStatusBadge.textContent = "Discontinuity";
        audioStatusBadge.classList.add("badge-discontinuity");
        audioStatusBadge.title = "Video was seeked or timeline changed";
        audioStatusBadge.hidden = false;
        if (audioPlaceholderText) audioPlaceholderText.textContent = "Audio segment changed (seeked)";
        break;
      case "unavailable":
        const isDrm = String(currentDraftMedia.audioError || "").toUpperCase().includes("DRM");
        audioStatusBadge.textContent = isDrm ? "DRM Restricted" : "Unavailable";
        audioStatusBadge.classList.add("badge-unavailable");
        audioStatusBadge.title = isDrm
          ? "Audio capture restricted on this source (DRM protected)"
          : (currentDraftMedia.audioError || "Audio capture unavailable");
        audioStatusBadge.hidden = false;
        if (audioPlaceholderText) {
          audioPlaceholderText.textContent = isDrm
            ? "Audio unavailable (DRM protected)"
            : "Audio unavailable for this source";
        }
        break;
      default:
        audioStatusBadge.hidden = true;
        if (audioPlaceholderText) audioPlaceholderText.textContent = "No audio clip";
    }
  }

  const isAudioPending = audioStatus === "pending";
  const hasAnyMedia = hasImage || hasAudio || isAudioPending;

  const collEl = typeof mediaPreviewCollapsible !== "undefined" && mediaPreviewCollapsible
    ? mediaPreviewCollapsible
    : (typeof document !== "undefined" ? document.querySelector("#media-preview-collapsible") : null);
  if (collEl) {
    collEl.open = hasAnyMedia;
  }

  const badgeEl = typeof mediaSummaryBadge !== "undefined" && mediaSummaryBadge
    ? mediaSummaryBadge
    : (typeof document !== "undefined" ? document.querySelector("#media-summary-badge") : null);
  if (badgeEl) {
    if (hasImage && hasAudio) {
      badgeEl.textContent = "Image + Audio";
      if (badgeEl.classList) badgeEl.classList.add("badge-active");
    } else if (hasImage) {
      badgeEl.textContent = "Image";
      if (badgeEl.classList) badgeEl.classList.add("badge-active");
    } else if (hasAudio) {
      badgeEl.textContent = "Audio";
      if (badgeEl.classList) badgeEl.classList.add("badge-active");
    } else if (isAudioPending) {
      badgeEl.textContent = "Recording…";
      if (badgeEl.classList) badgeEl.classList.add("badge-active");
    } else {
      badgeEl.textContent = "None";
      if (badgeEl.classList) badgeEl.classList.remove("badge-active");
    }
  }

  if (mediaPreviewContainer) {
    mediaPreviewContainer.hidden = false;
    if (mediaPreviewContainer.classList) {
      if ((hasImage && !hasAudio && !isAudioPending) || (!hasImage && (hasAudio || isAudioPending))) {
        mediaPreviewContainer.classList.add("single-media");
      } else {
        mediaPreviewContainer.classList.remove("single-media");
      }
    }
  }
  if (typeof scheduleCardPreviewUpdate === "function") scheduleCardPreviewUpdate();
}

function clearImageMedia() {
  currentDraftMedia.imageBase64 = null;
  if (fieldImage) fieldImage.value = "";
  updateMediaPreviews();
  setStatus("Image cleared.");
}

function clearAudioMedia() {
  if (currentDraftMedia.captureId) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "CANCEL_PENDING_AUDIO_CAPTURE",
          captureId: currentDraftMedia.captureId
        }).catch(() => {});
      }
    } catch (_) {}
  }
  currentDraftMedia.audioBase64 = null;
  currentDraftMedia.audioStatus = "idle";
  currentDraftMedia.audioError = null;
  currentDraftMedia.mimeType = null;
  if (fieldAudio) fieldAudio.value = "";
  updateMediaPreviews();
  setStatus("Audio cleared.");
}

function clearAllMedia() {
  if (currentDraftMedia.captureId) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "CANCEL_PENDING_AUDIO_CAPTURE",
          captureId: currentDraftMedia.captureId
        }).catch(() => {});
      }
    } catch (_) {}
  }
  currentDraftMedia.imageBase64 = null;
  currentDraftMedia.audioBase64 = null;
  currentDraftMedia.audioStatus = "idle";
  currentDraftMedia.audioError = null;
  currentDraftMedia.mimeType = null;
  currentDraftMedia.captureId = null;
  updateMediaPreviews();
}

function captureOrRetakeScreenshot() {
  if (cardEditor && cardEditor.hidden) cardEditor.hidden = false;
  retakeScreenshot(currentCaptureId);
}

function recordOrRetakeAudio() {
  if (cardEditor && cardEditor.hidden) cardEditor.hidden = false;
  retakeAudio(currentCaptureId);
}

function retakeScreenshot(captureId = null, targetTime = null) {
  setStatus("Capturing video frame screenshot…");
  const capId = captureId || currentCaptureId;
  broadcastToActiveVideo({
    type: "TRIGGER_VIDEO_SCREENSHOT",
    options: {
      captureId: capId,
      targetTime: (typeof targetTime === "number" && Number.isFinite(targetTime)) ? targetTime : null,
      maxWidth: 640,
      maxHeight: 360,
      quality: 0.92
    }
  });
}

function retakeAudio(captureId = null, cue = null) {
  setStatus("Recording sentence audio…");
  const capId = captureId || currentCaptureId;
  const audioCue = cue || (typeof currentActiveCue !== "undefined" ? currentActiveCue : null);
  broadcastToActiveVideo({
    type: "TRIGGER_AUDIO_RECORDING",
    cue: audioCue,
    options: {
      captureId: capId,
      mimeType: "audio/webm;codecs=opus",
      allowPausedPlayback: true,
      allowFallbackRecording: true
    }
  });
}

if (btnClearImage) {
  btnClearImage.addEventListener("click", clearImageMedia);
}
if (btnClearAudio) {
  btnClearAudio.addEventListener("click", clearAudioMedia);
}
if (btnReplayAudio) {
  btnReplayAudio.addEventListener("click", () => {
    if (audioPreview && audioPreview.src) {
      audioPreview.currentTime = 0;
      audioPreview.play().catch(() => {});
    }
  });
}

if (fieldImage) {
  fieldImage.addEventListener("input", () => {
    const val = fieldImage.value.trim();
    if (val && (val.startsWith("http://") || val.startsWith("https://") || val.startsWith("data:image/"))) {
      currentDraftMedia.imageBase64 = val;
      updateMediaPreviews();
    } else if (!val && currentDraftMedia.imageBase64 && !currentDraftMedia.imageBase64.startsWith("data:image/")) {
      currentDraftMedia.imageBase64 = null;
      updateMediaPreviews();
    }
  });
}

if (fieldAudio) {
  fieldAudio.addEventListener("input", () => {
    const val = fieldAudio.value.trim();
    if (val && (val.startsWith("http://") || val.startsWith("https://") || val.startsWith("data:audio/"))) {
      currentDraftMedia.audioBase64 = val;
      currentDraftMedia.audioStatus = "available";
      currentDraftMedia.audioError = null;
      updateMediaPreviews();
    } else if (!val && currentDraftMedia.audioBase64 && !currentDraftMedia.audioBase64.startsWith("data:audio/")) {
      currentDraftMedia.audioBase64 = null;
      currentDraftMedia.audioStatus = "idle";
      updateMediaPreviews();
    }
  });
}

// Progressive disclosure toggle for optional fields
if (optionalDetails) {
  optionalDetails.addEventListener("toggle", () => {
    const isOpen = optionalDetails.open;
    if (optionalFields) {
      optionalFields.hidden = false;
    }
    if (toggleOptionalBtn) {
      toggleOptionalBtn.setAttribute("aria-expanded", String(isOpen));
      toggleOptionalBtn.textContent = isOpen ? "− Optional fields" : "+ Optional fields";
    }
  });
}

if (toggleOptionalBtn) {
  toggleOptionalBtn.addEventListener("click", () => {
    if (optionalDetails) {
      optionalDetails.open = !optionalDetails.open;
      if (optionalFields) optionalFields.hidden = false;
      toggleOptionalBtn.setAttribute("aria-expanded", String(optionalDetails.open));
      toggleOptionalBtn.textContent = optionalDetails.open ? "− Optional fields" : "+ Optional fields";
    } else if (optionalFields) {
      const isExpanded = !optionalFields.hidden;
      optionalFields.hidden = isExpanded;
      toggleOptionalBtn.setAttribute("aria-expanded", String(!isExpanded));
      toggleOptionalBtn.textContent = isExpanded ? "+ Optional fields" : "− Optional fields";
    }
  });
}

// Duplicate prevention and deck-scoped saved state management
var duplicateCheckTimer = null;
var duplicateCheckRequestId = 0;

function updateSaveBadge(text, className = "badge", isVisible = true) {
  if (typeof setSaveBadge === "function") {
    setSaveBadge(text, className, isVisible);
  } else {
    const badges = [];
    if (typeof saveBadge !== "undefined" && saveBadge) badges.push(saveBadge);
    if (typeof quickAddSaveBadge !== "undefined" && quickAddSaveBadge) badges.push(quickAddSaveBadge);
    badges.forEach(badge => {
      badge.textContent = isVisible ? text : "";
      badge.className = isVisible ? className : "badge";
      badge.hidden = !isVisible;
    });
  }
}

function scheduleDuplicateCheck(immediate = false) {
  if (duplicateCheckTimer) {
    clearTimeout(duplicateCheckTimer);
    duplicateCheckTimer = null;
  }
  if (immediate) {
    refreshDuplicateState();
  } else {
    duplicateCheckTimer = setTimeout(() => {
      refreshDuplicateState();
    }, 150);
  }
}

async function refreshDuplicateState() {
  const expr = fieldExpression ? fieldExpression.value.trim() : "";
  const read = fieldReading ? fieldReading.value.trim() : "";
  const targetDeck = (fieldDeckSelect && fieldDeckSelect.value.trim()) || (fieldDeckName && fieldDeckName.value.trim()) || "Default";

  if (!expr) {
    updateSaveBadge("", "badge", false);
    if (fieldCardId) fieldCardId.value = "";
    return;
  }

  const reqId = ++duplicateCheckRequestId;

  try {
    const params = new URLSearchParams({
      deck: targetDeck,
      search: expr,
      limit: "50",
      offset: "0",
    });
    const res = await fetch(`${API_CARDS_URL}?${params.toString()}`);
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    if (reqId !== duplicateCheckRequestId) return;

    const cards = Array.isArray(data.cards) ? data.cards : [];
    const normExpr = expr.trim().toLowerCase();
    const normRead = read.trim().toLowerCase();
    const normDeck = targetDeck.trim().toLowerCase();

    const existingCard = cards.find(c => {
      const cExpr = (c.expression || "").trim().toLowerCase();
      const cRead = (c.reading || "").trim().toLowerCase();
      const cDeck = (c.deck_name || "Default").trim().toLowerCase();
      return cExpr === normExpr && cRead === normRead && cDeck === normDeck;
    });

    if (existingCard) {
      if (fieldCardId) fieldCardId.value = String(existingCard.id);
      updateSaveBadge("ALREADY SAVED", "badge already-saved", true);
      setStatus("Card already saved.");
      if (existingCard.sync_status === "synced") {
        updateSyncUI("synced");
      } else if (existingCard.sync_status === "failed") {
        updateSyncUI("failed", existingCard.sync_error);
      } else {
        updateSyncUI("pending");
      }
    } else {
      if (fieldCardId) fieldCardId.value = "";
      updateSaveBadge("", "badge", false);
      setStatus("Card draft ready. Edit and save.");
      updateSyncUI(ankiConnected ? "ready" : "not_connected");
    }
    if (typeof scheduleCardPreviewUpdate === "function") scheduleCardPreviewUpdate();
  } catch (err) {
    // Fail-soft: if network or backend error occurs, do not block UI
  }
}

// Card save form submission
async function saveCard() {
  const expr = (typeof fieldExpression !== "undefined" && fieldExpression) ? fieldExpression.value.trim() : "";
  if (!expr) {
    if (typeof setStatus === "function") setStatus("Expression must not be empty.", true);
    return null;
  }

  if (typeof saveCardBtn !== "undefined" && saveCardBtn) {
    saveCardBtn.disabled = true;
    saveCardBtn.textContent = "Saving…";
  }

  const targetDeck = (typeof fieldDeckSelect !== "undefined" && fieldDeckSelect && fieldDeckSelect.value.trim()) || (typeof fieldDeckName !== "undefined" && fieldDeckName && fieldDeckName.value.trim()) || "Default";
  const targetModel = (typeof fieldModelSelect !== "undefined" && fieldModelSelect && fieldModelSelect.value.trim()) || (typeof fieldModelName !== "undefined" && fieldModelName && fieldModelName.value.trim()) || "";
  const payload = {
    id: (typeof fieldCardId !== "undefined" && fieldCardId && fieldCardId.value) ? parseInt(fieldCardId.value, 10) : null,
    expression: expr,
    reading: (typeof fieldReading !== "undefined" && fieldReading) ? fieldReading.value.trim() : "",
    meaning: (typeof fieldMeaning !== "undefined" && fieldMeaning) ? fieldMeaning.value.trim() : "",
    deck_name: targetDeck,
    model_name: targetModel,
    hint: (typeof fieldHint !== "undefined" && fieldHint) ? fieldHint.value.trim() : "",
    example_sentence: (typeof fieldExampleSentence !== "undefined" && fieldExampleSentence) ? fieldExampleSentence.value.trim() : "",
    example_translation: (typeof fieldExampleTranslation !== "undefined" && fieldExampleTranslation) ? fieldExampleTranslation.value.trim() : "",
    image: (typeof fieldImage !== "undefined" && fieldImage) ? fieldImage.value.trim() : "",
    audio: (typeof fieldAudio !== "undefined" && fieldAudio) ? fieldAudio.value.trim() : "",
    image_data: (typeof currentDraftMedia !== "undefined" && currentDraftMedia.imageBase64) || null,
    audio_data: (typeof currentDraftMedia !== "undefined" && currentDraftMedia.audioBase64) || null,
    media_mime_type: (typeof currentDraftMedia !== "undefined" && currentDraftMedia.mimeType) || null,
    tags: (typeof fieldTags !== "undefined" && fieldTags) ? fieldTags.value.trim() : "",
    notes: (typeof fieldNotes !== "undefined" && fieldNotes) ? fieldNotes.value.trim() : "",
    source_text: (typeof fieldSourceText !== "undefined" && fieldSourceText) ? fieldSourceText.value.trim() : "",
    deinflected_text: (typeof fieldDeinflectedText !== "undefined" && fieldDeinflectedText) ? fieldDeinflectedText.value.trim() : "",
    entries: (typeof currentDictionaryEntries !== "undefined" && Array.isArray(currentDictionaryEntries)) ? currentDictionaryEntries : [],
    kanji_entries: (typeof currentKanjiEntries !== "undefined" && Array.isArray(currentKanjiEntries)) ? currentKanjiEntries : [],
    jlpt_level: typeof currentJlptLevel !== "undefined" ? currentJlptLevel : null,
    verb_metadata: typeof currentVerbMetadata !== "undefined" ? currentVerbMetadata : null,
    card_settings: typeof getCardSettingsWithPreview === "function"
      ? getCardSettingsWithPreview()
      : (typeof currentCardTemplateSettings !== "undefined" ? currentCardTemplateSettings : null),
    source_type: (typeof lastCaptureSource !== "undefined" && lastCaptureSource?.type) || "text",
    source_url: (typeof lastCaptureSource !== "undefined" && lastCaptureSource?.url) || "",
  };

  try {
    const response = await fetch(API_SAVE_URL, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.detail || "Failed to save card.");
    }

    if (typeof fieldCardId !== "undefined" && fieldCardId) fieldCardId.value = body.id || "";
    previewContextKey = getPreviewContextKey();
    if (body.model_name && typeof fieldModelSelect !== "undefined" && fieldModelSelect) {
      fieldModelSelect.value = body.model_name;
      if (typeof fieldModelName !== "undefined" && fieldModelName) fieldModelName.value = body.model_name;
    }
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ last_used_deck: targetDeck, preferred_anki_model: targetModel });
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem("last_used_deck", targetDeck);
        localStorage.setItem("preferred_anki_model", targetModel);
      }
    } catch (_) {}
    if (typeof updateDestinationIndicator === "function") updateDestinationIndicator();
    if (body.audio) {
      if (typeof fieldAudio !== "undefined" && fieldAudio) fieldAudio.value = body.audio;
      const audioSrc = body.audio.startsWith("data:") || body.audio.startsWith("http:") || body.audio.startsWith("https:")
        ? body.audio
        : `${typeof BACKEND_BASE_URL !== "undefined" ? BACKEND_BASE_URL : ""}/api/media/${body.audio}`;
      if (typeof currentDraftMedia !== "undefined") {
        currentDraftMedia.audioBase64 = audioSrc;
        currentDraftMedia.audioStatus = "available";
        currentDraftMedia.audioError = null;
      }
    }
    if (body.image) {
      if (typeof fieldImage !== "undefined" && fieldImage) fieldImage.value = body.image;
      const imgSrc = body.image.startsWith("data:") || body.image.startsWith("http:") || body.image.startsWith("https:")
        ? body.image
        : `${typeof BACKEND_BASE_URL !== "undefined" ? BACKEND_BASE_URL : ""}/api/media/${body.image}`;
      if (typeof currentDraftMedia !== "undefined") {
        currentDraftMedia.imageBase64 = imgSrc;
      }
    }
    if (typeof updateMediaPreviews === "function") updateMediaPreviews();
    if (typeof expression !== "undefined" && expression) expression.textContent = body.expression || expr;
    if (typeof updateHeroReading === "function") updateHeroReading(body.reading, body.expression || expr);
    if (typeof updateHeroMeanings === "function") {
      if (body.meaning || (typeof fieldMeaning !== "undefined" && fieldMeaning && fieldMeaning.value)) {
        updateHeroMeanings(body.meaning ? body : { meaning: fieldMeaning.value });
      }
    }
    if (typeof updateHeroBadges === "function") updateHeroBadges(body);

    if (typeof updateSyncUI === "function") {
      if (body.sync_status === "synced") {
        updateSyncUI("synced");
      } else {
        updateSyncUI("pending");
      }
    }

    if (body.is_duplicate) {
      if (typeof setSaveBadge === "function") setSaveBadge("ALREADY SAVED", "badge already-saved", true);
      if (typeof setStatus === "function") setStatus("Card already saved.");
    } else {
      if (typeof setSaveBadge === "function") setSaveBadge("SAVED", "badge saved", true);
      if (typeof setStatus === "function") setStatus(body.is_updated ? "Card updated." : "Card saved.");
      if (body.is_new) {
        if (typeof sessionCardCount !== "undefined") sessionCardCount++;
        if (typeof updateSessionCounter === "function") updateSessionCounter();
      }
    }
    if (typeof isCardDraftDirtyState !== "undefined") isCardDraftDirtyState = false;
    if (typeof selectedHistoryCardId !== "undefined") selectedHistoryCardId = body.id || null;
    if (typeof cachedStats !== "undefined") cachedStats = null;
    if (typeof historyStatsDetails !== "undefined" && historyStatsDetails && historyStatsDetails.open && typeof loadHistoryStats === "function") {
      loadHistoryStats(true).catch(() => {});
    }
    if (typeof loadHistory === "function") loadHistory().catch(() => {});
    return body;
  } catch (error) {
    if (typeof setStatus === "function") {
      const errFormatted = typeof formatErrorMessage === "function" ? formatErrorMessage(error) : (error.message || String(error));
      setStatus(`Save failed: ${errFormatted}`, true);
    }
    return null;
  } finally {
    if (typeof saveCardBtn !== "undefined" && saveCardBtn) {
      saveCardBtn.disabled = false;
      saveCardBtn.textContent = "Save Card";
    }
  }
}

if (typeof cardEditor !== "undefined" && cardEditor) {
  cardEditor.addEventListener("submit", async event => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    await saveCard();
  });

  if (typeof cardEditor.addEventListener === "function") {
    cardEditor.addEventListener("input", () => {
      if (typeof isCardDraftDirtyState !== "undefined") isCardDraftDirtyState = true;
    });
  }
}

async function triggerAnkiSync() {
  const cardId = fieldCardId && fieldCardId.value ? parseInt(fieldCardId.value, 10) : null;
  if (!cardId) {
    setStatus("Save card before sending to Anki.", true);
    return;
  }

  // Guardrail 3: Destination safety - visible Deck + Note Type indicator is authoritative
  const targetDeck = (destDeckVal && destDeckVal.textContent.trim()) || (fieldDeckSelect && fieldDeckSelect.value.trim()) || (fieldDeckName && fieldDeckName.value.trim()) || "Default";
  const targetModel = (destModelVal && destModelVal.textContent.trim()) || (fieldModelSelect && fieldModelSelect.value.trim()) || (fieldModelName && fieldModelName.value.trim()) || "";

  updateSyncUI("syncing");
  try {
    const expr = fieldExpression ? fieldExpression.value.trim() : "";
    if (expr) {
      const payload = {
        id: cardId,
        expression: expr,
        reading: fieldReading ? fieldReading.value.trim() : "",
        meaning: fieldMeaning ? fieldMeaning.value.trim() : "",
        deck_name: targetDeck,
        model_name: targetModel,
        hint: fieldHint ? fieldHint.value.trim() : "",
        example_sentence: fieldExampleSentence ? fieldExampleSentence.value.trim() : "",
        example_translation: fieldExampleTranslation ? fieldExampleTranslation.value.trim() : "",
        image: fieldImage ? fieldImage.value.trim() : "",
        audio: fieldAudio ? fieldAudio.value.trim() : "",
        image_data: currentDraftMedia.imageBase64 || null,
        audio_data: currentDraftMedia.audioBase64 || null,
        media_mime_type: currentDraftMedia.mimeType || null,
        tags: fieldTags ? fieldTags.value.trim() : "",
        notes: fieldNotes ? fieldNotes.value.trim() : "",
        source_text: fieldSourceText ? fieldSourceText.value.trim() : "",
        deinflected_text: fieldDeinflectedText ? fieldDeinflectedText.value.trim() : "",
        entries: Array.isArray(currentDictionaryEntries) ? currentDictionaryEntries : [],
        kanji_entries: Array.isArray(currentKanjiEntries) ? currentKanjiEntries : [],
        jlpt_level: typeof currentJlptLevel !== "undefined" ? currentJlptLevel : null,
        verb_metadata: typeof currentVerbMetadata !== "undefined" ? currentVerbMetadata : null,
        card_settings: typeof getCardSettingsWithPreview === "function"
          ? getCardSettingsWithPreview()
          : (typeof currentCardTemplateSettings !== "undefined" ? currentCardTemplateSettings : null),
        source_type: (typeof lastCaptureSource !== "undefined" && lastCaptureSource?.type) || "text",
        source_url: (typeof lastCaptureSource !== "undefined" && lastCaptureSource?.url) || "",
      };
      const saveResponse = await fetch(API_SAVE_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
      });
      const saveBody = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok) throw new Error(saveBody.detail || "Failed to save card edits before Anki sync.");
      if (saveBody.id && fieldCardId) fieldCardId.value = saveBody.id;
      previewContextKey = getPreviewContextKey();
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ last_used_deck: targetDeck, preferred_anki_model: targetModel });
        } else if (typeof localStorage !== "undefined") {
          localStorage.setItem("last_used_deck", targetDeck);
          localStorage.setItem("preferred_anki_model", targetModel);
        }
      } catch (_) {}
      updateDestinationIndicator();
    }

    const response = await fetch(API_CARD_SYNC_URL(cardId), {
      method: "POST",
      headers: {"Content-Type": "application/json"},
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.sync_status === "failed") {
      const errMsg = body.error || body.detail || "Sync failed";
      updateSyncUI("failed", errMsg);
      setStatus(`Anki sync failed: ${errMsg}`, true);
      loadHistory().catch(() => {});
      return;
    }

    updateSyncUI("synced");
    setStatus("Card sent to Anki.");
    loadHistory().catch(() => {});
  } catch (error) {
    const msg = formatErrorMessage(error);
    updateSyncUI("failed", msg);
    setStatus(`Anki sync failed: ${msg}`, true);
    loadHistory().catch(() => {});
  }
}

if (syncAnkiBtn) {
  syncAnkiBtn.addEventListener("click", triggerAnkiSync);
}

if (ankiSyncStatus) {
  ankiSyncStatus.addEventListener("click", () => {
    if (ankiSyncStatus.classList.contains("failed")) {
      triggerAnkiSync();
    }
  });
}

// Authoritative Destination Target Indicator (Guardrail 3)
function updateDestinationIndicator() {
  const currentDeck = (fieldDeckSelect && fieldDeckSelect.value.trim()) || (fieldDeckName && fieldDeckName.value.trim()) || "Default";
  const currentModel = (fieldModelSelect && fieldModelSelect.value.trim()) || (fieldModelName && fieldModelName.value.trim()) || "Basic";
  if (destDeckVal) destDeckVal.textContent = currentDeck;
  if (destModelVal) destModelVal.textContent = currentModel;
}

// Japanese Input Mode & Quiet Contextual Assistance (Guardrails 1 & 2)
let isEditorJpModeActive = false;
let editorCandidateDebounceTimer = null;
let activeCandidateField = null;
let activeTokenInfo = null;
let editorCandidateList = [];
let editorCandidateHighlightedIndex = -1;

function setEditorJapaneseMode(active) {
  isEditorJpModeActive = Boolean(active);
  if (btnEditorJpMode) {
    btnEditorJpMode.setAttribute("aria-pressed", String(isEditorJpModeActive));
    btnEditorJpMode.classList.toggle("active", isEditorJpModeActive);
    const statusSpan = btnEditorJpMode.querySelector(".jp-mode-status");
    if (statusSpan) {
      statusSpan.textContent = isEditorJpModeActive ? "Kana" : "Off";
    }
  }
  // Guardrail 1: Japanese input mode is limited to free-form text fields.
  // NEVER bind WanaKana to Expression or Reading.
  const targetInputs = [fieldHint, fieldExampleSentence, fieldNotes].filter(Boolean);
  if (askInputBox) targetInputs.push(askInputBox);
  if (typeof wanakana !== "undefined") {
    targetInputs.forEach(input => {
      try {
        const nodeName = (input.nodeName || input.tagName || "").toUpperCase();
        if (nodeName !== "INPUT" && nodeName !== "TEXTAREA") return;
        if (isEditorJpModeActive) {
          if (!input.hasAttribute("data-wanakana-id") && typeof wanakana.bind === "function") {
            wanakana.bind(input, { IMEMode: true });
          }
        } else {
          if (input.hasAttribute("data-wanakana-id") && typeof wanakana.unbind === "function") {
            wanakana.unbind(input);
          }
        }
      } catch (err) {
        console.warn("WanaKana editor toggle error:", err);
      }
    });
  }
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ "kiroku.editor_jp_mode": isEditorJpModeActive });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("kiroku.editor_jp_mode", JSON.stringify(isEditorJpModeActive));
    }
  } catch (_) {}
}

async function initEditorJapaneseMode() {
  let active = false;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const data = await chrome.storage.local.get("kiroku.editor_jp_mode");
      if (typeof data?.["kiroku.editor_jp_mode"] === "boolean") {
        active = data["kiroku.editor_jp_mode"];
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("kiroku.editor_jp_mode");
      if (stored !== null) {
        active = JSON.parse(stored);
      }
    }
  } catch (_) {}
  setEditorJapaneseMode(active);
}

if (btnEditorJpMode) {
  btnEditorJpMode.addEventListener("click", () => {
    setEditorJapaneseMode(!isEditorJpModeActive);
  });
}

function clearEditorSuggestions() {
  if (editorSuggestionsContainer) {
    editorSuggestionsContainer.hidden = true;
  }
  if (editorSuggestionsList) {
    editorSuggestionsList.replaceChildren();
  }
  editorCandidateList = [];
  editorCandidateHighlightedIndex = -1;
  activeTokenInfo = null;
  activeCandidateField = null;
}

function updateEditorCandidateHighlight() {
  if (!editorSuggestionsList) return;
  const items = Array.from(editorSuggestionsList.children);
  items.forEach((item, i) => {
    const isHighlighted = (i === editorCandidateHighlightedIndex);
    item.classList.toggle("highlighted", isHighlighted);
    item.setAttribute("aria-selected", String(isHighlighted));
    if (isHighlighted && typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest" });
    }
  });
}

function selectEditorCandidate(candidate) {
  if (!activeCandidateField || !activeTokenInfo || !candidate) {
    clearEditorSuggestions();
    return;
  }
  const field = activeCandidateField;
  const { start, end, token } = activeTokenInfo;
  const currentVal = field.value;
  // Guardrail 2: Replace only the selected token; never silently replace text
  if (currentVal.slice(start, end) === token) {
    const replacement = candidate.expression || "";
    const newVal = currentVal.slice(0, start) + replacement + currentVal.slice(end);
    field.value = newVal;
    const newPos = start + replacement.length;
    if (typeof field.setSelectionRange === "function") {
      field.setSelectionRange(newPos, newPos);
    }
    field.focus();
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  clearEditorSuggestions();
}

function positionEditorSuggestions(field) {
  if (!editorSuggestionsContainer || !field) return;
  const editorEl = cardEditor || document.body;
  const fieldRect = field.getBoundingClientRect();
  const editorRect = editorEl.getBoundingClientRect();
  const top = (fieldRect.bottom - editorRect.top + editorEl.scrollTop + 4);
  const left = Math.max(8, fieldRect.left - editorRect.left);
  editorSuggestionsContainer.style.top = `${top}px`;
  editorSuggestionsContainer.style.left = `${left}px`;
}

function renderEditorSuggestions(entries, token, field, tokenStart, tokenEnd) {
  if (!editorSuggestionsContainer || !editorSuggestionsList) return;
  
  editorCandidateList = (entries || []).map(entry => {
    const expr = entry.term || entry.expression || "";
    const read = entry.reading || "";
    const gloss = (entry.senses && entry.senses[0] && entry.senses[0].glosses && entry.senses[0].glosses[0]) || "";
    return { expression: expr, reading: read, gloss };
  }).filter(c => Boolean(c.expression));

  if (editorCandidateList.length === 0) {
    clearEditorSuggestions();
    return;
  }

  activeCandidateField = field;
  activeTokenInfo = { field, start: tokenStart, end: tokenEnd, token };
  editorCandidateHighlightedIndex = -1;

  const items = editorCandidateList.slice(0, 6).map((candidate, idx) => {
    const li = document.createElement("li");
    li.className = "editor-candidate-item";
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    li.dataset.index = String(idx);

    const mainDiv = document.createElement("div");
    mainDiv.className = "editor-candidate-main";

    const exprSpan = document.createElement("span");
    exprSpan.className = "editor-candidate-expr";
    exprSpan.textContent = candidate.expression;
    mainDiv.appendChild(exprSpan);

    if (candidate.reading && candidate.reading !== candidate.expression) {
      const readSpan = document.createElement("span");
      readSpan.className = "editor-candidate-reading";
      readSpan.textContent = candidate.reading;
      mainDiv.appendChild(readSpan);
    }
    li.appendChild(mainDiv);

    if (candidate.gloss) {
      const glossDiv = document.createElement("div");
      glossDiv.className = "editor-candidate-gloss";
      glossDiv.textContent = candidate.gloss;
      li.appendChild(glossDiv);
    }

    li.addEventListener("mousedown", (e) => {
      e.preventDefault(); // Prevent blur before selection
      selectEditorCandidate(candidate);
    });

    li.addEventListener("mouseenter", () => {
      editorCandidateHighlightedIndex = idx;
      updateEditorCandidateHighlight();
    });

    return li;
  });

  editorSuggestionsList.replaceChildren(...items);
  positionEditorSuggestions(field);
  editorSuggestionsContainer.hidden = false;
}

function handleEditorTokenLookup(field) {
  if (!field || !isEditorJpModeActive) return;
  const caretPos = typeof field.selectionEnd === "number" ? field.selectionEnd : field.value.length;
  const textBefore = field.value.slice(0, caretPos);
  
  // Guardrail 2: Trigger only for a meaningful token after short pause (at least 2 Japanese characters)
  const match = textBefore.match(/([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]{2,})$/);
  if (!match) {
    clearEditorSuggestions();
    return;
  }
  const token = match[1];
  const tokenStart = caretPos - token.length;
  const tokenEnd = caretPos;
  const targetDeck = (destDeckVal && destDeckVal.textContent.trim()) || (fieldDeckSelect && fieldDeckSelect.value.trim()) || "Default";

  fetch(API_CAPTURE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: token, auto_save: false, deck_name: targetDeck }),
  })
    .then(res => (res.ok ? res.json() : null))
    .then(body => {
      if (!body) {
        clearEditorSuggestions();
        return;
      }
      const currentCaret = field.selectionEnd;
      if (currentCaret !== caretPos || field.value.slice(tokenStart, tokenEnd) !== token) {
        return;
      }
      let entries = Array.isArray(body.entries) && body.entries.length ? body.entries : [];
      if (!entries.length && body.expression) {
        entries = [{ expression: body.expression, reading: body.reading || "", senses: body.meanings ? [{ glosses: body.meanings }] : [] }];
      }
      renderEditorSuggestions(entries, token, field, tokenStart, tokenEnd);
    })
    .catch(() => {
      clearEditorSuggestions();
    });
}

function attachEditorFieldAssistance(field) {
  if (!field) return;

  field.addEventListener("input", () => {
    // Guardrail 2: disappear when typing continues
    if (editorSuggestionsContainer && !editorSuggestionsContainer.hidden) {
      clearEditorSuggestions();
    }
    if (editorCandidateDebounceTimer) {
      clearTimeout(editorCandidateDebounceTimer);
    }
    // Guardrail 2: 450ms pause before lookup
    editorCandidateDebounceTimer = setTimeout(() => {
      handleEditorTokenLookup(field);
    }, 450);
  });

  field.addEventListener("blur", () => {
    // Guardrail 2: disappear when focus moves
    setTimeout(() => {
      clearEditorSuggestions();
    }, 200);
  });

  field.addEventListener("keydown", (e) => {
    if (!editorSuggestionsContainer || editorSuggestionsContainer.hidden) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (editorCandidateList.length > 0) {
        editorCandidateHighlightedIndex = (editorCandidateHighlightedIndex + 1) % editorCandidateList.length;
        updateEditorCandidateHighlight();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (editorCandidateList.length > 0) {
        editorCandidateHighlightedIndex = (editorCandidateHighlightedIndex - 1 + editorCandidateList.length) % editorCandidateList.length;
        updateEditorCandidateHighlight();
      }
    } else if (e.key === "Enter") {
      if (editorCandidateHighlightedIndex >= 0 && editorCandidateHighlightedIndex < editorCandidateList.length) {
        e.preventDefault();
        selectEditorCandidate(editorCandidateList[editorCandidateHighlightedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      clearEditorSuggestions();
    }
  });
}

if (fieldHint) attachEditorFieldAssistance(fieldHint);
if (fieldExampleSentence) attachEditorFieldAssistance(fieldExampleSentence);
if (fieldNotes) attachEditorFieldAssistance(fieldNotes);

// Sync All action for eligible unsynced/retryable cards
let isSyncAllRunning = false;

async function triggerSyncAll(options = {}) {
  const silent = Boolean(options && options.silent);
  if (isSyncAllRunning) return;
  isSyncAllRunning = true;

  if (!silent && btnSyncAll) {
    btnSyncAll.disabled = true;
    btnSyncAll.classList.add("syncing");
    btnSyncAll.textContent = "Syncing…";
  }
  if (!silent && syncAllStatus) {
    syncAllStatus.hidden = false;
    syncAllStatus.className = "sync-all-status";
    syncAllStatus.textContent = "Checking Anki & syncing cards…";
  }

  if (!silent && typeof syncProgressModal !== "undefined" && syncProgressModal) {
    syncProgressModal.hidden = false;
    if (typeof syncProgressSummary !== "undefined" && syncProgressSummary) syncProgressSummary.textContent = "Connecting to Anki and syncing cards…";
    if (typeof syncModalProgressBar !== "undefined" && syncModalProgressBar) {
      syncModalProgressBar.style.width = "10%";
      syncModalProgressBar.style.background = "var(--accent-anki, #64b5f6)";
    }
    if (typeof syncProgressList !== "undefined" && syncProgressList) syncProgressList.replaceChildren();
    if (typeof btnDismissSyncModal !== "undefined" && btnDismissSyncModal) btnDismissSyncModal.hidden = true;
  }

  try {
    const response = await fetch(API_CARD_SYNC_ALL_URL, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.error) {
      const errMsg = body.error || body.detail || "Sync All failed";
      if (!silent && syncAllStatus) {
        syncAllStatus.hidden = false;
        syncAllStatus.className = "sync-all-status failed";
        syncAllStatus.textContent = `⚠ ${errMsg}`;
      }
      if (!silent && typeof syncProgressModal !== "undefined" && syncProgressModal) {
        if (typeof syncProgressSummary !== "undefined" && syncProgressSummary) syncProgressSummary.textContent = `⚠ ${errMsg}`;
        if (typeof syncModalProgressBar !== "undefined" && syncModalProgressBar) {
          syncModalProgressBar.style.width = "100%";
          syncModalProgressBar.style.background = "var(--accent-coral, #ff8c70)";
        }
        if (typeof btnDismissSyncModal !== "undefined" && btnDismissSyncModal) btnDismissSyncModal.hidden = false;
      }
      if (!silent) setStatus(`Sync All failed: ${errMsg}`, true);
      await loadHistory().catch(() => {});
      return;
    }

    const { total_eligible = 0, synced_count = 0, failed_count = 0, results = [] } = body;

    if (!silent && typeof syncProgressModal !== "undefined" && syncProgressModal) {
      if (total_eligible === 0) {
        if (typeof syncProgressSummary !== "undefined" && syncProgressSummary) syncProgressSummary.textContent = "No cards to sync (all up to date).";
        if (typeof syncModalProgressBar !== "undefined" && syncModalProgressBar) syncModalProgressBar.style.width = "100%";
        if (typeof btnDismissSyncModal !== "undefined" && btnDismissSyncModal) btnDismissSyncModal.hidden = false;
      } else {
        if (typeof syncProgressList !== "undefined" && syncProgressList) syncProgressList.replaceChildren();
        for (let i = 0; i < results.length; i++) {
          const item = results[i];
          const isSuccess = item.sync_status === "synced";
          const li = document.createElement("li");
          li.className = `sync-item ${isSuccess ? "success" : "failed"}`;

          const iconSpan = document.createElement("span");
          iconSpan.className = "sync-icon";
          iconSpan.textContent = isSuccess ? "✓" : "✗";

          const exprSpan = document.createElement("span");
          exprSpan.className = "sync-expr";
          exprSpan.textContent = item.expression || `Card #${item.id}`;

          li.append(iconSpan, exprSpan);

          if (!isSuccess && item.error) {
            const errSpan = document.createElement("span");
            errSpan.className = "sync-err";
            errSpan.textContent = item.error;
            errSpan.title = item.error;
            li.append(errSpan);
          }

          if (typeof syncProgressList !== "undefined" && syncProgressList) {
            syncProgressList.append(li);
            syncProgressList.scrollTop = syncProgressList.scrollHeight;
          }

          if (typeof syncModalProgressBar !== "undefined" && syncModalProgressBar) {
            const pct = Math.round(((i + 1) / results.length) * 100);
            syncModalProgressBar.style.width = `${pct}%`;
          }
        }

        if (typeof syncProgressSummary !== "undefined" && syncProgressSummary) {
          syncProgressSummary.textContent = `Sync complete: ${synced_count} succeeded, ${failed_count} failed.`;
        }
        if (typeof btnDismissSyncModal !== "undefined" && btnDismissSyncModal) btnDismissSyncModal.hidden = false;
      }
    }

    if (!silent) {
      if (total_eligible === 0) {
        if (syncAllStatus) {
          syncAllStatus.hidden = false;
          syncAllStatus.className = "sync-all-status";
          syncAllStatus.textContent = "No cards to sync (all up to date).";
        }
        setStatus("No eligible cards to sync.");
      } else if (failed_count === 0) {
        if (syncAllStatus) {
          syncAllStatus.hidden = false;
          syncAllStatus.className = "sync-all-status success";
          syncAllStatus.textContent = `✓ ${synced_count} card${synced_count === 1 ? "" : "s"} synced to Anki`;
        }
        setStatus(`Sync All complete: ${synced_count} card${synced_count === 1 ? "" : "s"} synced.`);
      } else if (synced_count > 0) {
        if (syncAllStatus) {
          syncAllStatus.hidden = false;
          syncAllStatus.className = "sync-all-status partial";
          syncAllStatus.textContent = `✓ ${synced_count} synced, ⚠ ${failed_count} failed`;
        }
        setStatus(`Sync All: ${synced_count} synced, ${failed_count} failed.`, true);
      } else {
        if (syncAllStatus) {
          syncAllStatus.hidden = false;
          syncAllStatus.className = "sync-all-status failed";
          syncAllStatus.textContent = `⚠ All ${failed_count} cards failed to sync`;
        }
        setStatus(`Sync All failed: ${failed_count} cards failed.`, true);
      }
    }

    if (typeof cachedStats !== "undefined") cachedStats = null;
    if (typeof historyStatsDetails !== "undefined" && historyStatsDetails && historyStatsDetails.open && typeof loadHistoryStats === "function") {
      loadHistoryStats(true).catch(() => {});
    }
    await loadHistory().catch(() => {});
  } catch (error) {
    const msg = formatErrorMessage(error);
    if (!silent && syncAllStatus) {
      syncAllStatus.hidden = false;
      syncAllStatus.className = "sync-all-status failed";
      syncAllStatus.textContent = `⚠ Sync All failed: ${msg}`;
    }
    if (!silent && syncProgressModal) {
      if (syncProgressSummary) syncProgressSummary.textContent = `⚠ Sync All failed: ${msg}`;
      if (syncModalProgressBar) {
        syncModalProgressBar.style.width = "100%";
        syncModalProgressBar.style.background = "var(--accent-coral, #ff8c70)";
      }
      if (btnDismissSyncModal) btnDismissSyncModal.hidden = false;
    }
    if (!silent) setStatus(`Sync All failed: ${msg}`, true);
    await loadHistory().catch(() => {});
  } finally {
    isSyncAllRunning = false;
    if (btnSyncAll) {
      btnSyncAll.disabled = false;
      btnSyncAll.classList.remove("syncing");
      btnSyncAll.textContent = "Sync All";
    }
  }
}

if (btnSyncAll) {
  btnSyncAll.addEventListener("click", () => triggerSyncAll({ silent: false }));
}

if (typeof btnCloseSyncModal !== "undefined" && btnCloseSyncModal) {
  btnCloseSyncModal.addEventListener("click", () => {
    if (typeof syncProgressModal !== "undefined" && syncProgressModal) syncProgressModal.hidden = true;
  });
}

if (typeof btnDismissSyncModal !== "undefined" && btnDismissSyncModal) {
  btnDismissSyncModal.addEventListener("click", () => {
    if (typeof syncProgressModal !== "undefined" && syncProgressModal) syncProgressModal.hidden = true;
  });
}


// Keyboard shortcuts
document.addEventListener("keydown", event => {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? event.metaKey : event.ctrlKey;

  if (event.altKey && (event.key.toLowerCase() === "o" || event.code === "KeyO")) {
    event.preventDefault();
    if (ocrCaptureBtn) {
      ocrCaptureBtn.click();
    }
    return;
  }

  // T3-A: Alt+Enter Smart Save Shortcut (Save + Sync in one action)
  if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter")) {
    if (event.target && typeof event.target.matches === "function" && event.target.matches("textarea, input[type=text]")) {
      return;
    }
    event.preventDefault();
    if (cardEditor && !cardEditor.hidden) {
      saveCard().then(saved => {
        if (saved && saved.id) {
          triggerAnkiSync();
        }
      }).catch(() => {});
    }
    return;
  }

  if (modKey && event.key === "Enter") {
    event.preventDefault();
    if (cardEditor && !cardEditor.hidden) {
      cardEditor.requestSubmit();
    }
    return;
  }

  if (modKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (fieldExpression) {
      fieldExpression.focus();
      fieldExpression.select();
    }
    return;
  }

  if (modKey && event.shiftKey && event.key.toLowerCase() === "m") {
    event.preventDefault();
    if (fieldMeaning) {
      fieldMeaning.focus();
      fieldMeaning.select();
    }
    return;
  }

  if (event.key === "Escape") {
    if (syncProgressModal && !syncProgressModal.hidden) {
      syncProgressModal.hidden = true;
      return;
    }
    const popover = cardSettingsPopover || layoutSettingsPopover;
    if (popover && !popover.hidden) {
      closeLayoutSettings();
      return;
    }
    if (optionalDetails && optionalDetails.open) {
      optionalDetails.open = false;
      if (toggleOptionalBtn) {
        toggleOptionalBtn.setAttribute("aria-expanded", "false");
        toggleOptionalBtn.textContent = "+ Optional fields";
        toggleOptionalBtn.focus();
      }
      return;
    }
    if (!optionalDetails && optionalFields && !optionalFields.hidden) {
      optionalFields.hidden = true;
      if (toggleOptionalBtn) {
        toggleOptionalBtn.setAttribute("aria-expanded", "false");
        toggleOptionalBtn.textContent = "+ Optional fields";
        toggleOptionalBtn.focus();
      }
      return;
    }
    return;
  }

  // Phase 8.3: Video Mining Mode offset shortcuts in Side Panel
  if (videoMiningView && !videoMiningView.hidden) {
    const activeEl = document.activeElement;
    const isEditable = activeEl && (
      activeEl.tagName === "INPUT" ||
      activeEl.tagName === "TEXTAREA" ||
      activeEl.tagName === "SELECT" ||
      activeEl.isContentEditable
    );
    if (!isEditable && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (event.key === "[" || event.code === "BracketLeft") {
        event.preventDefault();
        adjustOffset(-100);
      } else if (event.key === "]" || event.code === "BracketRight") {
        event.preventDefault();
        adjustOffset(100);
      } else if (event.key === "\\" || event.code === "Backslash") {
        event.preventDefault();
        resetOffset();
      }
    }
  }
});

// First-Run Quick Setup Guide logic
async function checkFirstRunStatus(totalCardsCount) {
  if (!firstRunGuide) return;
  if (totalCardsCount > 0) {
    firstRunGuide.hidden = true;
    return;
  }
  let dismissed = false;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("first_run_dismissed");
      dismissed = Boolean(stored?.first_run_dismissed);
    } else if (typeof localStorage !== "undefined") {
      dismissed = localStorage.getItem("first_run_dismissed") === "true";
    }
  } catch (_) {}
  firstRunGuide.hidden = dismissed;
}

async function dismissFirstRunGuide() {
  if (firstRunGuide) firstRunGuide.hidden = true;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ first_run_dismissed: true });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("first_run_dismissed", "true");
    }
  } catch (_) {}
}

// Mining Stats Dashboard (T3-F)
let cachedStats = null;
let cachedStatsTime = 0;
const STATS_CACHE_TTL_MS = 30000;

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function loadHistoryStats(force = false) {
  if (!historyStatsContent) return;
  const now = Date.now();
  if (!force && cachedStats && (now - cachedStatsTime < STATS_CACHE_TTL_MS)) {
    renderHistoryStats(cachedStats);
    return;
  }
  historyStatsContent.innerHTML = '<div class="stats-loading" style="padding:8px; color:var(--text-muted); font-size:12px;">Loading stats…</div>';
  try {
    const res = await fetch(API_CARDS_STATS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedStats = data;
    cachedStatsTime = Date.now();
    renderHistoryStats(data);
  } catch (err) {
    console.warn("Failed to load history stats:", err);
    historyStatsContent.innerHTML = `<div class="stats-error" style="color:var(--text-muted); font-size:11.5px; padding:6px;">Unable to load stats (${escapeHtml(err.message)}).</div>`;
  }
}

function renderHistoryStats(stats) {
  if (!historyStatsContent || !stats) return;

  const total = Number(stats.total) || 0;
  const today = Number(stats.today) || 0;
  const thisWeek = Number(stats.this_week) || 0;

  const sync = stats.sync_ratio || {};
  const synced = Number(sync.synced) || 0;
  const pending = Number(sync.pending) || 0;
  const failed = Number(sync.failed) || 0;
  const syncTotal = synced + pending + failed || total || 1;

  const syncedPct = Math.round((synced / syncTotal) * 100);
  const pendingPct = Math.round((pending / syncTotal) * 100);
  const failedPct = Math.max(0, 100 - syncedPct - pendingPct);

  // JLPT levels
  const jlptMap = stats.jlpt_breakdown || {};
  const jlptLevels = [
    { key: "N5", color: "#61afef" },
    { key: "N4", color: "#98c379" },
    { key: "N3", color: "#e5c07b" },
    { key: "N2", color: "#d19a66" },
    { key: "N1", color: "#e06c75" },
    { key: "Unknown", color: "#7f848e" },
  ];
  const maxJlptCount = Math.max(...jlptLevels.map(l => Number(jlptMap[l.key]) || 0), 1);

  // Top decks
  const topDecks = Array.isArray(stats.top_decks) ? stats.top_decks : [];

  // Generate SVG for horizontal bar chart
  const svgRows = jlptLevels.map((lvl, idx) => {
    const count = Number(jlptMap[lvl.key]) || 0;
    const barWidth = count > 0 ? Math.max(Math.round((count / maxJlptCount) * 180), 3) : 0;
    const y = idx * 22;
    return `
      <text x="2" y="${y + 13}" font-size="11" fill="var(--text-secondary, #b5b0a8)" font-family="monospace, sans-serif">${lvl.key}</text>
      <rect x="58" y="${y + 3}" width="180" height="11" rx="3" fill="var(--bg-surface-3, #252320)" opacity="0.6"/>
      ${barWidth > 0 ? `<rect x="58" y="${y + 3}" width="${barWidth}" height="11" rx="3" fill="${lvl.color}"/>` : ""}
      <text x="246" y="${y + 13}" font-size="11" fill="var(--text-muted, #7a746e)" font-family="monospace, sans-serif">${count}</text>
    `;
  }).join("");

  const decksHtml = topDecks.length > 0
    ? topDecks.map((d, i) => `
        <div class="stat-deck-row">
          <span class="stat-deck-name">${i + 1}. ${escapeHtml(d.deck_name || "Default")}</span>
          <span class="stat-deck-count">${d.count} card${d.count === 1 ? "" : "s"}</span>
        </div>
      `).join("")
    : '<div style="font-size:11px; color:var(--text-muted); padding:4px 0;">No cards mined yet.</div>';

  historyStatsContent.innerHTML = `
    <div class="stat-metrics-row">
      <div class="stat-metric-card">
        <span class="stat-metric-val">${today}</span>
        <span class="stat-metric-label">Today</span>
      </div>
      <div class="stat-metric-card">
        <span class="stat-metric-val">${thisWeek}</span>
        <span class="stat-metric-label">This Week</span>
      </div>
      <div class="stat-metric-card">
        <span class="stat-metric-val">${total}</span>
        <span class="stat-metric-label">All-Time</span>
      </div>
    </div>

    <div class="stat-block">
      <div class="stat-block-title">
        <span>Sync Status</span>
        <span style="font-size:10px; color:var(--text-muted);">${synced}/${total} synced</span>
      </div>
      <div class="stat-sync-track">
        <div class="stat-sync-bar synced" style="width: ${syncedPct}%;" title="${synced} synced"></div>
        <div class="stat-sync-bar pending" style="width: ${pendingPct}%;" title="${pending} pending"></div>
        <div class="stat-sync-bar failed" style="width: ${failedPct}%;" title="${failed} failed"></div>
      </div>
      <div class="stat-sync-legend">
        <span>✓ ${synced} Synced</span>
        <span>⏳ ${pending} Pending</span>
        <span>⚠️ ${failed} Failed</span>
      </div>
    </div>

    <div class="stat-block">
      <div class="stat-block-title">JLPT Breakdown</div>
      <div class="stat-jlpt-chart">
        <svg class="stat-jlpt-svg" viewBox="0 0 280 134" aria-label="JLPT distribution chart">
          ${svgRows}
        </svg>
      </div>
    </div>

    <div class="stat-block">
      <div class="stat-block-title">Top Decks</div>
      <div class="stat-top-decks-list">
        ${decksHtml}
      </div>
    </div>
  `;
}

if (historyStatsDetails) {
  historyStatsDetails.addEventListener("toggle", () => {
    if (historyStatsDetails.open) {
      if (historyStatsSummary) historyStatsSummary.textContent = "Stats ▾";
      loadHistoryStats();
    } else {
      if (historyStatsSummary) historyStatsSummary.textContent = "Stats ▸";
    }
  });
}

// Mining History & Card Library logic
async function loadHistory() {
  if (!historyCardsList) return;
  try {
    const search = historySearchInput ? historySearchInput.value.trim() : "";
    const deck = historyDeckFilter ? historyDeckFilter.value : "all";
    const syncStatus = historySyncFilter ? historySyncFilter.value : "all";

    const params = new URLSearchParams({ limit: "50", offset: "0" });
    if (search) params.set("search", search);
    if (deck && deck !== "all") params.set("deck", deck);
    if (syncStatus && syncStatus !== "all") params.set("sync_status", syncStatus);

    const res = await fetch(`${API_CARDS_URL}?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to load history");
    const data = await res.json();
    const cards = Array.isArray(data.cards) ? data.cards : [];
    const total = typeof data.total === "number" ? data.total : cards.length;

    checkFirstRunStatus(total);

    const synced = typeof data.synced_total === "number"
      ? data.synced_total
      : (syncStatus === "synced" ? total : (syncStatus !== "all" && syncStatus ? 0 : cards.filter(c => c.sync_status === "synced").length));

    if (historyCount) {
      historyCount.textContent = `${total} card${total === 1 ? "" : "s"}`;
    }
    if (historySyncLabel) {
      historySyncLabel.textContent = `${synced} / ${total} synced`;
    }
    if (historyProgressBar) {
      const pct = total > 0 ? Math.min(100, Math.round((synced / total) * 100)) : 0;
      historyProgressBar.style.width = `${pct}%`;
    }

    if (cards.length === 0) {
      historyCardsList.replaceChildren();
      if (historyEmpty) {
        historyEmpty.hidden = false;
        if (typeof historyEmpty.replaceChildren === "function") {
          historyEmpty.replaceChildren();
        } else {
          historyEmpty.textContent = "";
        }
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "empty-state history-empty-state";
        const isFiltered = Boolean(search || deck !== "all" || syncStatus !== "all");
        emptyDiv.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-state-icon" aria-hidden="true"><rect x="2" y="7" width="16" height="14" rx="2"/><path d="M6 3h14a2 2 0 0 1 2 2v12"/></svg>` +
          `<p class="empty-state-text">${isFiltered ? "No matching cards found." : "No cards mined yet."}</p>` +
          `<p class="empty-state-hint">${isFiltered ? "Try adjusting your search query or filters." : "Start mining to see your history here."}</p>`;
        historyEmpty.append(emptyDiv);
      }
    } else {
      if (historyEmpty) {
        historyEmpty.hidden = true;
        if (typeof historyEmpty.replaceChildren === "function") historyEmpty.replaceChildren();
      }
      renderHistoryCards(sortHistoryCards(cards, currentHistorySort));
    }

    updateDeckFilterOptions(cards);
  } catch (err) {
    if (historyEmpty) {
      historyEmpty.hidden = false;
      historyEmpty.textContent = "Failed to load history.";
    }
  }
}

function sortHistoryCards(cards, sortKey) {
  if (!Array.isArray(cards)) return [];
  const copy = [...cards];
  switch (sortKey) {
    case "date-asc":
      return copy.sort((a, b) => (a.id || 0) - (b.id || 0));
    case "date-desc":
      return copy.sort((a, b) => (b.id || 0) - (a.id || 0));
    case "jlpt": {
      const jlptRank = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };
      return copy.sort((a, b) => {
        const rA = a.jlpt_level ? (jlptRank[String(a.jlpt_level).toUpperCase()] || 99) : 999;
        const rB = b.jlpt_level ? (jlptRank[String(b.jlpt_level).toUpperCase()] || 99) : 999;
        if (rA !== rB) return rA - rB;
        return (b.id || 0) - (a.id || 0);
      });
    }
    case "deck":
      return copy.sort((a, b) => (a.deck_name || "").localeCompare(b.deck_name || ""));
    case "status":
      return copy.sort((a, b) => (a.sync_status || "").localeCompare(b.sync_status || ""));
    default:
      return copy;
  }
}

async function loadStoredHistorySort() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(STORAGE_KEY_HISTORY_SORT);
      if (stored?.[STORAGE_KEY_HISTORY_SORT]) {
        currentHistorySort = stored[STORAGE_KEY_HISTORY_SORT];
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY_HISTORY_SORT);
      if (stored) currentHistorySort = stored;
    }
  } catch (_) {}
  if (historySortSelect) historySortSelect.value = currentHistorySort;
}

function saveStoredHistorySort(val) {
  currentHistorySort = val;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [STORAGE_KEY_HISTORY_SORT]: val });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_HISTORY_SORT, val);
    }
  } catch (_) {}
}

function updateDeckFilterOptions(cards) {
  if (!historyDeckFilter) return;
  const currentVal = historyDeckFilter.value;
  const existingOptions = new Set(Array.from(historyDeckFilter.options).map(o => o.value));

  cards.forEach(c => {
    if (c.deck_name && !existingOptions.has(c.deck_name)) {
      const opt = document.createElement("option");
      opt.value = c.deck_name;
      opt.textContent = c.deck_name;
      historyDeckFilter.append(opt);
      existingOptions.add(c.deck_name);
    }
  });

  if (fieldDeckSelect) {
    Array.from(fieldDeckSelect.options).forEach(opt => {
      if (opt.value && !existingOptions.has(opt.value)) {
        const newOpt = document.createElement("option");
        newOpt.value = opt.value;
        newOpt.textContent = opt.value;
        historyDeckFilter.append(newOpt);
        existingOptions.add(opt.value);
      }
    });
  }

  if (existingOptions.has(currentVal)) {
    historyDeckFilter.value = currentVal;
  }

  if (typeof bulkDeckSelect !== "undefined" && bulkDeckSelect) {
    const bulkExisting = new Set(Array.from(bulkDeckSelect.options).map(o => o.value));
    existingOptions.forEach(deckName => {
      if (deckName && deckName !== "all" && !bulkExisting.has(deckName)) {
        const opt = document.createElement("option");
        opt.value = deckName;
        opt.textContent = deckName;
        bulkDeckSelect.append(opt);
        bulkExisting.add(deckName);
      }
    });
  }
}

function renderHistoryCards(cards) {
  if (!historyCardsList) return;
  historyCardsList.replaceChildren();

  if (typeof currentRenderedCardIds !== "undefined") {
    currentRenderedCardIds = cards.map(c => c.id);
  }

  cards.forEach(card => {
    const isSelected = typeof selectedHistoryCardIds !== "undefined" && selectedHistoryCardIds.has(card.id);
    const item = document.createElement("article");
    item.className = "history-item" + (selectedHistoryCardId === card.id ? " selected" : "") + (isSelected ? " bulk-selected" : "");
    item.dataset.cardId = String(card.id);

    const selectCb = document.createElement("input");
    selectCb.type = "checkbox";
    selectCb.className = "history-select-cb";
    selectCb.checked = Boolean(isSelected);
    selectCb.title = `Select ${card.expression}`;
    selectCb.setAttribute("aria-label", `Select card ${card.expression}`);
    selectCb.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    selectCb.addEventListener("change", (e) => {
      e.stopPropagation();
      if (typeof selectedHistoryCardIds !== "undefined") {
        if (selectCb.checked) {
          selectedHistoryCardIds.add(card.id);
          item.classList.add("bulk-selected");
        } else {
          selectedHistoryCardIds.delete(card.id);
          item.classList.remove("bulk-selected");
        }
      }
      if (typeof updateBulkActionBarState === "function") {
        updateBulkActionBarState();
      }
    });
    item.append(selectCb);

    const cardBtn = document.createElement("button");
    cardBtn.type = "button";
    cardBtn.className = "history-item-card-btn";
    cardBtn.setAttribute("aria-label", `Open card ${card.expression}${card.reading ? `: ${card.reading}` : ""}`);
    cardBtn.addEventListener("click", () => openSavedCard(card.id));

    const main = document.createElement("div");
    main.className = "history-item-main";

    const head = document.createElement("div");
    head.className = "history-item-head";

    const expr = document.createElement("span");
    expr.className = "history-item-expression";
    expr.textContent = card.expression;
    head.append(expr);

    if (card.reading) {
      const read = document.createElement("span");
      read.className = "history-item-reading";
      read.textContent = card.reading;
      head.append(read);
    }
    main.append(head);

    if (card.meaning) {
      const mean = document.createElement("p");
      mean.className = "history-item-meaning";
      mean.textContent = card.meaning;
      main.append(mean);
    }

    const meta = document.createElement("div");
    meta.className = "history-item-meta";

    const deckBadge = document.createElement("span");
    deckBadge.className = "history-item-deck";
    deckBadge.textContent = card.deck_name || "Default";
    deckBadge.title = `Deck: ${card.deck_name || "Default"}`;
    meta.append(deckBadge);

    if (card.jlpt_level) {
      const jlptPill = document.createElement("span");
      jlptPill.className = "history-item-jlpt pill-jlpt";
      jlptPill.textContent = card.jlpt_level;
      jlptPill.title = `JLPT: ${card.jlpt_level}`;
      meta.append(jlptPill);
    }

    const syncBadge = document.createElement("span");
    const statusKey = card.sync_status || "pending";
    syncBadge.className = `history-badge sync-${statusKey}`;
    syncBadge.textContent = statusKey.charAt(0).toUpperCase() + statusKey.slice(1);
    meta.append(syncBadge);

    if (card.source_type || card.source_url) {
      const srcType = card.source_type || "text";
      const sourceBadge = document.createElement("span");
      sourceBadge.className = "history-item-source";
      let icon = "📄";
      let label = "Text";
      if (srcType === "video") {
        icon = "🎬";
        label = "Video";
      } else if (srcType === "ocr") {
        icon = "🔲";
        label = "OCR";
      } else if (srcType === "quick_add" || srcType === "quickadd") {
        icon = "⚡";
        label = "Quick Add";
      }

      let host = "";
      if (card.source_url) {
        try {
          const u = new URL(card.source_url);
          host = u.hostname.replace(/^www\./, "");
        } catch (_) {
          host = card.source_url.slice(0, 20);
        }
      }

      sourceBadge.textContent = host ? `${icon} ${host}` : `${icon} ${label}`;
      sourceBadge.title = card.source_url ? `Mined from ${label}: ${card.source_url}` : `Mined from: ${label}`;
      meta.append(sourceBadge);
    }

    main.append(meta);
    cardBtn.append(main);
    item.append(cardBtn);

    const actions = document.createElement("div");
    actions.className = "history-item-actions";

    if (card.sync_status === "failed") {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "btn-history-retry";
      retryBtn.textContent = "Retry";
      retryBtn.title = `Retry Anki sync: ${card.sync_error || "Error"}`;
      retryBtn.setAttribute("aria-label", `Retry syncing ${card.expression} to Anki`);
      retryBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        retrySyncFromHistory(card.id);
      });
      actions.append(retryBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-history-delete";
    delBtn.innerHTML = "&times;";
    delBtn.title = "Delete local card";
    delBtn.setAttribute("aria-label", `Delete ${card.expression} from local database`);
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteLocalCard(card.id, card.expression, delBtn);
    });
    actions.append(delBtn);

    item.append(actions);
    historyCardsList.append(item);
  });

  if (typeof updateBulkActionBarState === "function") {
    updateBulkActionBarState();
  }
}

async function openSavedCard(cardId) {
  try {
    selectedHistoryCardId = cardId;
    if (historyCardsList) {
      historyCardsList.querySelectorAll(".history-item").forEach(el => {
        el.classList.toggle("selected", el.dataset.cardId === String(cardId));
      });
    }

    const res = await fetch(API_CARD_DETAIL_URL(cardId));
    if (!res.ok) throw new Error("Could not retrieve card details.");
    const body = await res.json();

    if (cardEditor) {
      cardEditor.hidden = false;
      if (fieldCardId) fieldCardId.value = body.id || "";
      if (fieldExpression) fieldExpression.value = body.expression || "";
      restorePreviewPresentation(body.card_settings?.preview_presentation);
      if (fieldReading) fieldReading.value = body.reading || "";
      if (fieldMeaning) fieldMeaning.value = body.meaning || "";
      if (fieldHint) fieldHint.value = body.hint || "";
      if (fieldExampleSentence) fieldExampleSentence.value = body.example_sentence || "";
      if (fieldExampleTranslation) fieldExampleTranslation.value = body.example_translation || "";
      if (fieldImage) fieldImage.value = body.image || "";
      if (fieldAudio) fieldAudio.value = body.audio || "";

      clearAllMedia();
      if (body.image) {
        const imgSrc = body.image.startsWith("data:") || body.image.startsWith("http:") || body.image.startsWith("https:")
          ? body.image
          : `${BACKEND_BASE_URL}/api/media/${body.image}`;
        currentDraftMedia.imageBase64 = imgSrc;
      }
      if (body.audio) {
        const audioSrc = body.audio.startsWith("data:") || body.audio.startsWith("http:") || body.audio.startsWith("https:")
          ? body.audio
          : `${BACKEND_BASE_URL}/api/media/${body.audio}`;
        currentDraftMedia.audioBase64 = audioSrc;
        currentDraftMedia.audioStatus = "available";
        currentDraftMedia.audioError = null;
      } else {
        currentDraftMedia.audioBase64 = null;
        currentDraftMedia.audioStatus = "idle";
      }
      updateMediaPreviews();
      if (fieldTags) fieldTags.value = body.tags || "";
      if (fieldNotes) fieldNotes.value = body.notes || "";
      if (fieldSourceText) fieldSourceText.value = body.source_text || "";
      if (fieldDeinflectedText) fieldDeinflectedText.value = body.deinflected_text || "";

      if (fieldDeckSelect && body.deck_name) {
        let hasDeck = Array.from(fieldDeckSelect.options).some(o => o.value === body.deck_name);
        if (!hasDeck) {
          const opt = document.createElement("option");
          opt.value = body.deck_name;
          opt.textContent = body.deck_name;
          fieldDeckSelect.append(opt);
        }
        fieldDeckSelect.value = body.deck_name;
      }
      if (fieldDeckName) fieldDeckName.value = (fieldDeckSelect && fieldDeckSelect.value) || body.deck_name || "Default";

      if (fieldModelSelect && body.model_name) {
        let hasModel = Array.from(fieldModelSelect.options).some(o => o.value === body.model_name);
        if (!hasModel) {
          const opt = document.createElement("option");
          opt.value = body.model_name;
          opt.textContent = body.model_name;
          fieldModelSelect.append(opt);
        }
        fieldModelSelect.value = body.model_name;
      }
      if (fieldModelName) fieldModelName.value = (fieldModelSelect && fieldModelSelect.value) || body.model_name || "";
      updateDestinationIndicator();

      if (body.source_type || body.source_url) {
        lastCaptureSource = {
          tabId: null,
          frameId: null,
          type: body.source_type || "text",
          url: body.source_url || "",
          title: "",
        };
      }

      if (expression) expression.textContent = body.expression || "—";
      updateHeroReading(body.reading, body.expression);
      updateHeroMeanings(body);
      updateHeroBadges(body);

      const savedIsKana = isKanaOnly(body.expression);
      const entryKanji = (Array.isArray(body.entries) && body.entries[0] && hasKanji(body.entries[0].expression || body.entries[0].headword))
        ? (body.entries[0].expression || body.entries[0].headword)
        : "";
      const savedKanji = !savedIsKana ? body.expression : (hasKanji(body.reading) ? body.reading : entryKanji);
      const savedKana = savedIsKana ? body.expression : body.reading;
      updateFrontToggleUI(savedKanji, savedKana, savedIsKana ? "kana" : "kanji");

      if (body.sync_status === "synced") {
        updateSyncUI("synced");
      } else if (body.sync_status === "failed") {
        updateSyncUI("failed", body.sync_error);
      } else {
        updateSyncUI("pending");
      }

      if ((Array.isArray(body.entries) && body.entries.length) || (Array.isArray(body.kanji_entries) && body.kanji_entries.length)) {
        renderDetails({
          entries: body.entries || [],
          kanji_entries: body.kanji_entries || [],
          expression: body.expression,
          jlpt_level: body.jlpt_level,
        });
      } else {
        clearDictionaryView();
        currentJlptLevel = body.jlpt_level || null;
        currentVerbMetadata = body.verb_metadata || null;
      }

      setSaveBadge("SAVED", "badge saved", true);
      setStatus("Opened saved card from library.");
      if (typeof scheduleCardPreviewUpdate === "function") scheduleCardPreviewUpdate();
    }
  } catch (err) {
    setStatus(`Failed to open card: ${err.message}`, true);
  }
}

// T3-C: 5-Second Undo Toast on History Deletion
let pendingDeletion = null;

function showUndoToast(message, onUndo) {
  if (!undoToast) return;
  if (undoToastMessage) undoToastMessage.textContent = message;
  undoToast.hidden = false;
  if (btnUndoDelete) {
    btnUndoDelete.onclick = (e) => {
      e.preventDefault();
      if (typeof onUndo === "function") onUndo();
    };
  }
}

function hideUndoToast() {
  if (undoToast) {
    undoToast.hidden = true;
  }
}

async function commitPendingDelete() {
  if (!pendingDeletion) return;
  const toDelete = pendingDeletion;
  clearTimeout(toDelete.timerId);
  pendingDeletion = null;
  hideUndoToast();

  try {
    const res = await fetch(API_CARD_DETAIL_URL(toDelete.cardId), { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete card.");

    if (fieldCardId && fieldCardId.value === String(toDelete.cardId)) {
      fieldCardId.value = "";
      if (fieldExpression) fieldExpression.value = "";
      if (fieldReading) fieldReading.value = "";
      if (fieldMeaning) fieldMeaning.value = "";
      if (fieldHint) fieldHint.value = "";
      if (fieldExampleSentence) fieldExampleSentence.value = "";
      if (fieldExampleTranslation) fieldExampleTranslation.value = "";
      if (fieldImage) fieldImage.value = "";
      if (fieldAudio) fieldAudio.value = "";
      if (fieldTags) fieldTags.value = "";
      if (fieldNotes) fieldNotes.value = "";
      if (expression) expression.textContent = "—";
      updateHeroReading("", "");
      if (wordMeaningsSummary) {
        wordMeaningsSummary.textContent = "";
        wordMeaningsSummary.hidden = true;
      }
      if (showcaseJlptBadge) {
        showcaseJlptBadge.hidden = true;
        showcaseJlptBadge.textContent = "";
      }
      if (showcasePosBadge) {
        showcasePosBadge.hidden = true;
        showcasePosBadge.textContent = "";
      }
      if (showcasePitchBadge) {
        showcasePitchBadge.hidden = true;
        showcasePitchBadge.textContent = "";
      }
      clearDictionaryView();
      setSaveBadge("", "badge", false);
      if (cardEditor) cardEditor.hidden = true;
      updateSyncUI(ankiConnected ? "ready" : "not_connected");
      selectedHistoryCardId = null;
      if (typeof scheduleCardPreviewUpdate === "function") scheduleCardPreviewUpdate();
    }

    if (typeof cachedStats !== "undefined") cachedStats = null;
    if (typeof historyStatsDetails !== "undefined" && historyStatsDetails && historyStatsDetails.open && typeof loadHistoryStats === "function") {
      loadHistoryStats(true).catch(() => {});
    }
    setStatus(`Deleted "${toDelete.cardExpr}" from local database.`);
    await loadHistory();
  } catch (err) {
    if (typeof cachedStats !== "undefined") cachedStats = null;
    if (typeof historyStatsDetails !== "undefined" && historyStatsDetails && historyStatsDetails.open && typeof loadHistoryStats === "function") {
      loadHistoryStats(true).catch(() => {});
    }
    setStatus(`Delete failed: ${err.message}`, true);
    await loadHistory();
  }
}

function cancelPendingDelete() {
  if (!pendingDeletion) return;
  const restored = pendingDeletion;
  clearTimeout(restored.timerId);
  pendingDeletion = null;
  hideUndoToast();

  if (restored.cardEl) {
    restored.cardEl.style.display = "";
  }
  setStatus(`Restored "${restored.cardExpr}".`);
  loadHistory().catch(() => {});
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    if (pendingDeletion) {
      commitPendingDelete();
    }
  });
}

async function deleteLocalCard(cardId, cardExpr, delBtn) {
  if (delBtn) {
    if (!delBtn.classList.contains("confirm-delete")) {
      delBtn.classList.add("confirm-delete");
      delBtn.textContent = "✕";
      delBtn.title = `Click again to confirm deleting "${cardExpr}"`;
      setTimeout(() => {
        if (delBtn && delBtn.classList.contains("confirm-delete")) {
          delBtn.classList.remove("confirm-delete");
          delBtn.innerHTML = "&times;";
          delBtn.title = "Delete local card";
        }
      }, 3000);
      return;
    }
    delBtn.classList.remove("confirm-delete");
  }

  // If another deletion was pending, commit it immediately before starting new one
  if (pendingDeletion) {
    await commitPendingDelete();
  }

  // Find DOM element in history list to give instant feedback
  const cardEl = historyCardsList ? historyCardsList.querySelector(`.history-item[data-card-id="${cardId}"]`) : null;
  if (cardEl) {
    cardEl.style.display = "none";
  }

  pendingDeletion = {
    cardId,
    cardExpr,
    cardEl,
    timerId: setTimeout(() => {
      commitPendingDelete();
    }, 5000),
  };

  showUndoToast(`Deleted "${cardExpr}"`, () => {
    cancelPendingDelete();
  });
  setStatus(`"${cardExpr}" deleted (Undo available for 5s)`);
}

async function retrySyncFromHistory(cardId) {
  try {
    setStatus("Retrying Anki sync…");
    const res = await fetch(API_CARD_SYNC_URL(cardId), { method: "POST", headers: { "Content-Type": "application/json" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.sync_status === "failed") {
      const errMsg = data.error || data.detail || "Sync failed";
      setStatus(`Anki sync retry failed: ${errMsg}`, true);
    } else {
      setStatus("Card synchronized to Anki.");
    }
    await loadHistory();
    if (fieldCardId && fieldCardId.value === String(cardId)) {
      if (data.sync_status === "synced") {
        updateSyncUI("synced");
      } else {
        updateSyncUI("failed", data.error || data.detail);
      }
    }
  } catch (err) {
    setStatus(`Retry failed: ${formatErrorMessage(err)}`, true);
  }
}

if (historySearchInput) {
  historySearchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      loadHistory();
    }, 250);
  });
}

if (historyDeckFilter) {
  historyDeckFilter.addEventListener("change", () => {
    loadHistory();
  });
}

if (historySyncFilter) {
  historySyncFilter.addEventListener("change", () => {
    loadHistory();
  });
}

if (historySortSelect) {
  historySortSelect.addEventListener("change", () => {
    saveStoredHistorySort(historySortSelect.value);
    loadHistory();
  });
}

async function exportCardsCsv() {
  try {
    const params = new URLSearchParams();
    const deckVal = historyDeckFilter ? historyDeckFilter.value : "";
    if (deckVal && deckVal !== "all") {
      params.set("deck", deckVal);
    }
    const syncVal = historySyncFilter ? historySyncFilter.value : "";
    if (syncVal && syncVal !== "all") {
      params.set("status", syncVal);
    }
    const searchVal = historySearchInput ? historySearchInput.value.trim() : "";
    if (searchVal) {
      params.set("search", searchVal);
    }

    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`${API_CARDS_URL}/export${query}`);
    if (!res.ok) {
      throw new Error(`Export failed (${res.status})`);
    }
    const csvText = await res.text();
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const timestamp = new Date().toISOString().slice(0, 10);
    link.download = `kiroku_cards_${timestamp}.csv`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
    setStatus("Cards exported to CSV.");
  } catch (err) {
    setStatus(`Export failed: ${err.message || err}`, true);
  }
}

if (typeof btnExportCards !== "undefined" && btnExportCards) {
  btnExportCards.addEventListener("click", exportCardsCsv);
}

// Bulk Operations State & Handlers (T4-A)
var selectedHistoryCardIds = (typeof globalThis !== "undefined" && globalThis.selectedHistoryCardIds) || new Set();
var currentRenderedCardIds = (typeof globalThis !== "undefined" && globalThis.currentRenderedCardIds) || [];

function updateBulkActionBarState() {
  const count = typeof selectedHistoryCardIds !== "undefined" ? selectedHistoryCardIds.size : 0;
  if (typeof bulkSelectedCount !== "undefined" && bulkSelectedCount) {
    bulkSelectedCount.textContent = `${count} selected`;
  }
  if (typeof bulkActionBar !== "undefined" && bulkActionBar) {
    bulkActionBar.hidden = count === 0;
  }
  if (typeof bulkSelectAllCb !== "undefined" && bulkSelectAllCb) {
    if (!currentRenderedCardIds || currentRenderedCardIds.length === 0) {
      bulkSelectAllCb.checked = false;
      bulkSelectAllCb.indeterminate = false;
    } else {
      const allSelected = currentRenderedCardIds.length > 0 && currentRenderedCardIds.every(id => selectedHistoryCardIds.has(id));
      const someSelected = currentRenderedCardIds.some(id => selectedHistoryCardIds.has(id));
      bulkSelectAllCb.checked = allSelected;
      bulkSelectAllCb.indeterminate = !allSelected && someSelected;
    }
  }
}

function clearBulkSelection() {
  if (typeof selectedHistoryCardIds !== "undefined") {
    selectedHistoryCardIds.clear();
  }
  if (typeof historyCardsList !== "undefined" && historyCardsList) {
    historyCardsList.querySelectorAll(".history-select-cb").forEach(cb => {
      cb.checked = false;
    });
    historyCardsList.querySelectorAll(".history-item").forEach(item => {
      item.classList.remove("bulk-selected");
    });
  }
  updateBulkActionBarState();
}

function selectAllVisibleCards() {
  if (typeof currentRenderedCardIds !== "undefined" && currentRenderedCardIds && typeof selectedHistoryCardIds !== "undefined") {
    currentRenderedCardIds.forEach(id => selectedHistoryCardIds.add(id));
  }
  if (typeof historyCardsList !== "undefined" && historyCardsList) {
    historyCardsList.querySelectorAll(".history-select-cb").forEach(cb => {
      cb.checked = true;
    });
    historyCardsList.querySelectorAll(".history-item").forEach(item => {
      item.classList.add("bulk-selected");
    });
  }
  updateBulkActionBarState();
}

async function performBulkDelete() {
  if (typeof selectedHistoryCardIds === "undefined" || selectedHistoryCardIds.size === 0) return;
  const idsToDelete = Array.from(selectedHistoryCardIds);
  try {
    const res = await fetch(API_CARDS_BULK_DELETE_URL, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_ids: idsToDelete }),
    });
    if (!res.ok) throw new Error("Bulk delete failed");
    const data = await res.json();
    clearBulkSelection();
    if (typeof cachedStats !== "undefined") cachedStats = null;
    if (typeof historyStatsDetails !== "undefined" && historyStatsDetails && historyStatsDetails.open && typeof loadHistoryStats === "function") {
      loadHistoryStats(true).catch(() => {});
    }
    setStatus(`Deleted ${data.deleted_count || idsToDelete.length} cards from local database.`);
    await loadHistory();
  } catch (err) {
    setStatus(`Bulk delete failed: ${err.message}`, true);
  }
}

async function performBulkSync() {
  if (typeof selectedHistoryCardIds === "undefined" || selectedHistoryCardIds.size === 0) return;
  const idsToSync = Array.from(selectedHistoryCardIds);
  try {
    setStatus(`Syncing ${idsToSync.length} cards to Anki…`);
    const res = await fetch(API_CARDS_BULK_SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_ids: idsToSync }),
    });
    if (!res.ok) throw new Error("Bulk sync failed");
    const data = await res.json();
    clearBulkSelection();
    if (typeof cachedStats !== "undefined") cachedStats = null;
    if (typeof historyStatsDetails !== "undefined" && historyStatsDetails && historyStatsDetails.open && typeof loadHistoryStats === "function") {
      loadHistoryStats(true).catch(() => {});
    }
    if (data.error) {
      setStatus(`Bulk sync error: ${data.error}`, true);
    } else {
      setStatus(`Bulk sync complete: ${data.synced_count} synced, ${data.failed_count} failed.`);
    }
    await loadHistory();
  } catch (err) {
    setStatus(`Bulk sync failed: ${err.message}`, true);
  }
}

async function performBulkDeckMove(targetDeck) {
  if (!targetDeck || typeof selectedHistoryCardIds === "undefined" || selectedHistoryCardIds.size === 0) return;
  const idsToMove = Array.from(selectedHistoryCardIds);
  try {
    setStatus(`Moving ${idsToMove.length} cards to "${targetDeck}"…`);
    const res = await fetch(API_CARDS_BULK_DECK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_ids: idsToMove, deck_name: targetDeck }),
    });
    if (!res.ok) throw new Error("Bulk deck move failed");
    const data = await res.json();
    clearBulkSelection();
    if (typeof bulkDeckSelect !== "undefined" && bulkDeckSelect) {
      bulkDeckSelect.selectedIndex = 0;
    }
    if (typeof cachedStats !== "undefined") cachedStats = null;
    if (typeof historyStatsDetails !== "undefined" && historyStatsDetails && historyStatsDetails.open && typeof loadHistoryStats === "function") {
      loadHistoryStats(true).catch(() => {});
    }
    setStatus(`Moved ${data.updated_count || idsToMove.length} cards to "${targetDeck}".`);
    await loadHistory();
  } catch (err) {
    setStatus(`Move to deck failed: ${err.message}`, true);
  }
}

if (typeof bulkSelectAllCb !== "undefined" && bulkSelectAllCb && typeof bulkSelectAllCb.addEventListener === "function") {
  bulkSelectAllCb.addEventListener("change", () => {
    if (bulkSelectAllCb.checked) {
      selectAllVisibleCards();
    } else {
      clearBulkSelection();
    }
  });
}

if (typeof btnBulkCancel !== "undefined" && btnBulkCancel && typeof btnBulkCancel.addEventListener === "function") {
  btnBulkCancel.addEventListener("click", (e) => {
    e.preventDefault();
    clearBulkSelection();
  });
}

if (typeof btnBulkDelete !== "undefined" && btnBulkDelete && typeof btnBulkDelete.addEventListener === "function") {
  btnBulkDelete.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!btnBulkDelete.classList || typeof btnBulkDelete.classList.contains !== "function" || !btnBulkDelete.classList.contains("confirm-delete")) {
      if (btnBulkDelete.classList && typeof btnBulkDelete.classList.add === "function") {
        btnBulkDelete.classList.add("confirm-delete");
      }
      const count = typeof selectedHistoryCardIds !== "undefined" ? selectedHistoryCardIds.size : 0;
      btnBulkDelete.textContent = `Confirm (${count})`;
      setTimeout(() => {
        if (typeof btnBulkDelete !== "undefined" && btnBulkDelete && btnBulkDelete.classList && typeof btnBulkDelete.classList.contains === "function" && btnBulkDelete.classList.contains("confirm-delete")) {
          btnBulkDelete.classList.remove("confirm-delete");
          btnBulkDelete.textContent = "Delete";
        }
      }, 3000);
      return;
    }
    if (btnBulkDelete.classList && typeof btnBulkDelete.classList.remove === "function") {
      btnBulkDelete.classList.remove("confirm-delete");
    }
    btnBulkDelete.textContent = "Delete";
    await performBulkDelete();
  });
}

if (typeof btnBulkSync !== "undefined" && btnBulkSync && typeof btnBulkSync.addEventListener === "function") {
  btnBulkSync.addEventListener("click", async (e) => {
    e.preventDefault();
    await performBulkSync();
  });
}

if (typeof bulkDeckSelect !== "undefined" && bulkDeckSelect && typeof bulkDeckSelect.addEventListener === "function") {
  bulkDeckSelect.addEventListener("change", async () => {
    const val = bulkDeckSelect.value;
    if (val) {
      await performBulkDeckMove(val);
    }
  });
}

async function checkClipboardForJapanese() {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return;
  try {
    const text = (await navigator.clipboard.readText() || "").trim();
    if (!text) return;
    if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) return;
    if (text === lastDismissedClipboardText || text === lastSeenClipboardText) return;
    showClipboardSuggestion(text);
  } catch (_) {}
}

function showClipboardSuggestion(text) {
  if (!clipboardSuggestionBar || !clipboardSuggestionText) return;
  const maxLen = 30;
  const preview = text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
  clipboardSuggestionText.textContent = preview;
  clipboardSuggestionBar.dataset.clipboardText = text;
  clipboardSuggestionBar.hidden = false;
}

function hideClipboardSuggestion() {
  if (clipboardSuggestionBar) {
    clipboardSuggestionBar.hidden = true;
    delete clipboardSuggestionBar.dataset.clipboardText;
  }
}

if (btnClipboardCapture) {
  btnClipboardCapture.addEventListener("click", () => {
    const text = clipboardSuggestionBar?.dataset?.clipboardText;
    hideClipboardSuggestion();
    if (text) {
      lastSeenClipboardText = text;
      identify(text);
    }
  });
}

if (btnClipboardDismiss) {
  btnClipboardDismiss.addEventListener("click", () => {
    const text = clipboardSuggestionBar?.dataset?.clipboardText;
    hideClipboardSuggestion();
    if (text) {
      lastDismissedClipboardText = text;
    }
  });
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkClipboardForJapanese().catch(() => {});
      checkAnkiStatus().catch(() => {});
    }
  });
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("focus", () => {
    checkClipboardForJapanese().catch(() => {});
    checkAnkiStatus().catch(() => {});
  });
}

// Initialization
loadFontPreference().catch(() => {});
loadStoredHistorySort().catch(() => {});
loadDecks().catch(() => {});
startAnkiStatusPolling();
checkClipboardForJapanese().catch(() => {});
loadModels().catch(() => {});
loadHistory().catch(() => {});
loadTabPreference().catch(() => {});
loadNavCollapsePreference().catch(() => {});
loadAutoPausePreference().catch(() => {});
loadSubtitlesDisplayPreference().catch(() => {});
loadSubtitleOffsetPreference().catch(() => {});
loadJimakuApiKey().catch(() => {});
loadActiveSubtitleCuesFromStorage().catch(() => {});

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
  } catch (err) {
    setStatus(`Failed to read subtitle file: ${err.message}`, true);
  }
}

// -------------------------------------------------------------
// Subtitle Directory / Local Folder Selection
// -------------------------------------------------------------
function saveSubtitleToDisk(text, filename, subfolder = "KirokuSubtitles") {
  if (!text || !filename) return;
  try {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const cleanSubfolder = (subfolder || "").trim().replace(/[\\/]+$/, "");
    a.download = cleanSubfolder ? `${cleanSubfolder}/${filename}` : filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (_) {}
}

async function loadSubtitleFolderPreferences() {
  try {
    let savedFolderName = "";
    let downloadFolder = "KirokuSubtitles";
    let autoSave = true;

    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get([
        "subtitle_folder_name",
        "subtitle_download_folder",
        "auto_save_subtitle_file"
      ]);
      if (stored?.subtitle_folder_name) savedFolderName = stored.subtitle_folder_name;
      if (stored?.subtitle_download_folder) downloadFolder = stored.subtitle_download_folder;
      if (typeof stored?.auto_save_subtitle_file === "boolean") autoSave = stored.auto_save_subtitle_file;
    } else if (typeof localStorage !== "undefined") {
      savedFolderName = localStorage.getItem("subtitle_folder_name") || "";
      downloadFolder = localStorage.getItem("subtitle_download_folder") || "KirokuSubtitles";
      const storedAutoSave = localStorage.getItem("auto_save_subtitle_file");
      if (storedAutoSave !== null) autoSave = storedAutoSave === "true";
    }

    if (jimakuDownloadFolderInput) jimakuDownloadFolderInput.value = downloadFolder;
    if (toggleSaveSubtitleDisk) toggleSaveSubtitleDisk.checked = autoSave;
    if (savedFolderName && folderNameLabel) {
      folderNameLabel.textContent = `📁 ${savedFolderName}:`;
    }
  } catch (_) {}
}

async function saveSubtitleFolderPreferences() {
  try {
    const downloadFolder = (jimakuDownloadFolderInput?.value || "KirokuSubtitles").trim();
    const autoSave = Boolean(toggleSaveSubtitleDisk?.checked);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({
        subtitle_download_folder: downloadFolder,
        auto_save_subtitle_file: autoSave
      });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("subtitle_download_folder", downloadFolder);
      localStorage.setItem("auto_save_subtitle_file", String(autoSave));
    }
  } catch (_) {}
}

async function handleSubtitleFolderSelect(files) {
  if (!files || files.length === 0) return;

  const validExts = [".srt", ".vtt", ".ass", ".ssa"];
  const subtitleFiles = [];

  for (const file of files) {
    const lowerName = file.name.toLowerCase();
    if (validExts.some(ext => lowerName.endsWith(ext))) {
      subtitleFiles.push(file);
    }
  }

  if (subtitleFiles.length === 0) {
    setStatus("No valid subtitle files (.srt, .vtt, .ass, .ssa) found in selected directory.", true);
    return;
  }

  // Sort files naturally by name
  subtitleFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  // Extract root folder name from webkitRelativePath if available
  let folderName = "Subtitles";
  if (subtitleFiles[0]?.webkitRelativePath) {
    const parts = subtitleFiles[0].webkitRelativePath.split("/");
    if (parts.length > 1) folderName = parts[0];
  }
  currentSubtitleDirectoryName = folderName;

  selectedSubtitleFolderFiles.clear();
  if (folderSubtitlesSelect) {
    folderSubtitlesSelect.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = `— Select subtitle (${subtitleFiles.length} available) —`;
    folderSubtitlesSelect.appendChild(defaultOption);

    for (const file of subtitleFiles) {
      selectedSubtitleFolderFiles.set(file.name, file);
      const opt = document.createElement("option");
      opt.value = file.name;
      opt.textContent = file.name;
      folderSubtitlesSelect.appendChild(opt);
    }
  }

  if (folderNameLabel) {
    folderNameLabel.textContent = `📁 ${folderName} (${subtitleFiles.length}):`;
  }
  if (subtitleFolderBar) {
    subtitleFolderBar.hidden = false;
  }

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({
        subtitle_folder_name: folderName
      });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("subtitle_folder_name", folderName);
    }
  } catch (_) {}

  setStatus(`Loaded folder "${folderName}" with ${subtitleFiles.length} subtitle files.`);
}

function addFileToFolderDropdown(filename, content) {
  if (!filename || !folderSubtitlesSelect) return;
  selectedSubtitleFolderFiles.set(filename, { name: filename, content });
  
  let existingOpt = Array.from(folderSubtitlesSelect.options).find(opt => opt.value === filename);
  if (!existingOpt) {
    const opt = document.createElement("option");
    opt.value = filename;
    opt.textContent = `[Jimaku] ${filename}`;
    folderSubtitlesSelect.appendChild(opt);
  }
  folderSubtitlesSelect.value = filename;
  if (subtitleFolderBar) subtitleFolderBar.hidden = false;
}

// -------------------------------------------------------------
// Jimaku Search Subtitles Integration
// -------------------------------------------------------------
async function loadJimakuApiKey() {
  if (!jimakuProvider) return;
  const key = await jimakuProvider.loadSavedApiKey();
  if (jimakuApiKeyInput) jimakuApiKeyInput.value = key;
  if (jimakuKeyStatus) {
    jimakuKeyStatus.textContent = key ? "✓ API key saved" : "No API key configured";
    jimakuKeyStatus.style.color = key ? "var(--accent-success)" : "var(--text-muted)";
  }
  await loadSubtitleFolderPreferences();
}

async function saveJimakuApiKey() {
  const key = (jimakuApiKeyInput?.value || "").trim();
  if (jimakuProvider) jimakuProvider.setApiKey(key);
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ jimaku_api_key: key });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("jimaku_api_key", key);
    }
  } catch (_) {}
  if (jimakuKeyStatus) {
    jimakuKeyStatus.textContent = key ? "✓ API key saved" : "API key cleared";
    jimakuKeyStatus.style.color = key ? "var(--accent-success)" : "var(--text-muted)";
  }
}

function showJimakuStatus(msg, isError = false) {
  if (!jimakuStatusMessage) return;
  if (!msg) {
    jimakuStatusMessage.hidden = true;
    jimakuStatusMessage.textContent = "";
    jimakuStatusMessage.classList.remove("error");
    return;
  }
  jimakuStatusMessage.hidden = false;
  jimakuStatusMessage.textContent = msg;
  jimakuStatusMessage.classList.toggle("error", isError);
}

async function handleJimakuSearch() {
  const query = (jimakuSearchInput?.value || "").trim();
  if (!query) {
    showJimakuStatus("Please enter a title to search.", true);
    return;
  }
  if (!jimakuProvider || !jimakuProvider.getApiKey()) {
    showJimakuStatus("Please enter and save your Jimaku API key first.", true);
    return;
  }

  showJimakuStatus("Searching Jimaku subtitles…");
  if (jimakuResultsContainer) jimakuResultsContainer.hidden = true;
  if (jimakuFilesContainer) jimakuFilesContainer.hidden = true;

  try {
    const entries = await jimakuProvider.searchEntries(query);
    if (!Array.isArray(entries) || entries.length === 0) {
      showJimakuStatus(`No subtitle entries found for "${query}".`, false);
      return;
    }

    showJimakuStatus("");
    if (jimakuResultsContainer && jimakuResultsList) {
      jimakuResultsList.replaceChildren();
      for (const entry of entries) {
        const item = document.createElement("div");
        item.className = "jimaku-entry-item";
        item.role = "button";
        item.tabIndex = 0;

        const nameSpan = document.createElement("span");
        nameSpan.className = "jimaku-entry-name";
        nameSpan.textContent = entry.japanese_name || entry.name || `Entry #${entry.id}`;

        const metaSpan = document.createElement("span");
        metaSpan.className = "jimaku-entry-meta";
        metaSpan.textContent = entry.english_name ? `(${entry.english_name})` : "";

        item.appendChild(nameSpan);
        if (entry.english_name) item.appendChild(metaSpan);

        item.addEventListener("click", () => selectJimakuEntry(entry));
        item.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectJimakuEntry(entry);
          }
        });

        jimakuResultsList.appendChild(item);
      }
      jimakuResultsContainer.hidden = false;
    }
  } catch (err) {
    showJimakuStatus(`Search error: ${err.message}`, true);
  }
}

async function selectJimakuEntry(entry) {
  if (!entry || !entry.id || !jimakuProvider) return;

  showJimakuStatus("Fetching subtitle files…");
  if (jimakuResultsContainer) jimakuResultsContainer.hidden = true;
  if (jimakuFilesContainer) jimakuFilesContainer.hidden = true;

  try {
    const files = await jimakuProvider.getFilesForEntry(entry.id);
    if (!Array.isArray(files) || files.length === 0) {
      showJimakuStatus("No subtitle files available for this entry.", false);
      return;
    }

    showJimakuStatus("");
    if (jimakuSelectedEntryTitle) {
      jimakuSelectedEntryTitle.textContent = entry.japanese_name || entry.name || `Entry #${entry.id}`;
    }

    if (jimakuFilesContainer && jimakuFilesList) {
      jimakuFilesList.replaceChildren();
      for (const file of files) {
        const item = document.createElement("div");
        item.className = "jimaku-file-item";
        item.role = "button";
        item.tabIndex = 0;

        const nameSpan = document.createElement("span");
        nameSpan.className = "jimaku-file-name";
        nameSpan.textContent = file.name || `File #${file.id}`;

        const sizeKb = file.size ? `${Math.round(file.size / 1024)} KB` : "";
        const metaSpan = document.createElement("span");
        metaSpan.className = "jimaku-file-meta";
        metaSpan.textContent = sizeKb;

        item.appendChild(nameSpan);
        if (sizeKb) item.appendChild(metaSpan);

        const rawUrl = file.download_url || file.url || (file.id ? `https://jimaku.cc/api/entries/${entry.id}/files/${file.id}` : "");
        const downloadUrl = rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : `https://jimaku.cc${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;

        item.addEventListener("click", () => loadJimakuFile(downloadUrl, file.name || "jimaku.ass"));
        item.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            loadJimakuFile(downloadUrl, file.name || "jimaku.ass");
          }
        });

        jimakuFilesList.appendChild(item);
      }
      jimakuFilesContainer.hidden = false;
    }
  } catch (err) {
    showJimakuStatus(`Files error: ${err.message}`, true);
  }
}

async function loadJimakuFile(fileUrl, filename) {
  if (!jimakuProvider) return;
  showJimakuStatus(`Downloading "${filename}"…`);

  try {
    const trackData = await jimakuProvider.downloadSubtitle(fileUrl, filename);
    const cues = trackData.cues || [];
    if (cues.length === 0) {
      showJimakuStatus(`No valid cues found in "${filename}".`, true);
      return;
    }

    loadedSubtitlesFilename = `Jimaku: ${filename}`;
    loadedSubtitleCues = cues;
    recentSubtitleCues = [];
    renderRecentCuesList();
    clearSubtitleSearchResults();
    if (subtitlesFileStatus) {
      subtitlesFileStatus.textContent = loadedSubtitlesFilename;
      subtitlesFileStatus.classList.add("active");
      subtitlesFileStatus.title = `${loadedSubtitlesFilename} (${cues.length} cues)`;
    }

    // Auto-save subtitle file to configured destination subfolder if enabled
    const autoSave = toggleSaveSubtitleDisk ? toggleSaveSubtitleDisk.checked : true;
    const destFolder = (jimakuDownloadFolderInput?.value || "KirokuSubtitles").trim();
    if (autoSave && trackData.rawText) {
      saveSubtitleToDisk(trackData.rawText, filename, destFolder);
    }

    // Add to quick folder dropdown for instant re-selection
    addFileToFolderDropdown(filename, trackData.rawText);

    setStatus(`Loaded ${cues.length} subtitle cues from Jimaku ("${filename}").`);

    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({
          active_subtitle_cues: cues,
          active_subtitle_filename: loadedSubtitlesFilename
        });
      }
    } catch (_) {}

    await broadcastToActiveVideo({
      type: "LOAD_SUBTITLE_CUES",
      cues,
      filename: loadedSubtitlesFilename
    });

    if (jimakuSearchModal) jimakuSearchModal.hidden = true;
    showJimakuStatus("");
  } catch (err) {
    showJimakuStatus(`Download error: ${err.message}`, true);
  }
}

function adjustOffset(delta) {
  const deltaMs = Math.abs(delta) < 5 && delta !== 0 && !Number.isInteger(delta)
    ? Math.round(delta * 1000)
    : Math.round(delta);
  const newOffsetMs = currentSubtitleOffsetMs + deltaMs;
  updateOffsetDisplay(newOffsetMs);
  persistSubtitleOffset(newOffsetMs);
  broadcastToActiveVideo({
    type: "SET_SUBTITLE_OFFSET",
    offsetMs: newOffsetMs,
    offset: newOffsetMs / 1000
  });
}

function resetOffset() {
  updateOffsetDisplay(0);
  persistSubtitleOffset(0);
  broadcastToActiveVideo({
    type: "SET_SUBTITLE_OFFSET",
    offsetMs: 0,
    offset: 0.0
  });
}

async function clearSubtitles() {
  if (subtitlesFileInput) subtitlesFileInput.value = "";
  loadedSubtitlesFilename = "";
  loadedSubtitleCues = [];
  recentSubtitleCues = [];
  renderRecentCuesList();
  clearSubtitleSearchResults();
  if (subtitlesFileStatus) {
    subtitlesFileStatus.textContent = "No subtitles";
    subtitlesFileStatus.classList.remove("active");
    subtitlesFileStatus.title = "";
  }
  if (videoCurrentCuePreview) {
    videoCurrentCuePreview.textContent = "—";
    videoCurrentCuePreview.classList.add("waiting");
  }
  if (videoTrackSelect) {
    videoTrackSelect.hidden = true;
    videoTrackSelect.replaceChildren();
  }
  resetOffset();
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.remove(["active_subtitle_cues", "active_subtitle_filename"]);
    }
  } catch (_) {}
  setStatus("Cleared loaded subtitles.");
  await broadcastToActiveVideo({ type: "CLEAR_SUBTITLES" });
}

function updateQuickAddClearBtn() {
  if (quickAddClearBtn) {
    quickAddClearBtn.hidden = !Boolean(quickAddInput && quickAddInput.value);
  }
}

function clearQuickAddSuggestions() {
  quickAddCandidates = [];
  quickAddHighlightedIndex = -1;
  if (quickAddSuggestionsList) {
    quickAddSuggestionsList.replaceChildren();
  }
  if (quickAddSuggestionsContainer) {
    quickAddSuggestionsContainer.hidden = true;
  }
  if (quickAddInput) {
    quickAddInput.setAttribute("aria-expanded", "false");
    quickAddInput.removeAttribute("aria-activedescendant");
    if (quickAddInput.classList.contains("confirm-replace")) {
      quickAddInput.classList.remove("confirm-replace");
      if (quickAddInput._origPlaceholder) {
        quickAddInput.placeholder = quickAddInput._origPlaceholder;
      }
    }
  }
}

function updateQuickAddHighlight() {
  if (!quickAddSuggestionsList) return;
  const items = Array.from(quickAddSuggestionsList.children);
  items.forEach((item, idx) => {
    const isHighlighted = idx === quickAddHighlightedIndex;
    item.classList.toggle("highlighted", isHighlighted);
    item.setAttribute("aria-selected", String(isHighlighted));
    if (isHighlighted) {
      if (typeof item.scrollIntoView === "function") {
        item.scrollIntoView({ block: "nearest" });
      }
      if (quickAddInput) {
        quickAddInput.setAttribute("aria-activedescendant", item.id);
      }
    }
  });
  if (quickAddHighlightedIndex === -1 && quickAddInput) {
    quickAddInput.removeAttribute("aria-activedescendant");
  }
}

function selectQuickAddCandidate(candidate, candidateElement, preferredFront = null) {
  const targetExpression = candidate ? candidate.expression : (quickAddInput ? quickAddInput.value.trim() : "");
  if (!targetExpression) return;

  if (typeof isCardDraftDirty === "function" && isCardDraftDirty()) {
    const confirmTarget = candidateElement || quickAddInput;
    if (confirmTarget) {
      if (!confirmTarget.classList.contains("confirm-replace")) {
        confirmTarget.classList.add("confirm-replace");
        if (candidateElement) {
          const badge = document.createElement("span");
          badge.className = "quickadd-confirm-badge";
          badge.textContent = "Replace draft?";
          candidateElement.appendChild(badge);
        } else if (quickAddInput) {
          quickAddInput._origPlaceholder = quickAddInput.placeholder;
          quickAddInput.placeholder = "Unsaved draft! Press Enter to replace";
        }
        setTimeout(() => {
          if (confirmTarget.classList.contains("confirm-replace")) {
            confirmTarget.classList.remove("confirm-replace");
            if (candidateElement) {
              const badge = candidateElement.querySelector(".quickadd-confirm-badge");
              if (badge) badge.remove();
            } else if (quickAddInput && quickAddInput._origPlaceholder) {
              quickAddInput.placeholder = quickAddInput._origPlaceholder;
            }
          }
        }, 3000);
        return;
      }
      confirmTarget.classList.remove("confirm-replace");
      if (candidateElement) {
        const badge = candidateElement.querySelector(".quickadd-confirm-badge");
        if (badge) badge.remove();
      } else if (quickAddInput && quickAddInput._origPlaceholder) {
        quickAddInput.placeholder = quickAddInput._origPlaceholder;
      }
    }
  }

  const resolvedFront = preferredFront || null;
  if (quickAddInput) {
    quickAddInput.value = targetExpression;
    updateQuickAddClearBtn();
  }
  clearQuickAddSuggestions();
  if (typeof lastCaptureSource !== "undefined") {
    lastCaptureSource = {
      tabId: null,
      frameId: null,
      type: "quick_add",
      url: "",
      title: "",
    };
  }
  identify(targetExpression, { preferredFront: resolvedFront });
  // User remains on Quick Add mode as requested
}

function renderQuickAddSuggestions(entries, savedCardExpressions = new Set()) {
  if (!quickAddSuggestionsContainer || !quickAddSuggestionsList) return;

  const seenCandidateKeys = new Set();
  const rawCandidates = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expression = (entry.term || entry.expression || "").trim();
    if (!expression) continue;
    const reading = (entry.reading || "").trim();
    const key = `${expression}\u001f${reading}`;

    let gloss = "";
    if (entry.senses && Array.isArray(entry.senses)) {
      for (const sense of entry.senses) {
        if (sense && Array.isArray(sense.glosses) && sense.glosses.length > 0 && sense.glosses[0]) {
          gloss = String(sense.glosses[0]).trim();
          if (gloss) break;
        }
      }
    } else if (entry.meaning) {
      gloss = String(entry.meaning).trim();
    }

    if (seenCandidateKeys.has(key)) {
      if (gloss) {
        const existing = rawCandidates.find(c => c.expression === expression && c.reading === reading);
        if (existing && !existing.gloss) {
          existing.gloss = gloss;
        }
      }
      continue;
    }

    seenCandidateKeys.add(key);
    const isSaved = Boolean(entry.is_saved || entry.is_duplicate || (savedCardExpressions && savedCardExpressions.has(expression.toLowerCase())));
    rawCandidates.push({
      expression,
      reading,
      gloss,
      jlpt_level: entry.jlpt_level || null,
      isSaved,
      originalEntry: entry,
      index: rawCandidates.length,
    });
  }

  quickAddCandidates = rawCandidates;

  if (quickAddCandidates.length === 0) {
    clearQuickAddSuggestions();
    const query = (quickAddInput && quickAddInput.value ? quickAddInput.value : "").trim();
    if (query && quickAddSuggestionsContainer && quickAddSuggestionsList) {
      quickAddSuggestionsContainer.hidden = false;
      quickAddSuggestionsList.replaceChildren();
      const emptyLi = document.createElement("li");
      emptyLi.className = "empty-state quickadd-empty-state";
      emptyLi.setAttribute("role", "status");
      emptyLi.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-state-icon" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>` +
        `<p class="empty-state-text">No matches found.</p>` +
        `<p class="empty-state-hint">Try a different reading or switch to EN mode.</p>`;
      quickAddSuggestionsList.append(emptyLi);
    }
    return;
  }

  quickAddHighlightedIndex = -1;
  const items = quickAddCandidates.map((candidate, idx) => {
    const li = document.createElement("li");
    li.id = `quickadd-candidate-${idx}`;
    li.className = "quickadd-candidate-item";
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    li.dataset.index = String(idx);

    const mainDiv = document.createElement("div");
    mainDiv.className = "quickadd-candidate-main";

    const exprSpan = document.createElement("span");
    exprSpan.className = "quickadd-candidate-expression";
    exprSpan.textContent = candidate.expression;
    mainDiv.appendChild(exprSpan);

    if (candidate.reading && candidate.reading !== candidate.expression) {
      const readingSpan = document.createElement("span");
      readingSpan.className = "quickadd-candidate-reading";
      readingSpan.textContent = candidate.reading;
      mainDiv.appendChild(readingSpan);
    }

    if (candidate.jlpt_level) {
      const jlptBadge = document.createElement("span");
      jlptBadge.className = "quickadd-candidate-jlpt-pill";
      jlptBadge.textContent = candidate.jlpt_level;
      mainDiv.appendChild(jlptBadge);
    }

    if (candidate.isSaved) {
      const savedBadge = document.createElement("span");
      savedBadge.className = "quickadd-candidate-saved-pill";
      savedBadge.textContent = "SAVED";
      mainDiv.appendChild(savedBadge);
    }

    if (hasKanji(candidate.expression) && candidate.reading && candidate.reading !== candidate.expression) {
      const choiceGroup = document.createElement("div");
      choiceGroup.className = "qa-front-choice-group";
      choiceGroup.setAttribute("role", "group");
      choiceGroup.setAttribute("aria-label", "Card front preference");

      const kanjiPill = document.createElement("button");
      kanjiPill.type = "button";
      kanjiPill.className = "qa-choice-pill";
      kanjiPill.textContent = "漢字";
      kanjiPill.title = "Make card with Kanji front";
      kanjiPill.addEventListener("click", (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        selectQuickAddCandidate(candidate, li, "kanji");
      });

      const kanaPill = document.createElement("button");
      kanaPill.type = "button";
      kanaPill.className = "qa-choice-pill";
      kanaPill.textContent = "かな";
      kanaPill.title = "Make card with Kana front";
      kanaPill.addEventListener("click", (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        selectQuickAddCandidate(candidate, li, "kana");
      });

      choiceGroup.appendChild(kanjiPill);
      choiceGroup.appendChild(kanaPill);
      mainDiv.appendChild(choiceGroup);
    }

    li.appendChild(mainDiv);

    if (candidate.gloss) {
      const glossDiv = document.createElement("div");
      glossDiv.className = "quickadd-candidate-gloss";
      glossDiv.textContent = candidate.gloss;
      li.appendChild(glossDiv);
    }

    li.addEventListener("click", (e) => {
      if (e) e.stopPropagation();
      selectQuickAddCandidate(candidate, li);
    });

    li.addEventListener("mouseenter", () => {
      quickAddHighlightedIndex = idx;
      updateQuickAddHighlight();
    });

    return li;
  });

  quickAddSuggestionsList.replaceChildren(...items);
  quickAddSuggestionsContainer.hidden = false;
  if (quickAddInput) {
    quickAddInput.setAttribute("aria-expanded", "true");
  }
}

async function executeQuickAddLookup() {
  if (!quickAddInput) return;
  const rawValue = quickAddInput.value || "";
  const query = rawValue.trim();

  if (!query) {
    clearQuickAddSuggestions();
    return;
  }

  if (quickAddAbortController) {
    try {
      quickAddAbortController.abort();
    } catch (_) {}
  }
  quickAddAbortController = typeof AbortController !== "undefined" ? new AbortController() : null;
  const lookupId = ++currentQuickAddLookupId;

  const targetDeck = (fieldDeckSelect && fieldDeckSelect.value.trim()) || (fieldDeckName && fieldDeckName.value.trim()) || "Default";
  const isEnglishSearch = currentQuickAddSearchMode === "english";

  try {
    let entries = [];
    const savedCardExpressions = new Set();

    const savedCardsPromise = fetch(`${API_CARDS_URL}?limit=50&search=${encodeURIComponent(query)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && Array.isArray(data.cards)) {
          for (const c of data.cards) {
            if (c.expression) savedCardExpressions.add(c.expression.trim().toLowerCase());
          }
        }
      })
      .catch(() => {});

    if (isEnglishSearch) {
      const searchUrl = `${BACKEND_BASE_URL}/api/dictionary/search-english?query=${encodeURIComponent(query)}&limit=20`;
      const fetchOptions = {};
      if (quickAddAbortController) fetchOptions.signal = quickAddAbortController.signal;

      const [searchRes] = await Promise.all([
        fetch(searchUrl, fetchOptions),
        savedCardsPromise,
      ]);

      if (lookupId !== currentQuickAddLookupId) return;
      if (!searchRes.ok) {
        clearQuickAddSuggestions();
        return;
      }
      const data = await searchRes.json().catch(() => ({}));
      if (lookupId !== currentQuickAddLookupId) return;

      entries = Array.isArray(data.entries) ? data.entries : [];
    } else {
      const fetchOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query, auto_save: false, deck_name: targetDeck }),
      };
      if (quickAddAbortController) {
        fetchOptions.signal = quickAddAbortController.signal;
      }

      const [response] = await Promise.all([
        fetch(API_CAPTURE_URL, fetchOptions),
        savedCardsPromise,
      ]);

      if (lookupId !== currentQuickAddLookupId) return;
      if (!response.ok) {
        clearQuickAddSuggestions();
        return;
      }

      const body = await response.json().catch(() => ({}));
      if (lookupId !== currentQuickAddLookupId) return;

      if (body.is_duplicate) {
        setSaveBadge("ALREADY SAVED", "badge already-saved", true);
        if (body.expression) {
          savedCardExpressions.add(body.expression.trim().toLowerCase());
        }
      }

      entries = Array.isArray(body.entries) ? body.entries : [];
    }

    if (entries.length === 0) {
      clearQuickAddSuggestions();
      return;
    }

    renderQuickAddSuggestions(entries, savedCardExpressions);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    if (lookupId === currentQuickAddLookupId) {
      clearQuickAddSuggestions();
    }
  }
}

function scheduleQuickAddLookup() {
  if (quickAddDebounceTimer) {
    clearTimeout(quickAddDebounceTimer);
    quickAddDebounceTimer = null;
  }
  quickAddDebounceTimer = setTimeout(() => {
    executeQuickAddLookup();
  }, 350);
}

function onQuickAddInput() {
  updateQuickAddClearBtn();
  scheduleQuickAddLookup();
}

function onQuickAddKeydown(e) {
  if (e.key === "ArrowDown") {
    if (quickAddCandidates.length > 0) {
      e.preventDefault();
      quickAddHighlightedIndex = (quickAddHighlightedIndex + 1) % quickAddCandidates.length;
      updateQuickAddHighlight();
    }
  } else if (e.key === "ArrowUp") {
    if (quickAddCandidates.length > 0) {
      e.preventDefault();
      if (quickAddHighlightedIndex <= 0) {
        quickAddHighlightedIndex = quickAddCandidates.length - 1;
      } else {
        quickAddHighlightedIndex -= 1;
      }
      updateQuickAddHighlight();
    }
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (quickAddHighlightedIndex >= 0 && quickAddCandidates[quickAddHighlightedIndex]) {
      const el = quickAddSuggestionsList ? quickAddSuggestionsList.children[quickAddHighlightedIndex] : null;
      selectQuickAddCandidate(quickAddCandidates[quickAddHighlightedIndex], el);
    } else {
      selectQuickAddCandidate(null, null);
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    clearQuickAddSuggestions();
  } else if (e.key === "F7") {
    e.preventDefault();
    setQuickAddSearchMode("english");
  } else if (e.key === "F6") {
    e.preventDefault();
    setQuickAddSearchMode("kana");
  }
}

function initQuickAdd() {
  if (quickAddInput) {
    if (typeof wanakana !== "undefined" && typeof wanakana.bind === "function") {
      try {
        wanakana.bind(quickAddInput);
      } catch (err) {
        console.warn("WanaKana bind failed:", err);
      }
    }
    quickAddInput.addEventListener("input", onQuickAddInput);
    quickAddInput.addEventListener("keydown", onQuickAddKeydown);
  }
  if (quickAddClearBtn) {
    quickAddClearBtn.addEventListener("click", () => {
      if (quickAddInput) {
        quickAddInput.value = "";
        quickAddInput.focus();
      }
      clearQuickAddSuggestions();
      updateQuickAddClearBtn();
    });
  }

  if (quickAddModeHiragana) {
    quickAddModeHiragana.addEventListener("click", () => {
      setQuickAddSearchMode("kana");
      if (quickAddInput) quickAddInput.focus();
    });
  }

  if (quickAddModeEnglish) {
    quickAddModeEnglish.addEventListener("click", () => {
      setQuickAddSearchMode("english");
      if (quickAddInput) quickAddInput.focus();
    });
  }

  if (quickAddModeKatakana) {
    quickAddModeKatakana.addEventListener("click", () => {
      setQuickAddSearchMode("kana");
      if (quickAddInput) quickAddInput.focus();
    });
  }

  loadQuickAddKanaMode().catch(() => {});
}

function setQuickAddKanaMode(mode) {
  if (mode === "katakana") {
    setQuickAddSearchMode("kana");
  } else if (mode === "english") {
    setQuickAddSearchMode("english");
  } else {
    setQuickAddSearchMode("kana");
  }
}

function setQuickAddSearchMode(mode) {
  currentQuickAddSearchMode = mode === "english" ? "english" : "kana";
  const isEnglish = currentQuickAddSearchMode === "english";

  if (quickAddModeHiragana) {
    quickAddModeHiragana.classList.toggle("active", !isEnglish);
    quickAddModeHiragana.setAttribute("aria-checked", String(!isEnglish));
  }
  if (quickAddModeEnglish) {
    quickAddModeEnglish.classList.toggle("active", isEnglish);
    quickAddModeEnglish.setAttribute("aria-checked", String(isEnglish));
  }
  if (quickAddModeKatakana) {
    quickAddModeKatakana.classList.toggle("active", false);
    quickAddModeKatakana.setAttribute("aria-checked", "false");
  }

  if (quickAddInput) {
    quickAddInput.placeholder = isEnglish
      ? "Search by English meaning… (e.g. eat, water, happy)"
      : "Type romaji or Japanese… (e.g. taberu)";

    if (typeof wanakana !== "undefined") {
      try {
        quickAddInput.removeEventListener("input", onQuickAddInput);
        if (typeof wanakana.unbind === "function" && quickAddInput.hasAttribute("data-wanakana-id")) {
          wanakana.unbind(quickAddInput);
        }
        if (!isEnglish && typeof wanakana.bind === "function") {
          wanakana.bind(quickAddInput, { IMEMode: true });
        }
        quickAddInput.addEventListener("input", onQuickAddInput);
      } catch (err) {
        console.warn("WanaKana mode switch error:", err);
      }
    }
  }

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ "kiroku.quickadd_search_mode": currentQuickAddSearchMode });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("kiroku.quickadd_search_mode", currentQuickAddSearchMode);
    }
  } catch (_) {}
}

async function loadQuickAddKanaMode() {
  let savedMode = "kana";
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("kiroku.quickadd_search_mode");
      if (stored && stored["kiroku.quickadd_search_mode"]) {
        savedMode = stored["kiroku.quickadd_search_mode"];
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("kiroku.quickadd_search_mode");
      if (stored) savedMode = stored;
    }
  } catch (_) {}
  setQuickAddSearchMode(savedMode);
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

  // Highlight currently hovered term, mined expression, or draft expression if present in the cue text
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

// -------------------------------------------------------------
// Subtitle In-Track Search, Recent Cues & Sentence Mining (T4-B, T4-C, T4-F)
// -------------------------------------------------------------
async function loadActiveSubtitleCuesFromStorage() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const result = await chrome.storage.local.get(["active_subtitle_cues", "active_subtitle_filename"]);
      if (Array.isArray(result?.active_subtitle_cues)) {
        loadedSubtitleCues = result.active_subtitle_cues;
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
    fieldExampleSentence.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (typeof fieldSourceText !== "undefined" && fieldSourceText) fieldSourceText.value = cue.text || "";

  const targetTime = getSubtitleCueTargetTime(cue);
  await seekToSubtitleCue(cue);
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

    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      try {
        const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
        const segments = Array.from(segmenter.segment(cue.text));
        segments.forEach(seg => {
          const w = seg.segment;
          if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(w)) {
            const wordSpan = document.createElement("span");
            wordSpan.className = "recent-cue-word";
            wordSpan.textContent = w;
            wordSpan.title = `Click to mine "${w}"`;
            wordSpan.addEventListener("click", async (e) => {
              e.stopPropagation();
              await mineSubtitleCueWord(cue, w).catch(() => {});
            });
            textSpan.appendChild(wordSpan);
          } else {
            textSpan.appendChild(document.createTextNode(w));
          }
        });
      } catch (_) {
        textSpan.textContent = cue.text;
      }
    } else {
      const wordSpan = document.createElement("span");
      wordSpan.className = "recent-cue-word";
      wordSpan.textContent = cue.text;
      wordSpan.title = `Click to mine "${cue.text}"`;
      wordSpan.addEventListener("click", () => mineSubtitleCueWord(cue, cue.text).catch(() => {}));
      textSpan.appendChild(wordSpan);
    }

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
  window.setLoadedSubtitleCues = (cues) => { loadedSubtitleCues = cues; };
  window.setRecentSubtitleCues = (cues) => { recentSubtitleCues = cues; };
  window.setRecentSubsEnabled = (enabled) => { isRecentSubsEnabled = enabled; };
  window.loadRecentSubsPreferences = loadRecentSubsPreferences;
}

function switchMiningTab(targetTab) {
  const validTabs = ["text", "video", "quickadd", "ask", "history", "settings"];
  const tab = validTabs.includes(targetTab) ? targetTab : "text";
  const previousTab = currentMiningTab;
  const settingsPanel = layoutSettingsPopover || cardSettingsPopover;
  const prioritizeVideoSettings = tab === "settings" && (
    previousTab === "video" || (previousTab === "settings" && settingsPanel?.classList.contains("video-settings-priority"))
  );
  currentMiningTab = tab;

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
  if (settingsPanel) {
    const isSettings = tab === "settings";
    settingsPanel.classList.toggle("video-settings-priority", prioritizeVideoSettings);
    settingsPanel.hidden = !isSettings;
    settingsPanel.style.display = isSettings ? "" : "none";
    if (isSettings) {
      syncCardTemplateSettingsUI();
      renderLayoutSettingsList(currentCardSectionOrder);
      if (typeof checkLLMStatus === "function") checkLLMStatus().catch(() => {});
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
  tabBtnQuickAdd.addEventListener("click", () => switchMiningTab("quickadd"));
}
if (tabBtnAsk) {
  tabBtnAsk.addEventListener("click", () => switchMiningTab("ask"));
}
if (btnAskFromText) {
  btnAskFromText.addEventListener("click", () => {
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
  tabBtnHistory.addEventListener("click", () => switchMiningTab("history"));
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
    let enabled = true;
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
    let autoAudio = true;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(["auto_capture_frame", "auto_capture_audio"]);
      if (typeof stored?.auto_capture_frame === "boolean") autoFrame = stored.auto_capture_frame;
      if (typeof stored?.auto_capture_audio === "boolean") autoAudio = stored.auto_capture_audio;
    } else if (typeof localStorage !== "undefined") {
      const sf = localStorage.getItem("auto_capture_frame");
      if (sf !== null) autoFrame = sf === "true";
      const sa = localStorage.getItem("auto_capture_audio");
      if (sa !== null) autoAudio = sa === "true";
    }
    if (toggleAutoCaptureFrame) toggleAutoCaptureFrame.checked = autoFrame;
    if (toggleAutoCaptureAudio) toggleAutoCaptureAudio.checked = autoAudio;
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

if (toggleAutoCaptureAudio) {
  toggleAutoCaptureAudio.addEventListener("change", (e) => {
    setAutoCapturePreference("auto_capture_audio", Boolean(e.target.checked));
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

// Default Yomitan indicator to ready state
setIndicatorStatus(indicatorYomitan, "connected", "Yomitan: Ready");

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  if (message?.type === "AUDIO_CAPTURED") {
    if (message.captureId && currentCaptureId && message.captureId !== currentCaptureId) {
      sendResponse?.({ok: false, error: "STALE_CAPTURE"});
      return true;
    }
    if (message.dataUrl) {
      currentDraftMedia.audioBase64 = message.dataUrl;
      currentDraftMedia.audioStatus = "available";
      currentDraftMedia.audioError = null;
      currentDraftMedia.mimeType = message.mimeType || "audio/wav";
      currentDraftMedia.captureId = currentCaptureId;
      if (cardEditor && cardEditor.hidden) cardEditor.hidden = false;
      if (fieldAudio && !fieldAudio.value) {
        fieldAudio.value = (message.mimeType && message.mimeType.includes("wav"))
          ? "captured_audio.wav"
          : "captured_audio.webm";
      }
      updateMediaPreviews();
      setStatus(message.wasPending ? "Audio snippet finalized on resume." : "Audio snippet extracted.");
    }
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "AUDIO_CAPTURE_STATUS") {
    if (message.captureId && currentCaptureId && message.captureId !== currentCaptureId) {
      sendResponse?.({ok: false, error: "STALE_CAPTURE"});
      return true;
    }
    if (message.pending || message.status === "PENDING") {
      currentDraftMedia.audioStatus = "pending";
      currentDraftMedia.audioBase64 = null;
      updateMediaPreviews();
      setStatus("Audio queued (capturing on playback resume)...");
    } else if (!message.ok) {
      const isDrm = message.error === "DRM_AUDIO_RESTRICTED" || message.error === "DRM_AUDIO";
      const isExpired = message.error === "AUDIO_BUFFER_EXPIRED";
      const isDiscontinuity = message.error === "AUDIO_DISCONTINUITY" || message.error === "TIMELINE_DISCONTINUITY";

      if (isExpired) {
        currentDraftMedia.audioStatus = "expired";
      } else if (isDiscontinuity) {
        currentDraftMedia.audioStatus = "discontinuity";
      } else if (isDrm) {
        currentDraftMedia.audioStatus = "unavailable";
        currentDraftMedia.audioError = "DRM_AUDIO_RESTRICTED";
      } else {
        currentDraftMedia.audioStatus = "unavailable";
        currentDraftMedia.audioError = message.error || "AUDIO_UNAVAILABLE";
      }
      currentDraftMedia.audioBase64 = null;
      updateMediaPreviews();

      const statusText = isDrm
        ? "Audio unavailable for this source (DRM protected)."
        : isExpired
          ? "Audio expired from 30s rolling buffer."
          : isDiscontinuity
            ? "Audio segment changed due to seek."
            : (message.message || "Audio unavailable for this source.");
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
    if (areaName === "local" && changes?.active_subtitle_cues) {
      loadedSubtitleCues = Array.isArray(changes.active_subtitle_cues.newValue)
        ? changes.active_subtitle_cues.newValue
        : [];
      if (changes.active_subtitle_filename?.newValue && subtitlesFileStatus) {
        subtitlesFileStatus.textContent = changes.active_subtitle_filename.newValue;
        subtitlesFileStatus.classList.add("active");
        subtitlesFileStatus.title = `${changes.active_subtitle_filename.newValue} (${loadedSubtitleCues.length} cues)`;
      }
    }
  });
}

/* ==========================================================================
   Layout Settings & Customizable Card Section Reordering
   ========================================================================== */

function resolveValidSectionOrder(savedOrder) {
  if (!Array.isArray(savedOrder) && Array.isArray(savedOrder?.order)) {
    savedOrder = savedOrder.order;
  }
  if (!Array.isArray(savedOrder)) {
    return [...DEFAULT_CARD_SECTION_ORDER];
  }
  const validIds = new Set(DEFAULT_CARD_SECTION_ORDER);
  const seen = new Set();
  const result = [];

  for (const id of savedOrder) {
    if (typeof id === "string" && validIds.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  // Append any missing known sections in default canonical order
  for (const defId of DEFAULT_CARD_SECTION_ORDER) {
    if (!seen.has(defId)) {
      seen.add(defId);
      result.push(defId);
    }
  }

  return result;
}

function resolveValidSectionVisibility(savedVisibility) {
  const resolved = { ...DEFAULT_CARD_SECTION_VISIBILITY };
  for (const sectionId of DEFAULT_CARD_SECTION_ORDER) {
    if (sectionId !== "fields" && typeof savedVisibility?.[sectionId] === "boolean") {
      resolved[sectionId] = savedVisibility[sectionId];
    }
  }
  return resolved;
}

function getCurrentSectionOrder() {
  return [...currentCardSectionOrder];
}


async function loadStoredSectionOrder() {
  try {
    let stored = null;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const res = await chrome.storage.local.get(STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER);
      stored = res?.[STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER];
    } else if (typeof localStorage !== "undefined") {
      const item = localStorage.getItem(STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER);
      if (item) {
        try {
          stored = JSON.parse(item);
        } catch (_) {}
      }
    }
    const resolved = resolveValidSectionOrder(stored);
    currentCardSectionOrder = resolved;
    currentCardSectionVisibility = resolveValidSectionVisibility(
      Array.isArray(stored) ? null : stored?.visibility
    );
    return resolved;
  } catch (_) {
    currentCardSectionOrder = [...DEFAULT_CARD_SECTION_ORDER];
    currentCardSectionVisibility = { ...DEFAULT_CARD_SECTION_VISIBILITY };
    return currentCardSectionOrder;
  }
}

async function persistStoredSectionLayout() {
  const storedLayout = {
    order: resolveValidSectionOrder(currentCardSectionOrder),
    visibility: resolveValidSectionVisibility(currentCardSectionVisibility)
  };
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER]: storedLayout });
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER, JSON.stringify(storedLayout));
    }
  } catch (_) {}
  return storedLayout;
}

async function saveStoredSectionOrder(order) {
  const validated = resolveValidSectionOrder(order);
  currentCardSectionOrder = validated;
  await persistStoredSectionLayout();
  return validated;
}

async function saveStoredSectionVisibility(visibility) {
  currentCardSectionVisibility = resolveValidSectionVisibility(visibility);
  applySectionVisibility(currentCardSectionVisibility);
  await persistStoredSectionLayout();
  renderLayoutSettingsList(currentCardSectionOrder);
  return currentCardSectionVisibility;
}

function applySectionVisibility(visibility = currentCardSectionVisibility) {
  const validated = resolveValidSectionVisibility(visibility);
  currentCardSectionVisibility = validated;
  if (!cardLayoutContainer) return validated;

  for (const sectionId of DEFAULT_CARD_SECTION_ORDER) {
    const sectionEl = cardLayoutContainer.querySelector(`[data-layout-section="${sectionId}"]`);
    if (sectionEl) {
      sectionEl.setAttribute("data-layout-visible", String(validated[sectionId]));
    }
  }
  return validated;
}

function applySectionOrder(order) {
  const validated = resolveValidSectionOrder(order);
  currentCardSectionOrder = validated;
  if (!cardLayoutContainer) {
    applySectionVisibility();
    return validated;
  }

  for (const sectionId of validated) {
    const sectionEl = cardLayoutContainer.querySelector(`[data-layout-section="${sectionId}"]`);
    if (sectionEl) {
      cardLayoutContainer.appendChild(sectionEl);
    }
  }
  applySectionVisibility();
  return validated;
}

function moveSectionByDelta(fromIndex, delta) {
  const toIndex = fromIndex + delta;
  if (toIndex < 0 || toIndex >= currentCardSectionOrder.length) return;

  const newOrder = [...currentCardSectionOrder];
  const [moved] = newOrder.splice(fromIndex, 1);
  newOrder.splice(toIndex, 0, moved);

  applySectionOrder(newOrder);
  saveStoredSectionOrder(newOrder);
  renderLayoutSettingsList(newOrder);
}

function renderLayoutSettingsList(order = currentCardSectionOrder) {
  if (!layoutSectionsList) return;
  layoutSectionsList.replaceChildren();

  order.forEach((sectionId, index) => {
    const meta = SECTION_METADATA[sectionId] || { id: sectionId, name: sectionId };
    const item = document.createElement("div");
    item.className = "layout-section-item";
    item.draggable = true;
    item.setAttribute("data-section-id", sectionId);
    item.setAttribute("data-index", String(index));
    item.setAttribute("role", "listitem");

    // Handle and section label
    const handleWrap = document.createElement("div");
    handleWrap.className = "layout-section-handle-wrap";

    const handleIcon = document.createElement("span");
    handleIcon.className = "layout-drag-handle";
    handleIcon.setAttribute("aria-hidden", "true");
    handleIcon.textContent = "☰";

    const nameSpan = document.createElement("span");
    nameSpan.className = "layout-section-name";
    nameSpan.textContent = meta.name;

    handleWrap.appendChild(handleIcon);
    handleWrap.appendChild(nameSpan);

    // Actions (Move Up / Move Down)
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "layout-section-actions";

    const visibilityToggle = document.createElement("input");
    visibilityToggle.type = "checkbox";
    visibilityToggle.className = "layout-section-visibility";
    visibilityToggle.checked = currentCardSectionVisibility[sectionId] !== false;
    visibilityToggle.disabled = sectionId === "fields";
    visibilityToggle.title = sectionId === "fields" ? "Card Fields are always visible" : `Show ${meta.name} in the Text tab`;
    visibilityToggle.setAttribute("aria-label", visibilityToggle.title);
    visibilityToggle.addEventListener("change", () => {
      const nextVisibility = { ...currentCardSectionVisibility, [sectionId]: visibilityToggle.checked };
      saveStoredSectionVisibility(nextVisibility);
    });

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "btn-move-section btn-move-up";
    upBtn.textContent = "↑";
    upBtn.title = `Move ${meta.name} up`;
    upBtn.setAttribute("aria-label", `Move ${meta.name} up`);
    if (index === 0) upBtn.disabled = true;
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      moveSectionByDelta(index, -1);
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "btn-move-section btn-move-down";
    downBtn.textContent = "↓";
    downBtn.title = `Move ${meta.name} down`;
    downBtn.setAttribute("aria-label", `Move ${meta.name} down`);
    if (index === order.length - 1) downBtn.disabled = true;
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      moveSectionByDelta(index, 1);
    });

    actionsWrap.appendChild(visibilityToggle);
    actionsWrap.appendChild(upBtn);
    actionsWrap.appendChild(downBtn);

    item.appendChild(handleWrap);
    item.appendChild(actionsWrap);

    // Drag-and-drop event handlers
    item.addEventListener("dragstart", (e) => {
      draggedSectionIndex = index;
      item.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", sectionId);
      }
    });

    item.addEventListener("dragend", () => {
      draggedSectionIndex = null;
      if (layoutSectionsList) {
        layoutSectionsList.querySelectorAll(".layout-section-item").forEach(el => {
          el.classList.remove("dragging", "drag-over");
        });
      }
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      item.classList.add("drag-over");
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      item.classList.remove("drag-over");
      if (draggedSectionIndex === null || draggedSectionIndex === index) return;

      const newOrder = [...currentCardSectionOrder];
      const [moved] = newOrder.splice(draggedSectionIndex, 1);
      newOrder.splice(index, 0, moved);
      draggedSectionIndex = null;

      applySectionOrder(newOrder);
      saveStoredSectionOrder(newOrder);
      renderLayoutSettingsList(newOrder);
    });

    layoutSectionsList.appendChild(item);
  });
}

function openLayoutSettings() {
  const popover = cardSettingsPopover || layoutSettingsPopover;
  if (!popover) return;
  popover.hidden = false;
  if (popover.style) {
    popover.style.display = "block";
  }
  if (btnLayoutSettings) {
    btnLayoutSettings.setAttribute("aria-expanded", "true");
    btnLayoutSettings.classList.add("active");
  }
  syncCardTemplateSettingsUI();
  renderLayoutSettingsList(currentCardSectionOrder);
  if (typeof checkLLMStatus === "function") {
    checkLLMStatus().catch(() => {});
  }
  if (typeof loadLlmConfigToSettings === "function") {
    loadLlmConfigToSettings().catch(() => {});
  }
}

function closeLayoutSettings() {
  const popover = cardSettingsPopover || layoutSettingsPopover;
  if (!popover) return;
  popover.hidden = true;
  if (popover.style) {
    popover.style.display = "none";
  }
  if (btnLayoutSettings) {
    btnLayoutSettings.setAttribute("aria-expanded", "false");
    btnLayoutSettings.classList.remove("active");
    btnLayoutSettings.focus();
  }
}

async function resetLayoutSettings() {
  const defaultOrder = [...DEFAULT_CARD_SECTION_ORDER];
  currentCardSectionVisibility = { ...DEFAULT_CARD_SECTION_VISIBILITY };
  applySectionOrder(defaultOrder);
  await saveStoredSectionOrder(defaultOrder);
  renderLayoutSettingsList(defaultOrder);
}

if (btnLayoutSettings) {
  btnLayoutSettings.addEventListener("click", (e) => {
    e.stopPropagation();
    if (currentMiningTab === "settings") {
      switchMiningTab(btnLayoutSettings._prevTab || "text");
    } else {
      btnLayoutSettings._prevTab = currentMiningTab;
      switchMiningTab("settings");
    }
  });
}

if (btnCloseLayoutSettings) {
  btnCloseLayoutSettings.addEventListener("click", () => {
    closeLayoutSettings();
  });
}

if (btnCloseCardSettings && btnCloseCardSettings !== btnCloseLayoutSettings) {
  btnCloseCardSettings.addEventListener("click", () => {
    closeLayoutSettings();
  });
}

if (btnResetLayout) {
  btnResetLayout.addEventListener("click", () => {
    resetLayoutSettings();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && currentMiningTab === "settings") {
    switchMiningTab("text");
  }
});


if (btnDismissFirstRun) {
  btnDismissFirstRun.addEventListener("click", () => dismissFirstRunGuide());
}

/* ==========================================================================
   TIER 5: ASK TAB (AI ASSISTANT) LOGIC & INTEGRATION
   ========================================================================== */

let askChatHistory = [];
let isAskLoading = false;
let currentAskTask = "answer_question";
let currentAskResponseMode = "short";
const STORAGE_KEY_ASK_RESPONSE_MODE = "kiroku.ask.responseMode";
let lastLLMStatus = null;

async function checkLLMStatus() {
  try {
    const res = await fetch(API_LLM_STATUS_URL);
    if (!res.ok) {
      throw new Error(`Status ${res.status}`);
    }
    const data = await res.json();
    lastLLMStatus = data;
    const isConfigured = Boolean(data.configured);
    const provider = data.provider || "none";
    const model = data.model || "";

    if (askStatusDot) {
      askStatusDot.className = `ask-status-dot ${isConfigured ? "online" : "offline"}`;
    }
    if (askProviderName) {
      askProviderName.textContent = isConfigured ? "Online" : "Offline";
    }
    if (askModelTag) {
      askModelTag.textContent = isConfigured ? (model || provider) : "offline";
    }
    if (llmProviderDisplay) {
      llmProviderDisplay.textContent = provider.charAt(0).toUpperCase() + provider.slice(1);
    }
    if (llmStatusLabel) {
      llmStatusLabel.textContent = isConfigured ? `Ready (${model || "online"})` : "Not configured";
      llmStatusLabel.style.color = isConfigured ? "var(--accent-success, #81c784)" : "var(--text-muted, #756e65)";
    }
    return data;
  } catch (err) {
    if (askStatusDot) {
      askStatusDot.className = "ask-status-dot offline";
    }
    if (askProviderName) {
      askProviderName.textContent = "Offline";
    }
    if (askModelTag) {
      askModelTag.textContent = "offline";
    }
    if (llmProviderDisplay) {
      llmProviderDisplay.textContent = "Unknown";
    }
    if (llmStatusLabel) {
      llmStatusLabel.textContent = "Backend offline";
      llmStatusLabel.style.color = "var(--accent-primary, #b84632)";
    }
    return null;
  }
}

let removeKeyConfirmTimeout = null;

async function loadLlmConfigToSettings() {
  try {
    const res = await fetch(API_LLM_CONFIG_URL);
    if (!res.ok) return null;
    const data = await res.json();
    if (settingLlmProvider && data.provider) {
      settingLlmProvider.value = data.provider;
    }
    if (settingLlmModel && data.model !== undefined) {
      settingLlmModel.value = data.model || "";
    }
    if (settingLlmKeyName && data.key_name !== undefined) {
      settingLlmKeyName.value = data.key_name || "";
    }
    if (settingLlmJlptLevel && data.jlpt_level) {
      settingLlmJlptLevel.value = data.jlpt_level;
    }

    const isConfigured = Boolean(data.configured || data.has_key);
    applyLlmConfiguredState(isConfigured, data.provider);
    return data;
  } catch (err) {
    return null;
  }
}

function applyLlmConfiguredState(isConfigured, provider = "groq") {
  const normProvider = (provider || "Groq").charAt(0).toUpperCase() + (provider || "Groq").slice(1);
  if (isConfigured) {
    if (settingLlmKey) {
      settingLlmKey.value = "••••••••••••••••";
      settingLlmKey.disabled = true;
    }
    if (llmKeyStatusMsg) {
      llmKeyStatusMsg.hidden = false;
    }
    if (llmKeyStatusText) {
      llmKeyStatusText.textContent = `${normProvider} API key configured`;
    }
    if (btnSaveLlmKey) btnSaveLlmKey.hidden = true;
    if (btnReplaceLlmKey) btnReplaceLlmKey.hidden = false;
    if (btnRemoveLlmKey) {
      btnRemoveLlmKey.hidden = false;
      btnRemoveLlmKey.textContent = "Remove API Key";
      btnRemoveLlmKey.classList.remove("confirm-active");
    }
    if (btnCancelReplaceLlmKey) btnCancelReplaceLlmKey.hidden = true;
  } else {
    if (settingLlmKey) {
      settingLlmKey.value = "";
      settingLlmKey.disabled = false;
      settingLlmKey.placeholder = "Enter API key...";
    }
    if (llmKeyStatusMsg) {
      llmKeyStatusMsg.hidden = true;
    }
    if (btnSaveLlmKey) {
      btnSaveLlmKey.hidden = false;
      btnSaveLlmKey.textContent = "Save API Key";
    }
    if (btnReplaceLlmKey) btnReplaceLlmKey.hidden = true;
    if (btnRemoveLlmKey) btnRemoveLlmKey.hidden = true;
    if (btnCancelReplaceLlmKey) btnCancelReplaceLlmKey.hidden = true;
  }
}

async function saveLlmSecretFromSettings() {
  if (!settingLlmKey) return;
  const rawKey = settingLlmKey.value.trim();
  if (!rawKey || rawKey === "••••••••••••••••") {
    settingLlmKey.focus();
    return;
  }

  const provider = settingLlmProvider ? settingLlmProvider.value : "groq";
  const model = settingLlmModel ? settingLlmModel.value.trim() : "";
  const keyName = settingLlmKeyName ? settingLlmKeyName.value.trim() : "";
  const jlptLevel = settingLlmJlptLevel ? settingLlmJlptLevel.value : undefined;

  try {
    const res = await fetch(API_LLM_SECRET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: rawKey,
        key_name: keyName || `Kiroku ${provider.charAt(0).toUpperCase() + provider.slice(1)}`,
        provider: provider,
      }),
    });

    // Minimize lifetime of plaintext key in memory: clear input value immediately
    settingLlmKey.value = "";

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (typeof alert === "function") alert(err.detail || "Failed to save API key.");
      return;
    }

    const data = await res.json();

    // Also persist non-secret provider/model/jlpt_level if changed
    await fetch(API_LLM_CONFIG_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: provider,
        model: model || undefined,
        key_name: data.key_name || keyName,
        jlpt_level: jlptLevel,
      }),
    }).catch(() => {});

    applyLlmConfiguredState(true, provider);
    if (typeof checkLLMStatus === "function") {
      await checkLLMStatus();
    }
  } catch (err) {
    settingLlmKey.value = "";
    if (typeof alert === "function") alert("Connection error: Failed to save API key.");
  }
}

function startReplaceLlmKey() {
  if (!settingLlmKey) return;
  settingLlmKey.disabled = false;
  settingLlmKey.value = "";
  settingLlmKey.placeholder = "Enter new API key...";
  settingLlmKey.focus();

  if (btnSaveLlmKey) {
    btnSaveLlmKey.hidden = false;
    btnSaveLlmKey.textContent = "Save API Key";
  }
  if (btnReplaceLlmKey) btnReplaceLlmKey.hidden = true;
  if (btnRemoveLlmKey) btnRemoveLlmKey.hidden = true;
  if (btnCancelReplaceLlmKey) btnCancelReplaceLlmKey.hidden = false;
}

function cancelReplaceLlmKey() {
  loadLlmConfigToSettings();
}

async function removeLlmSecretFromSettings() {
  if (!btnRemoveLlmKey) return;

  if (!btnRemoveLlmKey.classList.contains("confirm-active")) {
    btnRemoveLlmKey.classList.add("confirm-active");
    btnRemoveLlmKey.textContent = "Confirm Remove?";
    if (removeKeyConfirmTimeout) clearTimeout(removeKeyConfirmTimeout);
    removeKeyConfirmTimeout = setTimeout(() => {
      if (btnRemoveLlmKey) {
        btnRemoveLlmKey.classList.remove("confirm-active");
        btnRemoveLlmKey.textContent = "Remove API Key";
      }
    }, 4000);
    return;
  }

  if (removeKeyConfirmTimeout) {
    clearTimeout(removeKeyConfirmTimeout);
    removeKeyConfirmTimeout = null;
  }
  btnRemoveLlmKey.classList.remove("confirm-active");
  btnRemoveLlmKey.textContent = "Remove API Key";

  try {
    const res = await fetch(API_LLM_SECRET_URL, { method: "DELETE" });
    if (!res.ok) {
      if (typeof alert === "function") alert("Failed to remove API key.");
      return;
    }
    const data = await res.json();
    applyLlmConfiguredState(Boolean(data.configured), data.provider);
    if (typeof checkLLMStatus === "function") {
      await checkLLMStatus();
    }
  } catch (err) {
    if (typeof alert === "function") alert("Connection error: Failed to remove API key.");
  }
}

function initLlmSettingsUI() {
  if (btnSaveLlmKey) {
    btnSaveLlmKey.addEventListener("click", saveLlmSecretFromSettings);
  }
  if (btnReplaceLlmKey) {
    btnReplaceLlmKey.addEventListener("click", startReplaceLlmKey);
  }
  if (btnCancelReplaceLlmKey) {
    btnCancelReplaceLlmKey.addEventListener("click", cancelReplaceLlmKey);
  }
  if (btnRemoveLlmKey) {
    btnRemoveLlmKey.addEventListener("click", removeLlmSecretFromSettings);
  }

  if (settingLlmProvider) {
    settingLlmProvider.addEventListener("change", async () => {
      const prov = settingLlmProvider.value;
      if (settingLlmModel) {
        if (prov === "groq") settingLlmModel.placeholder = "openai/gpt-oss-120b";
        else if (prov === "gemini") settingLlmModel.placeholder = "gemini-2.0-flash";
        else if (prov === "ollama") settingLlmModel.placeholder = "qwen2.5:1.5b";
      }
      try {
        await fetch(API_LLM_CONFIG_URL, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: prov }),
        });
        if (typeof checkLLMStatus === "function") await checkLLMStatus();
      } catch (e) {}
    });
  }

  if (settingLlmModel) {
    settingLlmModel.addEventListener("change", async () => {
      const val = settingLlmModel.value.trim();
      try {
        await fetch(API_LLM_CONFIG_URL, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: val || "" }),
        });
        if (typeof checkLLMStatus === "function") await checkLLMStatus();
      } catch (e) {}
    });
  }

  if (settingLlmKeyName) {
    settingLlmKeyName.addEventListener("change", async () => {
      const val = settingLlmKeyName.value.trim();
      try {
        await fetch(API_LLM_CONFIG_URL, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key_name: val || "" }),
        });
      } catch (e) {}
    });
  }

  if (settingLlmJlptLevel) {
    settingLlmJlptLevel.addEventListener("change", async () => {
      const val = settingLlmJlptLevel.value;
      try {
        await fetch(API_LLM_CONFIG_URL, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jlpt_level: val }),
        });
      } catch (e) {}
    });
  }
}

function buildTextAskContext() {
  const word = fieldExpression?.value.trim() || "";
  const reading = fieldReading?.value.trim() || "";
  const meaning = fieldMeaning?.value.trim() || "";
  const sourceText = fieldSourceText?.value.trim() || "";
  const example = fieldExampleSentence?.value.trim() || "";
  const lines = [];

  if (word) lines.push(`Word: ${word}`);
  if (reading) lines.push(`Reading: ${reading}`);
  if (meaning) lines.push(`Current meaning: ${meaning}`);
  if (sourceText && sourceText !== word) lines.push(`Captured text: ${sourceText}`);
  if (example && example !== word && example !== sourceText) lines.push(`Example: ${example}`);

  return lines.join("\n");
}

function setAskContext(text, source = "Detected Context") {
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean) {
    clearAskContext();
    return;
  }
  activeAskContext = { text: clean, source };
  if (askContextText) {
    askContextText.textContent = clean;
  }
  if (contextSourceBadge) {
    contextSourceBadge.textContent = source;
  }
  if (askContextBanner) {
    askContextBanner.hidden = false;
  }
}

function clearAskContext() {
  activeAskContext = { text: "", source: "" };
  if (askContextBanner) {
    askContextBanner.hidden = true;
  }
}

function updateAskCharCount() {
  if (!askCharCount || !askInputBox) return;
  const count = askInputBox.value.length;
  askCharCount.textContent = count > 0 ? `${count} chars` : "";
}

function resizeAskInputBox() {
  if (!askInputBox) return;
  const maxHeight = 220;
  askInputBox.style.height = "auto";
  const contentHeight = askInputBox.scrollHeight;
  askInputBox.style.height = `${Math.min(contentHeight, maxHeight)}px`;
  askInputBox.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
}

function formatInlineMarkdown(str) {
  if (!str) return "";
  const codeSegments = [];
  let res = str.replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0000CODE${codeSegments.length}\u0000`;
    codeSegments.push(`<code class="ai-inline-code">${code}</code>`);
    return token;
  });
  res = res.replace(/(^|[^*])(\*{1,2})([^*\n]+?)(\*{1,2})(?=\s|$|[、。，.!?;:：；）」』】〉）—–])/g, (match, prefix, opening, content, closing) => {
    if (opening.length === closing.length) return match;
    return `${prefix}<strong>${content}</strong>`;
  });
  res = res.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  res = res.replace(/\*\*(.+?)\*\*(?!\*)/g, "<strong>$1</strong>");
  res = res.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  res = res.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeSegments[Number(index)]);
  return res;
}

function parseMarkdownTable(tableLines) {
  if (tableLines.length < 2) return null;
  const parseRow = (line) => {
    let raw = line.trim();
    if (raw.startsWith("|")) raw = raw.slice(1);
    if (raw.endsWith("|")) raw = raw.slice(0, -1);
    return raw.split("|").map(c => c.trim());
  };

  const headerCells = parseRow(tableLines[0]);
  const separatorLine = tableLines[1].trim();
  const isSeparator = /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(separatorLine);
  if (!isSeparator) return null;

  const bodyRows = tableLines.slice(2).map(parseRow);

  let html = '<div class="ai-table-wrap"><table class="ai-table"><thead><tr>';
  headerCells.forEach(cell => {
    html += `<th>${formatInlineMarkdown(cell)}</th>`;
  });
  html += '</tr></thead>';

  if (bodyRows.length > 0) {
    html += '<tbody>';
    bodyRows.forEach(row => {
      html += '<tr>';
      row.forEach(cell => {
        html += `<td>${formatInlineMarkdown(cell)}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody>';
  }
  html += '</table></div>';
  return html;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatAIResponse(rawText) {
  if (!rawText) return "";
  
  const safeText = escapeHtml(rawText);

  const lines = safeText.split("\n");
  let formattedHtml = "";
  let inList = false;
  let inCodeBlock = false;
  let codeBlockBuffer = [];
  let tableBuffer = [];

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      const tableHtml = parseMarkdownTable(tableBuffer);
      if (tableHtml) {
        formattedHtml += tableHtml;
      } else {
        tableBuffer.forEach(tLine => {
          formattedHtml += `<p>${formatInlineMarkdown(tLine)}</p>`;
        });
      }
      tableBuffer = [];
    }
  };

  const flushList = () => {
    if (inList) {
      formattedHtml += "</ul>";
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().replace(/^\*\s+(.+?)\*\*(?=\s|$|[、。，.!?;:：；）」』】〉）—–])/, "**$1**");

    // Handle code blocks (```)
    if (line.startsWith("```")) {
      flushTable();
      flushList();
      if (inCodeBlock) {
        formattedHtml += `<pre class="ai-code-block"><code>${codeBlockBuffer.join("\n")}</code></pre>`;
        codeBlockBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockBuffer = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockBuffer.push(lines[i]);
      continue;
    }

    // Handle Markdown Tables
    if (line.includes("|") && (line.startsWith("|") || line.endsWith("|") || line.includes(" | "))) {
      flushList();
      tableBuffer.push(line);
      continue;
    } else if (tableBuffer.length > 0) {
      flushTable();
    }

    if (!line) {
      flushList();
      continue;
    }

    // Direct Answer Badge Highlight
    const answerMatch = line.match(/^(\*\*Answer\*\*|Answer|\*\*Correct\*\*|Correct):\s*(.+)$/i);
    if (answerMatch) {
      flushList();
      formattedHtml += `<div class="ai-direct-answer"><span class="answer-badge">ANSWER</span><strong>${formatInlineMarkdown(answerMatch[2])}</strong></div>`;
      continue;
    }

    // Section Titles (e.g. Breakdown, Explanation, Distractors, Meaning, Usage, Example)
    const sectionMatch = line.match(/^(\*\*(?:Why other options are incorrect|Distractors|Incorrect options|Explanation|Why this is correct|Grammar Pattern|Breakdown|Meaning|Usage|Example|Formation|Nuance|Common Mistakes?|Notes?)\*\*|(?:Why other options are incorrect|Distractors|Incorrect options|Explanation|Why this is correct|Grammar Pattern|Breakdown|Meaning|Usage|Example|Formation|Nuance|Common Mistakes?|Notes?):|###\s*(.+))/i);
    if (sectionMatch) {
      flushList();
      const titleText = line.replace(/^###\s*/, "").replace(/\*\*/g, "").replace(/:$/, "");
      formattedHtml += `<div class="ai-section-title">${titleText}</div>`;
      continue;
    }

    // Lists (- item, * item, + item, or 1. item)
    if (/^(?:[-+*]\s+|\d+[.)]\s+)/.test(line)) {
      if (!inList) {
        formattedHtml += '<ul class="ai-distractor-list">';
        inList = true;
      }
      const cleanItem = line.replace(/^(?:[-+*]\s+|\d+[.)]\s+)/, "").trim();
      formattedHtml += `<li>${formatInlineMarkdown(cleanItem)}</li>`;
      continue;
    }

    flushList();
    formattedHtml += `<p>${formatInlineMarkdown(line)}</p>`;
  }

  if (inCodeBlock && codeBlockBuffer.length > 0) {
    formattedHtml += `<pre class="ai-code-block"><code>${codeBlockBuffer.join("\n")}</code></pre>`;
  }
  flushTable();
  flushList();

  return `<div class="ai-explanation-section">${formattedHtml}</div>`;
}

function setAskResponseMode(mode) {
  if (mode !== "short" && mode !== "detailed") return;
  currentAskResponseMode = mode;
  try {
    localStorage.setItem(STORAGE_KEY_ASK_RESPONSE_MODE, mode);
  } catch (_) {}
  if (btnModeShort && btnModeShort.classList) {
    if (typeof btnModeShort.classList.toggle === "function") {
      btnModeShort.classList.toggle("active", mode === "short");
    } else if (mode === "short") {
      btnModeShort.classList.add?.("active");
    } else {
      btnModeShort.classList.remove?.("active");
    }
  }
  if (btnModeDetailed && btnModeDetailed.classList) {
    if (typeof btnModeDetailed.classList.toggle === "function") {
      btnModeDetailed.classList.toggle("active", mode === "detailed");
    } else if (mode === "detailed") {
      btnModeDetailed.classList.add?.("active");
    } else {
      btnModeDetailed.classList.remove?.("active");
    }
  }
}

function initAskResponseMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_ASK_RESPONSE_MODE);
    if (saved === "short" || saved === "detailed") {
      setAskResponseMode(saved);
      return;
    }
  } catch (_) {}
  setAskResponseMode("short");
}

async function sendAskQuery(task = currentAskTask, overrideText = null) {
  if (isAskLoading) return;
  const promptText = (typeof overrideText === "string" ? overrideText : (askInputBox ? askInputBox.value : "")).trim();
  if (!promptText) return;

  if (askInputBox && !overrideText) {
    askInputBox.value = "";
    resizeAskInputBox();
    updateAskCharCount();
  }

  if (askEmptyState) {
    askEmptyState.style.display = "none";
  }

  // Append user message
  const userMsgEl = document.createElement("div");
  userMsgEl.className = "chat-message user-msg";
  userMsgEl.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-sender">You</span>
    </div>
    <div class="chat-msg-body"></div>
  `;
  const userBody = userMsgEl.querySelector(".chat-msg-body");
  if (userBody) userBody.textContent = promptText;
  if (askChatStream) {
    askChatStream.appendChild(userMsgEl);
  }

  // Append loading indicator
  const loadingEl = document.createElement("div");
  loadingEl.className = "ai-loading-indicator";
  loadingEl.innerHTML = `
    <span>Analyzing</span>
    <div class="ai-loading-dots">
      <span></span><span></span><span></span>
    </div>
  `;
  if (askChatStream) {
    askChatStream.appendChild(loadingEl);
    askChatStream.scrollTop = askChatStream.scrollHeight;
  }

  isAskLoading = true;
  if (btnAskSubmit) btnAskSubmit.disabled = true;

  try {
    const payload = {
      task: task || currentAskTask,
      text: promptText,
      context: activeAskContext.text || undefined,
      messages: askChatHistory.length > 0 ? askChatHistory : undefined,
      mode: currentAskResponseMode,
      jlpt_level: (settingLlmJlptLevel && settingLlmJlptLevel.value) ? settingLlmJlptLevel.value : undefined
    };

    const res = await fetch(API_LLM_ASK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    loadingEl.remove();

    if (!res.ok) {
      const errMsg = data.detail || `LLM request failed (status ${res.status})`;
      const errEl = document.createElement("div");
      errEl.className = "chat-message ai-msg ai-error";
      errEl.innerHTML = `
        <div class="chat-msg-header">
          <div class="ai-sender-info">
            <span class="ai-badge" style="color:#c94f3d; background:rgba(201,79,61,0.12); border-color:rgba(201,79,61,0.25);">ERROR</span>
          </div>
        </div>
        <div class="chat-msg-body">${errMsg}</div>
      `;
      if (askChatStream) {
        askChatStream.appendChild(errEl);
        askChatStream.scrollTop = askChatStream.scrollHeight;
      }
      return;
    }

    const aiResult = data.result || "";
    const aiProvider = data.provider || "AI";
    const aiModel = data.model || "";

    askChatHistory.push({ role: "user", content: promptText });
    askChatHistory.push({ role: "assistant", content: aiResult });

    const aiMsgEl = document.createElement("div");
    aiMsgEl.className = "chat-message ai-msg";
    aiMsgEl.innerHTML = `
      <div class="chat-msg-header">
        <div class="ai-sender-info">
          <span class="ai-badge">AI</span>
          <span class="ai-model-tag">${aiProvider}${aiModel ? ` (${aiModel})` : ""}</span>
        </div>
        <div class="chat-msg-actions">
          <button type="button" class="btn-chat-action btn-copy-ai" title="Copy answer">Copy</button>
          <button type="button" class="btn-chat-action btn-add-ai-notes" title="Add explanation to card notes">Add to Notes</button>
        </div>
      </div>
      <div class="chat-msg-body">${formatAIResponse(aiResult)}</div>
    `;

    const btnCopy = aiMsgEl.querySelector(".btn-copy-ai");
    if (btnCopy) {
      btnCopy.addEventListener("click", async () => {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(aiResult);
          }
          btnCopy.textContent = "Copied!";
          setTimeout(() => { btnCopy.textContent = "Copy"; }, 1500);
        } catch (_) {}
      });
    }

    const btnAddNotes = aiMsgEl.querySelector(".btn-add-ai-notes");
    if (btnAddNotes) {
      btnAddNotes.addEventListener("click", () => {
        if (fieldNotes) {
          const currentNotes = fieldNotes.value ? fieldNotes.value.trim() + "\n\n" : "";
          fieldNotes.value = currentNotes + aiResult;
          fieldNotes.dispatchEvent(new Event("input", { bubbles: true }));
          btnAddNotes.textContent = "Added!";
          setTimeout(() => { btnAddNotes.textContent = "Add to Notes"; }, 1500);
          setStatus("AI explanation added to card notes.");
        }
      });
    }

    if (askChatStream) {
      askChatStream.appendChild(aiMsgEl);
      askChatStream.scrollTop = askChatStream.scrollHeight;
    }

  } catch (err) {
    loadingEl.remove();
    const errEl = document.createElement("div");
    errEl.className = "chat-message ai-msg ai-error";
    errEl.innerHTML = `
      <div class="chat-msg-header">
        <div class="ai-sender-info">
          <span class="ai-badge" style="color:#c94f3d; background:rgba(201,79,61,0.12); border-color:rgba(201,79,61,0.25);">ERROR</span>
        </div>
      </div>
      <div class="chat-msg-body">Connection error: ${err.message}. Is backend running?</div>
    `;
    if (askChatStream) {
      askChatStream.appendChild(errEl);
      askChatStream.scrollTop = askChatStream.scrollHeight;
    }
  } finally {
    isAskLoading = false;
    if (btnAskSubmit) btnAskSubmit.disabled = false;
  }
}

// Event listeners for Ask Tab
if (btnModeShort) {
  btnModeShort.addEventListener("click", () => setAskResponseMode("short"));
}
if (btnModeDetailed) {
  btnModeDetailed.addEventListener("click", () => setAskResponseMode("detailed"));
}

let askModePickerStart = -1;
let askModePickerEnd = -1;
let askModePickerOptions = [];
let askModePickerIndex = 0;

function closeAskModePicker() {
  if (!askModePicker) return;
  askModePicker.hidden = true;
  askInputBox?.setAttribute("aria-expanded", "false");
  askModePickerStart = -1;
  askModePickerEnd = -1;
  askModePickerOptions = [];
  askModePickerIndex = 0;
}

function updateAskModePicker() {
  if (!askModePicker || !askInputBox || askInputBox.selectionStart !== askInputBox.selectionEnd) {
    closeAskModePicker();
    return;
  }

  const caret = askInputBox.selectionStart;
  const beforeCaret = askInputBox.value.slice(0, caret);
  const atIndex = beforeCaret.lastIndexOf("@");
  if (atIndex < 0 || (atIndex > 0 && !/\s/.test(beforeCaret[atIndex - 1]))) {
    closeAskModePicker();
    return;
  }

  const query = beforeCaret.slice(atIndex + 1);
  if (/\s/.test(query)) {
    closeAskModePicker();
    return;
  }

  askModePickerStart = atIndex;
  askModePickerEnd = caret;
  const allOptions = Array.from(askModePicker.querySelectorAll(".ask-mode-option"));
  allOptions.forEach(option => { option.hidden = true; });
  askModePickerOptions = allOptions
    .filter(option => option.textContent.trim().toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  if (!askModePickerOptions.length) {
    closeAskModePicker();
    return;
  }

  askModePickerIndex = 0;
  askModePickerOptions.forEach((option, index) => {
    option.hidden = false;
    option.setAttribute("aria-selected", String(index === askModePickerIndex));
  });
  askModePicker.hidden = false;
  askInputBox.setAttribute("aria-expanded", "true");
}

function selectAskMode(option) {
  if (!askInputBox || !option) return;
  currentAskTask = option.getAttribute("data-task") || currentAskTask;
  if (askPromptChipsWrap) {
    askPromptChipsWrap.querySelectorAll(".prompt-chip").forEach(chip => {
      chip.classList.toggle("active", chip.getAttribute("data-task") === currentAskTask);
    });
  }

  if (askModePickerStart >= 0 && askModePickerEnd >= askModePickerStart) {
    askInputBox.value = askInputBox.value.slice(0, askModePickerStart) + askInputBox.value.slice(askModePickerEnd);
    askInputBox.setSelectionRange(askModePickerStart, askModePickerStart);
    resizeAskInputBox();
    updateAskCharCount();
  }
  closeAskModePicker();
  askInputBox.focus();
}

if (askModePicker) {
  askModePicker.addEventListener("click", event => {
    const option = event.target.closest(".ask-mode-option");
    if (option && !option.hidden) selectAskMode(option);
  });
}

if (askPromptChipsWrap) {
  askPromptChipsWrap.addEventListener("click", (e) => {
    const chip = e.target.closest(".prompt-chip");
    if (!chip) return;
    const task = chip.getAttribute("data-task");
    if (!task) return;
    currentAskTask = task;
    askPromptChipsWrap.querySelectorAll(".prompt-chip").forEach(c => {
      c.classList.toggle("active", c === chip);
    });
  });
}

if (btnCtxSolve) {
  btnCtxSolve.addEventListener("click", () => {
    sendAskQuery("answer_question", activeAskContext.text);
  });
}
if (btnCtxGrammar) {
  btnCtxGrammar.addEventListener("click", () => {
    sendAskQuery("explain_grammar", activeAskContext.text);
  });
}
if (btnCtxTranslate) {
  btnCtxTranslate.addEventListener("click", () => {
    sendAskQuery("translate", activeAskContext.text);
  });
}
if (btnDismissContext) {
  btnDismissContext.addEventListener("click", () => {
    clearAskContext();
  });
}

if (btnAskNewChat) {
  btnAskNewChat.addEventListener("click", () => {
    askChatHistory = [];
    if (askChatStream) {
      askChatStream.innerHTML = `
        <div class="ask-empty-state" id="ask-empty-state">
          <div class="ask-empty-title">Ask about Japanese</div>
          <div class="ask-empty-subtitle">Select text on page, use video subtitles, or paste an MCQ to get step-by-step explanations.</div>
        </div>
      `;
    }
    clearAskContext();
    if (askInputBox) {
      askInputBox.value = "";
      resizeAskInputBox();
      updateAskCharCount();
      askInputBox.focus();
    }
  });
}

if (askInputBox) {
  resizeAskInputBox();
  askInputBox.addEventListener("input", () => {
    resizeAskInputBox();
    updateAskCharCount();
    updateAskModePicker();
  });
  askInputBox.addEventListener("keydown", (e) => {
    if (!askModePicker?.hidden) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const direction = e.key === "ArrowDown" ? 1 : -1;
        askModePickerIndex = (askModePickerIndex + direction + askModePickerOptions.length) % askModePickerOptions.length;
        askModePickerOptions.forEach((option, index) => {
          option.setAttribute("aria-selected", String(index === askModePickerIndex));
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectAskMode(askModePickerOptions[askModePickerIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeAskModePicker();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAskQuery();
    }
  });
}

if (btnAskSubmit) {
  btnAskSubmit.addEventListener("click", () => {
    sendAskQuery();
  });
}

initAskResponseMode();

loadAutoCapturePreferences();
loadRecentSubsPreferences();
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
    setAskContext,
    clearAskContext,
    formatAIResponse,
    getAskChatHistory: () => askChatHistory,
    setAskChatHistory: (h) => { askChatHistory = h; },
    getAskResponseMode: () => currentAskResponseMode,
    setAskResponseMode,
    getCurrentAskTask: () => currentAskTask,
    setCurrentAskTask: (t) => { currentAskTask = t; },
  };
}

