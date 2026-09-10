<div align="center">

# 🪁 Kites

### Spatial In-Browser Manga & Comic Translator
**100% Client-Side WebGPU Neural Pipeline • Zero Python • Zero Cloud Lock-in • Studio-Grade Typesetting**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-success.svg?style=flat-square&logo=googlechrome&logoColor=white)](manifest.json)
[![WebGPU](https://img.shields.io/badge/Hardware-WebGPU%20%2F%20WASM-orange.svg?style=flat-square&logo=webgpu&logoColor=white)](#processing-engines)
[![ONNX Runtime Web](https://img.shields.io/badge/Runtime-ONNX%20Web-blueviolet.svg?style=flat-square)](https://onnxruntime.ai/)
[![Vite](https://img.shields.io/badge/Build-Vite%208%20%2B%20React%2019-646CFF.svg?style=flat-square&logo=vite&logoColor=white)](package.json)
[![Cloudflare Workers](https://img.shields.io/badge/Backend-Cloudflare%20Workers-F38020.svg?style=flat-square&logo=cloudflare&logoColor=white)](worker/)

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-showcase">Showcase</a> •
  <a href="#-kites-studio">Studio Editor</a> •
  <a href="#-extension-modes">Extension UI</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-processing-engines">Engine Matrix</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-license--attribution">Attribution</a>
</p>

[![Kites Hero Banner](./README_images/Gemini_Generated_Image_f7lh52f7lh52f7lh.jpeg)](./README_images/Gemini_Generated_Image_f7lh52f7lh52f7lh.jpeg)

</div>

---

## 📖 Overview

**Kites** is a modern, high-performance browser extension (Manifest V3) that translates raw manga, manhwa, manhua, and web comics **directly inside your web browser**.

Unlike legacy tools that demand hefty Python environments, local CUDA setups, or upload your reading data to opaque remote servers, Kites executes neural OCR, text grouping, speech-bubble inpainting, and typesetting **locally on your device** via **WebGPU** and **ONNX Runtime Web**.

Need extra translation horsepower? Switch seamlessly to **WebLLM** for private on-device LLMs, configure your own API keys (OpenAI, Gemini, Anthropic, DeepSeek), or leverage the zero-cost **Kites Cloud Shared Pool** powered by Cloudflare Workers.

---

## ✨ Features

- **⚡ Zero-Install Browser Neural Engine:** Runs PaddleOCR (DBNet + PP-OCR) and neural inpainters (LaMa Manga / AOT-GAN) client-side using hardware-accelerated WebGPU with WASM fallback.
- **📐 Spatial Text Reconstruction:** Rotated polygon detection (`dt_polys`) with geometric noise filtering, vertical/horizontal direction detection, and Kruskal-MST bubble clustering.
- **🎨 Polygon-Strict Inpainting:** Erases *strictly* over detected character contours (`UNCLIP_RATIO = 1.8`), preserving comic linework, screen tones, and balloon borders without ugly blurred boxes.
- **✍️ Algorithmic Typesetting:** Binary-search typography layout, hyphenation, adaptive color extraction, decollision padding, and rotated text matrix rendering.
- **🛠️ Standalone Kites Studio:** Full-featured interactive post-editor with 8-point bounding box dragging/resizing, raw/clean/typeset view toggles, and PNG export.
- **🔀 Smart Translation Waterfall:** Automatic failover across multi-provider chains (WebLLM, Cloudflare Shared Pool, Google Translate, OpenAI-compatible APIs).
- **🔒 Private & Local-First:** All images, OCR results, and workspace states stay saved in your browser's IndexedDB (Dexie.js) with 7-day automatic pruning. Zero tracking.

---

## 🖼️ Showcase

### Comparison 1: Japanese to English

> **Source:** *佐藤さんは知っていた* by [@09ra_19ra on X/Twitter](https://x.com/09ra_19ra) (Canonical manga-image-translator benchmark)

<div align="center">
<table>
  <tr>
    <th width="50%" align="center">Original Japanese Scan</th>
    <th width="50%" align="center">Kites Translated (English)</th>
  </tr>
  <tr>
    <td align="center">
      <img src="./README_images/input/demo2.jpeg" alt="Original Japanese Manga" width="100%" />
    </td>
    <td align="center">
      <img src="./README_images/result/demo2_result.png" alt="Kites English Translation" width="100%" />
    </td>
  </tr>
</table>
</div>

### Comparison 2: Japanese to Vietnamese

> **Source:** [Pixiv Artwork #145272482](https://www.pixiv.net/en/artworks/145272482)

<div align="center">
<table>
  <tr>
    <th width="50%" align="center">Original Japanese Scan</th>
    <th width="50%" align="center">Kites Translated (Vietnamese)</th>
  </tr>
  <tr>
    <td align="center">
      <img src="./README_images/input/demo7.jpg" alt="Original Japanese Manga" width="100%" />
    </td>
    <td align="center">
      <img src="./README_images/result/demo7_result.png" alt="Kites Vietnamese Translation" width="100%" />
    </td>
  </tr>
</table>
</div>

---

## 🛠️ Kites Studio

Every translation job is saved locally into browser storage and can be inspected or perfected in **Kites Studio**.

[![Kites Studio Interactive Editor](./README_images/UI-feature/kite_studio_editing.jpg)](./README_images/UI-feature/kite_studio_editing.jpg)

### What you can do in Studio:
- **3-Mode Canvas Inspection:** Toggle seamlessly between `Original`, `Cleaned` (inpainted background without text), and `Final` (typeset) outputs.
- **Interactive Bounding Box Controls:** Click, drag, and resize text regions using 8-point handles with real-time typesetting updates.
- **Fine-Grained Text & Font Editing:** Refine OCR transcriptions, adjust translations, override font families, customize stroke and fill colors, or change text direction.
- **Lossless PNG Export:** Download studio-polished pages at 1:1 original resolution.
- **IndexedDB Persistence:** Offline session history with automatic 7-day TTL cleanup.

---

## 🎛️ Extension Modes & UI

Kites integrates natively into your browsing workflow with a responsive Manifest V3 popup interface:

<div align="center">
<table>
  <tr>
    <th width="45%" align="center">Quick Control Popup</th>
    <th width="55%" align="center">Deep Settings & Engine Presets</th>
  </tr>
  <tr>
    <td align="center">
      <img src="./README_images/UI-feature/main-panel.jpg" alt="Kites Popup Main Panel" width="85%" />
    </td>
    <td align="center">
      <img src="./README_images/UI-feature/setting-panel.jpg" alt="Kites Settings Panel" width="85%" />
    </td>
  </tr>
</table>
</div>

### Four Flexible Trigger Modes:
1. **Hover Button:** An unobtrusive translation badge appears on hovered images using modern CSS anchor positioning.
2. **Persistent Controls:** Keeps actionable translation buttons pinned to all eligible comic panels on the page.
3. **Auto-Translate Mode:** Viewport-driven `IntersectionObserver` queues and translates incoming comic panels automatically as you scroll.
4. **Context Menu:** Right-click any web image and select **Translate Image** for on-demand processing.

---

## ⚡ Architecture

Kites uses a zero-suspension architecture that delegates compute-heavy WebGPU pipelines to an isolated **Offscreen Document**:

```text
Web Page Image (DOM <img>)
  │
  ├─ Content Script: Discover eligible images, attach CSS anchors & reversion shields
  │
  ├─ Background Service Worker: Message hub, request queue, concurrency & token bucket
  │
  ├─ Offscreen Document (Persistent WebGPU Runtime)
  │    ├─ PaddleOCR Engine: DBNet text detection -> dynamic crop -> PP-OCR recognition
  │    ├─ Geometry Pipeline: Speedline & noise filtering -> Kruskal-MST bubble clustering
  │    │
  │    ├─ Parallel Execution:
  │    │    ├─ Translation Waterfall: WebLLM / Cloudflare Pool / Google / Custom API
  │    │    └─ Polygon-Strict Inpainting: LaMa Manga / AOT-GAN / Telea / Simple Fill
  │    │
  │    └─ Canvas Renderer: Binary-search font sizing, hyphenation & matrix transformation
  │
  ├─ IndexedDB (Dexie.js): Store clean background, polygons & editable text blocks
  │
  └─ Content Script: Swap original <img> with high-res rendered Blob URL (srcset-safe)
```

> 💡 **Explore the details:** Open [`docs/workflow.html`](docs/workflow.html) for an interactive breakdown of detection thresholds, polygon math, clustering formulas, and inpainting contracts.

---

## 📊 Processing Engines

### 1. OCR (Optical Character Recognition)
Runs locally via `onnxruntime-web` (WebGPU / WASM) with models cached in browser storage.

| Preset | Target | Architecture | Notes |
| :--- | :--- | :--- | :--- |
| **PP-OCRv6-small** *(Default)* | Multilingual | DBNet + SVTR / LCNet | Best balance of speed and precision |
| **PP-OCRv6-medium / tiny** | Multilingual | DBNet + SVTR | Scaled variants for high-res scans or low-spec devices |
| **PP-OCRv5-mobile / server** | Multilingual | DBNet + CRNN | Classic PaddleOCR models |
| **PP-OCRv5-en-mobile** | English | DBNet + MobileNetV3 | Tuned for Latin scripts |
| **PP-OCRv3-japanese-mobile** | Japanese | DBNet + CRNN | Optimized for complex Kanji and Kana vertical layouts |

### 2. Inpainting (Text Removal & Background Repair)
Kites strictly erases **character contour polygons** rather than bounding rectangles, preventing background art degradation.

| Engine | Execution | Model Weights | Visual Quality |
| :--- | :--- | :--- | :--- |
| **LaMa Manga** *(Recommended)* | WebGPU / WASM | ONNX (~190 MB) | Neural FFC architecture; repairs screentones and textures |
| **AOT-GAN** | WebGPU / WASM | ONNX (~60 MB) | Fast GAN-based inpainting with dynamic patch bucketing |
| **Telea Diffusion** | CPU (JS/WASM) | Zero download | Fast-marching diffusion; great for flat colors & gradients |
| **Simple Fill** | Instant CPU | Zero download | Median color sampling around polygon boundary |
| **None** | None | None | Leaves original image intact beneath new lettering |

### 3. Translation Engines & Waterfall
Configure fallback chains to guarantee translation even during network hiccups or rate limits.

| Engine | Tier | Requirements | Description |
| :--- | :--- | :--- | :--- |
| **Google Translate** | Remote | None | Fast, reliable default with batched block indexing |
| **WebLLM** | Local (WebGPU) | WebGPU (VRAM ≥ 2 GB) | Runs open-weight LLMs (Llama 3.2, Qwen 2.5, Phi-3.5, Gemma 2) completely offline |
| **Kites Cloud Shared Pool** | Remote | Google Sign-in | Zero-cost community pool on Cloudflare Workers with multi-model fallback |
| **Custom API (BYOK)** | Remote | User API Key | Direct access to OpenAI (GPT-4o), Anthropic (Claude 3.5), Google (Gemini 2.5), or custom endpoints |

---

## 🚀 Installation

### Prerequisites
- Node.js 20+ (recommended: Node 22.14 LTS)
- Chromium-based browser (Google Chrome, Brave, Edge, Opera) with WebGPU support enabled
- Hardware acceleration enabled in browser flags (`chrome://flags/#enable-unsafe-webgpu` optional for dev builds)

### 1. Build from Source
```bash
# Clone the repository
git clone https://github.com/Unheat/Kites.git
cd Kites

# Install dependencies
npm ci

# Build the extension (generates dist/)
npm run build
```

### 2. Load into Chrome
1. Navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the `dist/` directory inside the project root.
4. Pin the **Kites** extension icon in your browser toolbar.

### 3. (Optional) Run Cloudflare Shared Pool Worker
The extension runs out-of-the-box with Google Translate, WebLLM, and Custom APIs. To host your own community pool:
```bash
cd worker
npm ci
cp .dev.vars.example .dev.vars
# Add provider keys (MISTRAL_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, etc.)
npm run dev
# Deploy to Cloudflare edge:
npm run deploy
```

---

## 💻 Development & Testing

```bash
npm run dev              # Vite dev server with Hot Module Replacement
npm run lint             # Oxlint syntax and safety check
npm test                 # Run Vitest test suite (200+ unit tests)
npm run test:e2e         # Interactive Puppeteer test with live Chrome instance
npm run test:visual      # Visual pipeline verification with real models
```

---

## 🔒 Privacy & Permissions

- **Local-First Processing:** OCR, polygon clustering, inpainting, and WebLLM translations happen **100% on your device**.
- **No Cloud Image Uploads:** Raw image pixels are processed in memory and never uploaded to remote inference APIs.
- **Encrypted Local Storage:** Settings and custom API keys reside exclusively in `chrome.storage.local`.
- **Zero Telemetry:** No analytics scripts, tracking cookies, or diagnostic beacons.

---

## 📜 License & Attribution

Kites is licensed under the **[GNU General Public License v3.0 (GPLv3)](LICENSE)**.

This project stands on the shoulders of giants. We express our deepest gratitude to the open-source creators and research communities whose work laid the foundation for Kites:

- **[manga-image-translator (Cotrans)](https://github.com/zyddnys/manga-image-translator):** Ground truth algorithms for spatial text grouping, direction detection, and typography fitting.
- **[xianscan-rust](https://github.com/ArbenApura/xianscan-rust):** Dynamic patch inpainting strategies, OCR speedline filtering, and color extraction pipelines.
- **[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR):** Ultra-lightweight DBNet detection and text recognition models.
- **[InpaintWeb](https://github.com/lxfater/inpaint-web) & [pyheal](https://github.com/olvb/pyheal):** Fast in-browser canvas diffusion and inpainting concepts.
- **[@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm):** High-performance WebGPU client runtime for open-source large language models.

*For detailed per-module licenses and copyright notices, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).*

---

<div align="center">
  <sub>Built with ❤️ for manga and comic lovers worldwide. Star ⭐ Kites if you enjoy reading comics without language barriers!</sub>
</div>
