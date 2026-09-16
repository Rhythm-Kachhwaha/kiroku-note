const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting Frame Capture — Stage 3: Combined Media Card Lifecycle Tests...\n");

// Read sidepanel files
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");

const htmlContent = fs.readFileSync(htmlPath, "utf8");
const cssContent = fs.readFileSync(cssPath, "utf8");
const jsContent = fs.readFileSync(jsPath, "utf8");

function testSidepanelAudioDOMContracts() {
  assert.ok(htmlContent.includes('id="audio-preview-container"'), "audio-preview-container must exist in sidepanel.html");
  assert.ok(htmlContent.includes('id="audio-preview"'), "audio-preview audio element must exist in sidepanel.html");
  assert.ok(htmlContent.includes('id="audio-status-badge"'), "audio-status-badge must exist in sidepanel.html");
  assert.ok(htmlContent.includes('id="btn-replay-audio"'), "btn-replay-audio button must exist in sidepanel.html");
  assert.ok(htmlContent.includes('id="btn-clear-audio"'), "btn-clear-audio button must exist in sidepanel.html");
  assert.ok(htmlContent.includes('id="image-preview-container"'), "image-preview-container must exist in sidepanel.html");
  assert.ok(htmlContent.includes('id="image-preview"'), "image-preview img element must exist in sidepanel.html");
  assert.ok(htmlContent.includes('id="btn-clear-image"'), "btn-clear-image button must exist in sidepanel.html");

  assert.ok(cssContent.includes('.media-status-pill'), "CSS must define .media-status-pill");
  assert.ok(cssContent.includes('.media-status-pill.badge-ready'), "CSS must define .badge-ready");
  assert.ok(cssContent.includes('.media-status-pill.badge-pending'), "CSS must define .badge-pending");
  assert.ok(cssContent.includes('.media-status-pill.badge-unavailable'), "CSS must define .badge-unavailable");

  console.log("PASS: Side Panel Media DOM and CSS contracts verified.");
}

// Helper to create mock DOM elements
function createMockElement(tag, id = "") {
  const classes = new Set();
  const children = [];
  return {
    tagName: tag.toUpperCase(),
    id,
    className: "",
    hidden: false,
    src: "",
    value: "",
    textContent: "",
    title: "",
    paused: false,
    style: {},
    dataset: {},
    options: [],
    children,
    _attributes: {},
    _listeners: {},
    classList: {
      add: (...cls) => { cls.forEach(c => classes.add(c)); },
      remove: (...cls) => { cls.forEach(c => classes.delete(c)); },
      contains: (cls) => classes.has(cls),
      toggle: (cls, force) => {
        if (typeof force === "boolean") {
          if (force) classes.add(cls);
          else classes.delete(cls);
          return force;
        }
        if (classes.has(cls)) { classes.delete(cls); return false; }
        classes.add(cls); return true;
      }
    },
    setAttribute(k, v) { this._attributes[k] = String(v); },
    getAttribute(k) { return this._attributes[k]; },
    removeAttribute(k) {
      delete this._attributes[k];
      if (k === "src") this.src = "";
    },
    append(...els) { children.push(...els); },
    appendChild(el) { children.push(el); return el; },
    replaceChildren(...els) { children.length = 0; if (els.length) children.push(...els); },
    querySelector(sel) {
      if (sel.startsWith("#")) {
        const targetId = sel.slice(1);
        return children.find(c => c.id === targetId) || null;
      }
      return null;
    },
    querySelectorAll() { return []; },
    pause() { this.paused = true; },
    play() { this.paused = false; return Promise.resolve(); },
    addEventListener(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    },
    dispatchEvent(event) {
      const fns = this._listeners[event?.type || event] || [];
      fns.forEach(fn => fn(event));
    }
  };
}

