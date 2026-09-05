# Full Stack Spatial Image & Manga Translator (Personal Project Plan)

## 1. Project Overview & Flow
A Chrome Extension-first web application that allows users to translate text within images (like manga panels, blueprints, or diagrams), overlaying translated text in real-time, and letting users edit the result on a dynamic, local-first canvas. The core philosophy is "Local-First Storage, Dual-Compute" where all user data is stored locally, and the user can choose to compute translations locally (free) or via a cloud server (premium).

**User Flow:**
1. **Onboarding / Installation:** User installs the extension. The extension is the "Main Brain".
2. **Model Setup (Local Mode):** On first run, the extension downloads the local translation models (~100MB) from a CDN (Hugging Face) and caches them.
3. **Capture / Scrape (Option A + Manual):** User clicks "Translate" on a detected `<img>` tag via a Content Script overlay. For protected sites (Canvas/DRM), the user can take an OS screenshot and manually upload it via the Dashboard.
4. **Compute (Dual-Mode):** The image is translated via the selected mode (Local Wasm/WebGPU or Premium Cloud API).
5. **Local DB Save:** The image, OCR boxes, and translated text are saved directly to the extension's local `IndexedDB` history (user's machine).
6. **Canvas Editing:** The user opens the extension Dashboard to edit the text boxes (change font, size, text content, position), and mark images as favorites.
7. **Export:** User exports the project as a flattened translated image or raw JSON/PSD coordinates.

## 2. Tech Stack
- **Frontend / Extension Page:** React.js (Vite) + Tailwind CSS, packaged inside a Manifest V3 Chrome Extension.
- **Backend (Cloud API Compute):** FastAPI (Python) or Express.js (RESTful API) strictly for cloud translation processing and Auth.
- **Local Database (Data & Images):** `IndexedDB` (using `Dexie.js` ORM) running inside the browser to store images as Blobs and translation history.
- **Cloud Database (Auth Only):** PostgreSQL (for managing premium user accounts/subscriptions).
- **Local AI Compute:** `WebLLM`, Google Translate, and `PaddleOCR` (ONNX Runtime Web) running in an Offscreen Document.
- **Image Editor/Canvas:** `react-konva` for handling the interactive canvas (moving text boxes, changing fonts).

## 3. Database System Design (Schema Draft)

### Local Database (IndexedDB / Dexie.js)
This schema lives entirely in the user's browser storage:
- **ProjectFolders:** `++id`, `title`, `timestamp`, `isFavorite` (Formerly Workspaces/Projects)
- **TranslationJobs:** `++id`, `folderId`, `rawImageBlob`, `translatedImageBlob`, `createdAt`, `updatedAt` (Formerly Images)
- **TextBlocks:** `++id`, `jobId`, `originalText`, `translatedText`, `posX`, `posY`, `width`, `height`, `fontSize`, `fontFamily`, `color`
- **Tags/Categories:** `++id`, `tagName`
- **ImageTags (Join):** `++id`, `jobId`, `tagId` 

*Crucial Architecture Constraint (Cascading Deletes):* Dexie.js is a NoSQL store and does not auto-delete children. To prevent massive local storage bloat, we must register a `db.folders.hook('deleting')` lifecycle event on initialization that manually force-deletes all orphaned TranslationJobs and TextBlocks whenever a folder is removed. 

### Cloud Database (PostgreSQL)
Only used for authentication and subscription management when the user opts for "Cloud Mode":
- **Users Table:** `id`, `email`, `password_hash`, `subscription_status`, `jwt_token_version`

## 4. Tackling Technical Unknowns (Deep Dive)

### A. How to run AI locally for Non-Tech Users (Zero Setup)
*The Problem:* We want users to translate locally without installing Python, Docker, or external keys.
*The Solution:* Kites uses WebLLM for users with capable WebGPU hardware. Google Translate is the default online option. The former Transformers.js / NLLB model path is archived and is not an active engine.

**Supported translation engines:**
1. **WebLLM (WebGPU):** Runs supported MLC models locally through WebGPU. Models are bundled in the static registry because they must match the installed WebLLM runtime.
2. **Google Translate:** Provides the online translation route and the default engine.

