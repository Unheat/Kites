# Devlog 026: Phase 26 — Kites Studio V2 Rebuild & Torii 1:1 Feature Port

**Date:** 2026-10-12  
**Branch:** `feat/studio-editor-v2-rebuild`  
**Status:** Completed & Verified  

---

## 1. Context & Motivation

The original Kites Studio (`src/App.tsx`) was created in Phase 11 as a minimal review dashboard. While sufficient for inspecting baked outputs, it lacked core creative manga editing capabilities:
- **No Undo/Redo (`Ctrl+Z` / `Ctrl+Shift+Z`):** Erroneous box drags, text modifications, or deletions could not be reversed.
- **Flawed Canvas Navigation:** Mouse wheel events unconditionally zoomed the viewport instead of scrolling vertically; panning required awkward buttons.
- **Zero Raster Editing:** Could not fix imperfect inpainting or paint custom patches.
- **Restricted Typography:** Lacked CJK vertical text layout, outline stroke drop shadows, gradients, and 4-point perspective warp.

By auditing the **Koharu Manga Editor** (`v0.83.5`) and reverse-engineering the **Torii Manga Translator Chrome extension** (`v2.22.6`), we ported Torii's battle-tested Canvas 2D editing architecture into a modular, production-grade Studio V2 for Kites while decoupling it from remote cloud credit walls.

---

## 2. Key Architectural Invariants

### 2.1 The Privacy Boundary: Local WebGPU vs. Cloud API
In Torii, live inpaint and live re-OCR operations crop small bounding boxes and POST them to a cloud endpoint (`https://api.toriitranslate.com/api/inpaint`), consuming paid user credits.

In Kites Studio V2:
- The editor crops the exact same tight padded bounding box (e.g. 150×150 px).
- The patch is dispatched via Chrome Extension runtime messaging (`STUDIO_INPAINT` / `STUDIO_OCR`) through `background` to Kites' local **Offscreen Document**.
- Local WebGPU inference runs our optimized **LaMa** dynamic 64px bucket model and **PaddleOCR v6**, executing in <80ms with 100% client-side privacy, zero cloud dependency, and zero credit cost.

### 2.2 Bounded Dirty-Rect Undo/Redo
Saving full `getImageData()` for a 2000×8000px webtoon requires ~64MB per snapshot, rapidly exhausting tab memory.
Studio V2 adopts Torii's bounded patch algorithm:
- Only captures `getImageData()` of the stroked bounding box (`minX, minY, w, h` + padding), typically ~150×150px (~90KB).
- Restores patches instantaneously via `ctx.putImageData(patch.patchImageData, patch.x, patch.y)`.
- Text edits and layer transforms store serialized JSON state snapshots.

### 2.3 Real-Time Raster Restoration (Erase / Restore Brush)
- Utilizes Canvas 2D `globalCompositeOperation = "destination-in"` with optional Gaussian blur feathering (`ctx.filter = "blur(N px)"`).
- Users toggle between **"Inpainted Clean"** (cleaned background) and **"Original Artwork"** (raw artwork with original foreign text) to fix bad inpaintings with 0ms latency.

---

## 3. Directory Structure (`src/studio/`)

