---
name: Sumi & Washi Neo-Tactile
colors:
  surface: '#141311'
  surface-dim: '#141311'
  surface-bright: '#3a3937'
  surface-container-lowest: '#0f0e0c'
  surface-container-low: '#1c1b19'
  surface-container: '#201f1d'
  surface-container-high: '#2b2a28'
  surface-container-highest: '#363532'
  on-surface: '#e6e2de'
  on-surface-variant: '#e1bfb9'
  inverse-surface: '#e6e2de'
  inverse-on-surface: '#31302e'
  outline: '#a88a84'
  outline-variant: '#59413d'
  surface-tint: '#ffb4a7'
  primary: '#ffb4a7'
  on-primary: '#680200'
  primary-container: '#f55f4a'
  on-primary-container: '#5b0200'
  inverse-primary: '#b02e1e'
  secondary: '#cac6be'
  on-secondary: '#31302b'
  secondary-container: '#484740'
  on-secondary-container: '#b8b5ad'
  tertiary: '#e4c461'
  on-tertiary: '#3c2f00'
  tertiary-container: '#c7a849'
  on-tertiary-container: '#4e3d00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdad4'
  primary-fixed-dim: '#ffb4a7'
  on-primary-fixed: '#410100'
  on-primary-fixed-variant: '#8e1308'
  secondary-fixed: '#e6e2d9'
  secondary-fixed-dim: '#cac6be'
  on-secondary-fixed: '#1c1c16'
  on-secondary-fixed-variant: '#484740'
  tertiary-fixed: '#ffe088'
  tertiary-fixed-dim: '#e4c461'
  on-tertiary-fixed: '#241a00'
  on-tertiary-fixed-variant: '#574500'
  background: '#141311'
  on-background: '#e6e2de'
  surface-variant: '#363532'
  ink-black: '#22211F'
  ink-surface: '#2A2926'
  ink-border: rgba(245, 241, 232, 0.12)
  tactile-stroke: '#151413'
  warm-paper: '#F5F1E8'
  paper-dim: '#E8E3D8'
  paper-subtle: rgba(245, 241, 232, 0.45)
  vermilion: '#D94B38'
  vermilion-glow: rgba(217, 75, 56, 0.20)
  gold-eye: '#C8A94A'
  gold-glow: rgba(200, 169, 74, 0.08)
typography:
  display-comic:
    fontFamily: Epilogue
    fontSize: 44px
    fontWeight: '800'
    lineHeight: 52px
    letterSpacing: -0.02em
  display-comic-mobile:
    fontFamily: Epilogue
    fontSize: 32px
    fontWeight: '800'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-editorial-lg:
    fontFamily: Noto Serif
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.01em
  headline-editorial-lg-mobile:
    fontFamily: Noto Serif
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: 0em
  headline-editorial-md:
    fontFamily: Noto Serif
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: 0em
  title-brand:
    fontFamily: Noto Serif
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: 0.12em
  body-editorial-lg:
    fontFamily: Noto Serif
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-editorial-md:
    fontFamily: Noto Serif
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  label-ui-bold:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.04em
  label-ui-caption:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.06em
  code-counter:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: -0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-sm: 1rem
  margin: 2rem
  margin-sm: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system defines an editorial-first Japanese pop minimalist aesthetic with tactile comic sensibilities. Built intentionally as an antidote to sterile, metric-heavy SaaS dashboards, the visual tone blends traditional Japanese print craftsmanship (sumi ink saturation, warm fibrous washi paper) with playful neo-tactile character design inspired by physical vinyl stickers, manga dialog panels, and retro desktop utility companions.

The emotional atmosphere is intimate, focused, and quietly encouraging. Rather than inducing cognitive fatigue through high-density data visualizations or ambient glassmorphism, the UI feels like a crafted physical desk pad: deliberate, grounded, and subtly reactive.

