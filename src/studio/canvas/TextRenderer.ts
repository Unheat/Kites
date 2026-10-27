import type { TextObject } from '../types';
import { getTypesetDisplayText, CJK_CHARACTER_REGEX, wrapVerticalTypeset } from './studioTypeset';

/** Vertical punctuation rotation mappings for CJK manga typography. */
const VERTICAL_ROTATION_MAP: Record<string, string> = {
  // Horizontal dashes / prolonged sound marks
  'ー': '\ufe31',
  '―': '\ufe31',
  '—': '\ufe31',
  '–': '\ufe31',
  '～': '\ufe31',
  '~': '\ufe31',
  // Ellipses & two dots
  '…': '\ufe19',
  '‥': '\ufe19',
  // Parentheses & Brackets
  '（': '\ufe35',
  '）': '\ufe36',
  '(': '\ufe35',
  ')': '\ufe36',
  '[': '\ufe37',
  ']': '\ufe38',
  '［': '\ufe37',
  '］': '\ufe38',
  '【': '\ufe3b',
  '】': '\ufe3c',
  '〔': '\ufe39',
  '〕': '\ufe3a',
  '〈': '\ufe3d',
  '〉': '\ufe3e',
  '《': '\ufe3f',
  '》': '\ufe40',
  '「': '\ufe41',
  '」': '\ufe42',
  '『': '\ufe43',
  '』': '\ufe44',
  // Japanese punctuation marks
  '。': '\ufe12',
  '、': '\ufe11',
  '！': '\ufe15',
  '？': '\ufe16',
  '!': '\ufe15',
  '?': '\ufe16',
};

export class TextRenderer {
  /**
   * Renders a TextObject onto a Canvas 2D rendering context.
   *
   * @param ctx - Target canvas 2D rendering context.
   * @param obj - Text object containing typography and geometric layout.
   */
  public static renderText(ctx: CanvasRenderingContext2D, obj: TextObject): void {
    if ((!obj.text && !obj.lines?.length) || obj.isVisible === false) return;

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

    ctx.letterSpacing = `${obj.letterSpacing ?? 0}px`;
    // Layout belongs to studioTypeset. Paint exact measured lines, even when a
    // pipeline line overhangs the editor box or differs from raw translation text.
    const lines = (obj.lines?.length ? obj.lines : obj.text.split('\n'))
      .map((line) => getTypesetDisplayText(line, obj));
    const processedText = lines.join('\n');

    // Only render vertical CJK if text contains CJK glyphs or explicitly requested
    const hasCjk = CJK_CHARACTER_REGEX.test(processedText);
    const isVerticalMode = Boolean(obj.isVertical && hasCjk);

    if (isVerticalMode) {
      this.renderVertical(ctx, lines, obj);
    } else if (this.canUsePositionedLines(obj, lines)) {
      this.renderPositioned(ctx, lines, obj);
    } else {
      this.renderHorizontal(ctx, lines, obj);
    }

    ctx.restore();
  }

  /**
   * Decides whether the Koharu scanline placements can drive painting directly.
   * Requires one placement per line, finite geometry, and no per-character style
   * overrides (the positioned bake path measures uniform object-level typography).
   *
   * @param obj - Text object carrying optional pipeline/reflow placements.
   * @param lines - Display-cased lines about to be painted.
   * @returns True when {@link renderPositioned} reproduces the baked layout.
   */
  private static canUsePositionedLines(obj: TextObject, lines: string[]): boolean {
    const pls = obj.positionedLines;
    if (!pls || pls.length !== lines.length) return false;
    if (Array.isArray(obj.charStyles) && obj.charStyles.some(Boolean)) return false;
    return pls.every((pl) =>
      [pl.x, pl.y, pl.width, pl.height].every((v) => Number.isFinite(v))
    );
  }

