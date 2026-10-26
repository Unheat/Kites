import { describe, it, expect } from 'vitest';
import { createCanvas } from 'canvas';
import { detectBlockTextColorsFromContext } from './textColorDetection';
import type { OcrBox } from '../engines/ocr/BaseOcrEngine';

const CANVAS_W = 400;
const CANVAS_H = 200;
const BOX: OcrBox = { x: 100, y: 60, w: 200, h: 80 };

/**
 * Bakes a synthetic original-artwork scene and runs per-box detection on it.
 *
 * @param bg - Bubble/page background fill.
 * @param ink - Optional ink fill; when omitted the box interior stays background (no text).
 * @param box - OCR box to detect (defaults to the standard centered box).
 * @returns Detection result for the first box.
 */
function bake(bg: string, ink?: string, box: OcrBox = BOX) {
  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  if (ink) {
    ctx.fillStyle = ink;
    // Five glyph-like bars inside the box; node-canvas fillRect is unantialiased.
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(box.x + 10 + i * 30, box.y + 15, 20, box.h - 30);
    }
  }
  return detectBlockTextColorsFromContext(ctx as any, [box], CANVAS_W, CANVAS_H)[0];
}

describe('detectBlockTextColorsFromContext', () => {
  it('detects black ink on a white bubble and snaps it to pure black', () => {
    expect(bake('#ffffff', '#1a1a1a')).toEqual({ textColor: '#000000', strokeColor: '#ffffff' });
  });

  it('detects white ink on a black panel', () => {
    expect(bake('#0d0d0d', '#f5f5f2')).toEqual({ textColor: '#ffffff', strokeColor: '#000000' });
  });

  it('preserves genuinely colored ink', () => {
    // rgb(20,115,235) has mid Rec.601 luminance and must pass through unsnapped.
    expect(bake('#ffffff', 'rgb(20,115,235)')).toEqual({ textColor: '#1473eb', strokeColor: '#ffffff' });
  });

  it('snaps slightly-off white ink to pure white on a colored bubble', () => {
    // Off-white ink is distinguishable only against a non-white background; the
    // snap then forces the rendered fill to crisp pure white.
    expect(bake('#808080', 'rgb(250,248,245)')).toEqual({ textColor: '#ffffff', strokeColor: '#000000' });
  });

  it('falls back to null when ink is indistinguishable from the bubble', () => {
    // Off-white text on a white bubble sits inside the ink distance threshold —
    // undetectable by design; the caller keeps its background-adaptive fallback.
    expect(bake('#ffffff', 'rgb(250,248,245)')).toBeNull();
  });

  it('accepts the documented saturated-red tradeoff (snaps to black)', () => {
    expect(bake('#ffffff', 'rgb(255,0,0)')).toEqual({ textColor: '#000000', strokeColor: '#ffffff' });
  });

  it('returns null for a box with no ink (uniform bubble)', () => {
    expect(bake('#ffffff')).toBeNull();
  });

  it('returns null for degenerate boxes', () => {
    const canvas = createCanvas(CANVAS_W, CANVAS_H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const results = detectBlockTextColorsFromContext(
      ctx as any,
      [{ x: 10, y: 10, w: 3, h: 3 }],
      CANVAS_W,
      CANVAS_H,
    );
    expect(results).toEqual([null]);
  });

  it('strides large windows without losing the ink majority', () => {
    // Window area far above MAX_SAMPLED_PIXELS forces the stride path; the ink
    // bars still dominate the far-from-seed candidate set.
    const canvas = createCanvas(1200, 1600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1200, 1600);
    ctx.fillStyle = '#101010';
    for (let i = 0; i < 20; i++) {
      ctx.fillRect(120 + i * 45, 400, 30, 800);
    }
    const box: OcrBox = { x: 100, y: 380, w: 1000, h: 840 };
    const result = detectBlockTextColorsFromContext(ctx as any, [box], 1200, 1600)[0];
    expect(result).toEqual({ textColor: '#000000', strokeColor: '#ffffff' });
  });

  it('detects thin black text even when surrounded by wider antialiased grey halo', () => {
    const canvas = createCanvas(CANVAS_W, CANVAS_H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Draw wide grey antialiasing halo (RGB 145)
    ctx.fillStyle = 'rgb(145, 145, 145)';
    ctx.fillRect(BOX.x + 20, BOX.y + 10, 40, 50);

    // Draw thin black core inside (RGB 20)
    ctx.fillStyle = 'rgb(20, 20, 20)';
    ctx.fillRect(BOX.x + 30, BOX.y + 20, 10, 30);

    const result = detectBlockTextColorsFromContext(ctx as any, [BOX], CANVAS_W, CANVAS_H)[0];
    // Koharu 1:1 color clustering rejects the grey halo as an antialiasing blend and snaps black core to #000000
    expect(result).toEqual({ textColor: '#000000', strokeColor: '#ffffff' });
  });
});
