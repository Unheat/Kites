# ADR-006: Hybrid Bubble Detection & Conservative Sub-Chamber Partitioning

## Status
Accepted

## Context
In manga and comic translation, original CJK (Japanese, Chinese, Korean) dialogue lines are frequently oriented vertically in narrow columns measuring only 20–30px wide.

Historically, translation systems faced three critical typographical failure modes:
1. **Font Size Collapse (Teo chữ):** Translated horizontal English/Vietnamese text requires significantly more width than vertical CJK logographs. Constraining layout to the narrow 25px OCR strip forced word-wrapping every 1–2 words, driving font sizes down to an unreadable 5–7px despite ample empty white space inside the speech balloon.
2. **Optical Decentering:** Original dialogue is often drawn off-center inside the balloon. Rendering inside the unexpanded OCR box placed translated text off-balance instead of centered within the balloon's visual chamber.
3. **Multi-Utterance Balloon Collisions & Diagonal Slits:** Connected or staggered speech balloons (figure-8, gourd-shaped, or vertically staggered lobes) contain multiple distinct utterances. Naive expansion caused sibling boxes to balloon into the full shared chamber, collide, and re-center on the shared container center, dragging text into balloon waists, character hair, and background artwork. Unconditional axis slicing (SAT dividers) caused diagonal staggered pairs to be sliced vertically into unusable 33px slits.

## Decision
Establish the **Hybrid Bubble Detection & Conservative Sub-Chamber Partitioning Architecture**:

### 1. Dual-Route Separation
- **Dialogue in Speech Balloons:** Top-down container extraction pipeline detects the balloon chamber (Tier 1 Heuristic or Tier 2 Neural YOLO), insets a 12% safe core, and expands text horizontally to utilize available chamber space.
- **Free-Floating Text & Sound Effects:** Bottom-up Cotrans MST merge preserves tight bounding hulls with zero expansion.
- **Inpainting Isolation:** Inpainting models (`LaMa`, `SimpleInpaint`) strictly receive original character contour polygons (`rawPolygons`), never expanded bubble boxes.

### 2. Neural Bubble Detector Hardening
- `NeuralBubbleDetector` exclusively admits class `0: bubble` proposals. Classes `1: text_bubble` and `2: text_free` are strictly filtered out to prevent tight OCR text boxes from being misclassified as bubble containers.

### 3. Unified Layout Resolution (`BubbleLayoutService`)
Production and test pipelines invoke the identical `BubbleLayoutService`:
- **Single-Occupant Balloons:** Expand into the 12% safe core (`computeTypesetBox`), verified by canvas font measurement (`measureBubbleLayoutFontSize`).
- **Connected Multi-Lobe Balloons:** Sliced into independent territories along clean single-axis X or Y boundaries **only** when unambiguous neck/lobe morphology is proven and positive clearance ($\ge 6\text{ px}$) exists.
- **Conservative Fallback to Disabled:** When multi-utterance geometry is diagonal, rotated, overlapping across both axes, or lacks clean separation, the entire group rolls back atomically to `typesetBox = undefined` (the exact Disabled tier: Cotrans MST + utterance splitting). This guarantees zero text clipping or slit distortion.

### 4. Renderer Geometry Lock
- Accepted `typesetBox` rectangles are rendered axis-aligned (angle 0°) and strictly bypass font-floor quad ballooning and global decollision translation shifts, preserving exact layout geometry and Dexie persistence parity.

## Consequences
### Positive
- **Readable Typography:** Single speech balloons expand horizontally to allow natural horizontal word wrapping at comfortable, readable font sizes (12–15px).
- **Zero Hallucinated Slits:** Diagonal multi-lobe bubbles that cannot be cleanly divided along simple axes safely fall back to the clean baseline without horizontal crushing.
- **Rock-Solid Safety:** Exact Disabled fallback guarantees that complex or ambiguous cases never produce worse visual outcomes than the proven baseline.

### Trade-offs
- Diagonal multi-utterance bubbles (e.g. 45° figure-8 lobes) do not expand and retain their unexpanded baseline sizes until future curved-mask layout is implemented.
- Requires dual-pass orchestration (geometry acquisition before translation, layout resolution and font measurement after translation).

## Alternatives Considered
- **109 MB Segmentation Models (YOLOv8m-seg):** Rejected due to massive download footprint, restrictive copyleft licensing (GPL-3.0 / AGPL-3.0), and wavy contour artifacts. Deferred to Future Work (YOLO11n Manga109 11.85 MB ONNX).
- **Greedy 8-Neighbor Max-Min Pixel Walk:** Rejected because local distance maximization does not ensure semantic separation, reachability, or rectangular layout capacity.
- **Unconditional Axis Slicing:** Rejected because splitting diagonal lobes with vertical dividers produced degenerate 33px narrow columns.
