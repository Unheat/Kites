export interface OcrBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Standardized output format for OCR engines.
 * 
 * Note: All arrays are perfectly aligned by index.
 * For example, `texts[i]` corresponds to `boxes[i]`, `scores[i]`, and `polygons[i]`.
 */
export interface OcrResult {
  /** The extracted text strings for each detected text block. */
  texts: string[];
  
  /** Standard axis-aligned bounding boxes for each text block. */
  boxes: OcrBox[];
  
  /** Optional confidence scores (0.0 to 1.0) for each text block. Can be used for filtering out low-quality predictions. */
  scores?: number[];
  
  /** Optional precise rotated quadrilaterals outlining the text. Array of 4-point corners [TopLeft, TopRight, BottomRight, BottomLeft]. */
  polygons?: {x: number, y: number}[][];
  
  /** Optional raw unmerged line quadrilaterals for inpainting engines. */
  rawPolygons?: {x: number, y: number}[][];

  /** Optional raw DBNet probability heat map canvas (Cotrans mask_raw). */
  maskRawCanvas?: any;

  /** Optional detected primary reading direction for each text region ('h' = horizontal, 'v' = vertical). */
  directions?: ('h' | 'v')[];
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

