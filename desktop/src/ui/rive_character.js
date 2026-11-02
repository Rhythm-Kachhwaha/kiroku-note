/**
 * Kiroku Note Desktop — Reusable Character Lineup & Rive Mount Controller
 * Manages Rive runtime initialization, content-addressed asset URL resolution,
 * fixed canvas dimensions, curtain reveal, and zero-stutter hover transitions.
 *
 * Golden Rule: Zero emojis anywhere across code, UI, or logs.
 */

export const CHARACTER_LINEUP = [
  {
    tabId: 'vocab',
    name: 'Vocab',
    desc: 'Quick Add',
    file: '24603-46108-character-series-of-01.riv',
    alignment: 'center',
    fit: 'cover',
    artboard: undefined,
    stateMachine: 'State Machine 1'
  },
  {
    tabId: 'kanji',
    name: 'Kanji',
    desc: 'Stroke order',
    file: '24617-46109-character-series-of-02.riv',
    alignment: 'center',
    fit: 'cover',
    artboard: undefined,
    stateMachine: 'State Machine 1'
  },
  {
    tabId: 'grammar',
    name: 'Grammar',
    desc: 'Grammar points',
    file: '24622-46110-character-series-of-02.riv',
    alignment: 'center',
    fit: 'cover',
    artboard: undefined,
    stateMachine: 'State Machine 1'
  },
  {
    tabId: 'study',
    name: 'Practice',
    desc: 'Adaptive drills',
    file: '24718-46207-cat-robot-character-07.riv',
    alignment: 'center',
    fit: 'cover',
    artboard: undefined,
    stateMachine: 'State Machine 1'
  },
  {
    tabId: 'test',
    name: 'Exam',
    desc: 'JLPT mock',
    file: '24719-46209-cat-robot-character-08.riv',
    alignment: 'center',
    fit: 'cover',
    artboard: undefined,
    stateMachine: 'State Machine 1'
  },
  {
    tabId: 'settings',
    name: 'Settings',
    desc: 'Config',
    file: '24739-46235-cat-robot-character-09.riv',
    alignment: 'center',
    fit: 'cover',
    artboard: undefined,
    stateMachine: 'State Machine 1'
  }
];

function resolveFit(fit) {
  if (typeof window === 'undefined' || !window.rive?.Fit) return null;
  const F = window.rive.Fit;
  switch (fit) {
    case 'contain':
      return F.Contain;
    case 'fill':
      return F.Fill;
    case 'fit-width':
      return F.FitWidth;
    case 'fit-height':
      return F.FitHeight;
    case 'none':
      return F.None;
    case 'scale-down':
      return F.ScaleDown;
    case 'cover':
    default:
      return F.Cover;
  }
}

function resolveAlignment(align) {
  if (typeof window === 'undefined' || !window.rive?.Alignment) return null;
  const A = window.rive.Alignment;
  switch (align) {
    case 'top-center':
    case 'top':
      return A.TopCenter;
    case 'bottom-center':
    case 'bottom':
      return A.BottomCenter;
    case 'center-left':
    case 'left':
      return A.CenterLeft;
    case 'center-right':
    case 'right':
      return A.CenterRight;
    case 'top-left':
      return A.TopLeft;
    case 'top-right':
      return A.TopRight;
    case 'bottom-left':
      return A.BottomLeft;
    case 'bottom-right':
      return A.BottomRight;
    case 'center':
    default:
      return A.Center;
  }
}

/**
 * Reusable character mount function.
 * Uses a fixed-dimension canvas to prevent per-frame re-layouts and texture allocations during flex hover transitions.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} file - e.g. '24603-46108-character-series-of-01.riv'
 * @param {object} opts - { fit, alignment, artboard, stateMachine, autoplay, onLoad, onError }
 * @returns {Promise<{ instance: object|null, isPlaying: boolean, cleanup: Function, pause: Function, resume: Function, playReaction: Function }>}
 */
