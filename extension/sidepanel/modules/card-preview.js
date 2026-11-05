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
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      const result = await chrome.runtime.sendMessage({type: "SET_MINING_MODE", enabled});
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
      restorePreviewPresentation(body.card_settings?.preview_presentation || null);
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

      // Automatically capture a video frame when a video card has no image yet.
      const shouldAutoCaptureFrame = toggleAutoCaptureFrame ? toggleAutoCaptureFrame.checked : true;

      if (!body.image && shouldAutoCaptureFrame && isVideoMiningActive()) {
        retakeScreenshot(requestId, options.targetTime);
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

    // Update collapsed chip and handle Video tab workspace auto-collapse
    const chipWordVal = (typeof fieldExpression !== "undefined" && fieldExpression && fieldExpression.value) || body.expression || capturedText;
    const chipReadingVal = (typeof fieldReading !== "undefined" && fieldReading && fieldReading.value) || body.reading || (typeof activeReading !== "undefined" ? activeReading : "") || "";
    const chipStatusVal = body.is_duplicate ? "Already saved" : "Draft ready";
    if (typeof updateCollapsedCardChip === "function") {
      updateCollapsedCardChip(chipWordVal, chipReadingVal, chipStatusVal);
    }

    if (currentMiningTab === "video") {
      if (videoWorkspaceCollapseMode === "dont_show") {
        if (typeof collapseVideoWorkspace === "function") collapseVideoWorkspace();
      } else if (videoWorkspaceCollapseMode === "auto_collapse") {
        if (typeof expandVideoWorkspace === "function") expandVideoWorkspace();
        if (typeof scheduleVideoWorkspaceCollapse === "function") scheduleVideoWorkspaceCollapse(5000);
      }
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
  currentDraftMedia.audioBase64 = null;
  currentDraftMedia.audioStatus = "idle";
  if (fieldAudio) fieldAudio.value = "";
  updateMediaPreviews();
  setStatus("Audio cleared.");
}

function clearAllMedia() {
  currentDraftMedia.imageBase64 = null;
  currentDraftMedia.audioBase64 = null;
  currentDraftMedia.audioStatus = "idle";
  currentDraftMedia.captureId = null;
  updateMediaPreviews();
}

function captureOrRetakeScreenshot() {
  if (cardEditor && cardEditor.hidden) cardEditor.hidden = false;
  retakeScreenshot(currentCaptureId);
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
        <span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px; color:var(--accent-green, #22c55e);"><polyline points="20 6 9 17 4 12"/></svg>${synced} Synced</span>
        <span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px; color:var(--accent-orange, #f97316);"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${pending} Pending</span>
        <span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px; color:var(--accent-red, #ef4444);"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>${failed} Failed</span>
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

    // Track cloud cards and pending count for badge
    const cloudCards = cards.filter(c => {
      const s = String(c.source_type || "").toLowerCase();
      return s === "cloud" || s === "iphone_cloud_queue";
    });
    const cloudUnsyncedCount = cloudCards.filter(c => c.sync_status === "pending" || c.sync_status === "failed").length;
    if (historyCloudCountBadge) {
      if (cloudCards.length > 0) {
        historyCloudCountBadge.style.display = "inline-block";
        historyCloudCountBadge.textContent = cloudUnsyncedCount > 0 ? String(cloudUnsyncedCount) : String(cloudCards.length);
        historyCloudCountBadge.title = `${cloudUnsyncedCount} unsynced, ${cloudCards.length} total cloud cards`;
      } else {
        historyCloudCountBadge.style.display = "none";
      }
    }

    // Filter cards according to active source subtab
    let displayCards = cards;
    if (currentHistorySource === "cloud") {
      displayCards = cloudCards;
    } else if (currentHistorySource === "local") {
      displayCards = cards.filter(c => {
        const s = String(c.source_type || "").toLowerCase();
        return s !== "cloud" && s !== "iphone_cloud_queue";
      });
    }

    checkFirstRunStatus(total);

    const synced = typeof data.synced_total === "number"
      ? data.synced_total
      : (syncStatus === "synced" ? total : (syncStatus !== "all" && syncStatus ? 0 : cards.filter(c => c.sync_status === "synced").length));

    if (historyCount) {
      if (currentHistorySource === "cloud") {
        historyCount.textContent = `${displayCards.length} cloud card${displayCards.length === 1 ? "" : "s"}`;
      } else if (currentHistorySource === "local") {
        historyCount.textContent = `${displayCards.length} local card${displayCards.length === 1 ? "" : "s"}`;
      } else {
        historyCount.textContent = `${total} card${total === 1 ? "" : "s"}`;
      }
    }
    if (historySyncLabel) {
      if (currentHistorySource === "cloud") {
        const cloudSynced = cloudCards.filter(c => c.sync_status === "synced").length;
        historySyncLabel.textContent = `${cloudSynced} / ${cloudCards.length} synced`;
      } else {
        historySyncLabel.textContent = `${synced} / ${total} synced`;
      }
    }
    if (historyProgressBar) {
      const denom = currentHistorySource === "cloud" ? cloudCards.length : total;
      const num = currentHistorySource === "cloud" ? cloudCards.filter(c => c.sync_status === "synced").length : synced;
      const pct = denom > 0 ? Math.min(100, Math.round((num / denom) * 100)) : 0;
      historyProgressBar.style.width = `${pct}%`;
    }

    // Toggle Sync All vs Sync Cloud Cards button & Cloud Refresh button
    if (btnSyncAll && btnSyncCloudAll) {
      if (currentHistorySource === "cloud") {
        btnSyncAll.style.display = "none";
        btnSyncCloudAll.style.display = "inline-flex";
      } else {
        btnSyncAll.style.display = "";
        btnSyncCloudAll.style.display = "none";
      }
    }
    if (btnRefreshCloudQueue) {
      btnRefreshCloudQueue.style.display = currentHistorySource === "cloud" ? "inline-flex" : "none";
    }

    if (displayCards.length === 0) {
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
        let emptyMsg = isFiltered ? "No matching cards found." : "No cards mined yet.";
        let emptyHint = isFiltered ? "Try adjusting your search query or filters." : "Start mining to see your history here.";
        if (currentHistorySource === "cloud" && !isFiltered) {
          emptyMsg = "No cloud cards in local history.";
          emptyHint = "Cards queued from iPhone Shortcut or cloud worker appear here once fetched.";
        } else if (currentHistorySource === "local" && !isFiltered) {
          emptyMsg = "No locally mined cards found.";
          emptyHint = "Start mining from webpages or subtitles to see your history here.";
        }
        emptyDiv.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-state-icon" aria-hidden="true"><rect x="2" y="7" width="16" height="14" rx="2"/><path d="M6 3h14a2 2 0 0 1 2 2v12"/></svg>` +
          `<p class="empty-state-text">${emptyMsg}</p>` +
          `<p class="empty-state-hint">${emptyHint}</p>`;
        historyEmpty.append(emptyDiv);
      }
    } else {
      if (historyEmpty) {
        historyEmpty.hidden = true;
        if (typeof historyEmpty.replaceChildren === "function") historyEmpty.replaceChildren();
      }
      renderHistoryCards(sortHistoryCards(displayCards, currentHistorySort));
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
      let iconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px;" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
      let label = "Text";
      if (srcType === "video") {
        iconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px;" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
        label = "Video";
      } else if (srcType === "ocr") {
        iconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px;" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>';
        label = "OCR";
      } else if (srcType === "quick_add" || srcType === "quickadd") {
        iconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align:-1px; margin-right:3px;" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
        label = "Quick Add";
      } else if (srcType === "cloud" || srcType === "iphone_cloud_queue") {
        iconSvg = '<svg class="icon-cloud" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px;" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>';
        label = "Cloud";
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

      const displayText = host || label;
      const iconSpan = document.createElement("span");
      iconSpan.className = `icon-source icon-source-${srcType}`;
      iconSpan.setAttribute("aria-hidden", "true");
      iconSpan.innerHTML = iconSvg;

      const labelSpan = document.createElement("span");
      labelSpan.textContent = displayText;

      sourceBadge.append(iconSpan, labelSpan);
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
        retrySyncFromHistory(card.id, false);
      });
      actions.append(retryBtn);
    } else if (card.sync_status === "synced") {
      const resyncBtn = document.createElement("button");
      resyncBtn.type = "button";
      resyncBtn.className = "btn-history-retry btn-history-resync";
      resyncBtn.textContent = "Resync";
      resyncBtn.title = "Resync card to Anki (re-send fields and media)";
      resyncBtn.setAttribute("aria-label", `Resync ${card.expression} to Anki`);
      resyncBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        retrySyncFromHistory(card.id, true);
      });
      actions.append(resyncBtn);
    } else if (card.sync_status === "pending") {
      const syncBtn = document.createElement("button");
      syncBtn.type = "button";
      syncBtn.className = "btn-history-retry btn-history-sync";
      syncBtn.textContent = "Sync";
      syncBtn.title = "Sync card to Anki";
      syncBtn.setAttribute("aria-label", `Sync ${card.expression} to Anki`);
      syncBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        retrySyncFromHistory(card.id, false);
      });
      actions.append(syncBtn);
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
    currentCardKind = body.card_kind || "vocab";
    currentGrammarCard = currentCardKind === "grammar" && body.card_settings
      ? {...body.card_settings}
      : null;

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

