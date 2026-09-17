/**
 * Kiroku Note - Image Cropper
 * 
 * Standalone utility to crop video bounding rectangles from viewport screenshots.
 * Handles devicePixelRatio scaling, aspect-ratio downscaling, and DRM black frame detection.
 */

(() => {
  /**
   * Scale and clamp video bounding rectangle to viewport image coordinates.
   * 
   * @param {Object} rect - { left, top, width, height }
   * @param {number} pixelRatio - devicePixelRatio (default: 1)
   * @param {number} imageWidth - captured image width in pixels
   * @param {number} imageHeight - captured image height in pixels
   * @returns {Object} { x, y, width, height }
   */
  function calculateCropBounds(rect, pixelRatio = 1, imageWidth = Infinity, imageHeight = Infinity) {
    if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const dpr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
    const left = Number.isFinite(rect.left) ? rect.left : 0;
    const top = Number.isFinite(rect.top) ? rect.top : 0;

    let cropX = Math.round(left * dpr);
    let cropY = Math.round(top * dpr);
    let cropW = Math.round(rect.width * dpr);
    let cropH = Math.round(rect.height * dpr);

    // If left is negative (scrolled partially left), adjust width and clamp
    if (cropX < 0) {
      cropW += cropX;
      cropX = 0;
    }
    // If top is negative (scrolled partially up), adjust height and clamp
    if (cropY < 0) {
      cropH += cropY;
      cropY = 0;
    }

    // Clamp right and bottom to image dimensions if provided
    if (Number.isFinite(imageWidth) && imageWidth > 0) {
      if (cropX >= imageWidth) {
        cropW = 0;
        cropX = imageWidth;
      } else if (cropX + cropW > imageWidth) {
        cropW = Math.max(0, imageWidth - cropX);
      }
    }
    if (Number.isFinite(imageHeight) && imageHeight > 0) {
      if (cropY >= imageHeight) {
        cropH = 0;
        cropY = imageHeight;
      } else if (cropY + cropH > imageHeight) {
        cropH = Math.max(0, imageHeight - cropY);
      }
    }

    return {
      x: Math.max(0, cropX),
      y: Math.max(0, cropY),
      width: Math.max(0, cropW),
      height: Math.max(0, cropH)
    };
  }

  /**
   * Calculate aspect-ratio-preserving downscaled dimensions.
   * 
   * @param {number} sourceWidth 
   * @param {number} sourceHeight 
   * @param {number} maxWidth - maximum allowed width (e.g. 640)
   * @param {number} maxHeight - maximum allowed height (e.g. 360)
   * @returns {Object} { width, height }
   */
  function calculateTargetDimensions(sourceWidth, sourceHeight, maxWidth = 640, maxHeight = 360) {
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
      return { width: 0, height: 0 };
    }

    const maxW = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 640;
    const maxH = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : 360;

    let scale = 1;
    if (sourceWidth > maxW) {
      scale = Math.min(scale, maxW / sourceWidth);
    }
    if (sourceHeight > maxH) {
      scale = Math.min(scale, maxH / sourceHeight);
    }

    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale))
    };
  }

  /**
   * Detect if a pixel buffer represents a solid black or transparent frame (DRM protection).
   * 
   * @param {Uint8ClampedArray|Array<number>} pixelData - RGBA pixel array
   * @param {number} width 
   * @param {number} height 
   * @returns {boolean} true if black/empty/DRM, false if valid content
   */
  function checkBlackFrame(pixelData, width, height) {
    if (!pixelData || pixelData.length === 0 || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return true;
    }

    const totalPixels = width * height;
    // Sample up to 300 points across the frame for fast evaluation
    const sampleStep = Math.max(1, Math.floor(totalPixels / 300));
    let nonBlackCount = 0;

    for (let p = 0; p < totalPixels; p += sampleStep) {
      const idx = p * 4;
      const r = pixelData[idx];
      const g = pixelData[idx + 1];
      const b = pixelData[idx + 2];
      const a = pixelData[idx + 3];

      // If alpha is > 0 and any color channel exceeds noise threshold (4), it's not black
      if (a > 10 && (r > 4 || g > 4 || b > 4)) {
        nonBlackCount++;
        // If we found at least 3 non-black pixels among samples, this is a real image
        if (nonBlackCount >= 3) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Default image loader for browser environments.
   */
  function defaultLoadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error("Failed to load viewport image for cropping"));
      img.src = src;
    });
  }

  /**
   * Crop a video frame from a viewport data URL.
   * 
   * @param {string} viewportDataUrl - base64 JPEG data URL of visible tab
   * @param {Object} rect - bounding client rect { left, top, width, height }
   * @param {Object} options - { devicePixelRatio, maxWidth, maxHeight, quality, checkDrm, loadImage, createCanvas }
   * @returns {Promise<Object>} { ok: true, dataUrl, width, height } or { ok: false, error, message }
   */
  async function cropVideoFrame(viewportDataUrl, rect, options = {}) {
    if (!viewportDataUrl || typeof viewportDataUrl !== "string") {
      return { ok: false, error: "INVALID_IMAGE_DATA", message: "Viewport data URL is required" };
    }

    if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return { ok: false, error: "INVALID_VIDEO_RECT", message: "Video rect has zero or invalid dimensions" };
    }

    try {
      const loader = options.loadImage || defaultLoadImage;
      const img = await loader(viewportDataUrl);

      const imgWidth = img.naturalWidth || img.width || 0;
      const imgHeight = img.naturalHeight || img.height || 0;

      if (!Number.isFinite(imgWidth) || !Number.isFinite(imgHeight) || imgWidth <= 0 || imgHeight <= 0) {
        return { ok: false, error: "IMAGE_LOAD_ERROR", message: "Loaded image has invalid dimensions" };
      }

      const dpr = Number.isFinite(options.devicePixelRatio) && options.devicePixelRatio > 0
        ? options.devicePixelRatio
        : ((typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0) ? window.devicePixelRatio : 1);

      const bounds = calculateCropBounds(rect, dpr, imgWidth, imgHeight);

      if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        return { ok: false, error: "INVALID_CROP_BOUNDS", message: "Video coordinates fall outside viewport image" };
      }

      const maxWidth = typeof options.maxWidth === "number" ? options.maxWidth : 640;
      const maxHeight = typeof options.maxHeight === "number" ? options.maxHeight : 360;
      const target = calculateTargetDimensions(bounds.width, bounds.height, maxWidth, maxHeight);

      const canvas = options.createCanvas
        ? options.createCanvas(target.width, target.height)
        : document.createElement("canvas");

      canvas.width = target.width;
      canvas.height = target.height;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        return { ok: false, error: "CANVAS_CONTEXT_ERROR", message: "Could not create 2D canvas context" };
      }

      ctx.drawImage(
        img,
        bounds.x, bounds.y, bounds.width, bounds.height,
        0, 0, target.width, target.height
      );

      // Check for DRM protected blank/black frames if enabled (default: true)
      if (options.checkDrm !== false) {
        try {
          const frameData = ctx.getImageData(0, 0, target.width, target.height);
          if (checkBlackFrame(frameData.data, target.width, target.height)) {
            return {
              ok: false,
              error: "DRM_PROTECTED",
              message: "Protected stream: Screenshots unavailable"
            };
          }
        } catch (e) {
          // If reading pixel data fails, continue with export
        }
      }

      const quality = typeof options.quality === "number" ? options.quality : 0.92;
      const dataUrl = canvas.toDataURL("image/jpeg", quality);

      return {
        ok: true,
        dataUrl,
        width: target.width,
        height: target.height
      };
    } catch (err) {
      return {
        ok: false,
        error: "CROP_FAILED",
        message: err?.message || "Failed to crop video frame"
      };
    }
  }

  const ImageCropper = {
    calculateCropBounds,
    calculateTargetDimensions,
    checkBlackFrame,
    cropVideoFrame
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = ImageCropper;
  } else {
    globalThis.ImageCropper = ImageCropper;
  }
})();
