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
});
