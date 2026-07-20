/**
 * Utility functions for math and geometry, used for typesetting rotated text 
 * into 4-point OCR polygons.
 */

export interface Point2D {
  x: number;
  y: number;
}

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
  const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
  const width = Math.max(widthTop, widthBottom);

  // Calculate height using distance between top-left and bottom-left
  const heightLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);
  const height = Math.max(heightLeft, heightRight);
  
  // The center is the average of all 4 points
  const centerX = (tl.x + tr.x + br.x + bl.x) / 4;
  const centerY = (tl.y + tr.y + br.y + bl.y) / 4;

  return {
    x: tl.x,
    y: tl.y,
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
  return Math.atan2(tr.y - tl.y, tr.x - tl.x);
}
