# Kiroku Note — Home Screen UI/UX Design Specification

> **Document Version:** 1.2.0  
> **Status:** Iterating / Open — **[SECTION 4.A TOP CHROME: LOCKED]**  
> **Target Platform:** Electron Desktop (Windows frameless shell) + Vanilla HTML/CSS/JS (Side Panel / Standalone prototype)  
> **Design Philosophy:** Editorial-first, tactile pop, warm Japanese minimalism, balanced with playful character animation.  
> **Primary Reference Inspiration:** [Planetoño](https://www.planetono.space/) (tactile physics, sticker bursts, hard offset shadows, responsive sound cues, spring animations).

---

## 1. Specification Governance & Locking Policy

1. **Iterative Updates Allowed:** This design specification is an active, living blueprint. The team/agent is free to refine, clarify, and update specifications during design exploration based on user feedback.
2. **Explicit UI Locking:** When the user explicitly requests to **"lock the UI"** or lock a specific component/feature, that section transitions to **`LOCKED`** status.
   - **LOCKED STATUS ACTIVE:** **Section 4.A (Top Navigation Bar / Chrome)** is officially **`LOCKED`**.
   - Layout geometry, spatial coordinates, color tokens, typography, mode badge styling, window dots, and interaction contracts for the Top Navigation Bar are frozen across all screens.
   - Subagents and implementers must strictly execute without introducing subjective visual divergences or layout drift.
   - Any further modifications to locked sections require an explicit user prompt to unlock.

---

## 2. Executive Summary & Aesthetic Synthesis

Kiroku Note is a local-first Japanese vocabulary, kanji, and grammar mining application. While most educational software defaults to generic SaaS dashboards (crowded cards, blue gradients, repetitive progress rings), Kiroku stands apart with an **editorial, character-driven, tactile Japanese pop atmosphere**.

### The Core Design Shift
1. **Standardized Locked Top Chrome:** The top navigation bar is permanently locked across all screens: frameless 48px height, 3 tactile window dots, letter-lifting `KIROKU` wordmark in Warm Paper ivory, golden-amber `NOTE ノート` tactile mode badge, and tactile History + spring-spinning Settings buttons.
2. **Mascot Anchored to Left:** The minimalist black cat mascot lives on the **left side** of the screen as your active study companion.
3. **Cursor-Following Eyes (Mascot Companion):** On the Home screen, the mascot's eyes actively follow the user's cursor around the screen in real time with smooth organic damping.
4. **Lottie Animation Architecture:** Rich character animation (idle breathing, body posture, ear twitches, celebration poses) will be powered by user-provided **Lottie animation files**, paired with an interactive pupil-tracking layer.
5. **Comic Speech Bubble Hierarchy:** The mascot speaks directly to the user. The dynamic Japanese greeting (e.g., おかえり, こんにちは) appears in an organic hand-drawn comic speech bubble anchored directly above the cat. Immediately below the greeting in the companion zone sits the **Today's Word** module with expandable sentences.
6. **Tactile Bottom Navigation:** The navigation bar is moved **below the main hero area** to the bottom of the window. Rather than a sterile app dock, it is a **spring-physics, tactile pill navigation system** inspired by Planetoño's sticker controls and Aceternity/MagicUI floating docks.
7. **Planetoño Influence:** Tactile button states (hard solid drop shadows that depress on click), subtle micro-sounds on hover/click, comic starburst accents (`✦`), and playful spring easing.

---

## 3. Planetoño Inspection Findings (Playwright Deep Dive)

Via Playwright automated inspection of `https://www.planetono.space/`, the following core design patterns were captured:

| Feature / Trait | Planetoño Implementation | Kiroku Note Adaptation |
|---|---|---|
| **Color Contrast & Canvas** | Bold solid canvas with high-contrast sticker elements | Ink Black (`#22211F`) canvas with Warm Paper (`#F5F1E8`) text & sticker bubbles, Vermilion (`#D94B38`) and Gold (`#C8A94A`) accents |
| **Buttons & Controls** | Rounded rectangles with 2–3px black outlines and hard offset shadows (`box-shadow: 3px 3px 0 #000`) | Tactile buttons with 1.5px solid borders and crisp 3px hard drop shadows that compress to 1px on `:active` |
| **Sticker / Badge Language** | Comic speech burst badge (`銀河バイト GALAXY BITE`) with hard shadow | Mascot speech bubble with organic comic curvature, sharp tail, and optional comic sparkle accents (`✦`) |
| **Navigation Placement & Motion** | Large, punchy typography with animated canvas/Rive items, sound hooks (`data-sound-hover="hover"`) | Dynamic bottom floating dock with spring-sliding active indicator, magnetic hover pull, and optional subtle mechanical click/hover micro-audio |
| **Typography Hierarchy** | Chunky display font (`Futura Passata`) alongside clean sans (`Poppins`) and Japanese characters (`惑星ちゃん`) | `Mochiy Pop One` for playful Japanese greetings, `Zen Old Mincho` for editorial accents, `Zen Kaku Gothic New` for study text, and `Inter` for clean UI numbers |
| **Interaction Feedback** | Immediate snappy feedback (`transform: translate(2px, 2px)` on click, spring recovery) | Zero floaty lag; all hover/click states use crisp spring curves (`cubic-bezier(0.34, 1.56, 0.64, 1)`) |

---

## 4. Spatial Layout & Grid Architecture

The desktop window is structured as a 3-tier vertical flex/grid layout:

```text
┌────────────────────────────────────────────────────────────────────────┐
│  ● ● ●  KIROKU [NOTE ノート]                        [History] [Settings]│ (Top Chrome: 48px - LOCKED)
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   LEFT ZONE (Mascot & Comic World)      RIGHT ZONE (Study Hub)         │
│   ┌─────────────────────────────┐       ┌──────────────────────────┐   │
│   │  COMIC SPEECH BUBBLE        │       │  EDITORIAL TITLE         │   │
│   │  "おかえり" (Greeting)     │       │  & STUDY STREAK          │   │
│   └──────────────┬──────────────┘       │  7-Day Tactile Dot Badge │   │
│                  ▼                      │                          │   │
│   ┌─────────────────────────────┐       │  CONTINUE DRILL          │   │
│   │  MASCOT (Lottie + Eye Track)│       │  [Continue: Grammar N3 →]│   │
│   │  Eyes follow cursor around  │       └──────────────────────────┘   │
│   │  Lottie-animated body/tail  │                                      │
│   └─────────────────────────────┘                                      │
│                  ▼                                                     │
│   ┌─────────────────────────────┐                                      │
│   │  TODAY'S WORD               │                                      │
│   │  静寂 (seijaku)             │                                      │
│   │  (Expands on hover)         │                                      │
│   └─────────────────────────────┘                                      │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│     [   Home   ·   Vocab   ·   Grammar   ·   Kanji   ·   Test   ·   Study   ]  │ (Bottom Nav Bar)
└────────────────────────────────────────────────────────────────────────┘
```

---

### A. Top Chrome (Frameless Header) — [LOCKED SPECIFICATION]

> **STATUS: LOCKED 🔒**  
> This specification is frozen across all application screens. Implementers must replicate these tokens, geometry, typography, and micro-interactions without alteration.

#### 1. Container & Structural Shell
- **Positioning:** Full-width sticky/fixed top bar, docked at `top: 0`, `left: 0`, `right: 0`.
- **Height:** Exactly `48px` (`h-12`).
- **Layout:** `display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0 20px;` (`px-5` / `px-6`).
- **Surface Color:** Solid deep sumi ink canvas `#141311` (`bg-[#141311]` or `bg-surface`).
- **Separation & Border:** Crisp 1px tactile lower border `border-b border-[#2A2926]` / `border-tactile-stroke` (`rgba(245, 241, 232, 0.08)`).
- **Z-Index & Interaction:** `z-50`, `select-none`, `pointer-events-auto`.

#### 2. Left Zone — Window Controls, Brand Wordmark & Mode Badge
- **Window Controls (Frameless macOS / Neo-Tactile Dots):**
  - Container: `flex items-center gap-2` (8px gap), `margin-right: 16px` (`mr-4`).
  - **Dot 1 (Close):** `10px` diameter (`w-2.5 h-2.5 rounded-full`), solid Vermilion `#D94B38`.
  - **Dot 2 (Minimise):** `10px` diameter (`w-2.5 h-2.5 rounded-full`), solid Gold `#C8A94A`.
  - **Dot 3 (Maximise / Muted):** `10px` diameter (`w-2.5 h-2.5 rounded-full`), muted warm paper tint `rgba(245, 241, 232, 0.25)` or `#3A3937`.
  - Micro-interaction: Subtle `scale(1.1)` on hover with smooth 150ms ease transition.

- **Brand Wordmark (`KIROKU`):**
  - Typography: `font-family: 'Zen Old Mincho', serif; font-weight: 700; text-transform: uppercase;`
  - Sizing & Tracking: `font-size: 17px` (`text-[17px]`), `letter-spacing: 0.14em` (`tracking-[0.14em]`).
  - Text Color: Warm Paper ivory `#F5F1E8` (`text-warm-paper`).
  - **Staggered Letter-Lift Micro-Interaction:** Each letter of `KIROKU` is enclosed in an inline-block span (`<span>K</span><span>I</span><span>R</span><span>O</span><span>K</span><span>U</span>`). On hover over the wordmark container, letters sequentially lift `translateY(-3px)` with a staggered transition delay (`0ms`, `25ms`, `50ms`, `75ms`, `100ms`, `125ms`) and spring recovery (`transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)`).

- **Mode Badge (`NOTE ノート`):**
  - Position: Placed immediately right of `KIROKU` with `margin-left: 12px` (`ml-3`).
  - Container: Tactile pill badge with `rounded-[6px]`, padding `2px 10px` (`px-2.5 py-0.5`), height `20px` (`h-5`).
  - Background: Solid Ochre/Gold `#C8A94A` (`bg-[#C8A94A]`).
  - Text Content: Exactly `NOTE ノート` (Latin uppercase bold + Japanese katakana).
  - Typography: `font-family: 'Inter', 'Zen Kaku Gothic New', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.08em;`
  - Text Color: Deep ink black `#151413` (`text-[#151413]`) for high contrast legibility.
  - Shadow & Elevation: 1px hard tactile offset drop shadow (`box-shadow: 1px 1px 0px #151413`).

#### 3. Right Zone — Tactile Action Buttons
- Container: `flex items-center gap-2.5` (`gap-[10px]`).
- **Button 1 — History (`History`):**
  - Container: Square tactile button, `32px × 32px` (`w-8 h-8 rounded-[8px]`).
  - Surface: Dark elevated container `#1C1B19` with 1px border `border-[rgba(245,241,232,0.12)]`.
  - Icon: SVG counter-clockwise circular arrow with clock hands, stroke `#F5F1E8`, stroke-width `1.75`, icon size `16px`.
  - Micro-interactions:
    - Hover: Background brightens to `#2A2926`, border color lightens to `rgba(245,241,232,0.25)`, icon nudges counter-clockwise `-15deg` (`transform: rotate(-15deg)`).
    - Active / Click: `transform: translate(1px, 1px)`.
- **Button 2 — Settings (`Settings`):**
  - Container: Square tactile button, `32px × 32px` (`w-8 h-8 rounded-[8px]`).
  - Surface: Dark elevated container `#1C1B19` with 1px border `border-[rgba(245,241,232,0.12)]`.
  - Icon: SVG mechanical gear (cog), stroke `#F5F1E8`, stroke-width `1.75`, icon size `16px`.
  - Micro-interactions:
    - Hover: Smooth 45° spring rotation (`transform: rotate(45deg); transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)`), background brightens to `#2A2926`.
    - Active / Click: `transform: rotate(45deg) translate(1px, 1px)`.

---

### B. Left Zone (Mascot + Comic Speech World)
- **Positioning:** Left 45% of the viewport.
- **Speech Bubble (Greeting):**
  - Shape: Asymmetric comic dialogue bubble with a hand-drawn feel (border-radius: `20px 20px 20px 4px`), sharp triangular tail pointing toward the mascot.
  - Greeting Text: Rendered in **Mochiy Pop One** at 36px–48px.
  - Tone: Natural Japanese greetings (`おかえり`, `こんにちは`, `おはよう`, `お疲れさま`, `今夜も勉強？`) selected by time-of-day.
  - Subtitle: Small romaji/English translation in `Zen Kaku Gothic New` (`okaeri — welcome back`) with low opacity (0.45).
- **Mascot (The Black Cat with Cursor-Tracking Eyes):**
  - Rendered in relaxed lying-down pose (sphinx / loaf).
  - Dark silhouette with subtle warm paper glow backdrop (`radial-gradient(ellipse, rgba(200,169,74,0.08) 0%, transparent 70%)`) ensuring high contrast on Ink Black `#22211F`.
  - **Lottie Runtime Integration:** Body movement, breathing, ear twitches, and tail animations are driven by user-supplied **Lottie animation files**.
  - **Eye & Pupil Tracking:** The gold ring eyes (`#C8A94A`) actively follow the user's cursor across the entire window in real time (using normalized vector offsets with smooth damping).
- **Today's Word (今日の言葉) Pod:**
  - Positioned directly beneath the mascot.
  - Displays the daily vocabulary item (e.g. `静寂` with furigana `せいじゃく`).
  - On hover: Expands smoothly in-place with spring easing, revealing definition (`silence · stillness`) and an authentic example sentence with bilingual translation.

### C. Right Zone (Editorial Hub & Quick Resumption)
- **Positioning:** Right 55% of the viewport.
- **Visual Tone:** Generous negative space, magazine-like typography, uncluttered.
- **Streak Tracker:**
  - Tactile 7-day dot/ring sequence. Active days filled with Vermilion (`#D94B38`) with hard mini-shadows; upcoming days outlined in soft paper border.
  - Label: `"7 DAY STREAK"` in uppercase mono-styled Inter with bold red counter.
- **Continue Action Card / Pill:**
  - Tactile sticker-button styled after Planetoño's buttons: Warm Paper background, crisp black stroke, and a 3px hard drop shadow (`box-shadow: 3px 3px 0 #000`).
  - Content: `"Continue: Grammar N3"` + animated arrow icon (`→`) that nudges right on hover.
  - Click feedback: Translates 2px down-right with shadow compressing to 1px.

### D. Bottom Navigation Bar (Non-Generic Tactile Dock)
- **Positioning:** Floating 20px above the bottom edge, centered horizontally.
- **Design:**
  - Glass-morphism is rejected. Instead, uses a solid Warm Paper (`#F5F1E8`) or Deep Ink container with a 1.5px border and subtle hard drop shadow.
  - Navigation Items:
    1. **Home** (ホーム)
    2. **Vocab** (語彙)
    3. **Grammar** (文法)
    4. **Kanji** (漢字)
    5. **Test** (テスト — JLPT Examination)
    6. **Study** (学習 — Review & Bank)
- **Motion & Transitions:**
  - **Sliding Indicator Pill:** A smoothly animating background pill that glides under the active tab using Framer Motion / FLIP spring physics.
  - **Magnetic Hover:** Items exert a slight pull towards the cursor when hovered.
  - **Typography:** English uppercase or title case paired with miniature Japanese subtext (e.g., `VOCAB` over `語彙`).
  - **Active State:** Vermilion accent highlight (`#D94B38`) with crisp color transition.

---

## 5. Typography & Color Palette

### Color Tokens
```css
:root {
  /* Canvas & Backgrounds */
  --ink-black:        #22211F;  /* Deep warm sumi ink */
  --ink-surface:      #2A2926;  /* Elevated cards / pods */
  --ink-border:       rgba(245, 241, 232, 0.12);

  /* Papers & Highlights */
  --warm-paper:       #F5F1E8;  /* Japanese washi paper tone */
  --paper-dim:        #E8E3D8;
  --paper-subtle:     rgba(245, 241, 232, 0.45);

  /* Brand Accents */
  --vermilion:        #D94B38;  /* Torii gate red - primary emphasis */
  --vermilion-glow:   rgba(217, 75, 56, 0.20);
  --gold-eye:         #C8A94A;  /* Cat eye gold & NOTE badge */
  
  /* Planetoño Tactile Shadows */
  --tactile-stroke:   #151413;
  --hard-shadow:      3px 3px 0px #151413;
  --hard-shadow-sm:   2px 2px 0px #151413;
  --hard-shadow-pressed: 1px 1px 0px #151413;
}
```

### Type System
| Role | Font Family | Fallback | Sizing & Weight |
|---|---|---|---|
| **Comic Greeting** | `Mochiy Pop One` | sans-serif | 36px–48px / Bold |
| **Brand Wordmark** | `Zen Old Mincho` | serif | 17px / 700 / Tracking: 0.14em |
| **Mode Badge** | `Inter` / `Zen Kaku Gothic New` | sans-serif | 11px / 700 / Tracking: 0.08em |
| **Japanese Text / Vocab** | `Zen Kaku Gothic New` | sans-serif | 16px–24px / 400 & 700 |
| **UI Labels & Numbers** | `Inter` | system-ui | 11px–14px / 500 & 600 |
| **Editorial Headings** | `Zen Old Mincho` | serif | 28px–36px / 400 |

---

## 6. Mascot Animation: Lottie Integration & Cursor Eye Tracking

### A. Lottie Architecture
- The mascot poses and idle motions will be provided as **Lottie animations (`.json` or `.dotlottie`)**.
- Runtime loader: Lightweight `lottie-web` (SVG/Canvas renderer) or `@lottiefiles/dotlottie-web`.
- Planned Lottie animation states:
  - `mascot-idle-lying.json`: Default relaxed loaf/sphinx pose with breathing and tail motion.
  - `mascot-sitting.json`: Attentive study state.
  - `mascot-reading.json`: Reading a book/scroll for vocabulary mining review.
  - `mascot-celebrate.json`: Happy reaction upon completing JLPT exam or streak milestone.

### B. Cursor-Following Eyes Formula & Layering
To allow the mascot's eyes to track the cursor freely while Lottie plays the body animation:
1. **Hybrid Layering Pattern:**
   - The Lottie file animates the body silhouette, breathing cycle, and ear movements.
   - The eye layer (gold sclera rings and pupils) is either:
     - Exposed as an identifiable DOM SVG group (`id="cat-pupil-left"`, `id="cat-pupil-right"`) inside the Lottie SVG output, **OR**
     - Overlaid cleanly on top as an interactive SVG eye tracking mask aligned to the cat's face anchor point.
2. **Eye Tracking Physics Formula:**
```javascript
// Bounded cursor vector tracking with damping
function trackCursor(event, leftEyeCenter, rightEyeCenter, pupilLeftEl, pupilRightEl) {
  const maxDistance = 4.0; // Max pupil travel distance in px

  function calculateOffset(eyeCenter) {
    const dx = event.clientX - eyeCenter.x;
    const dy = event.clientY - eyeCenter.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return { x: 0, y: 0 };
    
    // Non-linear damping for natural organic eye movement
    const travel = Math.min(maxDistance, Math.log1p(distance * 0.08) * 1.2);
    const angle = Math.atan2(dy, dx);
    return {
      x: Math.cos(angle) * travel,
      y: Math.sin(angle) * travel
    };
  }

  const offsetL = calculateOffset(leftEyeCenter);
  const offsetR = calculateOffset(rightEyeCenter);

  pupilLeftEl.style.transform = `translate(${offsetL.x.toFixed(2)}px, ${offsetL.y.toFixed(2)}px)`;
  pupilRightEl.style.transform = `translate(${offsetR.x.toFixed(2)}px, ${offsetR.y.toFixed(2)}px)`;
}
```

### C. Speech Bubble Expansion Physics
- Default state: Compact pill displaying Japanese kanji + reading + subtle "hover" badge.
- Expanded state: Expands smoothly in-place (animating `max-height` and `padding` using CSS custom cubic-bezier: `cubic-bezier(0.16, 1, 0.3, 1)` over 320ms).
- Content inside fades in with a 60ms stagger delay to prevent visual jumping.

### D. Bottom Nav FLIP Indicator
- The active pill uses the FLIP technique (First, Last, Invert, Play) or a sliding transform (`translateX`) matched to the `offsetLeft` and `offsetWidth` of the targeted nav button.
- Duration: 240ms with `cubic-bezier(0.25, 1, 0.5, 1)`.

---

## 7. Recommended Free UI & Animation Resources

The implementing agent should reference and adapt code patterns from these specific libraries:

### 1. [Aceternity UI](https://ui.aceternity.com/)
- **Floating Dock Component** (`/components/floating-dock`): Perfect architectural foundation for the bottom navigation bar with magnetic icon scaling and spring movement.
- **Card Spotlight / Hover Border Gradient**: For subtle warm paper glow effects around the mascot backdrop without overwhelming the eye.
- **Flip Words / Text Generate Effect**: For smooth transitions when switching the daily greeting or vocabulary word.

### 2. [React Bits](https://reactbits.dev/)
- **Elastic Slider / Dock**: Provides spring physics formulas for tab sliding.
- **Magnetic Button**: Wrap around the "Continue" action and bottom nav items for subtle cursor attraction.
- **Animated Tabs**: Minimalist zero-dependency tab state transitions.

### 3. [Magic UI](https://magicui.design/)
- **Dock**: Clean bottom dock with scale on hover and fluid icons.
- **Word Rotate / Morphing Text**: For time-of-day greeting transitions without layout shift.
- **Shimmer / Border Beam**: High-polish subtle edge illumination for active JLPT test mode pills.

### 4. [Uiverse.io](https://uiverse.io/)
- **Neo-Brutalist & Comic Buttons**: Pure CSS implementations of hard-shadowed tactile buttons (`box-shadow: 3px 3px 0 #000`) and comic speech badges.
- **Hand-drawn Speech Bubbles**: SVG and CSS polygon borders for asymmetric speech bubble tails.

### 5. [Animata](https://animata.design/)
- **Bouncing Pill**: Micro-interactions for streak indicators and status chips.
- **Expanding Cards / Accordions**: Fluid height-auto animations without jank.

### 6. [21st.dev](https://21st.dev/)
- **Modern Tailwind + Motion Primitives**: Search for "dock", "pill navigation", "mascot speech bubble", and "tactile card".

---

## 8. Step-by-Step Implementation Roadmap for Coding Agents

When executing the UI build, the coding agent must proceed in sequential, verifiable steps:

| Step | Scope | Deliverables & Verification Criteria |
|---|---|---|
| **Phase 1** | **Window Shell & Top Chrome [LOCKED]** | - Frameless window header (48px height) with drag region.<br>- Letter-lifting `KIROKU` wordmark (`Zen Old Mincho`, 17px, staggered 25ms lift).<br>- `NOTE ノート` tactile gold badge (`#C8A94A`, 11px bold, 1px hard shadow).<br>- Tactile window controls (10px dots: Vermilion `#D94B38`, Gold `#C8A94A`, Muted Gray).<br>- 32px rounded History button and Settings gear with 45° spring rotation.<br>- Verification: Window chrome strictly matches locked spec across all screens. |
| **Phase 2** | **Bottom Tactile Navigation Bar** | - Positioned at bottom center.<br>- 6 tabs: Home, Vocab, Grammar, Kanji, Test, Study.<br>- Sliding active indicator pill using spring easing.<br>- Tactile button depression on `:active`.<br>- Verification: Clicking tabs triggers smooth indicator slide with no layout shift. |
| **Phase 3** | **Mascot Placement & Lottie/Eye Tracking** | - Cat positioned on the left side in relaxed lying-down pose.<br>- Warm gold backdrop gradient for contrast on dark canvas.<br>- Lottie container configured for user-provided animations.<br>- Real-time cursor-following eye tracking with smooth vector bounds.<br>- Verification: Eyes follow cursor across full window without jank. |
| **Phase 4** | **Comic Speech Bubble & Greeting** | - Hand-drawn comic bubble anchored above the cat with tail pointing to the mascot.<br>- Greeting rendered in `Mochiy Pop One`.<br>- Time-aware greeting logic (Morning / Afternoon / Evening / Night).<br>- Verification: Bubble aligns naturally with the cat silhouette. |
| **Phase 5** | **Today's Word Pod (Expandable)** | - Located beneath the mascot/greeting cluster.<br>- Shows kanji + reading in compact mode.<br>- Smooth spring expansion on hover revealing meaning & example sentence.<br>- Clickable link to word details.<br>- Verification: Smooth expansion without page scrollbar flicker. |
| **Phase 6** | **Right Zone: Streak & Continue Action** | - 7-day tactile dot tracker.<br>- Planetoño-style tactile "Continue Drill" button with hard drop shadow.<br>- Arrow hover nudge and click compression.<br>- Verification: Active states feel physical and punchy. |
| **Phase 7** | **Section Transitions & Sound Hooks** | - Coordinated page-switch transitions (content slides in based on nav direction).<br>- Audio hooks (`data-sound-hover`, `data-sound-click`) prepared for optional micro-SFX.<br>- Full responsive check for landscape & portrait window sizes. |

---

## 9. Anti-Patterns & Boundaries (What NOT to Do)

- ❌ **Do NOT alter or drift the Top Navigation Bar.** Section 4.A is **LOCKED**.
- ❌ **Do NOT use glassmorphism or generic blur cards.** Kiroku is tactile and editorial, not an iOS clone.
- ❌ **Do NOT put a sidebar on the left on the Home page.** The mascot and dialogue bubble own the left side.
- ❌ **Do NOT crowd the screen with charts.** No circular radial progress bars, no bar charts, no clutter. Keep the right side minimal and quiet.
- ❌ **Do NOT use OS emojis.** All icons must be clean, accessible SVGs.
- ❌ **Do NOT redesign or overcomplicate the cat.** The cat is a minimalist black silhouette with gold ring eyes and a forehead crest. Preserve its identity strictly.
