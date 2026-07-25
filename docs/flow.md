# Cotrans Execution & Text Flow Map

**Pipeline Orchestrator**: `manga_translator/manga_translator.py` -> `MangaTranslator._translate()`

Below is the complete step-by-step technical execution flow for text detection, recognition, grouping, translation, validation, and rendering in Cotrans.

---

### Full Technical Flow Diagram

```
[ Scaled RGB Image ] (`Context.upscaled`)
       │
       │  Stage 3: Detection (default = DBNet-ResNet34 `detect-20241225.ckpt`)
       │  File: manga_translator/manga_translator.py -> MangaTranslator._run_detection()
       │  File: manga_translator/detection/__init__.py -> dispatch()
       │  File: manga_translator/detection/default.py -> DefaultDetector._infer() & det_batch_forward_default()
       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Forward pass through `DefaultDetector` (`manga_translator/detection/default_utils/DBNet_resnet34.py`)│
│ 2. Post-processing (`SegDetectorRepresenter.represent()` & `adjustResultCoordinates()`)       │
│ 3. Output: List of `Quadrilateral` objects (4-point polygon coordinates)                    │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ List[Quadrilateral]
                                               ▼
       │  Stage 4: OCR Recognition (default = 48px RoFormer ViT)
       │  File: manga_translator/manga_translator.py -> MangaTranslator._run_ocr()
       │  File: manga_translator/ocr/__init__.py -> dispatch()
       │  File: manga_translator/ocr/common.py -> CommonOCR._generate_text_direction()
       │  File: manga_translator/ocr/model_48px.py -> Model48pxOCR._infer() & infer_beam_batch_tensor()
       │  File: manga_translator/utils/bubble.py -> is_ignore() & check_color()
┌──────┴──────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Direction Detection: `_generate_text_direction()` majority-vote via NetworkX graph ('h'/'v') │
│ 2. Crop & Perspective Warp: `Quadrilateral.get_transformed_region()` normalizes line to 48px│
│ 3. ViT Inference: `infer_beam_batch_tensor()` predicts text tokens + per-char FG/BG RGB      │
│ 4. Bubble Filter: `is_ignore()` filters out non-bubble text via border pixel analysis       │
│ 5. Output: List of `Quadrilateral` objects populated with text string, direction & FG/BG color│
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ List[Quadrilateral] (populated with text)
                                               ▼
       │  Stage 5: Textline Merge & Region Grouping
       │  File: manga_translator/manga_translator.py -> MangaTranslator._run_textline_merge()
       │  File: manga_translator/textline_merge/__init__.py -> split_text_region()
       │  File: manga_translator/utils/textblock.py -> visualize_textblocks() & sort_textblocks()
┌──────┴──────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Kruskal Minimum Spanning Tree distance analysis (`split_text_region()`)                  │
│ 2. Groups adjacent textlines into single speech bubble `TextBlock` objects                  │
│ 3. Panel Detection & RTL Sorting: Sorts bubbles top-to-bottom, right-to-left                │
│ 4. Output: List of `TextBlock` objects (containing merged lines & overall AABB)             │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ List[TextBlock]
                                               ▼
       │  Stage 6: Pre-Dict Match (Glossary Term Replacement)
       │  File: manga_translator/manga_translator.py -> load_dictionary() & apply_dictionary()
┌──────┴──────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Reads regex entries from dictionary file (`load_dictionary()`)                           │
│ 2. Applies `apply_dictionary()` in-place for all `region.text` in `ctx.text_regions`         │
│ 3. Output: Cleaned Japanese text strings ready for translation                              │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ List[TextBlock]
                                               ▼
       │  Stage 7: Translation (default = NMT / Sugoi / LLM)
       │  File: manga_translator/manga_translator.py -> MangaTranslator._run_text_translation()
       │  File: manga_translator/manga_translator.py -> MangaTranslator._batch_translate_texts()
       │  File: manga_translator/translators/__init__.py -> dispatch()
       │  File: manga_translator/translators/sugoi.py -> SugoiTranslator._translate()
┌──────┴──────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Batches queries and dispatches to translator engine (`dispatch()`)                       │
│ 2. Populates `region.translation` string for each `TextBlock`                               │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ List[TextBlock] (with `region.translation`)
                                               ▼
       │  Stage 8: Post-Check (Hallucination & Quality Control)
       │  File: manga_translator/manga_translator.py -> MangaTranslator._validate_translation()
       │  File: manga_translator/manga_translator.py -> MangaTranslator._check_repetition_hallucination()
       │  File: manga_translator/manga_translator.py -> MangaTranslator._check_target_language_ratio()
       │  File: manga_translator/manga_translator.py -> MangaTranslator._retry_translation_with_validation()
┌──────┴──────────────────────────────────────────────────────────────────────────────────────┐
│ 1. `_check_repetition_hallucination()`: Scans for repeated word/n-gram loops                │
│ 2. `_check_target_language_ratio()`: Language classification via `py3langid`                │
│ 3. `_retry_translation_with_validation()`: Re-dispatches failed regions (up to 3 retries)   │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ Validated List[TextBlock]
                                               ▼
       │  Stage 11: Typesetting & Text Rendering (default = text_render.py)
       │  File: manga_translator/manga_translator.py -> MangaTranslator._run_text_rendering()
       │  File: manga_translator/rendering/__init__.py -> fg_bg_compare() & resize_regions_to_font_size()
       │  File: manga_translator/rendering/text_render.py -> render_textblock_list() & render_textblock()
┌──────┴──────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Font Size Calculation: Computes optimal font size based on AABB & line count             │
│ 2. Color Palette Adjustment: `fg_bg_compare()` ensures high contrast fill (FG) & stroke (BG)│
│ 3. Line Wrapping & Hyphenation: Fits English text lines into rotated polygon box            │
│ 4. PIL Drawing: `render_textblock()` renders text with outline stroke onto background image │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │
                                               ▼
                        [ Final Composite Image Output ] (`ctx.result`)
```