**The User Flow (Extension Dashboard & Setup):**
1. **Instant Access:** The default engine is Google Translate.
2. **Lazy-Loading:** Selecting a WebLLM model displays progress while its model weights download.
3. **VRAM/RAM Resident Singleton:** Once loaded, `TranslationManager` keeps the active engine in memory to avoid repeated WebGPU initialization.

#### VRAM/Memory Lifetime & Storage Matrix

| Model Category | Download Source | Disk Caching | Memory Residency | Runtime |
| :--- | :--- | :--- | :--- | :--- |
| **WebLLM** | MLC CDN (auto-resolved by ID) | WebLLM-managed browser cache | Kept in VRAM via `WebLLMEngine` | WebGPU only |
| **PaddleOCR** | Preset registry URLs | Cache API | Kept in RAM/VRAM via `PaddleOcrEngine` | WebGPU/WASM |
| **LaMa / AOT-GAN** | Preset registry URLs | Cache API | Kept in RAM/VRAM via `InpaintManager` | WebGPU/WASM |
| **Google Translate** | Google service | No local model cache | Stateless requests | Online API |

### B. The OCR & Detection Breakthrough (PaddleOCR ONNX)
*The Problem:* We need a robust tool that does TWO things: finds the exact X/Y coordinates of text (detection) AND reads it accurately (recognition) across multiple popular languages (not just Japanese manga), all while running locally in the browser without Python.
*The Breakthrough Solution (100% Browser Local):* We will use **PaddleOCR** compiled to **ONNX WebAssembly**. 
Instead of piecing together separate complex models, we will use a pre-packaged SDK like `client-ocr` or `ppu-paddle-ocr`. 
1.  **Multi-Language:** PaddleOCR supports over 80 languages out-of-the-box (English, Japanese, Korean, Chinese, etc.).
2.  **All-in-One:** It handles both finding the bounding boxes (DB model) and reading the text (CRNN model) in a single optimized pass.
3.  **Low Complexity:** By using an NPM wrapper around the ONNX models, we avoid writing custom WebGL/WebGPU tensor logic ourselves.
*Handling Rotated Text (Polygons):* PaddleOCR returns `dt_polys` (4-point polygons) rather than simple rectangles. Because manga text is often tilted, we will use a small geometry utility to calculate the rotation angle from the polygon and apply it to our HTML overlays via CSS `transform: rotate(Xdeg)`. This ensures text perfectly aligns with slanted speech bubbles.
*Result:* We get the exact relative positions AND highly accurate multi-language text, allowing us to perfectly overlay editable text boxes over the original image. It runs entirely in the user's browser, caching the model after the first download.

*Future Implementation (Manga-Specific OCR):* While PaddleOCR is excellent for general-purpose text, future updates will introduce an optional `MangaOcrEngine.ts`. This engine will use manga-finetuned DBNet and CTC ONNX models (e.g., from `Skepsun/manga-translator-ui-onnx`). Because these models share the same DBNet architecture, their raw probability heatmaps can be fed directly into our existing pure-JS `extractPolygons()` logic to yield identical 4-point polygons, perfectly satisfying our `IOcrEngine` interface without architectural rewrites.

### C. The Chrome Extension Architecture (Web Scraping & Capture)
*The Goal:* Provide frictionless translation with two distinct modes (Auto vs Manual) controlled via a setting, while gracefully handling DRM and long WebToon strips.

*1. Auto Translate Mode (The Queue System):*
When enabled, the extension automatically finds all normal `<img>` tags on the page and begins translating them without user interaction.
- **Concurrency Control:** To prevent crashing the browser on pages with many images, we implement a Promise-based concurrency queue. It processes a maximum of `N` images at a time (default `peak = 3`, adjustable in settings). As one image finishes, the next starts.
- **The Canvas Limitation:** Auto Mode *does not* run on protected `<canvas>` elements (like WebToons). Automatically firing `captureVisibleTab()` every time a user scrolls a pixel would rate-limit the browser and cause severe stuttering. For `<canvas>`, the extension gracefully degrades to Manual Mode.

