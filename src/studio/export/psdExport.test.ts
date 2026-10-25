import { describe, expect, it } from 'vitest';
import { hexToRgb, buildPsdDocument } from './psdExport';
import type { TextBlock } from '../../db';

describe('psdExport', () => {
  it('parses hex colors correctly', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('invalid')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb(undefined)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('builds PSD ArrayBuffer with 8BPS header and layers', () => {
    const origCanvas = document.createElement('canvas');
    origCanvas.width = 100;
    origCanvas.height = 100;

    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = 100;
    cleanCanvas.height = 100;

    const textBlocks: TextBlock[] = [
      {
        imageId: 1,
        originalText: 'Konnichiwa',
        translatedText: 'Hello world!',
        posX: 10,
        posY: 20,
        width: 80,
        height: 30,
        fontSize: 16,
        fontFamily: 'Arial',
        color: '#ff0000',
        align: 'center',
      },
    ];

    const buffer = buildPsdDocument(origCanvas, cleanCanvas, textBlocks);
    expect(buffer).toBeDefined();
    expect(buffer.byteLength).toBeGreaterThan(100);

    // Photoshop PSD files must start with ASCII "8BPS" (0x38 0x42 0x50 0x53)
    const headerBytes = new Uint8Array(buffer, 0, 4);
    const magic = String.fromCharCode(...headerBytes);
    expect(magic).toBe('8BPS');
  });

  it('handles empty text blocks without crashing', () => {
    const origCanvas = document.createElement('canvas');
    origCanvas.width = 50;
    origCanvas.height = 50;

    const buffer = buildPsdDocument(origCanvas, null, []);
    expect(buffer).toBeDefined();
    const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
    expect(magic).toBe('8BPS');
  });
});
