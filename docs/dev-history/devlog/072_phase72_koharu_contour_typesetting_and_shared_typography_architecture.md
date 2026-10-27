# Devlog 072: Phase 72 — Koharu Contour Scanline Typesetting Engine & Shared Typography Architecture

**Date:** 2026-10-25  
**Branch:** `feat/koharu-contour-typeset-parity`  
**Status:** Completed & Verified  

---

## 1. Context & Motivation

In previous iterations, speech bubble text layout relied on a mathematical approximation (`wrapTextEllipse`) that modeled speech bubbles as synthetic rounded-corner envelopes parameterized by a scalar `borderRadius` and horizontal chord shares $s_i = (1 - s) + s \sqrt{1 - (y_i / h)^2}$.

While effective for smooth, axis-aligned ovals, this synthetic model exhibited severe structural limitations on real-world manga panels:
1. **Pinching on Spiky Burst / Shout Balloons (Hasumi)**: Spiky burst balloons have wide, flat top and bottom contours. The synthetic ellipse equation forced a steep mathematical taper at both ends, choking text into an artificially pinched 6-line block leaving 55% dead whitespace in the bubble.
2. **Stepped / Conjoined Caption Boxes**: When two rectangular caption boxes shared whitespace, morphological curved-neck validation failed, triggering an atomic bailout that reverted both boxes to microscopic 15px unexpanded OCR bounding boxes.
3. **Studio Retranslate Bypass**: Studio OCR (`runStudioOcr`) completely omitted speech bubble detection and carrier expansion, producing unexpanded raw OCR bounding boxes and unpopulated layout lines.

---

## 2. Architectural Design: Koharu 2D Contour Scanline Engine

Rather than attempting to compensate for the synthetic ellipse equation with heuristic font ceilings or outline overflow penalties, Phase 72 ports the clean-room 2D contour scanline typesetting architecture from open-source scanlation donor Koharu (`crates/koharu-renderer/src/layout.rs`).

### 2.1 The Strict 3-Route Typesetting Architecture

```
                               ┌──────────────────────────────────────────────┐
                               │               Kites Pipeline                 │
                               └──────────────────────┬───────────────────────┘
                                                      │
                               Is Bubble Tier Enabled (Heuristic / Neural)?
                                                      │
                       ┌──────────────────────────────┴──────────────────────────────┐
                      NO                                                            YES
                       │                                                             │
            ┌──────────────────────┐                                     ┌──────────────────────┐
            │   Route 1: XianScan   │                                     │   Route 2: Koharu    │
            │ (Auto Balloon / Off) │                                     │   Contour Scanline   │
            ├──────────────────────┤                                     ├──────────────────────┤
            │ • Diamond envelope   │                                     │ • Intersects exact   │
            │ • 4-pass binary srch │                                     │   bubble polygon     │
            │ • Quad decollision   │                                     │ • 2D DP line breaker │
            │ • Best for no-mask   │                                     │ • Coarse+binary font │
            └──────────────────────┘                                     └──────────┬───────────┘
                                                                                    │
                                                                  ┌─────────────────┴─────────────────┐
                                                                  │           Studio Editor           │
                                                                  ├───────────────────────────────────┤
                                                                  │ • Text/Font edits: re-wraps to   │
                                                                  │   original bubble contour polygon │
                                                                  │ • Box Resize: wraps to 4-corner   │
                                                                  │   rectangle using same DP solver  │
                                                                  └───────────────────────────────────┘
```

1. **Route 1 (`balloon` / Auto Balloon)**:
   - Dedicated strictly to `bubbleMode: 'off'` (where no bubble mask exists) and Studio Auto Balloon.
   - Preserves XianScan diamond ratio envelope (`balancedWrapText`), 4-pass binary search (`fitFontSizeWithLines`), and elastic quad decollision (`decollideBoxes`).
2. **Route 2 (`contour` / Koharu Bubble Contour)**:
   - Dedicated to all active bubble tiers (`heuristic`, `neural`, `neural-mask`).
   - Uses exact 2D scanline ray-casting (`polygonInlineSpans`) directly across the bubble carrier polygon.
   - Slices horizontal chords at top, center, and bottom of the glyph ink band (excluding inter-line leading) and enforces a symmetric typographic center axis (`sharedCenter`).
   - Solves optimal line breaks via a single-pass 2D dynamic programming table (`exactProfiledLineBreaks`) with slack, overflow, hyphenation, and linguistic break penalties.
   - Performs coarse-to-fine non-monotonic font sizing (`largestFittingFontSize`): 8 downward probes followed by a 10-iteration binary search.
   - Employs the `LastResort` hyphenation policy: whole-word layout is evaluated first; discretionary hyphens are admitted only if they recover $\ge 1$ integer raster font pixel over the readable floor.
3. **Route 3 (`simple` / Simple Wrap)**:
   - Dedicated to rectangular caption boxes and fixed-width containers.
   - Greedy line wrapping at the exact user-specified font size with soft-hyphenation and Kinsoku Shori line-start barring.

