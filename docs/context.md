# Spatial Image & Manga Translator — Project Context & Reference Guide

This document records the core context, architectural decisions, and technical specifications for the **Full Stack Spatial Image & Manga Translator** (WEB103 Final Project). It summarizes the pivot away from previous ideas (such as DevScope, AgroPool, ContractGuard, etc.) to focus exclusively on this local-first, web-scraping-enabled image translation platform.

---

## 1. Project Concept & Architecture

The project consists of a hybrid architecture comprising a **Render-hosted Web Application** and a **Manifest V3 Chrome Extension** sharing a React codebase. The application allows users to upload images (manga panels, diagrams, blueprints), automatically translate text while retaining precise layout positioning, edit the translated text on an interactive canvas, and export the project.

### Core User Flow
1. **Upload / Capture**: The user uploads an image to the web app, or triggers the Chrome Extension on any website (spawning a small "Translate" button on top of target images).
2. **OCR & Detection**: The image is analyzed to find text bounding boxes (x, y, width, height) and extract the original text.
3. **Translation**: The extracted text is translated via a local or cloud LLM.
4. **Editable Workspace**: The results are drawn onto an interactive canvas (`react-konva`). The user can click any text block to edit text, move bounding boxes, modify font properties (family, size, alignment), or adjust colors.
5. **Export**: Users can download a flattened translated image or a layered `.json` / `.psd` project file for further editing.

---

## 2. Technical Decisions & Challenges

### A. Client-Side Edge AI (Zero Setup)
*   **The Goal**: Let users run AI models locally using their browser's CPU/GPU to ensure privacy and eliminate backend API hosting costs.
*   **The Solution**: Use **Transformers.js** (MarianMT translation models) and **WebLLM** running locally via WebAssembly (Wasm) and WebGPU. 
*   **Caching**: Model weights are downloaded once from Hugging Face and cached using the browser's built-in **Web Cache API** (managed by Transformers.js) or **IndexedDB**. On future visits, models load instantly from local storage.
*   **Extension-to-Web Syncing**: Since the Web Cache API is partitioned by origin, the Render site will detect the Extension's presence and coordinate model utilization using `window.postMessage` to avoid double-downloading weights.

### B. Single-Pass Multi-Language OCR
*   **The Goal**: Detect both text position (bounding boxes) and recognize text (OCR) inside the browser.
*   **The Decision**: Instead of combining separate detection (CRAFT/YOLO) and recognition (Manga-OCR) models, the project will use **PaddleOCR** compiled to **ONNX WebAssembly** via wrappers like `client-ocr` or `ppu-paddle-ocr`. 
*   **Benefits**: Out-of-the-box support for over 80 languages, single-pass processing, and browser-native execution.

### C. Dynamic Font Auto-Scaling & Wrapping
*   **The Goal**: Keep translated text within the bounding boxes without bleeding out of speech bubbles.
*   **The Solution**: Adapt the rendering math used in Python's `manga-image-translator` to JavaScript:
    1.  **Word Wrapping**: Read the bounding box width and split the text into lines where no single line exceeds that width.
    2.  **Binary Search Font Sizing**: Start with a default font size, measure the cumulative height of wrapped lines using Canvas's `CanvasRenderingContext2D.measureText()`, and perform a binary search (scaling font size down) until the text fits the box constraints.
    3.  **Failsafe**: Provide sliders in the React UI for manual adjustment of font parameters.

### D. Local-First Chrome Extension (Dashboard Options Page)
*   **The Design**: The Chrome Extension packages the React app frontend inside an Extension/Options page (`chrome-extension://...`).
*   **Storage**: In extension mode, history and projects are stored inside the extension's local `IndexedDB` (no account/login required).
*   **Service Worker & Offscreen Documents**: In Manifest V3, background workers lack DOM access. The extension will spin up an invisible **Offscreen Document** to perform canvas/image processing and run Tesseract/ONNX models.

---

## 3. Important References & Tool Links

The following tools and libraries are critical references for the development of this project:

### AI Core & Models
*   **[Transformers.js](https://huggingface.co/docs/transformers.js)**: Library for running Hugging Face models natively in the browser via ONNX Runtime Web.
*   **[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)**: State-of-the-art multi-lingual OCR toolkit used for single-pass local detection and recognition.

### Spatial Rendering & Translation References
*   **[manga-image-translator](https://github.com/zyddnys/manga-image-translator)**: The reference Python repository for high-quality manga translation pipelines, containing text inpainting and text typesetting logic (Pillow `textbbox` implementation).
*   **[manga-ocr](https://github.com/kha-white/manga-ocr)**: A dedicated OCR tool optimized for Japanese manga text.
*   **[Manga Translator Chrome Extension](https://chromewebstore.google.com/detail/manga-translator%F0%9F%8D%93/lepcfgkehgeiblekejomdmdklmjdmflp)**: The primary UX reference for on-page scraper overlays and image translation.

### Extension & Web APIs
*   **[Chrome Offscreen Documents API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)**: Documentation on managing invisible documents for image/tensor processing in Manifest V3 background scripts.

