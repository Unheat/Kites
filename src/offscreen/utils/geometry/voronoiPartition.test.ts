import { describe, expect, it } from 'vitest';
import { anchorFlowCells, flowCells } from './voronoiPartition';
import { pointInPolygon } from './polygonMath';
import type { Point2D } from '../../../shared/utils/geometry';

/**
 * Three-lobe balloon contour measured on a real page (a tall joined bubble holding three stacked
 * utterances). The topological split returns three cells for this contour, but one of them spans two
 * lobes, so the layout used to place the middle utterance outside the balloon.
 */
const THREE_LOBE_CONTOUR: Point2D[] = [
  [1, 163], [1, 21], [3, 19], [3, 15], [9, 9], [15, 5], [19, 5], [27, 1], [53, 1], [55, 3],
  [77, 9], [94, 29], [94, 33], [100, 45], [102, 67], [100, 69], [100, 77], [98, 79], [96, 89],
  [88, 103], [88, 107], [100, 119], [110, 137], [112, 149], [114, 151], [114, 167], [116, 169],
  [114, 173], [114, 189], [112, 191], [112, 196], [110, 198], [110, 204], [108, 206], [104, 222],
  [100, 230], [92, 238], [92, 240], [104, 252], [108, 262], [108, 268], [110, 270], [108, 334],
  [106, 336], [104, 356], [102, 358], [100, 368], [96, 374], [96, 378], [88, 388], [84, 388],
  [82, 390], [15, 390], [13, 388], [9, 388], [3, 382], [3, 378], [1, 376],
].map(([x, y]) => ({ x, y }));

const THREE_ANCHORS: Point2D[] = [
  { x: 42.5, y: 58 },
  { x: 52, y: 175.5 },
  { x: 48, y: 318 },
];

describe('flowCells', () => {
  it('separates three stacked lobes of one joined balloon', () => {
    const cells = flowCells(118, 391, THREE_ANCHORS, THREE_LOBE_CONTOUR);
    expect(cells).toHaveLength(3);
    for (let i = 0; i < cells.length; i++) {
      expect(pointInPolygon(cells[i], THREE_ANCHORS[i])).toBe(true);
    }
    // Cells may share bounding boxes along diagonal necks; what matters is that no point of the
    // balloon is claimed by two cells.
    const xs = THREE_LOBE_CONTOUR.map((point) => point.x);
    const ys = THREE_LOBE_CONTOUR.map((point) => point.y);
    let shared = 0;
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 8) {
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 8) {
        const point = { x, y };
        if (!pointInPolygon(THREE_LOBE_CONTOUR, point)) continue;
        const owners = cells.filter((cell) => pointInPolygon(cell, point)).length;
        if (owners > 1) shared += 1;
      }
    }
    expect(shared).toBe(0);
  });

  it('still partitions two anchors inside a plain rectangle', () => {
    const cells = anchorFlowCells(200, 100, [{ x: 50, y: 50 }, { x: 150, y: 50 }]);
    expect(cells).toHaveLength(2);
    expect(pointInPolygon(cells[0], { x: 50, y: 50 })).toBe(true);
    expect(pointInPolygon(cells[1], { x: 150, y: 50 })).toBe(true);
  });
});
