# Torii Editor 1:1 Feature Port & Kites Studio V2 Rebuild Specification

> **Document Status:** Planning & Architectural Specification  
> **Target Branch:** `feat/studio-editor-v2-rebuild`  
> **Reference Donors:**  
> - Torii Manga Translator Chrome Extension `v2.22.6` (`gkdekajjngdkocgiealohleibhdjhoed`)  
> - Koharu Editor `v0.83.5` (`scratches/reference/koharu-editor-audit`)  
> **Kites Core Invariant:** 100% Client-Side Privacy, Local WebGPU / Cloudflare Zero-Cost AI, No Remote Credit Walls.

---

## 1. Executive Summary & Why Rebuild

The current Kites Studio (`src/App.tsx`) was created as a minimal visual dashboard in Phase 11. While functional for reviewing pipeline outputs, its editing UX has significant limitations:
- **No Undo/Redo (`Ctrl+Z` / `Ctrl+Shift+Z`):** Any mistaken edit, deletion, or movement cannot be undone.
- **Flawed Viewport Navigation:** Mouse wheel unconditionally zooms instead of scrolling vertically; panning requires awkward button toggles.
- **No Raster Editing:** Cannot paint or fix inpainting mistakes; once an image is cleaned, bad artifacts are permanent.
- **Limited Text Capabilities:** Text is restricted to simple horizontal DOM boxes; missing Japanese/Chinese vertical text, stroke drop shadows, gradients, warp/perspective quad distortion, and custom font uploads.
- **Monolithic Component:** Over 1,300 lines in a single React file mixing database cleanup, network polling, layout calculation, and DOM rendering.

By reverse-engineering the **Torii Manga Translator extension** (which contains 26,000+ lines of unminified, battle-tested vanilla Canvas 2D editing code) and analyzing **Koharu**, we have the exact algorithms to build a best-in-class manga editor studio for Kites.

### The Architectural Boundary: Cloud API vs. Local Offscreen Engine
In Torii, heavy tasks (`inpaint`, `ocr`, `translate`) crop a small bounding box and send a `multipart/form-data` POST request to their remote server (`https://api.toriitranslate.com/api/inpaint`), consuming paid user credits.

In **Kites Studio V2**, the editor interface is completely decoupled from the AI engine:
1. When the user uses **Live AI Inpaint** or **Live Re-OCR**, the editor crops the exact same tight padded bounding box (e.g., 150×150 px).
2. Instead of a remote fetch, the editor dispatches a local Chrome Extension message (`MANUAL_INPAINT` / `MANUAL_OCR`) to Kites' existing **Offscreen Document**.
3. Kites runs our optimized **LaMa / AOT-GAN** or **PaddleOCR v6** model via local WebGPU on only that small patch.
4. The result is stamped back into the canvas at 0ms network latency, with zero cloud dependency and zero credit cost.

---

## 2. Exhaustive Torii Feature Audit & Kites Porting Blueprint

Every feature below has been verified directly in Torii's codebase (`html/edit.html` and `scripts/content.js`).

### 2.1 Viewport & Canvas Navigation
| Torii Feature | Location in Reference | How It Works Technically | Torii UI / UX | Kites Studio V2 Implementation |
|---|---|---|---|---|
| **Mouse Wheel Scrolling** | `content.js:4170–4185` | Unmodified `wheel` event scrolls `canvasContainer.scrollTop += deltaY * 0.4`. `Shift+wheel` scrolls `scrollLeft`. | Natural, fast document scrolling like a PDF reader or web page. | **Adopt 1:1.** Fixes Kites' current wheel bug where any wheel event erroneously zooms. |
| **Cursor-Centered Zoom** | `content.js:4175–4180` | `Ctrl+wheel` or `Cmd+wheel` calculates target zoom and translates the canvas origin relative to pointer `(clientX, clientY)`. | Smooth zoom centered exactly on the cursor position (10% to 500%). | **Adopt 1:1.** Implement via CSS transform / canvas matrix scaling with zoom clamp. |
| **Zoom Presets** | `edit.html:zoom-preset-*`, `content.js:5858–5867` | Buttons for `100%`, `Fit Width`, `Fit Height`. Calculates scale based on `canvasContainer.clientWidth / image.naturalWidth`. | Top bar pill dropdown with instant zoom presets. | **Adopt 1:1.** Placed in the Studio top toolbar. |
| **Spacebar Pan** | `content.js:4187–4210` | Holding Spacebar switches cursor to grab hand (`cursor: grab`); pointer drag translates viewport scroll. | Industry standard Figma/Photoshop panning behavior. | **Adopt 1:1.** Global key listener in canvas viewport. |
| **High-DPI / Retina Canvas** | `content.js:3360–3375` | Backing canvas is sized to `width * devicePixelRatio`, scaled via CSS `width: 100%`. | Razor-sharp text rendering and crisp brush strokes on 4K / Retina displays. | **Adopt 1:1.** Standard canvas backing store scaling. |

