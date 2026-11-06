/**
 * Kiroku Note Desktop — Authentic Cat Companion Rive Controller
 * Optimizes startup and refresh latency via early WebAssembly pre-warming and
 * parallel in-memory ArrayBuffer pre-fetching. Ensures zero pop-in layout shifts
 * and seamless fallback to static SVG mascot if runtime or asset fails.
 *
 * Golden Rule: Zero emojis anywhere across code, UI, or logs.
 */

export const PRIMARY_COMPANION_ASSET = 'muza_-_your_cat_companion._jp.riv';

let wasmInitPromise = null;
let rivBufferPromise = null;

export function markPerf(name) {
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
        let src;
        if (window.desktopAPI?.getRiveAssetUrl) {
          try {
            src = await window.desktopAPI.getRiveAssetUrl(PRIMARY_COMPANION_ASSET);
          } catch (e) {
            console.debug('[Mascot] desktopAPI.getRiveAssetUrl fallback:', e);
            src = `./ui/assets/riv/${PRIMARY_COMPANION_ASSET}`;
          }
        } else {
          src = `./ui/assets/riv/${PRIMARY_COMPANION_ASSET}`;
        }
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
