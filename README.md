# Kites: Spatial Manga Translator

Kites is a Chrome Manifest V3 extension that detects text in manga and web images, translates it, removes the original lettering, and typesets the result back into the image.

> [!IMPORTANT]
> Kites is under active development and is currently installed from source. It is not published on the Chrome Web Store.

## Features

- **Translate in place** using an image hover button, persistent image controls, automatic translation when images enter the viewport, or the browser context menu.
- **Browser-side OCR** with PaddleOCR models running through ONNX Runtime WebGPU or WASM.
- **Spatial text reconstruction** with geometric noise filtering, horizontal/vertical direction detection, and Cotrans-inspired Kruskal minimum-spanning-tree line grouping.
- **Multiple translation routes** through Google Translate, local WebLLM models, the authenticated Kites Cloud Shared Pool, or custom OpenAI, OpenAI-compatible, Gemini, and Anthropic APIs.
- **Ordered translation fallbacks** when a configured engine fails.
- **Selectable image cleanup** with no inpainting, Simple Fill, Telea-like diffusion, AOT-GAN, or LaMa Manga.
- **Manga-aware typesetting** with binary-search font fitting, balanced line wrapping, adaptive colors, collision reduction, and rotated-region rendering.
- **Kites Studio** for browsing recent jobs, comparing the original and clean images, editing translated lines, and exporting PNG files.
- **Local project storage** through Dexie and IndexedDB, with automatic cleanup after seven days.

## How it works

```text
Web page image
  │
  ├─ Content script: detect eligible <img> elements
  ├─ Background worker: fetch, deduplicate, and queue image jobs
  ├─ Offscreen runtime
  │    ├─ PaddleOCR polygon detection and recognition
  │    ├─ Noise filtering and Kruskal-MST line grouping
  │    ├─ Translation ───────────────┐
  │    └─ Polygon-only inpainting ──┤ run in parallel
  │                                 └─ Binary-search typesetting and canvas render
  ├─ IndexedDB: clean image and editable text blocks
  └─ Content script: replace the page image with the translated PNG
```

Open the [interactive algorithm workflow](docs/workflow.html) for detection thresholds, OCR filters, line-merging rules, translation batching, inpainting contracts, and font-fitting details.

## Requirements

