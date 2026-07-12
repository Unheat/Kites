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
- **Local AI Compute:** `Transformers.js` and `PaddleOCR` (ONNX Runtime Web) running in an Offscreen Document.
- **Image Editor/Canvas:** `react-konva` for handling the interactive canvas (moving text boxes, changing fonts).

## 3. Database System Design (Schema Draft)

### Local Database (IndexedDB / Dexie.js)
This schema lives entirely in the user's browser storage:
- **Workspaces/Projects:** `++id`, `title`, `timestamp`, `isFavorite`
- **Images:** `++id`, `projectId`, `rawImageBlob`, `translatedImageBlob` (We store raw blobs instead of Cloudinary URLs)
- **TextBlocks:** `++id`, `imageId`, `originalText`, `translatedText`, `posX`, `posY`, `width`, `height`, `fontSize`, `fontFamily`, `color`
- **Tags/Categories:** `++id`, `tagName`
- **ImageTags (Join):** `++id`, `imageId`, `tagId` 

*Crucial Architecture Constraint (Cascading Deletes):* Dexie.js is a NoSQL store and does not auto-delete children. To prevent massive local storage bloat, we must register a `db.projects.hook('deleting')` lifecycle event on initialization that manually force-deletes all orphaned Image Blobs and TextBlocks whenever a project is removed. 

### Cloud Database (PostgreSQL)
Only used for authentication and subscription management when the user opts for "Cloud Mode":
- **Users Table:** `id`, `email`, `password_hash`, `subscription_status`, `jwt_token_version`

## 4. Tackling Technical Unknowns (Deep Dive)

### A. How to run AI locally for Non-Tech Users (Zero Setup)
*The Problem:* We want users to translate locally without installing Python, Docker, or external keys.
*The Solution:* We use WebAssembly (Wasm) and WebGPU to run compressed ONNX models directly in JavaScript.
*   **Transformers.js (ONNX Runtime Web):** Hugging Face's JS library downloads `.onnx` models, caches them permanently in the browser's **Cache Storage API**, and executes them locally.
*   *Mentor Correction (Avoiding Heavy LLMs):* Previously, the plan suggested using WebLLM with Llama-3 for translation. This is an anti-pattern. An 8B parameter LLM requires 4GB+ of VRAM, takes minutes to download, and is slow to generate. Instead, we will use purpose-built translation models like **NLLB-200 (No Language Left Behind)** or **MarianMT**. These models are explicitly trained for translation, are extremely lightweight (~50-150MB), and run instantly in the browser. 

**The User Flow (Extension Dashboard):**
1. User opens the extension Dashboard and toggles "Local Mode".
2. The UI displays a progress bar as Transformers.js downloads the `.onnx` files from Hugging Face.
3. The weights are cached permanently in Chrome's local cache. On all future translations, the model loads in 0.1 seconds from disk.
4. When translating, the Offscreen Document processes the image locally. Zero API keys, zero server costs.

### B. The OCR & Detection Breakthrough (PaddleOCR ONNX)
*The Problem:* We need a robust tool that does TWO things: finds the exact X/Y coordinates of text (detection) AND reads it accurately (recognition) across multiple popular languages (not just Japanese manga), all while running locally in the browser without Python.
*The Breakthrough Solution (100% Browser Local):* We will use **PaddleOCR** compiled to **ONNX WebAssembly**. 
Instead of piecing together separate complex models, we will use a pre-packaged SDK like `client-ocr` or `ppu-paddle-ocr`. 
1.  **Multi-Language:** PaddleOCR supports over 80 languages out-of-the-box (English, Japanese, Korean, Chinese, etc.).
2.  **All-in-One:** It handles both finding the bounding boxes (DB model) and reading the text (CRNN model) in a single optimized pass.
3.  **Low Complexity:** By using an NPM wrapper around the ONNX models, we avoid writing custom WebGL/WebGPU tensor logic ourselves.
*Handling Rotated Text (Polygons):* PaddleOCR returns `dt_polys` (4-point polygons) rather than simple rectangles. Because manga text is often tilted, we will use a small geometry utility to calculate the rotation angle from the polygon and apply it to our HTML overlays via CSS `transform: rotate(Xdeg)`. This ensures text perfectly aligns with slanted speech bubbles.
*Result:* We get the exact relative positions AND highly accurate multi-language text, allowing us to perfectly overlay editable text boxes over the original image. It runs entirely in the user's browser, caching the model after the first download.

### C. The Chrome Extension Architecture (Web Scraping & Capture)
*The Goal:* Provide frictionless translation with two distinct modes (Auto vs Manual) controlled via a setting, while gracefully handling DRM and long WebToon strips.

