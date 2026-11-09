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
const API_CLOUD_PULL_URL = `${BACKEND_BASE_URL}/api/cloud/pull`;
const API_KANJI_STROKES_URL = (char) => `${BACKEND_BASE_URL}/api/kanji/strokes/${encodeURIComponent(char)}`;
const API_LLM_STATUS_URL = `${BACKEND_BASE_URL}/api/llm/status`;
const API_LLM_ASK_URL = `${BACKEND_BASE_URL}/api/llm/ask`;
const API_LLM_CONFIG_URL = `${BACKEND_BASE_URL}/api/llm/config`;
const API_LLM_SECRET_URL = `${BACKEND_BASE_URL}/api/llm/secret`;
const API_SUBTITLE_ANNOTATE_URL = `${BACKEND_BASE_URL}/api/subtitle/annotate`;
const API_KNOWN_WORDS_URL = `${BACKEND_BASE_URL}/api/known-words`;
const API_KNOWN_WORDS_MARK_URL = `${BACKEND_BASE_URL}/api/known-words/mark`;
const API_GRAMMAR_ANALYZE_URL = `${BACKEND_BASE_URL}/api/grammar/analyze`;
const API_GRAMMAR_SETUP_URL = `${BACKEND_BASE_URL}/api/grammar/setup-check`;

// The paired extension token is session-only by default, but can be
// remembered persistently in local storage if chosen by the user.
const EXTENSION_AUTH_STORAGE_KEY = "kiroku.extension.session_token";
const EXTENSION_AUTH_REMEMBERED_KEY = "kiroku.extension.remembered_token";
let extensionAuthToken = null;
let lastBannerTime = 0;
const nativeFetch = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;

function showBackendBanner(type, message, actionText, actionCallback, force = false) {
  const now = Date.now();
  if (!force && now - lastBannerTime < 1000) return; // Debounce banner updates
  lastBannerTime = now;

  if (typeof document === "undefined") return;
  const banner = document.querySelector("#backend-error-banner");
  const msgEl = document.querySelector("#backend-error-banner-message");
  const btn = document.querySelector("#backend-error-banner-action");
  if (!banner || !msgEl) return;

  msgEl.textContent = message;
  banner.className = `backend-error-banner ${type}`;
  banner.hidden = false;

  if (actionText && actionCallback && btn) {
    btn.textContent = actionText;
    btn.hidden = false;
    btn.onclick = () => {
      actionCallback();
      banner.hidden = true;
    };
  } else if (btn) {
    btn.hidden = true;
  }
}

function hideBackendBanner() {
  if (typeof document === "undefined") return;
  const banner = document.querySelector("#backend-error-banner");
  if (banner) banner.hidden = true;
}

function updatePairingUIState() {
  if (typeof document === "undefined") return;
  const forgetBtn = document.querySelector("#extension-pairing-forget");
  const status = document.querySelector("#extension-pairing-status");
  if (extensionAuthToken) {
    if (forgetBtn) forgetBtn.style.display = "";
    if (status) status.textContent = "Paired with desktop.";
  } else {
    if (forgetBtn) forgetBtn.style.display = "none";
    if (status) status.textContent = "";
  }
}

if (globalThis.chrome?.storage) {
  if (chrome.storage.session) {
    chrome.storage.session.get(EXTENSION_AUTH_STORAGE_KEY).then((stored) => {
      if (stored?.[EXTENSION_AUTH_STORAGE_KEY]) {
        extensionAuthToken = stored[EXTENSION_AUTH_STORAGE_KEY];
        updatePairingUIState();
      }
    }).catch(() => {});
  }
  if (chrome.storage.local) {
    chrome.storage.local.get(EXTENSION_AUTH_REMEMBERED_KEY).then((stored) => {
      if (stored?.[EXTENSION_AUTH_REMEMBERED_KEY] && !extensionAuthToken) {
        extensionAuthToken = stored[EXTENSION_AUTH_REMEMBERED_KEY];
        updatePairingUIState();
      }
    }).catch(() => {});
  }
}

function isLocalKirokuApi(input) {
  const url = typeof input === "string" ? input : input?.url;
  return typeof url === "string" && url.startsWith(`${BACKEND_BASE_URL}/api/`);
}

