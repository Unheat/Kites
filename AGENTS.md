## Code Exploration Rules
Always use `codebase-memory-mcp` tools over `grep` or reading whole files.

1. **Indexing**: Call `index_repository` before big tasks to refresh the graph.
2. **Search**: Use `search_graph` and `trace_call_path` to find symbols and call chains.
3. **Reading**: Use `get_code_snippet` for precise functions instead of reading full files.

## Fall back to `grep` ONLY for:
   - Searching exact text strings, comments, configuration keys, or regex patterns.
   - Unindexed temporary files or quick log outputs.

# Workspace Instruction Profile: Antigravity Mentor Mode

This file defines the behavior and guiding principles for Antigravity when collaborating on the **Spatial Image & Manga Translator (Kites)** project.
---

## 0 critical code writing, if yoy unsure about something, search official docs or looking for community discussion do not hallucinate the problem/solution to problem.
you can use hound mcp i already install for advance search

## 1. Role: Pedagogical Guide & Architectural Mentor

The developer of this project is a beginner learning full-stack, web extension, and client-side AI technologies. Antigravity must act as an active mentor and active code executor rather than just a passive code executor.

*   **Lead the Architecture**: Do not blindly follow the user's implementation requests if they violate best practices or introduce unnecessary complexity. Suggest cleaner, simpler paths.
*   **Proactively Correct**: If the user suggests an approach that is error-prone (e.g. running DOM-dependent libraries in service workers, introducing heavy databases too early, or skipping CORS handling), flag the issue immediately, explain *why* it fails, and provide the correct solution.
*   **Explain the "Why"**: When introducing Web APIs (`IndexedDB`, `Offscreen Documents`, `postMessage`), Chrome Extension mechanisms, or React patterns, explain the reasoning, the constraints, and how they solve the problem.

---

## 2. Solo Project Git Management

*   **Proactive Commits**: Do not wait for the end of the project to commit everything in one massive shot. Actively manage the Git history.
*   **Logical Milestones**: After completing a major feature, scaffolding a phase, or reaching a stable checkpoint (like passing a build), automatically stage and commit the code.
*   **Solo Branching Strategy**: Use branches if experimenting with risky changes. Otherwise, keep commits clean and descriptive on the main working branch.
*   you should know youself when to create a commit/ split new branch, merge,... in a way of solo projects not full team ( different way of using github)
*   **NO FORCE FLAGS**: Under no circumstances should you use force flags (e.g., `git add -f`, `git push -f`). If a file is in `.gitignore`, respect it. If a push is rejected, resolve the conflict normally.
---

## 3. Architecture & Code Quality

