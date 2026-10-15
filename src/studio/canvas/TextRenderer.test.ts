import { describe, it, expect, vi } from 'vitest';
import { CanvasFurniture } from './CanvasFurniture';
import { TextRenderer } from './TextRenderer';
import type { TextObject } from '../types';

describe('CanvasFurniture Hit Testing', () => {
  const obj: TextObject = {
    id: 't-1',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    text: 'Test Bubble',
    fontSize: 16,
    fontFamily: 'sans-serif',
    color: '#000',
  };

  it('detects hit inside object body', () => {
    expect(CanvasFurniture.hitTestBody({ x: 150, y: 150 }, obj)).toBe(true);
    expect(CanvasFurniture.hitTestBody({ x: 50, y: 50 }, obj)).toBe(false);
  });

  it('detects corner handle nw at top-left', () => {
    const handle = CanvasFurniture.hitTestHandles({ x: 100, y: 100 }, obj);
    expect(handle).toBe('nw');
  });

  it('detects rotation handle above top edge', () => {
    const handle = CanvasFurniture.hitTestHandles({ x: 200, y: 76 }, obj);
    expect(handle).toBe('rot');
  });

  it('handles rotated object hit-testing accurately', () => {
    const rotatedObj: TextObject = {
      ...obj,
      rotation: 90,
    };
    expect(CanvasFurniture.hitTestBody({ x: 200, y: 150 }, rotatedObj)).toBe(true);
  });
});

describe('TextRenderer Rich Text (charStyles)', () => {
  const createMockContext = () => {
    return {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      measureText: vi.fn((str: string) => ({ width: str.length * 8 })),
      strokeText: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    } as unknown as CanvasRenderingContext2D;
  };

  it('renders uniform text in fast-path when charStyles is absent', () => {
    const ctx = createMockContext();
    const obj: TextObject = {
      id: 't-1',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      text: 'Simple line',
      fontSize: 16,
      fontFamily: 'sans-serif',
      color: '#000',
    };

    TextRenderer.renderText(ctx, obj);
    expect(ctx.fillText).toHaveBeenCalledWith('Simple line', expect.any(Number), expect.any(Number));
  });

  it('decomposes text into styled runs when charStyles contains overrides', () => {
    const ctx = createMockContext();
    // 'Hello World' -> 'Hello ' is normal, 'World' is italic
    const charStyles = new Array(11).fill(null);
    for (let i = 6; i < 11; i++) {
      charStyles[i] = { italic: true };
    }

    const obj: TextObject = {
      id: 't-2',
      x: 0,
      y: 0,
      width: 150,
      height: 50,
      text: 'Hello World',
      fontSize: 16,
      fontFamily: 'sans-serif',
      color: '#000',
      charStyles,
    };

    TextRenderer.renderText(ctx, obj);
    // Should have drawn 'Hello ' and 'World' as separate runs
    expect(ctx.fillText).toHaveBeenCalledWith('Hello ', expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith('World', expect.any(Number), expect.any(Number));
  });
});
