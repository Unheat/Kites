# ADR-007: Alexandru Telea Fast Marching Method (FMM) Inpainting & Centralized Inpaint Catalog

## Status
Accepted

## Date
2026-10-14

## Context
In manga translation, erasing original Japanese text strokes prior to rendering translated dialogue is critical to prevent ink bleed-through.

Historically, Kites offered an all-or-nothing trade-off:
1. **Simple Inpaint (Dominant Color Fill):** Evaluated inside-polygon luminance and filled entire convex polygons with a flat median color. While microsecond-fast with a 0MB download footprint, flat fills erased screentones, speech balloon border art, and textured backgrounds behind text.
2. **Neural Inpainting (LaMa / AOT-GAN):** Generative deep learning models that hallucinate complex textures, but require downloading 30–100 MB of ONNX model weights and consume substantial WebGPU memory or 5–10s on WASM CPU.

Furthermore, inpaint options, tier identifiers, and feature metadata were previously duplicated across popup UI components, offscreen engine routers, and background state validators, violating the architectural principle of a Single Source of Truth.

## Decision

### 1. Implement Native Alexandru Telea Fast Marching Method (FMM)
Implement the Alexandru Telea (2004) image inpainting algorithm in pure TypeScript (`TeleaInpaintEngine.ts` / `telea.ts`) to provide an instant, 0MB inpainting tier:
- Uses the Eikonal equation $|\nabla T| = 1$ solved via a binary min-heap narrow-band priority queue.
- Propagates boundary image gradients smoothly inward along the distance transform wavefront.
- Runs in 15–50ms per bubble on standard CPU threads without WebGPU dependencies or external WASM binaries.

### 2. Wire Otsu Binarizer Stroke Masking to Telea
Rather than inpainting the entire bounding rectangle:
- Otsu's adaptive thresholding isolates text ink pixels from speech balloon paper.
- Text stroke masks are dilated dynamically (2–4px expansion based on font metrics).
- Telea inpainting diffuses surrounding pixels inward strictly over the stroke mask, completely preserving speech balloon contours, background line art, and screentone patterns.

### 3. Eliminate Taylor Series Gradient Explosion
Classical Telea FMM relies on first-order Taylor expansion approximations:
$$I(p) = I(q) + \nabla I(q) \cdot (p - q)$$
Where normalized gradients $\frac{\nabla T}{|\nabla T|}$ determine direction. Near boundary corners or zero-distance gradients, dividing by small norms caused Taylor gradient explosion (producing `NaN`/`Infinity` pixel artifacts and infinite narrow-band loops).
- Added an epsilon guard ($\epsilon = 10^{-6}$) and clamped gradient vectors.
- Enforced boundary checks preventing pixels outside the bounding crop from destabilizing the narrow band.

### 4. Canonical Single Source of Truth (`inpaintTiers.ts`)
Created `src/shared/inpaintTiers.ts` defining `INPAINT_TIERS`:
- Single canonical definition of all supported tiers (`simple`, `telea`, `lama-manga`, `aot-gan`, `none`).
- Strict invariant type derivation via `(typeof INPAINT_TIERS)[number]['id']`.
- UI selectors, background state sanitizers, and offscreen factory routers derive directly from this catalog, enforcing compile-time exhaustiveness.

## Consequences

### Positive
- **0MB Download Footprint:** Telea provides high-fidelity, line-preserving inpainting out-of-the-box with zero network downloads.
- **Line Art & Screentone Preservation:** Binarized stroke masks prevent destructive clipping of balloon outlines and hair.
- **Architectural Hygiene:** Centralized catalog eliminates magic strings and ensures all UIs and backend routers update in lockstep.
- **Numerical Stability:** Elimination of Taylor explosion ensures deterministic, crash-free execution across all browsers.

### Trade-offs
- **Diffusive Nature:** Because Telea solves a Laplace-type harmonic diffusion equation, extremely large missing regions ($>150\text{px}$) may exhibit mild softening or blur compared to generative neural inpainters (LaMa). It is optimal for text strokes and speech bubbles rather than full-scene reconstruction.

## Alternatives Considered
- **Navier-Stokes Fluid Dynamics Inpainting (Bertalmio et al.):** Slower convergence than Telea; introduces rotational blur artifacts around text glyphs.
- **PatchMatch Texture Synthesis (Barnes et al.):** Heavy CPU/memory overhead; randomized patch sampling can introduce jarring, mismatched texture seams inside comic speech balloons.
- **Retaining Only Simple and Neural Tiers:** Leaves non-WebGPU and bandwidth-constrained users with suboptimal flat color boxes.
