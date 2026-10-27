# Route 3: Simple Rectangular Typesetting Specification

## 1. Overview & Purpose

**Route 3 (Simple Rectangular)** is the dedicated typesetting engine for rectangular manga text elements:
* Rectangular narration panels and translator caption boxes.
* Signboards, sound effects (SFX), and system text.
* Speech boxes where corner curvature analysis detects sharp $90^\circ$ corners (`!curvatures[i].isRounded`).

* **Implementation File**: [`src/offscreen/engines/typeset/SimpleRectTypesetter.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/engines/typeset/SimpleRectTypesetter.ts)
* **Underlying Layout Math**: [`src/offscreen/utils/contourTypeset.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/utils/contourTypeset.ts) (`wrapTextContour` with 4-point bounding quad)
* **Dispatcher**: [`src/offscreen/engines/typeset/TypesetStrategyFactory.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/engines/typeset/TypesetStrategyFactory.ts) (`mode: 'simple'`)

---

## 2. Mathematical Foundation & Geometry

### 2.1 Uniform 4-Point Rectangular Quad
Unlike speech balloons whose chords expand and contract with contour curvature, rectangular panels maintain constant horizontal span across the entire vertical height:

$$\text{Quad} = \begin{bmatrix} (0, 0) & (W, 0) \\ (W, H) & (0, H) \end{bmatrix}$$

For any scanline $y \in [0, H]$:
$$W(y) = W - 2 \cdot \text{inlineAir}$$

Where:
* $\text{DEFAULT\_INLINE\_AIR} = 4.0\text{px}$ (safety padding between text bounds and panel stroke border).

### 2.2 2D DP Table & Sentence Penalty Optimization
Line breaks are computed via a 2D Dynamic Programming table:

$$\mathbf{DP}[l][e] = \min_{s < e} \left( \mathbf{DP}[l-1][s] + \text{Cost}(s, e, \text{Profile}_l) \right)$$

Where the transition cost penalizes slack, overflow, and poor grammar breaks:

$$\text{Cost} = \text{slack}^2 \times 1000.0 + \text{overflow}^2 \times 1000000.0 + \text{Penalty}_{\text{grammar}}$$

* **Terminal sentence punctuation** (`.`, `!`, `?`): $\text{Penalty} = 0.0$
* **Clause breaks** (`,`, `;`, `:`): $\text{Penalty} = 20.0$
* **Conjunctions** (`and`, `but`, `or`): $\text{Penalty} = 40.0$
* **Preposition / Article orphans** (`in`, `of`, `the`, `a`): $\text{Penalty} = 300.0$
* **Normal inter-word break**: $\text{Penalty} = 100.0$

---

## 3. Font Size Probing & Selection Rules

1. **Font Floor**:
   $$\text{MINIMUM\_READABLE\_FONT\_SIZE} = 9.0\text{px}$$
   Text is never shrunk below 9.0px; tight captions break into more lines rather than rendering unreadable micro-glyphs.
2. **Font Ceiling**:
   $$S_{\text{max}} = \min(\text{maxFontSizeCap}, \lfloor H \times 0.60 \rfloor)$$
3. **Koharu Candidate Selection Comparator**:
   Candidate line layouts are ranked strictly:
   1. `overflowed: false` strictly beats `overflowed: true`.
   2. **Fewer lines strictly beats more lines** (`lines.length < current.lines.length`).
   3. Lower total break penalty cost breaks ties.

---

## 4. Difference from Route 2 (Contour DP) and Route 1 (Auto Balloon)

| Attribute | Route 1 (Auto Balloon) | Route 2 (Contour DP) | Route 3 (Simple Rect) |
| :--- | :--- | :--- | :--- |
| **Geometry** | Elliptical chord reflow | Arbitrary polygon scanline ray-casting | Fixed uniform rectangle |
| **Chord Variation** | Quadratic parabolic curve | 5-point ink band contour sampling | Constant $W - 2 \times \text{air}$ |
| **Ideal Target** | Unboxed free text & dialogue | Curved balloons & multi-lobe figures | Captions, cards, narration boxes |
| **Baseline Placement** | Centered inside AABB | Exact scanline baseline ($y_i$) | Centered inside AABB |
| **Line Pitch** | $1.20 \times \text{fontSize}$ | $1.25 \times \text{fontSize}$ | $1.25 \times \text{fontSize}$ |
