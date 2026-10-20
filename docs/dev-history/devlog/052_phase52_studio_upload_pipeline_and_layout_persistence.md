# Devlog 052: Studio Page Upload Routing and Renderer Layout Persistence

## 1. Metadata

- **Date:** 2026-10-19
- **Issue:** #25
- **Branch:** `fix/issue-25-studio-upload-typesetting`
- **Status:** Implemented; unit tests, production build, and isolated upload-panel visual check passed. Real-extension, real-model upload verification remains outstanding.

## 2. Report and Evidence

Issue #25 reports two upload experiences. The Library & Pages upload produces translated text that overflows its speech bubbles in Studio. The reported screenshot shows Chinese dialogue stacked vertically, including very large characters across panel boundaries. The seventh editor tool shows an upload control but does not create a translation job.

All three attached screenshots were inspected. The seventh-tool screenshot explicitly shows **Stickers & Image Layers** and **Upload Sticker Image**. That control creates an editable image layer; it was not a page-import entry point and intentionally did not run OCR or create a translation job.

## 3. Root Causes

### 3.1 Typesetting ran, but its final layout was not restored

The Library upload already dispatched `PROCESS_JOB` to the existing offscreen `PipelineOrchestrator`. That path performed OCR, translation, optional inpainting, typesetting, and rendering. Adding another typesetting call after upload would have duplicated work rather than repaired the failure.

The database persistence boundary saved the renderer's final font size and lines, but used an earlier OCR box or proposed bubble box for the editable geometry. The default renderer can expand and decollide destination quads; those final destinations were not used when saving Studio blocks. The legacy CJK path did not return destination geometry and persisted the source OCR direction even though its draw loop paints horizontal rows. Studio interpreted a vertical source direction as a request to stack Chinese characters vertically. The resulting combination of mismatched geometry, direction, and fitted font size caused the visible overflow.

The Studio paint helper could also discard valid fitted lines because it applied a second width inset. The persisted line spacing was missing, so Studio substituted its own default.

### 3.2 Page import and sticker import had different purposes

The seventh tool only supported sticker layers. Converting that existing action into translation would break users who intentionally import overlays. A separate page action is needed, sharing the Library upload implementation.

The existing Library implementation also bypassed the serialized background queue by forwarding `PROCESS_JOB` directly. Website jobs and uploads could therefore compete for the offscreen runtime.

## 4. Implementation

### 4.1 Renderer-owned layout output

`RenderedBlockInfo` now returns final destination corners, actual drawn direction, actual rotation, exact lines, final font size, and baseline spacing. Both renderer branches return this contract. `DefaultRenderResult` exposes spacing from its existing local line-step calculation and returns the same filtered lines that are drawn; no fitting algorithm is reimplemented.

`getRenderedBlockGeometry` converts the final quad into Studio's centered, unrotated rectangle using the same edge-midpoint dimensions as the renderer. A rotated axis-aligned bounding box would enlarge the rectangle and rotate it again, so it is deliberately not used.

`PipelineOrchestrator` saves these final renderer fields preferentially. Earlier OCR or proposed bubble geometry remains the fallback for blocks without a render result. Fixed bubble layouts persist their actual zero rotation rather than their source OCR angle.

`TextBlock.lineSpacing` is optional for compatibility with existing records. It is not an indexed key, so no IndexedDB schema-version change is required. Studio restores exact measured lines, spacing, geometry, and direction through `restoreTextObject`; saving editor changes retains spacing. Exact explicit layout lines are painted without another greedy wrapping pass. Layout-changing edits now route through the shared Studio typesetting update path described in section 4.3; the renderer does not wrap text.

### 4.2 One page-upload entry point

`uploadStudioPage` atomically creates a queued job and its raw image in IndexedDB. Only after the transaction commits does it send an addressed `ENQUEUE_STUDIO_JOB` request. Background validates the saved job and image, then wakes the existing serialized queue. It does not start a separate pipeline. A job already claimed by another queue wake-up is acknowledged without duplicate dispatch.

The Library control and the seventh tool's new **Upload & translate page** control call the same App handler and service. The existing **Upload Sticker Image** control remains separate and unchanged in purpose. Upload acknowledgement failures retain the image and mark the job errored, with visible feedback. Inputs reset after selection so the same file can be uploaded again.