*1. Auto Translate Mode (The Queue System):*
When enabled, the extension automatically finds all normal `<img>` tags on the page and begins translating them without user interaction.
- **Concurrency Control:** To prevent crashing the browser on pages with many images, we implement a Promise-based concurrency queue. It processes a maximum of `N` images at a time (default `peak = 3`, adjustable in settings). As one image finishes, the next starts.
- **The Canvas Limitation:** Auto Mode *does not* run on protected `<canvas>` elements (like WebToons). Automatically firing `captureVisibleTab()` every time a user scrolls a pixel would rate-limit the browser and cause severe stuttering. For `<canvas>`, the extension gracefully degrades to Manual Mode.

*2. Extraction Methods (MVP vs Future):*
To keep the foundation clean (YAGNI), we will build the extraction UI in stages:
- **Method 1: Sticky Image Button (MVP FOCUS):** 
  - First option: A fast loop scrapes normal `<img>` tags and injects a "Translate" button absolutely positioned at the top-left of the image. Clicking it sends the `srcUrl` to the Background Worker. This is the sole focus for Phase 1/2.   
  - Second option: we use the native Chrome Context Menu API (`chrome.contextMenus`). The user right-clicks any standard `<img>` and selects "Translate Image". The Background Worker natively receives the `srcUrl` and processes it 
- **Advanced Extraction (Viewport Slicing for Canvas) - deferred:** Because WebToon `<canvas>` elements can be 20,000px tall, injecting a button at the top is useless. Instead, the user right-clicks anywhere on the canvas and selects "Translate Viewport". This triggers `chrome.tabs.captureVisibleTab()` to capture and translate *only* the slice of the canvas currently visible on their screen. The translated text overlay is locked to those exact absolute scroll coordinates.
- **Method 3: The Magic Lens Crop (Future):** A draggable, resizable dashed rectangle placed anywhere on the screen. Clicking "Translate" on the box captures that specific screen slice, translates it, and overlays the result directly inside the box (with an "X" to close). Future iteration: An auto-mode that seamlessly re-translates the box contents every 5 seconds.

*The Orchestrator Pattern (Fixing Memory Limits & DB Write Constraints):*
Content Scripts run on the host website and **cannot** write to the extension's local `IndexedDB`. Data flow must strictly be: Content Script -> Service Worker -> Offscreen Document -> DB. 
Crucially, the Background Service Worker acts *only* as a lightweight traffic cop. It handles the volatile lifecycle of the Offscreen Document (which Chrome kills when idle), queuing messages until the document boots. It fetches the image buffer and passes it directly to the **Offscreen Document**, which has full DOM access and high memory limits, to execute the heavy ONNX translation and save the results to the database. This guarantees Chrome will not kill the Service Worker.

*Model Syncing (Website vs Extension & The Communication Bottleneck):*
Due to browser security, `your-website.com` and `chrome-extension://...` cannot share the same `IndexedDB` file. To solve this without hitting the **Web-to-Extension Communication Bottleneck** (passing heavy Base64 image blobs via `postMessage` crashes memory and breaks on navigation): 
1. The website will pass only the **Image URL** or use **Transferable Objects (`ArrayBuffer`)** via `window.postMessage` to the extension. Transferable objects are zero-copy and do not duplicate memory.
2. The Extension handles the heavy processing in the Offscreen Document independently of the webpage's lifecycle, returning only lightweight JSON back to the website.

### D. Editable Export (Photoshop/PSD)
*The Solution:* To allow users to download their edits, we will export a `.json` "Project File" containing the base image URL and an array of text objects (X, Y, Text). We can also include a script using `ag-psd` to compile this into a `.psd` file for Photoshop users.

### E. The "Out of Bounds" Translation Problem (Auto-Scaling Font Size)
*The Problem:* As you noted by looking at the PP-OCRv6 JSON, the OCR only gives us the bounding box coordinates (`rec_boxes` / `dt_polys`) of the *original* Japanese text. English translations are usually much longer and will overflow the original box. The OCR does not tell us what font size to use for the new text.
*The Solution (The Manga-Translator Logic & Resolving the DOM/Canvas Contradiction):* 
Because our architecture uses both HTML DOM Overlays (for on-page translation) and a React-Konva Canvas (for the dashboard editor), we must use two different scaling mathematical approaches to prevent text overflow mismatches:
1. **For the Canvas Dashboard (React-Konva):** We use Canvas `context.measureText()` to wrap words and perform a binary search, shrinking the `font-size` until the total wrapped height fits perfectly inside the bounding box.
2. **For the Content Script (HTML Overlays):** We cannot use Canvas `measureText()` because it lacks CSS engine nuance (line-height, browser-specific font rendering). Instead, we create an invisible, off-screen `<div>` with the exact width constraints of the bounding box. We inject the text, check `div.scrollHeight`, and recursively shrink the font size using a binary search until it matches the target height. This guarantees 1:1 CSS rendering accuracy.
3. **Centering:** We center the text horizontally and vertically within the bounding box.
*Result:* Exactly like the Python `manga-image-translator`, the text will automatically shrink and wrap to fit perfectly inside the speech bubble. Because it is a React component, the user can also manually tweak the font size via a UI slider if they don't like the automatic calculation.

