/**
 * @file cotransTextRasterizer.ts
 * Text rasterization onto transparent offscreen canvas with outline strokes and pixel cropping.
 * 1:1 port of Cotrans text_render.py `put_text_horizontal` and `crop_to_content`.
 * Licensed under GNU General Public License v3.0 (GPL-3.0).
 * Reference: https://github.com/zyddnys/manga-image-translator
 */

import { fontSpec } from '../typesetLayout';
import { calcHorizontal, DEFAULT_RENDER_FONT_FAMILY } from './cotransLineBreaker';

/** Cotrans default stroke width relative to font size (put_text_horizontal: max(font_size*0.07, 1)). */
export const STROKE_WIDTH_RATIO = 0.07;

/** Cotrans inter-line spacing relative to font size (put_text_horizontal spacing_y, line_spacing=0.01). */
export const LINE_SPACING_RATIO = 0.01;

export type AnyCanvas = { getContext(type: '2d', options?: { willReadFrequently?: boolean }): any; width: number; height: number };

/**
 * Creates an intermediate canvas of the same class as the target context's canvas.
 * Uses OffscreenCanvas in the browser/worker and node-canvas Canvas under tests.
 */
export function makeCanvas(ctx: any, w: number, h: number): AnyCanvas {
  const width = Math.max(1, Math.ceil(w));
  const height = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height) as unknown as AnyCanvas;
  }
  if (ctx?.canvas?.constructor && ctx.canvas.constructor !== Object) {
    try {
      const Ctor = ctx.canvas.constructor as new (w: number, h: number) => AnyCanvas;
      return new Ctor(width, height);
    } catch {
      // Fall through to mock/DOM fallback
    }
  }
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c as unknown as AnyCanvas;
  }
  return {
    width,
    height,
    getContext: () => ctx,
  };
}

/**
 * Crops a canvas to the bounding box of its non-transparent pixels.
 * @returns The cropped canvas + size, or null if fully transparent.
 */
export function cropToContent(ctx: any, canvas: AnyCanvas): { canvas: AnyCanvas; width: number; height: number } | null {
  const c = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const data = c.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = makeCanvas(ctx, cw, ch);
  out.getContext('2d').drawImage(canvas as any, minX, minY, cw, ch, 0, 0, cw, ch);
  return { canvas: out, width: cw, height: ch };
}

/**
 * Renders horizontal text onto a tight transparent canvas, bordered with an optional stroke.
 *
 * @param ctx - Parent canvas context.
 * @param fontSize - Font size in pixels.
 * @param text - The text to lay out and draw.
 * @param maxWidth - Target line width in pixels.
 * @param maxHeight - Target block height in pixels.
 * @param alignment - Horizontal alignment ('left' | 'center' | 'right').
 * @param fg - Fill color.
 * @param bg - Optional outline color.
 * @param lineSpacing - Inter-line spacing multiplier.
 * @param fontFamily - CSS font-family stack.
 * @returns Cropped transparent text canvas, or null if empty.
 */
