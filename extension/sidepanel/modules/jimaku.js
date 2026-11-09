// ==========================================================================
// Module: jimaku.js
// Jimaku search integration and subtitle downloads
// ==========================================================================

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
    annotateLoadedSubtitles(cues).catch(() => {});

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
  restorePreviewPresentation(null);
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
    } else if (Array.isArray(entry.meanings) && entry.meanings.length > 0) {
      gloss = String(entry.meanings[0]).trim();
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
    const resolvedJlpt = entry.jlpt_level || (Array.isArray(entry.tags) && entry.tags[0] && /^N[1-5]$/i.test(String(entry.tags[0]).trim()) ? String(entry.tags[0]).trim().toUpperCase() : null);
    rawCandidates.push({
      expression,
      reading,
      gloss,
      jlpt_level: resolvedJlpt,
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

