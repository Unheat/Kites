# Kites Architecture & Execution Flow Map

**Pipeline Orchestrator**: `src/offscreen/services/PipelineOrchestrator.ts` -> `PipelineOrchestrator.runPipeline(jobId)`

Below is the complete step-by-step technical execution flow for image translation in the **Kites** browser extension codebase.

---

### Full Technical Flow Diagram

```
[ Extension / Content Script Request ] (`chrome.runtime.sendMessage({ action: 'TRANSLATE_IMAGE' })`)
       │
       │  Stage 1: Background & Offscreen Message Dispatch
       │  File: src/background/index.ts -> chrome.runtime.onMessage.addListener()
       │  File: src/offscreen/index.ts -> chrome.runtime.onMessage.addListener()
       │  File: src/db.ts -> db.translationJobs & db.images
       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Offscreen handler calls `PipelineOrchestrator.runPipeline(jobId)`                         │
│ 2. `db.translationJobs.update(jobId, { status: 'processing' })`                              │
│ 3. Fetches `rawImageBlob` from IndexedDB and converts to ArrayBuffer                         │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ `imageBuffer` (ArrayBuffer)
                                               ▼
       │  Stage 2: OCR & Text Detection (`OcrManager`)
       │  File: src/offscreen/services/OcrManager.ts -> OcrManager.processImage()
       │  File: src/offscreen/services/OcrManager.ts -> OcrManager.getOrLoadEngine(tier)
       │  File: src/offscreen/engines/ocr/CtdOcrEngine.ts -> CtdOcrEngine.detect()
       │  File: src/offscreen/engines/ocr/PaddleOcrEngine.ts -> PaddleOcrEngine.detect() & recognizeCrops()
       │  File: src/shared/utils/geometry.ts -> assignTextDirections() & splitTextRegion()
┌──────┴──────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Receives the selected engine tier (`'comic-text-detector'` or `'paddle-dbnet'`)             │
│ 2. CTD Engine (`CtdOcrEngine.ts`):                                                          │
│    - Detection: Forward pass through `comictextdetector.onnx` via ONNX Runtime Web         │
│    - Recognition: Delegates crop character reading to `PaddleOcrEngine.recognizeCrops()`   │
│ 3. Paddle Engine (`PaddleOcrEngine.ts`):                                                    │
│    - Detection: DBNet text detector                                                         │
│    - Recognition: PP-OCRv4 text recognizer                                                  │
│ 4. Direction & Merge Math (`geometry.ts`): `assignTextDirections()` majority vote &         │
│    `splitTextRegion()` Kruskal MST line merging into `TextBlock` objects                    │
│ 5. Output: `OcrResult` (`texts`, `boxes`, `polygons`, `directions`, `angles`, `lineCounts`)  │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ `ocrResult` ({ texts, polygons, lineCounts... })
                                               ▼
       │  Stage 3: OCR Mask Output (used by inpainting and optional bubble-fit rendering)
       │  File: src/offscreen/engines/ocr/extractPolygons.ts -> extractRawMaskCanvas()
       │  File: src/offscreen/utils/ballonExtractor.ts -> extractBallonRegion() [optional]
┌──────┴──────────────────────────────────────────────────────────────────────────────────────┐
│ 1. `extractRawMaskCanvas()` emits the detector's raw probability mask canvas                 │
│ 2. The default renderer does not use bubble extraction; `manga2eng` may use it separately    │
│ 3. Output: `maskRawCanvas` plus merged text-region polygons                                  │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ Mask Canvas & Polygons
                                               ▼
       │  Stage 4 & 5 (Parallel): Translation & Inpainting
       │  File: src/offscreen/services/PipelineOrchestrator.ts -> Promise.all([translation, inpaint])
       │  
       │  -- Branch A: Translation Waterfall (`TranslationManager`)
       │  File: src/offscreen/services/TranslationManager.ts -> TranslationManager.processTranslation()
       │  File: src/offscreen/engines/translation/ChromeTranslatorEngine.ts -> translate()
       │  File: src/offscreen/engines/translation/WebLLMEngine.ts -> translate()
       │  File: src/offscreen/engines/translation/GoogleTranslateEngine.ts -> translate()
       │  
       │  -- Branch B: Inpainting & Background Erasure (`InpaintManager`)
       │  File: src/offscreen/services/InpaintManager.ts -> InpaintManager.eraseText()
       │  File: src/offscreen/services/InpaintCacheManager.ts -> getCachedOrInpaint()
       │  File: src/offscreen/engines/inpaint/LamaBaseInpaintEngine.ts -> eraseText()
       │  File: src/offscreen/engines/inpaint/TeleaInpaintEngine.ts -> eraseText()
┌──────┴──────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Translation Waterfall: Sequentially executes Primary Engine -> Fallback Chain on error   │
│ 2. Inpainting: `LamaBaseInpaintEngine` runs `lama_fp16.onnx` via WebGPU/WASM to clean image │
│ 3. Output: `translatedTexts` (Array<string>) & `cleanedImageBuffer` (ArrayBuffer)           │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ `translatedTexts` & `cleanedImageBuffer`
                                               ▼
       │  Stage 6: Typesetting & Canvas Text Rendering
       │  File: src/offscreen/services/PipelineOrchestrator.ts -> renderTextBlocksBatch()
       │  File: src/offscreen/utils/cotransDefaultRenderer.ts -> resizeRegionToFontSize() & renderRegionDefault()
       │  File: src/offscreen/utils/canvasTypesetting.ts -> renderTextBlocksBatch() & layoutLines()
       │  File: src/offscreen/utils/hyphenation.ts -> syllables()
┌──────┴──────────────────────────────────────────────────────────────────────────────────────┐
│ 1. `renderTextBlocksBatch()` → `renderTextBlocksDefault()` builds region-based layout        │
│ 2. Font Sizing: Uses merged OCR-region geometry and source line count                        │
│ 3. Hyphenation & Line Wrapping: Fits English text into the rotated OCR region                │
│ 4. OffscreenCanvas Drawing: Renders text with outline stroke onto `cleanedImageBuffer`      │
│ 5. Output: `bakedBlob` (PNG Blob with rendered text burned in)                              │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ `bakedBlob` (Base64 DataURL)
                                               ▼
       │  Stage 7: Database Storage & Return Result
       │  File: src/offscreen/services/PipelineOrchestrator.ts -> db.images.update() & db.textBlocks.bulkAdd()
       │  File: src/db.ts -> IndexedDB persistence
┌──────┴──────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Saves raw clean inpainted image (`cleanedBlob`) to `db.images`                           │
│ 2. Saves translated text blocks + final drawn font sizes to `db.textBlocks`                  │
│ 3. Updates job status: `db.translationJobs.update(jobId, { status: 'completed' })`           │
│ 4. Returns Base64 DataURL string (`bakedBase64`) to Content Script for instant display       │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Detailed Kites Code Reference & Function Index

#### Stage 1: Pipeline Message Entry & DB Fetch
* **Message Listener**: `src/offscreen/index.ts` -> `chrome.runtime.onMessage.addListener()`
* **Main Orchestrator Entry**: `src/offscreen/services/PipelineOrchestrator.ts` -> `PipelineOrchestrator.runPipeline(jobId)`
* **Database Models**: `src/db.ts` -> `KitesDatabase` (`translationJobs`, `images`, `textBlocks`)

#### Stage 2: OCR & Text Detection
* **OCR Manager**: `src/offscreen/services/OcrManager.ts` -> `OcrManager.processImage()`
* **Engine Singleton Resolver**: `src/offscreen/services/OcrManager.ts` -> `OcrManager.getOrLoadEngine()`
* **CTD Engine (Comic Text Detector)**: `src/offscreen/engines/ocr/CtdOcrEngine.ts` -> `CtdOcrEngine.recognize()`
  * *Detection*: Forward pass through `comictextdetector.onnx` via ONNX Runtime Web.
  * *Recognition*: Calls `PaddleOcrEngine.recognizeCrops(imageBuffer, rawPolygons)` (Line 200).
* **Paddle Engine (PaddleOCR DBNet)**: `src/offscreen/engines/ocr/PaddleOcrEngine.ts` -> `PaddleOcrEngine.recognize()` & `recognizeCrops()`
  * *Detection*: DBNet text detector.
  * *Recognition*: PP-OCRv4 text recognizer.
* **Polygon Extractor**: `src/offscreen/engines/ocr/extractPolygons.ts` -> `extractPolygons()`
* **Reading Direction Voting**: `src/offscreen/services/OcrManager.ts` -> `assignTextDirections()`
* **Kruskal MST Region Merging**: `src/shared/utils/geometry.ts` -> `splitTextRegion()` & `quadrilateralCanMergeRegion()`

#### Stage 3: Mask Generation & Speech Bubble Extraction
* **Raw Mask Generator**: `src/offscreen/engines/ocr/extractPolygons.ts` -> `extractRawMaskCanvas()`
* **Optional Speech Bubble Boundary Extractor**: `src/offscreen/utils/ballonExtractor.ts` -> `extractBallonRegion()`

#### Stage 4: Translation Waterfall
* **Translation Manager**: `src/offscreen/services/TranslationManager.ts` -> `TranslationManager.processTranslation()`
* **Engine Waterfall Chain**: `src/offscreen/services/TranslationManager.ts` -> `processTranslation()` (iterates over `engineSequence`)
* **Built-in Chrome AI Engine**: `src/offscreen/engines/translation/ChromeTranslatorEngine.ts` -> `translate()`
* **WebLLM Local LLM Engine**: `src/offscreen/engines/translation/WebLLMEngine.ts` -> `translate()`
* **Google Translate Engine**: `src/offscreen/engines/translation/GoogleTranslateEngine.ts` -> `translate()`

#### Stage 5: Inpainting & Erasure
* **Inpaint Manager**: `src/offscreen/services/InpaintManager.ts` -> `InpaintManager.eraseText()`
* **Cache Manager**: `src/offscreen/services/InpaintCacheManager.ts` -> `getCachedOrInpaint()`
* **LaMa WebGPU Engine**: `src/offscreen/engines/inpaint/LamaBaseInpaintEngine.ts` -> `LamaBaseInpaintEngine.eraseText()`
* **Telea OpenCV Engine**: `src/offscreen/engines/inpaint/TeleaInpaintEngine.ts` -> `TeleaInpaintEngine.eraseText()`

#### Stage 6: Typesetting & Canvas Rendering
* **Batch Render Entry**: `src/offscreen/services/PipelineOrchestrator.ts` -> calls `renderTextBlocksBatch()`
* **Cotrans Default Renderer**: `src/offscreen/utils/cotransDefaultRenderer.ts` -> `resizeRegionToFontSize()` & `renderRegionDefault()`
* **Canvas Renderer**: `src/offscreen/utils/canvasTypesetting.ts` -> `renderTextBlocksBatch()`, `layoutLines()`, `renderTextBlock()`
* **Hyphenation Helper**: `src/offscreen/utils/hyphenation.ts` -> `syllables()`

#### Stage 7: Persistence & Return
* **Image Update**: `src/offscreen/services/PipelineOrchestrator.ts` -> `db.images.update()`
* **TextBlocks Saving**: `src/offscreen/services/PipelineOrchestrator.ts` -> `db.textBlocks.bulkAdd()`
* **Job Completion**: `src/offscreen/services/PipelineOrchestrator.ts` -> `db.translationJobs.update()`