---

### Detailed Code Reference & Function Index

#### Stage 3: Text Detection
* **Main Entry**: `manga_translator/manga_translator.py` -> `MangaTranslator._run_detection()`
* **Dispatcher**: `manga_translator/detection/__init__.py` -> `dispatch()`
* **Detector Class**: `manga_translator/detection/default.py` -> `DefaultDetector`
* **Inference Method**: `manga_translator/detection/default.py` -> `DefaultDetector._infer()`
* **Tensor Forward**: `manga_translator/detection/default.py` -> `det_batch_forward_default()`
* **Model Architecture**: `manga_translator/detection/default_utils/DBNet_resnet34.py` -> `TextDetectionDefault`

#### Stage 4: OCR Recognition
* **Main Entry**: `manga_translator/manga_translator.py` -> `MangaTranslator._run_ocr()`
* **Dispatcher**: `manga_translator/ocr/__init__.py` -> `dispatch()`
* **OCR Class**: `manga_translator/ocr/model_48px.py` -> `Model48pxOCR`
* **Direction Detection**: `manga_translator/ocr/common.py` -> `CommonOCR._generate_text_direction()`
* **Perspective Crop**: `manga_translator/utils/quadrilateral.py` -> `Quadrilateral.get_transformed_region()`
* **ViT Beam Search**: `manga_translator/ocr/model_48px.py` -> `OCR.infer_beam_batch_tensor()`
* **Bubble Filter**: `manga_translator/utils/bubble.py` -> `is_ignore()` & `check_color()`

#### Stage 5: Textline Merge
* **Main Entry**: `manga_translator/manga_translator.py` -> `MangaTranslator._run_textline_merge()`
* **Region Splitting & Graph Merge**: `manga_translator/textline_merge/__init__.py` -> `split_text_region()`
* **Block Visualization & Sorting**: `manga_translator/utils/textblock.py` -> `visualize_textblocks()`

#### Stage 6: Pre-Dictionary Replacement
* **Main Entry**: `manga_translator/manga_translator.py` -> inside `_translate()`
* **Dictionary Loader**: `manga_translator/manga_translator.py` -> `load_dictionary()`
* **Term Replacer**: `manga_translator/manga_translator.py` -> `apply_dictionary()`

#### Stage 7: Translation
* **Main Entry**: `manga_translator/manga_translator.py` -> `MangaTranslator._run_text_translation()`
* **Batch Translating**: `manga_translator/manga_translator.py` -> `MangaTranslator._batch_translate_texts()`
* **Dispatcher**: `manga_translator/translators/__init__.py` -> `dispatch()`
* **Translator Modules**: `manga_translator/translators/sugoi.py`, `chatgpt.py`, `gemini.py`, etc.

#### Stage 8: Post-Translation Check
* **Validator Entry**: `manga_translator/manga_translator.py` -> `MangaTranslator._validate_translation()`
* **Repetition Checker**: `manga_translator/manga_translator.py` -> `MangaTranslator._check_repetition_hallucination()`
* **Language Ratio Checker**: `manga_translator/manga_translator.py` -> `MangaTranslator._check_target_language_ratio()`
* **Retry Handler**: `manga_translator/manga_translator.py` -> `MangaTranslator._retry_translation_with_validation()`

