# Phase 82 — Evidence-validated heuristic chamber discovery

**Date:** 2026-10-28
**Branch:** `feat/heuristic-joined-bubble-and-typeset-centering`

## Problem and corrected donor assumptions

The earlier heuristic associated carrier rectangles before proving they represented bubbles.
IoU grouped some duplicate local extractions but could neither discover missing lobes beyond
local crops nor reject enclosed-looking gradient artwork. Force-whitening whole OCR rectangles
also erased outlines, while copying the mask with the greatest active pixel count ignored scale
and could give a sibling a mask outside its coordinate domain.

XianScan's `region_builder/expansion.rs:185–204` uses IoU >= 0.5 on neural detector bubble boxes
for sole/shared occupancy; only sole occupants receive image-based carrier refinement.
Its `ml/inpaint/shrinkwrap.rs` uses outside connectivity to protect strokes during white-bubble
cleanup, **within a neural-provided bubble box**. Neither algorithm is a standalone semantic
heuristic bubble detector. Kites adapts these principles; it does not claim exact detector parity.

## Boundary-preserving discovery

All new processing is under `src/offscreen/engines/bubble/heuristic*` and called exclusively by
`HeuristicBubbleExtractor` / `HeuristicBubbleEngine`. The shared
`severTailOnBinaryMask` implementation, `NeuralBubbleEngine`, `bubbleGeometry.ts`,
`BubbleLayoutService`, and Koharu flow-cell partitioning are unchanged.

1. Sample original pixels in a native-resolution crop using the existing adaptive polarity
   and luminance classifier. Select the observed paper component with greatest OCR-area support;
   the OCR centroid may lie on ink and is not a reliable paper seed.
2. Inspect its original, pre-erosion frontier. If it reaches an artificial crop edge, grow
   that side geometrically and inspect the additional real pixels. No text-distance threshold
   decides bubble identity. Resource ceilings (2,000,000 native pixels and 10 passes) are
   rejection conditions, never artificial walls certifying closure.
3. Fill enclosed glyph holes by complement/exterior flood fill. Do not stamp OCR rectangles
   into the mask and do not classify every black pixel as an outline. Independent observed
   paper cavities remain protected; tiny letter counters are distinguished from independent
   regions by a glyph-relative area bound.
4. Require OCR-area coverage >= 0.6, a supported local contrast boundary, and stable shape
   under a bounded luminance perturbation. The perturbation uses 24 channel levels within
   the existing 35-level adaptive allowance; it is a tuned validation tolerance, not donor
   mathematics. ±8 accepted gradient/screentone artwork on the frozen page; ±35 rejected
   genuine burst balloons. ±24 rejects the reported artwork while preserving the selected
   real balloons. These are fixture observations, not universal accuracy claims.
5. Components touching a physical page edge remain ambiguous and use normal OCR-region
   rendering. This intentionally loses some cropped-balloon expansion rather than accepting
   a page edge as a drawn outline.
6. Only after native-pixel validation, bound the geometry raster for contour/tail processing.
   Tail opening runs from all supported utterance seeds and unions their carrier fragments
   inside the same verified component, retaining both lobes. Small verified cavities that
   disappear under opening retain the validated mask, not an invented OCR rectangle.

Opening by reconstruction was not substituted: full reconstruction can reintroduce connected
thin tails. Marker-controlled watershed was considered but not added; it allocates territories,
not bubble semantics. No new OpenCV runtime dependency or dynamic CSP-incompatible import is used.

## Shared-chamber identities and unchanged partitioning

`heuristicChamberAssociation.ts` uses the existing Graph connected-components utility, fixing
pairwise proposal rewriting that could split two previously associated groups. Evidence-bearing
merges require explicit `validatedComponent: true`, coordinate-domain containment and >=0.6
OCR-area mask support. Same validated component identity directly associates members; IoU >=0.5
reconciles independently discovered complete components with supporting evidence. Synthetic
shape-free tests retain the bare inclusive bbox threshold.

No active-mask-pixel ranking or arbitrary bbox union constructs a common balloon. A group shares
one validated mask supporting every member. Otherwise it retains independent evidence. Native
origin and separate scaleX/scaleY remain intact. Accepted component reuse is deterministic by
spatial seed ordering, never by the incoming OCR array order; rejected/incomplete candidates are
not cached as completed bubbles.

The engine emits one proposal reference per accepted group. The existing tier-blind resolver
still performs topological neck decomposition / Voronoi flow cells and rectangular caption
partitioning. OCR utterances and reading order remain separate. No forced horizontal stacking,
page-wide Voronoi clipping, vertex clamping, or screenshot-specific box geometry is introduced.

## Reproducible evidence

`src/test/fixtures/` freezes image6 OCR from v6-medium and v6-small, an explicit transcription
mapping with uncertainty notes, and neural baseline geometry/masks/layout/renderer outputs.
Source page: `src/test/test-img/image6.jpg`, 888×1214. These are inference fixtures, **not
hand-labeled segmentation ground-truth masks**. No mask IoU or universal precision statistic is
inferred from donor rendered images.

Synthetic tests cover incomplete-crop expansion, one-dimensional gray leakage, pixel budgets,
glyph/outline contact, dark balloons, gradient contours, exact IoU boundaries, graph bridges,
permutations, fractional origins and different mask scales.

On the frozen medium-OCR page, current discovery accepts indices
`1,2,3,4,6,7,9,10,11,12,13,14`. Pairs `1/2` (stepped top-right balloon), `3/4` (top-left columns)
and `12/13` (lower joined balloon) share component/proposal identities. Free captions `16/17/18`,
SFX `8`, and noisy artwork seeds `0/5` receive no bubble carriers. The genuine small chamber
`15` (`明白！`) is conservatively rejected as unstable; its text stays on the OCR-region route.

The browser diagnostic page `src/test/heuristic-browser-check.html` uses the actual engine,
resolver, CC Wild Words web font and `renderTextBlocksBatch`; it confirms the same accepted
indices and all three joined pairs in browser Canvas. It is a diagnostic view with simplified
clearing for selected text, not full extension/offscreen end-to-end certification. The registered
browser backend is in-app Chromium, not an external Chrome MV3 extension session.

The frozen neural differential harness compares geometry, layout and actual rendered pixels.
Fast precomputed run: 19/19 matching OCR regions, zero divergent pixels against the captured
baseline. This validates the selected page and pinned inputs, not every possible neural page.

## Known limits and acceptance scope

- Closed artwork can be topologically indistinguishable from a bubble. Boundary/stability checks
  reduce this class of error but do not supply learned semantic recognition.
- Broken outlines and paper regions separated by glyph-to-outline connections can conservatively
  fail discovery. No broad closing repairs unknown gaps across artwork.
- Physical-page truncation and budget exhaustion deliberately decline bubble expansion.
- Small `明白！` chamber remains an explicit false negative in this fixture.
- The reusable core tests and frozen page are separate from optional real-model visual runs;
  network translation and production services are not required for deterministic checks.

## Sources

- Local XianScan `src/ml/detect/detector.rs`, `src/pipeline/region_builder/builder.rs`,
  `src/pipeline/region_builder/expansion.rs`, `src/ml/inpaint/shrinkwrap.rs`.
- OpenCV marker watershed: https://docs.opencv.org/4.x/d3/db4/tutorial_py_watershed.html
- Morphological reconstruction reference:
  https://scikit-image.org/docs/stable/api/skimage.morphology.html#skimage.morphology.reconstruction