function setupSidepanelContext() {
  const elements = {
    miningToggle: createMockElement("button", "mining-toggle"),
    mode: createMockElement("div", "mode"),
    sessionCount: createMockElement("span", "session-count"),
    status: createMockElement("div", "capture-status"),
    saveBadge: createMockElement("span", "save-badge"),
    expression: createMockElement("div", "expression"),
    reading: createMockElement("div", "reading"),
    meanings: createMockElement("div", "meanings"),
    examples: createMockElement("div", "examples"),
    dictActionsBar: createMockElement("div", "dict-actions-bar"),
    btnCopyRawDict: createMockElement("button", "btn-copy-raw-dict"),
    btnToggleFullDict: createMockElement("button", "btn-toggle-full-dict"),
    dictRawView: createMockElement("div", "dict-raw-view"),
    indicatorYomitan: createMockElement("span", "indicator-yomitan"),
    indicatorAnki: createMockElement("span", "indicator-anki"),
    cardEditor: createMockElement("form", "card-editor"),
    fieldCardId: createMockElement("input", "field-card-id"),
    fieldDeckName: createMockElement("input", "field-deck-name"),
    fieldDeckSelect: createMockElement("select", "field-deck-select"),
    fieldModelName: createMockElement("input", "field-model-name"),
    fieldModelSelect: createMockElement("select", "field-model-select"),
    fieldFontSelect: createMockElement("select", "field-font-select"),
    fieldSourceText: createMockElement("input", "field-source-text"),
    fieldDeinflectedText: createMockElement("input", "field-deinflected-text"),
    fieldExpression: createMockElement("input", "field-expression"),
    fieldReading: createMockElement("input", "field-reading"),
    fieldMeaning: createMockElement("textarea", "field-meaning"),
    toggleOptional: createMockElement("button", "toggle-optional"),
    optionalFields: createMockElement("div", "optional-fields"),
    fieldHint: createMockElement("input", "field-hint"),
    fieldExampleSentence: createMockElement("textarea", "field-example-sentence"),
    fieldExampleTranslation: createMockElement("textarea", "field-example-translation"),
    fieldImage: createMockElement("input", "field-image"),
    fieldAudio: createMockElement("input", "field-audio"),
    fieldTags: createMockElement("input", "field-tags"),
    fieldNotes: createMockElement("textarea", "field-notes"),
    saveCardBtn: createMockElement("button", "save-card-btn"),
    syncAnkiBtn: createMockElement("button", "sync-anki-btn"),
    ankiSyncStatus: createMockElement("span", "anki-sync-status"),
    mediaPreviewContainer: createMockElement("div", "media-preview-container"),
    imagePreviewContainer: createMockElement("div", "image-preview-container"),
    imagePreview: createMockElement("img", "image-preview"),
    imageEmptyPlaceholder: createMockElement("div", "image-empty-placeholder"),
    btnClearImage: createMockElement("button", "btn-clear-image"),
    btnRetakeImage: createMockElement("button", "btn-retake-image"),
    audioPreviewContainer: createMockElement("div", "audio-preview-container"),
    audioPreview: createMockElement("audio", "audio-preview"),
    audioEmptyPlaceholder: createMockElement("div", "audio-empty-placeholder"),
    audioPlaceholderText: createMockElement("span", "audio-placeholder-text"),
    audioStatusBadge: createMockElement("span", "audio-status-badge"),
    btnReplayAudio: createMockElement("button", "btn-replay-audio"),
    btnClearAudio: createMockElement("button", "btn-clear-audio"),
    btnRetakeAudio: createMockElement("button", "btn-retake-audio"),
    historySection: createMockElement("section", "history-section"),
    historyCount: createMockElement("span", "history-count"),
    historySearchInput: createMockElement("input", "history-search-input"),
    historyDeckFilter: createMockElement("select", "history-deck-filter"),
    historySyncFilter: createMockElement("select", "history-sync-filter"),
    historyListContainer: createMockElement("div", "history-list-container"),
    historyEmpty: createMockElement("div", "history-empty"),
    historyCardsList: createMockElement("div", "history-cards-list"),
    tabBtnText: createMockElement("button", "tab-btn-text"),
    tabBtnVideo: createMockElement("button", "tab-btn-video"),
    textMiningView: createMockElement("div", "text-mining-view"),
    videoMiningView: createMockElement("div", "video-mining-view"),
    videoMiningSection: createMockElement("div", "video-mining-section"),
    subtitlesFileStatus: createMockElement("span", "subtitles-file-status"),
    loadSubtitlesBtn: createMockElement("button", "load-subtitles-btn"),
    clearSubtitlesBtn: createMockElement("button", "clear-subtitles-btn"),
    subtitlesFileInput: createMockElement("input", "subtitles-file-input"),
    videoTrackSelect: createMockElement("select", "video-track-select"),
    offsetMinusBtn: createMockElement("button", "offset-minus-btn"),
    offsetResetBtn: createMockElement("button", "offset-reset-btn"),
    offsetPlusBtn: createMockElement("button", "offset-plus-btn"),
    offsetDisplay: createMockElement("span", "offset-display"),
    videoCurrentCuePreview: createMockElement("span", "video-current-cue-preview"),
    toggleAutoPauseHover: createMockElement("input", "toggle-auto-pause-hover"),
    toggleAutoCaptureFrame: createMockElement("input", "toggle-auto-capture-frame"),
    toggleAutoCaptureAudio: createMockElement("input", "toggle-auto-capture-audio"),
  };

  const messageListeners = [];
  const broadcastMessages = [];
  const sentRuntimeMessages = [];

  const mockDocument = {
    querySelector: (sel) => {
      const clean = sel.replace("#", "").replace(/-/g, "_");
      switch (sel) {
        case "#mining-toggle": return elements.miningToggle;
        case "#mode": return elements.mode;
        case "#session-count": return elements.sessionCount;
        case "#capture-status": return elements.status;
        case "#save-badge": return elements.saveBadge;
        case "#expression": return elements.expression;
        case "#reading": return elements.reading;
        case "#meanings": return elements.meanings;
        case "#examples": return elements.examples;
        case "#dict-actions-bar": return elements.dictActionsBar;
        case "#btn-copy-raw-dict": return elements.btnCopyRawDict;
        case "#btn-toggle-full-dict": return elements.btnToggleFullDict;
        case "#dict-raw-view": return elements.dictRawView;
        case "#indicator-yomitan": return elements.indicatorYomitan;
        case "#indicator-anki": return elements.indicatorAnki;
        case "#card-editor": return elements.cardEditor;
        case "#field-card-id": return elements.fieldCardId;
        case "#field-deck-name": return elements.fieldDeckName;
        case "#field-deck-select": return elements.fieldDeckSelect;
        case "#field-model-name": return elements.fieldModelName;
        case "#field-model-select": return elements.fieldModelSelect;
        case "#field-font-select": return elements.fieldFontSelect;
        case "#field-source-text": return elements.fieldSourceText;
        case "#field-deinflected-text": return elements.fieldDeinflectedText;
        case "#field-expression": return elements.fieldExpression;
        case "#field-reading": return elements.fieldReading;
        case "#field-meaning": return elements.fieldMeaning;
        case "#toggle-optional": return elements.toggleOptional;
        case "#optional-fields": return elements.optionalFields;
        case "#field-hint": return elements.fieldHint;
        case "#field-example-sentence": return elements.fieldExampleSentence;
        case "#field-example-translation": return elements.fieldExampleTranslation;
        case "#field-image": return elements.fieldImage;
        case "#field-audio": return elements.fieldAudio;
        case "#field-tags": return elements.fieldTags;
        case "#field-notes": return elements.fieldNotes;
        case "#save-card-btn": return elements.saveCardBtn;
        case "#sync-anki-btn": return elements.syncAnkiBtn;
        case "#anki-sync-status": return elements.ankiSyncStatus;
        case "#media-preview-container": return elements.mediaPreviewContainer;
        case "#image-preview-container": return elements.imagePreviewContainer;
        case "#image-preview": return elements.imagePreview;
        case "#image-empty-placeholder": return elements.imageEmptyPlaceholder;
        case "#btn-clear-image": return elements.btnClearImage;
        case "#btn-retake-image": return elements.btnRetakeImage;
        case "#audio-preview-container": return elements.audioPreviewContainer;
        case "#audio-preview": return elements.audioPreview;
        case "#audio-empty-placeholder": return elements.audioEmptyPlaceholder;
        case "#audio-placeholder-text": return elements.audioPlaceholderText;
        case "#audio-status-badge": return elements.audioStatusBadge;
        case "#btn-replay-audio": return elements.btnReplayAudio;
        case "#btn-clear-audio": return elements.btnClearAudio;
        case "#btn-retake-audio": return elements.btnRetakeAudio;
        case "#history-section": return elements.historySection;
        case "#history-count": return elements.historyCount;
        case "#history-search-input": return elements.historySearchInput;
        case "#history-deck-filter": return elements.historyDeckFilter;
        case "#history-sync-filter": return elements.historySyncFilter;
        case "#history-list-container": return elements.historyListContainer;
        case "#history-empty": return elements.historyEmpty;
        case "#history-cards-list": return elements.historyCardsList;
        case "#tab-btn-text": return elements.tabBtnText;
        case "#tab-btn-video": return elements.tabBtnVideo;
        case "#text-mining-view": return elements.textMiningView;
        case "#video-mining-view": return elements.videoMiningView;
        case "#video-mining-section": return elements.videoMiningSection;
        case "#subtitles-file-status": return elements.subtitlesFileStatus;
        case "#load-subtitles-btn": return elements.loadSubtitlesBtn;
        case "#clear-subtitles-btn": return elements.clearSubtitlesBtn;
        case "#subtitles-file-input": return elements.subtitlesFileInput;
        case "#video-track-select": return elements.videoTrackSelect;
        case "#offset-minus-btn": return elements.offsetMinusBtn;
        case "#offset-reset-btn": return elements.offsetResetBtn;
        case "#offset-plus-btn": return elements.offsetPlusBtn;
        case "#offset-display": return elements.offsetDisplay;
        case "#video-current-cue-preview": return elements.videoCurrentCuePreview;
        case "#toggle-auto-pause-hover": return elements.toggleAutoPauseHover;
        case "#toggle-auto-capture-frame": return elements.toggleAutoCaptureFrame;
        case "#toggle-auto-capture-audio": return elements.toggleAutoCaptureAudio;
        default: return null;
      }
    },
    createElement: (tag) => createMockElement(tag),
    addEventListener: () => {},
    documentElement: { style: { setProperty: () => {} } },
    body: createMockElement("body")
  };

  const mockChrome = {
    runtime: {
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      },
      sendMessage: async (msg) => {
        sentRuntimeMessages.push(msg);
        return { ok: true };
      }
    },
    tabs: {
      query: async () => [{ id: 101 }],
      sendMessage: async (tabId, msg) => {
        broadcastMessages.push({ tabId, ...msg });
        return { ok: true };
      }
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {}
      }
    }
  };

  const mockContext = {
    document: mockDocument,
    chrome: mockChrome,
    window: {
      addEventListener: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      confirm: () => true
    },
    navigator: { platform: "Win32" },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    console
  };
  mockContext.mockContext = mockContext;

  const bridgeCode = `
;
Object.defineProperty(mockContext, 'currentDraftMedia', {
  get: () => currentDraftMedia,
  set: (v) => { Object.assign(currentDraftMedia, v); }
});
Object.defineProperty(mockContext, 'currentCaptureId', {
  get: () => currentCaptureId,
  set: (v) => { currentCaptureId = v; }
});
Object.defineProperty(mockContext, 'currentCards', {
  get: () => currentCards,
  set: (v) => { currentCards = v; }
});
mockContext.updateMediaPreviews = updateMediaPreviews;
mockContext.clearImageMedia = clearImageMedia;
mockContext.clearAudioMedia = clearAudioMedia;
mockContext.clearAllMedia = clearAllMedia;
mockContext.openSavedCard = openSavedCard;
`;

  vm.createContext(mockContext);
  vm.runInContext(jsContent + bridgeCode, mockContext);

  return {
    elements,
    mockContext,
    messageListeners,
    broadcastMessages,
    sentRuntimeMessages,
    dispatchMessage: (msg) => {
      let lastRes = null;
      messageListeners.forEach(listener => {
        listener(msg, { tab: { id: 101 } }, (res) => { lastRes = res; });
      });
      return lastRes;
    }
  };
}

