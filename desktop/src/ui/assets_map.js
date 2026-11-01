/**
 * Kiroku Note Desktop — Asset Mapping Registry
 * Single point of truth for mascot graphic slots and local visual assets.
 */

export const ASSET_MAP = {
  // Mascot Slots
  'home-companion-sphinx': {
    type: 'svg',
    path: './ui/assets/mascot/svg_cat.svg',
    alt: 'Kiroku Cat Companion',
    hasPupilTracking: true
  },
  'grammar-attentive-study': {
    type: 'svg',
    path: './ui/assets/mascot/Cat typing.svg',
    alt: 'Cat Typing and Studying Grammar',
    lottiePath: './ui/assets/mascot/Cat typing.json'
  },
  'kanji-stroke-observing': {
    type: 'svg',
    path: './ui/assets/mascot/Black Cat Green Eyes Peeping.svg',
    alt: 'Black Cat Observing Kanji Strokes'
  },
  'test-result-celebration': {
    type: 'svg',
    path: './ui/assets/mascot/rainbowcat_svg.svg',
    alt: 'Celebration Cat',
    lottiePath: './ui/assets/mascot/rainbow cat.json'
  },
  'vocab-idle-reading': {
    type: 'svg',
    path: './ui/assets/mascot/Cat typing.svg',
    alt: 'Reading Cat'
  },
  'test-exam-proctor': {
    type: 'svg',
    path: './ui/assets/mascot/svg_cat.svg',
    alt: 'Exam Proctor Cat'
  },
  'study-drill-cheer': {
    type: 'svg',
    path: './ui/assets/mascot/rainbowcat_svg.svg',
    alt: 'Practice Cheer Cat'
  },
  'settings-mechanic-cat': {
    type: 'svg',
    path: './ui/assets/mascot/Cat typing.svg',
    alt: 'Settings Assistant Cat'
  }
};

/**
 * Helper to render an asset slot container into HTML
 * @param {string} slotKey
 * @param {string} extraClass
 * @returns {string} HTML string
 */
export function renderAssetSlot(slotKey, extraClass = '') {
  const asset = ASSET_MAP[slotKey];
  if (!asset) {
    return `<div class="mascot-slot mascot-slot-empty ${extraClass}" data-slot="${slotKey}"></div>`;
  }

  if (asset.type === 'svg' && asset.path) {
    return `
      <div class="mascot-slot mascot-slot-svg ${extraClass}" data-slot="${slotKey}">
        <div class="mascot-lit-stage"></div>
        <img src="${asset.path}" alt="${asset.alt || ''}" class="mascot-svg-img" loading="eager" />
      </div>
    `;
  }

  return `
    <div class="mascot-slot mascot-slot-empty ${extraClass}" data-slot="${slotKey}"></div>
  `;
}

/**
 * Progressive enhancement helper to initialize vendored Lottie vector animations
 * into a mascot slot container. Falls back silently to static SVG if Lottie is not active.
 *
 * @param {HTMLElement} container DOM element containing the slot
 * @param {string} slotKey Asset key from ASSET_MAP
 * @returns {Promise<any>} Lottie animation instance or null
 */
export async function initLottieSlot(container, slotKey) {
  const asset = ASSET_MAP[slotKey];
  if (!asset || !asset.lottiePath || typeof window === 'undefined' || !window.lottie || !container) {
    return null;
  }

  try {
    const res = await fetch(asset.lottiePath);
    if (!res.ok) return null;
    const animationData = await res.json();
    container.innerHTML = '';
    return window.lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData
    });
  } catch (err) {
    console.debug(`[AssetsMap] Lottie animation for ${slotKey} not loaded, static SVG active:`, err.message);
    return null;
  }
}