- [Node.js 20](https://nodejs.org/)
- npm
- Google Chrome or another Chromium browser with the required Manifest V3 APIs
- Internet access for online translators and initial model downloads
- WebGPU-capable hardware and browser support for local WebLLM and optional GPU acceleration

WebGPU is not required for the default Google Translate, PaddleOCR WASM, and Simple Fill workflow.

## Build and install

```bash
git clone https://github.com/Unheat/Kites.git
cd Kites
npm ci
npm run build
```

The unpacked extension is generated in `dist/`.

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the generated `dist/` directory.
5. Pin Kites, open the popup, and select the source language, target language, and processing engines.

> [!NOTE]
> Google sign-in is tied to the OAuth client and extension identity configured in `manifest.json`. A locally built extension may need matching Google Cloud OAuth configuration before Cloud Shared Pool sign-in works.

## Usage

1. Open a regular HTTP or HTTPS page containing an image at least `150 × 150` rendered pixels.
2. Start translation using one of these modes:
   - **Hover** — show a translation button on the image under the pointer.
   - **Persistent** — keep controls visible on every eligible image.
   - **Auto-Translate** — queue eligible images when they enter the viewport.
   - **Context menu** — right-click an image and choose **Translate Image**.
3. Wait for OCR, translation, inpainting, and typesetting to complete. Kites replaces the matching page image with a baked PNG.
4. Open **Kites Studio** from the popup to edit translated lines or export the current result.

Dynamic pages are observed for newly inserted images. Automatic mode uses `IntersectionObserver`, so off-screen images are not queued until they become visible.

## Processing engines

### OCR

Kites runs PaddleOCR detection and recognition in the extension's offscreen document. Available presets include PaddleOCR v3–v6 mobile/server variants plus English- and Japanese-focused recognition models.

OCR model assets are downloaded once and stored in the browser Cache API. Recognition quality varies by selected model and language; the language selector does not guarantee equal OCR coverage for every listed language.

### Translation

| Engine | Execution | Notes |
| --- | --- | --- |
| Google Translate | Remote | Default engine; batches indexed text blocks. |
| WebLLM | Local WebGPU | Downloads model weights and requires WebGPU. Available models and memory estimates come from [`models-registry.json`](src/shared/models-registry.json). |
| Kites Cloud Shared Pool | Remote | Requires Google sign-in and uses the optional Cloudflare backend. |
| Custom API | Remote | Supports OpenAI, OpenAI-compatible HTTPS endpoints, Gemini, and Anthropic. |

Fallback engines are tried in their configured order when an engine throws. Google Translate retains the source text for many failed requests internally, so those failures may not advance to the next waterfall engine.

### Inpainting

| Engine | Download | Behavior |
| --- | ---: | --- |
| None | No | Keeps the original image beneath translated text. |
| Simple Fill | No | Fills each OCR polygon using a sampled median background color. |
| Telea Diffusion | No | Uses local fast-marching-style diffusion around the text mask. |
| AOT-GAN | Yes | Runs a cached ONNX neural inpainting model. |
| LaMa Manga | Yes | Runs a cached manga-tuned ONNX model. |

Inpainting receives filtered OCR line polygons—not the full speech-bubble region or raw DBNet probability mask—to reduce accidental removal of artwork.

## Development

```bash
npm run dev       # Start the Vite development server on port 5173
npm run lint      # Run Oxlint
npm test          # Run Vitest unit tests under src/
npm run build     # Copy ONNX Runtime assets, type-check, and build the extension
npm run preview   # Preview built web entry points
```

The Vite page alone does not provide a complete extension environment. Test extension APIs, the background worker, content script, and offscreen pipeline by loading `dist/` in Chrome.

To run the same fast checks as continuous integration:

```bash
npm ci
npm run lint
npm test
npm run build
```

### Browser checks

Build first, then run the interactive Chrome test:

```bash
npm run build
npm run test:e2e
```

This launches a visible browser, loads `dist/`, visits a live page, and exercises the default Google Translate and Simple Fill path. Treat it as an interactive end-to-end debugging check rather than a strict continuous-integration result.

Local WebLLM and model-network testing requires hardware WebGPU and larger downloads:

```bash
npm run build
npm run test:webllm
```

The first run may download hundreds of megabytes of OCR and translation models and can take several minutes. The real-model visual pipeline check is deliberately separate from `npm test`:

```bash
npx tsx src/test/pipelineVisualTest.ts
```

## Optional Cloudflare Worker

The extension works without a local worker when using Google Translate, WebLLM, or custom APIs. The `worker/` package provides Kites Cloud Shared Pool, Google authentication, quota tracking, provider fallback, and circuit breaking.

```bash
cd worker
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

Configure `GOOGLE_CLIENT_ID` and `JWT_SALT`, then add API keys only for the providers you enable. Current provider-dependent secrets may include `MISTRAL_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, and `OPENROUTER_API_KEY`. Workers AI uses the Wrangler `AI` binding instead of an API key.

```bash
npm test          # Worker unit tests
npm run deploy    # Deploy with Wrangler
```

A separate deployment must update both the Worker route in `worker/wrangler.jsonc` and the extension API base URL in `src/shared/constants.ts`.

## Privacy and permissions

Kites requests access to all URLs because it must find and fetch user-selected images on arbitrary pages. It also uses extension storage, context menus, an offscreen document, and Google Identity for the features described above.

- OCR and inpainting run locally after their model files are cached.
- WebLLM translation runs locally after its model is downloaded.
- Google Translate, Cloud Shared Pool, and custom API engines send extracted text to the selected remote service.
- Settings and custom API credentials are stored in `chrome.storage.local`.
- Source images, clean images, OCR text, translations, geometry, and rendering metadata are stored locally in IndexedDB.
- No production analytics or telemetry integration is present.

## Current limitations

- Kites targets standard HTML `<img>` elements. Canvas/WebGL readers and protected viewport capture are not supported.
- Very small, hidden, transparent, or filtered images may be skipped depending on the selected interaction mode.
- Studio edits translated text but does not currently support dragging/resizing regions, editing per-region colors, or rerunning OCR.
- WebLLM has no CPU fallback and requires WebGPU.
- OCR quality and writing-system coverage depend on the selected PaddleOCR model and dictionary.
- A failed neural inpainting run falls back to rendering over the original image rather than automatically trying another inpainting engine.

## Project structure

```text
Kites/
├── manifest.json          Chrome Manifest V3 configuration
├── src/
│   ├── background/        Service worker, queueing, and authentication
│   ├── content/           Page image detection and overlay controls
│   ├── offscreen/         OCR, translation, inpainting, and rendering
│   ├── popup/             Extension settings UI
│   ├── shared/            Shared types, constants, registries, and utilities
│   ├── test/              Pipeline probes and test assets
│   ├── App.tsx            Kites Studio
│   └── db.ts              Dexie/IndexedDB schema and cleanup
├── worker/                Optional Cloudflare Shared Pool backend
├── scripts/               Build helpers and browser checks
├── docs/                  Architecture, workflow, and development notes
└── vite.config.ts         Vite, CRXJS, and Vitest configuration
```

## Documentation

- [Interactive algorithm workflow](docs/workflow.html)
- [Implementation plan and current scope](docs/fullplan.md)
- [Development log](docs/devlog/)
- [Cloudflare Worker WAF notes](worker/WAF_RULES.md)

## License & Attribution

Kites is licensed under the [GNU General Public License v3.0 or later](LICENSE).

This project incorporates ported algorithms, architectural concepts, and assets from third-party open-source projects including [manga-image-translator (Cotrans)](https://github.com/zyddnys/manga-image-translator), [xianscan-rust](https://github.com/ArbenApura/xianscan-rust), [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), [InpaintWeb](https://github.com/lxfater/inpaint-web), and [OpenCV/pyheal](https://github.com/olvb/pyheal).

For comprehensive third-party copyright notices, licenses, and detailed module-by-module attribution of all ported algorithms, please refer to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

