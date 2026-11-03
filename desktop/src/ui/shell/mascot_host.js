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
    this.createPromise = null;
    this.attachedSlot = null;
    this.reducedMotion = getReducedMotion();
    this.ready = false;
    this.fallback = false;
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
          this.instance.setupRiveListeners?.();
        } catch (error) {
          console.warn('[Home] Could not setup Rive listeners:', error);
        }
        reveal();
      },
      onLoadError: (error) => {
        console.warn('[Home] Rive companion load error:', error);
        this.fallback = true;
        this.onFallback?.();
      }
    };

    if (buffer) {
      this.riveFile = new window.rive.RiveFile({ buffer });
      await this.riveFile.init();
      params.riveFile = this.riveFile;
    } else {
      params.src = window.desktopAPI?.getRiveAssetUrl
        ? await window.desktopAPI.getRiveAssetUrl(PRIMARY_COMPANION_ASSET)
        : `./ui/assets/riv/${PRIMARY_COMPANION_ASSET}`;
    }

    this.instance = new window.rive.Rive(params);
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
    slotEl.appendChild(this.element);
    this.attachedSlot = slotEl;
    this.canvas.style.opacity = '1';
    this.resume();
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
    this.instance?.pause?.();
  }

  resume() {
    if (!this.reducedMotion) {
      this.instance?.play?.(STATE_MACHINE_NAME);
    }
  }

  resize() {
    this.instance?.resizeDrawingSurfaceToCanvas?.();
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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
