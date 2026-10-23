# Devlog 055: Studio Save Clean Plate & State Preservation

### 1. Metadata
* **Date:** 2026-10-23
* **Feature/Task:** Fix Studio "Save to DB" baking text into background plate and unmounting editor
* **Status:** Completed

### 2. The Objective
When clicking "Save to DB" in Studio, the text was mistakenly baked into the saved image raster instead of being saved as structured text records in IndexedDB. This caused double text (immutable burned text on background + draggable interactive text box on top) and unmounted the Studio editor during save. The goal is to enforce ADR-005 (Clean Plate Storage Architecture) so that "Save to DB" saves only the clean background raster to `translatedImageBlob` and keeps text in `db.textBlocks`, preserving seamless editor interactivity.

### 3. Current Workflow & Implementation Steps
1. **Root Cause Analysis:**
   - In `src/studio/Studio.tsx`, `handleSaveImage` called `renderFullCompositeCanvas(..., textObjects)`. In `translated` viewMode, this permanently baked dialogue text into the export canvas.
   - The resulting flattened PNG blob was sent to `onSave`, overwriting `db.images.translatedImageBlob`.
   - `src/App.tsx` then called `loadJobDetails(activeJobId)`, which temporarily reset `originalImageEl` and `cleanedImageEl` to `null` (unmounting `<Studio />`), before loading the now text-burned image as `cleanedImage`.
   - `StudioCanvas.tsx` drew this burned image onto `bgCanvasRef`, while `overlayCanvasRef` simultaneously rendered interactive text boxes on top, creating duplicated ghost text.
2. **Studio Clean Plate Export:**
   - Updated `src/studio/Studio.tsx` (`handleSaveImage`) to directly convert `bgCanvas` (`#studio-working-background`) to PNG Blob instead of calling `renderFullCompositeCanvas`. `bgCanvas` holds only clean inpaint artwork and manual brush strokes; it never contains text.
   - Added fallback to an offscreen canvas if `bgCanvas` is ever unmounted.
3. **App State Synchronization Without Unmount:**
   - Updated `src/App.tsx` (`handleSaveToDb`) to update Dexie tables (`db.images` and `db.textBlocks`) and update `imageRecord` state in-place without calling `loadJobDetails(activeJobId)`.
   - This eliminates the UI flicker, unmount, and loss of focus/selection/undo history upon clicking "Save to DB".
4. **Documentation & Unit Testing:**
   - Clarified `src/studio/canvas/compositeExport.ts` docstring: composite rendering is strictly for export/clipboard, not database persistence.
   - Added a unit test in `src/studio/canvas/compositeExport.test.ts` verifying that background canvas persistence preserves clean plate semantics.

### 4. Roadblocks & Decisions
* **Decision: Preserve Editor Memory State:**
  - Calling `loadJobDetails` on save was redundant and destructive because Studio already holds the canonical live state in `studioStore` and on canvas. Updating Dexie in the background and keeping Studio mounted matches standard editors (Canva, Photoshop, CapCut).

### 5. Next Steps / Key Takeaways
* All 84 test suites (870 tests) pass and production build succeeds.
* Users can now edit text, adjust typography, move bubbles, and click "Save to DB" without burning text into the artwork.
