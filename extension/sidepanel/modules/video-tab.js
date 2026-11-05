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
    annotateLoadedSubtitles(cues).catch(() => {});
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
      folderNameLabel.textContent = `${savedFolderName}:`;
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
    folderNameLabel.textContent = `${folderName} (${subtitleFiles.length}):`;
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

// -------------------------------------------------------------
// Subtitle Font Sizing & Annotation Client (Spec Sections 1 & 5)
// -------------------------------------------------------------
const VALID_SUB_SIZES = ["small", "medium", "large", "xlarge"];
const DEFAULT_SUB_SIZE = "large";
let currentActiveSubSize = DEFAULT_SUB_SIZE;

function setActiveSubSize(size, persist = true) {
  const targetSize = VALID_SUB_SIZES.includes(size) ? size : DEFAULT_SUB_SIZE;
  currentActiveSubSize = targetSize;

  if (videoCurrentCuePreview) {
    for (const s of VALID_SUB_SIZES) {
      videoCurrentCuePreview.classList.remove(`active-sub-size-${s}`);
    }
    videoCurrentCuePreview.classList.add(`active-sub-size-${targetSize}`);
  }

  const controls = activeSubSizeControls || document.querySelector("#active-sub-size-controls");
  if (controls) {
    const btns = controls.querySelectorAll ? controls.querySelectorAll(".sub-size-btn, [data-size]") : [];
    btns.forEach(btn => {
      const btnSize = btn.dataset?.size || (btn.getAttribute && btn.getAttribute("data-size"));
      const isActive = btnSize === targetSize;
      if (isActive) {
        btn.classList.add("active");
        if (btn.setAttribute) btn.setAttribute("aria-pressed", "true");
      } else {
        btn.classList.remove("active");
        if (btn.removeAttribute) btn.removeAttribute("aria-pressed");
        else if (btn.setAttribute) btn.setAttribute("aria-pressed", "false");
      }
    });
  }

  if (persist) {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ active_sub_size: targetSize });
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem("active_sub_size", targetSize);
      }
    } catch (_) {}
  }
}

async function loadActiveSubSizeFromStorage() {
  let savedSize = DEFAULT_SUB_SIZE;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("active_sub_size");
      if (stored && stored.active_sub_size) {
        savedSize = stored.active_sub_size;
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("active_sub_size");
      if (stored) savedSize = stored;
    }
  } catch (_) {}
  setActiveSubSize(savedSize, false);
}

if (activeSubSizeControls) {
  activeSubSizeControls.addEventListener("click", (e) => {
    const btn = e.target && typeof e.target.closest === "function"
      ? e.target.closest(".sub-size-btn, [data-size]")
      : null;
    if (btn) {
      const size = btn.dataset?.size || (btn.getAttribute && btn.getAttribute("data-size"));
      if (size) {
        setActiveSubSize(size, true);
      }
    }
  });
}