---

### 2.2 Live Brushes & Raster Editing
Torii uses three distinct canvas layers: `originalLayer` (raw image), `inpaintedLayer` (cleaned background), and `workingContext` (live composition).

#### A. Erase & Restore Brush (`erase-mode`, `Ctrl+1`)
- **Reference Location:** `html/edit.html:erase-settings`, `scripts/content.js:16674–16885`
- **Technical Operation:**
  1. The user selects the source to restore: **"Original"** (raw artwork with original foreign text) or **"Inpainted"** (cleaned background).
  2. As the user strokes, `eraseStroke` accumulates a dab mask.
  3. Bounded composition (`content.js:16860`):
     ```javascript
     scratchCtx.drawImage(eraseRestoreSource, originX, originY, w, h, 0, 0, w, h);
     scratchCtx.globalCompositeOperation = "destination-in";
     if (featherPx > 0) scratchCtx.filter = `blur(${featherPx}px)`;
     scratchCtx.drawImage(eraseStroke.canvas, 0, 0);
     scratchCtx.globalCompositeOperation = "source-over";
     target.ctx.drawImage(scratchCanvas, originX, originY);
     ```
  4. Automatically removes any text objects whose bounding box falls under the brush (`content.js:16912`).
- **UI / UX Controls:**
  - **Restore Source Toggle:** Pill switch between `Original Artwork` and `Inpainted Clean`.
  - **Brush Shape:** Circle vs. Square buttons.
  - **Brush Size:** Slider (5px – 300px) + scrub input field.
  - **Brush Feather:** Slider (0px – 100px) for soft, seamless edge blending.
- **Kites Implementation:**
  - Kites already stores `rawImageBlob` and `translatedImageBlob` in IndexedDB (`ImageRecord`). We pass both into the editor as `ImageBitmap`s.
  - 100% client-side, 0ms latency, zero AI overhead. Fixes any bad inpainting immediately.

#### B. Freehand Paint Brush (`paint-mode`, `Ctrl+2`)
- **Reference Location:** `html/edit.html:paint-settings`, `scripts/content.js:16751–16830`
- **Technical Operation:**
  - Supports 4 paint sources:
    1. **Solid Color:** Coloris color picker with hex/RGB + Eyedropper tool.
    2. **Tiled Pattern:** User uploads an image file (e.g., halftone dots or paper texture); repeats with adjustable pattern scale (`DOMMatrix.scaleSelf`).
    3. **Blur:** Applies `ctx.filter = blur(N px)` directly onto the underlying canvas slice.
    4. **Transparency:** Punches transparent holes through the canvas using `globalCompositeOperation = "destination-out"`.
- **UI / UX Controls:**
  - Segmented buttons: `Color` | `Pattern` | `Blur` | `Transparency`.
  - Color picker + Eyedropper sampling tool.
  - Pattern file picker + scale slider.
  - Blur strength slider (0–50px) / Transparency strength slider (0–100%).
  - Brush shape (Circle/Square), Size slider (5–300px), Feather slider (0–100px).
- **Kites Implementation:**
  - Replicate the exact 4-source brush logic. Useful for cleaning complex comic screentones or adding custom background patches.

