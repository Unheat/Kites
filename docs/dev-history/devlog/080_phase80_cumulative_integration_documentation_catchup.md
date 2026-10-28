# Devlog 080: Phase 80 — Cumulative Integration Documentation Catch-up

## 1. Metadata and Scope

- **Date:** 2026-10-28
- **Task:** Audit and document the non-font, non-typesetting integration changes accumulated in `origin/main..main`.
- **Audited endpoints:** `origin/main` = `8fa211b60a303543e79f36710693c95b5cda718d`; `main` = `656d7206e002be2db62998c2d0a3c9a2edc47db1`.
- **Primary commits:** `03f8ff1`, `c7c5601`, `3e6b0aa`, `a99f1b2`, `63a951d`, and `371dd33`.
- **Status:** Documentation catch-up completed; focused existing regression suites rerun. This entry does not implement or repair code.
- **Method:** Reviewed Git history and selected commit patches, refreshed codebase-memory project `Kites`, and checked current implementations through precise symbol snippets and call tracing. Some TSX files are partially indexed, so graph caller counts are not completeness guarantees.
- **Documentation boundary:** `docs/architecture/storage-and-projects.md` does not exist in this checkout. No parallel architecture document was created. Existing documentation and unrelated working-tree edits were left untouched.

The six commits cross storage ownership, translation parsing, export boundaries, inference lifecycle, and Studio editing. Their behavior should not be inferred from nearby font or layout commits. Font catalogs, fitting algorithms, contour math, and visual-parity claims are outside this entry. Bubble-mode compatibility is included only because it changes persisted settings and runtime routing. The bitmap-lifecycle fix in `ecba94a` is noted as an adjacent integration change, not as a new layout specification.

## 2. Objective

Make the cumulative integration contract discoverable without presenting old test totals or historical visual results as fresh verification. Existing devlogs already explain the original retention, glossary, upload, project/export, colorization, and page-info features. This entry records the later fixes, identifies what those earlier entries do and do not cover, and distinguishes implementation intent from measured evidence.

## 3. Audited Behavior and Decisions

### 3.1 Project membership protects pages from history retention — `03f8ff1`

**Code pointers**

- `src/db.ts`: `TranslationJob.folderId`, `cleanupOldJobs`, and the existing `deleteJobs` cascade.
- `src/App.tsx`: `handlePageUpload`.
- `src/shared/studioUpload.ts`: `UploadBatchOptions`, `uploadStudioPagesBatch`, and `uploadSinglePage`.
- Regression files: `src/db.test.ts`, `src/shared/studioUpload.test.ts`.

**Behavior**

`cleanupOldJobs` selects expired jobs only when `folderId === undefined` and status is absent, `completed`, or `error`. A page with project membership is therefore excluded even when its timestamp exceeds the selected retention window. Active statuses remain protected, retention `never` still skips cleanup, and invalid settings or failed settings reads still preserve data. Eligibility selection and cascade deletion remain inside the existing write transaction spanning jobs, images, and text blocks.

`App.handlePageUpload` forwards the current project identity as `{ folderId: currentProjectId }`; `projectId` is the UI concept, while `folderId` is the stored field. Batch upload reads the existing member count and assigns `projectOrder = existingMembers.length + fileIndex`. Each page's job and raw image are committed together before its addressed queue request. Uploading outside a project leaves membership and order undefined. The batch is sequential, not one transaction covering all pages; partial success remains represented by `BatchUploadError.queuedJobIds`.

**Reason**

A saved project is deliberate user-owned work, not disposable history. Protecting only active jobs was insufficient: completed project pages could previously age out. Forwarding membership at creation closes the gap between selecting a project and subsequently retaining/exporting its pages.

**Limits**

- This changes automatic history cleanup, not explicit deletion or browser storage eviction.
- Protection checks the stored field, not whether the referenced folder still exists. Orphaned membership is not repaired here.
- Member count is not the maximum existing order plus one. Deleted pages, sparse orders, or simultaneous imports from different contexts can produce duplicate orders. The added test checks an empty project's sequential order, not those cases.
- Existing unassigned pages are not retroactively attached to projects.

### 3.2 Translation fallback termination, numeric text, and glossary boundaries — `c7c5601`

**Code pointers**

- `src/offscreen/engines/translation/BaseLlmTranslationEngine.ts`: `parseKeyedOutput`, `parseDelimitedOutput`, `cleanTranslatedLine`.
- `src/shared/glossary.ts`: `compileGlossaryMatchers`, unspaced-script and boundary expressions.
- `src/shared/utils/casingNormalization.ts`: language set, protected acronyms, bicameral-script expression.
- Corresponding `.test.ts` files in those directories.

