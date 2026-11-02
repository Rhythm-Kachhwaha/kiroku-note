/**
 * Kiroku Note Desktop — Authentic Cat Companion Rive Controller
 * Optimizes startup and refresh latency via early WebAssembly pre-warming and
 * parallel in-memory ArrayBuffer pre-fetching. Ensures zero pop-in layout shifts
 * and seamless fallback to static SVG mascot if runtime or asset fails.
 *
 * Golden Rule: Zero emojis anywhere across code, UI, or logs.
 */

const PRIMARY_COMPANION_ASSET = 'muza_-_your_cat_companion._jp.riv';

let wasmInitPromise = null;
let rivBufferPromise = null;

function markPerf(name) {
  if (typeof window !== 'undefined' && window.__KIROKU_PERF_DEBUG__) {
    try {
      performance.mark(name);
    } catch (e) {
      console.debug('[Home] Perf mark warning:', e);
    }
  }
}

/**
 * Pre-warms the Rive WebAssembly runtime and pre-fetches the cat .riv asset bytes
 * concurrently at application shell boot, storing promises in a module-level cache.
 */
export function prefetchRiveAssets() {
  if (typeof window === 'undefined') {
    return { wasmInitPromise: null, rivBufferPromise: null };
  }

  if (!wasmInitPromise) {
    if (window.rive?.RuntimeLoader) {
      if (typeof window.rive.RuntimeLoader.setWasmUrl === 'function') {
        window.rive.RuntimeLoader.setWasmUrl('./ui/vendor/rive.wasm');
      }
      if (typeof window.rive.RuntimeLoader.awaitInstance === 'function') {
        markPerf('wasm:start');
        wasmInitPromise = window.rive.RuntimeLoader.awaitInstance().then((res) => {
          markPerf('wasm:compiled');
          return res;
        });
      } else {
        wasmInitPromise = Promise.resolve();
      }
    } else {
      wasmInitPromise = Promise.resolve();
    }
  }

  if (!rivBufferPromise) {
    rivBufferPromise = (async () => {
      try {
        markPerf('getRiveAssetUrl:start');
        const src = window.desktopAPI?.getRiveAssetUrl
          ? await window.desktopAPI.getRiveAssetUrl(PRIMARY_COMPANION_ASSET)
          : `./ui/assets/riv/${PRIMARY_COMPANION_ASSET}`;
        markPerf('getRiveAssetUrl:resolved');

        const response = await fetch(src);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        const buf = await response.arrayBuffer();
        markPerf('riv:bytes_received');
        return buf;
      } catch (err) {
        console.warn('[Mascot] Prefetch error for companion asset:', err?.message || err);
        return null;
      }
    })();
  }

  return { wasmInitPromise, rivBufferPromise };
}

// Automatically trigger early prefetch on module evaluation
if (typeof window !== 'undefined') {
  prefetchRiveAssets();
}

/**
 * Mounts Kiroku's primary Rive companion on the desktop Home screen.
 * Gated reveal: Canvas remains invisible (opacity 0) until Rive onLoad completes
 * and the first frame has rendered, preventing pop-in and layout shift.
 */
export async function mountRiveMascot(canvas, options = {}) {
  if (!canvas || !window.rive?.Rive) {
    if (typeof options.onFallback === 'function') {
      options.onFallback();
    }
    return null;
  }

  try {
    markPerf('mascot:mount:start');
    const { wasmInitPromise: wasmP, rivBufferPromise: bufP } = prefetchRiveAssets();

    // Await wasm compile and riv bytes concurrently
    const [_, buffer] = await Promise.all([wasmP, bufP]);

    const reducedMotion = typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Canvas stage gating: keep hidden until first frame draws
    canvas.style.opacity = '0';
    canvas.style.transition = reducedMotion ? 'none' : 'opacity 200ms ease';

    let riveInstance = null;
    let revealed = false;

    const revealMascot = () => {
      if (revealed) return;
      revealed = true;
      try {
        riveInstance?.resizeDrawingSurfaceToCanvas();
      } catch (e) {
        console.debug('[Home] Resize surface warning:', e);
      }
      requestAnimationFrame(() => {
        markPerf('first_frame_drawn');
        canvas.style.opacity = '1';
        if (typeof options.onReady === 'function') {
          options.onReady();
        }
      });
    };

    const riveParams = {
      canvas,
      autoplay: !reducedMotion,
      stateMachine: 'State Machine 1',
      layout: new window.rive.Layout({
        fit: window.rive.Fit.Contain,
        alignment: window.rive.Alignment.Center
      }),
      onLoad: () => {
        markPerf('rive:onLoad');
        try {
          riveInstance?.resizeDrawingSurfaceToCanvas();
          riveInstance?.play('State Machine 1');
          riveInstance?.setupRiveListeners();
        } catch (e) {
          console.warn('[Home] Could not setup Rive listeners:', e);
        }
        revealMascot();
      },
      onLoadError: (err) => {
        console.warn('[Home] Rive companion load error:', err);
        if (typeof options.onFallback === 'function') {
          options.onFallback();
        }
      }
    };

    if (buffer) {
      riveParams.buffer = buffer.slice(0);
    } else {
      riveParams.src = window.desktopAPI?.getRiveAssetUrl
        ? await window.desktopAPI.getRiveAssetUrl(PRIMARY_COMPANION_ASSET)
        : `./ui/assets/riv/${PRIMARY_COMPANION_ASSET}`;
    }

    riveInstance = new window.rive.Rive(riveParams);

    const resizeObserver = new ResizeObserver(() => {
      try {
        riveInstance?.resizeDrawingSurfaceToCanvas();
        riveInstance?.play();
      } catch (e) {
        console.debug('[Home] Resize observer warning:', e);
      }
    });
    resizeObserver.observe(canvas);

    return {
      instance: riveInstance,
      cleanup() {
        resizeObserver.disconnect();
        try {
          riveInstance.cleanup();
        } catch (e) {
          console.debug('[Home] Mascot cleanup warning:', e);
        }
      }
    };
  } catch (error) {
    console.warn('[Home] Rive companion could not be loaded:', error.message);
    if (typeof options.onFallback === 'function') {
      options.onFallback();
    }
    return null;
  }
}