  /**
   * Paints lines at their Koharu scanline placements, replicating the bake's
   * per-line math (top baseline, line centered within its contour chord) so the
   * editor shows the exact baked layout until the user re-typesets.
   *
   * @param ctx - Target context with base typography configured.
   * @param lines - Canonical layout lines already transformed to display casing.
   * @param obj - Object geometry and paint settings.
   */
  private static renderPositioned(
    ctx: CanvasRenderingContext2D,
    lines: string[],
    obj: TextObject
  ): void {
    const pls = obj.positionedLines!;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) {
      const pl = pls[i];
      const lineWidth = ctx.measureText(lines[i]).width;
      const x = pl.x + (pl.width - lineWidth) / 2;
      this.strokeAndFillText(ctx, lines[i], x, pl.y, obj);
    }
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

  /**
   * Paints measured horizontal lines without wrapping or validating their widths.
   * @param ctx - Target context with base typography configured.
   * @param lines - Canonical layout lines already transformed to display casing.
   * @param obj - Object geometry and paint settings.
   */
  private static renderHorizontal(
    ctx: CanvasRenderingContext2D,
    lines: string[],
    obj: TextObject
  ): void {
    const lineHeight = obj.fontSize * (obj.lineSpacing ?? 1.2);
    const align = obj.align ?? 'center';

    const totalHeight = lines.length * lineHeight;
    let startY = (obj.height - totalHeight) / 2 + lineHeight / 2;

    const hasCharStyles = Array.isArray(obj.charStyles) && obj.charStyles.some(Boolean);

    // Fast-path: uniform styling across all lines
    if (!hasCharStyles) {
      let startX = obj.width / 2;
      if (align === 'left') startX = 4;
      if (align === 'right') startX = obj.width - 4;
      ctx.textAlign = align;

      for (const line of lines) {
        this.strokeAndFillText(ctx, line, startX, startY, obj);
        startY += lineHeight;
      }
      return;
    }

    // Rich styled runs path (per-word / character overrides)
    let globalCharOffset = 0;
    for (const line of lines) {
      const runs = this.decomposeLineIntoStyledRuns(ctx, line, globalCharOffset, obj);
      const totalLineWidth = runs.reduce((sum, r) => sum + r.width, 0);

      let lineStartX = obj.width / 2 - totalLineWidth / 2;
      if (align === 'left') lineStartX = 4;
      if (align === 'right') lineStartX = obj.width - 4 - totalLineWidth;

      // Pass 1: Render strokes across all runs
      let curX = lineStartX;
      ctx.textAlign = 'left';
      for (const run of runs) {
        ctx.font = `${run.style.italic ? 'italic ' : ''}${run.style.bold ? 'bold ' : ''}${run.style.fontSize}px ${run.style.fontFamily || 'sans-serif'}`;
        this.strokeOnlyText(ctx, run.text, curX, startY, run.style);
        curX += run.width;
      }

      // Pass 2: Render fills across all runs (fills never clipped by adjacent strokes)
      curX = lineStartX;
      for (const run of runs) {
        ctx.font = `${run.style.italic ? 'italic ' : ''}${run.style.bold ? 'bold ' : ''}${run.style.fontSize}px ${run.style.fontFamily || 'sans-serif'}`;
        this.fillOnlyText(ctx, run.text, curX, startY, run.style);
        curX += run.width;
      }

      startY += lineHeight;
      globalCharOffset += line.length + 1;
    }
  }