**Behavior and reason**

1. Keyed parsing may fall back to delimited parsing with `fromKeyed = true`. Delimited parsing delegates JSON-looking input back to keyed parsing only when that flag is false. This terminates the former mutual-recursion path for responses without usable slot data. The regression supplies a JSON error object and verifies original-source results instead of a stack overflow. Slot-key assembly and existing translation acceptance/fallback policy remain in place; this is not a general guarantee that arbitrary JSON is a usable translation.
2. `cleanTranslatedLine` strips a numeric dot/colon prefix only when the punctuation is followed by whitespace. Its two cleanup passes retain `2:30 PM`, `3.14`, `1.5 hours`, and `1:0 victory`, while explicit tag debris and spaced numbered-list markers remain removable.
3. Glossary terms containing Han, Hiragana, Katakana, Hangul, Thai, Lao, Khmer, or Myanmar characters use case-insensitive substring matching. Alphabetic terms use escaped Unicode boundary expressions that also accept those scripts as neighbors. Thus `Bobの車` and `HPを回復する` match their Latin terms, while `Bobby` does not match `Bob`. This filters relevant prompt entries; it is not an unrestricted output-replacement rule.
4. Casing support adds Azerbaijani, Welsh, Swahili, and Armenian language codes, recognizes Armenian bicameral letters, and protects Roman numeral tokens `I`, `V`, and `X` alongside the existing set. Tests specifically cover sentence-case preservation of `V` and `X`.

**Limits**

The numeric fix is at the line-cleanup helper, not every parser expression. The primary legacy `parseDelimitedOutput` tag regex still accepts digits followed by dot/colon without requiring whitespace. Untagged numeric-leading legacy responses can therefore still be mistaken for list tags. Helper tests establish the listed cleanup examples, not universal timestamp preservation across every protocol. Spaced prefixes such as `1: text` remain inherently ambiguous under numbered-list cleanup.

### 3.3 Explicit PSD text bounds and invalidation — `3e6b0aa`

**Code pointers**

- `src/studio/export/psdExport.ts`: `buildPsdDocument`, `exportCanvasToPsdBlob`, `exportPageToPsdBlob`.
- `src/studio/export/psdExport.test.ts`.

Text layers now include explicit `right` and `bottom` coordinates, calculated from position plus the clamped, rounded block dimensions, alongside existing `left`, `top`, and text `boxBounds`. Serialization calls `writePsd(psd, { invalidateTextLayers: true })` so editable text is marked for regeneration by a compatible editor rather than treated as a complete cached text rendering.

The document retains separate original scan, optional cleaned background, visible image-overlay, and editable text layers. Empty, hidden, or skipped text is omitted. The change repairs layer metadata; it does not rasterize a Studio-equivalent text preview or implement richer text styles.

**Limits:** Existing tests check PSD signatures, non-empty binary output, Blob creation, and representative layer inputs. They do not deserialize and assert the new bounds/invalidation fields, open the result in an external editor, or verify font availability, text regeneration, style fidelity, or visual parity. A text-engine regeneration requirement is not a guarantee that all PSD readers will display an identical initial preview.

### 3.4 Color fusion, inference isolation, fallback state, and export loading — `a99f1b2`

**Code pointers**

- `src/offscreen/engines/color/colorSpace.ts`: `SRGB_TO_LINEAR_LUT`, `toSrgbFast`, `fuseLightnessChannel`.
- `src/offscreen/services/ColorManager.ts` and `InpaintManager.ts`: `serializeInference`, engine leases, `colorize`/`inpaint`.
- `src/offscreen/engines/color/OnnxColorRuntime.ts`, `src/offscreen/engines/inpaint/OnnxInpaintRuntime.ts`, and `LamaBaseInpaintEngine.ts`: provider validation, fallback, destruction.
- `src/offscreen/engines/inpaint/LamaMangaInpaintEngine.ts`: patch scratch buffers and tensor lifetime.
- `src/shared/utils/download.ts`: `triggerBrowserDownload`.
- `src/studio/export/batchExport.ts`, `src/studio/projects/PageRail.tsx`, `ProjectsDashboard.tsx`, and `src/studio/Studio.tsx`: export import boundaries.

**Color conversion**

