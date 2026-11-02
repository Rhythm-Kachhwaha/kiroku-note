# Kiroku Note — Design Decisions & Immutability Ledger

> [!IMPORTANT]
> **IMMUTABILITY CONTRACT & CONFIRMATION RULE**
> If an element, view, component, or layout is marked as **FINAL** in this document:
> - **NEVER** change its layout, colors, geometry, animations, or styling based on assumptions or offhand requests.
> - **ALWAYS** prompt the user explicitly for confirmation before altering any finalized component.
> - When in doubt, preserve existing implementation and ask for verification.

---

## 1. Finalized Components (LOCKED)

The following components are verified, polished, and locked against unconfirmed modifications:

### 1.1 Kanji Mastery Section
- **Status:** **FINAL**
- **Location:** `desktop/src/ui/views/kanji.js`, `desktop/src/ui/styles/bundle.css`
- **Locked Specifications:**
  - **Collapsed by default**: Kanji mastery grid does not render or fetch on view mount.
  - **Accordion trigger**: `#btn-toggle-kanji-browse` with 180° rotating chevron SVG (`transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1)`).
  - **Dropdown animation**: GPU CSS transition on `grid-template-rows: 0fr -> 1fr` (220ms duration, `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`) with inner `opacity: 0 -> 1` and `transform: translateY(-6px) -> 0`.
  - **Display Limit Selector**: `#kanji-limit-select` dropdown with choices:
    - First 36 (Sample)
    - Top 100
    - All [Level] Kanji (fetches up to 2,500 characters directly from `KanjiService.browse`)
  - **Mastery Card Grid**: Squircle cards (`.kanji-squircle-card`) with mini progress indicators (`.kanji-progress-bar`), live seen counts, and mastered status.
  - **Coloring**: Alpine Berry Yellow (`#F7E0BA`) for active/mastered states and tactile stroke ink black borders (`#151413`). Zero harsh yellow.

### 1.2 Bottom Navigation Dock & Animation
- **Status:** **FINAL**
- **Location:** `desktop/src/ui/shell/bottom_dock.js`, `desktop/src/ui/shell/shell.css`
- **Locked Specifications:**
  - **Geometry**: Floating pill dock (`border-radius: 9999px`) in Warm Paper (`#F5F1E8`) with `1.5px solid #151413` stroke and `4px 4px 0 #151413` hard drop shadow.
  - **Tabs (6 items)**: Home, Vocab, Grammar, Kanji, Test, Study.
  - **Active Indicator**: Sliding Vermilion (`#D94B38`) pill with white text and responsive physics.
  - **Interaction**: Keyboard arrow navigation with bounded rAF retry guard; active depression physics on press (`transform: translate(2px, 2px)`).

---

## 2. Established Core Palette

| Token | Hex | Semantic Role |
| :--- | :--- | :--- |
| `--pure-black` | `#000000` | Universal edge-to-edge pitch-black window ground for ALL tabs |
| `--ink-black` | `#141311` | Secondary sumi ink ground; dark element backplates |
| `--ink-surface` | `#1C1B19` | Elevated quiet card and container surfaces |
| `--elevated-surface` | `#2A2926` | Higher elevated pods, modals, dropdown menus |
| `--warm-paper` | `#F5F1E8` | Hand-pressed washi paper text and light pill surfaces |
| `--pure-black` | `#000000` | Mandatory pitch-black reading surface (KanjiVG canvas, JMdict) |
| `--tactile-stroke` | `#151413` | Crisp 1.5px border and zero-blur offset shadow ground |
| `--vermilion` | `#D94B38` | Primary stamp actions, navigation active pill, destructive cancel |
| `--alpine-berry` | `#F7E0BA` | Soft chamois gold; active filter pills, mastered kanji glow |
| `--organza-peach` | `#FBEEDA` | Delicate peach tint; subtle secondary badges and count tags |
| `--jade` | `#4EBB7B` | Mastered state, correct exam answers, active loopback telemetry |
| `--amber` | `#F59E0B` | Warning states, pending sync, intermediate mastery |

---

## 3. New Color Palette & Architectural Allocation Proposal

The following swatches represent incoming industrial-tactile tones. Below is the allocation strategy for agent implementation across future UI components:

```
[IRON CORE]              #222A2A  (RGB: 34, 42, 42)
[INDUSTRIAL AQUA]        #4FBBBC  (RGB: 79, 187, 188)
[RUST SIGNAL]            #EC4624  (RGB: 236, 70, 36)
[HEAT MARKER]            #F39120  (RGB: 243, 145, 32)
[ARCHITECTURAL CREAM]    #E2DAC2  (RGB: 226, 218, 194)
```

