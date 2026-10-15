# Devlog 043: Phase 43 — Real Alexandru Telea FMM, Precise Fill Tier, and Centralized Inpaint Catalog

## Date: 2026-10-15
## Scope: PR #22 (Merged to `main`)

---

## 1. Problem Context & Root Cause Analysis

### A. The Pseudo-Telea Inpainting Engine Flaw
The existing `TeleaInpaintEngine.ts` was an incomplete port of `pyheal`:
- Stored items in a plain FIFO queue (`Uint32Array`), advancing the boundary via standard topological BFS rather than a Priority Queue.
- Did not implement the Eikonal PDE solver $|\nabla T| = 1$.
- Dropped the directional factor $dir(p, q)$ and level set factor $lev(p, q)$, retaining only $1/d^3$ as an unnormalized cubic distance weight.
- When full 1st-order Taylor image gradients ($\nabla I \cdot r$) were initially added, unconstrained edge gradients ($\sim 200$) multiplied by distance $r \in [1, 3]$ caused arithmetic explosion ($\pm 400$), resulting in extreme neon magenta/cyan rainbow fringing and zebra striping across high-contrast edges.

### B. The White Ghost Text Artifact
In manga, artists frequently draw a 1–2px white outline (*fuchidori*) around black text to contrast against tinted or shaded speech bubbles (e.g. lavender paper).
- The original fixed 2px binarizer dilation stopped inside the artist's white outline.
- Boundary diffusion algorithms ($w \propto 1/d^2$) sample strictly what touches the mask edge; because every pixel bordering the mask was white outline, Telea diffused white into the text core, creating solid white ghost characters.

### C. Architectural Violation: Hardcoded Inpaint Tier Lists
Inpaint tiers were hardcoded independently across 6 files:
1. `InpaintManager.ts` (backend factory switch)
2. `StudioEngineSelector.tsx` (`INPAINT_ENGINE_OPTIONS`)
3. `EngineSelectionPanel.tsx` (`inpaintBaseEngines`)
4. `StudioOcr.ts` (`INPAINT_TIERS`)
5. `src/background/index.ts` (`supportedInpaintIds`)
6. `src/offscreen/index.ts` (`handleCheckStatus`)

---

## 2. Technical Implementation & Mitigations

### A. Real Alexandru Telea (2004) Fast Marching Method (`TeleaInpaintEngine.ts`)
- **Flat Typed-Array Min-Heap (`MinHeap`)**: Zero-allocation priority queue backed by `Float32Array` values and `Int32Array` coordinates with dynamic resizing.
- **Eikonal PDE Solver (`solveEikonal`)**: Upwind quadratic solver across 4 quadrants to advance wavefront by exact geodesic arrival times $T$.
- **Distance Field Normal $\nabla T$**: Interface normal $N = \nabla T$ evaluated via central/one-sided differences on the arrival time field.
- **Full 3-Factor Weighting**:
  $$w = \left|\frac{p - q}{d} \cdot \nabla T\right| \cdot \frac{1}{d^2} \cdot \frac{1}{1 + |\Delta T|}$$
- **0th-Order Color Average (Pyheal-Aligned)**: Dropped unconstrained Taylor term to eliminate rainbow fringing and high-contrast color divergence while preserving smooth gradients.
- **1-Pixel Padded Boundary**: Outer buffer eliminating bounds checking branches inside inner convolution loops.

### B. Cotrans-Aligned Dynamic Dilation (`Binarizer.ts`)
- Replaced fixed radius and oversized polygon ratio with Cotrans 2023 dynamic font scaling:
  $$\text{dynamicRadius} = \text{clamp}(2, 5, \text{round}(\min(w, h) \times 0.12))$$
- Small dialogue text (15px) scales to 2px, while standard dialogue (25–40px) scales to 4–5px, cleanly swallowing artist white outlines (*fuchidori*) without merging adjacent vertical text columns into solid blobs.
- Fixed strict inequality bug (`g < otsuThresh` to `g <= otsuThresh`) so Otsu threshold 0 correctly identifies dark ink.

### C. New Inpaint Tier: Precise Fill (`StrokeFillInpaintEngine.ts`)
- Subclasses `SimpleInpaintEngine` adhering to Open/Closed Principle.
- Synthesizes a stroke-level mask via `Binarizer` and delegates to `SimpleInpaintEngine.inpaint(buf, poly, strokeMask)`.
- Replaces only the text ink strokes with the dominant median background color while leaving surrounding manga artwork, panel borders, and bubble textures untouched.

### D. Centralized Inpaint Catalog (`src/shared/inpaintTiers.ts`)
- Created canonical `INPAINT_TIER_CATALOG`:
  1. `none`: None (Bypass)
  2. `simple`: Simple Fill (Fast Color — full bounding box)
  3. `stroke-fill`: Precise Fill (Text Stroke — binarized glyph fill)
  4. `telea`: Telea Diffusion (Fast Diffusion — FMM gradients)
  5. `lama-manga`: LaMa Manga (Neural Dynamic)
  6. `aotgan`: AOT-GAN (Neural High-Detail)
- All UI selectors (`StudioEngineSelector`, `EngineSelectionPanel`) and backend routers (`background`, `offscreen`, `StudioOcr`) derive their options directly from this catalog.

---

## 3. Verification & Metrics

- **Unit Tests**:
  - `TeleaInpaintEngine.test.ts`: 13/13 tests passed.
  - `StrokeFillInpaintEngine.test.ts`: 3/3 tests passed.
  - Full suite: **74 test files, 723/723 tests passed**.
- **Production Build**: `npm run build` completed in 1.96s with 0 errors.
- **PR Status**: Merged via PR #22 to `main` (`1d0852b`).
