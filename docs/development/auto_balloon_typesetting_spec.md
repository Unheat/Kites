# Route 1: Auto Balloon Typesetting Specification

## 1. Overview & Purpose

**Route 1 (Auto Balloon)** is the default typesetting engine used when dialogue text does not have an active speech bubble segmentation contour (such as uncontained free text, background dialogue, or when bubble detection is in `Disabled` mode).

It is a 1:1 port of XianScan's diamond/elliptical reflow engine (`typeset.ts` / `builder.rs`) combined with Cotrans 2023 `measureDefaultLayout`.

* **Implementation File**: [`src/offscreen/engines/typeset/AutoBalloonTypesetter.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/engines/typeset/AutoBalloonTypesetter.ts)
* **Underlying Layout Math**: [`src/offscreen/utils/typesetLayout.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/utils/typesetLayout.ts)
* **Dispatcher**: [`src/offscreen/engines/typeset/TypesetStrategyFactory.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/engines/typeset/TypesetStrategyFactory.ts) (`mode: 'auto-balloon'`)

---

## 2. Mathematical Foundation & Geometry

### 2.1 Diamond / Elliptical Reflow Model
When text sits inside an unconstrained comic bubble, a rectangular wrap leaves large empty corners while overflowing the center. The Auto Balloon model calculates line capacities by modeling an inscribed ellipse inside the bounding box $(W, H)$:

For line index $k \in [0, N-1]$ out of $N$ total lines, the available width $W_k$ follows the chord equation:

$$W_k = W_{\text{max}} \cdot \sqrt{1 - \left(\frac{2k + 1 - N}{N}\right)^2}$$

Where:
* $W_{\text{max}} = W \cdot (1 - 2 \cdot \text{DEFAULT\_FIT\_INSET})$
* $\text{DEFAULT\_FIT\_INSET} = 0.05$ (reserving a 5% margin buffer from container boundaries)

### 2.2 Aspect Ratio Penalty
To prevent dialogue from forming unnaturally tall vertical columns or flat horizontal ribbons, each candidate line count $N$ is penalized by its deviation from the golden comic aspect ratio ($\approx 1.25$ to $1.40$):

$$\text{Penalty}_{\text{aspect}} = \left|\frac{W_{\text{eff}}}{H_{\text{eff}}} - 1.30\right| \times 200.0$$

---

## 3. Font Fitting Algorithm (Binary Search)

The engine fits the largest readable font size using a bounded binary search:

1. **Lower Bound ($S_{\text{min}}$)**:
   * Sourced from detected OCR font size or `options.minFontSize` (default `14.0px` for unconstrained dialogue, minimum `9.0px`).
2. **Upper Bound ($S_{\text{max}}$)**:
   * Bounded by `Math.min(Math.max(fontSize, 48.0), maxFontSizeCap)`.
3. **Height Budget**:
   $$H_{\text{required}} = N \cdot S \cdot \text{DEFAULT\_FIT\_LINE\_HEIGHT}$$
   Where $\text{DEFAULT\_FIT\_LINE\_HEIGHT} = 1.20$.
4. **Verification Predicate (`defaultLayoutFits`)**:
   At each probe, every line's measured advance must satisfy:
   $$\text{ctx.measureText}(\text{line}_k).\text{width} \le W_k$$
   $$H_{\text{required}} \le H \cdot (1 - 2 \cdot \text{DEFAULT\_FIT\_INSET})$$

---

## 4. On-Demand Multi-Language Syllable Hyphenation

Route 1 directly invokes [`src/offscreen/utils/hyphenation/HyphenationService.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/utils/hyphenation/HyphenationService.ts) during line breaking:
* Uses the **Franklin Mark Liang** TeX hyphenation trie.
* Queries on-demand pattern dictionaries stored in `public/assets/hyphenation/*.txt`.
* Words with length $\ge 7$ characters are broken at valid syllable points when an unbroken word would exceed $W_k$.
* Discretionary hyphens (`-`) are appended with measured hyphen offset width.

---

## 5. Failure Recovery & Fallback

If binary search fails to find a zero-overflow configuration at $S_{\text{min}}$:
1. Falls back to $S_{\text{min}}$ with greedy character wrapping.
2. If text contains non-Western scripts (CJK / Arabic / Thai), delegates to [`renderTextBlocksLegacy`](file:///Users/dangtruongan/study/Kites/src/offscreen/utils/canvasTypesetting.ts) for orientation-aware vertical line layout.
