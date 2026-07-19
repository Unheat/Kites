/**
 * Utility functions for math and geometry, used for typesetting rotated text 
 * into 4-point OCR polygons.
 */

export type Point2D = [number, number];

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/**
 * Calculates the bounding box of a 4-point polygon.
 * Assumes order is [top-left, top-right, bottom-right, bottom-left].
 */
export function calculateBoundingBox(polygon: Point2D[]): BoundingBox {
  if (!polygon || polygon.length < 4) {
    return { x: 0, y: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }

  const [tl, tr, br, bl] = polygon;

  // Calculate width using distance between top-left and top-right
  const widthTop = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
  const widthBottom = Math.hypot(br[0] - bl[0], br[1] - bl[1]);
  const width = Math.max(widthTop, widthBottom);

  // Calculate height using distance between top-left and bottom-left
  const heightLeft = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
  const heightRight = Math.hypot(br[0] - tr[0], br[1] - tr[1]);
  const height = Math.max(heightLeft, heightRight);
  
  // The center is the average of all 4 points
  const centerX = (tl[0] + tr[0] + br[0] + bl[0]) / 4;
  const centerY = (tl[1] + tr[1] + br[1] + bl[1]) / 4;

  return {
    x: tl[0],
    y: tl[1],
    width,
    height,
    centerX,
    centerY
  };
}

/**
 * Calculates the rotation angle in radians of a 4-point polygon.
 * 0 radians is straight.
 */
export function calculateRotationAngle(polygon: Point2D[]): number {
  if (!polygon || polygon.length < 2) return 0;
  
  const [tl, tr] = polygon;
  // Angle between top-left and top-right
  return Math.atan2(tr[1] - tl[1], tr[0] - tl[0]);
}