*2. Extraction Methods (MVP vs Future):*
To keep the foundation clean (YAGNI), we will build the extraction UI in stages:
- **Method 1: Sticky Image Button (MVP FOCUS):** 
  - First option (Consistent Mode): A fast loop (via `MutationObserver`) scrapes normal `<img>` tags and injects a "Translate" button absolutely positioned at the top-left of the image. Clicking it sends the `srcUrl` to the Background Worker. This is the sole focus for Phase 1/2.   
  - Second option: we use the native Chrome Context Menu API (`chrome.contextMenus`). The user right-clicks any standard `<img>` and selects "Translate Image". The Background Worker natively receives the `srcUrl` and processes it.
  - Third option (Hover Mode): Instead of querying all images constantly, a global `mouseover` listener tracks the cursor. When hovering over an `<img>`, a single floating "Translate" button appears. Both Consistent and Hover modes utilize native Chrome CSS Anchor Positioning (`anchor-name`) to perfectly track scrolling without mutating the host page's Virtual DOM.
- **Advanced Extraction (Viewport Slicing for Canvas) - deferred:** Because WebToon `<canvas>` elements can be 20,000px tall, injecting a button at the top is useless. Instead, the user right-clicks anywhere on the canvas and selects "Translate Viewport". This triggers `chrome.tabs.captureVisibleTab()` to capture and translate *only* the slice of the canvas currently visible on their screen. The translated text overlay is locked to those exact absolute scroll coordinates.
- **Method 3: The Magic Lens Crop (Future):** A draggable, resizable dashed rectangle placed anywhere on the screen. Clicking "Translate" on the box captures that specific screen slice, translates it, and overlays the result directly inside the box (with an "X" to close). Future iteration: An auto-mode that seamlessly re-translates the box contents every 5 seconds.

*The Orchestrator Pattern (Fixing Memory Limits & DB Write Constraints):*
Content Scripts run on the host website and **cannot** write to the extension's local `IndexedDB`. Data flow must strictly be: Content Script -> Service Worker -> Offscreen Document -> DB. 
Crucially, the Background Service Worker acts *only* as a lightweight traffic cop. It handles the volatile lifecycle of the Offscreen Document (which Chrome kills when idle), queuing messages until the document boots. It fetches the image buffer and passes it directly to the **Offscreen Document**, which has full DOM access and high memory limits, to execute the heavy ONNX translation and save the results to the database. This guarantees Chrome will not kill the Service Worker.

```mermaid
sequenceDiagram
    participant CS as Content Script
    participant SW as Background Service Worker
    participant OD as Offscreen Document (DOM Context & IndexedDB)

    CS->>SW: chrome.runtime.sendMessage({ action: "TRANSLATE_IMAGE", data: imageData })
    Note over SW: Queues message & ensures<br/>Offscreen Document is active
    SW->>OD: chrome.runtime.sendMessage({ action: "EXECUTE_TRANSLATION", data: imageData })
    Note over OD: Performs heavy OCR, Inpainting & Translation<br/>Writes project/image results to IndexedDB
    OD->>SW: chrome.runtime.sendMessage({ action: "TRANSLATION_RESULT", results: boundingBoxes })
    SW->>CS: Relay translation results / Base64 image
```


*Model Syncing (Website vs Extension & The Communication Bottleneck):*
Due to browser security, `your-website.com` and `chrome-extension://...` cannot share the same `IndexedDB` file. To solve this without hitting the **Web-to-Extension Communication Bottleneck** (passing heavy Base64 image blobs via `postMessage` crashes memory and breaks on navigation): 
1. The website will pass only the **Image URL** or use **Transferable Objects (`ArrayBuffer`)** via `window.postMessage` to the extension. Transferable objects are zero-copy and do not duplicate memory.
2. The Extension handles the heavy processing in the Offscreen Document independently of the webpage's lifecycle, returning only lightweight JSON back to the website.

### D. Editable Export (Photoshop/PSD)
*The Solution:* To allow users to download their edits, we will export a `.json` "Project File" containing the base image URL and an array of text objects (X, Y, Text). We can also include a script using `ag-psd` to compile this into a `.psd` file for Photoshop users.

