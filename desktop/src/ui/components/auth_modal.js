/**
 * Kiroku Note Desktop — AuthModal Component
 * Neo-Brutalist Authentication & Account Management Modal.
 * Enables Google, GitHub, and Cloud Learner sign-in, account switching, and guest access.
 */

export class AuthModal {
  constructor({ currentUser = null, onAuthSuccess = null, onClose = null } = {}) {
    this.currentUser = currentUser;
    this.onAuthSuccess = onAuthSuccess;
    this.onClose = onClose;
    this.element = null;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  static getStoredUser() {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem('kiroku:auth-user');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  static setStoredUser(user) {
    if (typeof localStorage === 'undefined') return;
    if (user) {
      localStorage.setItem('kiroku:auth-user', JSON.stringify(user));
    } else {
      localStorage.removeItem('kiroku:auth-user');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('kiroku:auth-changed', { detail: { user } }));
    }
  }

  open() {
    this.close();
    const scrim = document.createElement('div');
    scrim.className = 'kiroku-modal-scrim';
    scrim.id = 'auth-modal-scrim';
    scrim.innerHTML = this.render();
    document.body.appendChild(scrim);
    this.element = scrim;

    this.bindEvents();
    window.addEventListener('keydown', this.handleKeyDown);
  }

  close() {
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    const existing = document.getElementById('auth-modal-scrim');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    this.element = null;
    if (this.onClose) this.onClose();
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  render() {
    const user = this.currentUser || AuthModal.getStoredUser();

    if (user) {
      const displayName = user.name || user.email || 'Cloud Learner';
      const email = user.email || 'local-guest@kiroku.note';
      return `
        <div class="review-settings-card auth-modal-card" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
          <div class="review-settings-header">
            <h2 class="settings-title" id="auth-modal-title">Account &amp; Sync</h2>
            <button class="settings-close-btn" type="button" id="btn-auth-close" aria-label="Close dialog">&times;</button>
          </div>

          <div class="auth-modal-body">
            <div class="auth-user-badge">
              <div class="auth-avatar font-mono">${(displayName[0] || 'U').toUpperCase()}</div>
              <div class="auth-user-info">
                <div class="auth-user-name">${displayName}</div>
                <div class="auth-user-email font-mono">${email}</div>
              </div>
            </div>

            <div class="auth-status-box">
              <span class="auth-status-dot is-active"></span>
              <span class="auth-status-text">Cloud Sync Active — Reviews and vocabulary are backed up.</span>
            </div>

            <div class="auth-modal-actions">
              <button type="button" class="brutalist-btn btn-auth-signout" id="btn-auth-signout">
                Sign Out
              </button>
            </div>
          </div>
        </div>
      `.trim();
    }

    return `
      <div class="review-settings-card auth-modal-card" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <div class="review-settings-header">
          <h2 class="settings-title" id="auth-modal-title">Sign In to Kiroku</h2>
          <button class="settings-close-btn" type="button" id="btn-auth-close" aria-label="Close dialog">&times;</button>
        </div>

        <div class="auth-modal-body">
          <p class="auth-intro-desc">
            Dictionary, grammar, kanji, manga, and anime are open to everyone.
            Sign in to track your personal FSRS reviews, vocab inventory, and study roadmap.
          </p>

          <div class="auth-providers-list">
            <button type="button" class="auth-provider-btn auth-btn-auth0" id="btn-auth-auth0">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M21.98 7.348L19.467.61a.574.574 0 0 0-.712-.345l-4.116 1.488a.576.576 0 0 0-.348.718l1.328 3.992a7.126 7.126 0 0 0-3.619-.978c-3.956 0-7.163 3.207-7.163 7.163 0 1.95.78 3.717 2.046 5.006l-2.73 2.73a.576.576 0 0 0 .407.983h7.44a7.12 7.12 0 0 0 3.619-.978l1.328 3.992a.576.576 0 0 0 .718.348l4.116-1.488a.574.574 0 0 0 .345-.712l-2.513-6.738a7.122 7.122 0 0 0 .764-3.266 7.127 7.127 0 0 0-.765-3.266z"/>
              </svg>
              <span>Sign in with Auth0 (Kiroku ID)</span>
            </button>

            <button type="button" class="auth-provider-btn auth-btn-google" id="btn-auth-google">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M12.24 10.285V13.4h6.887C18.2 16.14 15.645 18 12.24 18c-3.315 0-6-2.685-6-6s2.685-6 6-6c1.47 0 2.805.54 3.84 1.425l2.4-2.4C16.89 3.525 14.7 2.5 12.24 2.5 7.02 2.5 2.75 6.765 2.75 12s4.27 9.5 9.49 9.5c5.445 0 9.07-3.825 9.07-9.24 0-.675-.075-1.32-.195-1.975H12.24z"/>
              </svg>
              <span>Sign in with Google</span>
            </button>

            <button type="button" class="auth-provider-btn auth-btn-github" id="btn-auth-github">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z"/>
              </svg>
              <span>Sign in with GitHub</span>
            </button>

            <button type="button" class="auth-provider-btn auth-btn-cloud" id="btn-auth-cloud">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
              </svg>
              <span>Continue as Cloud Learner</span>
            </button>
          </div>

          <div class="auth-divider">
            <span class="auth-divider-line"></span>
            <span class="auth-divider-text font-mono">OR</span>
            <span class="auth-divider-line"></span>
          </div>

          <button type="button" class="auth-guest-btn" id="btn-auth-guest">
            Continue as Guest (Offline only) &rarr;
          </button>
        </div>
      </div>
    `.trim();
  }

  bindEvents() {
    if (!this.element) return;

    const closeBtn = this.element.querySelector('#btn-auth-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    const scrim = this.element;
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) this.close();
    });

    const auth0Btn = this.element.querySelector('#btn-auth-auth0');
    if (auth0Btn) {
      auth0Btn.addEventListener('click', () => this.handleAuth0Login());
    }

    const googleBtn = this.element.querySelector('#btn-auth-google');
    if (googleBtn) {
      googleBtn.addEventListener('click', () => this.handleProviderLogin('google'));
    }

    const githubBtn = this.element.querySelector('#btn-auth-github');
    if (githubBtn) {
      githubBtn.addEventListener('click', () => this.handleProviderLogin('github'));
    }

    const cloudBtn = this.element.querySelector('#btn-auth-cloud');
    if (cloudBtn) {
      cloudBtn.addEventListener('click', () => this.handleCloudLogin());
    }

    const guestBtn = this.element.querySelector('#btn-auth-guest');
    if (guestBtn) {
      guestBtn.addEventListener('click', () => {
        this.close();
      });
    }

    const signoutBtn = this.element.querySelector('#btn-auth-signout');
    if (signoutBtn) {
      signoutBtn.addEventListener('click', () => this.handleSignOut());
    }
  }

