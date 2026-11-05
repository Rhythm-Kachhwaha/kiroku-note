
  // -------------------------------------------------------------
  // Step 2: Subtitle Synchronizer
  // -------------------------------------------------------------
  class SubtitleSynchronizer {
    constructor(cues = [], onCueChanged) {
      this.cues = Array.isArray(cues) ? cues : [];
      this.onCueChanged = onCueChanged;
      this.currentCue = null;
      this.video = null;
      this.offset = 0.0;
      this.offsetMs = 0;
      this._boundSync = () => this.sync();
    }

    setCues(newCues) {
      this.cues = Array.isArray(newCues) ? newCues : [];
      this.currentCue = null;
      this.sync(true);
    }

    setOffset(offsetSeconds) {
      if (typeof offsetSeconds === "number" && !isNaN(offsetSeconds)) {
        this.offset = offsetSeconds;
        this.offsetMs = Math.round(offsetSeconds * 1000);
      } else {
        this.offset = 0.0;
        this.offsetMs = 0;
      }
      this.sync(true);
    }

    setOffsetMs(offsetMs) {
      if (typeof offsetMs === "number" && !isNaN(offsetMs)) {
        this.offsetMs = Math.round(offsetMs);
        this.offset = this.offsetMs / 1000;
      } else {
        this.offsetMs = 0;
        this.offset = 0.0;
      }
      this.sync(true);
    }

    getEffectiveCue(cue) {
      if (!cue) return null;
      const offset = this.offset || 0;
      return {
        ...cue,
        startTime: cue.startTime + offset,
        endTime: cue.endTime + offset
      };
    }

    attach(video) {
      this.detach();
      if (!video) return;
      this.video = video;
      this.video.addEventListener("timeupdate", this._boundSync);
      this.video.addEventListener("seeked", this._boundSync);
      this.video.addEventListener("play", this._boundSync);
      this.video.addEventListener("pause", this._boundSync);
      this.sync(true);
    }

    detach() {
      if (this.video) {
        this.video.removeEventListener("timeupdate", this._boundSync);
        this.video.removeEventListener("seeked", this._boundSync);
        this.video.removeEventListener("play", this._boundSync);
        this.video.removeEventListener("pause", this._boundSync);
        this.video = null;
      }
      this._updateCue(null, true);
    }

    findCueAtTime(currentTime) {
      if (!Array.isArray(this.cues) || this.cues.length === 0) {
        return null;
      }
      // Phase 8.3: Positive offset means cues appear later; negative offset means cues appear earlier.
      // Effective cue interval: [cue.startTime + offset, cue.endTime + offset]
      // Video currentTime matches when: cue.startTime <= currentTime - offset < cue.endTime
      const unshiftedTime = currentTime - (this.offset || 0);
      for (const cue of this.cues) {
        if (unshiftedTime >= cue.startTime && unshiftedTime < cue.endTime) {
          return cue;
        }
      }
      return null;
    }

    sync(force = false) {
      if (!this.video) {
        this._updateCue(null, force);
        return;
      }
      const time = this.video.currentTime;
      const matched = this.findCueAtTime(time);
      this._updateCue(matched, force);
    }

    _updateCue(cue, force = false) {
      const prevKey = this.currentCue ? `${this.currentCue.startTime}-${this.currentCue.endTime}-${this.currentCue.text}` : "";
      const newKey = cue ? `${cue.startTime}-${cue.endTime}-${cue.text}` : "";
      if (force || prevKey !== newKey) {
        if (cue) {
          this.lastActiveCue = cue;
        }
        this.currentCue = cue;
        if (typeof this.onCueChanged === "function") {
          this.onCueChanged(cue);
        }
      }
    }
  }

  // Prevent direct <video> fullscreen isolation so overlays remain visible in the top layer
  if (typeof HTMLVideoElement !== "undefined" && HTMLVideoElement.prototype) {
    const origRequestFs = HTMLVideoElement.prototype.requestFullscreen ||
      HTMLVideoElement.prototype.webkitRequestFullscreen;
    if (origRequestFs && !HTMLVideoElement.prototype.__ankiminer_fs_hooked__) {
      HTMLVideoElement.prototype.__ankiminer_fs_hooked__ = true;
      HTMLVideoElement.prototype.requestFullscreen = function(options) {
        const container = (this.closest && this.closest(".jwplayer, #player, .video-js, [class*='player'], .html5-video-player, .watch-video")) || this.parentElement;
        if (container && container !== this && typeof container.requestFullscreen === "function") {
          return container.requestFullscreen(options);
        }
        return origRequestFs.call(this, options);
      };
      if (HTMLVideoElement.prototype.webkitRequestFullscreen) {
        HTMLVideoElement.prototype.webkitRequestFullscreen = function() {
          const container = (this.closest && this.closest(".jwplayer, #player, .video-js, [class*='player'], .html5-video-player, .watch-video")) || this.parentElement;
          if (container && container !== this && typeof container.webkitRequestFullscreen === "function") {
            return container.webkitRequestFullscreen();
          }
          return origRequestFs.call(this);
        };
      }
    }
  }

  function getFullscreenElement() {
    if (typeof document === "undefined") return null;
    return document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement ||
      null;
  }

  function setStyleProperty(el, prop, val, priority = "") {
    if (!el || !el.style) return;
    if (typeof el.style.setProperty === "function") {
      el.style.setProperty(prop, val, priority);
    }
    el.style[prop] = val;
  }

  function isJapaneseChar(ch) {
    if (!ch) return false;
    const code = ch.charCodeAt(0);
    return (
      (code >= 0x3040 && code <= 0x309F) || // Hiragana
      (code >= 0x30A0 && code <= 0x30FF) || // Katakana
      (code >= 0x4E00 && code <= 0x9FAF) || // CJK Unified Ideographs (Kanji)
      (code >= 0x3400 && code <= 0x4DBF) || // CJK Extension A
      (code >= 0xFF66 && code <= 0xFF9F)    // Half-width Katakana
    );
  }

  function isKanji(ch) {
    if (!ch) return false;
    const code = ch.charCodeAt(0);
    return (code >= 0x4E00 && code <= 0x9FAF) || (code >= 0x3400 && code <= 0x4DBF);
  }

  function isHiragana(ch) {
    if (!ch) return false;
    const code = ch.charCodeAt(0);
    return code >= 0x3040 && code <= 0x309F;
  }

  function isKatakana(ch) {
    if (!ch) return false;
    const code = ch.charCodeAt(0);
    return (code >= 0x30A0 && code <= 0x30FF) || (code >= 0xFF66 && code <= 0xFF9F) || ch === "ー";
  }

  function isJapanesePunctuationOrSpace(ch) {
    if (!ch) return true;
    return /[\s。、！？!?.,;:「」『』()（）\[\]【】…―—\-]/.test(ch);
  }

  function extractJapaneseWordAtPosition(element, clientX, clientY) {
    if (!element) return null;

    let range = null;
    if (typeof document !== "undefined") {
      if (typeof document.caretRangeFromPoint === "function" && typeof clientX === "number" && typeof clientY === "number") {
        range = document.caretRangeFromPoint(clientX, clientY);
      } else if (typeof document.caretPositionFromPoint === "function" && typeof clientX === "number" && typeof clientY === "number") {
        const pos = document.caretPositionFromPoint(clientX, clientY);
        if (pos && pos.offsetNode) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }
    }

    if (!range) {
      const fullText = (element.textContent || "").trim();
      const captureHelper = typeof KirokuCapture !== "undefined" ? KirokuCapture : (typeof AnkiMinerCapture !== "undefined" ? AnkiMinerCapture : null);
      if (fullText && captureHelper && captureHelper.containsJapanese(fullText)) {
        return fullText;
      }
      return null;
    }

    const textNode = range.startContainer;
    if (!textNode) return null;

    const text = textNode.nodeType === 3 ? (textNode.nodeValue || textNode.textContent || "") : (element.textContent || "");
    if (!text) return null;

    const offset = range.startOffset;
    let charIdx = offset;
    if (charIdx >= text.length && text.length > 0) charIdx = text.length - 1;

    if (!isJapaneseChar(text[charIdx])) {
      if (charIdx > 0 && isJapaneseChar(text[charIdx - 1])) {
        charIdx = charIdx - 1;
      } else if (charIdx < text.length - 1 && isJapaneseChar(text[charIdx + 1])) {
        charIdx = charIdx + 1;
      } else {
        return null;
      }
    }

    // 1. Intl.Segmenter word segmentation (standard in modern Chromium / JS engines)
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      try {
        const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
        const segments = Array.from(segmenter.segment(text));
        let matchIdx = segments.findIndex((s) => s.index <= charIdx && charIdx < s.index + s.segment.length);
        if (matchIdx !== -1) {
          let matched = segments[matchIdx];

          // Handle single-letter hiragana particles or inflections (e.g. に, を, は, た, る)
          const isSingleHiragana = matched.segment.length === 1 && isHiragana(matched.segment);
          if (isSingleHiragana) {
            const prev = matchIdx > 0 ? segments[matchIdx - 1] : null;
            if (prev && prev.isWordLike && Array.from(prev.segment).some(isJapaneseChar)) {
              if (/^[ただてる]$/.test(matched.segment)) {
                matched = {
                  ...matched,
                  segment: prev.segment + matched.segment,
                  index: prev.index,
                  isWordLike: true
                };
                matchIdx = matchIdx - 1;
              } else {
                matched = prev;
                matchIdx = matchIdx - 1;
              }
            } else {
              const next = matchIdx < segments.length - 1 ? segments[matchIdx + 1] : null;
              if (next && next.isWordLike && Array.from(next.segment).some(isJapaneseChar)) {
                matched = next;
                matchIdx = matchIdx + 1;
              }
            }
          }

          // Compound noun expansion across contiguous Kanji segments
          // (e.g. 学校 + 生活 = 学校生活, 東京 + 大学 = 東京大学, 自然 + 科学 = 自然科学)
          if (Array.from(matched.segment).some(isKanji)) {
            let startIdx = matchIdx;
            let endIdx = matchIdx;

            while (startIdx > 0) {
              const p = segments[startIdx - 1];
              if (p && p.isWordLike && Array.from(p.segment).every(isKanji)) {
                startIdx--;
              } else {
                break;
              }
            }

            while (endIdx < segments.length - 1) {
              const n = segments[endIdx + 1];
              if (n && n.isWordLike && Array.from(n.segment).every(isKanji)) {
                endIdx++;
              } else {
                break;
              }
            }

            if (startIdx !== endIdx) {
              const compound = segments.slice(startIdx, endIdx + 1).map((s) => s.segment).join("").trim();
              if (compound.length > 0) return compound;
            }
          }

          if (matched.isWordLike && Array.from(matched.segment).some(isJapaneseChar)) {
            if (!(matched.segment.length === 1 && isHiragana(matched.segment))) {
              return matched.segment.trim();
            }
          }
        }
      } catch (_) {}
    }

    // 2. Fallback token extraction: stop at Japanese punctuation and respect script transitions
    let start = charIdx;
    let end = charIdx;

    const initialIsKatakana = isKatakana(text[charIdx]);
    const initialIsHiragana = isHiragana(text[charIdx]);

    if (initialIsKatakana) {
      // Katakana cluster with prolonged sound mark
      while (start > 0 && isKatakana(text[start - 1]) && !isJapanesePunctuationOrSpace(text[start - 1])) {
        start--;
      }
      while (end < text.length - 1 && isKatakana(text[end + 1]) && !isJapanesePunctuationOrSpace(text[end + 1])) {
        end++;
      }
    } else if (initialIsHiragana) {
      // Hiragana cluster (e.g. ちょっと)
      while (start > 0 && isHiragana(text[start - 1]) && !isJapanesePunctuationOrSpace(text[start - 1])) {
        start--;
      }
      while (end < text.length - 1 && isHiragana(text[end + 1]) && !isJapanesePunctuationOrSpace(text[end + 1])) {
        end++;
      }
      // If single hiragana particle, expand backward to Kanji if present (e.g. 公園に -> 公園)
      if (start === end && start > 0 && isKanji(text[start - 1])) {
        let kanjiStart = start - 1;
        while (kanjiStart > 0 && isKanji(text[kanjiStart - 1]) && !isJapanesePunctuationOrSpace(text[kanjiStart - 1])) {
          kanjiStart--;
        }
        return text.slice(kanjiStart, start).trim();
      }
    } else {
      // Kanji compound (e.g. 学校生活, 向こう, 温泉, 勉強する)
      while (start > 0 && isKanji(text[start - 1]) && !isJapanesePunctuationOrSpace(text[start - 1])) {
        start--;
      }
      while (end < text.length - 1 && (isKanji(text[end + 1]) || isHiragana(text[end + 1])) && !isJapanesePunctuationOrSpace(text[end + 1])) {
        end++;
      }
    }

    const word = text.slice(start, end + 1).trim();
    if (word.length === 1 && isHiragana(word)) {
      return null;
    }
    return word.length > 0 ? word : null;
  }

  if (typeof window !== "undefined") {
    window.extractJapaneseWordAtPosition = extractJapaneseWordAtPosition;
  }