### E. The "Out of Bounds" Translation Problem (Auto-Scaling Font Size)
*The Problem:* As you noted by looking at the PP-OCRv6 JSON, the OCR only gives us the bounding box coordinates (`rec_boxes` / `dt_polys`) of the *original* Japanese text. English translations are usually much longer and will overflow the original box. The OCR does not tell us what font size to use for the new text.
*The Solution (The Dual-Architecture Typesetting Engine & 1:1 Cotrans Math Alignment):* 
Because our architecture serves two different contexts—Live Web Translation vs. the Interactive Dashboard—we must use a dual-render approach to solve the problem of CSS layout interference (z-index clipping, sticky headers):
1. **For the Live Web (Content Script):** We do **not** use HTML DOM Overlays because floating text nodes over the page will clip on top of sticky website navigation bars (e.g., Facebook, Twitter) and break CSS flexbox layouts. Instead, we use Canvas `context.measureText()` and `fillText()` inside the Offscreen Document to burn the English text directly into the inpainted image pixels. We then replace the website's original `<img>` `src` with the new Base64 image. This guarantees **0% chance of breaking host website layouts** while obeying all native scroll and z-index bounds.
2. **For the Canvas Dashboard (React-Konva/DOM):** When a user opens their Dashboard to manually edit an image, they do not want baked-in pixels. The Database saves both the *clean inpainted image* and the *raw JSON text blocks*. The Dashboard uses React-Konva or DOM overlays so the user can interactively click, resize, and rewrite the text boxes over the clean image.
3. **Centering, Rotation & 1:1 Cotrans Math Alignment:**
   - **No Word Hyphenation (`merge_seg_eng`):** Words are never sliced across lines with hyphens (e.g. `hat-ful`). English sentences are split into whole words using `segEng`.
   - **Dynamic Width Expansion:** Matching Cotrans `text_render_pillow_eng.py`, target width expands for Western text: `targetWidth = Math.max(width * 0.85, maxWordWidth * 1.15)`, allowing English sentences to render cleanly without being squished into 8px single-word vertical columns.
   - **Kruskal MST Region Splitting:** Speech bubble merging uses Cotrans 1:1 Kruskal Minimum Spanning Tree splitting (`splitTextRegion` with `gamma = 0.5`, `sigma = 2.0`, and `getCotransDistance` top/bottom alignment distance), preventing separate adjacent speech bubbles from over-merging into double bubbles.
   - **PaddleOCR Tensor Padding Unscaling:** `extractPolygons.ts` and `extractRawMaskCanvas` unscale probability maps using exact PaddleOCR `1 / resizeRatio`, cropping out 32px tensor padding to ensure text bounding boxes and overlays align 1:1 with source pixels.
   - **XianScan-Style Hybrid Typeset Engine (`typesetLayout.ts`):** Implements 6-stage morphological hyphenation (`findHyphenationPoints`) with stem protection (length >= 7), balanced diamond line envelope wrapping (`balancedWrapText`), 4-pass binary search font fitting with tall-narrow aspect ratio floor (`fitFontSizeWithLines`), logical paragraph detection, and box decollision (`decollideBoxes`).
   - **1:1 Cotrans Default Affine-Warp Renderer (`cotransDefaultRenderer.ts`):** Matches the reference Cotrans Touhou renderer: expands detection regions via `resizeRegionToFontSize` (using the 2023 grid shrink model), computes wrapped lines via `calcHorizontal`, renders lines onto an intermediate canvas (`putTextLines`), and affine-warps the text canvas directly onto the destination quad.
*Result:* The text will perfectly wrap and scale to fit inside speech bubbles. The live web remains 100% stable without DOM clipping bugs, and the Dashboard remains fully editable.

### F. Removing the Original Text Cleanly (Inpainting)

*The Problem:* Before we can overlay the translated English text, we must cleanly erase the original text from the image so it doesn't bleed through. We need a solution that works for any image (manga, photos, diagrams) and runs fast locally. We must also prevent erasing speech bubble outlines, panel borders, and background line drawings.

