import { describe, it, expect } from 'vitest';
import {
  clientToImage,
  imageToClient,
  calculateFitWidth,
  calculateFitHeight,
  calculateFitWindow,
} from './CanvasViewport';

describe('CanvasViewport Coordinate Transformations', () => {
  const canvasRect = {
    left: 200,
    top: 100,
    width: 600,
    height: 900,
    right: 800,
    bottom: 1000,
    x: 200,
    y: 100,
    toJSON: () => ({}),
  } as DOMRect;

  it('maps client coordinates accurately to image pixels', () => {
    // Middle of the canvasRect: clientX = 500, clientY = 550
    const pt = clientToImage(500, 550, canvasRect, 1200, 1800);
    expect(pt.x).toBe(600);
    expect(pt.y).toBe(900);
  });

  it('inverts horizontal coordinates when canvas is flipped', () => {
    // clientX = 200 (leftmost edge) -> normalizedX = 0 -> flipped: 1200 - 0 = 1200
    const pt = clientToImage(200, 100, canvasRect, 1200, 1800, true);
    expect(pt.x).toBe(1200);
    expect(pt.y).toBe(0);
  });

  it('symmetrically converts image coordinates back to client coordinates', () => {
    const originalImgX = 350;
    const originalImgY = 720;

    const client = imageToClient(originalImgX, originalImgY, canvasRect, 1200, 1800);
    const roundTrip = clientToImage(client.x, client.y, canvasRect, 1200, 1800);

    expect(Math.round(roundTrip.x)).toBe(originalImgX);
    expect(Math.round(roundTrip.y)).toBe(originalImgY);
  });
});

describe('CanvasViewport Fit Calculations', () => {
  it('calculates fit width with padding', () => {
    const scale = calculateFitWidth(1032, 1000, 32);
    expect(scale).toBeCloseTo(1.0, 3);
  });

  it('calculates fit height with padding', () => {
    const scale = calculateFitHeight(632, 1200, 32);
    expect(scale).toBeCloseTo(0.5, 3);
  });

  it('picks minimum scale in calculateFitWindow to prevent viewport overflow', () => {
    const scale = calculateFitWindow(1032, 632, 1000, 1200, 32);
    expect(scale).toBeCloseTo(0.5, 3);
  });
});
