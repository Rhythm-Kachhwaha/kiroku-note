/**
 * Kiroku Note - Anime Episode Map & Grammar Inspector (Group 5)
 *
 * Fetches analysis for cues from GET /api/link/cues/{hash} and GET /api/link/cue-grammar.
 * Visualizes unique vocab, known/unknown breakdown, JLPT distribution, gap words list,
 * and grammar inspector via /api/grammar/analyze + existing JLPT grammar points.
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.AnimeEpisodeMap = exports.AnimeEpisodeMap;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_BACKEND = "http://127.0.0.1:21828";

  class AnimeEpisodeMap {
    constructor(options = {}) {
      this.container = options.container || null;
      this.backendUrl = (options.backendUrl || DEFAULT_BACKEND).replace(/\/+$/, "");
      this.cueHash = options.cueHash || "";
      this.cues = options.cues || [];
      this.data = null;
      this.isLoading = false;
      this.error = null;
      this.onWordClick = options.onWordClick || null;
      this.onSeek = options.onSeek || null;

      this.elements = {};

      if (this.container) {
        this.mount(this.container);
      }
    }

    mount(container) {
      this.container = container;
      this.container.innerHTML = `
        <div class="anime-episode-map-wrap">
          <div class="anime-map-header">
            <span class="anime-map-title">Episode Analysis &amp; Grammar</span>
            <button type="button" class="anime-map-refresh-btn" title="Refresh analysis">Refresh</button>
          </div>
          <div class="anime-map-body">
            <div class="anime-map-loading" hidden>Analyzing episode vocabulary &amp; grammar…</div>
            <div class="anime-map-error" hidden></div>
            <div class="anime-map-content" hidden>
              <!-- 1. Stats Bar (Known %, Total Vocab, Gap Count) -->
              <div class="anime-map-stats-bar">
                <div class="anime-stat-card">
                  <span class="anime-stat-val" id="anime-stat-known-pct">--%</span>
                  <span class="anime-stat-label">Known</span>
                </div>
                <div class="anime-stat-card">
                  <span class="anime-stat-val" id="anime-stat-unique-vocab">--</span>
                  <span class="anime-stat-label">Unique Words</span>
                </div>
                <div class="anime-stat-card">
                  <span class="anime-stat-val" id="anime-stat-gap-words">--</span>
                  <span class="anime-stat-label">Gap Words</span>
                </div>
              </div>

              <!-- 2. JLPT Distribution Bar -->
              <div class="anime-jlpt-section">
                <div class="anime-section-subtitle">JLPT Level Distribution</div>
                <div class="anime-jlpt-bar" role="progressbar" aria-label="JLPT distribution">
                  <div class="anime-jlpt-seg n5" title="N5" style="width: 0%"></div>
                  <div class="anime-jlpt-seg n4" title="N4" style="width: 0%"></div>
                  <div class="anime-jlpt-seg n3" title="N3" style="width: 0%"></div>
                  <div class="anime-jlpt-seg n2" title="N2" style="width: 0%"></div>
                  <div class="anime-jlpt-seg n1" title="N1" style="width: 0%"></div>
                  <div class="anime-jlpt-seg unranked" title="Other" style="width: 0%"></div>
                </div>
                <div class="anime-jlpt-legend">
                  <span class="anime-legend-item"><span class="anime-dot n5"></span>N5</span>
                  <span class="anime-legend-item"><span class="anime-dot n4"></span>N4</span>
                  <span class="anime-legend-item"><span class="anime-dot n3"></span>N3</span>
                  <span class="anime-legend-item"><span class="anime-dot n2"></span>N2</span>
                  <span class="anime-legend-item"><span class="anime-dot n1"></span>N1</span>
                  <span class="anime-legend-item"><span class="anime-dot unranked"></span>Other</span>
                </div>
              </div>

              <!-- 3. Gap Words List -->
              <div class="anime-gap-section">
                <div class="anime-section-subtitle">Key Gap Words to Learn</div>
                <div class="anime-gap-chips" id="anime-gap-chips"></div>
              </div>

              <!-- 4. Grammar Inspector -->
              <div class="anime-grammar-inspector-section">
                <div class="anime-section-subtitle">Grammar Inspector</div>
                <div class="anime-grammar-list" id="anime-grammar-list"></div>
              </div>
            </div>
          </div>
        </div>
      `;

      this.elements.wrap = this.container.querySelector(".anime-episode-map-wrap");
      this.elements.refreshBtn = this.container.querySelector(".anime-map-refresh-btn");
      this.elements.loading = this.container.querySelector(".anime-map-loading");
      this.elements.error = this.container.querySelector(".anime-map-error");
      this.elements.content = this.container.querySelector(".anime-map-content");

      this.elements.knownPct = this.container.querySelector("#anime-stat-known-pct");
      this.elements.uniqueVocab = this.container.querySelector("#anime-stat-unique-vocab");
      this.elements.gapWords = this.container.querySelector("#anime-stat-gap-words");

      this.elements.jlptSegN5 = this.container.querySelector(".anime-jlpt-seg.n5");
      this.elements.jlptSegN4 = this.container.querySelector(".anime-jlpt-seg.n4");
      this.elements.jlptSegN3 = this.container.querySelector(".anime-jlpt-seg.n3");
      this.elements.jlptSegN2 = this.container.querySelector(".anime-jlpt-seg.n2");
      this.elements.jlptSegN1 = this.container.querySelector(".anime-jlpt-seg.n1");
      this.elements.jlptSegUnranked = this.container.querySelector(".anime-jlpt-seg.unranked");

      this.elements.gapChips = this.container.querySelector("#anime-gap-chips");
      this.elements.grammarList = this.container.querySelector("#anime-grammar-list");

      this.elements.refreshBtn.addEventListener("click", () => {
        if (this.cueHash) {
          this.loadAnalysis(this.cueHash);
        }
      });

      if (this.cueHash) {
        this.loadAnalysis(this.cueHash);
      }
    }

    setEpisode(cueHash, cues = []) {
      this.cueHash = cueHash || "";
      this.cues = Array.isArray(cues) ? cues : [];
      if (this.cueHash) {
        this.loadAnalysis(this.cueHash);
      } else {
        this.reset();
      }
    }

    reset() {
      this.data = null;
      this.error = null;
      if (this.elements.content) this.elements.content.hidden = true;
      if (this.elements.loading) this.elements.loading.hidden = true;
      if (this.elements.error) this.elements.error.hidden = true;
    }

    async loadAnalysis(cueHash) {
      if (!cueHash) return;
      this.cueHash = cueHash;
      this.isLoading = true;
      this.error = null;

      if (this.elements.loading) this.elements.loading.hidden = false;
      if (this.elements.error) this.elements.error.hidden = true;
      if (this.elements.content) this.elements.content.hidden = true;

      try {
        const url = `${this.backendUrl}/api/link/cues/${encodeURIComponent(cueHash)}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to load cues analysis (${res.status})`);
        }
        const data = await res.json();
        const cues = data.cues || [];

        // Synthesize aggregate stats from annotated cues
        const aggregated = this.aggregateCuesData(cues);
        this.data = aggregated;

        // Fetch grammar analysis for cues with key grammar points
        const grammarPoints = await this.fetchEpisodeGrammar(cueHash, cues);
        this.data.grammarPoints = grammarPoints;

        this.renderData(this.data);
      } catch (err) {
        this.error = err.message || "Failed to load episode map";
        if (this.elements.error) {
          this.elements.error.textContent = this.error;
          this.elements.error.hidden = false;
        }
      } finally {
        this.isLoading = false;
        if (this.elements.loading) this.elements.loading.hidden = true;
      }
    }

    aggregateCuesData(cues = []) {
      const vocabMap = new Map(); // lemma -> { status, level, count }
      const jlptCounts = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0, unranked: 0 };
      const gapWordsMap = new Map(); // word -> count
      let knownTokens = 0;
      let totalTokens = 0;

      for (const cue of cues) {
        const tokens = cue.tokens || [];
        for (const tok of tokens) {
          const isPunct = tok.pos === "補助記号" || tok.pos === "記号" || !String(tok.surface || "").trim();
          if (isPunct) continue;

          totalTokens++;
          const status = tok.status || "unstyled";
          const level = (tok.level || "").toUpperCase();
          const lemma = tok.lemma || tok.surface || "";

          if (status === "known" || status === "mined") {
            knownTokens++;
          }

          if (status === "gap" || status === "should_know") {
            gapWordsMap.set(lemma, (gapWordsMap.get(lemma) || 0) + 1);
          }

          if (level && jlptCounts[level] !== undefined) {
            jlptCounts[level]++;
          } else {
            jlptCounts.unranked++;
          }

          if (!vocabMap.has(lemma)) {
            vocabMap.set(lemma, { status, level, count: 1 });
          } else {
            vocabMap.get(lemma).count++;
          }
        }
      }

      const knownPct = totalTokens > 0 ? Math.round((knownTokens / totalTokens) * 1000) / 10 : 100.0;
      const sortedGaps = Array.from(gapWordsMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([word, count]) => ({ word, count, ...(vocabMap.get(word) || {}) }));

      return {
        totalCues: cues.length,
        totalTokens,
        knownTokens,
        knownPct,
        uniqueVocabCount: vocabMap.size,
        gapWords: sortedGaps,
        jlptCounts,
        cues
      };
    }

    async fetchEpisodeGrammar(cueHash, cues = []) {
      // Sample cues across the episode to inspect grammar points (up to first 15 cues with text)
      const pointsMap = new Map();
      const sampleLimit = Math.min(cues.length, 20);

      const promises = [];
      for (let i = 0; i < sampleLimit; i++) {
        const cue = cues[i];
        if (!cue || !cue.text) continue;
        const cueIdx = typeof cue.i === "number" ? cue.i : i;
        const url = `${this.backendUrl}/api/link/cue-grammar?hash=${encodeURIComponent(cueHash)}&i=${cueIdx}`;
        promises.push(
          fetch(url)
            .then(r => (r.ok ? r.json() : null))
            .then(res => {
              if (res && Array.isArray(res.points)) {
                for (const pt of res.points) {
                  const key = pt.pattern_key || pt.pattern || pt.display;
                  if (key && !pointsMap.has(key)) {
                    pointsMap.set(key, { ...pt, cueIndex: cueIdx, cueText: cue.text, startSec: cue.s || 0 });
                  }
                }
              }
            })
            .catch(() => {})
        );
      }

      await Promise.allSettled(promises);
      return Array.from(pointsMap.values());
    }

    renderData(data) {
      if (!this.elements.content) return;
      this.elements.content.hidden = false;

      // Stats
      if (this.elements.knownPct) {
        this.elements.knownPct.textContent = `${data.knownPct}%`;
      }
      if (this.elements.uniqueVocab) {
        this.elements.uniqueVocab.textContent = String(data.uniqueVocabCount);
      }
      if (this.elements.gapWords) {
        this.elements.gapWords.textContent = String(data.gapWords.length);
      }

      // JLPT bar
      const counts = data.jlptCounts || {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
      const getWidth = (cnt) => `${Math.round((cnt / total) * 100)}%`;

      if (this.elements.jlptSegN5) this.elements.jlptSegN5.style.width = getWidth(counts.N5 || 0);
      if (this.elements.jlptSegN4) this.elements.jlptSegN4.style.width = getWidth(counts.N4 || 0);
      if (this.elements.jlptSegN3) this.elements.jlptSegN3.style.width = getWidth(counts.N3 || 0);
      if (this.elements.jlptSegN2) this.elements.jlptSegN2.style.width = getWidth(counts.N2 || 0);
      if (this.elements.jlptSegN1) this.elements.jlptSegN1.style.width = getWidth(counts.N1 || 0);
      if (this.elements.jlptSegUnranked) this.elements.jlptSegUnranked.style.width = getWidth(counts.unranked || 0);

      // Gap words chips
      if (this.elements.gapChips) {
        this.elements.gapChips.replaceChildren();
        if (!data.gapWords.length) {
          const empty = document.createElement("span");
          empty.className = "anime-empty-hint";
          empty.textContent = "No gap words detected at current learner level.";
          this.elements.gapChips.appendChild(empty);
        } else {
          for (const gap of data.gapWords) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "anime-gap-chip";
            chip.textContent = `${gap.word}${gap.count > 1 ? ` (${gap.count})` : ""}`;
            chip.title = `Look up "${gap.word}" in dictionary`;
            chip.addEventListener("click", () => {
              if (typeof this.onWordClick === "function") {
                this.onWordClick(gap.word);
              }
            });
            this.elements.gapChips.appendChild(chip);
          }
        }
      }

      // Grammar Points Inspector
      if (this.elements.grammarList) {
        this.elements.grammarList.replaceChildren();
        const points = data.grammarPoints || [];
        if (!points.length) {
          const empty = document.createElement("div");
          empty.className = "anime-empty-hint";
          empty.textContent = "No prominent grammar points identified in sampled cues.";
          this.elements.grammarList.appendChild(empty);
        } else {
          for (const pt of points) {
            const item = document.createElement("div");
            item.className = "anime-grammar-item";

            const topRow = document.createElement("div");
            topRow.className = "anime-grammar-top";

            const title = document.createElement("span");
            title.className = "anime-grammar-title";
            title.textContent = pt.pattern_display || pt.pattern || pt.display || "Grammar";

            const levelBadge = document.createElement("span");
            levelBadge.className = `anime-grammar-level ${(pt.level || "").toLowerCase()}`;
            levelBadge.textContent = pt.level || "Grammar";

            topRow.appendChild(title);
            topRow.appendChild(levelBadge);
            item.appendChild(topRow);

            if (pt.meaning || pt.meaning_short || pt.english_breakdown) {
              const desc = document.createElement("div");
              desc.className = "anime-grammar-desc";
              desc.textContent = pt.meaning || pt.meaning_short || pt.english_breakdown;
              item.appendChild(desc);
            }

            if (pt.cueText) {
              const exRow = document.createElement("div");
              exRow.className = "anime-grammar-example";
              exRow.textContent = `"${pt.cueText}"`;
              if (typeof pt.startSec === "number") {
                exRow.title = `Jump video to cue`;
                exRow.style.cursor = "pointer";
                exRow.addEventListener("click", () => {
                  if (typeof this.onSeek === "function") {
                    this.onSeek(Math.round(pt.startSec * 1000));
                  }
                });
              }
              item.appendChild(exRow);
            }

            this.elements.grammarList.appendChild(item);
          }
        }
      }
    }
  }

  return { AnimeEpisodeMap };
});
