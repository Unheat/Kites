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

`SimpleRectTypesetter.typeset()` first unwraps temporary typesetter line breaks. It constructs the box-local quad `(0,0), (W,0), (W,H), (0,H)` and calls `wrapTextContour()` with the selected font and language. It does not implement a separate greedy backend solver.

Rectangle scanlines provide constant interior spans; profile construction still applies the shared contour air, line-band sampling, and block-tip constraints. The useful width is therefore not universally captured by the old `W - 2 * 4px` formula alone.

The shared DP scores line slack, overflow, grammatical breaks and discretionary hyphens. Its weights include `LINE_SLACK_WEIGHT = 1000`, `LINE_OVERFLOW_WEIGHT = 1000000`, and `DISCRETIONARY_HYPHEN_PENALTY = 2000`; individual grammatical break penalties come from shared tokenization. Candidate comparison prefers non-overflowed layouts, then fewer lines among non-overflowed candidates, then lower cost. Overflow candidates are compared by cost, not an unconditional fewer-lines rule.

## 3. Font Probes & Current Custom Caps

The strategy's requested maximum is:

- With `maxFontSizeCap`: `min(cap, max(16, round(H * 0.6)))`.
- Otherwise: explicit `maxFontSize`, or `max(16, round(H * 0.6))`.

Its minimum defaults to `MINIMUM_READABLE_FONT_SIZE = 9`, but callers may supply a different minimum. This maximum is then passed into `wrapTextContour()`, whose current dialogue policy further constrains it:

- Single uppercase/digit/punctuation scream: 24px.
- Other text with at most three whitespace-delimited words: 20px.
- Denser text: 18px.

Without an explicit maximum, the shared contour automatic ceiling also considers `0.85 * containerW` and `max(9, 0.40 * containerH)`. These **18/20/24 caps are Kites customization**, not upstream Koharu parity. Koharu's `automatic_maximum()` uses **bubble width for horizontal writing, bubble height for vertical writing, and 24 only for nonbubble text**.

The shared contour fallback may return `overflowed: true` when no fitting result exists at its floor. A 9px minimum is not a promise that arbitrary text remains contained.

## 4. Studio Simple Edits Are Deliberately Different

`recalculateBlockTypeset(..., 'simple', ...)` retains the current/user font size and calls `wrapRectangular()` for rectangular word wrapping. It does not rerun the backend `SimpleRectTypesetter` font-size search. It heals soft line-break hyphens first, preserves valid CSS font stacks, and returns newly wrapped lines at the existing size.

Thus initial backend caption fitting and subsequent Studio Caption Box edits do not share identical sizing policy. Contour Studio edits instead call `wrapTextContour()` with stored contour points or generated geometry; Auto Balloon edits use `measureDefaultLayout()`.

## 5. Output Contract

Backend Simple Rect returns `lines`, `fontSize`, dimensions, `overflowed`, and optional `positionedLines` from shared Contour DP. The final renderer can draw positioned lines directly. Studio can initially consume persisted placements, but edits invalidate/recalculate layout. A dashed contour rendered by `CanvasFurniture` is visualization of stored geometry, not evidence this strategy or Contour DP produced the baked text.