if (nativeFetch) {
  globalThis.fetch = async (input, init = {}) => {
    const isLocal = isLocalKirokuApi(input);
    let finalInit = init;
    if (extensionAuthToken && isLocal) {
      const headers = new Headers(init.headers || (typeof input === "object" ? input.headers : undefined));
      headers.set("Authorization", `Bearer ${extensionAuthToken}`);
      finalInit = { ...init, headers };
    }
    try {
      const response = await nativeFetch(input, finalInit);
      if (isLocal) {
        if (response.status === 401) {
          showBackendBanner("unauthorized", "Desktop pairing required.", "Pair", () => {
            if (typeof switchMiningTab === "function") switchMiningTab("settings");
          });
        } else if (response.status === 403) {
          showBackendBanner("forbidden", "Untrusted origin: extension ID not accepted by backend.", "Settings", () => {
            if (typeof switchMiningTab === "function") switchMiningTab("settings");
          });
        } else if (response.ok) {
          hideBackendBanner();
        }
      }
      return response;
    } catch (err) {
      if (isLocal) {
        showBackendBanner("network-error", "Kiroku backend not running.", "Retry", null);
      }
      throw err;
    }
  };
}

async function redeemExtensionPairing(code, remember = true) {
  if (!nativeFetch) throw new Error("Fetch is unavailable.");
  const response = await nativeFetch(`${BACKEND_BASE_URL}/api/auth/extension-pairings/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: String(code || "").trim() })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.token) throw new Error(payload.detail || "Pairing failed.");
  extensionAuthToken = payload.token;

  if (remember) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({ [EXTENSION_AUTH_REMEMBERED_KEY]: extensionAuthToken });
    }
    if (globalThis.chrome?.storage?.session) {
      await chrome.storage.session.remove(EXTENSION_AUTH_STORAGE_KEY).catch(() => {});
    }
  } else {
    if (globalThis.chrome?.storage?.session) {
      await chrome.storage.session.set({ [EXTENSION_AUTH_STORAGE_KEY]: extensionAuthToken });
    }
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.remove(EXTENSION_AUTH_REMEMBERED_KEY).catch(() => {});
    }
  }
  hideBackendBanner();
  updatePairingUIState();
  return extensionAuthToken;
}

async function forgetExtensionPairing() {
  extensionAuthToken = null;
  if (globalThis.chrome?.storage?.session) {
    await chrome.storage.session.remove(EXTENSION_AUTH_STORAGE_KEY).catch(() => {});
  }
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.remove(EXTENSION_AUTH_REMEMBERED_KEY).catch(() => {});
  }
  updatePairingUIState();
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => {
  const codeInput = document.querySelector("#extension-pairing-code");
  const rememberCheckbox = document.querySelector("#extension-pairing-remember");
  const submit = document.querySelector("#extension-pairing-submit");
  const forget = document.querySelector("#extension-pairing-forget");
  const status = document.querySelector("#extension-pairing-status");

  updatePairingUIState();

  if (submit) {
    submit.addEventListener("click", async () => {
      if (!codeInput || !submit) return;
      submit.disabled = true;
      try {
        const remember = Boolean(rememberCheckbox?.checked);
        await redeemExtensionPairing(codeInput.value, remember);
        codeInput.value = "";
        if (status) status.textContent = remember ? "Paired & remembered on this browser." : "Paired for this browser session.";
      } catch (error) {
        if (status) status.textContent = error?.message || "Pairing failed.";
      } finally {
        submit.disabled = false;
      }
    });
  }

  if (forget) {
    forget.addEventListener("click", async () => {
      await forgetExtensionPairing();
      if (status) status.textContent = "Pairing removed.";
    });
  }
});

const kanjiStrokesCache = new Map();
const annotatedCuesCache = new Map();
const minedWordsSet = new Set();
const markedKnownSet = new Set();
const missedWordsMap = new Map();
const grammarCueCache = new Map();
const grammarSessionPoints = new Map();
let videoGrammarRenderGeneration = 0;
const GRAMMAR_SETTINGS_KEY = "kiroku.grammar_settings";
const DEFAULT_GRAMMAR_SETTINGS = {
  enabled: true, text_mode: "on-demand", video_strip: true, ahead_count: 5,
  show_below_level: true, show_basic_particles: false, card_front_style: "sentence",
  designated_dictionary: "", hide_known: false
};
let grammarSettings = { ...DEFAULT_GRAMMAR_SETTINGS };

function grammarCueKey(text) {
  let hash = 2166136261;
  for (const char of String(text || "")) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

async function analyzeGrammar(sentence, options = {}) {
  const text = String(sentence || "").trim();
  if (!text || !grammarSettings.enabled) return { points: [], matches: [], disabled: true };
  const response = await fetch(API_GRAMMAR_ANALYZE_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sentence: text,
      show_basic_particles: grammarSettings.show_basic_particles,
      designated_dictionary: grammarSettings.designated_dictionary || null,
      source: options.source || "text",
      learner_level: typeof currentJlptLevel !== "undefined" ? currentJlptLevel : null,
      hide_known: Boolean(grammarSettings.hide_known),
      show_below_level: grammarSettings.show_below_level
    })
  });
  if (!response.ok) throw new Error(`Grammar analysis failed (${response.status})`);
  return response.json();
}

function renderGrammarBreakdown(container, result, sentence) {
  if (!container) return;
  container.replaceChildren();
  const points = Array.isArray(result?.matches) ? result.matches : (result?.points || []);
  if (!points.length) {
    const empty = document.createElement("p"); empty.className = "grammar-empty";
    empty.textContent = result?.is_limited_offline ? "Grammar index unavailable while offline." : "No grammar points detected.";
    container.append(empty); return;
  }
  const chain = result?.conjugation_chain || result?.conjugationChain;
  if (chain) { const row = document.createElement("div"); row.className = "grammar-conjugation-chain"; row.textContent = Array.isArray(chain) ? chain.join(" → ") : String(chain); container.append(row); }
  const sentenceRow = document.createElement("div"); sentenceRow.className = "grammar-sentence";
  sentenceRow.textContent = sentence || "";
  container.append(sentenceRow);
  points.forEach((point, index) => {
    const card = document.createElement("article"); card.className = "grammar-point-card";
    card.dataset.patternKey = point.pattern_key || point.patternKey || "";
    const title = document.createElement("button"); title.type = "button"; title.className = "grammar-point-title";
    title.textContent = `${index + 1}. ${point.pattern_display || point.pattern || point.display || "Grammar point"}${point.level ? ` · ${point.level}` : ""}`;
    const detail = document.createElement("div"); detail.className = "grammar-point-detail"; detail.hidden = true;
    const meaning = point.meaning_short || point.meaning || point.english_breakdown || "Explanation unavailable.";
    detail.textContent = `${meaning}${point.formation ? `\nFormation: ${point.formation}` : ""}`;
    title.addEventListener("click", () => { detail.hidden = !detail.hidden; });
    const createButton = document.createElement("button");
    createButton.type = "button";
    createButton.className = "grammar-create-card";
    createButton.textContent = "Create card";
    createButton.addEventListener("click", () => createGrammarCard(point, sentence, "text"));
    card.append(title, detail, createButton); container.append(card);
  });
}

async function renderTextGrammar(sentence) {
  const section = document.querySelector("#text-grammar-section");
  const content = document.querySelector("#text-grammar-content");
  const count = document.querySelector("#text-grammar-count");
  if (!section || !content || !sentence) return;
  try {
    const result = await analyzeGrammar(sentence);
    const points = result?.matches || result?.points || [];
    count.textContent = points.length ? `(${points.length})` : "";
    renderGrammarBreakdown(content, result, sentence);
    section.hidden = false;
    if (grammarSettings.text_mode === "auto") { content.hidden = false; document.querySelector("#text-grammar-toggle")?.setAttribute("aria-expanded", "true"); }
  } catch (_) { section.hidden = false; content.replaceChildren(); }
}

async function renderVideoGrammar(cue) {
  const slot = document.querySelector("#active-sub-grammar-slot");
  const renderGeneration = ++videoGrammarRenderGeneration;
  if (!slot) return;
  if (!cue?.text || !grammarSettings.enabled || !grammarSettings.video_strip) {
    slot.replaceChildren();
    return;
  }
  const key = grammarCueKey(cue.text);
  let result = grammarCueCache.get(key);
  if (!result) {
    slot.textContent = "Checking grammar…";
    try {
      result = await analyzeGrammar(cue.text, { source: "video" });
      grammarCueCache.set(key, result);
    } catch (_) {
      if (renderGeneration !== videoGrammarRenderGeneration) return;
      slot.textContent = "Grammar unavailable";
      return;
    }
  }
  if (renderGeneration !== videoGrammarRenderGeneration) return;
  const points = result?.matches || result?.points || [];
  slot.replaceChildren();
  points.forEach(point => {
    const chip = document.createElement("button"); chip.type = "button"; chip.className = "grammar-chip";
    chip.textContent = `${point.pattern_display || point.pattern || point.display || "Grammar"}${point.level ? ` · ${point.level}` : ""}`;
    chip.addEventListener("click", () => {
      const detail = document.createElement("div"); detail.className = "grammar-chip-detail"; detail.textContent = point.english_breakdown || point.meaning_short || point.meaning || "";
      const createButton = document.createElement("button");
      createButton.type = "button";
      createButton.className = "grammar-create-card";
      createButton.textContent = "Create card";
      createButton.addEventListener("click", () => createGrammarCard(point, cue.text, "video"));
      slot.replaceChildren(detail, createButton);
    }); slot.append(chip);
    const keyName = point.pattern_key || point.pattern || point.display;
    if (keyName) grammarSessionPoints.set(keyName, { ...point, cue });
  });
  const sessionList = document.querySelector("#video-grammar-session-list");
  const sessionCount = document.querySelector("#video-grammar-session-count");
  if (sessionList) { sessionList.replaceChildren(); grammarSessionPoints.forEach(point => { const row = document.createElement("button"); row.type = "button"; row.className = "grammar-session-item"; row.textContent = `${point.pattern_display || point.pattern} · ${Math.round((point.cue.startTime || point.cue.startMs / 1000 || 0))}s`; row.addEventListener("click", () => chrome.runtime.sendMessage({ type: "SEEK_TO", ms: point.cue.startMs ?? Math.round((point.cue.startTime || 0) * 1000) }).catch(() => {})); sessionList.append(row); }); }
  if (sessionCount) sessionCount.textContent = String(grammarSessionPoints.size);
  for (const nextCue of (Array.isArray(recentSubtitleCues) ? recentSubtitleCues : []).slice(0, grammarSettings.ahead_count)) {
    const nextKey = grammarCueKey(nextCue?.text); if (nextCue?.text && !grammarCueCache.has(nextKey)) analyzeGrammar(nextCue.text, { source: "video" }).then(value => grammarCueCache.set(nextKey, value)).catch(() => {});
  }
}

async function loadGrammarSettings() {
  try { const data = await chrome.storage.local.get(GRAMMAR_SETTINGS_KEY); grammarSettings = { ...DEFAULT_GRAMMAR_SETTINGS, ...(data?.[GRAMMAR_SETTINGS_KEY] || {}) }; } catch (_) {}
  if (!grammarSettings.enabled || !grammarSettings.video_strip) {
    renderVideoGrammar(null).catch(() => {});
  }
  for (const [id, key] of Object.entries({ "setting-grammar-enabled": "enabled", "setting-grammar-video-strip": "video_strip", "setting-grammar-below-level": "show_below_level", "setting-grammar-particles": "show_basic_particles", "setting-grammar-ahead": "ahead_count", "setting-grammar-text-mode": "text_mode", "setting-grammar-front-style": "card_front_style", "setting-grammar-dictionary": "designated_dictionary" })) {
    const el = document.querySelector(`#${id}`); if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(grammarSettings[key]); else el.value = String(grammarSettings[key]);
    el.addEventListener("change", async () => {
      grammarSettings[key] = el.type === "checkbox" ? el.checked : (el.type === "number" ? Math.max(1, Math.min(10, Number(el.value) || 5)) : el.value);
      if ((key === "enabled" || key === "video_strip") && (!grammarSettings.enabled || !grammarSettings.video_strip)) {
        renderVideoGrammar(null).catch(() => {});
      }
      await chrome.storage.local.set({ [GRAMMAR_SETTINGS_KEY]: grammarSettings });
    });
  }
}