#### C. Live AI Inpaint Brush (`inpaint-mode`, `Ctrl+3`)
- **Reference Location:** `html/edit.html:inpaint-settings`, `scripts/content.js:17040–17205`
- **Technical Operation:**
  1. Pointer down/drag draws a semi-transparent colored mask stroke on `maskCanvas`.
  2. On `pointerup` (`stopDrawing`), computes tight bounding box + 10px padding:
     ```javascript
     const paddedBoundingBox = { x, y, width: paddedWidth, height: paddedHeight };
     ```
  3. Clones the cropped mask into a detached canvas, then **instantly clears `maskCanvas`** so the user can immediately paint another bubble.
  4. Sends the cropped image + mask to the inpainting backend.
  5. Upon arrival, stamps the clean patch onto the hidden and working canvases, invalidating the raster mirror and recording a bounded dirty-rect undo patch.
- **Kites Implementation:**
  - **Difference:** Torii posts to cloud API. Kites dispatches `MANUAL_INPAINT` RPC to our local offscreen document.
  - Offscreen runs our localized LaMa dynamic 64px bucket patch engine. Because the crop is small (e.g. 150×150px), WebGPU inference takes <80ms!

#### D. Live Re-OCR Area Tool (`ocr-mode`, `Ctrl+4`)
- **Reference Location:** `html/edit.html:ocr-settings`, `scripts/content.js:17119–17238`
- **Technical Operation:**
  1. User brushes or boxes over a missed bubble or SFX.
  2. On release, crops the padded bounding box and dispatches an OCR request with `isOCR = true`.
  3. The backend cleans the background under the text AND recognizes/translates the text.
  4. Returns both `inpaintedImageSrc` and `textObjects`.
  5. The canvas stamps the clean patch to remove the Japanese/Korean text, and **instantly pops up a new editable text object centered inside the user's box**:
     ```javascript
     first.x = boundingBox.x + boundingBox.width / 2;
     first.y = boundingBox.y + boundingBox.height / 2;
     first.ocr = true;
     setTextObjects(currentImage, getTextObjects(currentImage).concat(parsedOCR));
     ```
- **Kites Implementation:**
  - **Difference:** Dispatches `MANUAL_OCR` to Kites offscreen pipeline.
  - Offscreen runs PaddleOCR recognition on the crop, translates via configured provider (Cloudflare / WebLLM / OpenAI / Gemini), and cleans the background using LaMa.
  - Emits the new text box directly into the Studio scene graph.

---

### 2.3 High-Performance Bounded Undo / Redo (`Ctrl+Z` / `Ctrl+Shift+Z`)
- **Reference Location:** `scripts/content.js:21006–21135`
- **Why Naive Undo Fails:** Saving full canvas `getImageData()` for a 2000×8000px webtoon requires ~64MB per snapshot. 10 undo steps = 640MB, crashing Chrome tab memory.
- **Torii's Dirty-Rect Architecture (To Port 1:1):**
  1. For text edits / transforms / additions: Only serialized JSON of text objects is pushed to `undoStack`.
  2. For brush strokes (paint / erase / inpaint):
     - At `pointerdown`: Pre-stroke region is cached in `activeStroke.base`.
     - At `pointerup`: Reads `getImageData()` of **only the stroked bounding box** (`undoPatchCanvas`), typically 100×100px (~40KB).
     - State entry stores `{ imageData, imageDataX, imageDataY, textObjects }`.
  3. On `undoLastAction()`:
     - Saves current state to `redoStack`.
     - Re-stamps the small patch: `ctx.putImageData(lastState.imageData, lastState.imageDataX, lastState.imageDataY)`.
     - Restores `textObjects` and triggers `redrawCanvas(true)`.
  4. Grouped typing undo: Word-level typing grouping using `beforeinput` checkpoints so typing an entire sentence doesn't require 50 undo clicks.

---

### 2.4 Text Editing & Typography Engine (`add-mode`, `Ctrl+5`)
Torii features a comprehensive typography engine for comics (`content.js:9850–10050`):