Key visual pillars:
- **Neo-Tactile Physicality**: Solid black ink strokes paired with crisp, zero-blur directional offset drop shadows. Interactive components act like physical paper stickers or mechanical keycaps that physically compress when pressed.
- **Manga & Pop Editorial**: Dynamic asymmetry, dialogue bursts with tailored corner radii, and comic typographic hierarchy set against expansive negative space.
- **Restrained Chromatic Rhythm**: A deep matte sumi ink canvas punctured by warm organic paper sheets, vermilion shrine stamps, and vivid gold feline accents.

## Colors

The palette operates under an enforced dark ink-and-paper paradigm without automatic theme switching. The environment mimics nighttime study illuminated by low ambient warmth.

- **Primary (`#D94B38` / Vermilion)**: Evoking Japanese Torii gates and traditional red hanko seal stamps. Used strictly for high-urgency CTAs, active streak counters, critical notifications, and close affordances.
- **Secondary (`#F5F1E8` / Warm Paper)**: Derived from hand-pressed washi paper. Acts as the primary readable text layer, inverted study cards, high-contrast action pods, and floating sticker badges.
- **Tertiary (`#C8A94A` / Gold Eye)**: Applied to companion feline accents, sclera rings, milestone rewards, and secondary window chrome details.
- **Neutral (`#22211F` / Ink Black)**: The deep, non-harsh sumi ink floor. It anchors the viewport without the eye fatigue of pure `#000000`.

Borders and outlines rely on two explicit tiers: low-contrast ambient borders (`rgba(245, 241, 232, 0.12)`) for quiet structural pods, and dense tactile strokes (`#151413`) for interactive physical elements and offset shadow fills.

## Typography

The typographic hierarchy establishes a rhythm between expressive comic bursts, literary editorial text, and utilitarian interface tracking.

1. **Expressive Comic Role (`Epilogue`)**: High-impact geometric display weights drive speech bubble dialogue, mascot reactions, and exclamation bursts. Its punchy curves capture the hand-drawn energy of pop lettering.
2. **Editorial Literary Role (`Noto Serif`)**: Grounds vocabulary lists, chapter titles, prose excerpts, and brand mark headers. Its calligraphic weight contrasts sharply with the technical dark UI canvas.
3. **Operational Interface Role (`Inter`)**: Strictly handles tabular data, keyboard shortcuts, streak count badges, time meters, and micro-labels. Letter spacing is slightly expanded on uppercase captions to ensure crisp legibility on dark ink backdrops.

## Layout & Spacing

The layout is structured around an asymmetrical dual-zone editorial model rather than a uniform symmetric grid:

- **Desktop (1024px and above)**: A split-view canvas with a fixed top chrome (48px to 52px). The horizontal space is divided into:
  - **Companion & Narrative Stage**: 45% of viewport width (pinned mascot stage, ambient speech bursts, relaxed breathing room).
  - **Study Hub & Content Column**: 55% of viewport width (scrollable reading feed, interactive pods, flash drills).
- **Tablet (768px – 1023px)**: Reflows into a single-column layout where the character stage collapses into a compact floating top anchor (height bounded to 220px), followed by stacked study cards with `1.5rem` margins.
- **Mobile (< 768px)**: Mascot scales to an inline avatar pod or header companion; navigation docks permanently to a floating bottom pill bar elevated `16px` above the safe area edge. Gutters compress to `1rem`.

Component padding strictly adheres to the defined space tokens: `space-xs` (4px) for badge and chip insets, `space-md` (16px) for interior card padding, and `space-xl` (40px) for macro section separation.

## Elevation & Depth

This system outright forbids glassmorphism, progressive back-surface blurs, and soft, diffused drop shadows. Depth is purely tactile and physical, achieved through flat, hard-edged offset geometry that mimics die-cut stickers and mechanical keys.

### The Offset Mechanical Model
- **Rest State**: Elements sit flat or hover with a hard directional offset: `box-shadow: 3px 3px 0px #151413`.
- **Hover State**: Elements lift slightly: `transform: translate(-1px, -1px)` with shadow expanding to `4px 4px 0px #151413`.
- **Active / Pressed State**: The surface physically depresses downward: `transform: translate(2px, 2px)` while the shadow compresses to `1px 1px 0px #151413`.

