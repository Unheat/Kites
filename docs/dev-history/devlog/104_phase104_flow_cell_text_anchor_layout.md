# Devlog 104: Flow-Cell Text Anchors Stay in Their Own Lobe

- **Date:** 2026-11-15
- **Feature/Task:** Fix the scrambled three-utterance split in `image8.png`
- **Status:** Completed on `main`

## Objective

The tall joined balloon in `image8.png` holds three stacked utterances (`THANK YOU.`,
`WE HAVE AN APPOINTMENT FOR 4 P.M.`, `I AM...`). The heuristic and neural visual pipelines
split it into three regions, but the top and middle text were rendered on top of each other.

## Root cause

The splitter was not the failure. `flowCells` returned three cells for the measured contour,
but one cell is diagonal and its bounding box spans two lobes. `BubbleLayoutService` used the
cell bounding box as the text box, so the top utterance was centered in a box that reached
down into the middle lobe. The cell polygon was correct; the text anchor was not.

A second, smaller donor gap was found while checking the splitter: `segmentsIntersect` did not
treat an endpoint lying on the other segment as an intersection. Koharu's
`segments_intersect` does, so a diagonal that only touches the contour could be accepted as a
valid split.

## Implementation

1. `BubbleLayoutService` now seeds each flow-cell text box from the utterance's own OCR box,
   then grows it only while all four corners stay inside the cell polygon and a local window
   (3x the utterance box). The cell contour still defines the bubble outline.
2. `segmentsIntersect` now includes the donor's point-on-segment cases.
3. Added a regression test with the measured three-lobe contour: the three typeset boxes must
   stay in vertical order, and the existing pipeline test now asserts the text box lies inside
   its own cell contour.

## Evidence

- `image8.png`, heuristic and neural visual outputs: three separate text blocks in the tall
  balloon, no overlap.
- `npm test`: 1474 passed / 126 files.
- `npx tsc -b`: exit 0.
- `npm run build`: exit 0.
- `npm run docs:check`: 0 docstring shape violations; `npm run docs:api`: generated.

## Decision

The splitter remains donor-exact: `flowCells` still trusts the topological decomposition when
it returns one cell per anchor. The fix is in the layout consumer, which must not treat a
diagonal cell's bounding box as a text chamber.