async function retrySyncFromHistory(cardId, force = false) {
  try {
    setStatus(force ? "Resyncing card to Anki…" : "Retrying Anki sync…");
    const syncUrl = force ? `${API_CARD_SYNC_URL(cardId)}?force=true` : API_CARD_SYNC_URL(cardId);
    const res = await fetch(syncUrl, { method: "POST", headers: { "Content-Type": "application/json" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.sync_status === "failed") {
      const errMsg = data.error || data.detail || "Sync failed";
      setStatus(`Anki sync ${force ? "resync" : "retry"} failed: ${errMsg}`, true);
    } else {
      setStatus(force ? "Card resynchronized to Anki." : "Card synchronized to Anki.");
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
    setStatus(`Sync failed: ${formatErrorMessage(err)}`, true);
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

function setHistorySourceFilter(source) {
  currentHistorySource = source;
  const items = [
    { el: historySourceAll, key: "all" },
    { el: historySourceLocal, key: "local" },
    { el: historySourceCloud, key: "cloud" },
  ];
  items.forEach(({ el, key }) => {
    if (!el) return;
    const isActive = key === source;
    el.classList.toggle("active", isActive);
    el.setAttribute("aria-selected", String(isActive));
    el.style.background = isActive ? "var(--bg-surface-2, #2a2a2a)" : "transparent";
    el.style.color = isActive ? "var(--text-primary, #fff)" : "var(--text-secondary, #aaa)";
    el.style.fontWeight = isActive ? "600" : "500";
  });
  loadHistory();
}

if (historySourceAll) historySourceAll.addEventListener("click", () => setHistorySourceFilter("all"));
if (historySourceLocal) historySourceLocal.addEventListener("click", () => setHistorySourceFilter("local"));
if (historySourceCloud) historySourceCloud.addEventListener("click", () => setHistorySourceFilter("cloud"));

async function triggerSyncCloudCards() {
  if (isSyncAllRunning) return;
  try {
    if (btnSyncCloudAll) {
      btnSyncCloudAll.disabled = true;
      btnSyncCloudAll.textContent = "Syncing…";
    }
    setStatus("Scanning for unsynced cloud cards…");

    const res = await fetch(`${API_CARDS_URL}?limit=500`);
    if (!res.ok) throw new Error("Could not retrieve cards list.");
    const data = await res.json().catch(() => ({}));
    const all = Array.isArray(data.cards) ? data.cards : [];

    // Strictly select ONLY cloud cards with pending or failed status
    const eligibleCloud = all.filter(c => {
      const src = String(c.source_type || "").toLowerCase();
      const st = String(c.sync_status || "").toLowerCase();
      return (src === "cloud" || src === "iphone_cloud_queue") && (st === "pending" || st === "failed");
    });

    if (eligibleCloud.length === 0) {
      setStatus("No pending or retryable cloud cards to sync.");
      return;
    }

    const cloudCardIds = eligibleCloud.map(c => c.id);
    setStatus(`Syncing ${cloudCardIds.length} cloud card(s) to Anki…`);

    const syncRes = await fetch(API_CARDS_BULK_SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_ids: cloudCardIds }),
    });
    const syncData = await syncRes.json().catch(() => ({}));

    if (!syncRes.ok || syncData.error) {
      const errMsg = syncData.error || syncData.detail || "Bulk sync failed";
      setStatus(`Cloud sync failed: ${errMsg}`, true);
    } else {
      const syncedCount = typeof syncData.synced_count === "number" ? syncData.synced_count : cloudCardIds.length;
      const failedCount = typeof syncData.failed_count === "number" ? syncData.failed_count : 0;
      if (failedCount > 0) {
        setStatus(`Cloud sync: ${syncedCount} synced, ${failedCount} failed.`, true);
      } else {
        setStatus(`Successfully synced ${syncedCount} cloud card(s) to Anki.`);
      }
    }
    await loadHistory();
  } catch (err) {
    setStatus(`Cloud sync failed: ${formatErrorMessage(err)}`, true);
  } finally {
    if (btnSyncCloudAll) {
      btnSyncCloudAll.disabled = false;
      btnSyncCloudAll.textContent = "Sync Cloud Cards";
    }
  }
}

if (btnSyncCloudAll) {
  btnSyncCloudAll.addEventListener("click", () => triggerSyncCloudCards());
}

async function triggerRefreshCloudQueue() {
  if (!btnRefreshCloudQueue) return;
  const icon = btnRefreshCloudQueue.querySelector(".icon-refresh");
  const label = btnRefreshCloudQueue.querySelector("#btn-refresh-cloud-label");

  btnRefreshCloudQueue.disabled = true;
  if (icon) icon.classList.add("spinning");
  if (label) label.textContent = "Syncing…";
  setStatus("Syncing cloud queue, Anki stats, and Anki cards…");

  try {
    const res = await fetch(API_CLOUD_PULL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && (data.status === "ok" || data.status === "success")) {
      const processed = Number(data.processed || 0);
      if (processed > 0) {
        setStatus(`Imported ${processed} new card(s) from cloud.`);
      } else {
        setStatus(data.message || "Cloud queue is up to date.");
      }
    } else {
      const msg = data.message || data.detail || "Cloud check failed";
      setStatus(`Cloud queue: ${msg}`);
    }
  } catch (err) {
    setStatus(`Cannot connect to Kiroku backend: ${formatErrorMessage(err)}`);
  } finally {
    btnRefreshCloudQueue.disabled = false;
    if (icon) icon.classList.remove("spinning");
    if (label) label.textContent = "Sync";
    await loadHistory();
  }
}

if (btnRefreshCloudQueue) {
  btnRefreshCloudQueue.addEventListener("click", () => triggerRefreshCloudQueue());
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
loadActiveSubSizeFromStorage().catch(() => {});
