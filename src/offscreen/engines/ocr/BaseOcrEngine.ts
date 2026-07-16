export interface OcrBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrResult {
  texts: string[];
  boxes: OcrBox[];
  scores?: number[];
  polygons?: {x: number, y: number}[][]; // Array of 4-point corners [TopLeft, TopRight, BottomRight, BottomLeft]
}

export interface IOcrEngine {
  /**
   * Initialize the engine (e.g. downloading weights, setting up WebGPU).
   * 
   * @returns A promise that resolves when initialization is complete.
   */
  init(): Promise<void>;

  /**
   * Process an image buffer and extract text bounding boxes and strings.
   * 
   * @param imageBuffer - The raw ArrayBuffer of the image.
   * @returns A promise that resolves to the OCR result containing texts and boxes.
   */
  recognize(imageBuffer: ArrayBuffer): Promise<OcrResult>;

  /**
   * Free up memory / WebGPU buffers when the engine is no longer needed.
   * 
   * @returns A promise that resolves when destruction is complete.
   */
  destroy(): Promise<void>;
}

