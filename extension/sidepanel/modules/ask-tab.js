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

function condenseNotes(rawText, options = {}) {
  const maxChars = Number.isFinite(options.maxChars) ? Math.max(1, options.maxChars) : 600;
  const sectionFilter = Array.isArray(options.sectionFilter) && options.sectionFilter.length
    ? new Set(options.sectionFilter.map(section => String(section).toLowerCase()))
    : null;
  const boilerplate = /^(here is the explanation:|sure!?\s*let['’]s break this down:|let['’]s break this down:)\s*$/i;
  const sectionPattern = /^(?:#{1,3}\s*)?(?:\*\*)?(meaning|usage|example|formation|nuance|common mistakes?|grammar pattern|breakdown|explanation|notes?)(?:\*\*)?\s*:?\s*$/i;
  const lines = String(rawText || "").replace(/\r\n?/g, "\n").split("\n");
  const result = [];
  let activeSection = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || boilerplate.test(line)) continue;
    const section = line.match(sectionPattern);
    if (section) {
      activeSection = section[1].toLowerCase();
      if (!sectionFilter || sectionFilter.has(activeSection) || sectionFilter.has(activeSection.replace(/s$/, ""))) {
        result.push(line.replace(/^#+\s*/, "").replace(/\*\*/g, ""));
      }
      continue;
    }
    if (sectionFilter && activeSection && !sectionFilter.has(activeSection) && !sectionFilter.has(activeSection.replace(/s$/, ""))) continue;
    result.push(line);
  }
  let condensed = result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (condensed.length > maxChars) condensed = `${condensed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  return condensed;
}

function openNotesComposer(rawText, button) {
  const dialog = document.querySelector("#ask-notes-composer");
  const preview = document.querySelector("#ask-notes-preview");
  const counter = document.querySelector("#ask-notes-counter");
  if (!dialog || !preview) return;
  preview.value = condenseNotes(rawText);
  const updateCount = () => {
    if (counter) counter.textContent = `${preview.value.length}/600`;
  };
  preview.oninput = updateCount;
  updateCount();
  dialog.hidden = false;
  preview.focus();
  const insert = (field, label) => {
    if (!field) return;
    const current = field.value.trim();
    field.value = current ? `${current}\n\n${preview.value}` : preview.value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    dialog.hidden = true;
    if (button) {
      button.textContent = `${label} added`;
      setTimeout(() => { button.textContent = "Add to Notes"; }, 1500);
    }
    setStatus(`AI explanation added as ${label.toLowerCase()}.`);
  };
  const notesButton = document.querySelector("#ask-notes-insert");
  const hintButton = document.querySelector("#ask-hint-insert");
  if (notesButton) notesButton.onclick = () => insert(fieldNotes, "Notes");
  if (hintButton) hintButton.onclick = () => insert(fieldHint, "Hint");
  const closeButton = document.querySelector("#ask-notes-cancel");
  if (closeButton) closeButton.onclick = () => { dialog.hidden = true; };
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
        openNotesComposer(aiResult, btnAddNotes);
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

if (btnCtxInsert) {
  btnCtxInsert.addEventListener("click", () => {
    const textToInsert = (activeAskContext?.text || (askContextText ? askContextText.textContent : "") || "").trim();
    if (!textToInsert || !askInputBox) return;
    if (askInputBox.value.trim().length > 0) {
      askInputBox.value = `${askInputBox.value}\n${textToInsert}`;
    } else {
      askInputBox.value = textToInsert;
    }
    askInputBox.dispatchEvent(new Event("input", { bubbles: true }));
    updateAskCharCount();
    resizeAskInputBox();
    askInputBox.focus();
    if (typeof askInputBox.setSelectionRange === "function") {
      askInputBox.setSelectionRange(askInputBox.value.length, askInputBox.value.length);
    }
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
  };
}
