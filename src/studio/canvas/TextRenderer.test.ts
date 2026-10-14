import { describe, it, expect } from 'vitest';
import { CanvasFurniture } from './CanvasFurniture';
import type { TextObject } from '../types';

describe('CanvasFurniture Hit Testing', () => {
  const obj: TextObject = {
    id: 't-1',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    text: 'Test Bubble',
    fontSize: 16,
    fontFamily: 'sans-serif',
    color: '#000',
  };

  it('detects hit inside object body', () => {
    expect(CanvasFurniture.hitTestBody({ x: 150, y: 150 }, obj)).toBe(true);
    expect(CanvasFurniture.hitTestBody({ x: 50, y: 50 }, obj)).toBe(false);
  });

  it('detects corner handle nw at top-left', () => {
    const handle = CanvasFurniture.hitTestHandles({ x: 100, y: 100 }, obj);
    expect(handle).toBe('nw');
  });

  it('detects rotation handle above top edge', () => {
    // Top handle is at (x + width/2, y) = (200, 100).
    // Rotation handle is at y - 24 = (200, 76).
    const handle = CanvasFurniture.hitTestHandles({ x: 200, y: 76 }, obj);
    expect(handle).toBe('rot');
  });

  it('handles rotated object hit-testing accurately', () => {
    const rotatedObj: TextObject = {
      ...obj,
      rotation: 90,
    };
    // Center is (200, 150)
    expect(CanvasFurniture.hitTestBody({ x: 200, y: 150 }, rotatedObj)).toBe(true);
  });
});
