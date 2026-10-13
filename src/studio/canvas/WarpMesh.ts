import type { Point } from '../types';

export type WarpPreset = 'none' | 'arch' | 'wave' | 'bulge' | 'twist' | 'squeeze';

/** Number of vertical/horizontal slices for bilinear mesh rasterization. */
export const WARP_MESH_SLICES = 20;

/**
 * Linearly interpolates between two 2D points.
 */
function lerpPoint(p1: Point, p2: Point, t: number): Point {
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  };
}

export class WarpMesh {
  /**
   * Evaluates the bilinear coordinates of a point inside a 4-point quad.
   *
   * @param quad - The 4 corners [TL, TR, BR, BL].
   * @param u - Normalized horizontal parameter in [0.0, 1.0].
   * @param v - Normalized vertical parameter in [0.0, 1.0].
   * @returns Mapped point in 2D space.
   */
  public static mapBilinear(
    quad: [Point, Point, Point, Point],
    u: number,
    v: number
  ): Point {
    const [tl, tr, br, bl] = quad;
    const top = lerpPoint(tl, tr, u);
    const bottom = lerpPoint(bl, br, u);
    return lerpPoint(top, bottom, v);
  }

  /**
   * Generates a 4-point quad from a bounding box and a parametric warp preset.
   *
   * @param width - Object width in pixels.
   * @param height - Object height in pixels.
   * @param preset - Preset algorithm name.
   * @param bend - Parametric intensity from -1.0 to 1.0 (default 0.5).
   * @returns Quadrilateral corners [TL, TR, BR, BL].
   */
  public static generatePresetQuad(
    width: number,
    height: number,
    preset: WarpPreset,
    bend: number = 0.5
  ): [Point, Point, Point, Point] {
    const defaultQuad: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ];

    if (preset === 'none' || bend === 0) {
      return defaultQuad;
    }

    const deltaY = height * bend * 0.4;
    const deltaX = width * bend * 0.2;

    switch (preset) {
      case 'arch':
        return [
          { x: 0, y: deltaY },
          { x: width, y: deltaY },
          { x: width, y: height },
          { x: 0, y: height },
        ];
      case 'squeeze':
        return [
          { x: deltaX, y: 0 },
          { x: width - deltaX, y: 0 },
          { x: width, y: height },
          { x: 0, y: height },
        ];
      case 'bulge':
        return [
          { x: 0, y: -deltaY },
          { x: width, y: -deltaY },
          { x: width + deltaX, y: height + deltaY },
          { x: -deltaX, y: height + deltaY },
        ];
      case 'wave':
        return [
          { x: 0, y: -deltaY },
          { x: width, y: deltaY },
          { x: width, y: height + deltaY },
          { x: 0, y: height - deltaY },
        ];
      case 'twist':
        return [
          { x: deltaX, y: -deltaY },
          { x: width, y: 0 },
          { x: width - deltaX, y: height + deltaY },
          { x: 0, y: height },
        ];
      default:
        return defaultQuad;
    }
  }

  /**
   * Warps a pre-rendered canvas onto a target context using multi-slice bilinear subdivision.
   *
   * @param targetCtx - Canvas 2D destination context.
   * @param sourceCanvas - Offscreen canvas containing unwarped rasterized text.
   * @param quad - Destination quadrilateral corners [TL, TR, BR, BL].
   */
  public static renderWarpedMesh(
    targetCtx: CanvasRenderingContext2D,
    sourceCanvas: CanvasImageSource,
    quad: [Point, Point, Point, Point]
  ): void {
    const sw = (sourceCanvas as any).width || 100;
    const sh = (sourceCanvas as any).height || 100;
    const sliceCount = WARP_MESH_SLICES;
    const sliceHeight = sh / sliceCount;

    for (let i = 0; i < sliceCount; i++) {
      const v0 = i / sliceCount;
      const v1 = (i + 1) / sliceCount;

      const pTL = this.mapBilinear(quad, 0, v0);
      const pTR = this.mapBilinear(quad, 1, v0);
      const pBL = this.mapBilinear(quad, 0, v1);

      targetCtx.save();
      // Affine transform mapping slice rectangle to skewed quad strip
      const m11 = (pTR.x - pTL.x) / sw;
      const m12 = (pTR.y - pTL.y) / sw;
      const m21 = (pBL.x - pTL.x) / sliceHeight;
      const m22 = (pBL.y - pTL.y) / sliceHeight;
      const dx = pTL.x;
      const dy = pTL.y;

      targetCtx.transform(m11, m12, m21, m22, dx, dy);
      targetCtx.drawImage(
        sourceCanvas,
        0,
        i * sliceHeight,
        sw,
        sliceHeight,
        0,
        0,
        sw,
        sliceHeight
      );
      targetCtx.restore();
    }
  }
}