### 3.1 Allocation Plan

#### 1. Iron Core (`#222A2A`)
- **Visual Character**: Dense, slate-toned cool charcoal; softer and more industrial than pure `#141311`.
- **Target Applications**:
  - Code blocks, JSON/schema inspector containers, and debug telemetry consoles.
  - Secondary card inset wells (e.g. furigana decomposition preview boxes).
  - Background surface for grammar pattern visualizer blocks.

#### 2. Industrial Aqua (`#4FBBBC`)
- **Visual Character**: High-clarity cyan-mint; energetic without neon glare.
- **Target Applications**:
  - Grammar clause highlights and particle pills (`は`, `が`, `を` tags).
  - JLPT level indicators for intermediate milestones (e.g. N3 level accents).
  - Dictionary word type badges (Noun, Godan verb, Ichidan verb, Adjective).
  - External link affordances and stroke order guide vector overlays.

#### 3. Rust Signal (`#EC4624`)
- **Visual Character**: Urgent, earthy red-orange; higher contrast and punchier than standard vermilion.
- **Target Applications**:
  - Urgent action triggers (e.g. "Sync Error — Reconnect Anki", "Overwrite Card").
  - Test mode countdown timer warning (under 5 minutes remaining).
  - Incorrect answer feedback borders in test and study drill sessions.

#### 4. Heat Marker (`#F39120`)
- **Visual Character**: Vibrant industrial hazard orange; high visibility accent.
- **Target Applications**:
  - Study review streak flame counters and daily goal progression bars.
  - Question bank difficulty badges (Hard / Challenging questions).
  - Audio waveform active playback cursor in listening test sections.

#### 5. Architectural Cream (`#E2DAC2`)
- **Visual Character**: Dense, structural limestone cream; heavier and more substantial than `#F5F1E8`.
- **Target Applications**:
  - Table header backgrounds and reading passage sidecar borders.
  - Inactive filter pill backgrounds and secondary tactile button resting states.
  - Subtitle track annotation backplates in media studio.

---

### 3.2 Live Implementation: Grammar Studio Tab
Applied in desktop/src/ui/styles/bundle.css without modifying any UI structure:
- **Canvas Ground**: Pure Pitch Black (#000000).
- **Cards & Surfaces**: Dark iron-tinted ground (#161818) with crisp tactile stroke (#151413).
- **Iron Core (#222A2A)**: Formation rules container, encounters container, and syllabus item hover wells.
- **Industrial Aqua (#4FBBBC)**: Visualizer radar pulse dot & title, formation rule label & bullet, and example sentence ruby furigana.
- **Rust Signal (#EC4624)**: Primary sentence analysis action button stamp (#btn-analyze-sentence), visible error banner, brand kanji seal (.grammar-word-kanji), active learning mastery pill, and selected token chip border.
- **Heat Marker (#F39120)**: Character counter, quick examples label, compact token level pill (.token-level-tag), active syllabus level filter pills (.syllabus-level-pill.is-active), and mining history encounter count.
- **Architectural Cream (#E2DAC2)**: Grammar tokenized structure highlight chip boxes (.grammar-token-chip), desktop loading screen English wordmark (.word-kiroku), main pattern title (.point-title), example Japanese prose (.example-ja), syllabus pattern titles, and quick example chip text.
- **Pure Black (#000000)**: Highlighted glyph text inside cream token chips (.token-text), desktop loading screen high-contrast canvas ground.

---

---

## 4. Strict Design Rules & Anti-Slop Prohibitions

1. **NO MICRO-TAGS / PILL BADGES INSIDE ACTION BUTTONS OR HEADERS**:
   - **Rule**: Never append tiny capsule tags or mini-pills (e.g. \Dock\, \Mode\, \Extension Mode\, \Beta\) inside action buttons, tab triggers, or header labels.
   - **Reasoning**: Action buttons must be clean, deliberate, and direct. Tucking miniature capsule pills into buttons creates unnecessary visual noise, reads as generic AI slop, and degrades button readability.
   - **Permitted Badge Roles**: Badges are strictly restricted to legitimate data metadata (e.g. JLPT levels \N5..N1\, pitch accent \[0] 平板\, grammatical parts of speech, and card status like \Unsaved\).

---

## 5. Change Protocol

Whenever a request touches an interface element:
1. Consult this file first.
2. If the element is marked **FINAL**, halt implementation and respond with:
   - What the user is asking to change.
   - Why it is currently locked as final.
   - Explicit confirmation question asking if they want to override the decision.
3. If confirmed, update this document before modifying source code.