async function annotateLoadedSubtitles(cues) {
  const cueList = Array.isArray(cues) ? cues : loadedSubtitleCues;
  if (!Array.isArray(cueList) || cueList.length === 0) return;

  const payload = {
    cues: cueList.map((cue, idx) => ({
      id: cue.id !== undefined && cue.id !== null ? String(cue.id) : String(idx),
      text: cue.text || "",
      start: typeof cue.startTime === "number" ? cue.startTime : (typeof cue.startMs === "number" ? cue.startMs / 1000 : (typeof cue.start === "number" ? cue.start : undefined)),
      end: typeof cue.endTime === "number" ? cue.endTime : (typeof cue.endMs === "number" ? cue.endMs / 1000 : (typeof cue.end === "number" ? cue.end : undefined)),
    }))
  };

  try {
    const res = await fetch(API_SUBTITLE_ANNOTATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data?.cues)) return;

    for (const resCue of data.cues) {
      if (!resCue) continue;
      const cueIdStr = resCue.id !== undefined && resCue.id !== null ? String(resCue.id) : null;
      if (cueIdStr !== null) {
        annotatedCuesCache.set(cueIdStr, resCue.tokens || []);
      }
      const origCue = cueList.find((c, idx) => String(c.id ?? idx) === cueIdStr);
      if (origCue) {
        origCue.tokens = resCue.tokens || [];
        if (origCue.text) {
          annotatedCuesCache.set(origCue.text, resCue.tokens || []);
        }
      }
    }

    if (currentActiveCue) {
      const activeIdStr = currentActiveCue.id !== undefined && currentActiveCue.id !== null ? String(currentActiveCue.id) : null;
      const activeTokens = (activeIdStr && annotatedCuesCache.get(activeIdStr)) || (currentActiveCue.text && annotatedCuesCache.get(currentActiveCue.text));
      if (activeTokens) {
        currentActiveCue.tokens = activeTokens;
      }
      updateVideoCuePreviewText();
      if (typeof harvestMissedWords === "function") {
        harvestMissedWords(currentActiveCue);
      }
    }
    if (Array.isArray(recentSubtitleCues) && recentSubtitleCues.length > 0 && typeof harvestMissedWords === "function") {
      harvestMissedWords(recentSubtitleCues);
    }

    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "UPDATE_ANNOTATED_CUES",
          cues: cueList
        }).catch(() => {});
      }
    } catch (_) {}
  } catch (err) {
    // Offline backend or network error: graceful degradation
  }
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

  // Check if tokens exist for the active cue in annotatedCuesCache or currentActiveCue.tokens
  const activeCue = currentActiveCue;
  const activeIdStr = activeCue?.id !== undefined && activeCue?.id !== null ? String(activeCue.id) : null;
  const tokens = (Array.isArray(activeCue?.tokens) && activeCue.tokens.length > 0)
    ? activeCue.tokens
    : (
        (activeIdStr && annotatedCuesCache.get(activeIdStr)) ||
        (text && annotatedCuesCache.get(text)) ||
        (activeCue?.text && annotatedCuesCache.get(activeCue.text)) ||
        null
      );

  if (Array.isArray(tokens) && tokens.length > 0) {
    videoCurrentCuePreview.replaceChildren();
    for (const token of tokens) {
      const span = document.createElement("span");
      const rawStatus = token.status || "unstyled";
      const normalizedStatus = rawStatus === "should_know" ? "should-know" : rawStatus;
      const statusClass = rawStatus === normalizedStatus ? rawStatus : `${normalizedStatus} ${rawStatus}`;
      span.className = `sub-token ${statusClass}`;
      span.setAttribute("data-surface", token.surface || "");
      span.setAttribute("data-lemma", token.lemma || "");
      span.setAttribute("data-status", rawStatus);
      if (token.reading) span.setAttribute("data-reading", token.reading);
      if (token.jlpt_level) span.setAttribute("data-jlpt-level", token.jlpt_level);
      span.textContent = token.surface || "";
      videoCurrentCuePreview.appendChild(span);
    }
    return;
  }

  // Fallback: Highlight currently hovered term, mined expression, or draft expression if present in the cue text
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

if (videoCurrentCuePreview) {
  videoCurrentCuePreview.addEventListener("click", (e) => {
    const tokenSpan = e.target && typeof e.target.closest === "function"
      ? e.target.closest(".sub-token")
      : null;
    if (!tokenSpan) return;
    const surface = tokenSpan.dataset?.surface || (tokenSpan.getAttribute && tokenSpan.getAttribute("data-surface")) || tokenSpan.textContent;
    if (!surface) return;
    if (typeof window !== "undefined" && typeof window.identify === "function" && window.identify !== identify) {
      window.identify(surface);
    } else if (typeof mineSubtitleCueWord === "function" && currentActiveCue) {
      mineSubtitleCueWord(currentActiveCue, surface);
    } else if (typeof identify === "function") {
      const cue = currentActiveCue;
      const targetTime = typeof getSubtitleCueTargetTime === "function" ? getSubtitleCueTargetTime(cue) : null;
      identify(surface, {
        targetTime,
        cue,
        contextSentence: cue?.text || "",
        videoContext: true,
      });
    }
  });
}

