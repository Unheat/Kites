import type { TransformHandle } from '../types';

/** Minimum dimension for text boxes in pixels. */
export const MIN_TEXT_BOX_SIZE = 20;

export interface TransformBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

/**
 * Computes new bounding box geometry when dragging a transform handle on an object
 * that may be rotated.
 *
 * For rotated objects, world-space mouse deltas are projected onto the object's
 * local coordinate frame via inverse rotation trigonometry. The resulting local
 * dimension changes and center displacement are then rotated back into world space,
 * ensuring the opposite edge/corner remains perfectly anchored.
 *
 * @param initial - Initial unmutated bounds of the object when drag started.
 * @param handle - The active transform handle being dragged.
 * @param worldDeltaX - Mouse travel in world image coordinate space X.
 * @param worldDeltaY - Mouse travel in world image coordinate space Y.
 * @param minSize - Minimum allowed width or height in pixels (default 20).
 * @returns Updated world-space bounds (x, y, width, height).
 */
export function computeRotatedBounds(
  initial: TransformBounds,
  handle: TransformHandle,
  worldDeltaX: number,
  worldDeltaY: number,
  minSize: number = MIN_TEXT_BOX_SIZE
): { x: number; y: number; width: number; height: number } {
  const origW = initial.width;
  const origH = initial.height;
  const origCenterX = initial.x + origW / 2;
  const origCenterY = initial.y + origH / 2;

  if (handle === 'move') {
    return {
      x: initial.x + worldDeltaX,
      y: initial.y + worldDeltaY,
      width: origW,
      height: origH,
    };
  }

  const rotationDeg = initial.rotation || 0;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Project world mouse delta into object's local rotated coordinate frame:
  // [localDeltaX] = [ cos  sin] [worldDeltaX]
  // [localDeltaY]   [-sin  cos] [worldDeltaY]
  const localDeltaX = worldDeltaX * cos + worldDeltaY * sin;
  const localDeltaY = -worldDeltaX * sin + worldDeltaY * cos;

  let newW = origW;
  let newH = origH;
  let shiftLocalX = 0;
  let shiftLocalY = 0;

  // Horizontal resizing along local X-axis
  if (handle === 'e' || handle === 'ne' || handle === 'se' || handle === 'wrap') {
    newW = Math.max(minSize, origW + localDeltaX);
    shiftLocalX = (newW - origW) / 2;
  } else if (handle === 'w' || handle === 'nw' || handle === 'sw') {
    newW = Math.max(minSize, origW - localDeltaX);
    shiftLocalX = -(newW - origW) / 2;
  }

  // Vertical resizing along local Y-axis
  if (handle === 's' || handle === 'se' || handle === 'sw') {
    newH = Math.max(minSize, origH + localDeltaY);
    shiftLocalY = (newH - origH) / 2;
  } else if (handle === 'n' || handle === 'ne' || handle === 'nw') {
    newH = Math.max(minSize, origH - localDeltaY);
    shiftLocalY = -(newH - origH) / 2;
  }

  // Project local center shift back into world image coordinate space:
  // [worldShiftX] = [cos  -sin] [shiftLocalX]
  // [worldShiftY]   [sin   cos] [shiftLocalY]
  const worldShiftX = shiftLocalX * cos - shiftLocalY * sin;
  const worldShiftY = shiftLocalX * sin + shiftLocalY * cos;

  const newCenterX = origCenterX + worldShiftX;
  const newCenterY = origCenterY + worldShiftY;

  return {
    x: Math.round(newCenterX - newW / 2),
    y: Math.round(newCenterY - newH / 2),
    width: Math.round(newW),
    height: Math.round(newH),
  };
}

/**
 * Returns the appropriate CSS cursor for a transform handle, optionally taking
 * the object's rotation into account.
 *
 * @param handle - Transform handle being hovered or dragged.
 * @param rotationDeg - Object rotation in degrees.
 * @returns CSS cursor string.
 */
export function getHandleCursor(handle: TransformHandle, rotationDeg: number = 0): string {
  if (handle === 'rot') return 'grab';
  if (handle === 'move') return 'move';
  if (handle === 'font-size') return 'ns-resize';
  if (handle === 'wrap') return 'ew-resize';

  // Base angles for standard bounding handles in unrotated local space
  const handleAngles: Partial<Record<TransformHandle, number>> = {
    e: 0,
    se: 45,
    s: 90,
    sw: 135,
    w: 180,
    nw: 225,
    n: 270,
    ne: 315,
  };

  const baseAngle = handleAngles[handle];
  if (baseAngle === undefined) return 'default';

  // Normalize effective angle to [0, 180) since cursors are bidirectional
  let angle = (baseAngle + rotationDeg) % 180;
  if (angle < 0) angle += 180;

  if (angle >= 22.5 && angle < 67.5) return 'nwse-resize';
  if (angle >= 67.5 && angle < 112.5) return 'ns-resize';
  if (angle >= 112.5 && angle < 157.5) return 'nesw-resize';
  return 'ew-resize';
}
