import { describe, expect, it, vi } from 'vitest';
import { acquireBubbleGeometry, MIN_SHARED_FONT_RATIO, resolveBubbleLayouts, type BubbleLayoutInput } from './BubbleLayoutService';
import { computeTypesetBox, type BoxRect } from '../utils/bubbleExpansion';
import type { BubbleShapeEvidence } from '../engines/bubble/HeuristicBubbleExtractor';

const carrier = { x: 0, y: 20, w: 200, h: 300 };
const verticalPair = [{ x: 80, y: 70, w: 40, h: 40 }, { x: 80, y: 220, w: 40, h: 40 }];

/** @param boxes - Sources. @returns Defaults with shared neural proposal but no invented shape proof. */
function inputFor(boxes: BoxRect[]): BubbleLayoutInput {
  return { pageWidth: 500, boxes, carriers: boxes.map(() => carrier), proposals: boxes.map(() => carrier),
    shapes: [], directions: boxes.map(() => 'v'), pageHeight: 500, accept: () => true };
}

/** @param count - Lobes. @returns Synthetic enclosed rectangular lobes joined by narrow raw necks. */
function shapeFor(count = 2): BubbleShapeEvidence {
  const width = 201, height = 501;
  const interior = new Uint8Array(width * height);
  const eroded = new Uint8Array(width * height);
  for (let lobe = 0; lobe < count; lobe++) {
    const top = 40 + lobe * 150;
    for (let y = top; y <= top + 100; y++) {
      for (let x = 20; x <= 180; x++) {
        interior[y * width + x] = 1;
        if (y > top + 5 && y < top + 95 && x > 25 && x < 175) eroded[y * width + x] = 1;
      }
    }
    if (lobe > 0) for (let y = top - 50; y < top; y++) for (let x = 95; x <= 105; x++) interior[y * width + x] = 1;
  }
  return { x: 0, y: 0, scale: 1, width, height, interior, observedInterior: interior.slice(), eroded };
}

