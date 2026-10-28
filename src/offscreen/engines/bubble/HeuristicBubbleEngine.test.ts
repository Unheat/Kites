import { describe, expect, it } from 'vitest';
import { HeuristicBubbleEngine, XIANSCAN_SHARED_BUBBLE_IOU } from './HeuristicBubbleEngine';
import { NeuralBubbleEngine } from './NeuralBubbleEngine';
import type { BubbleShapeEvidence } from './HeuristicBubbleExtractor';
import type { BoxRect } from '../../utils/bubbleExpansion';

/**
 * XianScan expansion.rs:186-194 ground truth for the shared-bubble identity test:
 *
 * ```rust
 * let is_sole_occupant = indexes.iter().all(|&j| {
 *     if i == j { return true; }
 *     match regions[j].bubble_box.as_ref() {
 *         Some(bj) => box_iou(b, bj) < 0.5,
 *         None => true,
 *     }
 * });
 * ```
 *
 * IoU >= 0.5 between bubble boxes means the same physical balloon. Kites' heuristic
 * carrier is the bubble-box analog, so {@link HeuristicBubbleEngine.associateSharedChambers}
 * merges on carrier IoU >= 0.5 by assigning the SAME proposal object to both boxes.
 */
describe('HeuristicBubbleEngine XianScan shared-chamber association', () => {
  /** Same physical chamber extracted twice: IoU = 19200 / 36800 ≈ 0.522. */
  const sharedChamberCarriers: [BoxRect, BoxRect] = [
    { x: 40, y: 40, w: 140, h: 200 },
    { x: 60, y: 80, w: 140, h: 200 },
  ];

  /** Overlapping bounding boxes but low IoU = 7200 / 23200 ≈ 0.31: two distinct chambers. */
  const distinctChamberCarriers: [BoxRect, BoxRect] = [
    { x: 40, y: 40, w: 190, h: 80 },
    { x: 130, y: 40, w: 190, h: 80 },
  ];

  it('uses the exact XianScan 0.5 threshold constant', () => {
    expect(XIANSCAN_SHARED_BUBBLE_IOU).toBe(0.5);
    expect(19200 / 36800).toBeGreaterThanOrEqual(XIANSCAN_SHARED_BUBBLE_IOU);
    expect(7200 / 23200).toBeLessThan(XIANSCAN_SHARED_BUBBLE_IOU);
  });

  it('assigns the same proposal object to carriers at or above the 0.5 threshold', () => {
    const boxes: BoxRect[] = [
      { x: 60, y: 60, w: 60, h: 40 },
      { x: 210, y: 60, w: 60, h: 40 },
    ];
    const { proposals } = HeuristicBubbleEngine.associateSharedChambers(boxes, sharedChamberCarriers);

    expect(proposals[0]).not.toBeNull();
    // Object identity — the mainline grouping signal downstream.
    expect(proposals[0]).toBe(proposals[1]);
  });

  it('keeps carriers below the 0.5 threshold ungrouped (null proposals)', () => {
    const boxes: BoxRect[] = [
      { x: 60, y: 60, w: 60, h: 40 },
      { x: 210, y: 60, w: 60, h: 40 },
    ];
    const { proposals } = HeuristicBubbleEngine.associateSharedChambers(boxes, distinctChamberCarriers);

    expect(proposals[0]).toBeNull();
    expect(proposals[1]).toBeNull();
  });

  it('chains transitively: three overlapping chambers converge on one proposal identity', () => {
    // IoU(0,1) = 80*100 / 14200 ≈ 0.563 ✓, IoU(1,2) ≈ 0.563 ✓, IoU(0,2) = 50*100 / 17000 ≈ 0.294.
    // The chain 0-1-2 must unify all three even though the ends never pass the threshold directly.
    const carriers: (BoxRect | null)[] = [
      { x: 0, y: 0, w: 100, h: 110 },
      { x: 0, y: 30, w: 100, h: 110 },
      { x: 0, y: 60, w: 100, h: 110 },
    ];
    const boxes: BoxRect[] = [
      { x: 10, y: 10, w: 40, h: 40 },
      { x: 10, y: 70, w: 40, h: 40 },
      { x: 10, y: 130, w: 40, h: 40 },
    ];

    const { proposals } = HeuristicBubbleEngine.associateSharedChambers(boxes, carriers);

    expect(proposals[0]).not.toBeNull();
    expect(proposals[0]).toBe(proposals[1]);
    expect(proposals[1]).toBe(proposals[2]);
  });

  it('leaves boxes without carriers as free text while associating the rest', () => {
    const boxes: BoxRect[] = [
      { x: 60, y: 60, w: 60, h: 40 },
      { x: 210, y: 300, w: 60, h: 40 },
      { x: 210, y: 60, w: 60, h: 40 },
    ];
    const carriers: (BoxRect | null)[] = [
      sharedChamberCarriers[0],
      null, // Free text / open artwork: extraction returned null
      sharedChamberCarriers[1],
    ];

    const { proposals } = HeuristicBubbleEngine.associateSharedChambers(boxes, carriers);

    expect(proposals[0]).not.toBeNull();
    expect(proposals[0]).toBe(proposals[2]);
    expect(proposals[1]).toBeNull();
  });

  it('propagates the dominant (fuller) chamber shape to both merged members', () => {
    const boxes: BoxRect[] = [
      { x: 60, y: 60, w: 60, h: 40 },
      { x: 210, y: 60, w: 60, h: 40 },
    ];
    const smallMask = new Uint8Array(40 * 40);
    for (let i = 0; i < smallMask.length; i++) smallMask[i] = 1; // 1600 px
    const fullMask = new Uint8Array(60 * 80);
    for (let i = 0; i < fullMask.length; i++) fullMask[i] = 1; // 4800 px

    const sparseShape: BubbleShapeEvidence = {
      x: 0, y: 0, scale: 1, width: 40, height: 40, interior: smallMask, observedInterior: smallMask, eroded: smallMask,
    };
    const fullShape: BubbleShapeEvidence = {
      x: 0, y: 0, scale: 1, width: 60, height: 80, interior: fullMask, observedInterior: fullMask, eroded: fullMask,
    };

    // Box 0's extraction was sparse; box 1's captured the full shared chamber.
    const shapes: (BubbleShapeEvidence | undefined)[] = [sparseShape, fullShape];
    const { proposals, shapes: resolved } = HeuristicBubbleEngine.associateSharedChambers(
      boxes, [...sharedChamberCarriers], shapes
    );

    expect(proposals[0]).toBe(proposals[1]);
    // Both members adopt the fuller extraction: one balloon, one curvature/contour.
    expect(resolved[0]).toBe(fullShape);
    expect(resolved[1]).toBe(fullShape);
  });

  it('merges identically when shape evidence is absent (synthetic layouts)', () => {
    const boxes: BoxRect[] = [
      { x: 60, y: 60, w: 60, h: 40 },
      { x: 210, y: 60, w: 60, h: 40 },
    ];
    const { proposals } = HeuristicBubbleEngine.associateSharedChambers(boxes, sharedChamberCarriers, []);
    expect(proposals[0]).toBe(proposals[1]);
  });

  it('buildGeometry end-to-end: heuristic tier geometry carries association results', () => {
    const W = 300, H = 400;
    const data = new Uint8ClampedArray(W * H * 4).fill(40);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inTop = (x - 150) ** 2 + (y - 120) ** 2 <= 50 ** 2;
        const inBot = (x - 150) ** 2 + (y - 220) ** 2 <= 60 ** 2;
        if (inTop || inBot) {
          const idx = (y * W + x) * 4;
          data[idx] = 255;
          data[idx + 1] = 255;
          data[idx + 2] = 255;
          data[idx + 3] = 255;
        }
      }
    }
    const boxes: BoxRect[] = [
      { x: 135, y: 105, w: 30, h: 30 },
      { x: 130, y: 200, w: 40, h: 40 },
    ];

    const geometry = HeuristicBubbleEngine.buildGeometry({ width: W, height: H, data }, boxes);

    expect(geometry.tier).toBe('heuristic');
    expect(geometry.carriers).toHaveLength(2);
    expect(geometry.proposals).toHaveLength(2);
    expect(geometry.curvatures).toHaveLength(2);
    // Extraction may or may not merge these specific lobes (patch-dependent), but the
    // contract must hold: proposals and shapes arrays stay aligned per box.
    if (geometry.proposals[0]) {
      expect(geometry.proposals[0]).toBe(geometry.proposals[1]);
      expect(geometry.shapes[0]).toBe(geometry.shapes[1]);
    }
  });
});

