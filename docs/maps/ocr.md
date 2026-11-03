# OCR

1. **Entry point** — `python -m ocr_server.server` launches the independent loopback daemon on port 21829.
2. **Core logic** — `ocr_server/server.py` performs lazy CPU-only `manga-ocr` loading; `backend/app/services/ocr_service.py` is the sole client boundary and `ocr_process_manager.py` manages optional processes.
3. **API/integration** — `backend/app/main.py` exposes OCR status/start/stop/recognize routes; `extension/content/ocr-selection.js` and `extension/lib/ocr-cropper.js` provide capture input.
4. **Data/configuration** — `backend/app/config.py` resolves the OCR URL; model discovery is configured through the OCR process manager and `KIROKU_OCR_MODEL_PATH`. OCR model files are packaged separately.
5. **Tests** — `backend/tests/test_ocr_*.py`, `test_phase6_ocr_code_runtime.py`, and `extension/tests/ocr-*.test.js`.
6. **Build/runtime dependencies** — `packaging/kiroku_ocr.spec`, `installer/kiroku_ocr_setup.iss`, `release/build-ocr.ps1`, and `release/build-ocr-installer.ps1`. Keep OCR optional and isolated.
