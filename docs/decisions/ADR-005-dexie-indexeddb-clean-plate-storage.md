# ADR-005: Dexie IndexedDB Clean Plate Storage Architecture

## Status
Accepted

## Context
When an image completes the translation pipeline, the result needs to be stored locally so users can:
1. View their translation history.
2. Open projects in Kites Studio for manual post-editing and proofreading.
3. Export high-resolution copies.

Traditional translation tools bake translated text directly onto the saved bitmap. If the user notices a typo, wants to change the font family, or needs to resize an overflowing dialogue balloon, they cannot do so without re-running the entire OCR and inpainting pipeline from scratch.

## Decision
Adopt a **Clean Plate Storage Architecture** backed by **Dexie.js over IndexedDB**:

1. **Storage Separation:**
   - `images` table stores `rawImageBlob` (the original comic page) and `translatedImageBlob` (the **clean inpainted background plate** with original characters removed, but NO new text drawn).
   - `textBlocks` table stores structured dialogue records linked via `imageId`:
     - Bounding coordinates (`posX`, `posY`, `width`, `height`)
     - Source text (`originalText`) and translated text (`translatedText`)
     - Lettering styles (`fontSize`, `fontFamily`, `color`, `strokeColor`, `lines`)
2. **Ephemeral Web Baking:**
   The baked PNG with text burned into the image is generated in-memory solely to return a Data URL / Blob URL for immediate webpage DOM display. The database never stores the destructively baked bitmap.
3. **Automatic 7-Day TTL Garbage Collection:**
   Image blobs can quickly consume hundreds of megabytes. On extension boot, an orphan-recovery and cleanup routine automatically deletes records older than 7 days (`JOB_RETENTION_DAYS = 7`), while preserving user-favorited projects.

## Consequences
### Positive
- **Non-Destructive Post-Editing:** In Kites Studio, users can drag bounding boxes, edit translations, switch font presets, and modify text colors with instant preview without re-running inpainting or OCR.
- **Zero-Cost Re-rendering:** Changing a font or fixing a spelling mistake re-renders in $< 10\text{ ms}$ on 2D Canvas instead of re-spending GPU time or AI tokens.
- **Controlled Storage Footprint:** 7-day TTL ensures browser storage does not grow indefinitely.

### Trade-offs
- Storing both the original image blob and the clean background blob approximately doubles the storage per job while retained ($~2\text{ MB} \times 2 = 4\text{ MB}$ per page). Mitigated by the 7-day TTL.

## Alternatives Considered
- **Saving Baked PNG Only:** Rejected because it completely prevents typography edits, font swaps, and text adjustments in Studio.
- **Using `chrome.storage.local`:** Rejected because `chrome.storage.local` has severe quota limitations (typically 10MB) and poor serialization performance for large binary Blobs compared to IndexedDB.