*The Solution (6-Tier Extensible Architecture & Stroke Masking):*
To solve this, we implement a **6-Tier Hybrid Inpainting Pipeline** wrapped in a Strategy Pattern (`IInpaintEngine`), which selects the active eraser mode based on settings.

> [!NOTE]
> **Architectural Note (Deliberate Exception to Cotrans Alignment):**
> Inpainting is the **explicit architectural exception** where Kites does NOT strictly follow Cotrans Python. While Cotrans hardcodes a single heavy Python inpainting model, Kites provides a flexible 6-Tier hybrid engine where **Tier 1 (Direct 4-Point Polygon Patching & Dominant Edge Color Fill)** is used by default for 0MB download footprint and instant microsecond execution. Users can optionally select Tier 2 (Telea Math) or Tiers 3–4 (AOT-GAN / LaMa ONNX) depending on their device capabilities, balancing speed vs visual hallucination quality.

```mermaid
graph TD
    ImageBuffer[Raw Image Buffer] --> InpaintManager
    Polygons[Text Polygons] --> InpaintManager
    
    InpaintManager --> EngineRouter{Engine Selector}
    
    EngineRouter -- Tier 1: Simple Fill --> SimpleEngine[SimpleInpaintEngine: Sample Edge & Fill Bbox]
    EngineRouter -- Tier 2: Telea Math --> TeleaEngine[TeleaInpaintEngine: FMM Diffusion]
    EngineRouter -- Tier 3: AOT-GAN --> AotEngine[AotInpaintEngine: Quantized ONNX Model]
    EngineRouter -- Tier 4: LaMa AI --> LamaEngine[LamaInpaintEngine: Fourier CNN ONNX Model]
    EngineRouter -- Tier 5: None --> NoneEngine[NoneInpaintEngine: Bypass Erase]
    EngineRouter -- Tier 6: Original --> OriginalEngine[OriginalInpaintEngine: Bypass All]
    
    InpaintManager --> Binarizer[Binarizer: Extract Text Stroke Mask]
    Binarizer -.-> StrokeMask[Stroke-Level Mask Canvas]
    
    ImageBuffer --> SimpleEngine
    
    ImageBuffer --> TeleaEngine
    StrokeMask -.-> TeleaEngine
    
    ImageBuffer --> AotEngine
    StrokeMask -.-> AotEngine
    
    ImageBuffer --> LamaEngine
    StrokeMask -.-> LamaEngine
    
    ImageBuffer --> NoneEngine
    ImageBuffer --> OriginalEngine
    
    SimpleEngine --> CleanBuffer[Clean Text-Free Image]
    TeleaEngine --> CleanBuffer
    AotEngine --> CleanBuffer
    LamaEngine --> CleanBuffer
    NoneEngine --> CleanBuffer
    OriginalEngine --> CleanBuffer
```

#### The Binarizer (Handling the Border-Erase Problem)
Instead of masking the entire blocky bounding box, we extract a **pixel-perfect mask of the exact text strokes**.
* **Grayscale + Otsu's Adaptive Thresholding:** Runs on each cropped text box canvas to separate high-contrast text strokes from the bubble background.
#### The 6 Inpainting Tiers:
1. **Tier 1: Simple Inpaint (Dominant Color Fill):** Samples pixel colors along the bounding box outer edges, determines the dominant color, and fills the bounding rectangle. Runs in microseconds (`0MB`).
2. **Tier 2: Telea Math Inpaint (FMM Diffusion):** Applies Alexandru Telea's Fast Marching Method FMM algorithm on the stroke mask, propagating surrounding background colors inward to erase characters. Extremely fast (`0MB`), preserves outlines.
3. **Tier 3: AOT-GAN Inpaint (Quantized ONNX):** Runs a lightweight generative adversarial network inpainting model. Learns manga textures and screentones to reconstruct backgrounds behind erased text. Fast (`~10MB`), runs via WebGPU when available.
4. **Tier 4: LaMa Inpaint (Fourier CNN ONNX):** Runs the Large Mask Inpainting model using Fast Fourier Convolutions to hallucinate large or complex textures globally. Highly robust, larger download (`~30MB`).
5. **Tier 5: None:** Bypasses inpainting entirely. Returns the original image. The OCR and translation pipeline will still overlay translated text on top of the original text.
6. **Tier 6: Original:** Bypasses the entire translation/inpainting pipeline and just returns a raw copy of the original image without any modifications.