// -------------------------------------------------------------
// Missed Should-Know Words Drawer (Spec Section 5.2)
// -------------------------------------------------------------

function toggleMissedWordsDrawer(force) {
  if (!videoMissedWordsBody) return;
  const isCurrentlyHidden = typeof force === "boolean"
    ? !force
    : (videoMissedWordsBody.hidden || (typeof videoMissedWordsBody.hasAttribute === "function" && videoMissedWordsBody.hasAttribute("hidden")));

  if (isCurrentlyHidden) {
    videoMissedWordsBody.hidden = false;
    if (typeof videoMissedWordsBody.removeAttribute === "function") {
      videoMissedWordsBody.removeAttribute("hidden");
    }
    if (videoMissedWordsHeader && typeof videoMissedWordsHeader.setAttribute === "function") {
      videoMissedWordsHeader.setAttribute("aria-expanded", "true");
    }
    if (videoMissedWordsDrawer && videoMissedWordsDrawer.classList) {
      videoMissedWordsDrawer.classList.add("expanded");
    }
  } else {
    videoMissedWordsBody.hidden = true;
    if (typeof videoMissedWordsBody.setAttribute === "function") {
      videoMissedWordsBody.setAttribute("hidden", "");
    }
    if (videoMissedWordsHeader && typeof videoMissedWordsHeader.setAttribute === "function") {
      videoMissedWordsHeader.setAttribute("aria-expanded", "false");
    }
    if (videoMissedWordsDrawer && videoMissedWordsDrawer.classList) {
      videoMissedWordsDrawer.classList.remove("expanded");
    }
  }
}

if (videoMissedWordsHeader) {
  videoMissedWordsHeader.addEventListener("click", () => {
    toggleMissedWordsDrawer();
  });
  videoMissedWordsHeader.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleMissedWordsDrawer();
    }
  });
}

function isWordMinedOrKnown(surface, lemma) {
  const s = (surface || "").trim();
  const l = (lemma || "").trim();
  if (s && (minedWordsSet.has(s) || markedKnownSet.has(s))) return true;
  if (l && (minedWordsSet.has(l) || markedKnownSet.has(l))) return true;
  return false;
}

function setKnownWords({ mined_words = [], marked_known = [] } = {}) {
  if (Array.isArray(mined_words)) {
    mined_words.forEach(w => { if (w) minedWordsSet.add(w.trim()); });
  }
  if (Array.isArray(marked_known)) {
    marked_known.forEach(w => { if (w) markedKnownSet.add(w.trim()); });
  }
  filterAndRenderMissedWords();
}

async function fetchKnownWords() {
  try {
    const res = await fetch(API_KNOWN_WORDS_URL);
    if (res.ok) {
      const data = await res.json();
      setKnownWords(data);
    }
  } catch (_) {}
}

function harvestMissedWords(cueOrCues) {
  if (!cueOrCues) return;
  const cues = Array.isArray(cueOrCues) ? cueOrCues : [cueOrCues];
  let changed = false;

  for (const cue of cues) {
    if (!cue) continue;
    const cueIdStr = cue.id !== undefined && cue.id !== null ? String(cue.id) : null;
    const tokens = (Array.isArray(cue.tokens) && cue.tokens.length > 0)
      ? cue.tokens
      : (
          (cueIdStr && annotatedCuesCache.get(cueIdStr)) ||
          (cue.text && annotatedCuesCache.get(cue.text)) ||
          []
        );

    if (!Array.isArray(tokens)) continue;

    for (const token of tokens) {
      if (!token) continue;
      const rawStatus = token.status;
      const isShouldKnow = rawStatus === "should-know" || rawStatus === "should_know";
      if (!isShouldKnow) continue;

      const surface = (token.surface || "").trim();
      const lemma = (token.lemma || "").trim();
      const key = lemma || surface;
      if (!key) continue;

      if (isWordMinedOrKnown(surface, lemma)) {
        continue;
      }

      if (!missedWordsMap.has(key)) {
        missedWordsMap.set(key, {
          surface: surface || key,
          lemma: lemma || surface || key,
          reading: token.reading || "",
          jlpt_level: token.jlpt_level || "",
          timestamp: Date.now(),
        });
        changed = true;
      }
    }
  }

  if (changed) {
    renderMissedWordsDrawer();
  }
}