// -------------------------------------------------------------
// 1. Dual Media Coexistence & Independence
// -------------------------------------------------------------
function testDualMediaCoexistenceAndIndependence() {
  console.log("--- 1. Testing Dual Media Coexistence and Slot Independence ---");
  const env = setupSidepanelContext();
  const { mockContext, elements, dispatchMessage } = env;

  mockContext.currentCaptureId = 42;

  // Step 1: Screenshot arrives first
  const imgData = "data:image/jpeg;base64,MOCK_IMAGE_BYTES";
  const res1 = dispatchMessage({
    type: "SCREENSHOT_CAPTURED",
    dataUrl: imgData,
    captureId: 42
  });
  assert.equal(res1?.ok, true, "Screenshot accepted for captureId 42");
  assert.equal(mockContext.currentDraftMedia.imageBase64, imgData, "Image slot contains image data");
  assert.equal(mockContext.currentDraftMedia.audioBase64, null, "Audio slot remains null");
  assert.equal(elements.imagePreview.hidden, false, "Image preview visible");
  assert.equal(elements.audioPreview.hidden, true, "Audio preview hidden");
  assert.equal(elements.btnClearImage.hidden, false, "Clear image button visible");
  assert.equal(elements.btnClearAudio.hidden, true, "Clear audio button hidden");

  // Step 2: Audio arrives second
  const audData = "data:audio/wav;base64,MOCK_AUDIO_BYTES";
  const res2 = dispatchMessage({
    type: "AUDIO_CAPTURED",
    dataUrl: audData,
    mimeType: "audio/wav",
    captureId: 42
  });
  assert.equal(res2?.ok, true, "Audio accepted for captureId 42");
  assert.equal(mockContext.currentDraftMedia.imageBase64, imgData, "Image slot preserved when audio arrives");
  assert.equal(mockContext.currentDraftMedia.audioBase64, audData, "Audio slot contains audio data");
  assert.equal(mockContext.currentDraftMedia.audioStatus, "available", "Audio status is available");
  assert.equal(elements.imagePreview.hidden, false, "Image preview remains visible");
  assert.equal(elements.audioPreview.hidden, false, "Audio preview visible");
  assert.equal(elements.btnClearImage.hidden, false, "Clear image button visible");
  assert.equal(elements.btnClearAudio.hidden, false, "Clear audio button visible");

  // Step 3: Clear image media leaves audio intact
  mockContext.clearImageMedia();
  assert.equal(mockContext.currentDraftMedia.imageBase64, null, "Image cleared");
  assert.equal(mockContext.currentDraftMedia.audioBase64, audData, "Audio remains intact when image is cleared");
  assert.equal(mockContext.currentDraftMedia.audioStatus, "available", "Audio status remains available");
  assert.equal(elements.imagePreview.hidden, true, "Image preview hidden");
  assert.equal(elements.audioPreview.hidden, false, "Audio preview remains visible");

  // Step 4: Re-capture image and clear audio media leaves image intact
  dispatchMessage({
    type: "SCREENSHOT_CAPTURED",
    dataUrl: imgData,
    captureId: 42
  });
  assert.equal(mockContext.currentDraftMedia.imageBase64, imgData, "Image re-captured");
  assert.equal(mockContext.currentDraftMedia.audioBase64, audData, "Audio preserved");

  mockContext.clearAudioMedia();
  assert.equal(mockContext.currentDraftMedia.audioBase64, null, "Audio cleared");
  assert.equal(mockContext.currentDraftMedia.audioStatus, "idle", "Audio status reset to idle");
  assert.equal(mockContext.currentDraftMedia.imageBase64, imgData, "Image remains intact when audio is cleared");
  assert.equal(elements.imagePreview.hidden, false, "Image preview remains visible");
  assert.equal(elements.audioPreview.hidden, true, "Audio preview hidden");

  console.log("PASS: Dual media coexistence and independent slot lifecycle verified.");
}