describe('NeuralBubbleEngine tier isolation (never runs heuristic association)', () => {
  it('keeps distinct YOLO proposals distinct even when their boxes overlap heavily', async () => {
    const bubbles: BoxRect[] = [
      { x: 0, y: 0, w: 140, h: 200 },
      { x: 60, y: 80, w: 140, h: 200 },
    ];
    const boxes: BoxRect[] = [
      { x: 30, y: 40, w: 40, h: 40 },   // inside bubble 0
      { x: 150, y: 160, w: 40, h: 40 }, // inside bubble 1
    ];

    const geometry = await NeuralBubbleEngine.buildGeometry(
      null,
      { width: 300, height: 400, data: new Uint8ClampedArray(4) },
      boxes,
      undefined,
      { bubbles }
    );

    expect(geometry).not.toBeNull();
    expect(geometry!.tier).toBe('neural');
    // Instance identity from the detector — no heuristic IoU association is applied.
    expect(geometry!.proposals[0]).not.toBe(geometry!.proposals[1]);
  });

  it('assigns the identical proposal object when two boxes match the same YOLO instance', async () => {
    const bubbles: BoxRect[] = [{ x: 0, y: 0, w: 200, h: 300 }];
    const boxes: BoxRect[] = [
      { x: 30, y: 40, w: 40, h: 40 },
      { x: 90, y: 180, w: 40, h: 40 },
    ];

    const geometry = await NeuralBubbleEngine.buildGeometry(
      null,
      { width: 300, height: 400, data: new Uint8ClampedArray(4) },
      boxes,
      undefined,
      { bubbles }
    );

    expect(geometry).not.toBeNull();
    expect(geometry!.proposals[0]).toBe(geometry!.proposals[1]);
  });
});
