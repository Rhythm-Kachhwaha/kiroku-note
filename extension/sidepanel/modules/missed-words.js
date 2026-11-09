// ==========================================================================
// Module: missed-words.js
// Missed words drawer and mark known/mine actions
// ==========================================================================

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

