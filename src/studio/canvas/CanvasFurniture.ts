import type { Point, TextObject, TransformHandle } from '../types';

/** Radius of interactive transform handle nubs in image pixels. */
export const HANDLE_RADIUS = 6;

/** Distance in image pixels between top handle and rotation handle nub. */
export const ROTATION_HANDLE_OFFSET = 24;

export class CanvasFurniture {
  /**
   * Draws selection border, 8-point handles, and rotation nub for an active TextObject.
   *
   * @param ctx - Canvas 2D rendering context.
   * @param obj - Selected TextObject.
   * @param borderColor - Custom selection border color.
   */
  public static drawSelectionFurniture(
    ctx: CanvasRenderingContext2D,
    obj: TextObject,
    borderColor: string = '#6366f1'
  ): void {
    ctx.save();
    ctx.translate(obj.x, obj.y);

    if (obj.rotation) {
      const centerX = obj.width / 2;
      const centerY = obj.height / 2;
      ctx.translate(centerX, centerY);
      ctx.rotate((obj.rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
    }

    // 1. Draw dashed selection boundary
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(0, 0, obj.width, obj.height);
    ctx.setLineDash([]);

    // 2. Draw stem line to rotation handle
    ctx.beginPath();
    ctx.strokeStyle = borderColor;
    ctx.moveTo(obj.width / 2, 0);
    ctx.lineTo(obj.width / 2, -ROTATION_HANDLE_OFFSET);
    ctx.stroke();

    // 3. Draw rotation handle nub
    this.drawHandleNub(ctx, obj.width / 2, -ROTATION_HANDLE_OFFSET, borderColor, true);

    // 4. Draw 8 bounding handles
    const midX = obj.width / 2;
    const midY = obj.height / 2;
    const right = obj.width;
    const bottom = obj.height;

    this.drawHandleNub(ctx, 0, 0, borderColor);
    this.drawHandleNub(ctx, midX, 0, borderColor);
    this.drawHandleNub(ctx, right, 0, borderColor);
    this.drawHandleNub(ctx, right, midY, borderColor);
    this.drawHandleNub(ctx, right, bottom, borderColor);
    this.drawHandleNub(ctx, midX, bottom, borderColor);
    this.drawHandleNub(ctx, 0, bottom, borderColor);
    this.drawHandleNub(ctx, 0, midY, borderColor);

    ctx.restore();
  }

  /**
   * Hit-tests whether a point in image coordinate space strikes any transform handle.
   *
   * @param pt - Pointer location in image coordinate space.
   * @param obj - Target TextObject.
   * @param radius - Hit tolerance radius in image pixels.
   * @returns Hit handle or null if none struck.
   */
  public static hitTestHandles(
    pt: Point,
    obj: TextObject,
    radius: number = HANDLE_RADIUS + 3
  ): TransformHandle | null {
    // Transform point into object's unrotated local coordinates
    let localX = pt.x - obj.x;
    let localY = pt.y - obj.y;

    if (obj.rotation) {
      const centerX = obj.width / 2;
      const centerY = obj.height / 2;
      const rad = (-obj.rotation * Math.PI) / 180;
      const dx = localX - centerX;
      const dy = localY - centerY;
      localX = centerX + (dx * Math.cos(rad) - dy * Math.sin(rad));
      localY = centerY + (dx * Math.sin(rad) + dy * Math.cos(rad));
    }

    const midX = obj.width / 2;
    const midY = obj.height / 2;
    const right = obj.width;
    const bottom = obj.height;

    // Rotation handle
    if (this.dist(localX, localY, midX, -ROTATION_HANDLE_OFFSET) <= radius) return 'rot';

    // 8 edge & corner handles
    if (this.dist(localX, localY, 0, 0) <= radius) return 'nw';
    if (this.dist(localX, localY, midX, 0) <= radius) return 'n';
    if (this.dist(localX, localY, right, 0) <= radius) return 'ne';
    if (this.dist(localX, localY, right, midY) <= radius) return 'e';
    if (this.dist(localX, localY, right, bottom) <= radius) return 'se';
    if (this.dist(localX, localY, midX, bottom) <= radius) return 's';
    if (this.dist(localX, localY, 0, bottom) <= radius) return 'sw';
    if (this.dist(localX, localY, 0, midY) <= radius) return 'w';

    return null;
  }

  /**
   * Hit-tests whether a point lies inside the bounding box of a TextObject.
   *
   * @param pt - Pointer location in image coordinate space.
   * @param obj - Target TextObject.
   * @returns True if point is inside object body.
   */
  public static hitTestBody(pt: Point, obj: TextObject): boolean {
    let localX = pt.x - obj.x;
    let localY = pt.y - obj.y;

    if (obj.rotation) {
      const centerX = obj.width / 2;
      const centerY = obj.height / 2;
      const rad = (-obj.rotation * Math.PI) / 180;
      const dx = localX - centerX;
      const dy = localY - centerY;
      localX = centerX + (dx * Math.cos(rad) - dy * Math.sin(rad));
      localY = centerY + (dx * Math.sin(rad) + dy * Math.cos(rad));
    }

    return localX >= 0 && localX <= obj.width && localY >= 0 && localY <= obj.height;
  }

  private static drawHandleNub(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    isCircle: boolean = false
  ): void {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    if (isCircle) {
      ctx.beginPath();
      ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(x - HANDLE_RADIUS, y - HANDLE_RADIUS, HANDLE_RADIUS * 2, HANDLE_RADIUS * 2);
      ctx.strokeRect(x - HANDLE_RADIUS, y - HANDLE_RADIUS, HANDLE_RADIUS * 2, HANDLE_RADIUS * 2);
    }
    ctx.restore();
  }

  private static dist(x1: number, y1: number, x2: number, y2: number): number {
    return Math.hypot(x1 - x2, y1 - y2);
  }
}
