# Devlog: Development Instrumentation and Vite 8 / CRXJS Compatibility

* **Date:** 2026-09-08
* **Feature/Task:** Phase 13: Development-Only Pipeline Timing and Stable Extension Builds
* **Ticket/Issue Link:** CRXJS upstream contribution prepared locally in `scratches/reference/chrome-extension-tools`, branch `fix/vite-8-rolldown-options`, commit `28aed46`
* **Status:** Completed

---

## Objective

Add detailed pipeline timing and translation diagnostics for local development without adding production runtime overhead. Preserve normal production compilation and make CRXJS development mode reliable under Vite 8, including MV3 service-worker and offscreen-document startup.

---

## Workflow & Implementation Steps

1. **Guarded Development Instrumentation:** Wrapped expensive timing calculations and verbose diagnostic output with `import.meta.env.DEV` in `PipelineOrchestrator`, `TranslationManager`, `LamaBaseInpaintEngine`, `PaddleOcrEngine`, `extractPolygons`, and `WebLLMEngine`.
2. **Mode-Aware Minification:** Changed `vite.config.ts` to use `minify: mode === 'production'`. Development bundles remain readable, while production compilation replaces `import.meta.env.DEV` with `false` and removes unreachable timing/logging blocks through dead-code elimination.
3. **Restored CRXJS-Compatible Build Input:** Kept `build.rollupOptions` rather than adopting Vite 8's preferred `build.rolldownOptions`. Vite 8 accepts and aliases the old key internally, while CRXJS 2.7.1 still reads it directly from raw user configuration.
4. **Pinned Development Entry Discovery:** Added explicit `optimizeDeps.entries` for `popup.html`, `index.html`, `src/offscreen/offscreen.html`, `src/content/index.tsx`, and `src/background/index.ts`. This makes Vite scan all extension execution contexts before Chrome requests them.
5. **Excluded Native Node Dependencies:** Kept `ppu-paddle-ocr`, `ppu-paddle-ocr/node`, `@napi-rs/canvas`, `@napi-rs/canvas-darwin-arm64`, `canvas`, and `onnxruntime-node` out of browser optimization/build traversal. This prevents native `.node` binary parsing errors and avoids bundling the desktop/OpenCV fallback.
6. **Protected Kites Tests from Reference Repositories:** Added `**/scratches/**` to Vitest exclusions after cloning the CRXJS source under `scratches/reference`; otherwise Kites' test command also discovered upstream repository tests.
7. **Prepared Upstream CRXJS Fix:** Cloned `crxjs/chrome-extension-tools`, updated CRXJS to read `rolldownOptions` with a `rollupOptions` fallback, added unit coverage for both configurations, and added a patch changeset.

---

## Roadblocks & Decisions

### Vite 8 Configuration Rename Broke CRXJS Development Discovery

* **The Problem:** Vite 8 marks `build.rollupOptions` deprecated in favor of `build.rolldownOptions`. Renaming the field looked correct, but CRXJS 2.7.1 reads only `config.build.rollupOptions.input` in its raw configuration hook. The offscreen and dashboard pages were therefore omitted from initial dependency discovery.
* **Observed Failure:** When the extension started, Vite discovered dependencies late and returned `504 Outdated Optimize Dep` while Chrome was loading the MV3 service worker. A normal Vite web page can reload after this signal; Chrome service-worker registration treats the non-200 module response as fatal and reports status code 3.
* **The Solution:** Keep `build.rollupOptions` for CRXJS compatibility and declare all runtime entries explicitly in `optimizeDeps.entries`.
* **Reasoning:** This is a compatibility bridge, not a rollback from Rolldown. Vite 8 internally aliases `rollupOptions` to Rolldown options, so production still uses Vite 8's Rolldown-based build pipeline.

### Browser Build Traversed Desktop Native Dependencies

* **The Problem:** `ppu-paddle-ocr` exposes desktop paths involving `canvas`, `onnxruntime-node`, and platform-specific NAPI binaries. If the browser bundler traverses those paths, Rolldown may attempt to read a compiled `.node` file as UTF-8 or emit a large unused desktop/OpenCV chunk.
* **The Solution:** Externalize the Node-only packages for production and exclude them from development dependency optimization.
* **Reasoning:** Kites uses browser-safe OCR paths at runtime. Desktop packages exist for tests or upstream package internals and must not enter a Chrome extension bundle.

### Development Logs Must Not Affect Production Performance

* **The Problem:** Timing every OCR, translation, and inpainting stage plus printing translated text pairs would add noise and small runtime work if left active in production.
* **The Solution:** Use `import.meta.env.DEV` at each instrumentation site instead of globally removing `console` calls.
* **Reasoning:** Important production state-transition and error logs remain available, while development-only timing math and verbose payload logs are compiled out.

---

## Verification

* Ran Kites test suite: 26 test files and 166 tests passed.
* Ran `npm run build`: Vite 8.1.4 transformed 1,869 modules and completed successfully.
* Confirmed production output did not contain development timing messages such as `OCR stage complete in` or `Translation pairs`.
* Ran CRXJS focused unit coverage: 14 test files and 95 tests passed.
* Added CRXJS tests proving `build.rolldownOptions.input` works and `build.rollupOptions.input` remains backwards compatible.

---

## Next Steps / Key Takeaways

* **Key Takeaway:** A deprecation warning does not mean an ecosystem plugin already supports the replacement field. Verify raw plugin configuration hooks before renaming compatibility-sensitive Vite options.
* **Maintenance Rule:** Do not remove explicit `optimizeDeps.entries`, native-package exclusions, or `build.rollupOptions` until Kites upgrades to a released CRXJS version with verified Vite 8 `rolldownOptions` support.
* **Next Action:** Submit the prepared CRXJS branch upstream after checking for duplicate issues or pull requests and following the repository contribution template.
