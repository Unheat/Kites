import { describe, expect, it } from 'vitest';
import { HeuristicBubbleEngine, XIANSCAN_SHARED_BUBBLE_IOU } from './HeuristicBubbleEngine';
import { associateHeuristicChambers } from './heuristicChamberAssociation';
import { NeuralBubbleEngine } from './NeuralBubbleEngine';
import type { BubbleShapeEvidence } from './HeuristicBubbleExtractor';
import type { BoxRect } from '../../utils/bubbleExpansion';

/**
 * Donor neural detector bbox sole-occupant rule, adapted here to heuristic carriers:
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
 * Heuristic adaptation retains IoU >= 0.5 for synthetic boxes. Real components also
 * require validated mask support before receiving a shared proposal identity.
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

  it('shares a complete supported chamber instead of a truncated extraction', () => {
    const boxes: BoxRect[] = [
      { x: 60, y: 60, w: 60, h: 40 },
      { x: 80, y: 130, w: 60, h: 40 },
    ];
    const smallMask = new Uint8Array(80 * 70);
    for (let i = 0; i < smallMask.length; i++) smallMask[i] = 1; // 5600 px
    const fullMask = new Uint8Array(140 * 200);
    for (let i = 0; i < fullMask.length; i++) fullMask[i] = 1; // 28000 px

    const sparseShape: BubbleShapeEvidence = {
      x: 40, y: 40, scale: 1, width: 80, height: 70, interior: smallMask, observedInterior: smallMask, eroded: smallMask,
    };
    const fullShape: BubbleShapeEvidence = {
      x: 40, y: 40, scale: 1, width: 140, height: 200, interior: fullMask, observedInterior: fullMask, eroded: fullMask,
      validatedComponent: true,
    };

    // Box 0's extraction was sparse; box 1's captured the full shared chamber.
    const shapes: (BubbleShapeEvidence | undefined)[] = [sparseShape, fullShape];
    const { proposals, shapes: resolved } = HeuristicBubbleEngine.associateSharedChambers(
      boxes, [...sharedChamberCarriers], shapes
    );

    expect(proposals[0]).not.toBeNull();
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

describe('associateHeuristicChambers bookkeeping & invariants', () => {
  /** @param mask Paper raster. @param validated Validation marker. @returns Evidence for a 20-by-10 page domain. */
  function coverageShape(mask: Uint8Array, validated?: boolean): BubbleShapeEvidence {
    return { x: 100.25, y: 200.5, scale: 1, scaleX: 0.5, scaleY: 1,
      width: 10, height: 10, interior: mask, observedInterior: mask, eroded: mask,
      reconstructed: mask, validatedComponent: validated };
  }

  it('requires explicit validation even for the identical mask reference', () => {
    const boxes = [{ x: 100.25, y: 200.5, w: 20, h: 10 }, { x: 100.25, y: 200.5, w: 20, h: 10 }];
    const shape = coverageShape(new Uint8Array(100).fill(1));
    expect(associateHeuristicChambers(boxes, boxes, [shape, shape]).proposals).toEqual([null, null]);
  });

  it('accepts exactly 0.6 OCR-area coverage with central ink and unequal axis scales', () => {
    const boxes = [{ x: 100.25, y: 200.5, w: 20, h: 10 }, { x: 100.25, y: 200.5, w: 20, h: 10 }];
    const mask = new Uint8Array(100);
    // Six paper columns, with a four-column central glyph containing the centroid.
    for (let y = 0; y < 10; y++) for (const x of [0, 1, 2, 7, 8, 9]) mask[y * 10 + x] = 1;
    const shape = coverageShape(mask, true);
    const result = associateHeuristicChambers(boxes, boxes, [shape, undefined]);
    expect(result.proposals[0]).not.toBeNull();
    expect(result.proposals[0]).toBe(result.proposals[1]);
    expect(result.shapes).toEqual([shape, shape]);
    mask[0] = 0; // 0.59 is insufficient, despite validated topology.
    expect(associateHeuristicChambers(boxes, boxes, [shape, undefined]).proposals).toEqual([null, null]);
  });

  it('does not borrow a same-reference validated mask outside its extraction domain', () => {
    const boxes = [{ x: 100.25, y: 200.5, w: 20, h: 10 }, { x: 120.25, y: 200.5, w: 20, h: 10 }];
    const shape = coverageShape(new Uint8Array(100).fill(1), true);
    expect(associateHeuristicChambers(boxes, boxes, [shape, shape]).proposals).toEqual([null, null]);
  });
  it('bridges two prior groups into one unified component via a connecting chamber', () => {
    // Group 1: boxes 0 & 1 (Carrier IoU ≈ 0.538 >= 0.5)
    // Group 2: boxes 2 & 3 (Carrier IoU ≈ 0.538 >= 0.5)
    // Initially Group 1 and Group 2 have IoU = 0.25 < 0.5 (disjoint)
    const boxesWithoutBridge: BoxRect[] = [
      { x: 10, y: 10, w: 20, h: 20 },
      { x: 40, y: 10, w: 20, h: 20 },
      { x: 100, y: 10, w: 20, h: 20 },
      { x: 130, y: 10, w: 20, h: 20 },
    ];
    const carriersWithoutBridge: BoxRect[] = [
      { x: 0, y: 0, w: 100, h: 100 },   // 0
      { x: 30, y: 0, w: 100, h: 100 },  // 1 (IoU with 0: 70/130 ≈ 0.538)
      { x: 90, y: 0, w: 100, h: 100 },  // 2 (IoU with 1: 40/160 = 0.25 < 0.5)
      { x: 120, y: 0, w: 100, h: 100 }, // 3 (IoU with 2: 70/130 ≈ 0.538)
    ];

    const unbridged = associateHeuristicChambers(boxesWithoutBridge, carriersWithoutBridge);
    expect(unbridged.proposals[0]).not.toBeNull();
    expect(unbridged.proposals[0]).toBe(unbridged.proposals[1]);
    expect(unbridged.proposals[2]).not.toBeNull();
    expect(unbridged.proposals[2]).toBe(unbridged.proposals[3]);
    // Prior groups are distinct
    expect(unbridged.proposals[0]).not.toBe(unbridged.proposals[2]);

    // Now insert Box 4 as a bridge: Carrier 4 overlaps Carrier 1 (IoU ≈ 0.538) and Carrier 2 (IoU ≈ 0.538)
    const boxesWithBridge: BoxRect[] = [
      ...boxesWithoutBridge,
      { x: 70, y: 10, w: 20, h: 20 },
    ];
    const carriersWithBridge: BoxRect[] = [
      ...carriersWithoutBridge,
      { x: 60, y: 0, w: 100, h: 100 }, // 4 (Bridge: overlaps 1 at 30..130 and 2 at 90..190)
    ];

    const bridged = associateHeuristicChambers(boxesWithBridge, carriersWithBridge);
    // All 5 members converge onto the single unified proposal identity
    expect(bridged.proposals[0]).not.toBeNull();
    expect(bridged.proposals[0]).toBe(bridged.proposals[1]);
    expect(bridged.proposals[1]).toBe(bridged.proposals[2]);
    expect(bridged.proposals[2]).toBe(bridged.proposals[3]);
    expect(bridged.proposals[3]).toBe(bridged.proposals[4]);
  });

  it('guarantees deterministic group equivalence and proposal geometry under array permutations', () => {
    const boxes: BoxRect[] = [
      { x: 10, y: 10, w: 20, h: 20 },
      { x: 30, y: 10, w: 20, h: 20 },
      { x: 50, y: 10, w: 20, h: 20 },
    ];
    const carriers: BoxRect[] = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 20, y: 0, w: 100, h: 100 },
      { x: 40, y: 0, w: 100, h: 100 },
    ];

    const perm0 = [0, 1, 2];
    const perm1 = [2, 0, 1];
    const perm2 = [1, 2, 0];

    const res0 = associateHeuristicChambers(
      perm0.map((i) => boxes[i]),
      perm0.map((i) => carriers[i])
    );
    const res1 = associateHeuristicChambers(
      perm1.map((i) => boxes[i]),
      perm1.map((i) => carriers[i])
    );
    const res2 = associateHeuristicChambers(
      perm2.map((i) => boxes[i]),
      perm2.map((i) => carriers[i])
    );

    // All members in each run share proposal identity
    expect(res0.proposals[0]).toBe(res0.proposals[1]);
    expect(res0.proposals[1]).toBe(res0.proposals[2]);
    expect(res1.proposals[0]).toBe(res1.proposals[1]);
    expect(res1.proposals[1]).toBe(res1.proposals[2]);
    expect(res2.proposals[0]).toBe(res2.proposals[1]);
    expect(res2.proposals[1]).toBe(res2.proposals[2]);

    // Proposal geometry is identical across permutations
    expect(res0.proposals[0]).toEqual(res1.proposals[0]);
    expect(res1.proposals[0]).toEqual(res2.proposals[0]);
  });

  it('leaves boxes with null carriers as free text with null proposals while associating valid carriers', () => {
    const boxes: BoxRect[] = [
      { x: 40, y: 40, w: 40, h: 30 },
      { x: 200, y: 300, w: 50, h: 30 },
      { x: 60, y: 60, w: 40, h: 30 },
      { x: 300, y: 400, w: 50, h: 30 },
    ];
    const carriers: (BoxRect | null)[] = [
      { x: 30, y: 30, w: 100, h: 100 },
      null, // Free text
      { x: 40, y: 40, w: 100, h: 100 },
      null, // Free text
    ];

    const { proposals } = associateHeuristicChambers(boxes, carriers);
    expect(proposals[0]).not.toBeNull();
    expect(proposals[0]).toBe(proposals[2]);
    expect(proposals[1]).toBeNull();
    expect(proposals[3]).toBeNull();
  });

  it('correctly maps page coords to mask coords with different scale factors and non-zero patch origins', () => {
    // Patch origin: (100, 150), scaleX = 0.5, scaleY = 0.5
    // Page span: X in [100, 100 + 200/0.5] = [100, 500], Y in [150, 150 + 160/0.5] = [150, 470]
    const patchW = 200;
    const patchH = 160;
    const fullMask = new Uint8Array(patchW * patchH).fill(1);

    const scaledShape: BubbleShapeEvidence = {
      x: 100,
      y: 150,
      scale: 0.5,
      scaleX: 0.5,
      scaleY: 0.5,
      width: patchW,
      height: patchH,
      interior: fullMask,
      observedInterior: fullMask,
      eroded: fullMask,
      reconstructed: fullMask,
      validatedComponent: true,
    };

    const boxes: BoxRect[] = [
      { x: 120, y: 180, w: 60, h: 40 },
      { x: 300, y: 280, w: 80, h: 50 },
    ];
    const carriers: BoxRect[] = [
      { x: 100, y: 160, w: 380, h: 280 },
      { x: 110, y: 170, w: 380, h: 280 },
    ];
    const shapes = [scaledShape, scaledShape];

    const { proposals, shapes: resolved } = associateHeuristicChambers(boxes, carriers, shapes);
    expect(proposals[0]).not.toBeNull();
    expect(proposals[0]).toBe(proposals[1]);
    expect(resolved[0]).toBe(scaledShape);
    expect(resolved[1]).toBe(scaledShape);
  });

  it('guarantees no mutation of input boxes, carriers, and shapes arrays or objects', () => {
    const boxes: BoxRect[] = [
      { x: 40, y: 40, w: 50, h: 30 },
      { x: 60, y: 50, w: 50, h: 30 },
    ];
    const carriers: (BoxRect | null)[] = [
      { x: 30, y: 30, w: 120, h: 100 },
      { x: 40, y: 35, w: 120, h: 100 },
    ];
    const mask = new Uint8Array(120 * 100).fill(1);
    const shape: BubbleShapeEvidence = {
      x: 30, y: 30, scale: 1, width: 120, height: 100,
      interior: mask, observedInterior: mask, eroded: mask, validatedComponent: true,
    };
    const shapes = [shape, shape];

    // Deep freeze inputs to assert no in-place mutation
    boxes.forEach((b) => Object.freeze(b));
    carriers.forEach((c) => c && Object.freeze(c));
    shapes.forEach((s) => s && Object.freeze(s));
    Object.freeze(boxes);
    Object.freeze(carriers);
    Object.freeze(shapes);

    const result = associateHeuristicChambers(boxes, carriers, shapes);

    expect(result.proposals).not.toBe(carriers);
    expect(result.shapes).not.toBe(shapes);
    expect(result.proposals[0]).not.toBe(carriers[0]);
    expect(result.proposals[0]).toEqual(carriers[0]);
  });

  it('eliminates raw pixel count dominance: only shares mask containing all group boxes in page coords', () => {
    const boxes: BoxRect[] = [
      { x: 50, y: 50, w: 40, h: 30 },
      { x: 150, y: 50, w: 40, h: 30 },
    ];
    const carriers: BoxRect[] = [
      { x: 40, y: 40, w: 160, h: 60 },
      { x: 45, y: 40, w: 155, h: 60 },
    ];

    // Shape A: 10,000 pixels (larger!), but domain is [0..100] so it truncates Box 1 (x: 150..190)
    const largeMask = new Uint8Array(100 * 100).fill(1);
    const truncatedShapeA: BubbleShapeEvidence = {
      x: 0, y: 0, scale: 1, width: 100, height: 100,
      interior: largeMask, observedInterior: largeMask, eroded: largeMask, validatedComponent: true,
    };

    // Shape B: 9,600 pixels (smaller!), but covers [40..200, 40..100] containing BOTH Box 0 and Box 1
    const completeMask = new Uint8Array(160 * 60).fill(1);
    const completeShapeB: BubbleShapeEvidence = {
      x: 40, y: 40, scale: 1, width: 160, height: 60,
      interior: completeMask, observedInterior: completeMask, eroded: completeMask, validatedComponent: true,
    };

    // Box 0 produced truncatedShapeA, Box 1 produced completeShapeB
    const { proposals, shapes: resolved } = associateHeuristicChambers(
      boxes, carriers, [truncatedShapeA, completeShapeB]
    );

    expect(proposals[0]).not.toBeNull();
    expect(proposals[0]).toBe(proposals[1]);
    // Complete shape containing all group boxes is chosen, NOT truncatedShapeA despite higher pixel count
    expect(resolved[0]).toBe(completeShapeB);
    expect(resolved[1]).toBe(completeShapeB);
  });

  it('retains per-box shapes and returns null proposals when evidence is insufficient across chambers', () => {
    const boxes: BoxRect[] = [
      { x: 20, y: 20, w: 40, h: 30 },
      { x: 180, y: 20, w: 40, h: 30 },
    ];
    // High carrier IoU >= 0.5
    const carriers: BoxRect[] = [
      { x: 10, y: 10, w: 220, h: 60 },
      { x: 15, y: 10, w: 215, h: 60 },
    ];

    // Shape 0 only covers Box 0: domain [0..80]
    const mask0 = new Uint8Array(80 * 50).fill(1);
    const shape0: BubbleShapeEvidence = {
      x: 0, y: 10, scale: 1, width: 80, height: 50,
      interior: mask0, observedInterior: mask0, eroded: mask0, validatedComponent: true,
    };

    // Shape 1 only covers Box 1: domain [160..240]
    const mask1 = new Uint8Array(80 * 50).fill(1);
    const shape1: BubbleShapeEvidence = {
      x: 160, y: 10, scale: 1, width: 80, height: 50,
      interior: mask1, observedInterior: mask1, eroded: mask1, validatedComponent: true,
    };

    // Neither shape contains both boxes
    const { proposals, shapes: resolved } = associateHeuristicChambers(boxes, carriers, [shape0, shape1]);

    // Avoids false common identity: proposals remain null
    expect(proposals[0]).toBeNull();
    expect(proposals[1]).toBeNull();
    // Retains per-box shapes
    expect(resolved[0]).toBe(shape0);
    expect(resolved[1]).toBe(shape1);
  });

  it('merges immediately on pre-validated SAME shape reference even with low carrier IoU', () => {
    const boxes: BoxRect[] = [
      { x: 40, y: 40, w: 30, h: 30 },
      { x: 120, y: 40, w: 30, h: 30 },
    ];
    // Low IoU: 40*60 / (100*60 + 100*60 - 40*60) = 2400 / 9600 = 0.25 < 0.5
    const carriers: BoxRect[] = [
      { x: 20, y: 30, w: 100, h: 60 },
      { x: 80, y: 30, w: 100, h: 60 },
    ];
    const mask = new Uint8Array(180 * 80).fill(1);
    const validatedRef: BubbleShapeEvidence = {
      x: 10, y: 20, scale: 1, width: 180, height: 80,
      interior: mask, observedInterior: mask, eroded: mask, validatedComponent: true,
    };

    // Same object reference passed to both boxes
    const { proposals, shapes: resolved } = associateHeuristicChambers(
      boxes, carriers, [validatedRef, validatedRef]
    );

    expect(proposals[0]).not.toBeNull();
    expect(proposals[0]).toBe(proposals[1]);
    expect(resolved[0]).toBe(validatedRef);
    expect(resolved[1]).toBe(validatedRef);
  });

  it('rejects unvalidated shapes marked with validatedComponent: false', () => {
    const boxes: BoxRect[] = [
      { x: 50, y: 50, w: 30, h: 30 },
      { x: 90, y: 50, w: 30, h: 30 },
    ];
    const carriers: BoxRect[] = [
      { x: 40, y: 40, w: 120, h: 60 },
      { x: 45, y: 40, w: 115, h: 60 },
    ];
    const mask = new Uint8Array(120 * 60).fill(1);
    const unvalidatedShape: BubbleShapeEvidence = {
      x: 40, y: 40, scale: 1, width: 120, height: 60,
      interior: mask, observedInterior: mask, eroded: mask,
      validatedComponent: false, // Explicitly failed enclosure / boundary support
    };

    const { proposals } = associateHeuristicChambers(
      boxes, carriers, [unvalidatedShape, unvalidatedShape]
    );

    expect(proposals[0]).toBeNull();
    expect(proposals[1]).toBeNull();
  });

  it('tests exact inclusive 0.5 IoU threshold boundary', () => {
    const boxes: BoxRect[] = [
      { x: 20, y: 20, w: 30, h: 30 },
      { x: 120, y: 20, w: 30, h: 30 },
    ];
    // Exact IoU = 20,000 / 40,000 = 0.500000000
    const carrierAtExact05A: BoxRect = { x: 0, y: 0, w: 300, h: 100 };
    const carrierAtExact05B: BoxRect = { x: 100, y: 0, w: 300, h: 100 };

    const atThreshold = associateHeuristicChambers(boxes, [carrierAtExact05A, carrierAtExact05B]);
    expect(atThreshold.proposals[0]).not.toBeNull();
    expect(atThreshold.proposals[0]).toBe(atThreshold.proposals[1]);

    // Sub-threshold: IoU = 19,900 / 40,100 ≈ 0.49625 < 0.5
    const carrierSubThresholdB: BoxRect = { x: 101, y: 0, w: 300, h: 100 };
    const belowThreshold = associateHeuristicChambers(boxes, [carrierAtExact05A, carrierSubThresholdB]);
    expect(belowThreshold.proposals[0]).toBeNull();
    expect(belowThreshold.proposals[1]).toBeNull();
  });

  it('never invents arbitrary union bounding boxes for proposals', () => {
    const boxes: BoxRect[] = [
      { x: 50, y: 50, w: 30, h: 30 },
      { x: 100, y: 100, w: 30, h: 30 },
    ];
    const carrierA: BoxRect = { x: 40, y: 40, w: 140, h: 200 };
    const carrierB: BoxRect = { x: 60, y: 80, w: 140, h: 200 };

    const { proposals } = associateHeuristicChambers(boxes, [carrierA, carrierB]);
    expect(proposals[0]).not.toBeNull();
    // Must be one of the constituent carriers, never the arbitrary union (x:40, y:40, w:160, h:240)
    expect(proposals[0]).toEqual(carrierA);
    expect(proposals[0]).not.toEqual({ x: 40, y: 40, w: 160, h: 240 });
  });
});

