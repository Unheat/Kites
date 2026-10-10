# Devlog 023: Phase 23 - Speech Bubble Detection, Dynamic Chamber Expansion & Intelligent Typesetting

## 1. Problem Statement & Root Cause
In manga/comic translation, original Japanese/Chinese/Korean text lines are frequently oriented vertically in narrow columns measuring only 20–30px wide. Previously in Kites (pure Cotrans bottom-up MST merge):
1. **Font Size Collapse (Teo chữ):** Translated horizontal English/Vietnamese sentences require $1.5\times - 2.5\times$ more horizontal width than compact CJK characters. Constraining text layout to the narrow 25px OCR strip forced word-wrapping every 1–2 words, driving font sizes down to an unreadable 5–7px despite ample empty white space inside the speech balloon.
2. **Optical Decentering:** Original text is often positioned off-center in the balloon. Typesetting inside the tight OCR box drew translated text off-balance instead of centered in the balloon's visual chamber.
3. **Staggered Multi-Utterance Over-merging:** Two distinct utterances sharing a connected or staggered balloon were fused into a single bounding box, spanning awkwardly across panel artwork.

## 2. Architecture: Dual-Route Hybrid Layout Pipeline
To eliminate font collapse while maintaining 100% recall for sound effects and artwork text:
- **Speech Balloons:** Top-down container pipeline detects the balloon chamber, severs pointing tails, insets a safe 8% core, and expands the text box outward via damped slack equations ($1.45\times$ horizontal / $2.20\times$ narrow vertical).
- **Free-Floating Text / SFX:** Bottom-up Cotrans MST merge pipeline preserves tight line hulls with zero expansion, preventing collision with background artwork.
- **Inpainting Isolation Invariant:** Inpainting engines (LaMa, Simple) **STRICTLY receive the original tight line polygons (`rawPolygons`)**. The expanded `typeset_box` is used solely by the rendering and layout engine (`canvasTypesetting.ts`).
- **Post-Merge Splitting Boundary:** Utterance splitting executes strictly as a **POST-merge pass** after Cotrans MST grouping, preventing interference with line clustering.

## 3. Implementation Details

### A. Shared Types & Settings UI
- Added `BubbleDetectionMode = 'off' | 'heuristic' | 'neural'` in `src/shared/types.ts`.
- Integrated `bubbleMode` (default `'heuristic'`) into `PopupState` and `normalizePopupState` in `src/background/index.ts`.
- Added **"Layout & Bubble Fit"** dropdown in `src/popup/components/EngineSelectionPanel.tsx` with Tier 1 (Heuristic, 0 MB), Tier 2 (Neural YOLO), and Tier 0 (Disabled).

### B. Core Geometric Utilities (`src/offscreen/utils/bubbleExpansion.ts`)
- `bubbleCore`: insets outer boundary by 8% (clamped $[4, 24]$px) to construct the safe inner core.
- `deriveCarrierBoxGeometric` & `validTailCutCarrier`: detects asymmetric directional margins ($m_{bot} \ge 1.30 \times m_{top}$, $\Delta \ge 20$px) to trim pointing tails and isolate the balloon chamber.
- `dampedSlackExpansion`: centroid-anchored expansion into available slack with 0.60 damping, $1.45\times$ standard cap, and $2.20\times$ narrow vertical cap.
- `computeTypesetBox`: produces the final typeset box centered on the carrier chamber.

### C. Post-Merge Utterance Splitting (`src/offscreen/utils/utteranceSplitter.ts`)
- Ported from XianScan `clustering.rs`.
- Detects terminal punctuation (`！!？?…。」』`) and vertical stagger gaps ($\ge 1.35 \times \text{thickness}$ or $\ge 0.45 \times \text{thickness}$ with punctuation).
- Safely splits staggered dual-lobe balloons into independent layout blocks.

### D. Tier 1 Heuristic Bubble Extractor (`src/offscreen/engines/bubble/HeuristicBubbleExtractor.ts`)
- Runs on offscreen canvas `ImageData` with $< 1.5$ ms latency at 0 MB model download cost.
- Scales local patch to $\le 200 \times 200$ for resolution invariance.
- Morphological opening ($R \in [6, 16]$) severs pointing tails while flood-fill recovers the main chamber.
- Leak guard rejects uncontained white space / open page margins.

### E. Pipeline & Typesetting Integration
- Extended `OcrResult` (`BaseOcrEngine.ts`) with `typesetBoxes?: OcrBox[]`.
- `PipelineOrchestrator.ts` extracts carrier chambers for detected boxes and passes `typesetBox` to `TextBlockItem`.
- `canvasTypesetting.ts` derives quad points from `typesetBox`, allowing `fitFontSizeWithLines` to layout translated dialogue in comfortable, readable font sizes (12–15px).
- `db.textBlocks` directly persists active `typeset_box` coordinates (`posX, posY, width, height`), giving Studio Editor full WYSIWYG parity without Dexie schema migrations.

## 4. Verification & Results
- **Unit Tests:** 331 tests passed across 41 test files (including new unit test suites for `bubbleExpansion.test.ts`, `utteranceSplitter.test.ts`, and `HeuristicBubbleExtractor.test.ts`).
- **Build Check:** `npm run build` completed with zero TypeScript errors.
