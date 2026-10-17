import { describe, it, expect } from 'vitest';
import { CanvasFurniture } from './CanvasFurniture';
import type { TextObject } from '../types';

describe('Studio Gesture & Furniture Usability', () => {
  const sampleBox: TextObject = {
    id: 'box-1',
    x: 100,
    y: 100,
    width: 30, // Narrow vertical manga speech bubble
    height: 80,
    text: 'Hello',
    fontSize: 14,
    fontFamily: 'WildWords',
    color: '#000000',
  };

  it('preserves interior body area for dragging on narrow speech bubbles', () => {
    // Center of the narrow bubble: (x: 115, y: 140)
    const centerPoint = { x: 115, y: 140 };

    // Handle hit test must NOT hijack the center point of the bubble!
    const handleHit = CanvasFurniture.hitTestHandles(centerPoint, sampleBox);
    expect(handleHit).toBeNull();

    // Body hit test must succeed on the center point for move dragging
    const bodyHit = CanvasFurniture.hitTestBody(centerPoint, sampleBox);
    expect(bodyHit).toBe(true);
  });

  it('accurately hits corner and edge handles within clamped radius', () => {
    // Top-left corner (100, 100) -> local (0, 0)
    const nwHit = CanvasFurniture.hitTestHandles({ x: 100, y: 100 }, sampleBox);
    expect(nwHit).toBe('nw');

    // Bottom-right corner (130, 180) -> local (30, 80)
    const seHit = CanvasFurniture.hitTestHandles({ x: 130, y: 180 }, sampleBox);
    expect(seHit).toBe('se');

    // Rotation handle (sits above top edge: midX=115, y = 100 - 24 = 76)
    const rotHit = CanvasFurniture.hitTestHandles({ x: 115, y: 76 }, sampleBox);
    expect(rotHit).toBe('rot');
  });

  it('safely bounds handle hit radius to never swallow small boxes', () => {
    const tinyBox: TextObject = {
      id: 'tiny-1',
      x: 50,
      y: 50,
      width: 16,
      height: 16,
      text: '!',
      fontSize: 10,
      fontFamily: 'WildWords',
      color: '#000000',
    };

    // Center is (58, 58)
    const centerHit = CanvasFurniture.hitTestHandles({ x: 58, y: 58 }, tinyBox);
    expect(centerHit).toBeNull();

    const bodyHit = CanvasFurniture.hitTestBody({ x: 58, y: 58 }, tinyBox);
    expect(bodyHit).toBe(true);
  });
});
