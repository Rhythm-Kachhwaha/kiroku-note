/**
 * Kiroku Note Desktop — Home Screen View Controller
 * Pixel-identical locked Home Screen with interactive companion mascot, cursor-tracking eyes,
 * comic speech bubble greeting, Today's Word module, tactile study streak, and quick drill launcher.
 */

import { apiClient } from '../services/api_client.js';

export class HomeView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.catSvg = null;
    this.pupilLeft = null;
    this.pupilRight = null;
    this.targetX = 0;
    this.targetY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.animFrameId = null;
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.updateEyes = this.updateEyes.bind(this);
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
          <!-- LEFT ZONE: Mascot & Comic Narrative (45% desktop) -->
          <div class="home-left-zone">
            <!-- Ambient Glow Behind Mascot -->
            <div class="mascot-ambient-glow" aria-hidden="true"></div>

            <!-- Manga Speech Burst Dialogue -->
            <div class="comic-speech-bubble" id="speech-bubble">
              <div class="comic-speech-inner">
                <div class="speech-header-row">
                  <span class="speech-greeting-ja">${greeting.ja}</span>
                  <span class="speech-level-tag">LV.28</span>
                </div>
                <p class="speech-subtitle-en">${greeting.en}</p>
                <div class="speech-footer-row">
                  <span class="speech-status-label">SESSION READY</span>
                  <span class="speech-status-dot"></span>
                </div>
              </div>
              <div class="comic-pointer-tail" aria-hidden="true"></div>
            </div>

            <!-- Mascot Stage: Embedded Vector Cat with Interactive Pupil Tracking -->
            <div class="mascot-stage" id="mascot-stage">
              <div class="mascot-stamp-badge">SUMI · 墨</div>
              <div class="mascot-character-wrap" id="mascot-character-wrap">
                <svg id="home-cat-svg" class="home-cat-svg" viewBox="0 0 736 736" width="100%" role="img" aria-label="Kiroku Black Cat Companion">
                  <defs>
                    <!-- Eye Clip Paths -->
                    <clipPath id="left-eye-clip">
                      <ellipse cx="280" cy="455" rx="34" ry="24" transform="rotate(-8 280 455)" />
                    </clipPath>
                    <clipPath id="right-eye-clip">
                      <ellipse cx="448" cy="490" rx="36" ry="25" transform="rotate(12 448 490)" />
                    </clipPath>
                  </defs>

                  <!-- Base Cat Silhouette & Ears Vector Path -->
                  <g fill="#181715" stroke="#151413" stroke-width="2">
                    <!-- Cat Body & Head Silhouette -->
                    <path d="M 180 320 C 140 220 220 180 260 250 C 330 220 410 230 460 270 C 510 210 590 240 550 350 C 620 430 600 560 520 630 C 440 680 280 670 200 600 C 140 530 140 400 180 320 Z" />
                    <!-- Left Ear Inner -->
                    <path d="M 200 290 Q 230 210 250 255 Z" fill="#2A2926" />
                    <!-- Right Ear Inner -->
                    <path d="M 480 285 Q 520 230 535 315 Z" fill="#2A2926" />
                  </g>

                  <!-- Left Eye Socket -->
                  <g id="eye-socket-left">
                    <ellipse cx="280" cy="455" rx="34" ry="24" fill="#C8A94A" stroke="#151413" stroke-width="3" transform="rotate(-8 280 455)" />
                    <g clip-path="url(#left-eye-clip)">
                      <g id="cat-pupil-left">
                        <ellipse cx="280" cy="455" rx="13" ry="22" fill="#151413" />
                        <circle cx="285" cy="448" r="4.5" fill="#FFFFFF" opacity="0.85" />
                      </g>
                    </g>
                  </g>

                  <!-- Right Eye Socket -->
                  <g id="eye-socket-right">
                    <ellipse cx="448" cy="490" rx="36" ry="25" fill="#C8A94A" stroke="#151413" stroke-width="3" transform="rotate(12 448 490)" />
                    <g clip-path="url(#right-eye-clip)">
                      <g id="cat-pupil-right">
                        <ellipse cx="448" cy="490" rx="14" ry="23" fill="#151413" />
                        <circle cx="453" cy="483" r="5" fill="#FFFFFF" opacity="0.85" />
                      </g>
                    </g>
                  </g>

                  <!-- Whiskers -->
                  <g stroke="#F5F1E8" stroke-width="2.5" stroke-linecap="round" opacity="0.35">
                    <line x1="160" y1="520" x2="240" y2="530" />
                    <line x1="150" y1="550" x2="235" y2="545" />
                    <line x1="490" y1="565" x2="580" y2="580" />
                    <line x1="485" y1="590" x2="570" y2="615" />
                  </g>
                </svg>
              </div>
            </div>

            <!-- Today's Word Module (Expandable on hover) -->
            <div class="todays-word-card tactile-card" id="todays-word-card">
              <div class="todays-word-header">
                <span class="todays-word-badge tactile-pill tactile-pill-gold">今日の言葉 · TODAY'S WORD</span>
                <span class="todays-word-level">JLPT N3</span>
              </div>
              <div class="todays-word-main">
                <ruby class="todays-word-glyph">静寂<rt>せいじゃく</rt></ruby>
                <span class="todays-word-accent">[0] 平板</span>
              </div>
              <p class="todays-word-gloss">silence · stillness · tranquility</p>
              <div class="todays-word-expand">
                <div class="todays-word-sentence">
                  <p class="sentence-ja">森の中に深い<strong class="text-gold">静寂</strong>が広がっていた。</p>
                  <p class="sentence-en">A deep silence spread through the forest.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- RIGHT ZONE: Study Hub & Resumption (55% desktop) -->
          <div class="home-right-zone">
            <!-- 7-Day Study Streak Badge -->
            <div class="streak-card tactile-card">
              <div class="streak-top-row">
                <div class="streak-counter-group">
                  <span class="streak-days-number">7</span>
                  <div class="streak-label-block">
                    <span class="streak-label-title">DAY STREAK</span>
                    <span class="streak-label-sub">ACTIVE LEARNING</span>
                  </div>
                </div>
                <span class="tactile-pill tactile-pill-vermilion">WEEK GOAL MET</span>
              </div>
              <div class="streak-dots-row" aria-label="7 day streak tracker">
                <div class="streak-dot is-active" title="Day 1 (Completed)">M</div>
                <div class="streak-dot is-active" title="Day 2 (Completed)">T</div>
                <div class="streak-dot is-active" title="Day 3 (Completed)">W</div>
                <div class="streak-dot is-active" title="Day 4 (Completed)">T</div>
                <div class="streak-dot is-active" title="Day 5 (Completed)">F</div>
                <div class="streak-dot is-active" title="Day 6 (Completed)">S</div>
                <div class="streak-dot is-today" title="Day 7 (Today)">S</div>
              </div>
            </div>

            <!-- Continue Drill Action Card -->
            <div class="continue-card tactile-card">
              <div class="continue-header-row">
                <span class="tactile-pill">CONTINUE ACTIVITY</span>
                <span class="continue-topic-tag">N3 GRAMMAR</span>
              </div>
              <h2 class="continue-title">〜わけにはいかない</h2>
              <p class="continue-desc">Cannot afford to / impossible due to social context</p>
              <div class="continue-actions">
                <button class="tactile-btn tactile-btn-primary" id="btn-continue-drill">
                  <span>Continue Practice</span>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M5 13h11.86l-5.43 5.43 1.42 1.42L21.14 12l-8.29-8.29-1.42 1.42L16.86 11H5v2z"/>
                  </svg>
                </button>
              </div>
            </div>

            <!-- JLPT Benchmark Progress Pod -->
            <div class="benchmark-card tactile-card">
              <div class="benchmark-header-row">
                <span class="benchmark-title">JLPT N3 BENCHMARK</span>
                <span class="benchmark-percentage">64% MASTERY</span>
              </div>
              <div class="benchmark-bars-row">
                <div class="bar-segment bar-segment-kanji" style="flex: 78" title="Kanji: 78%"></div>
                <div class="bar-segment bar-segment-grammar" style="flex: 65" title="Grammar: 65%"></div>
                <div class="bar-segment bar-segment-reading" style="flex: 58" title="Reading: 58%"></div>
                <div class="bar-segment bar-segment-listening" style="flex: 42" title="Listening: 42%"></div>
              </div>
              <div class="benchmark-footer-row">
                <span class="benchmark-legend">Kanji · Grammar · Reading · Listening</span>
                <span class="benchmark-target">Target: July Exam</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupCatEyeTracking();
    this.setupContinueButton();
    this.loadDynamicData();
  }

  setupCatEyeTracking() {
    this.catSvg = document.getElementById('home-cat-svg');
    this.pupilLeft = document.getElementById('cat-pupil-left');
    this.pupilRight = document.getElementById('cat-pupil-right');

    window.addEventListener('mousemove', this.handleMouseMove, { passive: true });
    this.animFrameId = requestAnimationFrame(this.updateEyes);
  }

  handleMouseMove(e) {
    if (!this.catSvg) return;
    const rect = this.catSvg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Cat eye socket center ~ midpoint x=0.495, y=0.64
    const eyeCenterX = rect.left + rect.width * 0.495;
    const eyeCenterY = rect.top + rect.height * 0.64;

    const dx = e.clientX - eyeCenterX;
    const dy = e.clientY - eyeCenterY;
    const distance = Math.hypot(dx, dy) || 1;

    const MAX_OFFSET = 12.0;
    const clampedDist = Math.min(distance / 24, MAX_OFFSET);
    this.targetX = (dx / distance) * clampedDist;
    this.targetY = (dy / distance) * clampedDist * 0.85;
  }

  updateEyes() {
    this.currentX += (this.targetX - this.currentX) * 0.12;
    this.currentY += (this.targetY - this.currentY) * 0.12;

    if (this.pupilLeft && this.pupilRight) {
      const transform = `translate(${this.currentX.toFixed(2)}, ${this.currentY.toFixed(2)})`;
      this.pupilLeft.setAttribute('transform', transform);
      this.pupilRight.setAttribute('transform', transform);
    }

    this.animFrameId = requestAnimationFrame(this.updateEyes);
  }

  setupContinueButton() {
    const btn = document.getElementById('btn-continue-drill');
    if (btn) {
      btn.addEventListener('click', () => {
        this.router.navigateToTab('study');
      });
    }
  }

  async loadDynamicData() {
    try {
      const stats = await apiClient.getCardStats();
      if (stats && stats.total_cards !== undefined) {
        // Dynamic streak or cards count update if available
      }
    } catch (_) {}
  }

  unmount() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    window.removeEventListener('mousemove', this.handleMouseMove);
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