### F. Removing the Original Text Cleanly (Inpainting)
*The Problem:* Before we can overlay the translated English text, we must cleanly erase the original text from the image so it doesn't bleed through. We need a solution that works for *any* image (manga, photos, diagrams) and runs fast locally.

*The Solution (Advanced AI Inpainting):* 
We will use **Fast-LaMa (F-LaMa)** converted to an ONNX model, running via Transformers.js (WebAssembly/WebGPU). 
* **Why LaMa?** LaMa (Resolution-robust Large Mask Inpainting) is the absolute industry standard for fast, high-quality inpainting (used by web tools like cleanup.pictures). It uses Fast Fourier Convolutions, which gives it a global understanding of the image. This means it doesn't just blur the edges; it can accurately hallucinate missing manga screentones, photo backgrounds, and complex textures in real-time.
* **Performance:** By using a quantized ONNX version of F-LaMa, the model size is kept very small (~30-50MB). It executes inference in milliseconds, providing a seamless, native feel without needing a remote server.
* **Fallback:** For ultra-low-end devices, we will keep a simple **Solid Color Fill** (sampling the edge colors of the bounding box) as an instant, zero-compute fallback.

### G. Two-Part Frontend UX (Tampermonkey Style)
*The Problem:* How do we provide quick access to settings while also giving the user a robust, full-screen canvas editor?
*The Solution (Local-First Design):* We structure the frontend into two distinct React interfaces, mirroring extensions like Tampermonkey:
1. **The Popup Window (Quick Actions):** A small window that opens when clicking the extension icon in the toolbar. It contains quick toggles (Enable/Disable translation, Local/Cloud mode) and a primary button to "Open Dashboard" or "Manual Upload".
2. **The Standalone Dashboard (Full UI):** A full-screen React app hosted on an extension tab (`chrome-extension://.../index.html`). This is the "Main Brain" UI where the user accesses the interactive Canvas Editor, Recent History, Favorites, and can manually upload screenshots taken with their OS snipping tool for protected sites. All images and history are saved into the extension's local `IndexedDB`.
3. **Swappable Engine Router:** We implement a Strategy Pattern for compute. When a user translates an image, the UI calls a generic `translationService.translate()`. If set to Local, it runs Wasm via an Offscreen Document. If set to Cloud, it sends the image to our Remote API with a JWT Auth Token.
*Result:* This provides the absolute best UX. The user gets a completely private, full-featured app via the extension, with quick access via the popup and deep editing via the dashboard tab.

## 5. Implementation Phases
- **Phase 1 (Extension Core):** Basic Extension Setup (Manifest V3, Content Script, Popup) & Dexie.js Local DB integration for storing images/projects locally.
- **Phase 2 (Canvas Editor):** React-Konva Canvas Dashboard implementation (draggable text boxes, editable text, rendering from IndexedDB).
- **Phase 3 (Local AI Engine):** Offscreen document running PaddleOCR ONNX / MarianMT with Hugging Face CDN download progress bars.
- **Phase 4 (Cloud Premium Compute):** Server-Hosted Compute API with JWT authentication middleware + Web App Stripe checkout, communicating Auth tokens back to the extension.
## 3. Important References & Tool Links

The following tools and libraries are critical references for the development of this project:

### AI Core & Models
*   **[Transformers.js](https://huggingface.co/docs/transformers.js)**: Library for running Hugging Face models natively in the browser via ONNX Runtime Web.
*   **[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)**: State-of-the-art multi-lingual OCR toolkit used for single-pass local detection and recognition.

### Spatial Rendering & Translation References
*   **[manga-image-translator](https://github.com/zyddnys/manga-image-translator)**: The reference Python repository for high-quality manga translation pipelines, containing text inpainting and text typesetting logic (Pillow `textbbox` implementation).
*   **[Manga Translator Chrome Extension](https://chromewebstore.google.com/detail/manga-translator%F0%9F%8D%93/lepcfgkehgeiblekejomdmdklmjdmflp)**: The primary UX reference for on-page scraper overlays and image translation.

### Extension & Web APIs
*   **[Chrome Offscreen Documents API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)**: Documentation on managing invisible documents for image/tensor processing in Manifest V3 background scripts.
