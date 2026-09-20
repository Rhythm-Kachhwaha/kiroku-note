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

const toggle = document.querySelector("#mining-toggle");
const ocrCaptureBtn = document.querySelector("#ocr-capture-btn");
const mode = document.querySelector("#mode");
const sessionCountEl = document.querySelector("#session-count");
const status = document.querySelector("#capture-status");
const saveBadge = document.querySelector("#save-badge");
const expression = document.querySelector("#expression");
const reading = document.querySelector("#reading");
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
const ankiSyncStatus = document.querySelector("#anki-sync-status");

// Card preview elements
const cardPreviewSection = document.querySelector("#card-preview-section");
const cardPreviewContainer = document.querySelector("#card-preview-container");
const cardPreviewCard = document.querySelector("#card-preview-card");
const previewTabFront = document.querySelector("#preview-tab-front");
const previewTabBack = document.querySelector("#preview-tab-back");

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
  "preview",
  "fields",
  "media",
  "settings",
  "optional",
  "dictionary"
];

const SECTION_METADATA = {
  preview: { id: "preview", name: "Card Preview" },
  fields: { id: "fields", name: "Card Fields" },
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
const settingBackReading = document.querySelector("#setting-back-reading");
const settingBackMeaning = document.querySelector("#setting-back-meaning");
const settingShowJlpt = document.querySelector("#setting-show-jlpt");

const STORAGE_KEY_CARD_TEMPLATE_SETTINGS = "kiroku.card_template_settings";
const STORAGE_KEY_SHOW_JLPT_LEVEL = "kiroku.settings.showJlptLevel";
const DEFAULT_CARD_TEMPLATE_SETTINGS = {
  front: {
    show_reading: false,
    show_meaning: false,
    show_kanji_reading: false,
  },
  back: {
    show_reading: true,
    show_meaning: true,
  },
  show_jlpt: true,
};
let currentCardTemplateSettings = JSON.parse(JSON.stringify(DEFAULT_CARD_TEMPLATE_SETTINGS));

async function loadStoredCardTemplateSettings() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get([STORAGE_KEY_CARD_TEMPLATE_SETTINGS, STORAGE_KEY_SHOW_JLPT_LEVEL]);
      if (data && data[STORAGE_KEY_CARD_TEMPLATE_SETTINGS]) {
        currentCardTemplateSettings = {
          front: { ...DEFAULT_CARD_TEMPLATE_SETTINGS.front, ...(data[STORAGE_KEY_CARD_TEMPLATE_SETTINGS].front || {}) },
          back: { ...DEFAULT_CARD_TEMPLATE_SETTINGS.back, ...(data[STORAGE_KEY_CARD_TEMPLATE_SETTINGS].back || {}) },
          show_jlpt: typeof data[STORAGE_KEY_CARD_TEMPLATE_SETTINGS].show_jlpt === "boolean"
            ? data[STORAGE_KEY_CARD_TEMPLATE_SETTINGS].show_jlpt
            : (typeof data[STORAGE_KEY_SHOW_JLPT_LEVEL] === "boolean" ? data[STORAGE_KEY_SHOW_JLPT_LEVEL] : true),
        };
      } else if (data && typeof data[STORAGE_KEY_SHOW_JLPT_LEVEL] === "boolean") {
        currentCardTemplateSettings.show_jlpt = data[STORAGE_KEY_SHOW_JLPT_LEVEL];
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY_CARD_TEMPLATE_SETTINGS);
      const storedJlpt = localStorage.getItem(STORAGE_KEY_SHOW_JLPT_LEVEL);
      if (stored) {
        const parsed = JSON.parse(stored);
        currentCardTemplateSettings = {
          front: { ...DEFAULT_CARD_TEMPLATE_SETTINGS.front, ...(parsed.front || {}) },
          back: { ...DEFAULT_CARD_TEMPLATE_SETTINGS.back, ...(parsed.back || {}) },
          show_jlpt: typeof parsed.show_jlpt === "boolean"
            ? parsed.show_jlpt
            : (storedJlpt !== null ? JSON.parse(storedJlpt) : true),
        };
      } else if (storedJlpt !== null) {
        currentCardTemplateSettings.show_jlpt = JSON.parse(storedJlpt);
      }
    }
  } catch (err) {
    console.warn("Failed to load stored card template settings:", err);
  }
  syncCardTemplateSettingsUI();
}

async function saveStoredCardTemplateSettings() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({
        [STORAGE_KEY_CARD_TEMPLATE_SETTINGS]: currentCardTemplateSettings,
        [STORAGE_KEY_SHOW_JLPT_LEVEL]: currentCardTemplateSettings.show_jlpt !== false,
      });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_CARD_TEMPLATE_SETTINGS, JSON.stringify(currentCardTemplateSettings));
      localStorage.setItem(STORAGE_KEY_SHOW_JLPT_LEVEL, JSON.stringify(currentCardTemplateSettings.show_jlpt !== false));
    }
  } catch (err) {
    console.warn("Failed to save card template settings:", err);
  }
  if (typeof updateCardPreview === "function") {
    updateCardPreview();
  }
}

