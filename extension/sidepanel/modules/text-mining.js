// ==========================================================================
// Module: text-mining.js
// Grammar card creation, card save submission, JP input mode, shortcuts
// ==========================================================================

// Card save form submission
function createGrammarCard(point, sentence, source = "text") {
  const grammar = point || {};
  currentCardKind = "grammar";
  currentGrammarCard = {
    pattern_key: grammar.pattern_key || grammar.pattern_display || "",
    pattern_display: grammar.pattern_display || grammar.pattern_key || "",
    span: {start: Number(grammar.start ?? 0), end: Number(grammar.end ?? 0)},
    level: grammar.level || grammar.jlpt_level || "",
    english_breakdown: grammar.english_breakdown || grammar.meaning || "",
    matched_formation: grammar.matched_formation || "",
    examples: Array.isArray(grammar.examples) ? grammar.examples.slice(0, 3) : [],
  };
  if (typeof fieldExpression !== "undefined" && fieldExpression) fieldExpression.value = currentGrammarCard.pattern_display;
  if (typeof fieldMeaning !== "undefined" && fieldMeaning) fieldMeaning.value = grammar.meaning_short || grammar.meaning || "";
  if (typeof fieldExampleSentence !== "undefined" && fieldExampleSentence) fieldExampleSentence.value = sentence || "";
  if (typeof fieldNotes !== "undefined" && fieldNotes) fieldNotes.value = currentGrammarCard.english_breakdown;
  if (typeof fieldTags !== "undefined" && fieldTags) fieldTags.value =
    `kiroku-grammar${currentGrammarCard.level ? `, jlpt-${String(currentGrammarCard.level).toLowerCase()}` : ""}`;
  if (typeof lastCaptureSource !== "undefined") lastCaptureSource = {type: source};
  if (typeof scheduleCardPreviewUpdate === "function") scheduleCardPreviewUpdate();
  return currentGrammarCard;
}

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
    card_kind: (typeof currentGrammarCard !== "undefined" && currentGrammarCard)
      ? "grammar"
      : (typeof currentCardKind !== "undefined" ? currentCardKind : "vocab"),
  };
  if (typeof currentGrammarCard !== "undefined" && currentGrammarCard) {
    payload.card_settings = {...(payload.card_settings || {}), ...currentGrammarCard};
  }

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
    if (isPreviewEditing) {
      isPreviewEditing = false;
      updatePreviewEditButton();
    }
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

    // Update collapsed chip and handle Video tab workspace auto-collapse on card save
    const savedWord = (typeof fieldExpression !== "undefined" && fieldExpression && fieldExpression.value) || body.expression || expr;
    const savedReading = (typeof fieldReading !== "undefined" && fieldReading && fieldReading.value) || body.reading || "";
    const savedStatus = body.is_duplicate
      ? "Already saved"
      : (body.sync_status === "synced" ? "Saved (synced)" : "Saved (pending)");
    if (typeof updateCollapsedCardChip === "function") {
      updateCollapsedCardChip(savedWord, savedReading, savedStatus);
    }

    if (savedWord) {
      minedWordsSet.add(savedWord);
      if (typeof removeMissedWord === "function") removeMissedWord(savedWord);
    }
    if (body.expression && body.expression !== savedWord) {
      minedWordsSet.add(body.expression);
      if (typeof removeMissedWord === "function") removeMissedWord(body.expression);
    }

    if (currentMiningTab === "video") {
      if (videoWorkspaceCollapseMode === "dont_show") {
        if (typeof collapseVideoWorkspace === "function") collapseVideoWorkspace();
      } else if (videoWorkspaceCollapseMode === "auto_collapse") {
        if (typeof scheduleVideoWorkspaceCollapse === "function") scheduleVideoWorkspaceCollapse(5000);
      }
    }

    currentGrammarCard = null;
    currentCardKind = body.card_kind || currentCardKind;
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
        card_kind: currentGrammarCard ? "grammar" : currentCardKind,
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

    const response = await fetch(`${API_CARD_SYNC_URL(cardId)}?force=true`, {
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
  if (!silent && typeof btnSettingsSyncAll !== "undefined" && btnSettingsSyncAll) {
    btnSettingsSyncAll.disabled = true;
  }
  if (!silent && syncAllStatus) {
    syncAllStatus.hidden = false;
    syncAllStatus.className = "sync-all-status";
    syncAllStatus.textContent = "Checking Anki & syncing cards…";
  }

  if (!silent && typeof settingsSyncProgressGroup !== "undefined" && settingsSyncProgressGroup) {
    settingsSyncProgressGroup.hidden = false;
    if (settingsSyncProgressBar) {
      settingsSyncProgressBar.style.width = "10%";
      settingsSyncProgressBar.style.background = "var(--accent-anki, #64b5f6)";
    }
    if (settingsSyncLabel) {
      settingsSyncLabel.textContent = "Connecting to Anki and syncing cards…";
    }
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
      if (!silent && typeof settingsSyncProgressGroup !== "undefined" && settingsSyncProgressGroup) {
        if (settingsSyncProgressBar) {
          settingsSyncProgressBar.style.width = "100%";
          settingsSyncProgressBar.style.background = "var(--accent-coral, #ff8c70)";
        }
        if (settingsSyncLabel) settingsSyncLabel.textContent = `Sync failed: ${errMsg}`;
      }
      if (!silent) setStatus(`Sync All failed: ${errMsg}`, true);
      await loadHistory().catch(() => {});
      return;
    }

    const { total_eligible = 0, synced_count = 0, failed_count = 0, results = [] } = body;

    if (!silent && typeof settingsSyncProgressGroup !== "undefined" && settingsSyncProgressGroup) {
      if (total_eligible === 0) {
        if (settingsSyncProgressBar) settingsSyncProgressBar.style.width = "100%";
        if (settingsSyncLabel) settingsSyncLabel.textContent = "No cards to sync (all up to date).";
      }
    }

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
          if (typeof settingsSyncProgressBar !== "undefined" && settingsSyncProgressBar) {
            const pct = Math.round(((i + 1) / results.length) * 100);
            settingsSyncProgressBar.style.width = `${pct}%`;
          }
          if (typeof settingsSyncLabel !== "undefined" && settingsSyncLabel) {
            settingsSyncLabel.textContent = `Syncing (${i + 1}/${results.length})…`;
          }
        }

        if (typeof syncProgressSummary !== "undefined" && syncProgressSummary) {
          syncProgressSummary.textContent = `Sync complete: ${synced_count} succeeded, ${failed_count} failed.`;
        }
        if (typeof settingsSyncProgressBar !== "undefined" && settingsSyncProgressBar) settingsSyncProgressBar.style.width = "100%";
        if (typeof settingsSyncLabel !== "undefined" && settingsSyncLabel) {
          settingsSyncLabel.textContent = `Sync complete: ${synced_count} succeeded, ${failed_count} failed.`;
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
    if (!silent && typeof settingsSyncProgressGroup !== "undefined" && settingsSyncProgressGroup) {
      if (settingsSyncProgressBar) {
        settingsSyncProgressBar.style.width = "100%";
        settingsSyncProgressBar.style.background = "var(--accent-coral, #ff8c70)";
      }
      if (settingsSyncLabel) settingsSyncLabel.textContent = `Sync failed: ${msg}`;
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
    if (typeof btnSettingsSyncAll !== "undefined" && btnSettingsSyncAll) {
      btnSettingsSyncAll.disabled = false;
    }
    if (typeof settingsSyncProgressGroup !== "undefined" && settingsSyncProgressGroup) {
      setTimeout(() => {
        if (settingsSyncProgressGroup) settingsSyncProgressGroup.hidden = true;
      }, 4000);
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

