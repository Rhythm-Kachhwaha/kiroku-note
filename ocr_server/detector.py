"""
Kiroku Note — Comic Text & Bubble Detector
------------------------------------------
Lightweight ONNX inference for speech bubble and text block localization.
Using comic-text-detector ONNX model (1024x1024 input).
Strictly isolated to repository virtual environment.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
from PIL import Image

logger = logging.getLogger("kiroku_ocr_server.detector")

DEFAULT_MODEL_PATH = Path(__file__).parent / "models" / "comictextdetector.onnx"


class ComicTextDetector:
    """Runs ONNX inference to detect text blocks and speech bubbles in manga images."""

    def __init__(self, model_path: str | Path | None = None, device: str = "cpu") -> None:
        self.model_path = Path(model_path or DEFAULT_MODEL_PATH)
        self.device = device
        self._session: Any | None = None

    def is_available(self) -> bool:
        """Check if ONNX model file exists and onnxruntime is importable."""
        if not self.model_path.exists():
            return False
        try:
            import onnxruntime  # noqa: F401
            return True
        except ImportError:
            return False

    def _get_session(self) -> Any:
        if self._session is not None:
            return self._session

        import onnxruntime as ort

        providers = ["CPUExecutionProvider"]
        if self.device.lower() in ("cuda", "gpu"):
            available = ort.get_available_providers()
            if "CUDAExecutionProvider" in available:
                providers.insert(0, "CUDAExecutionProvider")

        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        self._session = ort.InferenceSession(
            str(self.model_path),
            sess_options=sess_options,
            providers=providers,
        )
        return self._session

    def detect(self, img: Image.Image, conf_threshold: float = 0.35) -> List[Dict[str, Any]]:
        """
        Detect text/bubble boxes on a PIL image.
        Returns list of dicts:
        [
          {"box": [x1, y1, x2, y2], "score": float, "type": "text" | "bubble"},
          ...
        ]
        Coordinates are scaled to original image dimensions (0 to orig_w, 0 to orig_h).
        """
        if not self.is_available():
            logger.warning("ComicTextDetector not available (model missing or onnxruntime not found).")
            return []

        orig_w, orig_h = img.size
        # Resize maintaining aspect ratio with letterboxing to 1024x1024
        target_size = 1024
        scale = min(target_size / orig_w, target_size / orig_h)
        nw, nh = int(orig_w * scale), int(orig_h * scale)
        resized = img.convert("RGB").resize((nw, nh), Image.Resampling.BILINEAR)

        # Pad to 1024x1024
        padded = Image.new("RGB", (target_size, target_size), (128, 128, 128))
        pad_x = (target_size - nw) // 2
        pad_y = (target_size - nh) // 2
        padded.paste(resized, (pad_x, pad_y))

        # Convert to numpy NCHW float32 normalized [0, 1]
        input_data = np.array(padded, dtype=np.float32) / 255.0
        input_data = np.transpose(input_data, (2, 0, 1))  # HWC to CHW
        input_data = np.expand_dims(input_data, axis=0)  # Add batch dim

        sess = self._get_session()
        input_name = sess.get_inputs()[0].name
        outputs = sess.run(None, {input_name: input_data})

        # Output 0 is `blk`: [1, N, 7] where each proposal is [x1, y1, x2, y2, score, ...]
        raw_blocks = outputs[0][0]

        proposals: List[Dict[str, Any]] = []
        for item in raw_blocks:
            score = float(item[4])
            if score < conf_threshold:
                continue

            bx1, by1, bx2, by2 = float(item[0]), float(item[1]), float(item[2]), float(item[3])

            # Un-pad and un-scale back to original image
            bx1 = (bx1 - pad_x) / scale
            by1 = (by1 - pad_y) / scale
            bx2 = (bx2 - pad_x) / scale
            by2 = (by2 - pad_y) / scale

            # Clamp coordinates
            x1 = max(0.0, min(float(orig_w), bx1))
            y1 = max(0.0, min(float(orig_h), by1))
            x2 = max(0.0, min(float(orig_w), bx2))
            y2 = max(0.0, min(float(orig_h), by2))

            if x2 - x1 >= 8 and y2 - y1 >= 8:
                proposals.append({
                    "box": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                    "score": round(score, 3),
                    "type": "bubble",
                })

        # Apply simple Non-Maximum Suppression (NMS) to remove overlapping proposals
        filtered = self._apply_nms(proposals, iou_threshold=0.3)

        # Sort reading order: Japanese manga reading order is right-to-left, top-to-bottom
        # Primary sort: x2 descending (rightmost first), secondary: y1 ascending (top first)
        # Group by column-ish bands
        filtered.sort(key=lambda b: (-b["box"][2], b["box"][1]))

        return filtered

    @staticmethod
    def _apply_nms(boxes: List[Dict[str, Any]], iou_threshold: float = 0.3) -> List[Dict[str, Any]]:
        if not boxes:
            return []

        # Sort by confidence score descending
        sorted_boxes = sorted(boxes, key=lambda x: x["score"], reverse=True)
        keep: List[Dict[str, Any]] = []

        while sorted_boxes:
            current = sorted_boxes.pop(0)
            keep.append(current)
            c_box = current["box"]

            remaining = []
            for b in sorted_boxes:
                b_box = b["box"]
                # Calculate IoU
                ix1 = max(c_box[0], b_box[0])
                iy1 = max(c_box[1], b_box[1])
                ix2 = min(c_box[2], b_box[2])
                iy2 = min(c_box[3], b_box[3])

                inter_w = max(0.0, ix2 - ix1)
                inter_h = max(0.0, iy2 - iy1)
                inter_area = inter_w * inter_h

                area_c = (c_box[2] - c_box[0]) * (c_box[3] - c_box[1])
                area_b = (b_box[2] - b_box[0]) * (b_box[3] - b_box[1])
                union_area = area_c + area_b - inter_area

                iou = inter_area / union_area if union_area > 0 else 0.0
                if iou < iou_threshold:
                    remaining.append(b)

            sorted_boxes = remaining

        return keep

