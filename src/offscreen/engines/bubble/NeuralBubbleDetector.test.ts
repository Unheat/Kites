import { describe, expect, it, vi } from 'vitest';
import { NeuralBubbleDetector } from './NeuralBubbleDetector';

describe('NeuralBubbleDetector container safety', () => {
  it('accepts only class 0, never text_bubble or text_free', () => {
    const result = NeuralBubbleDetector.parseDetections([0n, 1n, 2n],
      [0, 0, 100, 100, 0, 0, 90, 90, 0, 0, 80, 80], [0.9, 0.99, 0.99]);
    expect(result).toEqual({ bubbles: [{ x: 0, y: 0, w: 100, h: 100 }], scores: [0.9] });
  });

  it('rejects invalid coordinates and inverted rectangles', () => {
    expect(NeuralBubbleDetector.parseDetections([0, 0, 0],
      [NaN, 0, 100, 100, 20, 0, 10, 100, 0, 0, 100, 100], [0.9, 0.9, NaN]).bubbles).toEqual([]);
  });

  it('keeps proposal object identity and enforces .50 coverage even with center inside', () => {
    const text = { x: 0, y: 0, w: 100, h: 100 };
    const low = { x: 30, y: 0, w: 40, h: 100 };
    const enough = { x: 25, y: 0, w: 50, h: 100 };
    expect(NeuralBubbleDetector.matchBubble(text, [low])).toBeNull();
    expect(NeuralBubbleDetector.matchBubble(text, [enough])).toBe(enough);
  });

  it('manages session lifecycle and cleanly disposes cached session', async () => {
    expect(NeuralBubbleDetector.hasActiveSession()).toBe(false);
    // Simulate active session
    (NeuralBubbleDetector as any).session = { release: vi.fn(async () => {}) };
    (NeuralBubbleDetector as any).activeProvider = 'wasm';
    expect(NeuralBubbleDetector.hasActiveSession()).toBe(true);

    await NeuralBubbleDetector.dispose();
    expect(NeuralBubbleDetector.hasActiveSession()).toBe(false);
    expect((NeuralBubbleDetector as any).activeProvider).toBeNull();
  });

  it('decodes prototype mask via linear combination of 32 channels and logit threshold >= 0', () => {
    const protoDim = 256;
    const protoData = new Float32Array(32 * protoDim * protoDim).fill(-1.0);
    // Channel 0 has positive logits (+2.0) in region x: 10..20, y: 10..20
    for (let y = 10; y <= 20; y++) {
      for (let x = 10; x <= 20; x++) {
        protoData[0 * protoDim * protoDim + y * protoDim + x] = 2.0;
      }
    }

    const coeffs = new Float32Array(32);
    coeffs[0] = 1.0; // Positive coefficient on channel 0

    // rawBox in 1024 space: center at (60, 60), size (80, 80) -> proto grid [10, 20]
    const rawBox = { cx: 60, cy: 60, w: 40, h: 40 };
    const decoded = NeuralBubbleDetector.decodeProtoMask(rawBox, coeffs, protoData, protoDim, 1024);

    expect(decoded).not.toBeNull();
    if (decoded) {
      expect(decoded.pw).toBeGreaterThan(0);
      expect(decoded.ph).toBeGreaterThan(0);
      // Some pixels in the mask must be 1 where channel 0 logit was +2.0
      let hasOne = false;
      for (let i = 0; i < decoded.mask.length; i++) {
        if (decoded.mask[i] === 1) hasOne = true;
      }
      expect(hasOne).toBe(true);
    }
  });

  it('matches bubble index with coverage >= 0.50 and center inside', () => {
    const text = { x: 50, y: 50, w: 40, h: 40 };
    const bubbleA = { x: 0, y: 0, w: 20, h: 20 }; // No overlap
    const bubbleB = { x: 40, y: 40, w: 60, h: 60 }; // Encloses text
    expect(NeuralBubbleDetector.matchBubbleIndex(text, [bubbleA, bubbleB])).toBe(1);
    expect(NeuralBubbleDetector.matchBubbleIndex(text, [bubbleA])).toBe(-1);
  });
});
