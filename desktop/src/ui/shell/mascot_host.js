import {
  PRIMARY_COMPANION_ASSET,
  markPerf,
  prefetchRiveAssets
} from '../rive_mascot.js';

const STATE_MACHINE_NAME = 'State Machine 1';

function getReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class MascotHost {
  constructor({ loadAssets = null } = {}) {
    this.loadAssets = loadAssets;
    this.element = null;
    this.canvas = null;
    this.instance = null;
    this.riveFile = null;
    this.resizeObserver = null;
    this.visibilityHandler = null;
    this.resizeFrame = null;
    this.lastSurfaceSize = null;
    this.createPromise = null;
    this.attachedSlot = null;
    this.reducedMotion = getReducedMotion();
    this.ready = false;
    this.fallback = false;
    this._readyListeners = [];
  }

  whenReady(timeoutMs = 4000) {
    if (this.ready || this.fallback) return Promise.resolve(this);
    return new Promise((resolve) => {
      let timer = null;
      const done = () => {
        if (timer) clearTimeout(timer);
        this._readyListeners = (this._readyListeners || []).filter((fn) => fn !== done);
        resolve(this);
      };
      if (timeoutMs > 0) {
        timer = setTimeout(done, timeoutMs);
      }
      this._readyListeners = this._readyListeners || [];
      this._readyListeners.push(done);
    });
  }

  ensureCreated() {
    if (this.element) return Promise.resolve(this);
    if (this.createPromise) return this.createPromise;

    this.createPromise = this.create().catch((error) => {
      this.createPromise = null;
      throw error;
    });
    return this.createPromise;
  }

  async create() {
    if (typeof document === 'undefined' || !window.rive?.Rive) {
      throw new Error('Rive runtime is unavailable');
    }

    this.element = document.createElement('div');
    this.element.className = 'mascot-rive-host';
    this.element.style.display = 'block';
    this.element.style.width = '100%';
    this.element.style.height = '100%';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'rive-mascot-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.element.appendChild(this.canvas);
    this.canvas.style.opacity = '1';
    this.canvas.style.transition = 'none';

    const assets = this.loadAssets
      ? await this.loadAssets()
      : await Promise.all(Object.values(prefetchRiveAssets()));
    const buffer = assets?.[1] ?? assets?.buffer ?? null;
    const wasmReady = assets?.[0] ?? assets?.wasmInitPromise ?? null;
    await wasmReady;

    const reveal = () => {
      if (this.ready) return;
      this.ready = true;
      this.resize();
      requestAnimationFrame(() => {
        markPerf('first_frame_drawn');
        this.onReady?.();
        if (this._readyListeners?.length) {
          const listeners = [...this._readyListeners];
          this._readyListeners = [];
          listeners.forEach((fn) => fn());
        }
      });
    };

    const params = {
      canvas: this.canvas,
      autoplay: !this.reducedMotion,
      stateMachine: STATE_MACHINE_NAME,
      layout: new window.rive.Layout({
        fit: window.rive.Fit.Contain,
        alignment: window.rive.Alignment.Center
      }),
      onLoad: () => {
        markPerf('rive:onLoad');
        try {
          this.resize();
          this.instance.play(STATE_MACHINE_NAME);
          if (!this._riveListenersSetup) {
            this.instance.setupRiveListeners?.();
            this._riveListenersSetup = true;
          }
        } catch (error) {
          console.warn('[Home] Could not setup Rive listeners:', error);
        }
        reveal();
      },
      onLoadError: (error) => {
        console.warn('[Home] Rive companion load error:', error);
        this.fallback = true;
        this.onFallback?.();
        if (this._readyListeners?.length) {
          const listeners = [...this._readyListeners];
          this._readyListeners = [];
          listeners.forEach((fn) => fn());
        }
      }
    };

    let assetUrl = `./ui/assets/riv/${PRIMARY_COMPANION_ASSET}`;
    if (window.desktopAPI?.getRiveAssetUrl) {
      try {
        assetUrl = await window.desktopAPI.getRiveAssetUrl(PRIMARY_COMPANION_ASSET);
      } catch (e) {
        console.debug('[MascotHost] desktopAPI.getRiveAssetUrl fallback:', e);
      }
    }

    if (buffer && (buffer.byteLength > 0 || buffer.length > 0)) {
      this.buffer = buffer;
      params.buffer = buffer;
    } else {
      params.src = assetUrl;
    }

    this.instance = new window.rive.Rive(params);
    this.visibilityHandler = () => {
      if (document.hidden) {
        this.pause();
      } else if (this.attachedSlot) {
        this.resume();
      }
    };
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.resize())
      : null;
    this.resizeObserver?.observe(this.canvas);
    return this;
  }

  attach(slotEl, { onReady = null, onFallback = null } = {}) {
    if (!slotEl) throw new Error('Mascot host requires an attachment slot');
    this.onReady = onReady;
    this.onFallback = onFallback;
    if (this.element && this.element.parentNode !== slotEl) {
      slotEl.appendChild(this.element);
    }
    this.attachedSlot = slotEl;
    if (this.canvas) this.canvas.style.opacity = '1';
    if (typeof document !== 'undefined' && document.hidden) this.pause();
    else this.resume();
    this.resize();
    markPerf('mascot:attach');
    markPerf('mascot:visible');
    if (this.ready) this.onReady?.();
    if (this.fallback) this.onFallback?.();
  }

  detach(stashEl = null) {
    this.pause();
    stashEl = stashEl || document.getElementById('mascot-host-stash');
    if (stashEl && this.element) stashEl.appendChild(this.element);
    this.attachedSlot = null;
  }

  pause() {
    // stopRendering cleanly freezes rAF when tab/window is hidden without destroying
    // state machines or wiping canvas event listeners
    this.instance?.stopRendering?.();
  }

  resume() {
    if (!this.reducedMotion && this.instance) {
      try {
        this.lastSurfaceSize = null;
        if (this.instance._hasZeroSize) {
          this.instance._hasZeroSize = false;
        }
        if (this.instance._explicitlyStoppedRendering) {
          this.instance.startRendering?.();
        }
        let shouldPlay = false;
        try {
          shouldPlay = Boolean(this.instance?.isPaused || this.instance?.isStopped);
        } catch (_) {
          shouldPlay = true;
        }
        if (shouldPlay) {
          this.instance.play?.(STATE_MACHINE_NAME);
        } else {
          this.instance.startRendering?.();
        }
        const width = this.canvas?.clientWidth ?? 0;
        const height = this.canvas?.clientHeight ?? 0;
        if (width > 0 && height > 0) {
          this.instance.resizeDrawingSurfaceToCanvas?.();
        }
        this.resize();
      } catch (e) {
        console.debug('[MascotHost] resume play error:', e);
      }
    }
  }

  resize() {
    if (this.resizeFrame !== null) return;
    const requestFrame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 0);
    this.resizeFrame = requestFrame(() => {
      this.resizeFrame = null;
      const width = this.canvas?.clientWidth ?? this.canvas?.width ?? 0;
      const height = this.canvas?.clientHeight ?? this.canvas?.height ?? 0;
      if (width <= 0 || height <= 0) return;

      const pixelRatio = window.devicePixelRatio || 1;
      const surfaceSize = `${Math.round(width * pixelRatio)}x${Math.round(height * pixelRatio)}`;
      if (surfaceSize === this.lastSurfaceSize && this.lastSurfaceSize !== null) return;
      this.lastSurfaceSize = surfaceSize;
      try {
        this.instance?.resizeDrawingSurfaceToCanvas?.();
      } catch (e) {
        console.debug('[MascotHost] resizeDrawingSurface error:', e);
      }
    });
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    this.visibilityHandler = null;
    if (this.resizeFrame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.resizeFrame);
      else clearTimeout(this.resizeFrame);
      this.resizeFrame = null;
    }
    this.lastSurfaceSize = null;
    this.instance?.cleanup?.();
    this.element?.remove?.();
    this.element = null;
    this.canvas = null;
    this.instance = null;
    this.riveFile = null;
    this.createPromise = null;
    this.attachedSlot = null;
  }
}

let mascotHost = null;

export function getMascotHost() {
  if (!mascotHost) mascotHost = new MascotHost();
  return mascotHost;
}

export function scheduleMascotHostCreation() {
  const create = () => getMascotHost().ensureCreated().catch((error) => {
    console.warn('[Home] Mascot host could not be created:', error);
  });
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(create, { timeout: 1000 });
  } else {
    setTimeout(create, 0);
  }
}