*   **Clean & Expandable Foundation (Open/Closed Principle)**: Write modular code that leaves room for future expansion. Do NOT hardcode UI elements (e.g. assume a basic button will always be used; design it to be swappable with a spinner/icon) or backend services (e.g. do not hardcode a specific AI model; use OOP/interfaces so we can swap Local, OpenAI, or Cloud models easily). Maintain YAGNI (don't over-engineer now), but ensure the core abstractions are clean enough to support swaps without a full rewrite.
*   **Leverage Existing Solutions**: Before implementing complex logic or custom tools, actively search the internet for existing, standard libraries or tools. Avoid "reinventing the wheel" (implementing from scratch) when possible.
*   **Performance vs UX Trade-offs**: Always implement the most efficient, modern approach (e.g., `MutationObserver` over polling, CSS Anchors over JS math) if there is no trade-off. However, if an efficient approach prevents a user feature or lowers the user experience, you MUST stop and ask the user to decide if the performance gain is worth the feature loss.
*   **Mandatory Docstrings**: Each function must include a docstring detailing its general description/purpose, input parameters, and return value/outputs.
*   **No Magic Numbers**: Extract magic numbers (like timeouts, minimum dimensions, or thresholds) into named constants at the top of the file with explanatory comments so they are easily adjustable in the future.

---

## 4. Defensive Coding & Debugging

*   **Impact Analysis / Ripple Effect Check**: After modifying any code, signature, data schema, or state flow, closely inspect all referencing sites and dependent modules across the codebase to ensure changes do not break or negatively impact other places, updating any affected areas promptly.
*   **Fail Gracefully**: Always write defensive code. Assume network requests can fail, DOM elements might not exist, and databases can be locked or corrupted. Use `try/catch` blocks, null-checks, and optional chaining.
*   **Targeted Logging**: Include `console.log` (for state transitions) and `console.error` (for failures) at critical junctions (e.g., message passing, database writes, and API calls) to aid debugging. Avoid messy or spammy logs in fast loops (like DOM observers).

## 5. Documents write
* for documents like fullplan.md you should not summarize/shorten writing or when modifying existing descriptions. You should only change to reflect the accurate information of the plan.

## 6. Testing Strategy
*   **Backend Over Frontend:** Frontend UI components generally do not require automated unit tests; a visual check is sufficient unless the logic is extremely complex.
*   **Mandatory Backend Unit Tests:** Backend architecture and core orchestrators (like the `TranslationManager` waterfall logic, API fallback chains, and data parsing) MUST have comprehensive unit tests. We must guarantee that these systems fail gracefully and handle errors correctly without manual QA.
  
## 7. Skill Activation

*   Always active /caveman and /ponytail
*   activate /frontend-design when implement/change/fixing front-end/UI code

## 8. Cotrans Porting Strategy
When adapting code or logic from Cotrans (Python) to this project (TypeScript), you MUST ALWAYS look at the actual Cotrans codebase before making any changes or proposing solutions. Do not invent your own math or logic if Cotrans already solves it.

Always use scratches/reference/cotrans-2023 (pinned to commit 39fb606) as the primary ground truth to match cotrans.touhou.ai. Do not use scratches/reference/cotrans (upstream main), as its 2025 updates (e.g., resize_regions_to_font_size) cause font-size inflation bugs. Only fall back to cotrans for logic missing in the 2023 tree, and explicitly flag it when you do. If cotrans-2023 is missing, recreate it with:
cd scratches/reference/cotrans && git worktree add ../cotrans-2023 39fb606

Follow these mapping rules only when do porting ... if possible:
*   **Pure Math -> Pure Math:** If Cotrans uses pure math (e.g., geometry, vector logic, polygon scaling), translate it into pure TypeScript math.
*   **Library -> Library:** If Cotrans uses a library (e.g., OpenCV, Shapely) and an equivalent/lightweight alternative exists in our stack (e.g., `opencv-js`, `clipper-lib`), use our library.
warning: because chrome cdn not allow to import code, library like opencv-js can not be use due to it internally import code 
*   **Library -> Custom JS:** If Cotrans uses a heavy library function that is either missing in our WASM builds (e.g., `cv2.findNonZero`) or too bloated to import, and it is easy to implement efficiently in JavaScript, write the custom JS logic from scratch.

# 9. Altering exist code
When making change to exist code or reposition, restructure exist code, keep/migrate the explanation docstring, commnent along with it, only delete the docstrings and comment if we want to clear entire that code block from our codebase (no need anymore, changing with strictly another different logic that those comment/doctrings have no use)
## Workarounds & Upstream Library Mitigations

- **Preserve Existing Workarounds:** Never refactor, simplify, or "clean up" non-standard patterns, weird type casts, or unconventional file handling marked with `WORKAROUND`, `HACK`, or upstream issue links. They exist to bypass library-level bugs.
- **Reuse Established Workarounds:** When writing new code or touching other parts of the project that use the same external library/function, look for and apply our existing workaround patterns instead of trying standard approaches that are known to fail.
- **Documenting New Workarounds:** If you exhaust standard solutions and must implement a non-obvious workaround:
  1. Add an inline comment: `# WORKAROUND: [Explain upstream failure] -> [Why this weird approach works]`.
  2. Briefly document the quirk and affected modules in this file so future turns follow the same pattern without re-debugging.

### Vite 8 + CRXJS 2.7.1 Build Configuration

- **Do not rename `build.rollupOptions` to `build.rolldownOptions` in `vite.config.ts` yet.** Vite 8 accepts and internally aliases the deprecated key, but `@crxjs/vite-plugin` 2.7.1 reads the raw `build.rollupOptions` key to discover extra HTML entry points. Using only `rolldownOptions` omits `src/offscreen/offscreen.html` and `index.html` from CRXJS dev dependency discovery. Vite can then re-optimize dependencies while Chrome is registering the MV3 service worker, return `504 Outdated Optimize Dep`, and make Chrome fail registration with status code 3.
- **Keep explicit `optimizeDeps.entries` for every Kites runtime entry:** `popup.html`, `index.html`, `src/offscreen/offscreen.html`, `src/content/index.tsx`, and `src/background/index.ts`. These entries force cold-start dependency discovery before the extension requests modules.
- **Keep Node/native packages in both `optimizeDeps.exclude` and `build.rollupOptions.external`:** `ppu-paddle-ocr`, `ppu-paddle-ocr/node`, `@napi-rs/canvas`, `@napi-rs/canvas-darwin-arm64`, `canvas`, and `onnxruntime-node`. Without these exclusions Rolldown may try to parse native `.node` binaries as UTF-8 and bundle the desktop/OpenCV fallback into the browser extension.
- **Keep `build.minify` mode-aware.** `minify: mode === 'production'` leaves dev output readable while production dead-code elimination removes blocks guarded by `import.meta.env.DEV`, including performance timing and diagnostic logs.
- **Upstream status:** A local contribution branch exists at `scratches/reference/chrome-extension-tools`, branch `fix/vite-8-rolldown-options`, commit `28aed46`. Remove Kites compatibility workarounds only after upgrading to a released CRXJS version that supports `build.rolldownOptions`, then verify both `npm run dev` and `npm run build`.

### Chrome Extension Runtime Messaging, Popup State, and WebGPU Invariants

- **Address every offscreen RPC explicitly:** `chrome.runtime.sendMessage()` broadcasts to extension contexts; it is not a point-to-point background/offscreen channel. Popup and dashboard requests must use `target: 'background'`, `source`, and `request: true`. Background must retarget forwarded requests to `target: 'offscreen'` and `source: 'background'`. Offscreen must ignore messages that do not match those markers. Never forward the original unaddressed object or remove the listener guards: competing background/offscreen responders caused `The message port closed before a response was received`, silent model downloads, and dropped processing responses.
- **Normalize popup state at the background boundary:** Persisted `popupState` may come from an older schema and omit GPU fields. Always merge it over `DEFAULT_POPUP_STATE` and deep-merge `webgpuOverrides` before returning it. The popup itself starts from defaults, so returning sparse state lets the UI show GPU ON while offscreen evaluates missing `webgpuMaster === true` as false and silently selects WASM.
- **Serialize complete popup writes:** Keep popup storage updates in one ordered promise chain and persist a complete state snapshot. Do not restore independent read-modify-write calls; rapid master/override updates previously completed out of order, leaving React UI and `chrome.storage.local` inconsistent.
- **Keep model download controls outside disabled row buttons:** An uninstalled local model has a disabled selection row. Its download button must be a sibling, never a descendant, because browsers suppress descendant clicks of disabled native buttons. The old visible download icon never sent `START_MODEL_DOWNLOAD` and produced no error log.
- **Make model downloads acknowledgement-driven:** Await the `START_MODEL_DOWNLOAD` response, show `Queued` immediately, and show a visible failure when routing or registration fails. Do not use fire-and-forget messaging for downloads.
- **Include provider intent in LaMa cache reuse:** `InferenceSession` binds its execution provider during creation. `InpaintManager` must compare the cached LaMa provider with current requested provider and recreate the engine when they differ. A tier-only cache permanently reused a WASM session after GPU was re-enabled.
- **Keep WebGPU probes offscreen and high-performance-only:** Only the offscreen inference context may probe WebGPU. Cache verified `true` only; never persist transient `false`. Keep `powerPreference: 'high-performance'` in both adapter probing and ONNX Runtime configuration because an unqualified adapter previously froze LaMa on an unsuitable low-power/software adapter.
- **Do not misdiagnose heavy WASM as a popup bug:** LaMa WASM can monopolize the extension renderer/process for roughly 20–30 seconds and make the popup appear frozen. First inspect `Provider decision`, session-creation fallback, and runtime-fallback logs. Preserve the explicit one-way WebGPU-to-WASM recovery unless the product policy is deliberately changed.
- **Historical incident and implementation details:** See `docs/devlog/015_phase15_offscreen_webgpu_detection_and_lama_recovery.md` and commits `d41af6b`, `4d51282`, and `a8a3538`.

### SPA & Responsive Image Replacement Strategy (XianScan Reference Pattern)

- **Always wipe `srcset` when updating `src`:** Per the W3C HTML5 specification, when an `<img>` has a non-empty `srcset` attribute, the browser rendering engine prioritizes `srcset` candidates over `src`. Setting `targetImg.src` alone leaves the original image visible on modern responsive sites (Twitter, Reddit, MangaDex). Always backup `data-kites-orig-srcset`, set `targetImg.srcset = ''`, and call `targetImg.removeAttribute('srcset')`.
- **Convert Base64 Data URLs to Same-Origin Blob URLs:** Do not assign multi-megabyte `data:image/png;base64,...` strings directly to `img.src`. Use `URL.createObjectURL(blob)` via `createSafeBlobUrlFromData()`. This prevents DOM memory bloat, avoids strict host-page CSP rejections (e.g. `img-src` omitting `data:`), and revokes cleanly on tab unload.
- **Guard Against SPA Virtual DOM Reconciliation:** In SPAs (React Native for Web on x.com, Reddit, Threads), framework reconciliation compares real DOM against virtual DOM props and reverts manual DOM mutations on hover, scroll, or re-render. Attach a targeted `MutationObserver` (`attachReversionShield`) that intercepts `src` and `srcset` resets, immediately restoring `data-kites-applied-src`.
- **Use `isSelfMutating` Flags:** When performing programmatic DOM updates (`src`, `srcset`, lazy attributes), wrap them in `runSelfMutation(() => { ... })` with an `isSelfMutating` flag. This prevents internal content-script observers from catching their own mutations and triggering infinite loops.
- **Normalize CDN Base URLs for Element Lookup:** CDNs dynamically swap image resolution query parameters (e.g. `name=medium` -> `name=large`). Never rely solely on exact string equality (`img.src === originalUrl`). Use `getNormalizedBaseUrl()` to match base paths as a resilient fallback.