  private static decomposeLineIntoStyledRuns(
    ctx: CanvasRenderingContext2D,
    line: string,
    lineStartOffset: number,
    baseObj: TextObject
  ): { text: string; width: number; style: TextObject }[] {
    if (!line) return [];

    const runs: { text: string; width: number; style: TextObject }[] = [];
    let currentRunText = '';
    let currentRunStyle: TextObject | null = null;

    const areStylesEqual = (a: TextObject, b: TextObject) =>
      a.bold === b.bold &&
      a.italic === b.italic &&
      a.fontSize === b.fontSize &&
      a.fontFamily === b.fontFamily &&
      a.color === b.color &&
      a.strokeColor === b.strokeColor &&
      a.strokeWidth === b.strokeWidth;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const globalIdx = lineStartOffset + i;
      const override = baseObj.charStyles?.[globalIdx];

      const charStyle: TextObject = override
        ? {
            ...baseObj,
            bold: override.bold ?? baseObj.bold,
            italic: override.italic ?? baseObj.italic,
            fontSize: override.fontSize ?? baseObj.fontSize,
            fontFamily: override.fontFamily ?? baseObj.fontFamily,
            color: override.color ?? baseObj.color,
            strokeColor: override.strokeColor ?? baseObj.strokeColor,
            strokeWidth: override.strokeWidth ?? baseObj.strokeWidth,
          }
        : baseObj;

      if (!currentRunStyle || areStylesEqual(currentRunStyle, charStyle)) {
        currentRunText += char;
        currentRunStyle = charStyle;
      } else {
        ctx.font = `${currentRunStyle.italic ? 'italic ' : ''}${currentRunStyle.bold ? 'bold ' : ''}${currentRunStyle.fontSize}px ${currentRunStyle.fontFamily || 'sans-serif'}`;
        runs.push({
          text: currentRunText,
          width: ctx.measureText(currentRunText).width,
          style: currentRunStyle,
        });
        currentRunText = char;
        currentRunStyle = charStyle;
      }
    }

    if (currentRunText && currentRunStyle) {
      ctx.font = `${currentRunStyle.italic ? 'italic ' : ''}${currentRunStyle.bold ? 'bold ' : ''}${currentRunStyle.fontSize}px ${currentRunStyle.fontFamily || 'sans-serif'}`;
      runs.push({
        text: currentRunText,
        width: ctx.measureText(currentRunText).width,
        style: currentRunStyle,
      });
    }

    return runs;
  }

  /**
   * Renders vertical CJK dialogue with centered right-to-left column progression.
   *
   * @param ctx - Target canvas 2D rendering context.
   * @param lines - Pre-measured column strings from studioTypeset.
   * @param obj - Text object containing geometry and styling.
   */
  private static renderVertical(
    ctx: CanvasRenderingContext2D,
    lines: string[],
    obj: TextObject
  ): void {
    const columns = obj.lines?.length
      ? lines
      : wrapVerticalTypeset(obj.text, obj.width, obj.height, obj.fontSize, 'simple', obj).lines;

    const charHeight = obj.fontSize * (obj.lineSpacing ?? 1.15);
    const colWidth = obj.fontSize * 1.3;
    const totalColsWidth = columns.length * colWidth;

    const align = obj.align ?? 'center';
    let startX: number;
    if (align === 'right') {
      startX = obj.width - 4 - colWidth / 2;
    } else if (align === 'left') {
      startX = 4 + totalColsWidth - colWidth / 2;
    } else {
      startX = (obj.width + totalColsWidth) / 2 - colWidth / 2;
    }

    ctx.textAlign = 'center';

    const maxColLength = Math.max(...columns.map((col) => col.length), 1);
    const maxColHeight = maxColLength * charHeight;
    const startY = (obj.height - maxColHeight) / 2 + charHeight / 2;

    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
      const col = columns[colIdx];
      const colX = startX - colIdx * colWidth;
      let charY = startY;

      for (const char of col) {
        const mapped = VERTICAL_ROTATION_MAP[char] || char;
        this.strokeAndFillText(ctx, mapped, colX, charY, obj);
        charY += charHeight;
      }
    }
  }

  private static strokeOnlyText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    obj: TextObject
  ): void {
    if (!obj.strokeWidth || obj.strokeWidth <= 0) return;
    ctx.save();
    ctx.lineWidth = obj.strokeWidth * 2;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

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

  private static fillOnlyText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    obj: TextObject
  ): void {
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

  private static strokeAndFillText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    obj: TextObject
  ): void {
    this.strokeOnlyText(ctx, text, x, y, obj);
    this.fillOnlyText(ctx, text, x, y, obj);
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

}
