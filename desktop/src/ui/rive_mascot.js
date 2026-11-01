const PRIMARY_COMPANION_ASSET = 'muza_-_your_cat_companion._jp.riv';

/**
 * Mounts Kiroku's primary Rive companion on the desktop Home screen.
 * The asset URL is supplied by the narrow desktop bridge, keeping source and
 * packaged builds independent of their on-disk resource locations.
 */
export async function mountRiveMascot(canvas) {
  if (!canvas || !window.rive?.Rive) {
    return null;
  }

  try {
    if (window.rive.RuntimeLoader?.setWasmUrl) {
      window.rive.RuntimeLoader.setWasmUrl('./ui/vendor/rive.wasm');
    }

    const src = window.desktopAPI?.getRiveAssetUrl
      ? await window.desktopAPI.getRiveAssetUrl(PRIMARY_COMPANION_ASSET)
      : `./ui/assets/riv/${PRIMARY_COMPANION_ASSET}`;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const riveInstance = new window.rive.Rive({
      src,
      canvas,
      autoplay: !reducedMotion,
      stateMachine: 'State Machine 1',
      layout: new window.rive.Layout({
        fit: window.rive.Fit.Contain,
        alignment: window.rive.Alignment.Center
      }),
      onLoad: () => {
        riveInstance.resizeDrawingSurfaceToCanvas();
        try {
          riveInstance.play('State Machine 1');
          riveInstance.setupRiveListeners();
        } catch (e) {
          console.warn('[Home] Could not setup Rive listeners:', e);
        }
      }
    });

    const resizeObserver = new ResizeObserver(() => riveInstance.resizeDrawingSurfaceToCanvas());
    resizeObserver.observe(canvas);

    return {
      instance: riveInstance,
      cleanup() {
        resizeObserver.disconnect();
        riveInstance.cleanup();
      }
    };
  } catch (error) {
    console.warn('[Home] Rive companion could not be loaded:', error.message);
    return null;
  }
}