| Typography Property | Reference Implementation | Capabilities & UI | Kites Implementation Plan |
|---|---|---|---|
| **Font Family & Custom Fonts** | `content.js:3315–3335`, `edit.html:custom-font-*` | Preloaded comic fonts (WildWords, Figtree, Kalam, etc.) + custom `.ttf`/`.woff2` file upload into IndexedDB font store. Font folders for organizing. | Support bundled fonts + local system font access via `queryLocalFonts()` API + user file upload to IndexedDB. |
| **CJK Vertical Layout** | `content.js:9884`, `edit.html:add-layout-vertical` | Renders text top-to-bottom, columns right-to-left. Handles vertical punctuation rotation (e.g. `ー`, `…`, `、`). | **Adopt 1:1.** Essential for Japanese/Chinese manga bubbles. |
| **Text Direction** | `edit.html:add-text-dir-*` | LTR vs. RTL toggle for Middle Eastern / Hebrew / Arabic translations. | **Adopt 1:1.** Integrates with Kites' RTL reversal logic. |
| **Font Sizing & Spacing** | `edit.html:add-font-size-*`, `line-spacing`, `letter-spacing` | Size (5–300px), Line Spacing (50%–200%), Letter Spacing (-10px to +50px). All have live draggable scrub inputs. | **Adopt 1:1.** Replace Kites' crude font fitting with dynamic sliders + auto-fit toggle. |
| **Formatting Toggles** | `edit.html:add-font-bold`, `italic`, `uppercase`, `lowercase` | Bold, Italic, All-Caps transformation, Lowercase transformation. | **Adopt 1:1.** Standard formatting buttons. |
| **Text Color & Gradient** | `edit.html:check-gradient-text`, `content.js:9896–9910` | Solid color with Eyedropper OR Linear 2-Color Gradient with adjustable vertical span. | **Adopt 1:1.** Dual color wells + gradient toggle. |
| **Stroke (Outline) & Drop Shadow** | `content.js:9912–9935`, `edit.html:stroke-angle-dial` | Outline width (0–30px), outline color/gradient, outline blur (glow effect), and **Stroke Angle Dial Needle + Distance** for comic drop shadows! | **Adopt 1:1.** Replicate interactive dial needle for angle (0°–360°) and distance slider. |
| **Bubble Box Background** | `content.js:9940–9965`, `edit.html:add-border-*` | Solid/gradient fill behind text, padding slider (0–50px), border radius slider (0–100% pill shape). | **Adopt 1:1.** Allows creating opaque speech bubbles over busy backgrounds. |
| **Motion Blur Effect** | `edit.html:add-motion-blur-*` | Angle dial needle + blur distance slider to simulate speed/action sound effects. | **Adopt 1:1.** Renders multi-pass offset canvas alpha blending. |

---

### 2.5 Text Warp & 4-Point Perspective Tool (`warp-mode`, `Ctrl+6`)
- **Reference Location:** `html/edit.html:warp-settings`, `scripts/content.js:10100–10350`
- **Features:**
  1. **Presets:** None, Arch, Bulge, Fish, Squeeze, Stretch, Twist, Wave, Perspective.
  2. **Parametric Controls:**
     - Bend Slider (-100% to +100%)
     - Horizontal & Vertical Distortion Sliders
     - Frequency Slider (for Wave / Twist)
     - Warp Direction (Horizontal vs. Vertical)
  3. **Interactive 4-Point Quad Corner Handles:**
     - The selected text box displays 4 movable corner handles (`TL`, `TR`, `BL`, `BR`).
     - Dragging any corner dynamically computes a projective or bilinear transformation matrix, mapping text along perspective surfaces (e.g. signs, tilted speech balloons, diagonal sound effects).
- **Kites Implementation:**
  - Slice the text canvas into vertical/horizontal scanlines and apply trigonometric offsets for presets, and a 2D bilinear subdivision mesh for 4-point quad distortion.

---