The 256-entry float lookup table replaces repeated byte-to-linear sRGB conversion in the fusion loop. Fusion derives the original image's L* and the model output's a*/b*, then performs the inverse conversion inline without allocating per-pixel tuple results. It mutates the colorized RGB buffer and copies alpha from the original buffer. These are allocation/arithmetic changes plus an explicit alpha behavior change; they are not evidence of a measured speedup or byte-identical output across all colors. Equal-sized pixel buffers remain a caller precondition.

The color tests check representative RGB/Lab round trips, LUT length/endpoints, and a four-pixel fusion fixture with alpha. They also demonstrate why this should not be called perfect ink preservation: a black source pixel with saturated model chrominance becomes `[79, 0, 0]` in that fixture after conversion/clipping. The mechanism preserves source lightness as an intermediate value, not every original RGB pixel or an unconditional final-gamut lightness invariant.

**Inference and provider lifecycle**

Each manager has its own inference promise queue. Operations wait for the previous queue entry and release the next waiter in `finally`, including failure paths. Existing engine leases are held through queued inference and released afterward; lifecycle changes still use their separate serialization/drain machinery. The intent is to prevent overlapping work through a shared manager/engine session. This is not one global lock across color, inpaint, OCR, or separate manager instances.

After a WebGPU failure triggers WASM fallback, the runtimes retain `forcedProvider = 'wasm'`. `isProviderCurrent` compares against that forced provider rather than repeatedly treating the session as stale because the requested preference is still WebGPU. Destruction clears the forced state, allowing a future engine lifetime to reconsider providers. Fallback session-release failures are logged without preventing the WASM attempt; generic inpaint destruction also tolerates release errors. The LaMa patch path continues to retry a failed GPU patch through its existing one-way fallback behavior.

LaMa manga patch processing reuses image/mask typed arrays when successive patches have the same pixel count. Scratch canvases grow as required. The output tensor's data is converted into ImageData before tensor disposal rather than first copying it into another Float32Array. Resource cleanup remains in `finally`. This does not change the localized, bucketed patch architecture or establish a memory/latency benchmark.

**Export loading**

Page rail and project dashboard now dynamically import `batchExport` when export is invoked instead of statically importing its runtime. Type-only imports retain the format contract without eagerly loading implementation. The small browser download helper moved into `src/shared/utils/download.ts`; `batchExport` re-exports it for compatibility, while Studio PSD export imports the helper directly rather than pulling in batch export solely to download a file.

Inside `exportProjectBundle`, JSZip and the PSD module remain dynamically loaded together. Thus an image/CBZ archive invocation still loads the PSD module too; this is import-boundary decoupling, not format-selective elimination of every unused dependency. No current bundle-size or timing measurement was taken for this entry.

### 3.5 Studio color and page-info checkpoint — `63a951d`

**Code pointers**

- `src/studio/tools/ColorSettings.tsx`, `StudioEngineSelector.tsx`, `PageInfoSettings.tsx`.
- `src/studio/state/studioStore.ts`, `undoStack.ts`, `src/studio/types.ts`.
- `src/studio/Studio.tsx`: `handleColorizePage`, `handleSaveImage`, undo/redo handlers, color-status hydration.
- `src/studio/bridge/offscreenStudioBridge.ts`: `requestStudioColorize`.
- `src/shared/types.ts`: `StudioColorizePayload` and message type; `src/background/index.ts`: addressed forwarding; `src/offscreen/index.ts`: `handleStudioColorize`.

**Workflow and reason**

Studio gains a color tool, color-tier selection derived from `COLOR_TIER_CATALOG`, model-readiness feedback, and a colorization action. `selectedColorEngineId` is session state that hydrates from popup state and, when global synchronization is enabled, persists changes through `activeColorId`. The tool is permitted in original, inpainted, and translated view modes.

The bridge encodes the working raster as PNG and sends an addressed `STUDIO_COLORIZE` request through background to offscreen. The offscreen handler resolves the tier and popup GPU preference, rejects an uncached non-builtin model, calls the existing color manager, and returns a PNG data URL. The manual action sends the working raster without dialogue polygons; do not assume it has the same bubble shielding inputs as the automatic pipeline.

On success, Studio paints the returned raster, records full-page before/after raster patches and a boolean color-state transition in the undo stack, then updates the job's `colorTier`. Undo/redo applies both raster and color-state snapshots. New undo-stack subscribers receive current availability immediately and can unsubscribe. Page changes clear undo history. Save retains the clean-plate contract: raster artwork is saved separately from structured text, then color metadata is synchronized. Page Info adds a catalog-derived Colorization Engine label, treating missing/`none` as disabled and unknown IDs as their raw value.

