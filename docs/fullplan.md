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

### Cloud Database (PostgreSQL)
Only used for authentication and subscription management when the user opts for "Cloud Mode":
- **Users Table:** `id`, `email`, `password_hash`, `subscription_status`, `jwt_token_version`

## 4. Tackling Technical Unknowns (Deep Dive)

### A. How to run AI locally for Non-Tech Users (Zero Setup)
*The Problem:* We want users to translate locally without installing Python, Docker, or external keys.
*The Solution:* We use WebAssembly (Wasm) and WebGPU to run compressed ONNX and specialized models directly in JavaScript.
*   **ONNX (Open Neural Network Exchange):** Models (like MarianMT and PaddleOCR) are converted to `.onnx` files, which are highly optimized binary neural networks (usually 20MB - 100MB).
*   **Transformers.js (ONNX Runtime Web + Wasm):** Hugging Face's JS library downloads the `.onnx` files via standard `fetch` from their CDN, caches them permanently in the browser's native **Cache Storage API**, and executes them locally at near-native speed using WebAssembly (Wasm).
*   **WebLLM (WebGPU):** For large context-aware translation LLMs (like Llama-3 or Gemma), WebLLM binds directly to the user's GPU hardware via the WebGPU API. Because these models are larger (1GB - 4GB), this is an optional feature for users with stronger PCs.
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
*Result:* We get the exact relative positions AND highly accurate multi-language text, allowing us to perfectly overlay editable text boxes over the original image. It runs entirely in the user's browser, caching the model after the first download.

### C. The Chrome Extension Architecture (Web Scraping)
*The Problem:* How does the extension universally translate images on any website, and how does it share the downloaded model with the web app?
*The Extension Logic:*
1. **Content Script:** Injects a "Translate" button on the top-left of every `<img>` tag it finds on a webpage.
2. **Background Worker (Service Worker):** This is where **Transformers.js** lives. When a user clicks the button, the image URL is sent to the background worker. The worker downloads the image, runs the OCR and Translation locally in the browser, and returns the bounding boxes.
3. **Overlay Rendering:** The Content Script receives the data and injects `<div>` elements with `position: absolute` precisely over the original image's speech bubbles, containing the translated text.
*Model Syncing (Website vs Extension):*
Due to browser security, `your-website.com` and `chrome-extension://...` cannot share the same `IndexedDB` file. To solve this: The website will detect if the Extension is installed. If installed, the website will pass translation requests to the extension via `window.postMessage`, allowing the extension's downloaded model to do the work. If not installed, the website will prompt the user to download the model into the website's cache.

### D. Editable Export (Photoshop/PSD)
*The Solution:* To allow users to download their edits, we will export a `.json` "Project File" containing the base image URL and an array of text objects (X, Y, Text). We can also include a script using `ag-psd` to compile this into a `.psd` file for Photoshop users.

### E. The "Out of Bounds" Translation Problem (Auto-Scaling Font Size)
*The Problem:* As you noted by looking at the PP-OCRv6 JSON, the OCR only gives us the bounding box coordinates (`rec_boxes` / `dt_polys`) of the *original* Japanese text. English translations are usually much longer and will overflow the original box. The OCR does not tell us what font size to use for the new text.
*The Solution (The Manga-Translator Logic):* We will implement a **Text Auto-Scaling & Wrapping Algorithm** in JavaScript (using our React-Konva canvas). 
1. **Word Wrapping:** We take the translated English string and the original bounding box `width`. We use canvas measurement tools to break the string into multiple lines so it doesn't overflow horizontally.
2. **Binary Search for Font Size:** We start with a large `font-size`. We measure the total height of the wrapped text. If the total height exceeds the original bounding box `height`, we recursively shrink the font size (using a binary search algorithm) until the text fits perfectly inside the box without overflowing.
3. **Centering:** We center the text horizontally and vertically within the bounding box.
*Result:* Exactly like the Python `manga-image-translator`, the text will automatically shrink and wrap to fit perfectly inside the speech bubble. Because it is a React component, the user can also manually tweak the font size via a UI slider if they don't like the automatic calculation.

### F. Two-Part Frontend UX (Tampermonkey Style)
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
