# Devlog 104: Flow-Cell Split Keeps Stacked Balloons Horizontal

- **Date:** 2026-11-15
- **Feature/Task:** Fix the scrambled three-utterance split in `image8.png`
- **Status:** Completed on `main`

## Objective

The tall joined balloon in `image8.png` holds three stacked utterances (`THANK YOU.`,
`WE HAVE AN APPOINTMENT FOR 4 P.M.`, `I AM...`). The heuristic and neural visual pipelines
split it into three regions, but the text was squeezed into narrow vertical strips instead of
the horizontal stack Koharu shows.

## Root cause

The failure is in the divider, not in hyphenation or the text box. `flowCells` runs a
topological reflex-neck decomposition first. On this tall balloon the only reflex vertices sit
on the right wall, so the only decomposition that assigns all three anchors cuts off a
full-height strip. That strip is geometrically a valid partition but it is not a lobe: the top
and middle utterances end up sharing a cell whose bounding box spans the whole balloon, so the
text is constrained to a narrow vertical frame.

The donor's `flow_cells` has a second stage, `anchor_flow_cells`, for exactly the case where
the topological decomposition is not meaningful. It uses perpendicular bisectors and produces
horizontal bands for vertically stacked anchors. The topological stage must not win when its
"lobe" spans the entire balloon.

A second, smaller donor gap was found while checking the splitter: `segmentsIntersect` did not
treat an endpoint lying on the other segment as an intersection. Koharu's
`segments_intersect` does, so a diagonal that only touches the contour could be accepted as a
valid split.

## Implementation

1. `flowCells` falls back to `anchorFlowCells` when `anchors.length >= 3` and any topological
   cell is at least 85% of the contour height (`MAX_TOPOLOGICAL_CELL_HEIGHT_RATIO`). Two-flow
   balloons keep the topological path, so true figure-8 necks are unchanged.
2. `segmentsIntersect` now includes the donor's point-on-segment cases.
3. Added a regression test with the measured image8 balloon contour: the three cells must be
   horizontal bands, in bottom/middle/top anchor order, and each anchor must stay in its cell.

The text box remains the cell bbox and the cell polygon remains the contour. No box-fill
algorithm change and no hyphenation change.

## Evidence

- `image8.png`, heuristic and neural visual outputs: `THANK YOU.`, `WE HAVE AN APPOINTMENT FOR
  4 P.M.`, and `I AM...` occupy three separate horizontal regions, matching Koharu's spatial
  layout.
- `npm test`: 1474 passed / 126 files.
- `npx tsc -b`: exit 0.
- `npm run build`: exit 0.
- `npm run docs:check`: 0 docstring shape violations; `npm run docs:api`: generated.

## Decision

Topological flow cells are used only when they produce real lobes. A full-height cell in a 3+
flow balloon is a divider artifact, so the donor's anchor bisectors take over. This is a
correctness gate on the donor's first stage, not a replacement algorithm.

## Deviation

No issue tracker entry was supplied for this fix, so the PR keeps the template placeholder
`Closes #` and records that omission here instead of inventing an issue number.
