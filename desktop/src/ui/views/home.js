/**
 * Kiroku Note Desktop — Home Screen View Controller
 * Clean, distraction-free landing companion view.
 * Displays the authentic svg_cat.svg mascot on a warm lit stage,
 * dynamic time-based manga speech greeting, and quick navigation launcher stickers.
 */

export class HomeView {
  constructor(router) {
    this.router = router;
    this.container = null;
  }

  getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) {
      return { ja: 'おはよう', en: 'ohayou — good morning, traveler.' };
    } else if (hour >= 11 && hour < 17) {
      return { ja: 'こんにちは', en: 'konnichiwa — good afternoon, traveler.' };
    } else if (hour >= 17 && hour < 22) {
      return { ja: 'おかえり', en: 'okaeri — welcome back, traveler.' };
    } else {
      return { ja: '今夜も勉強？', en: 'konya mo benkyou? — studying late tonight?' };
    }
  }

  async mount(container) {
    this.container = container;
    const greeting = this.getGreeting();

    this.container.innerHTML = `
      <div class="home-view-wrapper">
        <div class="home-view-container home-clean-container">
          <!-- Mascot & Dialogue Zone (Left Zone) -->
          <div class="home-left-zone home-clean-zone">
            <!-- Warm Lit Moon Stage Behind Mascot -->
            <div class="mascot-ambient-glow mascot-lit-stage" aria-hidden="true"></div>

            <!-- Manga Speech Burst Dialogue -->
            <div class="comic-speech-bubble" id="speech-bubble">
              <div class="comic-speech-inner">
                <div class="speech-header-row">
                  <span class="speech-greeting-ja">${greeting.ja}</span>
                </div>
                <p class="speech-subtitle-en">${greeting.en}</p>
              </div>
              <div class="comic-pointer-tail" aria-hidden="true"></div>
            </div>

            <!-- Mascot Stage: Authentic Static svg_cat.svg -->
            <div class="mascot-stage" id="mascot-stage" role="button" tabindex="0" title="Click for a cat greeting">
              <div class="mascot-stamp-badge">Kiroku Note</div>
              <div class="mascot-character-wrap" id="mascot-character-wrap">
                <img
                  id="home-mascot-cat"
                  src="./ui/assets/mascot/svg_cat.svg"
                  class="home-cat-img"
                  alt="Kiroku Note Cat Mascot"
                />
              </div>
            </div>
          </div>

          <!-- Quick Navigation Launcher Zone (Right Zone) -->
          <div class="home-right-zone">
            <div class="home-actions-header">
              <h2 class="home-actions-title">Study Hub</h2>
              <p class="text-sm text-secondary">Pick a desk to begin your Japanese study session.</p>
            </div>

            <div class="home-action-grid">
              <div class="home-action-card tactile-card" data-tab="vocab" role="button" tabindex="0" title="Open Vocabulary Desk">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title">Vocabulary Desk</div>
                  <div class="home-action-card-desc">Search JMdict, mine vocabulary cards, and annotate paragraphs.</div>
                </div>
              </div>

              <div class="home-action-card tactile-card" data-tab="grammar" role="button" tabindex="0" title="Open Grammar Studio">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title">Grammar Studio</div>
                  <div class="home-action-card-desc">Sentence patterns, formation rules, and syllabus progression.</div>
                </div>
              </div>

              <div class="home-action-card tactile-card" data-tab="kanji" role="button" tabindex="0" title="Open Kanji Tracer">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title">Kanji Tracer</div>
                  <div class="home-action-card-desc">KanjiVG stroke order, character wall, and compound words.</div>
                </div>
              </div>

              <div class="home-action-card tactile-card" data-tab="study" role="button" tabindex="0" title="Open Practice Drills">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title">Practice Drills</div>
                  <div class="home-action-card-desc">Targeted question practice with adaptive repetition scheduling.</div>
                </div>
              </div>

              <div class="home-action-card tactile-card" data-tab="test" role="button" tabindex="0" title="Open Examination">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title">JLPT Examination</div>
                  <div class="home-action-card-desc">Simulated official test blocks with section countdown timers.</div>
                </div>
              </div>

              <div class="home-action-card tactile-card" data-tab="settings" role="button" tabindex="0" title="Open Settings & Diagnostics">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title">Settings & System</div>
                  <div class="home-action-card-desc">Universal JLPT level, AnkiConnect, OCR daemon, and doctor.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupEvents();
  }

  setupEvents() {
    const mascotStage = document.getElementById('mascot-stage');
    const mascotWrap = document.getElementById('mascot-character-wrap');
    if (mascotStage && mascotWrap) {
      mascotStage.addEventListener('click', () => {
        mascotWrap.style.transform = 'translateY(-12px) scale(1.05)';
        setTimeout(() => {
          mascotWrap.style.transform = 'translateY(0) scale(1)';
        }, 180);
      });
    }

    const actionCards = this.container.querySelectorAll('.home-action-card');
    actionCards.forEach(card => {
      const tab = card.dataset.tab;
      if (!tab) return;

      const navigate = () => {
        this.router.navigateToTab(tab);
      };

      card.addEventListener('click', navigate);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate();
        }
      });
    });
  }

  unmount() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