function filterAndRenderMissedWords() {
  let changed = false;
  for (const [key, itemData] of missedWordsMap.entries()) {
    if (isWordMinedOrKnown(itemData.surface, itemData.lemma)) {
      missedWordsMap.delete(key);
      changed = true;
    }
  }
  renderMissedWordsDrawer();
}

function removeMissedWord(word) {
  const target = (word || "").trim();
  if (!target) return;
  let changed = false;
  if (missedWordsMap.has(target)) {
    missedWordsMap.delete(target);
    changed = true;
  }
  for (const [key, itemData] of missedWordsMap.entries()) {
    if (itemData.surface === target || itemData.lemma === target) {
      missedWordsMap.delete(key);
      changed = true;
    }
  }
  if (changed) {
    renderMissedWordsDrawer();
  }
}

function mineMissedWord(token) {
  const word = token?.surface || token?.lemma;
  if (!word) return;
  if (typeof window !== "undefined" && typeof window.identify === "function" && window.identify !== identify) {
    window.identify(word);
  } else if (typeof identify === "function") {
    identify(word);
  }
}

async function markWordAsKnown(word) {
  const targetWord = (word || "").trim();
  if (!targetWord) return;

  try {
    const res = await fetch(API_KNOWN_WORDS_MARK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: targetWord }),
    });
    if (!res.ok) {
      console.warn(`Failed to mark word "${targetWord}" as known on backend.`);
    }
  } catch (err) {
    console.warn(`Error marking word "${targetWord}" as known:`, err);
  }

  markedKnownSet.add(targetWord);
  removeMissedWord(targetWord);
}

function renderMissedWordsDrawer() {
  if (videoMissedWordsBadge) {
    videoMissedWordsBadge.textContent = String(missedWordsMap.size);
  }

  if (!videoMissedWordsList) return;
  videoMissedWordsList.replaceChildren();

  if (missedWordsMap.size === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "missed-words-empty";
    emptyEl.textContent = "No missed words yet";
    videoMissedWordsList.appendChild(emptyEl);
    return;
  }

  for (const itemData of missedWordsMap.values()) {
    const item = document.createElement("div");
    item.className = "missed-word-item";
    item.setAttribute("data-surface", itemData.surface);
    if (itemData.lemma) item.setAttribute("data-lemma", itemData.lemma);

    const infoDiv = document.createElement("div");
    infoDiv.className = "missed-word-info";

    const surfaceSpan = document.createElement("span");
    surfaceSpan.className = "missed-word-surface";
    surfaceSpan.textContent = itemData.surface;
    infoDiv.appendChild(surfaceSpan);

    if (itemData.reading) {
      const readingSpan = document.createElement("span");
      readingSpan.className = "missed-word-reading";
      readingSpan.textContent = itemData.reading;
      infoDiv.appendChild(readingSpan);
    }

    if (itemData.jlpt_level) {
      const jlptSpan = document.createElement("span");
      jlptSpan.className = "missed-word-jlpt jlpt-badge";
      jlptSpan.textContent = itemData.jlpt_level;
      infoDiv.appendChild(jlptSpan);
    }
    item.appendChild(infoDiv);

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "missed-word-actions";

    const btnMine = document.createElement("button");
    btnMine.type = "button";
    btnMine.className = "missed-word-btn-mine btn-sub-action";
    btnMine.setAttribute("data-action", "mine");
    btnMine.title = `Mine "${itemData.surface}"`;
    btnMine.textContent = "Mine";
    btnMine.addEventListener("click", (e) => {
      e.stopPropagation();
      mineMissedWord(itemData);
    });
    actionsDiv.appendChild(btnMine);

    const btnMarkKnown = document.createElement("button");
    btnMarkKnown.type = "button";
    btnMarkKnown.className = "missed-word-btn-mark-known btn-sub-action";
    btnMarkKnown.setAttribute("data-action", "mark-known");
    btnMarkKnown.title = `Mark "${itemData.lemma || itemData.surface}" as known`;
    btnMarkKnown.textContent = "Mark Known";
    btnMarkKnown.addEventListener("click", async (e) => {
      e.stopPropagation();
      await markWordAsKnown(itemData.lemma || itemData.surface);
    });
    actionsDiv.appendChild(btnMarkKnown);

    item.appendChild(actionsDiv);
    videoMissedWordsList.appendChild(item);
  }
}