function syncCardTemplateSettingsUI() {
  if (settingFrontReading) settingFrontReading.checked = Boolean(currentCardTemplateSettings?.front?.show_reading);
  if (settingFrontMeaning) settingFrontMeaning.checked = Boolean(currentCardTemplateSettings?.front?.show_meaning);
  if (settingFrontKanjiReading) settingFrontKanjiReading.checked = Boolean(currentCardTemplateSettings?.front?.show_kanji_reading);
  if (settingBackReading) settingBackReading.checked = currentCardTemplateSettings?.back?.show_reading !== false;
  if (settingBackMeaning) settingBackMeaning.checked = currentCardTemplateSettings?.back?.show_meaning !== false;
  if (settingShowJlpt) settingShowJlpt.checked = currentCardTemplateSettings?.show_jlpt !== false;
}

[
  { el: settingFrontReading, section: "front", key: "show_reading" },
  { el: settingFrontMeaning, section: "front", key: "show_meaning" },
  { el: settingFrontKanjiReading, section: "front", key: "show_kanji_reading" },
  { el: settingBackReading, section: "back", key: "show_reading" },
  { el: settingBackMeaning, section: "back", key: "show_meaning" },
].forEach(({ el, section, key }) => {
  if (el) {
    el.addEventListener("change", () => {
      if (!currentCardTemplateSettings[section]) currentCardTemplateSettings[section] = {};
      currentCardTemplateSettings[section][key] = el.checked;
      saveStoredCardTemplateSettings();
    });
  }
});

if (settingShowJlpt) {
  settingShowJlpt.addEventListener("change", () => {
    currentCardTemplateSettings.show_jlpt = settingShowJlpt.checked;
    saveStoredCardTemplateSettings();
  });
}

let currentCardSectionOrder = [...DEFAULT_CARD_SECTION_ORDER];
let draggedSectionIndex = null;

// History & Card Library elements
const historySection = document.querySelector("#history-section");
const historyCount = document.querySelector("#history-count");
const historySearchInput = document.querySelector("#history-search-input");
const historyDeckFilter = document.querySelector("#history-deck-filter");
const historySyncFilter = document.querySelector("#history-sync-filter");
const historyListContainer = document.querySelector("#history-list-container");
const historyEmpty = document.querySelector("#history-empty");
const historyCardsList = document.querySelector("#history-cards-list");
const btnSyncAll = document.querySelector("#btn-sync-all");
const syncAllStatus = document.querySelector("#sync-all-status");



// Navigation tab elements
const tabBtnText = document.querySelector("#tab-btn-text");
const tabBtnVideo = document.querySelector("#tab-btn-video");
const textMiningView = document.querySelector("#text-mining-view");
const videoMiningView = document.querySelector("#video-mining-view");

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
const toggleAutoCaptureFrame = document.querySelector("#toggle-auto-capture-frame");
const toggleAutoCaptureAudio = document.querySelector("#toggle-auto-capture-audio");

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
let lastCaptureSource = { tabId: null, frameId: null };
let currentActiveCue = null;

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

async function loadDecks() {
  try {
    setIndicatorStatus(indicatorAnki, "checking", "Anki: Checking connection…");
    const res = await fetch(API_ANKI_DECKS_URL);
    const data = await res.json().catch(() => ({}));
    ankiConnected = Boolean(data.connected);
    const decks = Array.isArray(data.decks) && data.decks.length ? data.decks : ["Default"];

    if (ankiConnected) {
      setIndicatorStatus(indicatorAnki, "connected", "Anki: Connected");
      if (ankiSyncStatus && ankiSyncStatus.textContent === "Anki: Not connected") {
        ankiSyncStatus.textContent = "Anki: Ready";
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

      const targetDeck = currentSelected || lastDeck || "Default";
      if (decks.includes(targetDeck)) {
        fieldDeckSelect.value = targetDeck;
      }
      if (fieldDeckName) fieldDeckName.value = fieldDeckSelect.value;
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

      const targetModel = currentSelected || preferredModel || models[0] || "Basic";
      if (models.includes(targetModel)) {
        fieldModelSelect.value = targetModel;
      }
      if (fieldModelName) fieldModelName.value = fieldModelSelect.value;
      loadModelCapabilities(fieldModelSelect.value).catch(() => {});
    }
  } catch (_) {
    if (fieldModelSelect && !fieldModelSelect.options.length) {
      const opt = document.createElement("option");
      opt.value = "Basic";
      opt.textContent = "Basic";
      fieldModelSelect.append(opt);
    }
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
    if (fieldDeckName) fieldDeckName.value = val;
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
    scheduleDuplicateCheck(false);
  });
  fieldDeckName.addEventListener("change", () => {
    scheduleDuplicateCheck(true);
  });
}

