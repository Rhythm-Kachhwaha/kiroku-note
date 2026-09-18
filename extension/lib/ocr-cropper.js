/**
 * Kiroku Note - OCR Cropper
 * 
 * Standalone utility to calculate high-DPI aware crop boundaries for OCR selection
 * and crop image data URLs using HTML5 Canvas.
 */

(() => {
  /**
   * Normalize two mouse coordinates into a standard bounding box { left, top, width, height }
   * regardless of the direction the user dragged (SE, NW, SW, NE).
   * 
   * @param {number} startX
   * @param {number} startY
   * @param {number} currentX
   * @param {number} currentY
   * @returns {{ left: number, top: number, width: number, height: number }}
   */
  function normalizeSelectionRect(startX, startY, currentX, currentY) {
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    return { left, top, width, height };
  }

  /**
   * Validate whether a selection rectangle meets the minimum sensible size.
   * 
   * @param {{ width?: number, height?: number } | null} rect
   * @param {number} [minWidth=10]
   * @param {number} [minHeight=10]
   * @returns {boolean}
   */
  function isValidSelection(rect, minWidth = 10, minHeight = 10) {
    if (!rect || typeof rect !== "object") return false;
    const w = Number(rect.width) || 0;
    const h = Number(rect.height) || 0;
    return w >= minWidth && h >= minHeight;
  }

  /**
   * Scale and clamp a viewport CSS selection rectangle to actual screenshot image pixel coordinates.
   * Accurately accounts for devicePixelRatio, browser zoom, and high-DPI displays.
   * 
   * @param {{ left: number, top: number, width: number, height: number }} rect - CSS viewport coordinates
   * @param {{ innerWidth?: number, innerHeight?: number }} [viewport] - Viewport dimensions
   * @param {{ naturalWidth?: number, naturalHeight?: number, width?: number, height?: number }} [imageDimensions] - Captured screenshot dimensions
   * @returns {{ x: number, y: number, width: number, height: number }}
   */
  function calculateOcrCropBounds(rect, viewport = {}, imageDimensions = {}) {
    if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const rectLeft = Number.isFinite(rect.left) ? rect.left : (Number.isFinite(rect.x) ? rect.x : 0);
    const rectTop = Number.isFinite(rect.top) ? rect.top : (Number.isFinite(rect.y) ? rect.y : 0);

    const vpW = Number.isFinite(viewport?.innerWidth) && viewport.innerWidth > 0
      ? viewport.innerWidth
      : (Number.isFinite(viewport?.width) && viewport.width > 0 ? viewport.width : (typeof window !== "undefined" ? window.innerWidth : 1));
    const vpH = Number.isFinite(viewport?.innerHeight) && viewport.innerHeight > 0
      ? viewport.innerHeight
      : (Number.isFinite(viewport?.height) && viewport.height > 0 ? viewport.height : (typeof window !== "undefined" ? window.innerHeight : 1));

    const imgW = Number.isFinite(imageDimensions?.naturalWidth) && imageDimensions.naturalWidth > 0
      ? imageDimensions.naturalWidth
      : (Number.isFinite(imageDimensions?.width) && imageDimensions.width > 0 ? imageDimensions.width : vpW);
    const imgH = Number.isFinite(imageDimensions?.naturalHeight) && imageDimensions.naturalHeight > 0
      ? imageDimensions.naturalHeight
      : (Number.isFinite(imageDimensions?.height) && imageDimensions.height > 0 ? imageDimensions.height : vpH);

    // Scale factors between screenshot pixels and viewport CSS pixels
    const scaleX = imgW / vpW;
    const scaleY = imgH / vpH;

    let cropX = Math.round(rectLeft * scaleX);
    let cropY = Math.round(rectTop * scaleY);
    let cropW = Math.round(rect.width * scaleX);
    let cropH = Math.round(rect.height * scaleY);

    // Clamp negative left/top
    if (cropX < 0) {
      cropW += cropX;
      cropX = 0;
    }
    if (cropY < 0) {
      cropH += cropY;
      cropY = 0;
    }

    // Clamp width/height to image boundaries
    if (cropX >= imgW) {
      cropW = 0;
      cropX = imgW;
    } else if (cropX + cropW > imgW) {
      cropW = Math.max(0, imgW - cropX);
    }

    if (cropY >= imgH) {
      cropH = 0;
      cropY = imgH;
    } else if (cropY + cropH > imgH) {
      cropH = Math.max(0, imgH - cropY);
    }

    return {
      x: Math.max(0, cropX),
      y: Math.max(0, cropY),
      width: Math.max(0, cropW),
      height: Math.max(0, cropH)
    };
  }

  /**
   * Crop a screenshot data URL or Image element to the specified crop bounds using Canvas.
   * 
   * @param {string | HTMLImageElement} imageSource - Base64 Data URL or Image element
   * @param {{ x: number, y: number, width: number, height: number }} cropBounds
   * @param {Object} [options] - { mimeType: "image/jpeg", quality: 0.95 }
   * @returns {Promise<string>} Cropped Data URL
   */
  async function cropScreenshotToDataUrl(imageSource, cropBounds, options = {}) {
    if (!cropBounds || cropBounds.width <= 0 || cropBounds.height <= 0) {
      throw new Error("Invalid crop bounds: width and height must be greater than 0");
    }

    let img;
    if (typeof imageSource === "string") {
      img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = (err) => reject(new Error("Failed to load source screenshot for cropping: " + (err?.message || "Unknown error")));
        image.src = imageSource;
      });
    } else {
      img = imageSource;
    }

    const canvas = document.createElement("canvas");
    canvas.width = cropBounds.width;
    canvas.height = cropBounds.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not acquire 2D canvas context for cropping");
    }

    ctx.drawImage(
      img,
      cropBounds.x,
      cropBounds.y,
      cropBounds.width,
      cropBounds.height,
      0,
      0,
      cropBounds.width,
      cropBounds.height
    );

    const mimeType = options.mimeType || "image/jpeg";
    const quality = typeof options.quality === "number" ? options.quality : 0.95;
    return canvas.toDataURL(mimeType, quality);
  }

  const exportObj = {
    normalizeSelectionRect,
    isValidSelection,
    calculateOcrCropBounds,
    cropScreenshotToDataUrl,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportObj;
  }
  if (typeof window !== "undefined") {
    window.KirokuOcrCropper = exportObj;
  }
})();
