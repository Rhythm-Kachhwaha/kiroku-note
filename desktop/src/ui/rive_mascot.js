const PRIMARY_COMPANION_ASSET = '27746-52412-cat-companion.riv';

/**
 * Mounts Kiroku's primary Rive companion on the desktop Home screen.
 * The asset URL is supplied by the narrow desktop bridge, keeping source and
 * packaged builds independent of their on-disk resource locations.
 */
export async function mountRiveMascot(canvas) {
  if (!canvas || !window.rive?.Rive || !window.desktopAPI?.getRiveAssetUrl) {
    return null;
  }

  try {
    const src = await window.desktopAPI.getRiveAssetUrl(PRIMARY_COMPANION_ASSET);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const riveInstance = new window.rive.Rive({
      src,
      canvas,
      autoplay: !reducedMotion,
      layout: new window.rive.Layout({
        fit: window.rive.Fit.Contain,
        alignment: window.rive.Alignment.Center
      }),
      onLoad: () => riveInstance.resizeDrawingSurfaceToCanvas()
    });

    const resizeObserver = new ResizeObserver(() => riveInstance.resizeDrawingSurfaceToCanvas());
    resizeObserver.observe(canvas);

    return {
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