// -------------------------------------------------------------
// 2. Capture ID Isolation Scenarios (A, B, C, D, E, F, G)
// -------------------------------------------------------------
function testCaptureIdIsolationScenarios() {
  console.log("--- 2. Testing Capture ID Isolation Scenarios (A - G) ---");
  const env = setupSidepanelContext();
  const { mockContext, elements, dispatchMessage, sentRuntimeMessages } = env;

  // Scenario A: Word A mined -> both complete -> both belong to Word A
  mockContext.currentCaptureId = 101;
  dispatchMessage({
    type: "SCREENSHOT_CAPTURED",
    dataUrl: "data:image/jpeg;base64,IMG_WORD_A",
    captureId: 101
  });
  dispatchMessage({
    type: "AUDIO_CAPTURED",
    dataUrl: "data:audio/wav;base64,AUD_WORD_A",
    captureId: 101
  });
  assert.equal(mockContext.currentDraftMedia.imageBase64, "data:image/jpeg;base64,IMG_WORD_A");
  assert.equal(mockContext.currentDraftMedia.audioBase64, "data:audio/wav;base64,AUD_WORD_A");
  assert.equal(mockContext.currentDraftMedia.captureId, 101);

  // Scenario B: Word A started -> user immediately selects Word B (captureId 102)
  // Late A screenshot and audio arrive with captureId 101
  mockContext.clearAllMedia();
  mockContext.currentCaptureId = 102;
  const staleImgRes = dispatchMessage({
    type: "SCREENSHOT_CAPTURED",
    dataUrl: "data:image/jpeg;base64,LATE_IMG_WORD_A",
    captureId: 101
  });
  assert.equal(staleImgRes?.ok, false, "Stale image rejected");
  assert.equal(staleImgRes?.error, "STALE_CAPTURE");
  assert.equal(mockContext.currentDraftMedia.imageBase64, null, "Word B image draft not polluted by Word A");

  const staleAudRes = dispatchMessage({
    type: "AUDIO_CAPTURED",
    dataUrl: "data:audio/wav;base64,LATE_AUD_WORD_A",
    captureId: 101
  });
  assert.equal(staleAudRes?.ok, false, "Stale audio rejected");
  assert.equal(staleAudRes?.error, "STALE_CAPTURE");
  assert.equal(mockContext.currentDraftMedia.audioBase64, null, "Word B audio draft not polluted by Word A");

  // Scenario C: Word B pending audio (video paused) -> screenshot B completes -> user switches to Word C (captureId 103)
  // clearAllMedia sends CANCEL_PENDING_AUDIO_CAPTURE
  sentRuntimeMessages.length = 0;
  mockContext.currentDraftMedia.captureId = 102;
  mockContext.currentDraftMedia.audioStatus = "pending";
  mockContext.clearAllMedia();
  assert.ok(
    sentRuntimeMessages.some(m => m.type === "CANCEL_PENDING_AUDIO_CAPTURE" && m.captureId === 102),
    "CANCEL_PENDING_AUDIO_CAPTURE sent for Word B"
  );
  mockContext.currentCaptureId = 103;

  // Video resumes and sends late audio for Word B (captureId 102) -> rejected
  const latePendingBRes = dispatchMessage({
    type: "AUDIO_CAPTURED",
    dataUrl: "data:audio/wav;base64,RESUMED_AUD_WORD_B",
    wasPending: true,
    captureId: 102
  });
  assert.equal(latePendingBRes?.ok, false, "Resumed Word B audio rejected on Word C draft");
  assert.equal(mockContext.currentDraftMedia.audioBase64, null, "Word C remains pristine");

  // Scenario D: Word C audio completes -> user retakes screenshot
  dispatchMessage({
    type: "AUDIO_CAPTURED",
    dataUrl: "data:audio/wav;base64,AUD_WORD_C_VALID",
    captureId: 103
  });
  assert.equal(mockContext.currentDraftMedia.audioBase64, "data:audio/wav;base64,AUD_WORD_C_VALID");

  // Retake screenshot replaces only image
  dispatchMessage({
    type: "SCREENSHOT_CAPTURED",
    dataUrl: "data:image/jpeg;base64,IMG_WORD_C_NEW",
    captureId: 103
  });
  assert.equal(mockContext.currentDraftMedia.imageBase64, "data:image/jpeg;base64,IMG_WORD_C_NEW");
  assert.equal(mockContext.currentDraftMedia.audioBase64, "data:audio/wav;base64,AUD_WORD_C_VALID", "Audio untouched by retake screenshot");

  // Scenario E: User retakes audio -> replaces only audio
  dispatchMessage({
    type: "AUDIO_CAPTURED",
    dataUrl: "data:audio/wav;base64,AUD_WORD_C_NEW",
    captureId: 103
  });
  assert.equal(mockContext.currentDraftMedia.audioBase64, "data:audio/wav;base64,AUD_WORD_C_NEW");
  assert.equal(mockContext.currentDraftMedia.imageBase64, "data:image/jpeg;base64,IMG_WORD_C_NEW", "Screenshot untouched by retake audio");

  // Scenario F: Clear image -> Audio remains
  mockContext.clearImageMedia();
  assert.equal(mockContext.currentDraftMedia.imageBase64, null);
  assert.equal(mockContext.currentDraftMedia.audioBase64, "data:audio/wav;base64,AUD_WORD_C_NEW");

  // Scenario G: Clear audio -> Image remains (re-attach image first)
  mockContext.currentDraftMedia.imageBase64 = "data:image/jpeg;base64,IMG_WORD_C_NEW";
  mockContext.clearAudioMedia();
  assert.equal(mockContext.currentDraftMedia.audioBase64, null);
  assert.equal(mockContext.currentDraftMedia.imageBase64, "data:image/jpeg;base64,IMG_WORD_C_NEW");

  console.log("PASS: Capture ID isolation scenarios A through G verified.");
}

