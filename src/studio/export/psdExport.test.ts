import { describe, expect, it } from 'vitest';
import { hexToRgb, buildPsdDocument, exportCanvasToPsdBlob, PSD_MIME_TYPE } from './psdExport';
import type { TextBlock } from '../../db';
import type { ImageLayer, TextObject } from '../types';

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

  it('exportCanvasToPsdBlob generates valid PSD Blob from canvas sources', async () => {
    const origCanvas = document.createElement('canvas');
    origCanvas.width = 120;
    origCanvas.height = 160;

    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = 120;
    cleanCanvas.height = 160;

    const textObjects: TextObject[] = [
      {
        id: 't-1',
        text: 'Visible dialogue',
        x: 10,
        y: 15,
        width: 60,
        height: 25,
        fontSize: 14,
        fontFamily: 'Comic Sans MS',
        color: '#00ff00',
        align: 'center',
        isVisible: true,
      },
      {
        id: 't-2',
        text: 'Hidden dialogue',
        x: 20,
        y: 30,
        width: 50,
        height: 20,
        fontSize: 12,
        fontFamily: 'Arial',
        color: '#000000',
        align: 'left',
        isVisible: false,
      },
      {
        id: 't-3',
        text: 'Skipped dialogue',
        x: 30,
        y: 40,
        width: 50,
        height: 20,
        fontSize: 12,
        fontFamily: 'Arial',
        color: '#000000',
        align: 'left',
        isSkipped: true,
      },
    ];

    const imageLayers: ImageLayer[] = [
      {
        id: 'layer-1',
        src: 'data:image/png;base64,mock',
        imageBitmap: document.createElement('canvas') as unknown as ImageBitmap,
        x: 5,
        y: 5,
        width: 50,
        height: 50,
        rotation: 0,
        opacity: 0.8,
        flipH: false,
        flipV: false,
        isVisible: true,
      },
    ];

    const blob = exportCanvasToPsdBlob(origCanvas, cleanCanvas, textObjects, imageLayers);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(PSD_MIME_TYPE);

    const arrayBuffer = await blob.arrayBuffer();
    expect(arrayBuffer.byteLength).toBeGreaterThan(100);

    const magic = String.fromCharCode(...new Uint8Array(arrayBuffer, 0, 4));
    expect(magic).toBe('8BPS');
  });

  it('exportCanvasToPsdBlob handles fallback dimensions when sources are null', async () => {
    const blob = exportCanvasToPsdBlob(null, null, [], [], 200, 300);
    expect(blob).toBeInstanceOf(Blob);
    const arrayBuffer = await blob.arrayBuffer();
    const magic = String.fromCharCode(...new Uint8Array(arrayBuffer, 0, 4));
    expect(magic).toBe('8BPS');
  });
});