#### Custom Inpainting Model Registry & URL Management
Because adding a completely new inpainting model architecture requires specific custom pre-processing and post-processing code (e.g. AOT-GAN's input tensor shape differs from LaMa's), we do not need a remote dynamic registry for inpainting. Instead, we manage custom model options via an internal local TypeScript registry file (`inpaintRegistry.ts`). This local registry maps model configurations to their remote download links (hosted on Hugging Face).
* **CI/CD Link Validation:** To ensure download URLs do not become broken or stale, we include a GitHub Action pipeline. Whenever the local registry file is modified, the action runs a validation script that fires HEAD requests to all configured Hugging Face URLs to ensure they return a valid HTTP `200 OK` response.

### G. Two-Part Frontend UX (Tampermonkey Style)
*The Problem:* How do we provide quick access to settings while also giving the user a robust, full-screen canvas editor?
*The Solution (Local-First Design):* We structure the frontend into two distinct React interfaces, mirroring extensions like Tampermonkey:
1. **The Popup Window (Quick Actions):** A small window that opens when clicking the extension icon. It handles quick operational toggles (`Auto-Translate` vs `Manual Selection Method (Hover/Persistent)`), Translation Engine selection (Local/API/Custom), and Max Concurrent Translations.
2. **The Standalone Dashboard (Full UI):** A full-screen React app hosted on an extension tab (`chrome-extension://.../index.html`). This is the "Main Brain" UI where the user accesses the interactive Canvas Editor, Recent History, Favorites, and can manually upload screenshots taken with their OS snipping tool for protected sites. All images and history are saved into the extension's local `IndexedDB`.
3. **Swappable Engine Router & Waterfall Execution:** We implement a compute Strategy Pattern. When the user initiates a translation, the Background Worker routes the task to the Offscreen Document. The Offscreen Document's `TranslationManager` reads the active engine selection and fallback waterfall chain (`[activeEngineId, ...fallbackChain]`) directly from `chrome.storage.local`. It then executes the fallback loop entirely inside the Offscreen Document, trying each engine in order. If one fails, it unloads it and dynamically spins up the next engine. This eliminates message-passing roundtrips to the UI and guarantees translation persistence even if the user closes the popup.
*Result:* This provides the absolute best UX. The user gets a completely private, full-featured app via the extension, with quick access via the popup and deep editing via the dashboard tab.

## 5. Implementation Phases
- **Phase 1 (Extension Core):** Basic Extension Setup (Manifest V3, Content Script, Popup) & Dexie.js Local DB integration for storing images/projects locally. [Completed]
- **Phase 2 (Canvas Editor & Studio Dashboard):** Dexie-backed Studio Dashboard (`src/App.tsx`) with left history sidebar, full pan/zoom interactive viewport, original/cleaned/final view modes, live inline text editing, local disk import, and baked PNG export. [Completed]
- **Phase 3 (Local AI Engine):** Offscreen document running PaddleOCR ONNX (V6 detection & recognition), WebGPU/WASM acceleration, and local inpainting engines (Simple Fill, Telea Math, AOT-GAN, LaMa Manga). [Completed]
- **Phase 4 (Cloud & Translation Providers):** Custom OpenAI-compatible / Gemini / DeepSeek / Claude translation endpoints, plus a zero-cost Cloudflare Worker translation backend (`worker/`) featuring Google OAuth ID token verification (RS256 with cached JWKS), Durable Object SQLite single-write rate limiting (100 translations/24hr window), adaptive latency circuit breakers, and multi-provider waterfall routing. [Completed]
- **Phase 5 (Algorithmic Typesetting & Merge Improvements):** 
  - *V2 Algorithmic Pipeline*: Upgraded `OcrManager` with Cotrans-aligned majority direction voting (`majorityDirection`), orphan punctuation recovery, Furigana Kana filtering, duplicate vertical column deduping, and Kruskal MST region splitting.
  - *Hybrid Typesetting*: Implementation of 1:1 Cotrans DEFAULT affine-warp renderer (`cotransDefaultRenderer.ts`) and XianScan-style hybrid typeset layout engine (`typesetLayout.ts`) with morphological hyphenation, balanced diamond line envelope wrapping, 4-pass binary search fitting, and speech bubble decollision (`decollideBoxes`). [Completed]