function initGrammarUI() {
  const textGrammarToggle = document.querySelector("#text-grammar-toggle");
  if (textGrammarToggle) textGrammarToggle.addEventListener("click", () => {
    const content = document.querySelector("#text-grammar-content");
    if (!content) return;
    content.hidden = !content.hidden;
    textGrammarToggle.setAttribute("aria-expanded", String(!content.hidden));
  });
  const testGrammarSetup = document.querySelector("#btn-test-grammar-setup");
  if (testGrammarSetup) testGrammarSetup.addEventListener("click", async () => {
    const output = document.querySelector("#grammar-setup-status");
    if (output) output.textContent = "Checking…";
    try {
      const response = await fetch(API_GRAMMAR_SETUP_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ designated_dictionary: grammarSettings.designated_dictionary || null }) });
      const data = await response.json();
      if (output) { output.textContent = data?.message || (data?.ok === false ? "Setup needs attention." : "Grammar setup ready."); output.dataset.status = data?.ok === false ? "error" : "ok"; }
      const list = document.querySelector("#grammar-dictionary-options");
      if (list && Array.isArray(data?.dictionaries)) list.replaceChildren(...data.dictionaries.map(name => { const option = document.createElement("option"); option.value = name; return option; }));
    } catch (_) { if (output) { output.textContent = "Backend unavailable."; output.dataset.status = "error"; } }
  });
  const grammarSessionHeader = document.querySelector("#video-grammar-session-header");
  if (grammarSessionHeader) grammarSessionHeader.addEventListener("click", () => {
    const body = document.querySelector("#video-grammar-session-body");
    if (!body) return;
    body.hidden = !body.hidden;
    grammarSessionHeader.setAttribute("aria-expanded", String(!body.hidden));
  });
  loadGrammarSettings().catch(() => {});
}

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
const btnRetakeImage = typeof document !== "undefined" && document ? document.querySelector("#btn-retake-image") : null;
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
let currentGrammarCard = null;
let currentCardKind = "vocab";
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