The checkpoint also replaces five popup integration-card `Edit` labels with decorative pencil icons; tests retain the cards' accessible actions. It registers heuristic/YOLO visual-runner commands and carries reconstructed heuristic mask evidence. Those adjacent diagnostic/mask changes are not proof of visual acceptance and are not a second specification of the layout subsystem.

**Limits and follow-up risks observed in current code**

- Colorization updates `colorTier` before an explicit raster save. Undo/redo changes the local color flag; metadata is reconciled on Save, not on every undo transition. Page Info can therefore describe a different state from unsaved artwork.
- Re-colorization currently records `colorState.before = false` even if the page was already colorized. Undo can restore a colored raster while marking it uncolored. This entry records the limitation, not a repair.
- Selecting `none` is considered model-ready by the panel, but the manual offscreen handler treats `none` as a request to resolve a popup/default tier. This differs from `ColorManager.colorize(..., 'none')`, which is a no-op. The action is not an enforced disabled-tier no-op end to end.
- Page-info tests reproduce label-resolution logic in the test rather than mounting the inspector. Store/undo tests do not establish whole-component async behavior, persistence atomicity, or real-model success.

### 3.6 Page-switch guards and dead bubble-option removal — `371dd33`

**Code pointers**

- `src/studio/Studio.tsx`: `jobIdRef`, `handleColorizePage`, `handleRetranslatePage`.
- `src/background/index.ts`: `normalizePopupState`.
- `src/shared/types.ts`: `BubbleDetectionMode`.
- `src/offscreen/engines/bubble/BaseBubbleEngine.ts`, `NeuralBubbleEngine.ts`, `src/offscreen/services/BubbleManager.ts`.
- Routing consumers in `PipelineOrchestrator.ts`, `StudioOcr.ts`, `BubbleLayoutService.ts`, and popup engine selection.

After awaited full-page colorization or retranslation returns, Studio compares the initiating `jobId` with the latest page identity stored in a ref. A mismatch discards the result before painting, pushing undo, replacing text objects, or beginning result persistence. This closes the ordinary case where page A's long-running inference returns while page B is selected. It does not cancel the inference itself.

`BubbleDetectionMode` now exposes only `off`, `heuristic`, and `neural`. Stored legacy `neural-mask` normalizes to `neural` at the background boundary; other invalid values normalize to `off`. The unused box/mask option and dual-neural reuse branch were removed. This removes a redundant configuration route, not neural mask extraction: the current neural engine still consumes proto masks and returns shape evidence when text boxes are supplied.

**Limits**

- Guards compare page IDs, not monotonically increasing operation generations. A switch A–B–A before completion can pass the identity check; equal or undefined identities are not distinguished by a request token.
- The independent `db.translationJobs.get(jobId)` color-status hydration callback has no stale-result check. Save callbacks, delayed toast callbacks, error/finally UI state, and later database awaits are not covered by the single post-inference check.
- `371dd33` adds no dedicated deferred-promise page-switch regression test or legacy-mode migration test. Existing normalization tests passing is not evidence that the new migration case is explicitly asserted.

### 3.7 Adjacent bitmap lifecycle integration — `ecba94a`

`src/offscreen/services/PipelineOrchestrator.ts` captures page width and height before closing the decoded bitmap, then uses the saved dimensions for subsequent canvas/layout handoffs. Reading dimensions from a closed bitmap is not a reliable lifecycle contract. This is a resource-lifetime correction; no new geometry algorithm or visual result is claimed here.

## 4. Coverage Mapping: Existing Record Versus This Catch-up

