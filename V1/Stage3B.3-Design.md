# Kiroku Note — V1.0 Stage 3B.3 Frontend & Dictionary UI Design Specification

**Document Path:** `V1/Stage3B.3-Design.md`  
**Execution Type:** Research & Technical Design Specification Only (Zero Source Code Changes)  
**Date:** 2026-09-16  
**Status:** Complete / Approved for Implementation  

---

## 1. Executive Summary

### 1.1 Purpose of Stage 3B.3
This document establishes the comprehensive visual language, information architecture, dictionary rendering engine, accessibility standards, and implementation plan for the **Kiroku Note V1.0 Frontend Redesign**.

Kiroku Note is a local-first personal Japanese vocabulary mining tool optimized for roughly ten seconds per card:
```
see Japanese word -> capture -> identify/enrich -> edit -> save locally -> send/sync to Anki
```

The extension interface operates strictly inside a Chromium/Brave **Manifest V3 Side Panel** (approximately 320px–600px wide) running vanilla HTML, CSS, and JavaScript.

Following the completion of:
- **Stage 3B.1**: Backend AST normalizer & provider-neutral domain models (`V1/Stage3B1.md`)
- **Stage 3B.2.1**: Multi-sense default meaning synthesis & primary example synthesis (`CardService`)

The frontend is now positioned to render the rich linguistic dataset captured by Yomitan (pitch accent, frequency ranks, JLPT levels, sense-bound grammatical classifications, ruby annotations, and multi-dictionary sources) within a calm, fast, high-density, dark developer-utility interface.

---

## 2. Current UI Audit

