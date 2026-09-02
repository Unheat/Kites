# Archived Transformers.js Translation

This directory preserves the former Transformers.js translation implementation and its NLLB/Marian model catalog. It was disconnected on 2026-08-31 because the runtime engine was not working reliably.

Nothing in `src/` may import this directory. The active translation engines are WebLLM, Google Translate, and separately implemented external API engines. OCR and inpainting ONNX runtime code remains active and is unrelated to this archive.

To revisit this experiment, restore the engine and tests under `src/offscreen/engines/translation/`, restore the archived registry entries, add back the package dependency, then rebuild explicit manager routing and test it before exposing it in the popup.
