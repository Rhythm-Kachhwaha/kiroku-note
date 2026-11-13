// ==========================================================================
// Module: card-editor.js
// Editor inputs, Japanese font/furigana, field listeners, duplicate check
// ==========================================================================

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

        // Source badge (Local vs Yomitan)
        const sourceBadge = document.createElement("span");
        sourceBadge.className = `dict-origin-badge badge source-${entry.source || "local"}`;
        sourceBadge.textContent = (entry.source === "yomitan") ? "Yomitan" : "Local";
        header.append(sourceBadge);

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
  const heroCard = document.querySelector("#captured-word-section");
  if (heroCard) heroCard.classList.add("is-empty");
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
    if (heroCard) heroCard.classList.remove("is-empty");
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