Studio now clears text when the selected page has no blocks. Memoized block restoration avoids resetting live edits on unrelated App renders, and generation checks prevent stale database/image callbacks from replacing a newer selection.

### 4.3 Follow-up: One Studio Layout Owner and Deferred Editing Modes

Review of the first PR patch exposed an incomplete fix: `TextRenderer.wrapTextLines` still owned a second greedy layout algorithm, and an exact-text early return merely bypassed its width check. That shortcut could preserve stale lines after font changes. A call-site audit also found manual OCR, full-page Studio retranslation, manual creation, sidebar typography changes, and Find & Replace relying on paint-time wrapping instead of consistently preparing layout.

The shortcut and the renderer's greedy wrapping method are now removed. `TextRenderer` paints supplied lines without measuring their widths or refitting them. A raw newline split remains only as a non-layout fallback for direct renderer callers without prepared data.

`prepareInitialTextObject` preserves existing measured lines and font size exactly. When a new or legacy object has no layout, it initializes through Auto Balloon using the existing shared fitter. This initial preparation ignores the editing-mode preference. OCR bridge results, restored blocks, Studio initialization, and manual text creation use this preparation boundary.

`applyTextObjectUpdates` owns edit invalidation. Actual changes to text, dimensions, font metrics, casing, tracking, or metric character overrides invoke the chosen existing engine. Mode-only changes, selection, movement, rotation, and paint-only style updates retain current layout. Character color/stroke changes do not invalidate layout. Font/style changes, resizing, inline/sidebar text edits, paste, clear/revert, and Find & Replace all route through the helper. Measurement and painting share explicit casing; object-level bold, italic, and tracking are included in measurement.

The initial translated page remains the pipeline-fitted result even when Simple Wrap is selected globally. Selecting a box, entering/leaving unchanged text editing, or selecting an engine does not reflow it. The selected engine takes effect on the next actual layout-changing edit. A local `typesetMode` overrides the session-only `globalTypesetMode`; the global action sets current boxes' editing intent and the session fallback for future boxes without a local preference. The session default is not persisted in Chrome storage or document undo history. A saved box's optional editing preference is persisted separately from its measured layout. Paste style retains the destination's editing mode.

The existing fitter still uses uniform object-level metrics rather than full per-character font runs, and assumes its established fixed baseline advance. Metric character-style and line-spacing changes invoke it, but this patch does not invent approximations or extend the fitting algorithm to solve those existing limitations.

## 5. Verification

- `npm test`: **84 suites, 864 tests passed** using Node 22.14.0, including the follow-up layout-ownership regressions.
- `npm run build`: passed, including TypeScript project builds and production bundling.
- `npm run lint`: zero errors; 62 existing warnings across the source tree.
- `git diff --check`: passed.
- Regression coverage includes transaction rollback, invalid files, failed/malformed queue acknowledgement, shared-queue serialization, duplicate-claim acknowledgement, final expanded and collision-adjusted geometry, fixed angle zero, CJK horizontal output, spacing, skipped-block fallback, and exact Studio line restoration.
- An isolated browser preview of the real `ImageLayerSettings` component confirmed that sticker and translated-page actions are separately labeled and fit the panel without clipping.
- A second browser preview using real `TypographySettings`, `studioTypeset`, and `TextRenderer` confirmed that an initial balloon layout remains unchanged with global Simple Wrap, engine buttons alone retain lines and font size, and a subsequent width change invokes Simple Wrap while retaining its fixed font size. The mode explanation was visually inspected. This preview did not run extension inference.
- Real-model translation through a loaded Chrome extension was not run. The available controlled browser supports only an in-app web preview, not extension loading or file-chooser uploads. The isolated visual check is not an end-to-end upload verification.

## 6. Compatibility and Remaining Boundaries

Previously saved records cannot recover missing final geometry or direction without rerunning translation; the fix applies when a job is processed again. No destructive migration changes old records.

This change does not replace the legacy CJK renderer, alter its existing rotation-unit behavior, implement general perspective editing, or repair unrelated italic/alignment parity differences. Studio's rectangle-plus-angle model still cannot represent every skewed destination quad exactly. Existing global sticker-layer and undo-history lifecycle behavior is also outside this fix.
