import type { Point, TextObject, TransformHandle } from '../types';

/** Radius of interactive transform handle nubs in image pixels. */
export const HANDLE_RADIUS = 6;

/** Distance in image pixels between top handle and rotation handle nub. */
export const ROTATION_HANDLE_OFFSET = 24;

/** Offset in image pixels for secondary auxiliary handles (font size & wrap). */
export const AUX_HANDLE_OFFSET = 16;

export class CanvasFurniture {
  /**
   * Draws selection border, 8-point handles, rotation nub, font-size nub, and wrap handle.
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
    const isSkipped = !!obj.isSkipped;
    const effectiveColor = isSkipped ? '#94a3b8' : borderColor;

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
    ctx.strokeStyle = effectiveColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(isSkipped ? [2, 3] : [4, 4]);
    ctx.strokeRect(0, 0, obj.width, obj.height);
    ctx.setLineDash([]);

    // 2. Draw stem line to rotation handle
    ctx.beginPath();
    ctx.strokeStyle = effectiveColor;
    ctx.moveTo(obj.width / 2, 0);
    ctx.lineTo(obj.width / 2, -ROTATION_HANDLE_OFFSET);
    ctx.stroke();

    // 3. Draw rotation handle nub (circle with curved rotation arrow badge)
    this.drawHandleNub(ctx, obj.width / 2, -ROTATION_HANDLE_OFFSET, '#f4446d', true, '⟳');

    // If rotated, show small angle tag above rotation nub
    if (obj.rotation) {
      ctx.save();
      ctx.font = 'bold 9px monospace';
      const angleText = `${Math.round(obj.rotation)}°`;
      const textMetrics = ctx.measureText(angleText);
      const tagW = textMetrics.width + 8;
      const tagH = 14;
      const tagX = obj.width / 2 - tagW / 2;
      const tagY = -ROTATION_HANDLE_OFFSET - 18;
      ctx.fillStyle = '#12141c';
      ctx.strokeStyle = effectiveColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tagX, tagY, tagW, tagH, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f4446d';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(angleText, obj.width / 2, tagY + tagH / 2);
      ctx.restore();
    }

    const midX = obj.width / 2;
    const midY = obj.height / 2;
    const right = obj.width;
    const bottom = obj.height;

    // 4. Draw font-size scaling handle (top-right corner nub with 'A' badge)
    this.drawHandleNub(ctx, right, 0, '#38bdf8', true, 'A');

    // 5. Draw horizontal wrap handle (right midpoint nub with '↔' badge)
    this.drawHandleNub(ctx, right, midY, '#a855f7', true, '↔');

    // 6. Draw standard bounding handles
    this.drawHandleNub(ctx, 0, 0, effectiveColor);
    this.drawHandleNub(ctx, midX, 0, effectiveColor);
    this.drawHandleNub(ctx, right, bottom, effectiveColor);
    this.drawHandleNub(ctx, midX, bottom, effectiveColor);
    this.drawHandleNub(ctx, 0, bottom, effectiveColor);
    this.drawHandleNub(ctx, 0, midY, effectiveColor);

    // If skipped, render a small label pill
    if (isSkipped) {
      ctx.save();
      ctx.font = 'bold 9px sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillRect(0, -14, 46, 12);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('SKIPPED', 3, -5);
      ctx.restore();
    }

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

    // Rotation handle sits safely outside the box boundary
    if (this.dist(localX, localY, midX, -ROTATION_HANDLE_OFFSET) <= radius) return 'rot';

    // Ensure perimeter handles never cover more than 28% of the box dimension,
    // guaranteeing that narrow vertical or small bubbles retain interior body area for dragging.
    const maxRadius = Math.max(3, Math.min(obj.width, obj.height) * 0.28);
    const effectiveRadius = Math.min(radius, maxRadius);

    // Font-size handle (top-right corner nub)
    if (this.dist(localX, localY, right, 0) <= effectiveRadius) {
      return 'font-size';
    }

    // Wrap handle (right midpoint nub)
    if (this.dist(localX, localY, right, midY) <= effectiveRadius) {
      return 'wrap';
    }

    // Bounding corner and edge handles
    if (this.dist(localX, localY, 0, 0) <= effectiveRadius) return 'nw';
    if (this.dist(localX, localY, midX, 0) <= effectiveRadius) return 'n';
    if (this.dist(localX, localY, right, bottom) <= effectiveRadius) return 'se';
    if (this.dist(localX, localY, midX, bottom) <= effectiveRadius) return 's';
    if (this.dist(localX, localY, 0, bottom) <= effectiveRadius) return 'sw';
    if (this.dist(localX, localY, 0, midY) <= effectiveRadius) return 'w';

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
    isCircle: boolean = false,
    label?: string
  ): void {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    if (isCircle) {
      ctx.beginPath();
      ctx.arc(x, y, HANDLE_RADIUS + (label ? 1 : 0), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (label) {
        ctx.fillStyle = color;
        ctx.font = label === '⟳' ? 'bold 9px sans-serif' : 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y);
      }
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
