/**
 * Kiroku Note Desktop — Home Screen View Controller
 * Authentic svg_cat.svg mascot, dynamic manga greeting, and quick action launchpad.
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
        <div class="home-view-container">
          <!-- Mascot & Dialogue Zone (Left) -->
          <div class="home-left-zone">
            <!-- Ambient Glow Behind Mascot -->
            <div class="mascot-ambient-glow" aria-hidden="true"></div>

            <!-- Manga Speech Burst Dialogue -->
            <div class="comic-speech-bubble" id="speech-bubble">
              <div class="comic-speech-inner">
                <div class="speech-header-row">
                  <span class="speech-greeting-ja">${greeting.ja}</span>
                </div>
                <p class="speech-subtitle-en">${greeting.en}</p>
                <div class="speech-footer-row">
                  <span class="speech-status-label">LOCAL COMPANION · ACTIVE</span>
                  <span class="speech-status-dot"></span>
                </div>
              </div>
              <div class="comic-pointer-tail" aria-hidden="true"></div>
            </div>

            <!-- Mascot Stage: Authentic Static svg_cat.svg -->
            <div class="mascot-stage" id="mascot-stage" role="button" tabindex="0" title="Click for a cat greeting">
              <div class="mascot-stamp-badge">SUMI · 墨</div>
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

          <!-- Quick Action Launchpad (Right) -->
          <div class="home-right-zone">
            <div class="home-actions-header">
              <span class="font-mono text-xs tracking-widest text-gold uppercase">STUDY LAUNCHPAD · クイックアクセス</span>
              <h2 class="home-actions-title">What would you like to study?</h2>
              <p class="home-actions-sub text-secondary text-sm">Select an activity or press number keys 1–6 on the bottom navigation dock.</p>
            </div>

            <div class="home-action-grid">
              <!-- Action 1: Vocab -->
              <div class="tactile-card tactile-card-interactive home-action-card" id="card-nav-vocab" role="button" tabindex="0">
                <div class="home-action-icon-wrap">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
                  </svg>
                </div>
                <div class="home-action-content">
                  <h3 class="home-action-card-title">Vocabulary &amp; Mining</h3>
                  <p class="home-action-card-desc">Look up Japanese words, pitch accents, and mine directly to Anki.</p>
                </div>
              </div>

              <!-- Action 2: Grammar -->
              <div class="tactile-card tactile-card-interactive home-action-card" id="card-nav-grammar" role="button" tabindex="0">
                <div class="home-action-icon-wrap">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3h7zM4 5h3v4H4V5zm13 0h3v4h-3V5zm3 14h-3v-4h3v4z"/>
                  </svg>
                </div>
                <div class="home-action-content">
                  <h3 class="home-action-card-title">Grammar Studio</h3>
                  <p class="home-action-card-desc">Analyze sentences, inspect token structures, and browse the JLPT syllabus.</p>
                </div>
              </div>

              <!-- Action 3: Practice Drills -->
              <div class="tactile-card tactile-card-interactive home-action-card" id="card-nav-study" role="button" tabindex="0">
                <div class="home-action-icon-wrap">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M19 2H6c-1.2 0-2 .8-2 2v16c0 1.2.8 2 2 2h13c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h12v12H6V4zm0 16v-2h12v2H6z"/>
                  </svg>
                </div>
                <div class="home-action-content">
                  <h3 class="home-action-card-title">Practice Drills</h3>
                  <p class="home-action-card-desc">Spaced repetition question practice with deterministic objective grading.</p>
                </div>
              </div>

              <!-- Action 4: JLPT Exam Simulation -->
              <div class="tactile-card tactile-card-interactive home-action-card" id="card-nav-test" role="button" tabindex="0">
                <div class="home-action-icon-wrap">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z"/>
                  </svg>
                </div>
                <div class="home-action-content">
                  <h3 class="home-action-card-title">JLPT Exam Simulation</h3>
                  <p class="home-action-card-desc">Full timed examination practice under official section countdown constraints.</p>
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
    // Mascot click animation
    const mascotStage = document.getElementById('mascot-stage');
    const mascotWrap = document.getElementById('mascot-character-wrap');
    if (mascotStage && mascotWrap) {
      mascotStage.addEventListener('click', () => {
        mascotWrap.style.transform = 'translateY(-12px) scale(1.05)';
        setTimeout(() => {
          mascotWrap.style.transform = 'translateY(0) scale(1)';
        }, 220);
      });
      mascotStage.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          mascotStage.click();
        }
      });
    }

    // Quick Action Card Navigation
    const navBindings = [
      { id: 'card-nav-vocab', tab: 'vocab' },
      { id: 'card-nav-grammar', tab: 'grammar' },
      { id: 'card-nav-study', tab: 'study' },
      { id: 'card-nav-test', tab: 'test' }
    ];

    for (const binding of navBindings) {
      const el = document.getElementById(binding.id);
      if (el) {
        el.addEventListener('click', () => {
          this.router.navigateToTab(binding.tab);
        });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.router.navigateToTab(binding.tab);
          }
        });
      }
    }
  }

  unmount() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