---

## 3. Implementation Details

### 3.1 Modular Typography Extraction (`src/offscreen/utils/typography/`)
To eliminate the 2,000-line god-file anti-pattern, shared typography utilities were extracted into focused modules under 100 lines each:
- **`kinsokuShori.ts`**: Punctuation binding (`OPENING_MARK_RE`), Japanese Kinsoku Shori line-start barring (`NO_LINE_START_RE`), and no-space script boundaries (CJK, Thai, Lao, Khmer, Burmese).
- **`textUnwrap.ts`**: Normalizes soft-hyphen joiners (`INSERTED_HYPHEN = '-\u2060'`), unwraps soft line breaks, and preserves authored paragraph breaks (`\n\n`) and intra-word dashes.
- **`tokenizer.ts`**: Script-aware dialogue tokenization using `Intl.Segmenter` and linguistic break penalty calculation (`comicBreakPenalty`).
- **`index.ts`**: Single barrel export.

### 3.2 Koharu Contour Scanline Engine (`src/offscreen/utils/contourTypeset.ts`)
- **`polygonInlineSpans`**: Pure geometric ray-casting calculating exact horizontal spans `[left, right]` for any convex or concave polygon contour.
- **`computeContourProfiles`**: Computes usable line chord profiles, sampling the glyph ink band across three levels to prevent leading-induced pinch.
- **`exactProfiledLineBreaks`**: 2D DP table with cost function:
  $$\text{cost} = \text{dp}[l-1][j] + \text{slack}^2 \cdot 1000 + \text{overflow}^2 \cdot 100000 + \text{hyphenPenalty} + \text{breakPenalty}$$
  Monotonic advance cutoff guarantees execution in $< 0.2\text{ms}$.
- **`largestFittingFontSize`**: Efficient non-monotonic font search executing $\le 18$ layout evaluations total ($\sim 1.5\text{ms}$).

### 3.3 Upstream Container Expansion Hardening
- In `BubbleLayoutService.ts`, rectangular container groups (`isRectangular === true`) now execute pairwise independent expansion into their respective carrier safe cores (`pairwiseClampBox`), preventing conjoined stepped caption boxes from aborting into 15px slivers.
- In `bubbleExpansion.ts`, the artificial `Math.min(expandedW, Math.round(textBox.w * 1.40))` clamp was removed, allowing dialogue to expand into the available chamber core bounded by sibling clearance.

### 3.4 Studio OCR & Retranslate Integration
- In `StudioOcr.ts`, `runStudioOcr` was extended with speech bubble detection and layout expansion:
  - Leases `BubbleManager` to acquire the active engine (`heuristic` or `neural`).
  - Executes `acquireBubbleGeometry()` and `resolveBubbleLayouts()`.
  - Computes carrier contour points and pre-typesets lines via `wrapTextContour()`.
  - Persists expanded dimensions, precomputed lines, and `typesetMode: 'contour'` to the emitted `TextObject`s.

### 3.5 Studio Editor Reflow & Rectangle Lifecycle
- In `src/studio/types.ts`, `TextObject` was updated with `contourPoints?: Point[]`.
- In `studioTypeset.ts`, text edits on an untouched bubble re-typeset against `contourPoints` using Koharu's 2D DP solver, keeping the natural organic bubble shape.
- Manual box resize creates a 4-point rectangle geometry; the exact same solver wraps against that 4-point rectangle smoothly.
- In `TypographySettings.tsx`, typeset modes were updated to include `'contour'` alongside legacy aliases for 100% backward compatibility.

---

## 4. Verification & Results

1. **Unit Test Suite**:
   - `contourTypeset.test.ts`: All 6 tests passed (polygon intersection, chord profiling, 2D DP line breaking, non-monotonic font search).
   - `bubbleExpansion.test.ts`: All 21 tests passed.
   - `BubbleLayoutService.test.ts`: All 24 tests passed.
   - `StudioOcr.test.ts`: All 41 tests passed.
   - `studioTypeset.test.ts`: All 31 tests passed.
   - `TypographySettings.test.tsx`: All 17 tests passed.
   - **Full Regression**: All 1,092 Vitest tests passed across 98 test files (0 failures).
2. **Production Bundle**:
   - `npm run build` completed cleanly in 5.00s with zero TypeScript compilation errors.
3. **Visual Smoke Test Deliverable (`image6.jpg`)**:
   - **Hasumi's Burst Balloon**: Produced a clean 9-line layout spanning top-to-bottom:
     ```
     I'll be the
     one to hold
     on here.
     Teacher,
     please
     retreat
     quickly and
     get reinfor-
     cements!
     ```
     Filling the burst balloon contour naturally, completely eliminating the pinched 6-line oval and empty dead space.
   - **Stepped Caption Panels**: Both top-left panels expanded into their respective whitespace cores without collapsing into unreadable slivers.
