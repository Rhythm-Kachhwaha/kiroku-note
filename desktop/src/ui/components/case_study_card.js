/**
 * Animata Case Study Card Component
 * Reference: https://animata.design/docs/card/case-study-card
 *
 * Direct implementation of Animata Case Study Card adapted for Kiroku Note desktop.
 * Structure:
 * - ContentCard: Content rendering mode for text + metadata + optional image/logo
 * - SimpleImageCard: Image-only rendering mode
 * - HoverRevealSlip: 3D perspective viewport, static back cover, left-hinged front card, sliding tab
 * - CaseStudyCard: Main wrapper component connecting link and vocabulary data
 *
 * Golden Rule: Zero emojis anywhere across UI, copy, buttons, badges, logs, templates, or code.
 */

/**
 * ContentCard Component for rendering vocabulary text + metadata + optional image/logo
 * Matches Animata ContentCard with Kiroku Japanese vocabulary adaptations.
 */
export function ContentCard({
  title = '',
  category = 'WORD OF THE DAY',
  reading = '',
  romaji = '',
  meaning = '',
  image = '',
  logo = ''
} = {}) {
  const bgStyle = image
    ? `background-image: url('${image}'); background-size: cover; background-position: center;`
    : '';

  return `
    <div class="animata-content-card" style="${bgStyle}">
      ${image ? `<div class="animata-content-image-overlay" aria-hidden="true"></div>` : ''}

      <div class="animata-content-header">
        ${category ? `<div class="animata-category font-sans">${category}</div>` : ''}

        ${title ? `
          <div class="animata-title-group">
            <ruby class="animata-title font-japanese">${title}${reading ? `<rt class="animata-reading font-japanese">${reading}</rt>` : ''}</ruby>
            ${romaji ? `<span class="animata-romaji font-sans">${romaji}</span>` : ''}
          </div>
        ` : ''}
      </div>

      <div class="animata-content-footer">
        ${meaning ? `<div class="animata-gloss font-sans">${meaning}</div>` : ''}
        ${logo ? `<img src="${logo}" alt="${title}" class="animata-logo" />` : ''}
      </div>
    </div>
  `;
}

/**
 * SimpleImageCard Component for rendering only an image
 * Matches Animata SimpleImageCard.
 */
export function SimpleImageCard({ image = '', title = '' } = {}) {
  const bgStyle = image
    ? `background-image: url('${image}'); background-size: cover; background-position: center;`
    : 'background-color: var(--case-study-bg-front, var(--ink-surface, #1C1B19));';

  return `
    <div class="animata-simple-image-card" style="${bgStyle}" role="img" aria-label="${title}"></div>
  `;
}

/**
 * HoverRevealSlip Component
 * 3D perspective viewport holding:
 * 1. Static back cover
 * 2. Left-hinged front card (rotateY -30deg on hover, 500ms transition)
 * 3. Sliding tab emerging from behind (translateX + rotate 5deg on hover, 300ms transition)
 */
export function HoverRevealSlip({ show = '', backContent = '', tabLabel = 'READ WORD' } = {}) {
  return `
    <div class="animata-case-study-slip group/study">
      <!-- Back cover - static -->
      <div class="animata-back-cover" aria-hidden="true">
        ${backContent}
      </div>

      <!-- Card container with slight book opening effect on hover -->
      <div class="animata-card-hinge">
        <!-- Front side of the card -->
        <div class="animata-card-front">
          ${show}
        </div>
      </div>

      <!-- Sliding link/tab coming out from behind -->
      <div class="animata-sliding-tab" aria-hidden="true">
        <div class="animata-tab-label">${tabLabel}</div>
      </div>
    </div>
  `;
}

/**
 * Helper to render the static back cover content
 * Revealed when the front cover card swings open around its left hinge.
 */
function renderBackCoverContent({
  jlpt = '',
  partOfSpeech = '',
  exampleSentence = '',
  exampleFurigana = '',
  exampleTranslation = ''
} = {}) {
  return `
    <div class="animata-back-inner">
      <div class="animata-back-header">
        <div class="animata-back-badges">
          ${jlpt ? `<span class="animata-pill-jlpt font-sans">${jlpt}</span>` : ''}
          ${partOfSpeech ? `<span class="animata-pill-pos font-sans">${partOfSpeech}</span>` : ''}
        </div>
        <span class="animata-back-indicator font-sans">KIROKU</span>
      </div>

      <div class="animata-back-body">
        ${exampleSentence ? `
          <div class="animata-example-block">
            <p class="animata-example-ja font-japanese">${exampleFurigana || exampleSentence}</p>
            ${exampleTranslation ? `<p class="animata-example-en font-sans">${exampleTranslation}</p>` : ''}
          </div>
        ` : `
          <div class="animata-back-placeholder">
            <span class="font-japanese animata-watermark">記録</span>
          </div>
        `}
      </div>
    </div>
  `;
}

/**
 * Main CaseStudyCard Component
 * Wraps HoverRevealSlip in a block link for navigation.
 */
export function CaseStudyCard({
  title = '',
  category = 'WORD OF THE DAY',
  link = '#vocab',
  image = '',
  logo = '',
  type = 'content',
  reading = '',
  romaji = '',
  meaning = '',
  jlpt = '',
  partOfSpeech = '',
  exampleSentence = '',
  exampleFurigana = '',
  exampleTranslation = '',
  tabLabel = 'READ WORD',
  id = 'daily-word-stamp'
} = {}) {
  const show = type === 'content'
    ? ContentCard({
        title,
        category,
        image,
        logo,
        reading,
        romaji,
        meaning
      })
    : SimpleImageCard({
        image,
        title
      });

  const backContent = renderBackCoverContent({
    jlpt,
    partOfSpeech,
    exampleSentence,
    exampleFurigana,
    exampleTranslation
  });

  return `
    <div class="home-daily-word daily-vocab-stamp animata-case-study-wrapper"
         id="${id}"
         role="region"
         aria-label="Word of the day: ${title}${reading ? ` (${reading})` : ''}${meaning ? ` - ${meaning}` : ''}">
      <a href="${link}" class="animata-case-study-card-link" id="btn-daily-word-open" title="Open ${title} in Vocabulary Desk">
        ${HoverRevealSlip({
          show,
          backContent,
          tabLabel
        })}
      </a>
    </div>
  `;
}

export default CaseStudyCard;