### 2.6 Image / Sticker Layer Tool (`image-mode`, `Ctrl+7`)
- **Reference Location:** `html/edit.html:image-settings`, `scripts/content.js:10400–10550`
- **Features:**
  - Upload local image files (stickers, clean bubbles, SFX graphics).
  - Placed on the canvas as movable, resizable, rotatable objects.
  - Opacity slider (0%–100%).
  - Flip Horizontal & Flip Vertical buttons.
  - Layer Stacking: Move Up / Move Down buttons.
  - Rasterize to background button (`rasterizeButton`).

---

### 2.7 Interactive Canvas Furniture & Quick Actions
- **Reference Location:** `scripts/content.js:4800–4870`
- **Floating Pill Toolbar (Appears above the active text box):**
  1. **Copy Style (`copyStyleButton`):** Copies font family, size, colors, stroke, alignment to clipboard.
  2. **Paste Style (`pasteStyleButton`):** Applies copied style to the currently selected text box.
  3. **Duplicate (`duplicateButton`):** Clones the text box offset by +20px.
  4. **Delete (`deleteButton`):** Removes text object (also bound to `Delete` / `Backspace`).
  5. **Copy Original Text:** Copies raw detected Japanese/Korean text to clipboard.
  6. **Copy Translated Text:** Copies translated English text to clipboard.
  7. **Rasterize (`rasterizeButton`):** Bakes text permanently into the underlying background canvas.
- **Marquee Selection (`content.js:4460–4500`):** Dragging on empty canvas creates a dashed rectangle selecting multiple text boxes simultaneously.
- **Live Brush Cursor Outline (`content.js:4250–4310`):** Shows exact circle/square cursor footprint with an outer dashed ring indicating feather radius.

---

### 2.8 Global Utilities & Productivity Tools
| Tool | Reference Location | Technical Operation | UI / UX |
|---|---|---|---|
| **Find & Replace** | `html/edit.html:find-replace-modal`, `content.js:5810–5850` | Regex or string search across all `textObjects`. Live occurrence counter (`N matches`). Match Case & Whole Word checkboxes. | Modal dialog with live preview and "Replace All" / "Replace Next". |
| **Global Edit Mode** | `html/edit.html:global-edit-btn`, `content.js:5375–5380` | When enabled, changing any font, color, or stroke parameter in the inspector applies to **every text box across the entire image** simultaneously. | Prominent pill toggle in the sidebar. |
| **Export Text Transcript** | `html/edit.html:save-texts-modal`, `content.js:5870–5920` | Dumps all dialogue to text file or clipboard. Options: Combined (Original + Translated), Separate, Original Only, Translated Only. Checkbox for bubble index headers and extra newlines. | Export transcript dialog with live text preview. |
| **Flip Image Preview** | `html/edit.html:flip-image-btn`, `content.js:9444–9460` | Temporarily flips entire canvas horizontally (`scaleX(-1)`) so artists can spot composition/anatomical issues. | Top bar toggle button. |
| **Keyboard Shortcuts Manager** | `html/edit.html:shortcuts-modal`, `content.js:18080–18480` | Displays cheat sheet for all tools (`Ctrl+1` through `Ctrl+7`, `Ctrl+Z`, `Space`, etc.) and includes an interactive key-recorder dialog allowing users to rebind any shortcut. | Modal with key listener and reset-to-defaults button. |
| **Editor Appearance Settings** | `html/edit.html:editor-settings-modal`, `content.js:8792–8850` | Lets user customize the UI color of: Selected Box border, Unselected Box border, Caret color, Brush Cursor color. | Modal with color wells and restore defaults. |

---

## 3. Where Kites is Superior (Keep & Enhance)