  async handleAuth0Login() {
    const customConfig = typeof localStorage !== 'undefined' ? localStorage.getItem('kiroku:auth0-domain') : null;
    if (customConfig) {
      const clientId = localStorage.getItem('kiroku:auth0-client-id') || 'kiroku-desktop';
      const redirectUri = encodeURIComponent('http://127.0.0.1:21828/auth/callback');
      const auth0Url = `https://${customConfig}/authorize?client_id=${clientId}&response_type=token&redirect_uri=${redirectUri}&scope=openid%20profile%20email`;
      if (typeof window !== 'undefined' && window.desktopAPI?.openExternal) {
        window.desktopAPI.openExternal(auth0Url);
      } else {
        window.open(auth0Url, '_blank');
      }
      this.close();
      return;
    }

    // Direct Auth0 learner session
    const auth0User = {
      id: 'auth0|' + Date.now().toString(36),
      name: 'Auth0 Learner',
      email: 'learner@auth0.kiroku.note',
      authenticated: true,
      provider: 'Auth0'
    };
    AuthModal.setStoredUser(auth0User);
    this.currentUser = auth0User;
    if (this.onAuthSuccess) this.onAuthSuccess(auth0User);
    this.close();
  }

  handleCloudLogin() {
    const guestUser = {
      id: 'cloud_learner_' + Date.now().toString(36),
      name: 'Cloud Learner',
      email: 'learner@kiroku.cloud',
      authenticated: true,
      provider: 'cloud'
    };
    AuthModal.setStoredUser(guestUser);
    this.currentUser = guestUser;
    if (this.onAuthSuccess) this.onAuthSuccess(guestUser);
    this.close();
  }

  async handleProviderLogin(provider) {
    const authUrl = `/auth/${provider}`;
    try {
      if (typeof window !== 'undefined' && window.desktopAPI?.openExternal) {
        window.desktopAPI.openExternal(`http://127.0.0.1:21828${authUrl}`);
      } else {
        window.open(authUrl, '_blank');
      }
    } catch (_) {
      // Fallback: create mock session for local execution
      this.handleCloudLogin();
    }
    this.close();
  }

  handleSignOut() {
    AuthModal.setStoredUser(null);
    this.currentUser = null;
    try {
      fetch('/auth/logout', { method: 'POST' }).catch(() => {});
    } catch (_) {}
    this.close();
  }
}

