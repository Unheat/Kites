# ADR-010: Preserve Contour Layout Metadata and Validate in the Browser

## Status
Accepted. Supersedes ADR-008's two-engine taxonomy and updates ADR-006's partitioning description. Does not supersede polygon-only inpainting or certify complete donor parity.

## Date
2026-10-28

## Context

Contour line breaking needs a polygon and per-line placements, not only a rectangular box and nominal font size. Passing only lines to Studio caused it to reconstruct spacing differently from the baked image. Multiple independent flags (`isRounded`, fixed bounds, contour presence, mode) also allowed saved labels and actual strategies to diverge.

The font investigation demonstrated a second boundary: a Node-rendered image can pass while Chromium rejects an invalid Canvas font string and silently retains prior context state. The filename `pipelineVisualKoharuExactTest.ts` was mistakenly treated as stronger evidence than its actual coverage.

## Decision

1. Retain three canonical runtime/editing modes: `contour`, `balloon`, and `simple`. Normalize legacy stored `ellipse` only on restore; it is not a fourth active strategy.
2. Keep page-absolute analysis geometry distinct from box-relative resolved contours. Transform origins explicitly at the boundary.
3. Persist final renderer boxes, lines, spacing, and `positionedLines` where available. Restore measured layouts without refitting merely because the editor opens or selection changes.
4. Preserve contour metadata through Studio edits and undo snapshots. Resize-handle code scales local contours proportionally; reset currently restores dimensions/contour from a transient baseline only.
5. Separate detected/retained geometry from visual furniture. A dashed outline indicates geometry is stored, not that the current text was fitted against it or fits inside it.
6. Require browser execution and inspected images for visual acceptance. For an equivalence claim, also control text, geometry, loaded face bytes, style, options, and entry point across both runs.

## Alternatives Considered

### Reconstruct every layout when Studio opens
Simpler storage, but loses the originally rendered line placement and risks font-readiness changes. Rejected for already measured objects.

### Preserve only the rectangle
Adequate for rectangular wrapping, but discards asymmetric boundaries and partition-cell information. Retain contour polygons and line placements.

### Add arbitrary font caps until screenshots look plausible
Caps can be a product policy, but cannot repair invalid measurement. Current Kites 18/20/24px ceilings are custom tuning, not donor `automatic_maximum`. Their names and green unit tests do not establish visual parity.

### Treat Node tests as browser acceptance
Rejected: native canvas parsing, direct font registration, manual geometry, and hardcoded transcription bypass the failing integration boundaries.

## Consequences and limits

- The current factory prioritizes supplied contours on fixed layouts; backend `simple` and Studio simple edits are not identical implementations.
- Pipeline persistence can reuse raw contours after detailed rejection, so actual baked strategy and saved edit metadata can still differ. This ADR records the intended ownership and the present limit, not a completed discriminated-union refactor.
- Independent original-detection geometry is not yet persisted. Reset does not restore original position/rotation across save/reload.
- Studio OCR still uses hardcoded comic-family precomputation and unconditional geometry acceptance. It is not equivalent to the selected-font live pipeline.
- Koharu uses horizontal bubble width or vertical bubble height as its automatic maximum; its 24px default is for nonbubble text. Kites custom caps must not be cited as exact donor logic.

See [current specification](../development/koharu_typesetting_pipeline_spec.md), [testing guide](../development/testing.md), and [Devlog 078](../dev-history/devlog/078_phase78_koharu_typesetting_visual_parity_browser_canvas_discrepancy.md).
