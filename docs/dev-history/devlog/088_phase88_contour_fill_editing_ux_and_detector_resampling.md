# Devlog 088: Contour Fill Sizing, Contour Selection Geometry, Slider Undo Transactions, and Detector Resampling

### 1. Metadata
* **Date:** 2026-10-29
* **Feature/Task:** Four user-reported improvements — fill-oriented contour sizing, contour selection/paint alignment, one-undo-per-slider-gesture with disabled contour line space, and high-quality detector downsampling
* **Branch:** `feat/contour-fill-and-editing-ux`
* **Status:** Completed (1282 tests / 116 files, typecheck/build/lint green)

---

### 2. The Objective
After the contour port and shared-chamber fixes, the user accepted the donor's behavior as baseline but asked for four deliberate improvements: (1) let long words hyphenate above the 9 px floor when the split buys visibly larger text; (2) make Studio's inline selection highlight, caret, and click mapping follow the contour-painted lines and let a sized range reflow inside the contour instead of spilling; (3) collapse slider drags into a single undo entry like canvas drag handles, and grey out the ineffective contour Line Space control; (4) improve the OCR detector's downsampling quality.

### 3. Root Causes

1. **Sizing:** the donor's global clean-first search returns immediately when `floor(clean) > floor(minimum)` (layout.rs:387–433), so a clean fit above 9 px never competes with a much larger hyphenated layout. Ported faithfully — donor behavior, not a Kites bug.
2. **Selection:** the inline `<textarea>` lays text out uniformly (`fontSize × lineSpacing`, box-derived padding), while the Canvas paints solver-positioned lines — so the native blue highlight drifted off the painted text and later lines could sit outside the textarea's reachable rows. Additionally, `canUsePositionedLines` bailed to rectangular layout whenever any `charStyles` entry existed, so sizing one selected range switched the whole block to full-width uniform layout — the giant spill.
3. **Undo:** `updateSelected` pushed an undo entry on every slider `onChange`, so one drag flooded the 50-entry stack with micro-steps (canvas drag handles already commit once at pointer-up from a gesture snapshot).
4. **Resampling:** `ppu-paddle-ocr` preprocessing resizes through plain `drawImage` without setting `imageSmoothingQuality`, so large pages downscale with the browser's lowest-quality default.

### 4. Implementation & Architecture

**Contour fill policy (Kites extension, donor core untouched):**
- `contour/fontSearch.ts` gains `searchFillPolicy`: search the largest clean fit AND the largest fit allowing discretionary breaks (per-size clean-first preserved), pick the split only when `hyphenated.fontSize > clean.fontSize × (1 + CONTOUR_FILL_MIN_GAIN)` (0.15, Kites constant). Donor tail preserved when nothing fits.
- `WrapContourOptions.sizingPolicy: 'donor' | 'fill'`; `wrapTextContour` defaults to `donor` (Simple Rect unchanged). `ContourDpTypesetter` defaults the contour route to `fill` via `DEFAULT_CONTOUR_SIZING_POLICY`, so pipeline acceptance, final render, and Studio reflow agree automatically; Studio's direct `wrapTextContour` contour path passes `sizingPolicy: 'fill'` explicitly.

**Contour selection geometry:**
- `TextRenderer.canUsePositionedLines` no longer rejects `charStyles`; `renderPositioned` gains a styled-runs branch (reuse of `decomposeLineIntoStyledRuns`) that paints runs chord-centered at the solver baselines — a sized range now reflows inside the contour.
- New `contourInlineEditing.ts`: exact per-character rectangles from `positionedLines` (same chord-centering formula as the painter; display-cased glyph advances; `charStyles` fonts), containment hit-testing (`charIndexFromPoint`), and word selection (`wordRangeAt`). Offsets address the raw editor text; the overlay activates only when the editor value's line structure matches the placements 1:1 (healed hyphen text keeps native behavior).
- New `ContourSelectionOverlay.tsx`: paints merged selection runs and a blinking caret at exact geometry, owns pointer selection (down/drag/up with pointer capture, shift-free drag anchor, double-click word select); the textarea becomes pointer-transparent with invisible caret/selection in that mode and keeps keyboard editing (Ctrl+A now highlights every painted line, including the below part).

**Slider undo transactions:**
- `updateSelected` accepts `{ transient }`; TypographySettings opens a gesture snapshot on `pointerdown` (or first change), updates transiently per frame, and commits one undo entry on `pointerup`/`pointercancel`/`blur`/final `keyup` — same contract as the canvas drag handles. Applied to Size, Line Space, and the Rotation slider (the rotation slider had the same per-frame problem as the drag handle it mirrors).
- Line Space is disabled with an explanation when the effective mode is contour (except vertical CJK columns, which still consume `lineSpacing` through the vertical branch).

**Detector resampling:**
- New `DetectionResize.ts`: replicates the dependency's resize formula (documented same-formula adaptation; the helper is not exported), resamples once with `imageSmoothingQuality: 'high'` into the exact unpadded target canvas so the dependency's internal draw is 1:1, and returns true original dimensions plus the original-to-model ratio — `CustomPaddleDetector` restores those on the preprocess result because the dependency recomputes `resizeRatio` from whatever canvas it receives. Padding, CHW normalization, 32px rounding, and recognition crops are unchanged; images within the limit pass through untouched.

### 5. Testing & Verification
- Fill policy: donor bucket semantics regression-tested alongside new suite — split above floor accepted, negligible/exact-threshold gain keeps clean, overflow-only split rejected, clean-never-fits and nothing-fits tails; forwarding tests assert contour route defaults to `fill`, explicit `donor` override wins, and Simple Rect stays donor.
- Geometry: chord-centered cell math (including per-char font overrides), hit-test containment and line-end caret, word ranges, mismatch fallback; overlay tests — full-selection runs reach the second line, pointer drag maps exact offsets with visible caret, double-click word select.
- Painter: styled runs stay on the positioned path (per-run fills at chord-centered X, solver baselines) instead of rectangular fallback.
- Sliders: a two-frame drag commits one undo entry restoring the pre-gesture state; keyboard release commits once and empty gestures record nothing; contour Line Space disabled with copy, vertical CJK contour stays enabled.
- Detector: exact 1280×1808→680×960 and 700×989→679×960 formulas, pass-through within limit, high-smoothing single draw with correct source/dest rects, ratio/original-dimension restoration contract.
- Full suite 1282 tests / 116 files; typecheck, build, lint green (75 pre-existing warnings).

### 6. Next Steps / Key Takeaways
1. Studio visual QA: sized range inside a contour (no spill), Ctrl+A highlight reaching the last line, slider Ctrl+Z restoring in one step, and the greyed contour Line Space.
2. Detector quality: run the controlled page comparison (default vs high smoothing vs a named Lanczos filter) before judging recall; the adapter is deliberately isolated so the experiment is one injection point.
3. Key lesson: two producers of one geometry (painter vs editor) must share a source of truth; deriving the overlay from the solver's placements — not approximating the textarea to match — is what makes selection, caret, and hit mapping exact.