- **Phase 6 (Future Improvements):** 
  - *OCR Migration*: Migrate from PaddleOCR DBNet to `ComicTextDetector` (YOLOv5 ONNX ~90MB) on WebGPU to generate non-spiky, tight bounding boxes and allow direct 1:1 typesetting without heuristic expansion.
## 3. Important References & Tool Links

The following tools and libraries are critical references for the development of this project:

### AI Core & Models
*   **[Transformers.js](https://huggingface.co/docs/transformers.js)**: Library for running Hugging Face models natively in the browser via ONNX Runtime Web.
*   **[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)**: State-of-the-art multi-lingual OCR toolkit used for single-pass local detection and recognition.

### Spatial Rendering & Translation References
*   **[manga-image-translator](https://github.com/zyddnys/manga-image-translator)**: The reference Python repository for high-quality manga translation pipelines, containing text inpainting and text typesetting logic (Pillow `textbbox` implementation).
*   **[Manga Translator Chrome Extension](https://chromewebstore.google.com/detail/manga-translator%F0%9F%8D%93/lepcfgkehgeiblekejomdmdklmjdmflp)**: The primary UX reference for on-page scraper overlays and image translation.
*   **[LaMa (Large Mask Inpainting)](https://github.com/advimman/lama)**: The reference repository for high-quality image inpainting used for text removal.
### Extension & Web APIs
*   **[Chrome Offscreen Documents API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)**: Documentation on managing invisible documents for image/tensor processing in Manifest V3 background scripts.


===========================================================================
                      KITES IMAGE PROCESSING PIPELINE
===========================================================================

[1. RAW IMAGE UPLOAD] 
         │
         ▼
[2. OCR TEXT DETECTION (PaddleOCR / ONNX)]
    │  - Scans image for text.
    │  - Outputs raw individual text polygons & Japanese characters.
    │
    ▼
[3. GEOMETRIC COMBINER & CONVEX HULL (src/shared/utils/geometry.ts & OcrManager)]
    │  - Evaluates distance & overlap between all raw polygons.
    │  - Merges text boxes that are geometrically close.
    │  - [CONVEX HULL]: Calculates a single, unified bounding polygon (hull) wrapping around the merged group coordinates (GEOMETRY).
    │
    ├─────────────────────────────────────────────────┐
    │                                                 │
    ▼                                                 ▼
[4A. INPAINTING PIPELINE]                     [4B. TRANSLATION PIPELINE]
    │                                                 │
    ▼                                                 ▼
 [Binarizer (Otsu Pixel Thresholding)]        [Translation Engine]
    │  - Takes the geometrically COMBINED polygons.   │ - Takes combined Japanese text.
    │  - [BINARIZER]: Scans individual PIXEL colors   │ - Translates to English.
    │    inside those combined boundaries to separate │
    │    dark text ink from light background paper.   │
    │  - Outputs a "Stroke Mask".                     │
    │                                                 │
    ▼                                                 ▼
 [Inpaint Engine (Simple / LaMa)]             (Translated English Text)
    │  - Erases ONLY the text ink using the mask.     │
    │  - Fills empty space with background color.     │
    │                                                 │
    ▼                                                 │
(Cleaned, Text-Free Image)                            │
    │                                                 │
    └──────────────────────┬──────────────────────────┘
                           │
                           ▼
[5. TEXT RENDERER]
    │  - Takes the Cleaned Image.
    │  - Takes the Translated English Text.
    │  - Draws the English text perfectly inside the erased bubbles.
    │
    ▼
[6. FINAL TRANSLATED IMAGE DELIVERED TO USER]
