# Route 3: Simple Rectangular Typesetting Specification

## 1. Overview & Current Scope

**Current-code audit: 2026-10-28, cumulative `origin/main..main` through `656d720`.** The earlier uniform-width and font-ceiling formulas were simplified design descriptions. Current backend and Studio edit behavior differ as described below; neither establishes end-to-end pixel parity.

Simple Rect targets caption/narration rectangles and explicit simple fixed regions **without** an active contour. Source files:

- `src/offscreen/engines/typeset/SimpleRectTypesetter.ts`.
- `src/offscreen/engines/typeset/TypesetStrategyFactory.ts`.
- `src/offscreen/utils/contourTypeset.ts`.
- `src/studio/canvas/studioTypeset.ts` (Studio edit behavior).

The factory gives fixed contours priority, even when `typesetMode` is `simple`. Therefore a rectangular-looking object, a mode label, or a visible stored outline alone does not identify the solver used. See [Studio architecture](../architecture/studio-and-typesetting.md).

## 2. Offscreen Strategy: Rectangle Through Contour DP

`SimpleRectTypesetter.typeset()` preserves authored line breaks and constructs the box-local quad `(0,0), (W,0), (W,H), (0,H)`. The shared inset adapter supplies an explicit inset frame and shifted contour to the source-ported core, with selected font and language. Generated-wrap healing belongs to the restore/edit boundary, not the pure strategy. It does not implement a separate greedy backend solver.

Rectangle scanlines provide constant interior spans; profile construction still applies the shared contour air, line-band sampling, and block-tip constraints. The useful width is therefore not universally captured by the old `W - 2 * 4px` formula alone.

The shared DP scores line slack, overflow, grammatical breaks and discretionary hyphens. Its weights include `LINE_SLACK_WEIGHT = 1000`, `LINE_OVERFLOW_WEIGHT = 1000000`, and `DISCRETIONARY_HYPHEN_PENALTY = 2000`; individual grammatical break penalties come from shared tokenization. Candidate comparison prefers non-overflowed layouts, then fewer lines for all candidates, then lower cost, matching the pinned donor comparator.

## 3. Font Probes and Explicit Constraints

Backend rectangular DP uses the same fractional font search and LastResort policy as contour layout. The default minimum is 9 px, and automatic maximum follows the inset horizontal frame width. Explicit authored maximum/cap settings remain inputs; there are no implicit 18/20/24, 48 px, or height-percentage caps in this route.

Clean fitting above the minimum integer bucket is retained. At the minimum bucket, LastResort can recover a larger bucket; at each size a fitting clean layout still wins. See the source mapping and platform limitations in [the Koharu specification](koharu_typesetting_pipeline_spec.md).

Uniform fallback may return `overflowed: true`; no minimum font size guarantees arbitrary text fits. Acceptance rejects an overflowing fixed result instead of treating any returned lines as proof of containment.

## 4. Studio Simple Edits Are Deliberately Different

`recalculateBlockTypeset(..., 'simple', ...)` retains the current/user font size and calls `wrapRectangular()` for rectangular word wrapping. It does not rerun the backend `SimpleRectTypesetter` font-size search. Generated soft-hyphen wraps are healed at the restore boundary; in-session authored line breaks remain distinct. It preserves valid CSS font stacks and returns newly wrapped lines at the existing size.

Thus initial backend caption fitting and subsequent Studio Caption Box edits do not share identical sizing policy. Contour Studio edits instead call `wrapTextContour()` with stored contour points or generated geometry; Auto Balloon edits use `measureDefaultLayout()`.

## 5. Output Contract

Backend Simple Rect returns `lines`, `fontSize`, dimensions, `overflowed`, and optional `positionedLines` from shared Contour DP. The final renderer can draw positioned lines directly. Studio can initially consume persisted placements, but edits invalidate/recalculate layout. A dashed contour rendered by `CanvasFurniture` is visualization of stored geometry, not evidence this strategy or Contour DP produced the baked text.
