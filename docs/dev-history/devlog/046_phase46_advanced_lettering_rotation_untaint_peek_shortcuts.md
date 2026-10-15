# Devlog 046: High-ROI Advanced Lettering & Workflow Capabilities (Rotation Math, Canvas Untaint, Dual-Action Peek, Repeat Crop, and Style Clipboard)

### 1. Metadata
* **Date:** 2026-10-15
* **Feature/Task:** Implement high-ROI scanlation lettering and reader capabilities into Kites without architectural bloat (features 1 to 7)
* **Ticket/Issue:** N/A (Solo Architectural Milestone)
* **Status:** Completed

---

### 2. The Objective (The "Why")
Commercial web extension donor patterns v2.22.6 introduced several usability improvements across web extensions and manga editing. While legacy commercial tools implemented these features in a single 26,789-line monolithic `content.js`, Kites requires modular, maintainable, single-responsibility components with strict test coverage and zero regression on existing local WebGPU pipelines.

The goal was to implement:
1. Pure local-coordinate projection math for rotating and resizing dialogue boxes in Studio.
2. Direct on-canvas font-size scaling and horizontal text wrap handles.
3. Quick copy and paste for complete typography styling (with automatic line re-typesetting).
4. A universal canvas untaint engine (`world: "MAIN"`) coupled with dynamic `declarativeNetRequest` anti-hotlinking session rules.
5. Dual-action shortcut behavior (`Alt+Shift+Z` / `KeyZ`) and hold-to-peek original artwork.
6. Repeat previous screen crop (`Alt+Shift+C`) with persistent session geometry.
7. "Skipped, Not Deleted" preservation for filtered bubble text blocks.
8. Updating all shortcut help panels in both Popup and Studio so users discover these features immediately.

---

### 3. Current Workflow & Implementation Steps (The "How")

1. **Local-Space Rotated Bounds Calculation (`src/studio/canvas/transformMath.ts`)**:
   * Created pure trigonometric transformation utilities that project mouse deltas into the object's local rotated coordinate frame using inverse rotation (`cos`, `sin`).
   * Recalculates dimensions and projects local center shifts back into world space, anchoring the opposite edge/corner regardless of angle.
   * Built dynamic cursor resolution (`getHandleCursor`) that rotates cardinal resize cursors according to the object's angle.
   * Added 11 unit tests in `src/studio/canvas/transformMath.test.ts`.

2. **Direct Canvas Font-Size & Wrap Handles (`src/studio/canvas/CanvasFurniture.ts` & `StudioCanvas.tsx`)**:
   * Extended `TransformHandle` with `'font-size'` and `'wrap'`.
   * Added an auxiliary top-right `'A'` handle for direct font size scaling on canvas, and a right-edge `'↔'` handle for adjusting text wrap boundaries with font size locked.
   * Updated `StudioCanvas.tsx` to handle pointer hover with dynamic handle cursors.

3. **Complete Typography Style Clipboard (`src/studio/state/studioStore.ts` & `TypographySettings.tsx`)**:
   * Created `extractTypographyStyle(obj: TextObject)` capturing all typography parameters (font, size, colors, stroke, gradients, drop shadows, casing, line/letter spacing).
   * Added "Copy Style" and "Paste Style" buttons in `TypographySettings.tsx` with 2-second visual feedback.
   * Bound `Ctrl+Alt+C` and `Ctrl+Alt+V` in `StudioCanvas.tsx`.
   * Automatically invokes `recalculateBlockTypeset` upon pasting to re-wrap text lines if font family or size changes.

4. **Universal Canvas Untaint Engine & Dynamic CORS (`src/content/untaint.ts` & `src/background/index.ts`)**:
   * Implemented `src/content/untaint.ts` running in `world: "MAIN"` at `document_start`. It intercepts `CanvasRenderingContext2D.prototype.drawImage` to swap cross-origin tainted images for anonymous copies, avoiding `SecurityError` when exporting canvases.
   * Added `"declarativeNetRequestWithHostAccess"` to `manifest.json`.
   * Added `fetchImageWithReferer` in `src/background/index.ts` to dynamically register session rules injecting `Referer` and `Origin` headers before fetching anti-hotlinking CDN images.
   * Added HTML5 `<canvas>` support to `src/content/mediaTargets.ts`.

