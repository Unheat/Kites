import { describe, it, expect, vi } from 'vitest';
import {
  renderFullCompositeCanvas,
  downloadCanvasAsFile,
  copyCanvasToClipboard,
} from './compositeExport';
import type { TextObject, ImageLayer } from '../types';

describe('compositeExport', () => {
  it('composites background canvas and visible text objects in translated mode', () => {
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 400;
    bgCanvas.height = 600;

    const textObjects: TextObject[] = [
      {
        id: 'tb-1',
        x: 50,
        y: 50,
        width: 120,
        height: 60,
        text: 'Hello world',
        fontSize: 16,
        fontFamily: 'sans-serif',
        color: '#000000',
        isVisible: true,
      },
      {
        id: 'tb-skipped',
        x: 200,
        y: 200,
        width: 100,
        height: 40,
        text: 'Filtered text',
        fontSize: 14,
        fontFamily: 'sans-serif',
        color: '#000000',
        isVisible: true,
        isSkipped: true,
      },
      {
        id: 'tb-hidden',
        x: 200,
        y: 300,
        width: 100,
        height: 40,
        text: 'Hidden text',
        fontSize: 14,
        fontFamily: 'sans-serif',
        color: '#000000',
        isVisible: false,
      },
    ];

    const imageLayers: ImageLayer[] = [];

    const result = renderFullCompositeCanvas(
      400,
      600,
      bgCanvas,
      null,
      'translated',
      imageLayers,
      textObjects
    );

    expect(result).toBeInstanceOf(HTMLCanvasElement);
    expect(result.width).toBe(400);
    expect(result.height).toBe(600);
  });

  it('renders untouched raw image in original mode', () => {
    const bgCanvas = document.createElement('canvas');
    const img = new Image();

    // In jsdom canvas, stub drawImage to avoid native object check
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    const drawImageMock = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, contextId: any) {
      const ctx = origGetContext.call(this, contextId) as any;
      if (ctx) {
        ctx.drawImage = drawImageMock;
      }
      return ctx;
    });

    const result = renderFullCompositeCanvas(
      500,
      700,
      bgCanvas,
      img,
      'original',
      [],
      []
    );

    expect(result.width).toBe(500);
    expect(result.height).toBe(700);
    expect(drawImageMock).toHaveBeenCalled();
  });

  it('renders clean artwork without text in inpainted mode', () => {
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 300;
    bgCanvas.height = 400;

    const textObjects: TextObject[] = [
      {
        id: 'tb-1',
        x: 10,
        y: 10,
        width: 100,
        height: 50,
        text: 'Should not appear',
        fontSize: 14,
        fontFamily: 'sans-serif',
        color: '#000000',
      },
    ];

    const result = renderFullCompositeCanvas(
      300,
      400,
      bgCanvas,
      null,
      'inpainted',
      [],
      textObjects
    );

    expect(result.width).toBe(300);
    expect(result.height).toBe(400);
  });

  it('triggers file download with specified filename', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;

    canvas.toBlob = vi.fn((callback) => {
      callback(new Blob(['mock'], { type: 'image/png' }));
    });

    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = origCreateElement(tagName);
      if (tagName === 'a') {
        el.click = clickSpy;
      }
      return el;
    });

    await downloadCanvasAsFile(canvas, 'test-export.png', 'png');
    expect(canvas.toBlob).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('writes PNG blob to clipboard when available', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 50;
    canvas.height = 50;

    canvas.toBlob = vi.fn((callback) => {
      callback(new Blob(['mock-data'], { type: 'image/png' }));
    });

    const clipboardWriteMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        write: clipboardWriteMock,
      },
    });

    // Mock global ClipboardItem
    (globalThis as any).ClipboardItem = class MockClipboardItem {
      data: any;
      constructor(data: any) {
        this.data = data;
      }
    };

    const success = await copyCanvasToClipboard(canvas);
    expect(success).toBe(true);
    expect(clipboardWriteMock).toHaveBeenCalled();
  });
});