describe('conservative bubble layouts', () => {
  it('keeps sole occupant on existing computeTypesetBox path', () => {
    const input = inputFor([verticalPair[0]]);
    const shape = shapeFor();
    shape.interior.fill(1);
    // Closed rectangular interior for the unchanged sole-occupant computation.
    for (let x = 0; x < shape.width; x++) { shape.interior[x] = 0; shape.interior[(shape.height - 1) * shape.width + x] = 0; }
    for (let y = 0; y < shape.height; y++) { shape.interior[y * shape.width] = 0; shape.interior[y * shape.width + shape.width - 1] = 0; }
    input.shapes = [shape];
    expect(resolveBubbleLayouts(input)).toEqual([computeTypesetBox(verticalPair[0], carrier, true, 500, false)]);
  });

  it('does not partition one smooth bubble or invent lobes from common proposal identity', () => {
    expect(resolveBubbleLayouts(inputFor(verticalPair))).toEqual([undefined, undefined]);
  });

  it('accepts connected lobe evidence and passes experimental fit ratio to every sibling', () => {
    const accept = vi.fn((_index: number, _proposed: BoxRect, _ratio?: number) => true);
    const result = resolveBubbleLayouts({ ...inputFor(verticalPair), shapes: [shapeFor()], accept });
    expect(result.every(Boolean)).toBe(true);
    expect(result[0]!.y + result[0]!.h + 6).toBeLessThanOrEqual(result[1]!.y);
    expect(accept).toHaveBeenCalledTimes(2);
    expect(accept.mock.calls[0][2]).toBe(MIN_SHARED_FONT_RATIO);
  });

  it('accepts an X chain only with the same connected-neck and full-interior evidence', () => {
    const source = shapeFor();
    const width = source.height, height = source.width;
    const interior = new Uint8Array(width * height);
    const eroded = new Uint8Array(width * height);
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      interior[x * width + y] = source.interior[y * source.width + x];
      eroded[x * width + y] = source.eroded[y * source.width + x];
    }
    // X expansion budgets width rather than capped shared height; provide genuinely roomy lobes.
    for (let y = 20; y <= 180; y++) for (let x = 30; x <= 310; x++) {
      if (x <= 165 || x >= 175) interior[y * width + x] = 1;
    }
    const boxes = verticalPair.map((box) => ({ x: box.y, y: box.x, w: box.h, h: box.w }));
    const horizontalCarrier = { x: carrier.y, y: carrier.x, w: carrier.h, h: carrier.w };
    const result = resolveBubbleLayouts({ ...inputFor(boxes),
      carriers: [horizontalCarrier, horizontalCarrier], proposals: [horizontalCarrier, horizontalCarrier],
      shapes: [{ x: 0, y: 0, scale: 1, width, height, interior, observedInterior: interior.slice(), eroded }] });
    expect(result.every(Boolean)).toBe(true);
    expect(result[0]!.x + result[0]!.w + 6).toBeLessThanOrEqual(result[1]!.x);
  });

  it('rolls the whole group back if one translated sibling fails fit', () => {
    const result = resolveBubbleLayouts({ ...inputFor(verticalPair), shapes: [shapeFor()], accept: (i) => i === 0 });
    expect(result).toEqual([undefined, undefined]);
  });

  it.each([
    [{ x: 40, y: 70, w: 40, h: 40 }, { x: 81, y: 70, w: 40, h: 40 }],
    [{ x: 40, y: 70, w: 45, h: 40 }, { x: 81, y: 70, w: 40, h: 40 }],
    [{ x: 30, y: 70, w: 40, h: 40 }, { x: 100, y: 220, w: 40, h: 40 }]
  ])('rejects 1px slits, negative gaps, and true diagonals %#', (first, second) => {
    expect(resolveBubbleLayouts({ ...inputFor([first, second]), shapes: [shapeFor()] })).toEqual([undefined, undefined]);
  });

  it('flags nested heuristic carriers as uncertain rather than expanding independently', () => {
    const input = inputFor(verticalPair);
    input.proposals = [null, null];
    input.carriers = [carrier, { x: 40, y: 180, w: 120, h: 100 }];
    expect(resolveBubbleLayouts(input)).toEqual([undefined, undefined]);
  });

  it('requires a coherent chain for three siblings and validates all members', () => {
    const boxes = [...verticalPair, { x: 80, y: 370, w: 40, h: 40 }];
    const input = { ...inputFor(boxes), carriers: boxes.map(() => ({ ...carrier, h: 450 })), shapes: [shapeFor(3)] };
    expect(resolveBubbleLayouts(input).every(Boolean)).toBe(true);
    expect(resolveBubbleLayouts({ ...input, accept: (i) => i !== 2 })).toEqual([undefined, undefined, undefined]);
    expect(resolveBubbleLayouts({ ...input, boxes: [boxes[0], { ...boxes[1], x: 140 }, boxes[2]] })).toEqual([undefined, undefined, undefined]);
  });

  it('rejects rotated group atomically and never mutates source or fallback siblings', () => {
    const input = { ...inputFor(verticalPair), shapes: [shapeFor()], angles: [0, 1] };
    const before = structuredClone(input.boxes);
    expect(resolveBubbleLayouts(input)).toEqual([undefined, undefined]);
    expect(input.boxes).toEqual(before);
  });

  it('rejects disconnected lobes, open mask components, and proposals outside safe interior', () => {
    const disconnected = shapeFor();
    for (let y = 141; y < 190; y++) disconnected.interior.fill(0, y * disconnected.width, (y + 1) * disconnected.width);
    expect(resolveBubbleLayouts({ ...inputFor(verticalPair), shapes: [disconnected] })).toEqual([undefined, undefined]);
    const open = shapeFor();
    for (let x = 0; x < 100; x++) open.interior[90 * open.width + x] = 1;
    expect(resolveBubbleLayouts({ ...inputFor(verticalPair), shapes: [open] })).toEqual([undefined, undefined]);
    const cut = shapeFor();
    cut.interior[90 * cut.width + 100] = 0;
    expect(resolveBubbleLayouts({ ...inputFor(verticalPair), shapes: [cut] })).toEqual([undefined, undefined]);
  });

  it('rejects force-filled text as the only connection between lobes', () => {
    const shape = shapeFor();
    for (let y = 141; y < 190; y++) shape.observedInterior.fill(0, y * shape.width, (y + 1) * shape.width);
    expect(resolveBubbleLayouts({ ...inputFor(verticalPair), shapes: [shape] })).toEqual([undefined, undefined]);
  });

  it('rejects nonfinite or off-page geometry before font acceptance', () => {
    const accept = vi.fn(() => true);
    for (const invalid of [{ ...carrier, w: NaN }, { ...carrier, x: -1 }, { ...carrier, h: 600 }]) {
      const input = inputFor([verticalPair[0]]);
      expect(resolveBubbleLayouts({ ...input, carriers: [invalid], shapes: [shapeFor()], accept })).toEqual([undefined]);
    }
    expect(accept).not.toHaveBeenCalled();
  });

  it('acquisition retains exact proposal identity and does not mutate source boxes', () => {
    const data = new Uint8ClampedArray(400 * 400 * 4).fill(255);
    const boxes = [{ x: 100, y: 100, w: 30, h: 40 }];
    const proposal = { x: 80, y: 80, w: 90, h: 100 };
    const geometry = acquireBubbleGeometry({ width: 400, height: 400, data }, boxes, [proposal]);
    expect(geometry.proposals[0]).toBe(proposal);
    expect(geometry.carriers[0]).toBe(proposal);
    expect(boxes).toEqual([{ x: 100, y: 100, w: 30, h: 40 }]);
  });
});
