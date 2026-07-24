import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CtdOcrEngine } from '../offscreen/engines/ocr/CtdOcrEngine';
import * as fs from 'fs';
import * as path from 'path';

// Mock OpenCV WASM load for unit tests
vi.mock('../offscreen/utils/opencv', () => ({
  initOpenCV: vi.fn().mockResolvedValue({})
}));

describe('CtdOcrEngine Unit Test', () => {
  let engine: CtdOcrEngine;

  beforeAll(async () => {
    engine = new CtdOcrEngine();
    await engine.init();
  });

  it('should initialize successfully and load ONNX model', async () => {
    expect(engine).toBeDefined();
  });

  it('should run OCR recognition on a sample test image', async () => {
    const testImgPath = path.resolve(process.cwd(), 'src/test/test-img/image6.jpg');
    if (!fs.existsSync(testImgPath)) {
      console.warn('Skipping test because image6.jpg is not found.');
      return;
    }

    const buffer = fs.readFileSync(testImgPath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const result = await engine.recognize(arrayBuffer as ArrayBuffer);
    expect(result).toBeDefined();
    expect(result.polygons).toBeDefined();
    expect(result.isTightBoundingBox).toBe(true);
    expect(Array.isArray(result.polygons)).toBe(true);
    console.log(`[CtdOcrEngine Test] Extracted ${result.polygons?.length} polygons.`);
  });
});