- **Devlog 027 — retention:** Already covers selectable TTL, fail-closed settings reads, active-job exclusion, and transactional cascade deletion. **New here:** project-membership exemption and its ownership/ordering limits from `03f8ff1`.
- **Devlog 052 — Studio uploads:** Already covers atomic page creation, addressed queue acknowledgement, partial/error handling foundations, and the shared upload route. **New here:** forwarding current project membership and assigning batch page order.
- **Devlog 029 — glossary; Devlogs 058 and 059 — casing and translation protocol foundations:** Already explain glossary plumbing, casing policy, and LLM protocol work. **New here:** the recursion guard, precise numeric-cleanup boundary, adjacent-script glossary matching, and casing additions in `c7c5601`. Earlier feature descriptions are not regression coverage for these later fixes.
- **Devlog 064 — project/PSD integration:** Already records project management, layered export, lazy loading of JSZip/PSD dependencies, and earlier blob-lifetime fixes. **New here:** text-layer extents/invalidation in `3e6b0aa`, lazy batch-entry imports and shared download-helper extraction in `a99f1b2`. Historical chunk sizes from 064 are not repeated as measurements of current code.
- **Devlog 066 — colorization:** Already covers the color catalog, L* fusion concept, model runtime, leases, and provider fallback foundations. **New here:** LUT/inline conversion, original-alpha copying, forced-provider cache state, per-manager inference queues, and patch-buffer reuse. This entry deliberately does not adopt unconditional pixel-fidelity claims from the older narrative.
- **Devlog 045 — Page Info and retranslation metadata:** Already covers the inspector and persistence foundations. **New here:** color-tier display, Studio color action/bridge, store synchronization, raster/color undo state, and subscriber behavior from `63a951d`.
- **Devlog 077, section 6 — deferred integration items:** Explicitly identifies dead `neural-mask` plumbing and missing colorize/retranslate page-switch guards as deferred. **New here:** `371dd33` implements those two items, with the narrower guarantees and remaining async gaps stated above. The older entry is a historical checkpoint, not the current implementation status. Its separate preview/layout item is outside this audit.
- **Devlogs 069–076 and the layout portions of 077:** Already cover the surrounding layout work. Those algorithms and their historical visual checks are intentionally not duplicated here. The adjacent bitmap-lifecycle correction is identified separately for integration discoverability.

## 5. Verification Performed for This Documentation Audit

Focused existing Vitest suites were executed in two invocations using `npm exec -- vitest run <selected test paths>`:

- **11 files / 157 tests passed:** `src/db.test.ts`, `src/shared/studioUpload.test.ts`, `src/offscreen/engines/translation/BaseLlmTranslationEngine.test.ts`, `src/shared/glossary.test.ts`, `src/shared/utils/casingNormalization.test.ts`, `src/offscreen/engines/color/colorSpace.test.ts`, `src/studio/Studio.test.ts`, `src/studio/tools/ColorSettings.test.tsx`, `src/studio/tools/PageInfoSettings.test.tsx`, `src/popup/components/SettingsView.test.tsx`, and `src/studio/bridge/offscreenStudioBridge.test.ts`.
- **4 files / 37 tests passed:** `src/studio/export/psdExport.test.ts`, `src/offscreen/services/InpaintManager.test.ts`, `src/offscreen/engines/inpaint/LamaBaseInpaintEngine.test.ts`, and `src/background/normalizePopupState.test.ts`.
- **Combined:** 15 files, 194 tests passed. Expected negative-path logs were emitted. Popup tests also logged missing model-status/IndexedDB facilities in their mocked environment; the suites still passed. Vite/extension development warnings were emitted during setup.

These runs establish that the selected current suites pass, not that every behavior above has a dedicated assertion. In particular, direct manager-inference serialization and rejection recovery, color/generic-inpaint forced-provider caching, full Studio color RPC round trips, page-switch races, PSD field round trips, and concurrent project-order assignment remain incompletely covered by the selected tests. The existing LaMa fallback suite exercises one-way fallback/retry; the manager suite primarily exercises initialization, reuse, leases, provider invalidation, and destruction.

No new tests or source code were added. No full-suite run, production build, bundle analysis, GPU stress test, real-model browser run, external-editor PSD check, visual-parity comparison, or performance benchmark was performed for this entry. Prior devlog test counts and visual results remain historical evidence only.

## 6. Key Takeaways and Next Checks

1. Project ownership must be attached when jobs are created; retention cannot infer it later. A future ordering fix should use an explicit allocation policy that handles deletions and cross-context imports.
2. Parser termination and helper cleanup are separate contracts. Add end-to-end legacy numeric-leading response cases before describing all timestamps/digits as protected.
3. Serialize shared-session inference independently from lifecycle mutation, but do not describe per-manager queues as universal GPU scheduling.
4. Treat color metadata, raster save, and undo state as distinct persistence boundaries. Follow-up tests should cover re-colorize undo, disabled-tier actions, and stale hydration callbacks.
5. Use operation generations for stronger async isolation if A–B–A navigation, cancellation, or save completion must be guarded. The present ID checks are a targeted improvement, not a complete race-proofing claim.
6. Validate PSD bounds and text-engine behavior through round-trip assertions and a compatible editor before making display-fidelity claims. Keep this follow-up separate from font/layout work.
