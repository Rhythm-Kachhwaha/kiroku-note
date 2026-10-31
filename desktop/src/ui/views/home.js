/**
 * Kiroku Note Desktop — Home Screen View Controller
 * Clean, distraction-free landing companion view.
 * Displays the authentic svg_cat.svg mascot and dynamic time-based manga speech greeting.
 * Note: Service statuses reside strictly in the Settings tab.
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
          <!-- Mascot & Dialogue Zone -->
          <div class="home-left-zone home-clean-zone">
            <!-- Ambient Glow Behind Mascot -->
            <div class="mascot-ambient-glow" aria-hidden="true"></div>

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
  }

  unmount() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
