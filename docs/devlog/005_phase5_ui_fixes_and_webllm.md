# Devlog: Global UI Fixes & WebLLM Hardware Fallbacks

* **Date:** 2026-07-17
* **Feature/Task:** Fix Global UI Overlay & Plan Model Downloader
* **Status:** Completed

---

## Objective

To robustly inject the Kites translation button into complex host websites (like Reddit) without breaking the host's CSS, and to finalize the hardware detection strategy for the local LLM translation engines.

---

## Workflow & Implementation Steps

1. **CSS Anchor Restoration:** Fixed the translation button positioning in `src/content/index.tsx`.
2. **Global CSS Leak Fix:** Corrected a critical scoping issue where Tailwind's global Preflight was injected into the host webpage, breaking all native `<svg>` icons.
3. **WebLLM Hardware Detection Research:** Investigated `@mlc-ai/web-llm` and its underlying TVM engine behavior regarding WebGPU vs WebAssembly fallbacks.
4. **Model Download Architecture Planning:** Drafted the architecture for safely downloading and storing gigabytes of model weights (`.onnx` and LLM chunks) inside the browser's native `CacheStorage` API within the Offscreen Document.

---

## Roadblocks & Decisions

### Roadblock 1: Reddit's Stacking Contexts vs CSS Anchors
* **The Problem:** We wanted to use modern CSS Anchor Positioning (`anchor-name`) to perfectly track images. However, websites like Reddit use complex modal overlays with `transform` and `filter: blur()`, which create strict stacking contexts. Our translation button was getting trapped *underneath* or *inside* these containers, clipping it out of view.
* **The Solution:** We moved the React mount point to a completely isolated `<div id="kites-global-overlay">` appended directly to `document.body` with `style.display = 'contents'`. We abandoned standard CSS Anchors for "live" tracking on highly dynamic sites, pivoting to absolute `getBoundingClientRect` polling for precise screen-space coordinates, completely immune to host CSS traps. We also added logic to skip images that have `style.filter !== 'none'` to avoid drawing buttons on blurred background thumbnails.

### Roadblock 2: The Tailwind Preflight CSS Leak
* **The Problem:** After a refactor, every `<svg>` icon on the host webpage (e.g. Reddit's upvote arrows, Twitter's icons) broke, either disappearing or moving to the top left of their containers.
* **The Solution:** We accidentally imported `../index.css` (which contains `@tailwind base`) into the content script instead of the scoped `./content.css`. Tailwind's Preflight globally targets `svg` tags and applies `display: block`, which ruins host sites. Reverting to the explicitly scoped `content.css` immediately fixed all host icons.

### Roadblock 3: Do We Need WebAssembly Weights for WebLLM?
* **The Problem:** We were worried that if a user's browser doesn't support WebGPU, we would need to maintain entirely separate model weights or `.wasm` binaries for WebAssembly fallback.
* **The Solution:** Through research, we confirmed that TVM/WebLLM handles the WebGPU-to-WASM fallback gracefully *using the exact same model weights*. The `web-llm` library ships with a precompiled `tvmjs_runtime.wasi.wasm` engine that automatically takes over computation if WebGPU is unavailable. We do not need to host or download duplicate models; a single model repository supports both hardware paths.

---

## Next Steps / Key Takeaways

* **Key Takeaway:** Never inject `@tailwind base` into a Chrome Extension Content Script unless it is strictly isolated inside a Shadow DOM. If using a standard DOM overlay, always use a manually scoped stylesheet to prevent global CSS leaks.
* **Next Action:** Finalize the UI triggers for the Model Downloader (Dropdown vs Translate button) and implement the native `CacheStorage` fetch logic.
