import { describe, it, expect } from 'vitest';
import { WarpMesh } from './WarpMesh';

describe('WarpMesh Bilinear Quad Interpolation', () => {
  const quad: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it('evaluates corners at normalized boundaries (0,0), (1,0), (1,1), (0,1)', () => {
    expect(WarpMesh.mapBilinear(quad, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(WarpMesh.mapBilinear(quad, 1, 0)).toEqual({ x: 100, y: 0 });
    expect(WarpMesh.mapBilinear(quad, 1, 1)).toEqual({ x: 100, y: 100 });
    expect(WarpMesh.mapBilinear(quad, 0, 1)).toEqual({ x: 0, y: 100 });
  });

  it('evaluates exact midpoint at (0.5, 0.5)', () => {
    const mid = WarpMesh.mapBilinear(quad, 0.5, 0.5);
    expect(mid.x).toBe(50);
    expect(mid.y).toBe(50);
  });

  it('generates parametric arch quad with non-zero bend', () => {
    const archQuad = WarpMesh.generatePresetQuad(200, 100, 'arch', 0.5);
    expect(archQuad[0].y).toBeGreaterThan(0);
    expect(archQuad[1].y).toBeGreaterThan(0);
    expect(archQuad[2].y).toBe(100);
    expect(archQuad[3].y).toBe(100);
  });
});
