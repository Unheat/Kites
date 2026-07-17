import type { IOcrEngine, OcrResult } from '../engines/ocr/BaseOcrEngine';
import { PaddleOcrEngine } from '../engines/ocr/PaddleOcrEngine';

export class OcrManager {
  private engine: IOcrEngine | null = null;
  // Stores the in-flight initialization promise so that concurrent callers
  // all await the same work rather than spinning in a polling loop.
  private initPromise: Promise<IOcrEngine> | null = null;

  /**
   * Returns the initialized OCR engine, creating and initializing it on first call.
   * Uses the singleton promise pattern: if initialization is already in progress,
   * concurrent callers await the same promise instead of busy-waiting with setTimeout.
   *
   * @returns A promise that resolves to the loaded OCR engine instance.
   */
  async getOrLoadEngine(): Promise<IOcrEngine> {
    if (this.engine) return this.engine;

    if (!this.initPromise) {
      this.initPromise = (async () => {
        console.log('[OcrManager] Instantiating PaddleOcrEngine...');
        const engine = new PaddleOcrEngine();
        await engine.init();
        this.engine = engine;
        return engine;
      })();
    }

    return this.initPromise;
  }

  /**
   * Process the image buffer to extract text and bounding boxes.
   *
   * @param imageBuffer - The raw ArrayBuffer of the image.
   * @returns A promise that resolves to the standardized OCR result.
   */
  async processImage(imageBuffer: ArrayBuffer): Promise<OcrResult> {
    const engine = await this.getOrLoadEngine();
    return await engine.recognize(imageBuffer);
  }

  /**
   * Unloads the engine from memory to free up VRAM/RAM.
   *
   * @returns A promise that resolves when cleanup is complete.
   */
  async cleanup(): Promise<void> {
    if (this.engine) {
      await this.engine.destroy();
      this.engine = null;
      this.initPromise = null;
    }
  }
}