// -------------------------------------------------------------
// Subtitle In-Track Search, Recent Cues & Sentence Mining (T4-B, T4-C, T4-F)
// -------------------------------------------------------------
async function loadActiveSubtitleCuesFromStorage() {
  fetchKnownWords().catch(() => {});
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const result = await chrome.storage.local.get(["active_subtitle_cues", "active_subtitle_filename"]);
      if (Array.isArray(result?.active_subtitle_cues)) {
        loadedSubtitleCues = result.active_subtitle_cues;
        if (loadedSubtitleCues.length > 0) {
          annotateLoadedSubtitles(loadedSubtitleCues).catch(() => {});
        }
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
    || message?.source === "subtitle_click"
    || message?.source === "subtitle_selection"
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
    if (typeof Event !== "undefined") {
      fieldExampleSentence.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  if (typeof fieldSourceText !== "undefined" && fieldSourceText) fieldSourceText.value = cue.text || "";

  const targetTime = getSubtitleCueTargetTime(cue);
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

    function segmentSubtitleCueTokens(text) {
      if (!text || typeof text !== "string") return [];
      if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
        return [{ text, isWord: /[\u3040-\u30ff\u4e00-\u9faf]/.test(text) }];
      }

      const isKanji = (ch) => /[\u4e00-\u9faf]/.test(ch);
      const isHiragana = (ch) => /[\u3040-\u309f]/.test(ch);
      const isJapanese = (ch) => /[\u3040-\u30ff\u4e00-\u9faf]/.test(ch);
      const loneParticles = new Set(["に", "を", "は", "で", "が", "と", "へ", "も", "よ", "ね", "か", "の", "や"]);
      const compoundParticles = new Set(["から", "まで", "より", "について", "にとって", "として", "ばかり", "くらい", "ぐらい", "ほど", "だけ", "など"]);

      try {
        const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
        const rawSegments = Array.from(segmenter.segment(text));
        const tokens = [];

        for (let i = 0; i < rawSegments.length; i++) {
          let seg = rawSegments[i].segment;
          const hasJp = Array.from(seg).some(isJapanese);

          if (!hasJp) {
            tokens.push({ text: seg, isWord: false });
            continue;
          }

          // 1. Contiguous Kanji expansion (e.g. 学校 + 生活 -> 学校生活, 東京 + 大学 -> 東京大学)
          if (Array.from(seg).every(isKanji)) {
            while (i + 1 < rawSegments.length) {
              const nextSeg = rawSegments[i + 1].segment;
              if (Array.from(nextSeg).every(isKanji)) {
                seg += nextSeg;
                i++;
              } else {
                break;
              }
            }
          }

          // 2. Verb / adjective inflection suffix attachment (e.g. 話 + しま + しょう -> 話しましょう, 食 + べた -> 食べた, 行 + った -> 行った)
          if (Array.from(seg).some(isKanji)) {
            while (i + 1 < rawSegments.length) {
              const nextSeg = rawSegments[i + 1].segment;
              if (!nextSeg || !Array.from(nextSeg).every(isHiragana)) break;
              if (loneParticles.has(nextSeg) || compoundParticles.has(nextSeg)) {
                if (!(/^[てでただ]$/.test(nextSeg) && /[っん]$/.test(seg))) {
                  break;
                }
              }
              seg += nextSeg;
              i++;
            }
          }

          // 3. Lone 1-character particle check (e.g. に, を, は, で)
          if (seg.length === 1 && isHiragana(seg) && loneParticles.has(seg)) {
            tokens.push({ text: seg, isWord: false });
            continue;
          }

          tokens.push({ text: seg, isWord: true });
        }

        return tokens;
      } catch (_) {
        return [{ text, isWord: /[\u3040-\u30ff\u4e00-\u9faf]/.test(text) }];
      }
    }

    // Support drag-selection across words in recent subtitle cue history
    textSpan.addEventListener("mouseup", (e) => {
      if (typeof window !== "undefined" && window.getSelection) {
        const sel = window.getSelection();
        const selText = sel ? sel.toString().trim() : "";
        if (selText && selText.length > 0) {
          e.stopPropagation();
          mineSubtitleCueWord(cue, selText).catch(() => {});
        }
      }
    });

    const tokens = segmentSubtitleCueTokens(cue.text);
    tokens.forEach(tok => {
      if (tok.isWord) {
        const wordSpan = document.createElement("span");
        wordSpan.className = "recent-cue-word";
        wordSpan.textContent = tok.text;
        wordSpan.title = `Click to mine "${tok.text}"`;
        wordSpan.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (typeof window !== "undefined" && window.getSelection) {
            const sel = window.getSelection();
            const selText = sel ? sel.toString().trim() : "";
            if (selText && selText.length > 0) return; // User was drag-selecting
          }
          await mineSubtitleCueWord(cue, tok.text).catch(() => {});
        });
        textSpan.appendChild(wordSpan);
      } else {
        textSpan.appendChild(document.createTextNode(tok.text));
      }
    });

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
    btnAskFromText.setAttribute("data-retired", "1");
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
  if (message?.type === "ANALYZE_GRAMMAR_SELECTION") {
    const sentence = String(message.sentence || message.selection || "").trim();
    renderTextGrammar(sentence);
    sendResponse?.({ ok: true });
    return true;
  }
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
    if (message.cue) {
      currentActiveCue = message.cue;
    }
    if (message.timelineId) {
      lastCaptureSource.timelineId = message.timelineId;
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
      if (typeof harvestMissedWords === "function") {
        harvestMissedWords(recentSubtitleCues);
      }
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
    if (typeof handleVideoCueChanged === "function") {
      handleVideoCueChanged(message.cue);
    }
    renderVideoGrammar(message.cue).catch(() => {});
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

    if (areaName === "local" && changes?.[GRAMMAR_SETTINGS_KEY]) {
      loadGrammarSettings().catch(() => {});
    }
    if (areaName === "local" && changes?.active_subtitle_cues) {
      loadedSubtitleCues = Array.isArray(changes.active_subtitle_cues.newValue)
        ? changes.active_subtitle_cues.newValue
        : [];
      if (loadedSubtitleCues.length > 0) {
        annotateLoadedSubtitles(loadedSubtitleCues).catch(() => {});
      }
      if (changes.active_subtitle_filename?.newValue && subtitlesFileStatus) {
        subtitlesFileStatus.textContent = changes.active_subtitle_filename.newValue;
        subtitlesFileStatus.classList.add("active");
        subtitlesFileStatus.title = `${changes.active_subtitle_filename.newValue} (${loadedSubtitleCues.length} cues)`;
      }
    }
    if (areaName === "local" && changes?.active_sub_size?.newValue) {
      setActiveSubSize(changes.active_sub_size.newValue, false);
    }
  });
}
