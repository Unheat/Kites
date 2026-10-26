# Devlog 070: Strict 3-Route Typesetting Engine Decoupling, Burst Balloon Contour Profiling, and Torii Parity

### 1. Metadata
* **Date:** 2026-10-25
* **Feature/Task:** Complete 3-Route Engine Decoupling (`balloon` vs `ellipse` vs `simple`), Burst Balloon Width Profiling, and Torii DP Parity
* **Status:** Completed
* **Branch:** `feat/3tier-typeset-decoupling-and-torii-parity`

---

### 2. The Objective
Investigate and resolve why speech bubble typesetting rendered in a pinched 6-line oval with 55% dead space on spiky burst balloons (e.g. Hasumi in `image6.jpg`), whereas Torii adapted to the burst balloon contours with a flat-ended 7-line cylindrical layout. Establish strict architectural isolation across all 3 typesetting engines:
1. **Route 1 (`balloon` / Auto Balloon)**: Dedicated to `disabled` mode on raw OCR quads and Studio Auto Balloon. XianScan 4-pass downward search, syllable hyphenation, diamond envelopes, and elastic quad decollision. Never touches ellipse chord math.
2. **Route 2 (`ellipse` / Bubble Ellipse)**: Dedicated to active bubble tiers (`heuristic`, `neural`, `neural-mask`) on curved bubbles. Torii 2-phase DP solver, aspect error and unevenness minimization, strict `looksRound` gating, horizontal width profiling ($0.25\dots 0.30$ strength for burst balloons, $0.85\dots 1.0$ for ovals), and `shrinkFontTowardWidth` give-back.
3. **Route 3 (`simple` / Simple Wrap)**: Dedicated to rectangular caption/narration boxes (`fillRatio >= 0.88`, `isRounded: false`), Studio Simple Wrap, and Ellipse overflow fallback at `minFontSize`. Bounded greedy rectangular wrap with Kinsoku Shori line-start barring.

---

### 3. Implementation Steps

1. **Circularity & Vertical End-Ratio Profiling in `BubbleLayoutService.ts`:**
   - Sampled carrier mask horizontal widths at 10% ($W_{\text{top}}$), 50% ($W_{\text{center}}$), and 90% ($W_{\text{bottom}}$) of vertical height to determine `endRatio = (W_top + W_bottom) / (2 * W_center)`.
   - Partitioned bubble contours:
     - Spiky burst balloons (`endRatio >= 0.65`): set `borderRadius = Math.round(rMax * 0.30)`, generating a cylindrical profile with 88% chord width at the top and bottom.
     - Smooth ovals (`endRatio < 0.65`): set `borderRadius = Math.round(rMax * 0.90)`.
     - Rectangular captions (`fillRatio >= 0.88` or `endRatio >= 0.95`): set `isRounded = false, borderRadius = 0`, routing directly to Route 3 Simple Wrap.

2. **Torii DP Solver Hardening & Font Give-Back in `ellipseTypeset.ts`:**
   - Enforced strict `looksRound` on grown candidates: `} else if (looksRound && widest <= maxWidth && (!bestRoundGrown || score < bestRoundGrown.score)) {`.
   - Implemented `shrinkFontTowardWidth`: when a layout candidate grows wider than `targetWidth`, font size steps down 1px at a time toward `minFontScale = 1 - (1 - 0.8) * strength` (up to 20% font shrink at strength 1.0), pulling ink width back inside `targetWidth` before widening.
   - Guarded CJK and unspaced writing systems with `NO_SPACE_SCRIPT_RE` and `isNoSpaceScriptChar`: prevents artificial whitespace insertion between ideographs while preserving opening marks (`「`, `（`, `¿`, `¡`).
   - Restored soft hyphen healing in `unwrapWrappedText` for standard ASCII word breaks (`com-\nmunity` -> `community`) while preserving multi-newline paragraph breaks (`\n\n`).

3. **Unified 3-Route Dispatch in `cotransDefaultRenderer.ts` & `canvasTypesetting.ts`:**
   - Added `typesetMode?: 'balloon' | 'ellipse' | 'simple'` to `DefaultRenderRegion` and `TextBlockItem`.
   - Structured 3-way dispatch:
     - `typesetMode === 'ellipse'` or `(isRounded && typesetMode !== 'balloon' && typesetMode !== 'simple')`: Route 2 Ellipse DP.
     - `typesetMode === 'simple'`: Route 3 Simple Rectangular Greedy Wrap (`strength: 0`).
     - Default fallback: Route 1 Auto Balloon XianScan Diamond Reflow (`measureDefaultLayout`).

4. **Studio Editor Dispatch & `roundFit` State Scrubbing in `studioTypeset.ts`:**
   - Added `roundFit: { width, fontSize, fittedWidth?, fittedFontSize? }` to `TextObject`.
   - In `reflowTextObject`: when scrubbing the radius slider, restores starting `width` and `fontSize` from `roundFit` before refitting, ensuring dragging back to 0 completely restores the box without ratcheting or dimension decay.
   - Excluded `typesetMode` from `LAYOUT_FIELDS` so changing engine mode reflects editing intent without prematurely re-measuring untouched lines.

---

### 4. Verification & Results

1. **Unit Tests**:
   - All 21 tests in `ellipseTypeset.test.ts` pass, including CJK tokenization and `shrinkFontTowardWidth`.
   - All 48 tests in `studioTypeset.test.ts` and `TypographySettings.test.tsx` pass.
   - Complete project test suite: **96 test files passed, 1061 unit tests passed**.
2. **Build Check**:
   - `npm run build` completed in 2.56s with 0 errors.
3. **Pipeline Visual Bubble Test**:
   - In `image6.jpg`, Hasumi's burst balloon (`endRatio = 0.72`) is detected with `borderRadius = 17` ($strength = 0.34$), rendering a clean 7-line layout ($15\text{px}$, $99.0\text{px} \times 131.3\text{px}$) fitting 100% inside the white bubble boundaries without spiky overflow.
   - In the `disabled` tier, Hasumi's balloon renders in Route 1 Auto Balloon XianScan reflow ($14\text{px}$, 10 lines) spanning top-to-bottom.
