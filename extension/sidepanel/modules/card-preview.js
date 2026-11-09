// ==========================================================================
// Module: card-preview.js
// Card preview DOM rendering, presentation state, flip/reorder
// ==========================================================================

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
  if (previewContextKey && contextKey !== previewContextKey) {
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

function convertNotesMarkdownToPreviewHtml(text) {
  const escaped = String(text || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  return escaped
    .replace(/`([^`\n]+)`/g, '<code class="kn-inline-code">$1</code>')
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
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
    notesDiv.append(document.createTextNode("Notes: "));
    const notesMarkup = convertNotesMarkdownToPreviewHtml(data.notes);
    if (typeof notesDiv.innerHTML === "string" || "innerHTML" in notesDiv) {
      notesDiv.insertAdjacentHTML?.("beforeend", notesMarkup);
    } else {
      notesDiv.append(document.createTextNode(data.notes));
    }
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