export async function mountCharacter(canvas, file, opts = {}) {
  if (!canvas) {
    return {
      instance: null,
      isPlaying: false,
      cleanup: () => {},
      pause: () => {},
      resume: () => {},
      playReaction: () => {}
    };
  }

  // Graceful degradation when window.rive is not available (e.g. in test runners or headless mode)
  if (typeof window === 'undefined' || !window.rive?.Rive) {
    if (typeof opts.onError === 'function') {
      opts.onError(new Error('Rive runtime is unavailable in current environment'));
    }
    return {
      instance: null,
      isPlaying: false,
      cleanup: () => {},
      pause: () => {},
      resume: () => {},
      playReaction: () => {}
    };
  }

  try {
    if (window.rive.RuntimeLoader?.setWasmUrl) {
      window.rive.RuntimeLoader.setWasmUrl('./ui/vendor/rive.wasm');
    }

    const src = window.desktopAPI?.getRiveAssetUrl
      ? await window.desktopAPI.getRiveAssetUrl(file)
      : `./ui/assets/riv/${file}`;

    const reducedMotion = typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const fit = resolveFit(opts.fit || 'cover') || window.rive.Fit.Cover;
    const alignment = resolveAlignment(opts.alignment || 'center') || window.rive.Alignment.Center;
    const stateMachine = opts.stateMachine || 'State Machine 1';
    const autoplay = opts.autoplay === true && !reducedMotion;

    // Cap devicePixelRatio at 2 to balance crispness with GPU memory bandwidth
    const dpr = Math.min(2, typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1);

    let isCleanedUp = false;
    let isPlaying = false;
    let isHovered = false;
    let pauseTimeoutId = null;
    let resizeTimer = null;

    const syncDrawingSurface = () => {
      if (isCleanedUp || !riveInstance || !canvas) return;
      try {
        const w = Math.round(canvas.clientWidth || 320);
        const h = Math.round(canvas.clientHeight || 460);
        if (w > 0 && h > 0) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
          riveInstance.resizeDrawingSurfaceToCanvas();
        }
      } catch (e) {
        console.debug(`[Character] Surface sync error on ${file}:`, e);
      }
    };

    const riveInstance = new window.rive.Rive({
      src,
      canvas,
      artboard: opts.artboard,
      autoplay: false,
      stateMachine,
      layout: new window.rive.Layout({
        fit,
        alignment
      }),
      onLoad: () => {
        if (isCleanedUp) return;
        try {
          syncDrawingSurface();
          riveInstance.play(stateMachine);
          isPlaying = true;
          riveInstance.setupRiveListeners();
        } catch (e) {
          console.warn(`[Character] Listener setup warning for ${file}:`, e.message || e);
        }

        // Draw the initial rest frame pose, then pause until hovered
        if (!autoplay) {
          requestAnimationFrame(() => {
            if (isCleanedUp) return;
            if (!opts.keepPlaying && !isHovered) {
              try {
                riveInstance.pause();
                isPlaying = false;
              } catch (e) {
                console.debug(`[Character] Rest pose pause error:`, e);
              }
            }
          });
        }

        if (typeof opts.onLoad === 'function') {
          opts.onLoad(riveInstance);
        }
      },
      onLoadError: (err) => {
        console.warn(`[Character] Failed to load Rive file ${file}:`, err);
        if (typeof opts.onError === 'function') {
          opts.onError(err);
        }
      }
    });

    // Window resize debounced listener (never fires during hover flex transitions!)
    const handleWindowResize = () => {
      if (isCleanedUp || !riveInstance || !canvas) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        syncDrawingSurface();
      }, 150);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleWindowResize);
    }

    const controller = {
      instance: riveInstance,
      get isPlaying() {
        return isPlaying;
      },
      playReaction() {
        if (!riveInstance || isCleanedUp) return;
        try {
          const inputs = riveInstance.stateMachineInputs(stateMachine);
          if (inputs && inputs.length > 0) {
            const trigger = inputs.find((i) => i.type === 1 || typeof i.fire === 'function');
            if (trigger && typeof trigger.fire === 'function') {
              trigger.fire();
            }
          }
        } catch (e) {
          console.debug(`[Character] Reaction trigger error on ${file}:`, e);
        }
      },
      resume() {
        isHovered = true;
        if (pauseTimeoutId) {
          clearTimeout(pauseTimeoutId);
          pauseTimeoutId = null;
        }
        if (!riveInstance || isCleanedUp) return;
        if (!isPlaying) {
          try {
            // Immediate synchronous play with no await (idle plays even if prefers-reduced-motion)
            riveInstance.play(stateMachine);
            isPlaying = true;
          } catch (e) {
            console.debug(`[Character] Resume error on ${file}:`, e);
          }
        }
      },
      pause(graceful = true) {
        isHovered = false;
        if (!riveInstance || isCleanedUp) return;
        if (pauseTimeoutId) {
          clearTimeout(pauseTimeoutId);
          pauseTimeoutId = null;
        }
        if (!graceful || !isPlaying) {
          try {
            riveInstance.pause();
            isPlaying = false;
          } catch (e) {
            console.debug(`[Character] Immediate pause error on ${file}:`, e);
          }
          return;
        }
        // Graceful leave: allow current idle cycle to ease back to rest pose
        pauseTimeoutId = setTimeout(() => {
          pauseTimeoutId = null;
          if (isCleanedUp || isHovered) return;
          try {
            riveInstance.pause();
            isPlaying = false;
          } catch (e) {
            console.debug(`[Character] Graceful pause error on ${file}:`, e);
          }
        }, 240);
      },
      cleanup() {
        isCleanedUp = true;
        if (pauseTimeoutId) {
          clearTimeout(pauseTimeoutId);
          pauseTimeoutId = null;
        }
        if (resizeTimer) {
          clearTimeout(resizeTimer);
          resizeTimer = null;
        }
        if (typeof window !== 'undefined') {
          window.removeEventListener('resize', handleWindowResize);
        }
        try {
          riveInstance.cleanup();
          isPlaying = false;
        } catch (e) {
          console.debug(`[Character] Cleanup error on ${file}:`, e);
        }
      }
    };

    return controller;
  } catch (error) {
    console.warn(`[Character] Initialization failed for ${file}:`, error.message);
    if (typeof opts.onError === 'function') {
      opts.onError(error);
    }
    return {
      instance: null,
      isPlaying: false,
      cleanup: () => {},
      pause: () => {},
      resume: () => {},
      playReaction: () => {}
    };
  }
}