5. **Dual-Action Shortcut & Hold-to-Peek (`src/content/readingShortcuts.ts` & `index.tsx`)**:
   * Enhanced `KeyZ` and `TRANSLATE_HOVERED_IMAGE`: if the target is untranslated, it queues translation; if already translated, it toggles between original and translated view.
   * Added `handleReadingKeyup` to detect if the user held the toggle key for > 200ms; releasing it immediately reverts back to the translated view (Hold-to-Peek).

6. **Repeat Previous Screen Crop (`src/content/captureArea.ts` & `readingShortcuts.ts`)**:
   * Implemented `saveLastCropSelection` and `loadLastCropSelection` using `sessionStorage`.
   * Bound command `repeat-screen-crop` (`Alt+Shift+C` / `Ctrl+Shift+C`) in `manifest.json` and `background/index.ts`.
   * Dispatches crop capture without opening the interactive snipping backdrop.

7. **"Skipped, Not Deleted" Bubble Filter State (`src/db.ts`, `canvasTypesetting.ts`, `App.tsx`, `TypographySettings.tsx`)**:
   * Added `isSkipped?: boolean` to `TextBlock` and `TextBlockItem`.
   * Updated `canvasTypesetting.ts` so skipped blocks are omitted from the baked output.
   * Rendered subtle dashed grey outlines for skipped text blocks in Studio.
   * Added an "Include Bubble" toggle button in `TypographySettings.tsx`.

8. **Shortcut Reference Panels (`ShortcutsModal.tsx` & `ReadingShortcutsHelp.tsx`)**:
   * Documented all new gestures in both the Studio Shortcuts modal and the Popup Reading Shortcuts card.

---

9. **Fixing Edit Mode Font Snap via Continuous Canvas Rasterization**:
   * Removed `obj.id === editingTextId` skip in `StudioCanvas.tsx` so the active dialogue box is always drawn on canvas with exact vector strokes, antialiasing, and middle baselines.
   * Styled the in-place `<textarea>` as `color: 'transparent'` with `caretColor: '#f4446d'` and no text-shadow hacks, completely eliminating visual jump, font deformation, and snap-back on blur.

10. **Per-Word / Inline Selection Styling (`charStyles`)**:
    * Added `charStyles?: (CharStyleOverride | null)[]` to `TextObject` in `src/studio/types.ts`.
    * Implemented styled run decomposition in `TextRenderer.ts`, decomposing lines into contiguous runs and executing two-pass rendering (Pass 1 strokes, Pass 2 fills) to prevent stroke clipping.
    * Integrated selection tracking (`inlineSelection`) in `StudioCanvas.tsx` and added `[ B ]` / `[ I ]` formatting buttons to the floating action capsule toolbar with `Ctrl+B` / `Ctrl+I` keyboard shortcuts.

11. **Popup Text Rendering Options Overhaul**:
    * Replaced the awkward single-button nested box with clean scanlation typography options:
      - `[ B Bold ]`, `[ I Italic ]`, and `[ Disable Stroke ]` pill toggles (dim neutral border when off, rose glow when on).
      - `Text Alignment`: `[ Auto | Left | Center | Right ]` segmented pills.
      - `Minimum Font Size`: Slider + numeric indicator (`4px` to `20px`).
      - Completely removed the "Open in Studio" promotional footer.

---

### 4. Roadblocks & Decisions

* **Rotated Resize Distortion**: Standard axis-aligned resize logic caused severe warping when dragging handles on a rotated box. Solved by projecting world deltas into local space via inverse matrix rotation, adjusting local width/height, and projecting the center shift back to world space.
* **Edit Mode Font Jitter**: Canvas 2D middle-baseline vector rendering differs from DOM CSS text-shadow approximations. Solved by rendering text exclusively on the canvas while using transparent DOM inputs for keyboard/IME capture.
* **Test Fixture Assumptions**: Existing `readingShortcuts.test.ts` assumed `hasTranslation` always returned `true` for all KeyZ tests. Updated test mocks to verify both branches of the new dual-action behavior.
* **Clean Separation**: Kept all math in `transformMath.ts` and untaint logic in `untaint.ts`, maintaining strict modularity.

---

### 5. Next Steps / Key Takeaways

* All 75 test files (745 tests) passed.
* Production build succeeded in 1.58s with zero errors.
* Next release can consider optional chapter context sharing (LLM memory) or BYOK provider presets.
