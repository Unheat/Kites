import { describe, it, expect } from 'vitest';
import { createCanvas } from 'canvas';
import { renderTextBlocksBatch, type TextBlockItem } from './canvasTypesetting';

const block: TextBlockItem = {
  text: 'Hello world this is a test',
  polygon: [{ x: 20, y: 20 }, { x: 220, y: 20 }, { x: 220, y: 120 }, { x: 20, y: 120 }],
  direction: 'h'
};

function bake(bg: string) {
  const canvas = createCanvas(400, 200);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 400, 200);
  return renderTextBlocksBatch(ctx as any, [{ ...block }], 'en', { width: 400, height: 200 });
}

describe('background-adaptive text color (renderTextBlocksBatch)', () => {
  it('picks black text on a white background', () => {
    const info = bake('#ffffff')[0];
    expect(info?.textColor).toBe('black');
    expect(info?.strokeColor).toBe('white');
  });

  it('picks white text on a near-black background', () => {
    const info = bake('#111111')[0];
    expect(info?.textColor).toBe('white');
    expect(info?.strokeColor).toBe('black');
  });

  it('respects explicit color overrides over sampling', () => {
    const canvas = createCanvas(400, 200);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, 400, 200);
    const info = renderTextBlocksBatch(
      ctx as any,
      [{ ...block, textColor: 'red', strokeColor: 'blue' }],
      'en',
      { width: 400, height: 200 }
    )[0];
    expect(info?.textColor).toBe('red');
    expect(info?.strokeColor).toBe('blue');
  });

  it('renders Western target with custom fontFamily', () => {
    const canvas = createCanvas(400, 200);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 400, 200);
    const info = renderTextBlocksBatch(
      ctx as any,
      [{ ...block }],
      'en',
      { width: 400, height: 200 },
      '"Comic Sans MS", "Comic Sans", cursive'
    )[0];
    expect(info).not.toBeNull();
    expect(info?.fontSize).toBeGreaterThan(0);
    expect(info?.lineCount).toBeGreaterThan(0);
  });
});