if (fieldModelSelect) {
  fieldModelSelect.addEventListener("change", () => {
    const val = fieldModelSelect.value;
    if (fieldModelName) fieldModelName.value = val;
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

// Keep live hero display synced as user edits expression or reading
if (fieldExpression) {
  fieldExpression.addEventListener("input", () => {
    if (expression) expression.textContent = fieldExpression.value || "—";
    scheduleDuplicateCheck(false);
  });
  fieldExpression.addEventListener("change", () => {
    scheduleDuplicateCheck(true);
  });
}

if (fieldReading) {
  fieldReading.addEventListener("input", () => {
    if (reading) reading.textContent = fieldReading.value || "";
    scheduleDuplicateCheck(false);
  });
  fieldReading.addEventListener("change", () => {
    scheduleDuplicateCheck(true);
  });
}

// ==========================================================================
// Card Preview (Stage 5.4)
// ==========================================================================
var currentPreviewSide = "back"; // "front" | "back"
var previewUpdateTimer = null;
var currentJlptLevel = null;

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
    entries: (typeof currentDictionaryEntries !== "undefined" && Array.isArray(currentDictionaryEntries)) ? currentDictionaryEntries : [],
    kanji_entries: (typeof currentKanjiEntries !== "undefined" && Array.isArray(currentKanjiEntries)) ? currentKanjiEntries : [],
    kanji_readings: kanjiReadings,
    template_settings: currentCardTemplateSettings,
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

    if (data.hint) {
      const hintDiv = document.createElement("div");
      hintDiv.className = "kn-hint";
      hintDiv.textContent = `Hint: ${data.hint}`;
      if (hintDiv.style) hintDiv.style.textAlign = "center";
      container.append(hintDiv);
    }
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
      if (typeof renderRubyText === "function") {
        renderRubyText(jaP, data.example_sentence);
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
  if (data.hint) {
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
}

function updateCardPreview() {
  if (!cardPreviewCard) return;
  const data = getCardPreviewData();
  renderCardPreviewDOM(cardPreviewCard, data, currentPreviewSide);
}

if (previewTabFront) {
  previewTabFront.addEventListener("click", () => setPreviewSide("front"));
}
if (previewTabBack) {
  previewTabBack.addEventListener("click", () => setPreviewSide("back"));
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
  if (sessionCountEl) {
    sessionCountEl.textContent = `Cards this session: ${sessionCardCount}`;
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
  toggle.setAttribute("aria-pressed", String(enabled));
  toggle.textContent = enabled ? "Stop mining" : "Start mining";
  mode.textContent = enabled
    ? "Mining mode is on. Select Japanese text on the page."
    : "Mining mode is off.";
}

async function setMiningMode(enabled) {
  updateMiningUI(enabled);
  let streamId = null;
  if (enabled && typeof chrome !== "undefined" && chrome.tabCapture?.getMediaStreamId && chrome.tabs?.query) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id) {
        streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      }
    } catch (_) {}
  }
  const result = await chrome.runtime.sendMessage({type: "SET_MINING_MODE", enabled, streamId});
  if (!result?.ok) {
    setStatus(result?.error || "Capture setup failed.", true);
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

function renderRubyText(container, text, rubyText) {
  const source = rubyText || text || "";
  if (!source) return;

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
        const rubyEl = document.createElement("ruby");
        rubyEl.append(document.createTextNode(match[1]));
        const rtEl = document.createElement("rt");
        rtEl.textContent = match[2];
        rubyEl.append(rtEl);
        container.append(rubyEl);
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
        const rubyEl = document.createElement("ruby");
        rubyEl.append(document.createTextNode(match[1]));
        const rtEl = document.createElement("rt");
        rtEl.textContent = match[2];
        rubyEl.append(rtEl);
        container.append(rubyEl);
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

  if (optionalFields && optionalFields.hidden) {
    optionalFields.hidden = false;
    if (toggleOptionalBtn) {
      toggleOptionalBtn.textContent = "Hide optional fields";
    }
  }

  if (btn) {
    btn.textContent = "Inserted!";
    btn.classList.add("inserted");
    setTimeout(() => {
      btn.textContent = "Insert";
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
  metaDiv.className = "study-sense-meta";

  sensePosList.forEach(pos => {
    if (pos && String(pos).trim()) {
      const posSpan = document.createElement("span");
      posSpan.className = "study-sense-pos study-pos-badge pos-tag";
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
    const details = document.createElement("details");
    details.className = "study-examples-accordion";

    const summary = document.createElement("summary");
    summary.className = "study-examples-summary";
    summary.textContent = `Examples (${sense.examples.length})`;
    details.append(summary);

    const listDiv = document.createElement("div");
    listDiv.className = "study-examples-list";

    sense.examples.forEach(eg => {
      if (eg && (eg.japanese || eg.reading)) {
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
        insertExampleBtn.className = "btn-dict-insert btn-example-insert";
        insertExampleBtn.type = "button";
        insertExampleBtn.textContent = "Insert";
        insertExampleBtn.title = "Insert this example into card";
        insertExampleBtn.onclick = (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          insertExampleToCard(eg.japanese || "", eg.translation || "", insertExampleBtn);
        };
        card.append(insertExampleBtn);

        listDiv.append(card);
      }
    });

    details.append(listDiv);
    bodyDiv.append(details);
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

    if (onyomi.length || kunyomi.length || nanori.length) {
      const readingsDiv = document.createElement("div");
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

      card.append(readingsDiv);
    }

    // Meanings
    const meanings = Array.isArray(kanji.meanings) ? kanji.meanings.filter(Boolean) : [];
    if (meanings.length) {
      const meanDiv = document.createElement("div");
      meanDiv.className = "kn-kanji-meanings";
      meanDiv.textContent = meanings.join(", ");
      card.append(meanDiv);
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

  // Stats pills
  if (kanji.stats) {
    if (kanji.stats.strokes) {
      const strokePill = document.createElement("span");
      strokePill.className = "badge kanji-stat-badge";
      strokePill.textContent = `${kanji.stats.strokes} strokes`;
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
  return card;
}

function renderDetails(body) {
  clearDictionaryView();
  const rawObj = body?.term || body;
  const entries = Array.isArray(rawObj?.entries) ? rawObj.entries : [];
  const kanjiEntries = Array.isArray(rawObj?.kanji_entries) ? rawObj.kanji_entries : [];
  currentDictionaryEntries = entries;
  currentKanjiEntries = kanjiEntries;

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
      if (jlptLevel && expr) {
        if (typeof dictEmptyNotice.replaceChildren === "function") {
          dictEmptyNotice.replaceChildren();
        } else {
          dictEmptyNotice.textContent = "";
        }
        const noticeP = document.createElement("p");
        noticeP.textContent = "No Yomitan dictionary definitions found for this term.";
        noticeP.style.margin = "0 0 6px 0";
        const badgeRow = document.createElement("div");
        badgeRow.className = "dict-empty-jlpt-row";
        const badge = document.createElement("span");
        badge.className = "kn-tag kn-jlpt";
        badge.textContent = formatJlptLevel(jlptLevel);
        badgeRow.append(badge);
        dictEmptyNotice.append(noticeP, badgeRow);
      } else {
        dictEmptyNotice.textContent = "No dictionary entries found for this term.";
      }
      dictEmptyNotice.hidden = false;
    }
    return;
  }
  if (typeof dictEmptyNotice !== "undefined" && dictEmptyNotice) dictEmptyNotice.hidden = true;

  if (dictActionsBar) dictActionsBar.style.display = "flex";

  const isSingleKanji = kanjiEntries.length > 0 && (entries.length === 0 || expr.length === 1);

  // 1. Structured Study View rendered into #meanings
  if (meanings) {
    // For single isolated kanji, render prominent kanji card at the top
    if (isSingleKanji) {
      kanjiEntries.forEach(k => {
        meanings.append(renderKanjiCard(k, { mode: "full", isProminent: true }));
      });
    }

    if (entries.length) {
      const primaryEntry = entries.find(e => e.is_primary) || entries[0];

      entries.forEach((entry, entryIdx) => {
        const isPrimary = Boolean(entry.is_primary || entry === primaryEntry);

        // Entry Container
        const entryContainer = document.createElement("div");
        entryContainer.className = "study-entry";

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
        if (isPrimary && entryIdx === 0 && entries.length > 1) {
          const moreCount = entries.length - 1;
          const countPill = document.createElement("span");
          countPill.className = "dict-count-pill";
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

        entryContainer.append(header);

        // Senses list for this entry with Progressive Disclosure
        const senses = Array.isArray(entry.senses) ? entry.senses : [];
        if (senses.length) {
          const PRIMARY_SENSES_LIMIT = 4;
          const primarySenses = senses.slice(0, PRIMARY_SENSES_LIMIT);
          const overflowSenses = senses.slice(PRIMARY_SENSES_LIMIT);

          const ol = document.createElement("ol");
          ol.className = "study-senses-list";

          primarySenses.forEach((sense, sIdx) => {
            ol.append(renderStudySenseItem(sense, sIdx, entry, senses.length));
          });

          entryContainer.append(ol);

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
            entryContainer.append(details);
          }
        }

        meanings.append(entryContainer);
      });
    }

    // For multi-character vocabulary, render kanji entries in a collapsible accordion below term definitions
    if (!isSingleKanji && kanjiEntries.length > 0) {
      const kanjiAccordion = document.createElement("details");
      kanjiAccordion.className = "study-kanji-accordion";

      const summary = document.createElement("summary");
      summary.className = "study-kanji-summary";
      summary.textContent = `Kanji in this word (${kanjiEntries.length})`;
      kanjiAccordion.append(summary);

      const kanjiListDiv = document.createElement("div");
      kanjiListDiv.className = "study-kanji-list";
      kanjiEntries.forEach(k => {
        kanjiListDiv.append(renderKanjiCard(k, { mode: "full", isProminent: false }));
      });
      kanjiAccordion.append(kanjiListDiv);

      meanings.append(kanjiAccordion);
    }
  }
}

if (btnCopyRawDict) {
  btnCopyRawDict.addEventListener("click", async () => {
    const rawText = formatRawDictionaryText(currentDictionaryEntries, currentKanjiEntries);
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

async function identify(text) {
  const capturedText = typeof text === "string" ? text.trim() : "";
  if (!capturedText) return;
  const requestId = ++currentCaptureId;
  setStatus("Identifying selection…");
  setIndicatorStatus(indicatorYomitan, "checking", "Yomitan: Identifying…");
  if (saveBadge) {
    saveBadge.hidden = true;
    saveBadge.className = "badge";
    saveBadge.textContent = "";
  }
  expression.textContent = "—";
  reading.textContent = "";
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

    // Populate prominent hero elements
    expression.textContent = body.expression || "—";
    reading.textContent = body.reading || "";
    if (body.jlpt_level) {
      currentJlptLevel = body.jlpt_level;
    }
    renderDetails(body);

    // Populate Card Editor form
    if (cardEditor) {
      cardEditor.hidden = false;
      if (fieldCardId) fieldCardId.value = body.id || "";
      if (fieldDeckSelect && body.deck_name) {
        fieldDeckSelect.value = body.deck_name;
      }
      if (fieldDeckName) fieldDeckName.value = (fieldDeckSelect && fieldDeckSelect.value) || body.deck_name || "Default";
      if (fieldModelSelect && body.model_name) {
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
      if (fieldSourceText) fieldSourceText.value = body.source_text || "";
      if (fieldDeinflectedText) fieldDeinflectedText.value = body.deinflected_text || "";
      if (fieldExpression) fieldExpression.value = body.expression || "";
      if (fieldReading) fieldReading.value = body.reading || "";
      if (fieldMeaning) fieldMeaning.value = body.meaning || "";
      if (fieldHint) fieldHint.value = body.hint || "";
      if (fieldExampleSentence) fieldExampleSentence.value = body.example_sentence || "";
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

      // Automatically trigger frame screenshot and sentence audio if enabled and media is not already saved.
      const shouldAutoCaptureFrame = toggleAutoCaptureFrame ? toggleAutoCaptureFrame.checked : true;
      const shouldAutoCaptureAudio = toggleAutoCaptureAudio ? toggleAutoCaptureAudio.checked : true;

      if (!body.image && shouldAutoCaptureFrame && isVideoMiningActive()) {
        retakeScreenshot(requestId);
      }

      if (!body.audio && shouldAutoCaptureAudio && isVideoMiningActive()) {
        currentDraftMedia.audioStatus = "pending";
        currentDraftMedia.captureId = requestId;
        updateMediaPreviews();
        retakeAudio(requestId);
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

    if (saveBadge) {
      if (body.is_duplicate) {
        saveBadge.textContent = "ALREADY SAVED";
        saveBadge.className = "badge already-saved";
        saveBadge.hidden = false;
        setStatus(body.dictionary_error || "Card already saved.");
      } else {
        saveBadge.hidden = true;
        saveBadge.textContent = "";
        setStatus(body.dictionary_error || "Card draft ready. Edit and save.");
      }
    } else {
      setStatus(body.dictionary_error || "Capture identified.", Boolean(body.dictionary_error));
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
    if (dictEmptyNotice) dictEmptyNotice.hidden = false;
    if (saveBadge) saveBadge.hidden = true;
    setIndicatorStatus(indicatorYomitan, "unavailable", "Yomitan: Unavailable");
    setStatus(formatErrorMessage(error), true);
  }
}

// Media preview management
function isVideoMiningActive() {
  if (videoMiningView && !videoMiningView.hidden) return true;
  if (tabBtnVideo && tabBtnVideo.classList.contains("active")) return true;
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

function retakeScreenshot(captureId = null) {
  setStatus("Capturing video frame screenshot…");
  const capId = captureId || currentCaptureId;
  broadcastToActiveVideo({
    type: "TRIGGER_VIDEO_SCREENSHOT",
    options: {
      captureId: capId,
      maxWidth: 640,
      maxHeight: 360,
      quality: 0.92
    }
  });
}

function retakeAudio(captureId = null) {
  setStatus("Recording sentence audio…");
  const capId = captureId || currentCaptureId;
  broadcastToActiveVideo({
    type: "TRIGGER_AUDIO_RECORDING",
    cue: typeof currentActiveCue !== "undefined" ? currentActiveCue : null,
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
if (toggleOptionalBtn && optionalFields) {
  toggleOptionalBtn.addEventListener("click", () => {
    const isExpanded = !optionalFields.hidden;
    optionalFields.hidden = isExpanded;
    toggleOptionalBtn.setAttribute("aria-expanded", String(!isExpanded));
    toggleOptionalBtn.textContent = isExpanded ? "+ Optional fields" : "- Optional fields";
  });
}

// Duplicate prevention and deck-scoped saved state management
var duplicateCheckTimer = null;
var duplicateCheckRequestId = 0;

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
    if (saveBadge) {
      saveBadge.hidden = true;
      saveBadge.textContent = "";
      saveBadge.className = "badge";
    }
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
      if (saveBadge) {
        saveBadge.textContent = "ALREADY SAVED";
        saveBadge.className = "badge already-saved";
        saveBadge.hidden = false;
      }
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
      if (saveBadge) {
        saveBadge.hidden = true;
        saveBadge.textContent = "";
        saveBadge.className = "badge";
      }
      setStatus("Card draft ready. Edit and save.");
      updateSyncUI(ankiConnected ? "ready" : "not_connected");
    }
    if (typeof scheduleCardPreviewUpdate === "function") scheduleCardPreviewUpdate();
  } catch (err) {
    // Fail-soft: if network or backend error occurs, do not block UI
  }
}

// Card save form submission
if (cardEditor) {
  cardEditor.addEventListener("submit", async event => {
    event.preventDefault();
    const expr = fieldExpression ? fieldExpression.value.trim() : "";
    if (!expr) {
      setStatus("Expression must not be empty.", true);
      return;
    }

    saveCardBtn.disabled = true;
    saveCardBtn.textContent = "Saving…";

    const targetDeck = (fieldDeckSelect && fieldDeckSelect.value.trim()) || (fieldDeckName && fieldDeckName.value.trim()) || "Default";
    const targetModel = (fieldModelSelect && fieldModelSelect.value.trim()) || (fieldModelName && fieldModelName.value.trim()) || "";
    const payload = {
      id: fieldCardId && fieldCardId.value ? parseInt(fieldCardId.value, 10) : null,
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
      card_settings: (typeof currentCardTemplateSettings !== "undefined" ? currentCardTemplateSettings : null),
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

      if (fieldCardId) fieldCardId.value = body.id || "";
      if (body.model_name && fieldModelSelect) {
        fieldModelSelect.value = body.model_name;
        if (fieldModelName) fieldModelName.value = body.model_name;
      }
      if (body.audio) {
        if (fieldAudio) fieldAudio.value = body.audio;
        const audioSrc = body.audio.startsWith("data:") || body.audio.startsWith("http:") || body.audio.startsWith("https:")
          ? body.audio
          : `${BACKEND_BASE_URL}/api/media/${body.audio}`;
        currentDraftMedia.audioBase64 = audioSrc;
        currentDraftMedia.audioStatus = "available";
        currentDraftMedia.audioError = null;
      }
      if (body.image) {
        if (fieldImage) fieldImage.value = body.image;
        const imgSrc = body.image.startsWith("data:") || body.image.startsWith("http:") || body.image.startsWith("https:")
          ? body.image
          : `${BACKEND_BASE_URL}/api/media/${body.image}`;
        currentDraftMedia.imageBase64 = imgSrc;
      }
      updateMediaPreviews();
      if (expression) expression.textContent = body.expression || expr;
      if (reading) reading.textContent = body.reading || "";

      if (body.sync_status === "synced") {
        updateSyncUI("synced");
      } else {
        updateSyncUI("pending");
      }

      if (saveBadge) {
        if (body.is_duplicate) {
          saveBadge.textContent = "ALREADY SAVED";
          saveBadge.className = "badge already-saved";
          saveBadge.hidden = false;
          setStatus("Card already saved.");
        } else {
          saveBadge.textContent = "SAVED";
          saveBadge.className = "badge saved";
          saveBadge.hidden = false;
          setStatus(body.is_updated ? "Card updated." : "Card saved.");
          if (body.is_new) {
            sessionCardCount++;
            updateSessionCounter();
          }
        }
      }
      isCardDraftDirtyState = false;
      selectedHistoryCardId = body.id || null;
      loadHistory().catch(() => {});
    } catch (error) {
      setStatus(`Save failed: ${formatErrorMessage(error)}`, true);
    } finally {
      saveCardBtn.disabled = false;
      saveCardBtn.textContent = "Save Card";
    }
  });

  cardEditor.addEventListener("input", () => {
    isCardDraftDirtyState = true;
  });
}

async function triggerAnkiSync() {
  const cardId = fieldCardId && fieldCardId.value ? parseInt(fieldCardId.value, 10) : null;
  if (!cardId) {
    setStatus("Save card before sending to Anki.", true);
    return;
  }

  updateSyncUI("syncing");
  try {
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

// Sync All action for eligible unsynced/retryable cards
let isSyncAllRunning = false;

async function triggerSyncAll() {
  if (isSyncAllRunning) return;
  isSyncAllRunning = true;

  if (btnSyncAll) {
    btnSyncAll.disabled = true;
    btnSyncAll.classList.add("syncing");
    btnSyncAll.textContent = "Syncing…";
  }
  if (syncAllStatus) {
    syncAllStatus.hidden = false;
    syncAllStatus.className = "sync-all-status";
    syncAllStatus.textContent = "Checking Anki & syncing cards…";
  }

  try {
    const response = await fetch(API_CARD_SYNC_ALL_URL, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.error) {
      const errMsg = body.error || body.detail || "Sync All failed";
      if (syncAllStatus) {
        syncAllStatus.hidden = false;
        syncAllStatus.className = "sync-all-status failed";
        syncAllStatus.textContent = `⚠ ${errMsg}`;
      }
      setStatus(`Sync All failed: ${errMsg}`, true);
      await loadHistory().catch(() => {});
      return;
    }

    const { total_eligible = 0, synced_count = 0, failed_count = 0 } = body;
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

    await loadHistory().catch(() => {});
  } catch (error) {
    const msg = formatErrorMessage(error);
    if (syncAllStatus) {
      syncAllStatus.hidden = false;
      syncAllStatus.className = "sync-all-status failed";
      syncAllStatus.textContent = `⚠ Sync All failed: ${msg}`;
    }
    setStatus(`Sync All failed: ${msg}`, true);
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
  btnSyncAll.addEventListener("click", triggerSyncAll);
}


// Keyboard shortcuts
document.addEventListener("keydown", event => {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? event.metaKey : event.ctrlKey;

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
    if (optionalFields && !optionalFields.hidden) {
      optionalFields.hidden = true;
      if (toggleOptionalBtn) {
        toggleOptionalBtn.setAttribute("aria-expanded", "false");
        toggleOptionalBtn.textContent = "+ Optional fields";
        toggleOptionalBtn.focus();
      }
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

    if (historyCount) {
      historyCount.textContent = `${total} card${total === 1 ? "" : "s"}`;
    }

    if (cards.length === 0) {
      historyCardsList.replaceChildren();
      if (historyEmpty) {
        historyEmpty.hidden = false;
        historyEmpty.textContent = search || deck !== "all" || syncStatus !== "all" ? "No matching cards found." : "No saved cards yet.";
      }
    } else {
      if (historyEmpty) historyEmpty.hidden = true;
      renderHistoryCards(cards);
    }

    updateDeckFilterOptions(cards);
  } catch (err) {
    if (historyEmpty) {
      historyEmpty.hidden = false;
      historyEmpty.textContent = "Failed to load history.";
    }
  }
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
}

function renderHistoryCards(cards) {
  if (!historyCardsList) return;
  historyCardsList.replaceChildren();

  cards.forEach(card => {
    const item = document.createElement("article");
    item.className = "history-item" + (selectedHistoryCardId === card.id ? " selected" : "");
    item.dataset.cardId = String(card.id);

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

    const syncBadge = document.createElement("span");
    const statusKey = card.sync_status || "pending";
    syncBadge.className = `history-badge sync-${statusKey}`;
    syncBadge.textContent = statusKey.charAt(0).toUpperCase() + statusKey.slice(1);
    meta.append(syncBadge);

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

      if (expression) expression.textContent = body.expression || "—";
      if (reading) reading.textContent = body.reading || "";

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
      }

      if (saveBadge) {
        saveBadge.textContent = "SAVED";
        saveBadge.className = "badge saved";
        saveBadge.hidden = false;
      }
      setStatus("Opened saved card from library.");
      if (typeof scheduleCardPreviewUpdate === "function") scheduleCardPreviewUpdate();
    }
  } catch (err) {
    setStatus(`Failed to open card: ${err.message}`, true);
  }
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

  try {
    const res = await fetch(API_CARD_DETAIL_URL(cardId), { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete card.");

    if (fieldCardId && fieldCardId.value === String(cardId)) {
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
      if (reading) reading.textContent = "";
      clearDictionaryView();
      if (saveBadge) {
        saveBadge.hidden = true;
        saveBadge.textContent = "";
      }
      if (cardEditor) cardEditor.hidden = true;
      updateSyncUI(ankiConnected ? "ready" : "not_connected");
      selectedHistoryCardId = null;
      if (typeof scheduleCardPreviewUpdate === "function") scheduleCardPreviewUpdate();
    }

    setStatus(`Deleted "${cardExpr}" from local database.`);
    await loadHistory();
  } catch (err) {
    setStatus(`Delete failed: ${err.message}`, true);
  }
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

// Initialization
loadFontPreference().catch(() => {});
loadDecks().catch(() => {});
loadModels().catch(() => {});
loadHistory().catch(() => {});
loadTabPreference().catch(() => {});
loadAutoPausePreference().catch(() => {});
loadSubtitleOffsetPreference().catch(() => {});
loadJimakuApiKey().catch(() => {});

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
  if (subtitlesFileStatus) {
    subtitlesFileStatus.textContent = "No subtitles";
    subtitlesFileStatus.classList.remove("active");
    subtitlesFileStatus.title = "";
  }
  if (videoCurrentCuePreview) {
    videoCurrentCuePreview.textContent = "—";
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

function switchMiningTab(targetTab) {
  const isVideo = targetTab === "video";
  if (tabBtnText && tabBtnVideo && textMiningView && videoMiningView) {
    tabBtnText.classList.toggle("active", !isVideo);
    tabBtnText.setAttribute("aria-selected", String(!isVideo));
    tabBtnVideo.classList.toggle("active", isVideo);
    tabBtnVideo.setAttribute("aria-selected", String(isVideo));

    textMiningView.hidden = isVideo;
    videoMiningView.hidden = !isVideo;

    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ active_mining_tab: targetTab });
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem("active_mining_tab", targetTab);
      }
    } catch (_) {}
  }
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

if (tabBtnText) {
  tabBtnText.addEventListener("click", () => switchMiningTab("text"));
}
if (tabBtnVideo) {
  tabBtnVideo.addEventListener("click", () => switchMiningTab("video"));
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

if (loadSubtitlesBtn && subtitlesFileInput) {
  loadSubtitlesBtn.addEventListener("click", () => subtitlesFileInput.click());
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

if (toggleAutoPauseHover) {
  toggleAutoPauseHover.addEventListener("change", (e) => {
    setAutoPausePreference(Boolean(e.target.checked));
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
    }
    identify(message.text);
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
  if (message?.type === "SUBTITLE_CUE_CHANGED") {
    if (message.cue) {
      currentActiveCue = message.cue;
    }
    if (videoCurrentCuePreview) {
      videoCurrentCuePreview.textContent = message.cue?.text || "—";
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
  });
}

/* ==========================================================================
   Layout Settings & Customizable Card Section Reordering
   ========================================================================== */

function resolveValidSectionOrder(savedOrder) {
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
    return resolved;
  } catch (_) {
    currentCardSectionOrder = [...DEFAULT_CARD_SECTION_ORDER];
    return currentCardSectionOrder;
  }
}

async function saveStoredSectionOrder(order) {
  const validated = resolveValidSectionOrder(order);
  currentCardSectionOrder = validated;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER]: validated });
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER, JSON.stringify(validated));
    }
  } catch (_) {}
  return validated;
}

function applySectionOrder(order) {
  const validated = resolveValidSectionOrder(order);
  currentCardSectionOrder = validated;
  if (!cardLayoutContainer) return validated;

  for (const sectionId of validated) {
    const sectionEl = cardLayoutContainer.querySelector(`[data-layout-section="${sectionId}"]`);
    if (sectionEl) {
      cardLayoutContainer.appendChild(sectionEl);
    }
  }
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
  if (btnLayoutSettings) {
    btnLayoutSettings.setAttribute("aria-expanded", "true");
    btnLayoutSettings.classList.add("active");
  }
  syncCardTemplateSettingsUI();
  renderLayoutSettingsList(currentCardSectionOrder);
}

function closeLayoutSettings() {
  const popover = cardSettingsPopover || layoutSettingsPopover;
  if (!popover) return;
  popover.hidden = true;
  if (btnLayoutSettings) {
    btnLayoutSettings.setAttribute("aria-expanded", "false");
    btnLayoutSettings.classList.remove("active");
    btnLayoutSettings.focus();
  }
}

async function resetLayoutSettings() {
  const defaultOrder = [...DEFAULT_CARD_SECTION_ORDER];
  applySectionOrder(defaultOrder);
  await saveStoredSectionOrder(defaultOrder);
  renderLayoutSettingsList(defaultOrder);
}

if (btnLayoutSettings) {
  btnLayoutSettings.addEventListener("click", (e) => {
    e.stopPropagation();
    const popover = cardSettingsPopover || layoutSettingsPopover;
    if (popover && !popover.hidden) {
      closeLayoutSettings();
    } else {
      openLayoutSettings();
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
  const popover = cardSettingsPopover || layoutSettingsPopover;
  if (e.key === "Escape" && popover && !popover.hidden) {
    closeLayoutSettings();
  }
});

document.addEventListener("click", (e) => {
  const popover = cardSettingsPopover || layoutSettingsPopover;
  if (!popover || popover.hidden) return;
  if (!popover.contains(e.target) && btnLayoutSettings && !btnLayoutSettings.contains(e.target)) {
    closeLayoutSettings();
  }
});

if (btnDismissFirstRun) {
  btnDismissFirstRun.addEventListener("click", () => dismissFirstRunGuide());
}

loadAutoCapturePreferences();
loadJimakuApiKey().catch(() => {});
loadSubtitleFolderPreferences().catch(() => {});
checkOcrStatus().catch(() => {});
loadStoredCardTemplateSettings().catch(() => {});
loadStoredSectionOrder().then(order => {
  applySectionOrder(order);
}).catch(() => {});
if (typeof updateCardPreview === "function") updateCardPreview();

chrome.runtime.sendMessage({type: "GET_MINING_MODE"}).then(res => {
  if (res?.enabled) updateMiningUI(true);
}).catch(() => {});