### Atmospheric Depth
Quiet surface cards (`ink-surface`) sit flush on the `#22211F` canvas with no shadow, defined only by a crisp `1px solid rgba(245, 241, 232, 0.12)` border. A subtle radial glow (`radial-gradient(ellipse, rgba(200, 169, 74, 0.08) 0%, transparent 70%)`) is permitted exclusively behind character illustrations to isolate dark foreground silhouettes from the sumi background.

## Shapes

The shape system blends structured rounded rectangles (`roundedness: 2`, 8px base radius) with deliberately asymmetrical manga callouts:

- **Standard Cards & Containers**: Use `0.5rem` (8px) corner radii for internal containers and `1rem` (16px) for major elevated study pods.
- **Tactile Buttons & Chips**: Utilize either full pill caps (`border-radius: 9999px`) or `0.75rem` (12px) radiused sticker profiles.
- **Speech & Reaction Bubbles**: Asymmetric comic border radii: `20px 20px 20px 4px`. The tight 4px corner creates a natural dialogue pointer anchoring the bubble to the speaker without requiring separate SVG tails.
- **Window & Control Badges**: Strict circles (`50%` radius) for status pips and circular dot indicators.

## Components

### Buttons
- **Primary Action (Tactile Stamp)**: Solid `#D94B38` (Vermilion) background, `#F5F1E8` label, `1.5px solid #151413` stroke, `box-shadow: 3px 3px 0 #151413`. Active state: `translate(2px, 2px)` with shadow collapsing to `1px 1px 0 #151413`.
- **Paper Action (Sticker Button)**: Solid `#F5F1E8` (Warm Paper) background, `#151413` label, `1.5px solid #151413` stroke, `box-shadow: 3px 3px 0 #151413`.
- **Ghost Utility**: Transparent fill, `1px solid rgba(245, 241, 232, 0.12)`, text in `#F5F1E8`. On hover, border turns solid `#F5F1E8` with `translateY(-1px)`.

### Speech & Dialogue Bubbles
- Background: `#F5F1E8` (Warm Paper).
- Text: `#151413` set in `Epilogue` (Display Comic).
- Stroke: `1.5px solid #151413`.
- Shadow: `3px 3px 0 #151413`.
- Shape: Asymmetric `20px 20px 20px 4px`.
- Secondary subtitle/romaji: Nested inside with opacity `0.55` in clean sans-serif.

### Cards & Pods
- **Study Hub Pod (Quiet)**: Background `#2A2926`, border `1px solid rgba(245, 241, 232, 0.12)`, radius `16px`, padding `space-md` (16px) to `space-lg` (24px).
- **Hero / "Continue" Card (Tactile)**: Background `#F5F1E8`, text `#151413`, border `2px solid #151413`, shadow `3px 3px 0 #000000`, containing directional action pills with micro-animated arrow translation on hover.

### Chips & Streak Trackers
- Streak dot components render as a horizontal row of 7 circular indicators.
- **Active / Completed Days**: Solid `#D94B38` fill with `1.5px solid #151413` and `2px 2px 0 #151413` shadow.
- **Upcoming / Inactive Days**: Transparent fill with `1px dashed rgba(245, 241, 232, 0.35)`.

### Inputs & Text Entry
- Background: `#22211F`.
- Border: `1.5px solid rgba(245, 241, 232, 0.20)`.
- Corner radius: `8px`.
- Padding: `10px 14px`.
- Text color: `#F5F1E8`.
- Focus state: Border transitions to `#C8A94A` with hard outline offset `2px 2px 0 #C8A94A`, zero blur.

### Floating Dock / Navigation
- Dock container: Floating pill shape (`border-radius: 9999px`) offset `20px` from viewport bottom.
- Background: `#F5F1E8` (Warm Paper) with `1.5px solid #151413` border and `4px 4px 0 #151413` drop shadow.
- Nav Items: Monochromatic `#151413` icons. Active item features a circular `#D94B38` background indicator with white glyph.