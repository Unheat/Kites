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
  });

  it('should instantiate CtdOcrEngine', () => {
    expect(engine).toBeDefined();
  });

  it('should locate local CTD ONNX model file', () => {
    const testModelPath = path.resolve(process.cwd(), 'src/test/models/comic_text_detector.onnx');
    expect(fs.existsSync(testModelPath)).toBe(true);
  });
});
