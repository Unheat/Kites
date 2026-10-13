import { describe, it, expect } from 'vitest';
import {
  clientToImage,
  imageToClient,
  calculateFitWidth,
  calculateFitHeight,
  calculateFitWindow,
  processWheelNavigation,
} from './CanvasViewport';

describe('CanvasViewport Coordinate Transformations', () => {
  const containerRect = {
    left: 100,
    top: 50,
    right: 900,
    bottom: 650,
    width: 800,
    height: 600,
    x: 100,
    y: 50,
    toJSON: () => ({}),
  } as DOMRect;

  it('maps client coordinates to image coordinates accurately at 1x zoom with zero pan', () => {
    const pt = clientToImage(200, 150, containerRect, 1.0, { x: 0, y: 0 }, 1000);
    expect(pt.x).toBe(100);
    expect(pt.y).toBe(100);
  });

  it('accounts for zoom scale factor and pan offsets in clientToImage', () => {
    const pt = clientToImage(300, 250, containerRect, 2.0, { x: 50, y: 20 }, 1000);
    // localX = 300 - 100 - 50 = 150 -> 150 / 2 = 75
    // localY = 250 - 50 - 20 = 180 -> 180 / 2 = 90
    expect(pt.x).toBe(75);
    expect(pt.y).toBe(90);
  });

  it('correctly inverts horizontal coordinate when canvas is flipped', () => {
    const pt = clientToImage(200, 150, containerRect, 1.0, { x: 0, y: 0 }, 1000, true);
    // imgX unmirrored is 100 -> mirrored is 1000 - 100 = 900
    expect(pt.x).toBe(900);
    expect(pt.y).toBe(100);
  });

  it('transforms image coordinates back to client coordinates symmetrically', () => {
    const originalImgX = 120;
    const originalImgY = 340;
    const zoom = 1.5;
    const pan = { x: 40, y: -20 };

    const client = imageToClient(originalImgX, originalImgY, containerRect, zoom, pan, 1000);
    const roundTrip = clientToImage(client.x, client.y, containerRect, zoom, pan, 1000);

    expect(Math.round(roundTrip.x)).toBe(originalImgX);
    expect(Math.round(roundTrip.y)).toBe(originalImgY);
  });
});

describe('CanvasViewport Fit Calculations', () => {
  it('calculates fit-width zoom factor with padding', () => {
    const zoom = calculateFitWidth(1032, 1000, 32);
    // (1032 - 32) / 1000 = 1.0
    expect(zoom).toBeCloseTo(1.0, 3);
  });

  it('calculates fit-height zoom factor with padding', () => {
    const zoom = calculateFitHeight(632, 1200, 32);
    // (632 - 32) / 1200 = 0.5
    expect(zoom).toBeCloseTo(0.5, 3);
  });

  it('picks minimum scale in calculateFitWindow to avoid cropping', () => {
    const zoom = calculateFitWindow(1032, 632, 1000, 1200, 32);
    expect(zoom).toBeCloseTo(0.5, 3);
  });
});

describe('CanvasViewport Wheel Processing', () => {
  const containerRect = {
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;

  it('scrolls vertically on standard wheel delta', () => {
    const event = {
      deltaY: 100,
      deltaX: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as WheelEvent;

    const result = processWheelNavigation(event, containerRect, 1.0, { x: 0, y: 0 });
    expect(result.zoom).toBe(1.0);
    expect(result.pan.y).toBe(-60); // 100 * 0.6
  });

  it('scrolls horizontally on Shift+wheel delta', () => {
    const event = {
      deltaY: 100,
      deltaX: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    } as WheelEvent;

    const result = processWheelNavigation(event, containerRect, 1.0, { x: 0, y: 0 });
    expect(result.zoom).toBe(1.0);
    expect(result.pan.x).toBe(-60);
    expect(result.pan.y).toBe(0);
  });

  it('zooms centered on cursor when Ctrl is held', () => {
    const event = {
      deltaY: -100, // Zoom in
      clientX: 400,
      clientY: 300,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    } as WheelEvent;

    const result = processWheelNavigation(event, containerRect, 1.0, { x: 0, y: 0 });
    expect(result.zoom).toBeGreaterThan(1.0);
  });
});