// -------------------------------------------------------------
// 3. History Restoration & Re-Save Lifecycle (Frontend UI)
// -------------------------------------------------------------
async function testHistoryRestorationAndResave() {
  console.log("--- 3. Testing History Restoration & Re-save Lifecycle ---");
  const env = setupSidepanelContext();
  const { mockContext, elements } = env;

  // Case 3.1: Dual media card from History
  mockContext.fetch = async (url) => {
    if (url.includes("/api/cards/50")) {
      return {
        ok: true,
        json: async () => ({
          id: 50,
          expression: "桜",
          reading: "さくら",
          meaning: "cherry blossom",
          image: "ankiminer_img_20260915_sakura.jpg",
          audio: "ankiminer_audio_20260915_sakura.wav",
          deck_name: "Japanese::Mining",
          model_name: "MiningModel",
          sync_status: "synced"
        })
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  await mockContext.openSavedCard(50);
  assert.equal(String(elements.fieldCardId.value), "50");
  assert.equal(elements.fieldExpression.value, "桜");
  assert.equal(elements.fieldImage.value, "ankiminer_img_20260915_sakura.jpg");
  assert.equal(elements.fieldAudio.value, "ankiminer_audio_20260915_sakura.wav");
  assert.equal(mockContext.currentDraftMedia.imageBase64, "http://127.0.0.1:8000/api/media/ankiminer_img_20260915_sakura.jpg");
  assert.equal(mockContext.currentDraftMedia.audioBase64, "http://127.0.0.1:8000/api/media/ankiminer_audio_20260915_sakura.wav");
  assert.equal(mockContext.currentDraftMedia.audioStatus, "available");
  assert.equal(elements.imagePreview.hidden, false, "Image preview shown");
  assert.equal(elements.audioPreview.hidden, false, "Audio preview shown");
  assert.equal(elements.audioStatusBadge.textContent, "Ready", "Audio status badge is Ready");

  // Case 3.2: Partial media - Image only card
  mockContext.fetch = async (url) => {
    if (url.includes("/api/cards/51")) {
      return {
        ok: true,
        json: async () => ({
          id: 51,
          expression: "富士山",
          reading: "ふじさん",
          meaning: "Mount Fuji",
          image: "ankiminer_img_20260915_fuji.jpg",
          audio: "",
          deck_name: "Default",
          sync_status: "pending"
        })
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  await mockContext.openSavedCard(51);
  assert.equal(String(elements.fieldCardId.value), "51");
  assert.equal(elements.fieldImage.value, "ankiminer_img_20260915_fuji.jpg");
  assert.equal(elements.fieldAudio.value, "");
  assert.equal(mockContext.currentDraftMedia.imageBase64, "http://127.0.0.1:8000/api/media/ankiminer_img_20260915_fuji.jpg");
  assert.equal(mockContext.currentDraftMedia.audioBase64, null);
  assert.equal(mockContext.currentDraftMedia.audioStatus, "idle");
  assert.equal(elements.imagePreview.hidden, false);
  assert.equal(elements.audioPreview.hidden, true);

  // Case 3.3: Partial media - Audio only card
  mockContext.fetch = async (url) => {
    if (url.includes("/api/cards/52")) {
      return {
        ok: true,
        json: async () => ({
          id: 52,
          expression: "雨",
          reading: "あめ",
          meaning: "rain",
          image: "",
          audio: "ankiminer_audio_20260915_ame.wav",
          deck_name: "Default",
          sync_status: "pending"
        })
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  await mockContext.openSavedCard(52);
  assert.equal(String(elements.fieldCardId.value), "52");
  assert.equal(elements.fieldImage.value, "");
  assert.equal(elements.fieldAudio.value, "ankiminer_audio_20260915_ame.wav");
  assert.equal(mockContext.currentDraftMedia.imageBase64, null);
  assert.equal(mockContext.currentDraftMedia.audioBase64, "http://127.0.0.1:8000/api/media/ankiminer_audio_20260915_ame.wav");
  assert.equal(mockContext.currentDraftMedia.audioStatus, "available");
  assert.equal(elements.imagePreview.hidden, true);
  assert.equal(elements.audioPreview.hidden, false);

  console.log("PASS: History restoration for dual media, image only, and audio only cards verified.");
}

// -------------------------------------------------------------
// 4. Media Failure Isolation Tests
// -------------------------------------------------------------
function testMediaFailureIsolation() {
  console.log("--- 4. Testing Media Failure Isolation ---");
  const env = setupSidepanelContext();
  const { mockContext, elements, dispatchMessage } = env;

  mockContext.currentCaptureId = 200;

  // Case 4.1: DRM Screenshot failure + Successful Audio
  dispatchMessage({
    type: "SCREENSHOT_CAPTURE_STATUS",
    ok: false,
    error: "DRM_PROTECTED",
    message: "Protected frame",
    captureId: 200
  });
  dispatchMessage({
    type: "AUDIO_CAPTURED",
    dataUrl: "data:audio/wav;base64,AUD_DRM_TEST",
    captureId: 200
  });
  assert.equal(mockContext.currentDraftMedia.imageBase64, null, "Image null on DRM failure");
  assert.equal(mockContext.currentDraftMedia.audioBase64, "data:audio/wav;base64,AUD_DRM_TEST", "Audio valid despite image failure");
  assert.equal(mockContext.currentDraftMedia.audioStatus, "available");
  assert.equal(elements.imagePreview.hidden, true);
  assert.equal(elements.audioPreview.hidden, false);

  // Case 4.2: DRM Audio failure + Successful Screenshot
  mockContext.clearAllMedia();
  mockContext.currentCaptureId = 201;

  dispatchMessage({
    type: "AUDIO_CAPTURE_STATUS",
    ok: false,
    error: "DRM_AUDIO_RESTRICTED",
    captureId: 201
  });
  dispatchMessage({
    type: "SCREENSHOT_CAPTURED",
    dataUrl: "data:image/jpeg;base64,IMG_DRM_TEST",
    captureId: 201
  });
  assert.equal(mockContext.currentDraftMedia.imageBase64, "data:image/jpeg;base64,IMG_DRM_TEST", "Screenshot valid despite audio DRM");
  assert.equal(mockContext.currentDraftMedia.audioBase64, null, "Audio null on DRM");
  assert.equal(mockContext.currentDraftMedia.audioStatus, "unavailable");
  assert.equal(elements.audioStatusBadge.textContent, "DRM Restricted");
  assert.equal(elements.imagePreview.hidden, false);
  assert.equal(elements.audioPreview.hidden, true);

  // Case 4.3: Both fail
  mockContext.clearAllMedia();
  mockContext.currentCaptureId = 202;
  dispatchMessage({
    type: "SCREENSHOT_CAPTURE_STATUS",
    ok: false,
    error: "DRM_PROTECTED",
    captureId: 202
  });
  dispatchMessage({
    type: "AUDIO_CAPTURE_STATUS",
    ok: false,
    error: "DRM_AUDIO_RESTRICTED",
    captureId: 202
  });
  assert.equal(mockContext.currentDraftMedia.imageBase64, null);
  assert.equal(mockContext.currentDraftMedia.audioBase64, null);
  assert.equal(mockContext.currentDraftMedia.audioStatus, "unavailable");

  console.log("PASS: Media failure isolation verified.");
}

// -------------------------------------------------------------
// 5. Rapid User Interaction Stress Test
// -------------------------------------------------------------
function testRapidUserInteractionStress() {
  console.log("--- 5. Testing Rapid User Interaction Stress Flow ---");
  const env = setupSidepanelContext();
  const { mockContext, elements, dispatchMessage } = env;

  // 1. Mine Word A
  mockContext.currentCaptureId = 301;
  mockContext.clearAllMedia();

  // 2. Immediately mine Word B before A finishes
  mockContext.currentCaptureId = 302;
  mockContext.clearAllMedia();

  // Late messages from A arrive
  dispatchMessage({ type: "SCREENSHOT_CAPTURED", dataUrl: "data:image/jpeg;base64,IMG_A", captureId: 301 });
  dispatchMessage({ type: "AUDIO_CAPTURED", dataUrl: "data:audio/wav;base64,AUD_A", captureId: 301 });
  assert.equal(mockContext.currentDraftMedia.imageBase64, null);
  assert.equal(mockContext.currentDraftMedia.audioBase64, null);

  // 3. Retake image for Word B
  dispatchMessage({ type: "SCREENSHOT_CAPTURED", dataUrl: "data:image/jpeg;base64,IMG_B_1", captureId: 302 });
  assert.equal(mockContext.currentDraftMedia.imageBase64, "data:image/jpeg;base64,IMG_B_1");

  // 4. Retake audio for Word B
  dispatchMessage({ type: "AUDIO_CAPTURED", dataUrl: "data:audio/wav;base64,AUD_B_1", captureId: 302 });
  assert.equal(mockContext.currentDraftMedia.audioBase64, "data:audio/wav;base64,AUD_B_1");

  // 5. Clear image
  mockContext.clearImageMedia();
  assert.equal(mockContext.currentDraftMedia.imageBase64, null);
  assert.equal(mockContext.currentDraftMedia.audioBase64, "data:audio/wav;base64,AUD_B_1");

  // 6. Retake image for Word B
  dispatchMessage({ type: "SCREENSHOT_CAPTURED", dataUrl: "data:image/jpeg;base64,IMG_B_2", captureId: 302 });
  assert.equal(mockContext.currentDraftMedia.imageBase64, "data:image/jpeg;base64,IMG_B_2");

  // 7. Pause video -> 8. Mine Word C (pending audio)
  mockContext.currentCaptureId = 303;
  mockContext.clearAllMedia();
  mockContext.currentDraftMedia.audioStatus = "pending";
  mockContext.currentDraftMedia.captureId = 303;

  dispatchMessage({ type: "SCREENSHOT_CAPTURED", dataUrl: "data:image/jpeg;base64,IMG_C_FINAL", captureId: 303 });
  assert.equal(mockContext.currentDraftMedia.imageBase64, "data:image/jpeg;base64,IMG_C_FINAL");
  assert.equal(mockContext.currentDraftMedia.audioStatus, "pending");

  // 9. Resume video -> audio for C finalizes
  dispatchMessage({
    type: "AUDIO_CAPTURED",
    dataUrl: "data:audio/wav;base64,AUD_C_FINAL",
    wasPending: true,
    captureId: 303
  });
  assert.equal(mockContext.currentDraftMedia.imageBase64, "data:image/jpeg;base64,IMG_C_FINAL");
  assert.equal(mockContext.currentDraftMedia.audioBase64, "data:audio/wav;base64,AUD_C_FINAL");
  assert.equal(mockContext.currentDraftMedia.audioStatus, "available");
  assert.equal(mockContext.currentDraftMedia.captureId, 303);

  console.log("PASS: Rapid user interaction stress sequence verified with zero media cross-contamination.");
}

// Run all test suites
(async () => {
  try {
    testSidepanelAudioDOMContracts();
    testDualMediaCoexistenceAndIndependence();
    testCaptureIdIsolationScenarios();
    await testHistoryRestorationAndResave();
    testMediaFailureIsolation();
    testRapidUserInteractionStress();
    console.log("\n>>> ALL STAGE 3 COMBINED MEDIA EXTENSION TESTS PASSED SUCCESSFULLY! <<<");
  } catch (error) {
    console.error("\nTEST FAILED:", error);
    process.exit(1);
  }
})();
