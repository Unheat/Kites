<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

# 🪁 Kites

### Read Any Manga in Your Language. Directly in Your Browser.
**Zero Python • Zero Servers • 100% Private In-Browser Extension AI Translation**

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Free_Install-4285F4.svg?style=flat-square&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-success.svg?style=flat-square&logo=googlechrome&logoColor=white)](manifest.json)
[![WebGPU](https://img.shields.io/badge/Hardware-WebGPU%20Accelerated-orange.svg?style=flat-square&logo=webgpu&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
[![Vite](https://img.shields.io/badge/Built%20with-React%2019%20%2B%20Vite-646CFF.svg?style=flat-square&logo=vite&logoColor=white)](package.json)

<br/>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb">
    <img src="https://img.shields.io/badge/Available_in_the-Chrome_Web_Store-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Available in the Chrome Web Store" height="42" />
  </a>
  &nbsp;&nbsp;
  <a href="https://github.com/Unheat/Kites/releases/latest">
    <img src="https://img.shields.io/badge/GitHub_Releases-Download_.zip-24292e?style=for-the-badge&logo=github&logoColor=white" alt="Download Release .zip" height="42" />
  </a>
</p>

<br/>

[![Kites Hero Banner](./README_images/Gemini_Generated_Image_f7lh52f7lh52f7lh.jpeg)](./README_images/Gemini_Generated_Image_f7lh52f7lh52f7lh.jpeg)

</div>

---

## 💡 Why Kites?

Traditional manga translators require installing complex Python scripts, gigabytes of CUDA packages, or uploading your private reading history to third-party cloud servers.

**Kites changes that.** It is a lightweight Chrome extension that runs state-of-the-art vision and language models **directly on your graphics card via WebGPU**.

- ⚡ **Zero Setup:** Install with 1-click from the [Chrome Web Store](https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb) and start reading immediately. No terminal, no Python, no dependencies.
- 🔒 **100% Local & Private:** Optical character recognition (OCR) and background cleaning happen on your device. Your images never leave your browser.
- 🎨 **Intelligent Background Repair:** AI inpainting erases foreign text cleanly while preserving linework, screentones, and textures.
- ✍️ **Natural Typesetting:** Automatically measures speech balloons, balances line breaks, fits font sizes, and adapts font colors.
- 🗨️ **Smart Speech Bubble Fit:** Advanced bubble detection (Heuristic & Neural YOLO) expands narrow CJK columns into roomy balloon chambers, eliminating tiny squeezed fonts.
- 📜 **Full Webtoon Strip Support:** Seamlessly translates extreme long-strip webtoons ($>14,000\text{ px}$) with 1D in-memory canvas tiling at full native resolution.
- 🛠️ **Built-in Studio:** Fix mistranslations, resize text balloons, or tweak typography on the fly.

---

## 🖼️ See It in Action

### Japanese → English
> *Story: 佐藤さんは知っていた by [@09ra_19ra](https://x.com/09ra_19ra)*

<div align="center">
<table>
  <tr>
    <th width="50%" align="center">Original Japanese</th>
    <th width="50%" align="center">Kites Translated</th>
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

### Japanese → Vietnamese
> *Source: [Pixiv Artwork #145272482](https://www.pixiv.net/en/artworks/145272482)*

<div align="center">
<table>
  <tr>
    <th width="50%" align="center">Original Japanese</th>
    <th width="50%" align="center">Kites Translated</th>
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

## 🖱️ Instant In-Place Translation

Hover over any comic panel on Twitter/X, Pixiv, or manga sites. An unobtrusive floating badge appears using CSS Anchor Positioning—click it to translate dialogue directly inside the artwork with zero copy-pasting.

<div align="center">
  <img src="./README_images/UI-feature/hover-inplace-preview.png" alt="Kites In-Page Hover Translation Button" width="620px" />
</div>

- 🖱️ **Hover:** Translate instantly by hovering over any comic panel.
- 📌 **Persistent:** Keep translate badges visible on all comic images.
- 🚀 **Auto-Translate:** Automatically translates new panels as you scroll down the page.
- ✂️ **Screen Crop:** Translate protected canvas elements, WebGL games, or custom crops via right-click or `Ctrl/Alt + Shift + X`.
- ⚡ **Reading Hotkeys:** Press `F` to instantly peek at the original raw image, `Ctrl/Alt + Shift + Z` to translate the hovered panel, and `Ctrl/Alt + Shift + M` to open the chapter reader.
- 🎯 **Right Click:** Translate any image on the web via the browser context menu.

---

## 📖 Chapter Reader & Fast Scan

Read entire manga or webtoon chapters in one distraction-free view with automatic batch detection, continuous vertical webtoon mode, multi-page translation, and offline ZIP export:

[![Kites Chapter Reader](./README_images/UI-feature/reader.jpg)](./README_images/UI-feature/reader.png)

- **Fast Scan:** Automatically auto-scrolls and queues all lazy-loaded manga panels across chapter pages.
- **Flexible Reader Modes:** Seamlessly switch between Webtoon continuous vertical strips, Single page, and Double spread layouts.
- **Batch Chapter Translation:** Translate the entire chapter in one click with progress tracking and offline preservation.
- **1-Click Chapter ZIP Export:** Package all translated pages into a clean, numbered ZIP archive for offline reading and archiving with zero server uploads.

---

## 🛠️ Built-in Kites Studio

Need to polish a scanlation or adjust phrasing? Open the full-screen **Kites Studio** straight from the extension.

[![Kites Studio](./README_images/UI-feature/kite_studio_editing.jpg)](./README_images/UI-feature/studio-editor.png)

- **Direct Inline Editing:** Double-click any speech balloon to edit dialogue directly in place with subpixel vertical centering and live typesetting reflow.
- **Interactive Canvas:** Drag and resize speech bubbles with 8-point handles.
- **Localized AI Inpaint Brush:** Erase artwork defects, speech bubbles, or untranslated SFX with brush stroke precision.
- **Side-by-Side Verification:** Compare original, cleaned, and typeset views with one click.
- **Typography Control:** Live font sizing, colors, alignment, and line height adjustments.
- **1-Click Export:** Download clean, translated pages at original resolution.

---

## 🎛️ Extension Controls & Presets

Customize target languages, neural OCR models, and inpainting algorithms from the clean popup:

<div align="center">
<table>
  <tr>
    <th width="33%" align="center">Quick Control Popup</th>
    <th width="33%" align="center">Chapter Reader &amp; Scanner</th>
    <th width="34%" align="center">Customizable Engine Settings</th>
  </tr>
  <tr>
    <td align="center">
      <img src="./README_images/UI-feature/main-panel.jpg" alt="Kites Main Popup" width="95%" />
    </td>
    <td align="center">
      <img src="./README_images/UI-feature/reader-panel.jpg" alt="Kites Chapter Reader and Scanner Panel" width="95%" />
    </td>
    <td align="center">
      <img src="./README_images/UI-feature/setting-panel.jpg" alt="Kites Settings Panel" width="95%" />
    </td>
  </tr>
</table>
</div>

- **Custom Glossary:** Define character names, honorifics, and specialized terminology to guide local and cloud LLM outputs.
- **Site Domain Rules:** Enable, disable, or assign custom element selectors per domain.

---

## 🧠 Powered by Modern AI

| Component | Options | Description |
| :--- | :--- | :--- |
| **Translation** | **WebLLM** *(Local WebGPU)*<br/>**Cloud Shared Pool** *(Free)*<br/>**Google Translate**<br/>**Custom API** *(OpenAI, Claude, Gemini)* | Run local LLMs right in your browser (Qwen 3.5, Qwen 3, Gemma 3, Llama 3.2), use our free community pool, or connect your own API key. |
| **Inpainting** | **LaMa Manga** *(Neural)*<br/>**AOT-GAN** *(Fast Neural)*<br/>**Telea Diffusion** *(Instant)*<br/>**Simple Fill** | Erases text strictly inside character boundaries to preserve comic art. |
| **OCR** | **PaddleOCR v3 – v6** | Industry-standard multilingual text detection and recognition with seamless 1D webtoon strip tiling. |
| **Bubble Fit** | **Neural YOLO** *(WebGPU)*<br/>**Heuristic** *(Instant)*<br/>**Classic MST** | Expands dialogue into natural balloon whitespace with tail severing, eliminating tiny fonts. |

---

## 🚀 Quick Start & Installation

### Option 1: Chrome Web Store (Recommended • 1-Click Install)

The official and easiest way to install Kites. Includes automatic background updates and Google Web Store security review:

<div align="left">
  <a href="https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb">
    <img src="https://img.shields.io/badge/Add_to_Chrome-Free_Install-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Add to Chrome" height="38" />
  </a>
</div>

1. Open **[Kites on the Chrome Web Store](https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb)**.
2. Click **Add to Chrome** and confirm the prompt.
3. Pin **Kites** to your browser toolbar for easy access.
4. Browse any manga or comic page (on Twitter/X, Pixiv, MangaDex, etc.) and hover over a panel to translate!

---

### Option 2: Pre-Built Zip (Manual Unpacked — Zero Terminal Required)

For offline environments, manual testing, or loading specific releases:

1. Download **[`kites.zip`](https://github.com/Unheat/Kites/releases/latest)** from the latest GitHub Release.
2. Unzip the downloaded `.zip` file into a folder on your computer.
3. In Chrome, open `chrome://extensions/`.
4. Enable **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked** and select the unzipped folder.
6. Pin **Kites** to your browser toolbar and start reading immediately!

---

### Option 3: Build from Source (Developers)

```bash
# 1. Clone repository
git clone https://github.com/Unheat/Kites.git
cd Kites

# 2. Install dependencies & build extension
npm ci
npm run build
```

1. In Chrome, open `chrome://extensions/`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the generated `dist/` folder.
4. Pin **Kites** to your toolbar and start reading!

---

## 🤝 Contributing & Documentation

We warmly welcome contributions from developers, translators, and comic lovers!

- 📖 **[Documentation Hub](docs/README.md)** — Architectural diagrams, pipeline specifications, and runtime contracts.
- 📐 **[Interactive Pipeline Map](docs/workflow.html)** — Standalone interactive visualization of Kites' detection, inpainting, and typesetting algorithm.
- 🛠️ **[Contribution Guide](CONTRIBUTING.md)** — How to set up your dev environment, run tests, and submit PRs.

---

## 📜 License & Acknowledgements

Kites is licensed under the **[GNU General Public License v3.0](LICENSE)**.

Heartfelt thanks to the incredible open-source projects that made Kites possible:
- **[manga-image-translator (Cotrans)](https://github.com/zyddnys/manga-image-translator):** Groundbreaking spatial text grouping and typesetting algorithms.
- **[xianscan-rust](https://github.com/ArbenApura/xianscan-rust):** Dynamic patch inpainting architectures and OCR noise filters.
- **[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR):** High-speed neural text detection models.
- **[@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm):** Browser-native WebGPU runtime for large language models.

---

<div align="center">
  <sub>Built with ❤️ for manga and comic enthusiasts. Star ⭐ Kites if you love seamless reading!</sub>
</div>