A systematic audit of the existing Side Panel implementation (`extension/sidepanel/sidepanel.html`, `sidepanel.css`, and `sidepanel.js`) reveals the following strengths, weaknesses, and structural bottlenecks:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CURRENT UI AUDIT                                 │
├──────────────────────────────────────┬──────────────────────────────────────┤
│ WHAT WORKS (STRENGTHS)               │ WHAT IS WEAK (DEFICIENCIES)          │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Dark canvas (#181715) baseline.    │ • Expression boxed inside heavy card │
│ • At-a-glance connection pills.      │   widget with noisy 1px border.      │
│ • Clear text vs video mining tabs.   │ • Pitch accent & frequency omitted.  │
│ • Collapsible optional fields.       │ • JLPT level badge omitted.          │
│ • Local history & search drawer.     │ • Sense-bound POS tags flattened.    │
│ • Working media previews.            │ • Ruby furigana in examples omitted. │
│ • Robust error handling & fallback.  │ • Client-side string parsing munging │
│ • Stable DOM element contracts.      │ • Generic input borders & shadows.   │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 2.1 Visual & Hierarchy Deficiencies
1. **Hero Expression Disconnect:** The Japanese headword is enclosed in a boxed `.word-display-card` container (`#1f1e1b` on `#181715`). Rather than standing out as the primary typographical focal point, it feels like an isolated card widget with a heavy border.
2. **Repetitive Section Chrome:** Section headers (`.section-header`) use repetitive uppercase labels (`CARD`, `DICTIONARY`, `HISTORY`) with identical thin divider borders (`#2d2b27`), creating visual stutter and unnecessary vertical consumption.
3. **Form Crowding & Visual Weight Imbalance:** The Card Editor and Dictionary sections compete for visual dominance. Form inputs have oversized vertical padding and heavy borders, increasing total scroll depth in a narrow panel.
4. **Amateurish Media Previews:** The Image and Audio preview containers use emoji icons (`📸`, `🎙️`) and heavy borders, conflicting with a serious, technical developer-tool aesthetic.
5. **Action Hierarchy Confusion:** `[Save Card]` and `[Send to Anki]` are stacked with varying visual weights; the sync status label lacks distinct state styling.

### 2.2 Dictionary Presentation Deficiencies
1. **Pitch Accent Omission:** The backend AST normalizer extracts pitch downstep integers and pattern names (`heiban`, `atamadaka`, `nakadaka`, `odaka`), but the Side Panel Study View completely discards them.
2. **Frequency Statistics Omission:** Frequency ranks from corpora (Netflix, BCCWJ, Innocent, JPDB) are captured in `FrequencyRank` models but never surfaced in the UI.
3. **JLPT Level Omission:** JLPT levels resolved by the backend (`CaptureResponse.jlpt_level`) are not rendered in the Study View header or word hero.
4. **Sense-Bound POS Flattening:** In `renderDetails()`, parts of speech are extracted from all entries, placed into a global JavaScript `Set`, and displayed in a flat row above all senses. When a word is a transitive verb in Sense 1 and a noun in Sense 2, that distinction is completely lost.
5. **Loss of Ruby / Furigana in Examples:** Ruby annotations (`<ruby>映<rt>えい</rt>画<rt>が</rt></ruby>`) are either flattened or displayed as raw bracket notation (`映[えい]画[が]`).
6. **Frontend Business Logic Munging:** `sidepanel.js` performs client-side string sorting, hashing, and deduplication (`distinctGlosses.map(g => g.toLowerCase()).sort().join("|")`). This violates separation of concerns and creates fragility.

---

## 3. Design Direction & Visual Language

Kiroku Note's visual language is **Precision Dark Utility**: a focused, high-density, calm, and technically disciplined aesthetic designed specifically for Japanese language learners and power users.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DESIGN PRINCIPLES & BOUNDARIES                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  ✓ Dark theme optimized for immersion next to video/reading content         │
│  ✓ Japanese expression is the undisputed visual hero                        │
│  ✓ Noto Sans JP as the default typographical baseline                        │
│  ✓ Monospace data metrics for pitch, frequency, and shortcuts               │
│  ✓ High density with generous micro-spacing (no cramped claustrophobia)      │
│  ✓ Subtle surface elevations (obsidian -> graphite -> coal)                 │
│  ✓ Restrained warm terracotta/coral primary accent (#d97757)                │
│  ✓ Zero glassmorphism, zero blur filters, zero decorative gradients         │
│  ✓ Zero unnecessary cards-inside-cards or giant border radii                │
│  ✓ Zero floating bubbles, AI shimmer, or generic purple SaaS tropes         │
│  ✓ Restrained, purposeful micro-transitions (< 150ms)                       │
│  ✓ Uncompromising keyboard focus visibility (2px solid ring)                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Design Tokens (CSS Variables)

The design system is defined through a unified set of CSS custom properties adhering to strict contrast ratios and component roles:

```css
:root {
  /* Color Scheme */
  color-scheme: dark;

  /* Surface Elevation Hierarchy */
  --bg-canvas: #121110;          /* Deep obsidian base canvas */
  --bg-surface-1: #191816;        /* Primary section containers */
  --bg-surface-2: #211f1c;        /* Form inputs, cards, list rows */
  --bg-surface-3: #2a2824;        /* Hovered elements, active rows */
  --bg-surface-active: #33302b;   /* Pressed states, selected cards */

  /* Border Tokens */
  --border-subtle: #292724;       /* Hairline structural dividers */
  --border-default: #383530;      /* Default container & input borders */
  --border-strong: #4a4640;       /* Emphasized boundaries & hover borders */
  --border-focus: #d97757;        /* Keyboard focus ring */

  /* Typography Colors */
  --text-primary: #f5f4f0;        /* 98% brightness primary Japanese & text */
  --text-secondary: #b5b1a7;      /* 70% brightness labels & translations */
  --text-muted: #7d7971;          /* 50% brightness meta, hints, timestamps */
  --text-disabled: #54514a;       /* 35% brightness disabled elements */

  /* Brand & Semantic Accents */
  --accent-primary: #d97757;      /* Warm terracotta/coral (Actions, CTA) */
  --accent-primary-hover: #e08567;
  --accent-primary-active: #c5684a;
  --accent-primary-dim: #2b1f1a;  /* Accent background tint */

  --accent-reading: #dca566;      /* Warm amber for kana readings */
  --accent-reading-dim: #2e2417;

  --accent-success: #5db872;      /* Mint green for Saved / Synced */
  --accent-success-dim: #182b1d;
  --accent-success-border: #2d5a37;

  --accent-warning: #e8a55a;      /* Amber for Already Saved / Checking */
  --accent-warning-dim: #2e2316;
  --accent-warning-border: #5a4524;

  --accent-error: #e06c75;        /* Crimson for Sync Failed / Disconnected */
  --accent-error-dim: #2d181a;
  --accent-error-border: #5a2427;

  --accent-jlpt: #7aa2f7;          /* Soft cobalt for JLPT tags */
  --accent-jlpt-dim: #182238;
  --accent-jlpt-border: #2b3d63;

  /* Typography Font Stacks */
  --font-ui: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-japanese: "Noto Sans JP", "Noto Sans Japanese", "Hiragino Sans", "Yu Gothic", sans-serif;
  --font-japanese-serif: "Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif;
  --font-mono: "JetBrains Mono", "SF Mono", "Consolas", monospace;

  /* Spacing Scale (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;

  /* Border Radii */
  --radius-sm: 4px;              /* Tags, badges, input controls */
  --radius-md: 6px;              /* Buttons, inner cards, preview cards */
  --radius-lg: 8px;              /* Section panels, modals */
  --radius-pill: 9999px;         /* Status dots, compact pills */

  /* Shadows (Minimal & Sharp) */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5);

  /* Transitions */
  --transition-fast: 100ms ease-out;
  --transition-normal: 150ms ease-out;
}
```

### 3.2 Typography Scale & Japanese Typesetting

Japanese characters require deliberate line-height, font pairing, and baseline alignment:

| Semantic Role | Font Family | Size | Weight | Line Height | Letter Spacing | Color |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Hero Expression** | `--font-japanese` | 30px | 600 | 1.25 | +0.03em | `--text-primary` |
| **Hero Reading** | `--font-japanese` | 15px | 500 | 1.30 | +0.05em | `--accent-reading` |
| **Section Eyebrow** | `--font-ui` | 10px | 600 | 1.00 | +0.12em | `--text-muted` (UPPER) |
| **Body / Glosses** | `--font-ui` | 13px | 400 | 1.50 | 0.00em | `--text-primary` |
| **Example Japanese** | `--font-japanese` | 13px | 400 | 1.60 | +0.02em | `--text-primary` |
| **Example Translation** | `--font-ui` | 12px | 400 | 1.40 | 0.00em | `--text-secondary` |
| **Metadata / Badges** | `--font-mono` / `--font-ui` | 11px | 500 | 1.00 | +0.02em | `--text-secondary` |
| **Ruby Annotation (`<rt>`)** | `--font-japanese` | 9px | 400 | 1.00 | 0.00em | `--text-secondary` |
| **Keyboard Hints (`<kbd>`)** | `--font-mono` | 10px | 500 | 1.00 | +0.04em | `--text-muted` |

---

## 4. Side Panel Information Architecture

The Side Panel is structured as a vertical pipeline optimized for rapid visual scanning, minimal scrolling, and direct keyboard manipulation:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [KIROKU NOTE]                  [● Yomitan]  [● Anki]      [3 mined]         │ <- 1. Header & Status
├─────────────────────────────────────────────────────────────────────────────┤
│  [ Text Mining ]  [ Video Mining ]                                          │ <- 2. Mining Mode Tabs
│  [Start Mining (Ctrl+Shift+U)]  Mining mode is active.                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  食べる                                                                     │ <- 3. Word Hero
│  たべる  [② Nakadaka]  [JLPT N5]  [Netflix #180]                            │    & Metadata Strip
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ CARD                                                                        │ <- 4. Card Editor
│  Expression  [ 食べる                                    ]                  │    (Always above Dict)
│  Reading     [ たべる                                    ]                  │
│  Meaning     [ 1. to eat                                 ]                  │
│              [ 2. to live on; to make a living           ]                  │
│                                                                             │
│  ┌─ Media ───────────────────────────────────────────────────────────────┐  │
│  │ 📸 Frame: [img_42.jpg] (x)  │  🎙️ Audio: [▶ 0:02 / 0:02] ↺ (x)        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│  Deck [ Default ▼ ]    Note Type [ Japanese Vocab ▼ ]                       │
│  [+ Optional fields]                                                        │
│                                                                             │
│  [ Save Card (Ctrl+Enter) ]        [ Send to Anki ]  (● Ready)              │
├─────────────────────────────────────────────────────────────────────────────┤
│ DICTIONARY [Jitendex] [+2 more]                       [📋 Copy] [Full Dict] │ <- 5. Study View &
│  1. [1-dan verb, transitive] to eat; to consume                             │    Sense-Bound Data
│     ▼ Examples (2)                                                          │
│       朝[あさ]ご飯[はん]を食[た]べる。 (To eat breakfast.)  [+ Add]          │
│  2. [1-dan verb, transitive] to live on; to make a living                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ HISTORY (24 cards)                                                          │ <- 6. Card Library
│  [🔍 Search cards...          ]  [All Decks ▼]  [All Statuses ▼]             │    & Search Drawer
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 映画 (えいが)  •  movie, film              [Default] [● Synced]       │  │
│  │ 本 (ほん)      •  book                     [Default] [● Pending]      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Detailed Section Breakdown

#### 1. Header & Connectivity Status
- Left: Brand mark `KIROKU NOTE` (10px, tracked uppercase, muted).
- Right: Dual status pills for **Yomitan** (`#indicator-yomitan`) and **Anki** (`#indicator-anki`), featuring 6px luminous status dots:
  - Green (`#5db872`): Connected and operational.
  - Amber (`#e8a55a`): In-flight health check or sync.
  - Slate Grey (`#6c6a64`): Offline or unreachable.
- Session Counter (`#session-count`): Discretely tracks newly persisted cards in the current browsing session (e.g. `3 mined`).

#### 2. Mining Mode Navigation & Control Bar
- Segmented tab bar switching between **Text Mining** (`#tab-btn-text`) and **Video Mining** (`#tab-btn-video`).
- Text Mining View:
  - Mining toggle button (`#mining-toggle`) with `aria-pressed` state and clear label (`Start mining` / `Stop mining`).
  - Mining status text (`#mode`).
  - Capture status feedback (`#capture-status`) and duplicate detection pill (`#save-badge`):
    - `[SAVED]` (`.badge.saved`): Newly persisted card.
    - `[ALREADY SAVED]` (`.badge.already-saved`): Term already exists in SQLite.
- Video Mining View (`#video-mining-section`):
  - Subtitle loading (`#load-subtitles-btn`, `#clear-subtitles-btn`, `#subtitles-file-status`).
  - Timing offset adjuster (`-100ms`, `0 ms` reset, `+100ms`).
  - Active subtitle preview (`#video-current-cue-preview`).
  - Auto-pause on hover and auto-media capture toggles.

#### 3. Japanese Word Hero & Linguistic Strip
- Unboxed, uncluttered typographical display:
  - Expression (`#expression`): 30px Japanese font weight 600.
  - Reading (`#reading`): 15px warm amber kana reading.
- Inline Metadata Badges:
  - **Pitch Accent Badge**: Tokyo dialect pitch downstep and classification (e.g. `[② Nakadaka]`, `[⓪ Heiban]`).
  - **JLPT Level Badge**: Resolved level (e.g. `[JLPT N5]`, `[JLPT N3]`).
  - **Frequency Rank Badge**: Primary corpus frequency (e.g. `[Netflix #180]`, `[BCCWJ #320]`).

#### 4. Card Editor (The Primary Interaction Zone)
- **Positioning Rule:** The Card Editor is positioned **above** the Dictionary section. This guarantees that captured text flows directly into editable fields without requiring downward scrolling.
- **Core Fields (Always Visible):**
  - Expression (`#field-expression`): Input with Japanese font styling.
  - Reading (`#field-reading`): Input with Japanese font styling.
  - Meaning (`#field-meaning`): Auto-growing textarea populated with synthesized multi-senses (e.g. `1. to eat\n2. to live on`).
- **Media Preview Strip (`#media-preview-container`):**
  - Integrated, low-profile card showing captured video screenshot thumbnail (`#image-preview`) with remove action (`#btn-clear-image`).
  - Embedded HTML5 audio player (`#audio-preview`) with replay button (`#btn-replay-audio`) and clear button (`#btn-clear-audio`).
- **Deck & Model Controls:**
  - Compact side-by-side selectors for Deck (`#field-deck-select`) and Note Type (`#field-model-select`).
- **Progressive Disclosure (`#toggle-optional`):**
  - Accordion button `+ Optional fields` expanding `#optional-fields` (`Hint`, `Example sentence`, `Example translation`, `Image`, `Audio`, `Tags`, `Notes`).
- **Action Bar:**
  - Primary CTA: `[Save Card]` (`#save-card-btn`) with prominent terracotta background.
  - Secondary CTA: `[Send to Anki]` (`#sync-anki-btn`) with dynamic state machine (`Ready`, `Syncing…`, `Synced`, `Retry`).

#### 5. Dictionary Information & Study View
- Action bar (`#dict-actions-bar`):
  - Primary dictionary source pill (`Jitendex`, `Kenkyusha`, etc.).
  - Secondary dictionary badge (`+2 more dicts`).
  - Copy Raw button (`#btn-copy-raw-dict`).
  - Full Dict / Study View toggle button (`#btn-toggle-full-dict`).
- Study View (`#meanings`): Structured, sense-bound layout with numbered senses, grammatical classifications, usage tags, and collapsible examples with ruby annotations.
- Raw View (`#dict-raw-view`): Monospace verbatim output for advanced linguistic verification.

#### 6. History & Card Library Section
- Header with total saved count (`#history-count`).
- Instant live search input (`#history-search-input`).
- Filter dropdowns (`#history-deck-filter`, `#history-sync-filter`).
- Virtualized list of saved cards (`#history-cards-list`) with active card selection, deletion, and retry synchronization.

---

## 5. Dictionary Study View Design & Progressive Disclosure

The Study View transforms Yomitan's complex AST dictionary payloads into an elegant, scannable study layout without data loss.

### 5.1 Real Benchmark Linguistic Representations

#### Benchmark 1: `映画` (`えいが`) — Single Sense Noun with Ruby
```html
<div class="study-entry">
  <!-- Top Linguistic Strip -->
  <div class="study-meta-strip">
    <span class="pill-dict">Jitendex</span>
    <span class="pill-pitch" title="Heiban (Flat)">⓪ Heiban</span>
    <span class="pill-jlpt">JLPT N5</span>
    <span class="pill-freq" title="BCCWJ Corpus Rank">BCCWJ #320</span>
  </div>

  <!-- Sense 1 -->
  <div class="study-sense">
    <div class="sense-header">
      <span class="sense-num">1.</span>
      <span class="sense-pos">noun</span>
      <span class="sense-glosses">movie; film; motion picture</span>
      <button type="button" class="btn-sense-insert" title="Use in Meaning field">↵</button>
    </div>
    
    <!-- Collapsible Examples -->
    <details class="study-examples-accordion" open>
      <summary class="study-examples-summary">Examples (1)</summary>
      <div class="study-example-item">
        <p class="example-ja">
          その<ruby>映<rt>えい</rt>画<rt>が</rt></ruby>をもう<ruby>一<rt>いち</rt>度<rt>ど</rt></ruby><ruby>見<rt>み</rt></ruby>たいな。
        </p>
        <p class="example-en">I want to see that movie again.</p>
        <button type="button" class="btn-example-insert" title="Use as Card Example">+ Example</button>
      </div>
    </details>
  </div>
</div>
```

#### Benchmark 2: `食べる` (`たべる`) — Polysemous Verb with Transitivity
```html
<div class="study-entry">
  <div class="study-meta-strip">
    <span class="pill-dict">Jitendex</span>
    <span class="pill-pitch" title="Nakadaka (Downstep on 2nd mora: た\べる)">② Nakadaka</span>
    <span class="pill-jlpt">JLPT N5</span>
    <span class="pill-freq">Netflix #180</span>
  </div>

  <!-- Sense 1 -->
  <div class="study-sense">
    <div class="sense-header">
      <span class="sense-num">1.</span>
      <span class="sense-pos">1-dan verb, transitive</span>
      <span class="sense-glosses">to eat; to consume</span>
      <button type="button" class="btn-sense-insert" title="Use in Meaning field">↵</button>
    </div>
    <details class="study-examples-accordion">
      <summary class="study-examples-summary">Examples (1)</summary>
      <div class="study-example-item">
        <p class="example-ja"><ruby>朝<rt>あさ</rt>御<rt>ご</rt>飯<rt>はん</rt></ruby>を<ruby>食<rt>た</rt></ruby>べる。</p>
        <p class="example-en">To eat breakfast.</p>
        <button type="button" class="btn-example-insert">+ Example</button>
      </div>
    </details>
  </div>

  <!-- Sense 2 -->
  <div class="study-sense">
    <div class="sense-header">
      <span class="sense-num">2.</span>
      <span class="sense-pos">1-dan verb, transitive</span>
      <span class="sense-glosses">to live on (e.g. one's salary); to make a living; to survive</span>
      <button type="button" class="btn-sense-insert" title="Use in Meaning field">↵</button>
    </div>
  </div>
</div>
```

#### Benchmark 3: `掛ける` (`かける`) — Highly Polysemous (25 Senses) & Multi-Domain
For words with extreme polysemy (e.g. `掛ける`, `立つ`, `取る`, `出る`), dumping 25 senses overwhelms the user.
- **Progressive Disclosure:** Display the first **4 primary senses** by default.
- Append a discreet disclosure button: `[Show 21 more senses...]` (`<details class="senses-overflow-accordion">`).
- Render sense-bound domain tags clearly: e.g. `Sense 8: [1-dan verb, transitive] [math] to multiply`.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 掛ける (かける)                                                              │
│ [Jitendex]  [② Nakadaka]  [JLPT N5 / N3]  [Netflix #42]                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. [1-dan, vt] to hang up; to suspend; to hoist                       [↵]   │
│ 2. [1-dan, vt] to put on (glasses, etc.); to wear                     [↵]   │
│ 3. [1-dan, vt] to spend (time, money); to expend                     [↵]   │
│ 4. [1-dan, vt] to turn on (a switch, engine); to set (a timer)       [↵]   │
│                                                                             │
│ ▼ Show 21 more senses (math, idioms, suffixes)...                           │
│   8. [1-dan, vt] [math] to multiply                                   [↵]   │
│   15. [suffix] to start to; to begin to; to be in the middle of       [↵]   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Ruby / Furigana Typesetting in Web Standards
To render ruby without layout shift or browser clipping:
```css
ruby {
  display: inline-flex;
  flex-direction: column-reverse;
  vertical-align: bottom;
  line-height: 1;
  text-align: center;
}

rb {
  display: inline;
  font-size: 13px;
  line-height: 1.2;
}

rt {
  display: block;
  font-size: 9px;
  font-weight: 400;
  line-height: 1;
  color: var(--text-secondary);
  user-select: none;
  transform: translateY(-1px);
}
```

---

## 6. Responsive & Narrow Width Layout Behavior (320px–600px)

The Chromium Side Panel width is dynamically adjustable by the user. The UI must adapt smoothly across extreme narrow (320px) to expanded desktop (600px+) viewports:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          RESPONSIVE BREAKPOINTS                             │
├────────────────────────────────┬────────────────────────────────────────────┤
│ Viewport Width Range           │ Layout Adaptation                          │
├────────────────────────────────┼────────────────────────────────────────────┤
│ Narrow Panel: 320px – 380px    │ • 1-column stacked form rows.              │
│                                │ • Compact 24px button heights.             │
│                                │ • Badges wrap into multi-line pill rows.   │
│                                │ • Media preview cards stacked vertically.  │
│                                │ • Japanese hero scaled to 26px font-size.  │
├────────────────────────────────┼────────────────────────────────────────────┤
│ Standard Panel: 381px – 480px  │ • Deck and Note Type side-by-side (2-col). │
│ (Default Chromium width)       │ • Media previews side-by-side in 1 row.    │
│                                │ • Japanese hero at standard 30px.          │
│                                │ • Action buttons side-by-side (Save/Sync). │
├────────────────────────────────┼────────────────────────────────────────────┤
│ Expanded Panel: > 480px        │ • Comfortable breathing room.              │
│                                │ • History drawer card grid / list split.   │
│                                │ • Multi-column dictionary comparative view.│
└────────────────────────────────┴────────────────────────────────────────────┘
```

### 6.1 Defensive Overflow CSS Rules
1. **Zero Horizontal Scrollbar Guarantee:**
   ```css
   body, .panel {
     max-width: 100vw;
     overflow-x: hidden;
     box-sizing: border-box;
   }
   ```
2. **Flex Item Squeeze Prevention:**
   ```css
   .form-group, .study-sense, .history-card-item {
     min-width: 0;
     flex-shrink: 1;
   }
   ```
3. **Japanese CJK Word Breaking:**
   ```css
   .hero-expression, .study-glosses, .example-ja, .example-en {
     overflow-wrap: break-word;
     word-break: break-word;
   }
   ```

---

## 7. Accessibility & Keyboard-First Experience

Kiroku Note is built for rapid, 10-second vocabulary mining where taking hands off the keyboard degrades efficiency.

### 7.1 Accessibility Standards Compliance (WCAG 2.1 AA)
- **Color Contrast:**
  - Primary text (`#f5f4f0`) on Canvas (`#121110`): **17.2:1** (Exceeds AAA 7:1).
  - Secondary text (`#b5b1a7`) on Surface 1 (`#191816`): **8.3:1** (Exceeds AAA 7:1).
  - Accent CTA (`#d97757`) on Canvas (`#121110`): **5.4:1** (Exceeds AA 4.5:1).
  - Kana Reading (`#dca566`) on Canvas (`#121110`): **8.1:1** (Exceeds AAA 7:1).
- **Target Sizes:**
  - All interactive buttons and inputs have a minimum target height of **32px** with explicit padding for effortless pointing.
- **Focus Rings:**
  - High-visibility custom focus indicator: `outline: 2px solid var(--border-focus); outline-offset: 1px;`.
  - Focus is never suppressed (`outline: none` without replacement is strictly forbidden).

### 7.2 Semantic HTML & ARIA Landmarks
- `<main class="panel">`: Primary landmark container.
- `<header class="panel-header">`: Contains branding and service status.
- `<div role="status" aria-label="Service connection status">`: Accessible status region for Yomitan & Anki indicators.
- `<nav class="mining-nav-tabs" role="tablist">`: Tablist for Text vs Video mining.
- `<section class="dictionary-section" aria-live="polite">`: Live region announcing dictionary updates to assistive technologies without interrupting focus.
- `<kbd>` tags marking all available shortcut keys.

### 7.3 Keyboard Shortcuts Specification

| Keyboard Shortcut | Context / Scope | Action Executed |
| :--- | :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> (or <kbd>Cmd</kbd> + <kbd>Enter</kbd>) | Global Panel / Editor | **Save Card** (persists to SQLite; triggers duplicate check) |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> | Card Editor (Saved) | **Send to Anki** (initiates explicit AnkiConnect sync) |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> (or <kbd>Cmd</kbd> + <kbd>K</kbd>) | Global Panel | Focus **Expression** input field (`#field-expression`) |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> | Global Panel | Focus **Meaning** textarea (`#field-meaning`) |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>U</kbd> | Global Panel | Toggle **Mining Mode** on / off |
| <kbd>Esc</kbd> | Inside Inputs / Forms | Close optional fields accordion / blur input |
| <kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd> | Global Panel | Move through logical sequential focus order |

---

## 8. Preserved DOM & Architectural Invariants

To guarantee 100% backward compatibility with existing tests, content scripts, background workers, and FastAPI endpoints, **the following DOM element contracts MUST NOT be removed, renamed, or altered**:

### 8.1 Required DOM ID Invariants

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOCKED DOM CONTRACTS                              │
├────────────────────────────┬────────────────────────────────────────────────┤
│ Category                   │ Element Selectors (IDs)                        │
├────────────────────────────┼────────────────────────────────────────────────┤
│ Card Editor Hidden State   │ #field-card-id, #field-deck-name,              │
│                            │ #field-model-name, #field-source-text,         │
│                            │ #field-deinflected-text                        │
├────────────────────────────┼────────────────────────────────────────────────┤
│ Card Editor Form Fields    │ #card-editor, #field-expression,               │
│                            │ #field-reading, #field-meaning, #field-hint,   │
│                            │ #field-example-sentence,                       │
│                            │ #field-example-translation, #field-image,      │
│                            │ #field-audio, #field-tags, #field-notes,       │
│                            │ #field-deck-select, #field-model-select,       │
│                            │ #field-font-select, #toggle-optional,          │
│                            │ #optional-fields                               │
├────────────────────────────┼────────────────────────────────────────────────┤
│ Editor Actions & Status    │ #save-card-btn, #sync-anki-btn,                │
│                            │ #anki-sync-status                              │
├────────────────────────────┼────────────────────────────────────────────────┤
│ Hero Japanese Word Display │ #expression, #reading, #captured-word-section  │
├────────────────────────────┼────────────────────────────────────────────────┤
│ Dictionary Section         │ #dictionary-section, #meanings,                │
│                            │ #dict-raw-view, #dict-actions-bar,             │
│                            │ #btn-copy-raw-dict, #btn-toggle-full-dict,     │
│                            │ #examples                                      │
├────────────────────────────┼────────────────────────────────────────────────┤
│ Media Preview Containers   │ #media-preview-container,                      │
│                            │ #image-preview-container, #image-preview,       │
│                            │ #btn-clear-image, #audio-preview-container,    │
│                            │ #audio-preview, #btn-clear-audio,              │
│                            │ #btn-replay-audio                              │
├────────────────────────────┼────────────────────────────────────────────────┤
│ Status & Connectivity      │ #indicator-yomitan, #indicator-anki,           │
│                            │ #capture-status, #save-badge, #mode,           │
│                            │ #session-count, #mining-toggle                 │
├────────────────────────────┼────────────────────────────────────────────────┤
│ Navigation & Video Mining  │ #tab-btn-text, #tab-btn-video,                 │
│                            │ #text-mining-view, #video-mining-view,         │
│                            │ #video-mining-section, #load-subtitles-btn,    │
│                            │ #clear-subtitles-btn, #subtitles-file-input,   │
│                            │ #subtitles-file-status, #video-track-select,   │
│                            │ #offset-minus-btn, #offset-reset-btn,          │
│                            │ #offset-plus-btn, #offset-display,             │
│                            │ #video-current-cue-preview,                    │
│                            │ #toggle-auto-pause-hover,                      │
│                            │ #toggle-auto-capture-frame,                    │
│                            │ #toggle-auto-capture-audio                     │
├────────────────────────────┼────────────────────────────────────────────────┤
│ History & Library Drawer   │ #history-section, #history-count,              │
│                            │ #history-search-input, #history-deck-filter,   │
│                            │ #history-sync-filter, #history-list-container, │
│                            │ #history-empty, #history-cards-list            │
└────────────────────────────┴────────────────────────────────────────────────┘
```

### 8.2 Locked Architectural Invariants
1. **Direct Side Panel messaging:** `content.js` sends `JAPANESE_TEXT_CAPTURED` directly to `sidepanel.js`.
2. **Asynchronous Capture Locking:** `currentCaptureId` increments per lookup, discarding stale in-flight responses.
3. **SQLite First-Class Persistence:** Cards are saved in SQLite before any AnkiConnect operation.
4. **Explicit Sync Trigger:** `Save Card` NEVER automatically triggers `Send to Anki`.
5. **Zero Video Playback Manipulation:** Normal mining never modifies `currentTime` or playback rate.

---

## 9. Phased Implementation Plan

The frontend redesign is partitioned into four small, safe, independently testable phases:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       STAGE 3B.3 IMPLEMENTATION PHASES                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  Phase 3B.3.1: Structured Dictionary Study View Renderer                    │
│  Phase 3B.3.2: Precision Dark Utility Design System Tokens & CSS Overhaul   │
│  Phase 3B.3.3: Card Editor, Word Hero, & Media Preview Refinement           │
│  Phase 3B.3.4: Accessibility, ARIA, & Keyboard Workflow Polish              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 3B.3.1: Structured Dictionary Study View Renderer
- **Objective:** Update `renderDetails()` in `sidepanel.js` to render the rich structured metadata returned by `CaptureResponse`.
- **Changes:**
  - Render pitch accent pills with Tokyo dialect downstep numbers and pattern names (`⓪ Heiban`, `① Atamadaka`, `② Nakadaka`, `③ Odaka`).
  - Render corpus frequency rank badges (`Netflix #180`, `BCCWJ #320`).
  - Render JLPT level badge (`JLPT N5`..`N1`).
  - Render sense-bound parts of speech (`[1-dan verb, transitive]`) and domain/usage tags (`[usually kana]`, `[math]`) attached directly to their respective senses.
  - Render ruby furigana in example sentences using semantic `<ruby>`, `<rb>`, and `<rt>` HTML elements.
  - Add progressive disclosure accordion for words with > 4 senses.
  - Add quick-insert buttons (`[↵]` to insert sense into Meaning, `[+ Example]` to insert example into card).
  - Preserve `#dict-raw-view`, `#btn-copy-raw-dict`, and `#btn-toggle-full-dict` behavior.
- **Verification:** Execute `node --test extension/tests/dictionary-study-view.test.js`.

### Phase 3B.3.2: Precision Dark Utility Design System Tokens & CSS Overhaul
- **Objective:** Modernize `sidepanel.css` using the token architecture defined in Section 3.
- **Changes:**
  - Replace hardcoded hex colors with CSS custom properties (`--bg-canvas`, `--text-primary`, `--accent-primary`, etc.).
  - Implement the refined 4px spacing scale and modest radii (4px/6px).
  - Implement high-contrast, accessible typography scale with optimized Japanese line-heights.
  - Apply clean hairline borders (`--border-default`) and eliminate heavy widget card containers.
  - Style responsive breakpoints down to 320px with zero horizontal overflow.
- **Verification:** Visual review in Chromium Side Panel across 320px, 400px, and 600px widths.

### Phase 3B.3.3: Card Editor, Word Hero, & Media Preview Refinement
- **Objective:** Redesign the Card Editor form, unboxed Word Hero, and media previews.
- **Changes:**
  - Refactor `#captured-word-section`: unbox the expression from the heavy card container and integrate the reading and pitch accent directly below it.
  - Refine form input styling in `#card-editor`: clear labels, `#211f1c` background, subtle borders, and 2px coral focus outline.
  - Modernize media preview cards: replace emojis with clean SVG/CSS badges (`IMG`, `AUD`), integrated progress bar for audio, and subtle delete buttons.
  - Refine Deck and Note Type selector row for narrow viewport flexibility.
  - Style the primary `[Save Card]` and secondary `[Send to Anki]` action buttons with explicit visual hierarchy.
- **Verification:** Execute `node --test extension/tests/sidepanel.test.js` and `extension/tests/sidepanel-media-ui.test.js`.

### Phase 3B.3.4: Accessibility, ARIA, & Keyboard Workflow Polish
- **Objective:** Finalize keyboard navigation, focus management, ARIA landmarks, and high-contrast accessibility.
- **Changes:**
  - Add `aria-live="polite"` to dynamic capture and dictionary regions.
  - Implement full keyboard shortcut handlers (<kbd>Ctrl+Enter</kbd>, <kbd>Ctrl+K</kbd>, <kbd>Ctrl+Shift+M</kbd>, <kbd>Ctrl+Shift+U</kbd>, <kbd>Esc</kbd>).
  - Ensure logical Tab ring order without focus traps.
  - Add `@media (prefers-reduced-motion: reduce)` rules for motion accessibility.
- **Verification:** Execute all 26 extension test suites via `node --test extension/tests/*.test.js`.

---

## 10. Comprehensive Verification & Regression Test Plan

Before claiming completion of any frontend phase, the following automated and manual test harness must pass:

### 10.1 Automated Test Suites

```bash
# 1. Full Extension Test Suite (All 26 suites, 0 failures required)
node --test extension/tests/*.test.js

# 2. Dictionary Study View Specific Unit Tests
node --test extension/tests/dictionary-study-view.test.js

# 3. Side Panel DOM Contract & State Machine Tests
node --test extension/tests/sidepanel.test.js

# 4. Media UI & Audio Waveform Tests
node --test extension/tests/sidepanel-media-ui.test.js
node --test extension/tests/audio-recording.test.js

# 5. Full Backend Regression Suite (159 tests, 0 failures required)
python -m pytest -v
```

### 10.2 Manual Smoke & Regression Checklist

| Test Case | Procedure | Expected Outcome |
| :--- | :--- | :--- |
| **1. Text Selection Mining** | Start mining, select `映画` on a Japanese web page. | Side Panel receives capture, identifies `映画`, enriches from Yomitan, populates expression/reading/meaning in editor, renders Study View with pitch `⓪ Heiban` and JLPT `N5`. |
| **2. Multi-Sense Synthesis** | Select `食べる` on a Japanese web page. | Editor meaning auto-populates `1. to eat\n2. to live on`. Study View displays both senses with sense-bound `[1-dan verb, transitive]`. |
| **3. High Polysemy Handling** | Select `掛ける` on a Japanese web page. | Top 4 senses displayed cleanly. Overflow accordion allows expanding remaining 21 senses without UI breakage. |
| **4. Explicit Card Save** | Click `[Save Card]` (or press <kbd>Ctrl+Enter</kbd>). | Card persisted to SQLite. Status badge transitions to `[SAVED]`. Session counter increments by 1. Send to Anki activates. |
| **5. Duplicate Detection** | Select `映画` again. | Status badge displays `[ALREADY SAVED]` (amber). Existing SQLite card record is loaded into editor. Session counter remains unchanged. |
| **6. Explicit Anki Sync** | Click `[Send to Anki]`. | Sync status transitions: `Pending` -> `Syncing…` -> `Synced`. Note created in Anki (or linked if existing). |
| **7. Anki Offline Resilience** | Disconnect Anki (close Anki desktop) and save a new card. | Card saves successfully in SQLite. Status shows `[SAVED]`. Sync status shows `Anki: Not connected`. Card data is NOT lost. |
| **8. Video Subtitle Mining** | Open YouTube/Netflix video, hover Japanese subtitle. | Auto-pause triggers (if enabled), subtitle text captures, frame screenshot captures, card editor populates image preview. |
| **9. Narrow Viewport Resizing** | Resize Side Panel to minimum width (320px). | Layout adapts to single column. Zero horizontal scrollbar. Text breaks cleanly without clipping. |
| **10. Keyboard Navigation** | Press <kbd>Ctrl+K</kbd>, then <kbd>Ctrl+Shift+M</kbd>, then <kbd>Ctrl+Enter</kbd>. | Focus jumps to Expression, then Meaning, then triggers Save Card. |

---

## 11. Design File Recommendation

### 11.1 Assessment of Existing `DESIGN.md`
As identified in `V1/Stage1.md` (Audit §8), the root `DESIGN.md` file currently contains an imported marketing website specification for Anthropic's Claude.com (referencing marketing bands, pricing tiers, and cream canvas backgrounds). This directly contradicts the dark, developer-utility Side Panel product requirements established in `AGENTS.md` and `ARCHITECTURE.md`.

### 11.2 Recommendation: Convert to Concise UI Specification in Stage 8
- **Action:** Retain `DESIGN.md` in root for now (as mandated by `AGENTS.md` locked rule: *"DESIGN.md must not be overwritten until architecture/design change tasks"*).
- **Target (Stage 8 / Documentation):** Convert `DESIGN.md` into the formal **Kiroku Note UI Specification** by replacing the marketing text with the tokens, typography scale, surface hierarchy, and DOM invariants defined in this document (`V1/Stage3B.3-Design.md`).
- **Archive:** Move legacy Claude marketing references to `docs/archive/DESIGN_LEGACY.md`.

---

## 12. Conclusion & Next Steps

This design specification establishes a clean, modern, and robust foundation for Kiroku Note's frontend. It honors all locked architectural invariants, preserves existing DOM contracts, elevates Japanese typography, and presents rich dictionary metadata through progressive disclosure.

**Next Immediate Stage:**
Proceed to **Stage 3B.3.1 Implementation** (Structured Dictionary Study View Renderer in `sidepanel.js`).