```
src/studio/
├── types.ts                         # Core types for tools, brushes, text objects, warp, undo patches
├── state/
│   ├── studioStore.ts               # Zero-dependency reactive store (useSyncExternalStore)
│   └── undoStack.ts                 # Bounded dirty-rect patch + text objects undo/redo manager
├── canvas/
│   ├── CanvasViewport.ts            # High-DPI scaling, natural wheel scroll/zoom, pan matrix
│   ├── BrushEngine.ts               # Erase/Restore (destination-in + feather), Paint (color/blur/pattern/transparent)
│   ├── TextRenderer.ts              # Horizontal & Vertical CJK layout, outline shadow dial needle, gradients
│   ├── WarpMesh.ts                  # Bilinear 4-point quad distortion + parametric presets
│   ├── CanvasFurniture.ts           # 8-point handles, rotate handle, floating action pill
│   └── StudioCanvas.tsx             # Interactive 2D viewport container & pointer dispatcher
├── tools/
│   ├── ToolRail.tsx                 # Left tool rail (Select, Erase, Paint, Inpaint, OCR, Text, Warp, Sticker)
│   ├── EraseSettings.tsx            # Restore source toggle (Original vs Inpainted), size, feather
│   ├── PaintSettings.tsx            # Color/Pattern/Blur/Transparency, eyedropper, feather
│   ├── InpaintSettings.tsx          # Local AI inpaint brush settings
│   ├── OcrSettings.tsx              # Local AI re-detect OCR brush settings
│   ├── TypographySettings.tsx       # Fonts, vertical layout, alignment, gradients, outline shadow dial
│   ├── WarpSettings.tsx             # Presets (Arch, Wave, Bulge), quad handles reset
│   └── ImageLayerSettings.tsx       # Sticker upload, opacity, layer order, flip
├── modals/
│   ├── FindReplaceModal.tsx         # Find & replace across all bubbles
│   ├── ExportTranscriptModal.tsx    # Multi-format text transcript exporter
│   ├── ShortcutsModal.tsx           # Interactive keyboard shortcuts recorder
│   ├── FontManagerModal.tsx         # Custom font upload & IndexedDB font store
│   └── AppearanceSettingsModal.tsx  # Custom editor UI colors
├── bridge/
│   └── offscreenStudioBridge.ts     # RPC client sending cropped patches to Offscreen Document
└── Studio.tsx                       # Main Studio application workspace integrating all panels
```

---

## 4. Layout & UI/UX Alignment (Torii 1:1 Parity)

1. **Left Panel Dual-Card Structure:**
   - Consolidated tools and tool settings into a single cohesive left panel (`w-88` ~352px).
   - Card 1 (Top): 8-tool grid across top + active tool settings directly beneath + Global Editing toggle pill at bottom.
   - Card 2 (Bottom): 6-button Actions grid (`Undo`, `Redo`, `Export Texts`, `Find & Replace`, `Save Image`, `Library`).
   - Removed disconnected right-hand inspector panel.

2. **Canvas Viewport Centering & Zero-Void Architecture:**
   - Swapped out brittle absolute translation offsets for Torii's `margin: auto` centered `#canvas-spacer` inside a native scrollable container (`overflow-auto flex flex-1 p-4`).
   - Eliminates empty black space above the manga page while retaining smooth native document scrolling and cursor-anchored Ctrl-zoom.

3. **Typesetting & Latin Word Rendering Fix:**
   - Prevented Latin translations (Vietnamese, English, etc.) from erroneously inheriting Japanese CJK vertical single-character noodle stacking (`t \n h \n ư ...`).
   - Retained Cotrans-typeset wrapped lines (`b.lines`) from Dexie database with automatic multi-line word-wrapping fallback.

4. **Brand Tone & Palette Alignment:**
   - Replaced generic colors with Kites official signature Hot Rose / Strawberry Pink `#f4446d` (RGB: 244, 68, 109) across active tool highlights, action pills, sliders, and badges over dark matte obsidian (`#090a0f`, `#121212`, `#18181b`).

---

## 5. Verification & Test Coverage

- **Viewport Geometry & Math:** Verified in `src/studio/canvas/CanvasViewport.test.ts` (6 tests).
- **Brush Engine & Dirty-Rect Undo:** Verified in `src/studio/canvas/BrushEngine.test.ts` (3 tests).
- **Text Rendering & Handle Hit-Testing:** Verified in `src/studio/canvas/TextRenderer.test.ts` (4 tests).
- **Bilinear Quad Warp Interpolation:** Verified in `src/studio/canvas/WarpMesh.test.ts` (3 tests).
- **State Store & Hotkeys:** Verified in `src/studio/Studio.test.ts` (3 tests).
- **Visual E2E Puppeteer Suite:** Executed in `scripts/test-studio-v2-visual.js`, capturing 6 pixel-perfect verification screenshots with real manga speech bubbles.
- **Full Test Suite:** 51 test files passed (417 total tests passing, 0 failures).
- **Production Build:** Clean `tsc -b` and `vite build` completed successfully.
