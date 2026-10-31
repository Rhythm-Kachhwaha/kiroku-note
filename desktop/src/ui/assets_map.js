/**
 * Kiroku Note Desktop — Asset Mapping Registry
 * Single point of truth for mascot graphic slots and local visual assets.
 */

export const ASSET_MAP = {
  // Mascot Slots
  'home-companion-sphinx': {
    type: 'svg',
    path: './ui/assets/mascot/kiroku_cat.svg',
    alt: 'Kiroku Sphinx Cat Companion',
    hasPupilTracking: true
  },
  'grammar-attentive-study': {
    type: 'svg',
    path: './ui/assets/mascot/Cat typing.svg',
    alt: 'Cat Typing and Studying Grammar',
    lottiePath: './ui/assets/mascot/Cat typing.json'
  },
  'kanji-stroke-observing': {
    type: 'placeholder',
    label: 'Kanji Companion Slot'
  },
  'test-result-celebration': {
    type: 'svg',
    path: './ui/assets/mascot/rainbowcat_svg.svg',
    alt: 'Rainbow Celebration Cat',
    lottiePath: './ui/assets/mascot/rainbow cat.json'
  },
  'vocab-idle-reading': {
    type: 'placeholder',
    label: 'Vocab Companion Slot'
  },
  'test-exam-proctor': {
    type: 'placeholder',
    label: 'Proctor Mascot Slot'
  },
  'study-drill-cheer': {
    type: 'placeholder',
    label: 'Drill Companion Slot'
  },
  'settings-mechanic-cat': {
    type: 'placeholder',
    label: 'Settings Companion Slot'
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
        <img src="${asset.path}" alt="${asset.alt || ''}" class="mascot-svg-img" loading="eager" />
      </div>
    `;
  }

  return `
    <div class="mascot-slot mascot-slot-placeholder ${extraClass}" data-slot="${slotKey}" title="${asset.label || slotKey}">
      <span class="mascot-slot-label">[MASCOT: ${slotKey}]</span>
    </div>
  `;
}

