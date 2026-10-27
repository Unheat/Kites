/**
 * @file siblingClearance.ts
 * Pairwise clearance clamping and sibling boundary constraints to avoid cross-bubble collisions.
 * 1:1 port of XianScan `expansion.rs:230-269`.
 */

import { Graph } from '../../../shared/utils/graph';
import type { BoxRect } from '../bubbleExpansion';

export const SIBLING_GAP = 6;
export const SHARED_CONTAINER_IOU = 0.7;

/**
 * Computes the Intersection-over-Union ratio of two axis-aligned rectangles.
 */
export function boxIoU(a: BoxRect, b: BoxRect): number {
  const interW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const interH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (interW <= 0 || interH <= 0) return 0;
  const inter = interW * interH;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Groups OCR box indices whose carriers refer to the SAME physical bubble container.
 */
export function groupBoxesBySharedContainer(
  carriers: (BoxRect | null | undefined)[],
  minIoU: number = SHARED_CONTAINER_IOU
): number[][] {
  const graph = new Graph();
  for (let i = 0; i < carriers.length; i++) {
    if (!carriers[i]) continue;
    graph.addNode(i);
    for (let j = 0; j < i; j++) {
      if (!carriers[j]) continue;
      if (boxIoU(carriers[i]!, carriers[j]!) >= minIoU) {
        graph.addEdge(i, j);
      }
    }
  }

  return graph
    .connectedComponents()
    .map((members) => Array.from(members).sort((a, b) => a - b))
    .filter((members) => members.length >= 2);
}

/**
 * Pairwise clamp a candidate typeset box against all neighboring original OCR boxes.
 * Ensures the candidate never swallows or collides with sibling text.
 */
export function pairwiseClampBox(
  candidate: BoxRect,
  original: BoxRect,
  allOriginals: BoxRect[],
  myIndex: number,
  containerOrGap?: BoxRect | number,
  siblingGapParam: number = SIBLING_GAP,
  excludedIndices?: number[]
): BoxRect {
  let { x, y, w, h } = candidate;
  const cxI = original.x + original.w / 2;
  const cyI = original.y + original.h / 2;
  const container = (containerOrGap && typeof containerOrGap === 'object') ? containerOrGap : undefined;
  const siblingGap = typeof containerOrGap === 'number' ? containerOrGap : siblingGapParam;

  for (let j = 0; j < allOriginals.length; j++) {
    if (j === myIndex || (excludedIndices && excludedIndices.includes(j))) continue;
    const origJ = allOriginals[j];
    const cxJ = origJ.x + origJ.w / 2;
    const cyJ = origJ.y + origJ.h / 2;

    const dx = Math.abs(cxI - cxJ);
    const dy = Math.abs(cyI - cyJ);
    const isPrimarilyVertical = dy > dx * 1.25;
    const isPrimarilyHorizontal = dx > dy * 1.25;

    // 1. Horizontal clearance: when candidate overlaps neighbor vertically
    const yOverlap = (y + h > origJ.y) && (origJ.y + origJ.h > y);
    if (yOverlap && !isPrimarilyVertical) {
      if (cxJ < cxI && origJ.x + origJ.w <= cxI) {
        const minLeft = origJ.x + origJ.w + siblingGap;
        if (x < minLeft) {
          const shift = minLeft - x;
          x = minLeft;
          w = Math.max(original.w, w - shift);
        }
      } else if (cxJ > cxI && origJ.x >= cxI) {
        const maxRight = origJ.x - siblingGap;
        if (x + w > maxRight) {
          w = Math.max(original.w, maxRight - x);
        }
      }
    }

    // 2. Vertical clearance: when candidate overlaps neighbor horizontally
    const xOverlap = (x + w > origJ.x) && (origJ.x + origJ.w > x);
    if (xOverlap && !isPrimarilyHorizontal) {
      if (cyJ < cyI && origJ.y + origJ.h <= cyI) {
        const minTop = origJ.y + origJ.h + siblingGap;
        if (y < minTop) {
          const shift = minTop - y;
          y = minTop;
          h = Math.max(original.h, h - shift);
        }
      } else if (cyJ > cyI && origJ.y >= cyI) {
        const maxBottom = origJ.y - siblingGap;
        if (y + h > maxBottom) {
          h = Math.max(original.h, maxBottom - y);
        }
      }
    }
  }

  // 3. Strict container boundary clamping: a typeset box must NEVER exceed its container limits.
  if (container) {
    x = Math.max(container.x, x);
    y = Math.max(container.y, y);
    if (x + w > container.x + container.w) {
      w = Math.max(20, container.x + container.w - x);
    }
    if (y + h > container.y + container.h) {
      h = Math.max(20, container.y + container.h - y);
    }
  }

  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * Enforces sibling clearance and non-overlap boundaries between all adjacent text regions.
 * 1:1 port of XianScan `expansion.rs:230-269` sibling clearance constraint.
 */
export function applySiblingBoundaryConstraints(
  originalBoxes: BoxRect[],
  typesetBoxes: (BoxRect | undefined)[],
  siblingGap: number = SIBLING_GAP,
  groups?: number[][]
): void {
  const halfGap = Math.round(siblingGap / 2);

  for (let i = 0; i < typesetBoxes.length; i++) {
    const tbI = typesetBoxes[i];
    if (!tbI) continue;
    const origI = originalBoxes[i];
    const cxI = origI.x + origI.w / 2;
    const cyI = origI.y + origI.h / 2;

    for (let j = 0; j < typesetBoxes.length; j++) {
      if (i === j) continue;
      if (groups && groups.some((g) => g.includes(i) && g.includes(j))) continue;
      const tbJ = typesetBoxes[j];
      if (!tbJ) continue;
      const origJ = originalBoxes[j];
      const cxJ = origJ.x + origJ.w / 2;
      const cyJ = origJ.y + origJ.h / 2;

      const dx = Math.abs(cxI - cxJ);
      const dy = Math.abs(cyI - cyJ);
      const isPrimarilyVertical = dy > dx * 1.25;
      const isPrimarilyHorizontal = dx > dy * 1.25;

      const yOverlap = (tbI.y + tbI.h) > tbJ.y && (tbJ.y + tbJ.h) > tbI.y;
      if (yOverlap && !isPrimarilyVertical) {
        if (cxJ < cxI) {
          const dividerX = Math.round((origJ.x + origJ.w + origI.x) / 2);
          const minLeft = dividerX + halfGap;
          if (tbI.x < minLeft) {
            const shift = minLeft - tbI.x;
            tbI.x = minLeft;
            tbI.w = Math.max(origI.w, tbI.w - shift);
          }
        } else if (cxJ > cxI) {
          const dividerX = Math.round((origI.x + origI.w + origJ.x) / 2);
          const maxRight = dividerX - halfGap;
          if (tbI.x + tbI.w > maxRight) {
            tbI.w = Math.max(origI.w, maxRight - tbI.x);
          }
        }
      }

      const xOverlap = (tbI.x + tbI.w) > tbJ.x && (tbJ.x + tbJ.w) > tbI.x;
      if (xOverlap && !isPrimarilyHorizontal) {
        if (cyJ < cyI) {
          const dividerY = Math.round((origJ.y + origJ.h + origI.y) / 2);
          const minTop = dividerY + halfGap;
          if (tbI.y < minTop) {
            const shift = minTop - tbI.y;
            tbI.y = minTop;
            tbI.h = Math.max(origI.h, tbI.h - shift);
          }
        } else if (cyJ > cyI) {
          const dividerY = Math.round((origI.y + origI.h + origJ.y) / 2);
          const maxBottom = dividerY - halfGap;
          if (tbI.y + tbI.h > maxBottom) {
            tbI.h = Math.max(origI.h, maxBottom - tbI.y);
          }
        }
      }
    }
  }
}