export function putTextHorizontal(
  ctx: any,
  fontSize: number,
  text: string,
  maxWidth: number,
  maxHeight: number = 0,
  alignment: 'left' | 'center' | 'right' = 'center',
  fg: string = '#000000',
  bg: string | null = '#FFFFFF',
  lineSpacing: number = LINE_SPACING_RATIO,
  fontFamily: string = DEFAULT_RENDER_FONT_FAMILY
): { canvas: AnyCanvas; width: number; height: number } | null {
  fontSize = Math.trunc(fontSize);
  if (!text.trim()) return null;

  const { lineTexts, lineWidths } = calcHorizontal(ctx, fontSize, text, maxWidth, maxHeight, true, fontFamily);
  if (lineTexts.length === 0) return null;

  const bgSize = bg ? Math.max(Math.trunc(fontSize * STROKE_WIDTH_RATIO), 1) : 0;
  const spacingY = Math.trunc(fontSize * (lineSpacing || LINE_SPACING_RATIO));
  const maxLineWidth = Math.max(...lineWidths);
  const n = lineTexts.length;

  const canvasW = maxLineWidth + (fontSize + bgSize) * 2;
  const canvasH = fontSize * n + spacingY * (n - 1) + (fontSize + bgSize) * 2;

  const tmp = makeCanvas(ctx, canvasW, canvasH);
  const tctx = tmp.getContext('2d');
  tctx.font = fontSpec(fontSize, fontFamily, text);
  tctx.textBaseline = 'top';
  tctx.textAlign = 'left';
  tctx.fillStyle = fg;
  tctx.lineJoin = 'round';
  if (bg) {
    tctx.strokeStyle = bg;
    tctx.lineWidth = Math.max(1, bgSize * 2);
  }

  const originX = fontSize + bgSize;
  const originY = fontSize + bgSize;
  for (let i = 0; i < n; i++) {
    let penX = originX;
    if (alignment === 'center') {
      penX += (maxLineWidth - lineWidths[i]) / 2;
    } else if (alignment === 'right') {
      penX += maxLineWidth - lineWidths[i];
    }
    const penY = originY + i * (fontSize + spacingY);
    if (bg && bgSize > 0) tctx.strokeText(lineTexts[i], penX, penY);
    tctx.fillText(lineTexts[i], penX, penY);
  }

  const cropped = cropToContent(ctx, tmp);
  return cropped ?? { canvas: tmp, width: tmp.width, height: tmp.height };
}

/**
 * Renders already-validated layout lines so drawing cannot drift from the fitting pass.
 *
 * @param ctx - Parent canvas context.
 * @param fontSize - Fitted font size in pixels.
 * @param lines - Layout-engine output in reading order.
 * @param alignment - Horizontal alignment for each line.
 * @param fg - Fill color.
 * @param bg - Optional outline color.
 * @param fontFamily - CSS font-family stack.
 * @returns Cropped transparent text canvas, or null when no lines are drawable.
 */
export function putTextLines(
  ctx: any,
  fontSize: number,
  lines: string[],
  alignment: 'left' | 'center' | 'right',
  fg: string,
  bg: string | null,
  fontFamily: string = DEFAULT_RENDER_FONT_FAMILY
): { canvas: AnyCanvas; width: number; height: number } | null {
  const drawableLines = lines.filter((line) => line.trim());
  if (drawableLines.length === 0) return null;

  const drawFont = fontSpec(fontSize, fontFamily, drawableLines.join(''));
  ctx.font = drawFont;
  const measure = (s: string) => ctx.measureText(s).width;
  const widths = drawableLines.map(measure);
  const maxLineWidth = Math.max(...widths);
  const bgSize = bg ? Math.max(Math.trunc(fontSize * STROKE_WIDTH_RATIO), 1) : 0;
  const spacingY = Math.trunc(fontSize * LINE_SPACING_RATIO);
  const canvasW = maxLineWidth + (fontSize + bgSize) * 2;
  const canvasH = fontSize * drawableLines.length + spacingY * (drawableLines.length - 1) + (fontSize + bgSize) * 2;
  const tmp = makeCanvas(ctx, canvasW, canvasH);
  const textCtx = tmp.getContext('2d');
  textCtx.font = drawFont;
  textCtx.textBaseline = 'top';
  textCtx.textAlign = 'left';
  textCtx.fillStyle = fg;
  textCtx.lineJoin = 'round';
  if (bg) {
    textCtx.strokeStyle = bg;
    textCtx.lineWidth = Math.max(1, bgSize * 2);
  }

  const originX = fontSize + bgSize;
  const originY = fontSize + bgSize;
  for (let i = 0; i < drawableLines.length; i++) {
    let x = originX;
    if (alignment === 'center') x += (maxLineWidth - widths[i]) / 2;
    else if (alignment === 'right') x += maxLineWidth - widths[i];
    const y = originY + i * (fontSize + spacingY);
    if (bg) textCtx.strokeText(drawableLines[i], x, y);
    textCtx.fillText(drawableLines[i], x, y);
  }

  const cropped = cropToContent(ctx, tmp);
  return cropped ?? { canvas: tmp, width: tmp.width, height: tmp.height };
}