#### Stage 11: Typesetting & Text Rendering
* **Main Entry**: `manga_translator/manga_translator.py` -> `MangaTranslator._run_text_rendering()`
* **Color Comparison**: `manga_translator/rendering/__init__.py` -> `fg_bg_compare()`
* **Region Resizing**: `manga_translator/rendering/__init__.py` -> `resize_regions_to_font_size()`
* **Render Dispatcher**: `manga_translator/rendering/text_render.py` -> `render_textblock_list()`
* **Block Drawer**: `manga_translator/rendering/text_render.py` -> `render_textblock()`




                          ┌───────────────────────────────────────────────┐
                          │   manga_translator/manga_translator.py        │
                          │   MangaTranslator._translate() [Orchestrator] │
                          └──────────────────────┬────────────────────────┘
                                                 │
      ┌──────────────────────────────────────────┼──────────────────────────────────────────┐
      │                                          │                                          │
      ▼ (1. Detection)                           ▼ (2. OCR)                                 ▼ (3. Merge)
┌─────────────────────────────────┐    ┌─────────────────────────────────┐    ┌─────────────────────────────────┐
│ manga_translator/detection/     │    │ manga_translator/ocr/           │    │ manga_translator/textline_merge/│
│ ├── __init__.py (dispatch)      │    │ ├── __init__.py (dispatch)      │    │ ├── __init__.py                 │
│ ├── paddle_rust.py              │    │ ├── common.py                   │    │ │   (split_text_region MST)     │
│ │   (PaddleDetector)            │    │ │   (_generate_text_direction)  │    └────────────────┬────────────────┘
│ └── common_rust.py              │    │ └── model_48px.py (Model48pxOCR)│                     │
│     (RustDetector.detect)       │    │     (infer_beam_batch_tensor)  │                     ▼
└────────────────┬────────────────┘    └────────────────┬────────────────┘    ┌─────────────────────────────────┐
                 │                                      │                     │ manga_translator/utils/         │
                 ▼                                      ▼                     │ ├── textblock.py                │
┌─────────────────────────────────┐    ┌─────────────────────────────────┐    │ │   (visualize/sort_textblocks) │
│ rusty_manga_image_translator    │    │ manga_translator/utils/         │    │ └── quadrilateral.py            │
│ (Rust ONNX Session:             │    │ └── bubble.py (is_ignore)        │    │     (Quadrilateral geometry)    │
│  Paddle DBNet Detection)        │    └─────────────────────────────────┘    └────────────────┬────────────────┘
└─────────────────────────────────┘                                                            │
                                                                                               ▼
      ┌──────────────────────────────────────────┬─────────────────────────────────────────────┘
      │                                          │
      ▼ (4. Pre-Dict)                            ▼ (5. Translation)
┌─────────────────────────────────┐    ┌─────────────────────────────────┐
│ manga_translator/               │    │ manga_translator/translators/   │
│ └── manga_translator.py         │    │ ├── __init__.py (dispatch)      │
│     ├── load_dictionary()       │    │ └── sugoi.py / chatgpt.py       │
│     └── apply_dictionary()      │    └────────────────┬────────────────┘
└─────────────────────────────────┘                     │
                                                        ▼ (6. Post-Check Validation)
                                       ┌─────────────────────────────────┐
                                       │ manga_translator/               │
                                       │ └── manga_translator.py         │
                                       │     ├── _validate_translation() │
                                       │     ├── _check_repetition...()  │
                                       │     └── _retry_translation...() │
                                       └────────────────┬────────────────┘
                                                        │
      ┌─────────────────────────────────────────────────┼─────────────────────────────────────────────┐
      │                                                 │                                             │
      ▼ (7. Mask Refine)                                ▼ (8. Inpaint)                                ▼ (9. Render / Typeset)
┌─────────────────────────────────┐    ┌─────────────────────────────────┐    ┌─────────────────────────────────┐
│ manga_translator/               │    │ manga_translator/inpainting/    │    │ manga_translator/rendering/     │
│ └── mask_refinement/            │    │ ├── __init__.py (dispatch)      │    │ ├── __init__.py                 │
│     ├── __init__.py             │    │ └── inpainting_lama.py          │    │ │   (resize_regions_to_font_size│
│     └── text_mask_utils.py      │    │     (LamaLargeInpainter)        │    │ │    fg_bg_compare)            │
│         (refine_mask DenseCRF)  │    └─────────────────────────────────┘    │ └── text_render.py              │
└─────────────────────────────────┘                                           │     (render_textblock_list)     │
                                                                              └─────────────────┬───────────────┘
                                                                                                │
                                                                                                ▼
                                                                                 [ Output Image Composite ]
