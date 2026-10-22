# Devlog 054: Studio OCR Rotation Persistence

## 1. Metadata

- **Date:** 2026-10-21
- **Feature/Task:** Preserve OCR rotation across Studio re-OCR and full-page retranslate
- **Branch:** `fix/studio-ocr-rotation`
- **Status:** Completed & Verified (869 tests passing)

---

## 2. The Objective

A tilted SFX region (`キイイイッ`) rendered with its source rotation in the browser pipeline appeared as an axis-aligned box in Studio. The inpaint mask still showed the rotated polygon, but the editable text object sat upright. The goal is to make Studio's own OCR and retranslate paths preserve the rotation the rest of the pipeline already persists.

The rotated free-renderer path and the fixed zero-angle bubble-layout path are unchanged. Fixed bubble layouts intentionally persist angle 0 (Devlog 052), and `BubbleLayoutService` refuses blocks whose OCR angle is non-zero, so bubble layout was not the cause.

---

## 3. Root Cause Analysis

Studio has two ways of obtaining text blocks:

1. **Persisted browser pipeline blocks** restore through `restoreTextObject`, which maps `block.angle` to `TextObject.rotation`. These already rotate correctly in Studio.
2. **Studio re-OCR and "Retranslate full page"** call `requestStudioOcr` → `runStudioOcr`. That service built each object from the merged polygon's axis-aligned bounding box:

   - `x/y` came from `minX/minY`, `width/height` from `maxX-minX` / `maxY-minY`.
   - The response contract had no rotation field, even though `OcrManager` returns a snapped `angles` array.
   - `offscreenStudioBridge` therefore constructed `TextObject`s without `rotation` (default 0).
   - `Studio.tsx`'s retranslate IndexedDB sync also omitted `angle`, so a reload would lose any rotation again.

The visible result was the AABB of the rotated quad with no angle. For a rotated rectangle, the AABB is also larger than the actual region, so the box did not even match the polygon footprint.

---

## 4. Implementation

### 4.1 `runStudioOcr` returns unrotated geometry plus rotation

`src/offscreen/services/StudioOcr.ts` now:

- Uses the shared `getRenderedBlockGeometry` helper on the merged polygon. It computes the centered rectangle from edge-midpoint distances, exactly like the pipeline renderer's Studio persistence path, instead of the rotated AABB.
- Carries `result.angles[resolvedIndex]` as `rotation`. OcrManager has already applied the Cotrans "mean line angle − 90°, snap below 3°" rule, so Studio does not re-snap.
- Falls back to `calculateRotationAngle(polygon)` only when the engine result has no finite angle, matching the renderer's fallback.
- Keeps `isVertical` independent from rotation: a tilted vertical column now becomes a vertical text object with a non-zero angle.

### 4.2 Bridge and persistence round-trip

- `src/studio/bridge/offscreenStudioBridge.ts` accepts `rotation` in the response and forwards it into the constructed `TextObject`.
- `src/studio/Studio.tsx`'s retranslate sync now persists `angle`, plus the layout fields it previously dropped (`lineSpacing`, `typesetMode`, `isSkipped`), matching App's normal Studio save mapping.

---

## 5. Verification

- `npx vitest run src/offscreen/services/StudioOcr.test.ts src/studio/bridge/offscreenStudioBridge.test.ts`: 44 tests passed.
- Added regression coverage for:
  - Unrotated edge-midpoint geometry instead of the rotated AABB.
  - Rotation sourced from `OcrManager.angles`.
  - Polygon top-edge fallback when `angles` is absent.
  - Vertical reading direction retaining a non-zero rotation.
  - Bridge forwarding rotation into the `TextObject`.
- `npm test`: 84 suites, 869 tests passed.
- `npx tsc -b`: 0 errors.
- `npm run lint`: 0 errors.

---

## 6. Key Takeaway

Studio's rectangle-plus-angle model can represent rotated boxes, but only if every ingestion path supplies the angle. The browser pipeline, Studio restore, and Studio OCR must all agree on the same geometry contract: **centered unrotated rectangle + OCR block angle**, never the polygon AABB.
