import type { TextObject } from '../types';

/** Vertical punctuation rotation mappings for CJK manga typography. */
const VERTICAL_ROTATION_MAP: Record<string, string> = {
  'ー': '丨',
  '―': '丨',
  '…': '︙',
  '‥': '︰',
  '（': '︵',
  '）': '︶',
  '(': '︵',
  ')': '︶',
  '[': '﹇',
  ']': '﹈',
  '【': '︻',
  '】': '︼',
  '～': '丨',
  '~': '丨',
};

export class TextRenderer {
  /**
   * Renders a TextObject onto a Canvas 2D rendering context.
   *
   * @param ctx - Target canvas 2D rendering context.
   * @param obj - Text object containing typography and geometric layout.
   */
  public static renderText(ctx: CanvasRenderingContext2D, obj: TextObject): void {
    if (!obj.text || obj.isVisible === false) return;

    ctx.save();
    ctx.translate(obj.x, obj.y);

    if (obj.rotation) {
      const centerX = obj.width / 2;
      const centerY = obj.height / 2;
      ctx.translate(centerX, centerY);
      ctx.rotate((obj.rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
    }

    if (obj.opacity !== undefined && obj.opacity < 1) {
      ctx.globalAlpha = obj.opacity;
    }

    // 1. Draw optional bubble background box
    if (obj.backgroundFill && obj.backgroundFill !== 'transparent') {
      this.drawBackgroundBox(ctx, obj);
    }

    // 2. Setup text styling
    const fontStyle = `${obj.italic ? 'italic ' : ''}${obj.bold ? 'bold ' : ''}${obj.fontSize}px ${obj.fontFamily || 'sans-serif'}`;
    ctx.font = fontStyle;
    ctx.textBaseline = 'middle';

    const processedText = this.applyCasing(obj.text, obj.uppercase, obj.lowercase);

    if (obj.isVertical) {
      this.renderVertical(ctx, processedText, obj);
    } else {
      this.renderHorizontal(ctx, processedText, obj);
    }

    ctx.restore();
  }

  private static drawBackgroundBox(ctx: CanvasRenderingContext2D, obj: TextObject): void {
    const pad = obj.backgroundPadding ?? 4;
    const radius = obj.backgroundBorderRadius ?? 0;
    const x = -pad;
    const y = -pad;
    const w = obj.width + pad * 2;
    const h = obj.height + pad * 2;

    ctx.fillStyle = obj.backgroundFill!;
    ctx.beginPath();
    if (radius > 0 && typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, radius);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.fill();
  }

  private static renderHorizontal(
    ctx: CanvasRenderingContext2D,
    text: string,
    obj: TextObject
  ): void {
    const lines = text.split('\n');
    const lineHeight = obj.fontSize * (obj.lineSpacing ?? 1.2);
    const align = obj.align ?? 'center';

    let startX = obj.width / 2;
    if (align === 'left') startX = 0;
    if (align === 'right') startX = obj.width;
    ctx.textAlign = align;

    const totalHeight = lines.length * lineHeight;
    let startY = (obj.height - totalHeight) / 2 + lineHeight / 2;

    for (const line of lines) {
      this.strokeAndFillText(ctx, line, startX, startY, obj);
      startY += lineHeight;
    }
  }

  private static renderVertical(
    ctx: CanvasRenderingContext2D,
    text: string,
    obj: TextObject
  ): void {
    const columns = text.split('\n');
    const charHeight = obj.fontSize * (obj.lineSpacing ?? 1.15);
    const colWidth = obj.fontSize * 1.3;

    ctx.textAlign = 'center';
    let colX = obj.width - colWidth / 2;

    for (const col of columns) {
      let charY = charHeight / 2;
      for (const char of col) {
        const mapped = VERTICAL_ROTATION_MAP[char] || char;
        this.strokeAndFillText(ctx, mapped, colX, charY, obj);
        charY += charHeight;
      }
      colX -= colWidth;
    }
  }

  private static strokeAndFillText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    obj: TextObject
  ): void {
    // 1. Drop shadow & outline stroke
    if (obj.strokeWidth && obj.strokeWidth > 0) {
      ctx.save();
      ctx.lineWidth = obj.strokeWidth * 2;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;

      // Handle stroke drop shadow
      if (obj.shadowDistance && obj.shadowDistance > 0) {
        const rad = ((obj.shadowAngle ?? 45) * Math.PI) / 180;
        ctx.shadowOffsetX = Math.cos(rad) * obj.shadowDistance;
        ctx.shadowOffsetY = Math.sin(rad) * obj.shadowDistance;
        ctx.shadowBlur = obj.shadowBlur ?? 2;
        ctx.shadowColor = obj.shadowColor ?? 'rgba(0, 0, 0, 0.7)';
      }

      ctx.strokeStyle = this.getFillStyle(
        ctx,
        obj.strokeColor || '#000000',
        obj.strokeColor2,
        obj.isStrokeGradient,
        obj.gradientAngle,
        obj.width,
        obj.height
      );
      ctx.strokeText(text, x, y);
      ctx.restore();
    }

    // 2. Main text fill
    ctx.save();
    ctx.fillStyle = this.getFillStyle(
      ctx,
      obj.color || '#ffffff',
      obj.color2,
      obj.isGradient,
      obj.gradientAngle,
      obj.width,
      obj.height
    );
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private static getFillStyle(
    ctx: CanvasRenderingContext2D,
    color1: string,
    color2?: string,
    isGradient?: boolean,
    gradientAngle?: number,
    width: number = 100,
    height: number = 100
  ): string | CanvasGradient {
    if (!isGradient || !color2) {
      return color1;
    }

    const rad = ((gradientAngle ?? 90) * Math.PI) / 180;
    const x1 = width / 2 - (Math.cos(rad) * width) / 2;
    const y1 = height / 2 - (Math.sin(rad) * height) / 2;
    const x2 = width / 2 + (Math.cos(rad) * width) / 2;
    const y2 = height / 2 + (Math.sin(rad) * height) / 2;

    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    return grad;
  }

  private static applyCasing(text: string, upper?: boolean, lower?: boolean): string {
    if (upper) return text.toUpperCase();
    if (lower) return text.toLowerCase();
    return text;
  }
}