While Torii's editor UI and canvas interaction are world-class, **Kites has superior backend AI and typography algorithms**. We preserve and enhance all of Kites' unique strengths:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        KITES UNIQUE ADVANTAGES                         │
├────────────────────────────────┬───────────────────────────────────────┤
│ Feature                        │ How Kites Outperforms Torii           │
├────────────────────────────────┼───────────────────────────────────────┤
│ 1. 100% Client-Side Privacy    │ Kites runs on WebGPU/WASM locally.    │
│    & Zero Subscription Cost    │ Torii requires cloud server + credits.│
├────────────────────────────────┼───────────────────────────────────────┤
│ 2. Dual-Tier Bubble Detection  │ YOLO Box + Smart Mask partitioning    │
│    & Sub-Chamber Splitting     │ (ADR-006). Torii has no bubble AI.    │
├────────────────────────────────┼───────────────────────────────────────┤
│ 3. Rotated OCR & CJK Dynamic   │ PaddleOCR 90°/180°/270° detection +   │
│    Reading Order               │ Chinese dynamic vertical/horizontal.  │
├────────────────────────────────┼───────────────────────────────────────┤
│ 4. Algorithmic Typesetting     │ Cotrans-2023 matched polygon fitting, │
│    & Adaptive Luminance        │ font floor protection, dark bubble    │
│                                │ auto-outline adaptation (PR #13).     │
├────────────────────────────────┼───────────────────────────────────────┤
│ 5. Multi-Provider Translation  │ Cloudflare Worker, WebLLM, OpenAI,    │
│    Waterfall                   │ Gemini, Claude, DeepSeek BYOK.        │
└────────────────────────────────┴───────────────────────────────────────┘
```

### Synthesis Strategy:
- **Use Torii's Frontend UX:** Adopt their canvas math, brush compositing, dirty-rect undo, wheel navigation, typography sliders, warp engine, and tool layout.
- **Use Kites' Engine Backend:** Connect the live inpaint and live OCR buttons to Kites' local offscreen WebGPU models instead of Torii's cloud API.
- **Auto-Populate from Kites Pipeline:** When an image is translated automatically, Kites feeds its detected `rawPolygons`, `typesetBoxes`, and cleaned `translatedImageBlob` directly into the Studio V2 editor as editable text objects and layers!

---

## 4. Rebuilt Kites Studio Architecture (`src/studio/`)

The monolithic `src/App.tsx` will be replaced by a modular component hierarchy in `src/studio/`:

```
src/studio/
├── Studio.tsx                       # Main layout container (Top bar, Left tools, Canvas, Right sidebar)
├── state/
│   ├── studioStore.ts               # Zustand store for active tool, selection, zoom, preferences
│   └── undoStack.ts                 # Bounded dirty-rect patch + text object undo/redo manager
├── canvas/
│   ├── StudioCanvas.tsx             # Canvas 2D viewport container & pointer event dispatcher
│   ├── CanvasViewport.ts            # High-DPI scaling, wheel zoom/scroll, pan transforms
│   ├── BrushEngine.ts               # Erase/Restore (destination-in), Paint (color/blur/pattern)
│   ├── TextRenderer.ts              # Horizontal/Vertical text, outline shadow, gradients, warp
│   ├── WarpMesh.ts                  # Bilinear 4-point quad distortion & parametric presets
│   └── CanvasFurniture.ts           # 8-point resize handles, rotate handle, floating action pill
├── tools/
│   ├── ToolRail.tsx                 # Left vertical tool rail (Erase, Paint, Inpaint, OCR, Text, Warp, Image)
│   ├── EraseSettings.tsx            # Restore source toggle (Original vs Inpainted), size, feather
│   ├── PaintSettings.tsx            # Color/Pattern/Blur/Transparency, eyedropper, feather
│   ├── InpaintSettings.tsx          # Local AI inpaint brush settings
│   ├── OcrSettings.tsx              # Local AI re-detect OCR brush settings
│   ├── TypographySettings.tsx       # Fonts, vertical layout, alignment, gradients, outline shadow
│   ├── WarpSettings.tsx             # Presets (Arch, Wave, Bulge), quad handles reset
│   └── ImageLayerSettings.tsx       # Sticker upload, opacity, layer order, flip
├── modals/
│   ├── FindReplaceModal.tsx         # Find & replace across all bubbles
│   ├── ExportTranscriptModal.tsx    # Multi-format text transcript exporter
│   ├── ShortcutsModal.tsx           # Interactive keyboard shortcuts recorder
│   ├── FontManagerModal.tsx         # Custom font upload & folder manager
│   └── AppearanceSettingsModal.tsx  # Custom editor UI colors
└── bridge/
    └── offscreenStudioBridge.ts     # RPC client sending cropped patches to Offscreen Document
```

---

## 5. Phase-by-Phase Implementation Roadmap

### Phase 1: Studio Scaffold & High-DPI Viewport Engine
- Create `src/studio/` directory structure and Zustand state store.
- Implement `CanvasViewport.ts` with Retina DPI backing store.
- Implement **natural mouse wheel scrolling** (vertical, shift=horizontal) and **Ctrl+wheel cursor-centered zooming**.
- Implement Spacebar pan gesture and zoom preset buttons (100%, Fit Width, Fit Height).

### Phase 2: High-Performance Undo/Redo & Raster Brushes
- Implement `undoStack.ts` using Torii's **bounded dirty-rect patch algorithm** (`getImageData` of only the stroked bounding box).
- Implement `Erase / Restore Brush`:
  - Bind `rawImageBlob` (original artwork) and `translatedImageBlob` (cleaned background).
  - Implement canvas `destination-in` stroke compositing with feathering.
  - Add pill toggle for "Restore Original" vs "Restore Inpainted".
- Implement `Paint Brush` with Color, Pattern image, Blur filter, and Transparency punch.
- Bind `Ctrl+Z` (Undo) and `Ctrl+Shift+Z` / `Ctrl+Y` (Redo).

### Phase 3: Text Engine & Interactive Canvas Furniture
- Implement native Canvas 2D text layout supporting:
  - Horizontal & **Vertical CJK** text layout.
  - LTR & RTL reading directions.
  - Text outline stroke with **angle dial needle + distance drop shadow**.
  - Solid & 2-color linear gradients for both text and stroke.
  - Bubble background box fill with padding and border radius.
- Implement 8-point bounding box transform handles (move, resize, rotate).
- Implement floating action pill (Copy Style, Paste Style, Duplicate, Delete, Rasterize).
- Implement direct on-canvas text editing with word-level grouped typing undo.

### Phase 4: Local AI Offscreen Bridges (Live Inpaint & Live OCR)
- Add `MANUAL_INPAINT` RPC endpoint in `src/offscreen/index.ts`:
  - Accepts cropped patch buffer + binary mask buffer + bounds.
  - Runs cached LaMa / AOT-GAN engine on the patch.
  - Returns inpainted patch buffer.
- Add `MANUAL_OCR` RPC endpoint in `src/offscreen/index.ts`:
  - Runs PaddleOCR recognition + translation + inpainting on the cropped patch.
  - Returns clean patch + recognized/translated text objects.
- Wire `InpaintTool` and `OcrTool` in Studio:
  - Brushing draws instant local mask overlay.
  - Pointer release crops tight bounding box, clears mask immediately, and calls offscreen bridge.
  - Results stamp onto canvas at `(x, y)` and push to undo stack; OCR automatically pops up editable text box at box center.

### Phase 5: Advanced Warp, Multi-Image, and Utilities
- Implement `WarpTool`:
  - Parametric presets (Arch, Wave, Bulge, Twist, Squeeze).
  - 4-point interactive quad corner drag handles with perspective projection.
- Implement `ImageTool` (sticker overlay, opacity, flip, layer reorder).
- Implement Modals:
  - `FindReplaceModal` (search/replace with regex, case sensitivity, match counter).
  - `ExportTranscriptModal` (combined/separate formats, headers, newlines).
  - `ShortcutsModal` (interactive key recorder).
  - `FontManagerModal` (upload local `.ttf`/`.woff2` fonts to IndexedDB).
- Implement `Global Edit Mode` (simultaneous multi-bubble styling).
- Implement `Flip Image Preview` (horizontal canvas mirror).

### Phase 6: Integration, Polish & Regression Verification
- Replace existing `src/App.tsx` body with `Studio.tsx`.
- Connect Dexie database schema to load and save edited projects seamlessly.
- Run complete test suite (`npm test`) and production build (`npm run build`).
- Verify WebGPU memory safety (no tensor leaks during repeated live inpaint strokes).
