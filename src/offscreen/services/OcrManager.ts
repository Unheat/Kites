import { IOcrEngine, OcrResult } from '../engines/ocr/BaseOcrEngine';
import { PaddleOcrEngine } from '../engines/ocr/PaddleOcrEngine';

export class OcrManager {
  private engine: IOcrEngine | null = null;
  private isInitializing = false;

  /**
   * Initializes the OCR engine. Currently hardcoded to PaddleOcrEngine (PP-OCRv4).
   * In the future, this can accept config to route to different engines.
   */
  async getOrLoadEngine(): Promise<IOcrEngine> {
    if (this.engine) return this.engine;
    if (this.isInitializing) {
      // Wait for initialization to complete if it's already in progress
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (this.engine) return this.engine;
    }

    this.isInitializing = true;
    try {
      console.log('[OcrManager] Instantiating PaddleOcrEngine...');
      this.engine = new PaddleOcrEngine();
      await this.engine.init();
      return this.engine;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Process the image buffer to extract text and bounding boxes.
   */
  async processImage(imageBuffer: ArrayBuffer): Promise<OcrResult> {
    const engine = await this.getOrLoadEngine();
    return await engine.recognize(imageBuffer);
  }

  /**
   * Unloads the engine from memory to free up VRAM/RAM.
   */
  async cleanup(): Promise<void> {
    if (this.engine) {
      await this.engine.destroy();
      this.engine = null;
    }
  }
}
