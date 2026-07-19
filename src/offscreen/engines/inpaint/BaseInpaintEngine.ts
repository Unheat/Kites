export interface Point2D {
  x: number;
  y: number;
}

export interface InpaintResult {
  /**
   * The text-free cleaned image as a raw ArrayBuffer.
   */
  cleanedImageBuffer: ArrayBuffer;
}

export interface IInpaintEngine {
  /**
   * Initialize the engine (e.g. loading weights, setting up canvas pipelines, ONNX Runtime).
   * 
   * @returns A promise that resolves when initialization is complete.
   */
  init(): Promise<void>;

  /**
   * Erase text from the given image buffer using the specified list of oriented boundary polygons.
   * 
   * @param imageBuffer - The raw ArrayBuffer of the source image.
   * @param maskPolygons - The list of oriented polygons (4 corners) bounding the text blocks.
   * @param strokeMaskCanvas - Optional pre-generated stroke mask canvas.
   * @returns A promise that resolves to the clean, text-free image as an ArrayBuffer.
   */
  inpaint(imageBuffer: ArrayBuffer, maskPolygons: Point2D[][], strokeMaskCanvas?: any): Promise<ArrayBuffer>;

  /**
   * Clean up and free resources (e.g., ONNX execution sessions, GPU buffers).
   * 
   * @returns A promise that resolves when destruction is complete.
   */
  destroy(): Promise<void>;
}
