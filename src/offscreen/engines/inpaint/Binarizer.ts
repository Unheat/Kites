import type { Point2D } from './BaseInpaintEngine';

/**
 * Extracts a refined text stroke mask for the given image canvas.
 * Implements a pure JS grayscale + Otsu thresholding + polygon clip masking pipeline.
 */
const PADDING_RATIO = 0.1; // Dynamic padding ratio for Circular Dilation
export class Binarizer {
  /**
   * Generates a binary mask of the same width and height as the source image,
   * where white (255) pixels represent text strokes and black (0) represents the background.
   * 
   * @param platform - The platform abstraction layer (Browser or Node).
   * @param sourceCanvas - The HTMLCanvasElement / Canvas containing the original image.
   * @param polygons - The array of text polygons.
   * @returns A canvas representing the stroke-level mask.
   */
  static extractStrokeMask(
    platform: any,
    sourceCanvas: any,
    polygons: Point2D[][]
  ): any {
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    
    // Create the global black mask canvas
    const maskCanvas = platform.createCanvas(width, height);
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, width, height);

    // If no text detected, return black mask
    if (!polygons || polygons.length === 0) {
      return maskCanvas;
    }

    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });

    // Process each text region separately
    for (const poly of polygons) {
      // 1. Calculate axis-aligned bounding box for the polygon
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;
      for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      
      const x = Math.max(0, Math.floor(minX));
      const y = Math.max(0, Math.floor(minY));
      const w = Math.min(width - x, Math.ceil(maxX - minX));
      const h = Math.min(height - y, Math.ceil(maxY - minY));

      if (w <= 0 || h <= 0) continue;

      // 2. Fetch local image data
      const imgData = sourceCtx.getImageData(x, y, w, h);
      const data = imgData.data;

      // 3. Convert crop to grayscale and construct luminance histogram
      const gray = new Uint8ClampedArray(w * h);
      const histogram = new Array(256).fill(0);
      let borderSum = 0;
      let borderCount = 0;

      for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        // Grayscale conversion using luminance formula
        const g = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
        gray[i] = g;
        histogram[g]++;

        // Sample border pixels to detect background color
        const pxX = i % w;
        const pxY = Math.floor(i / w);
        if (pxX === 0 || pxX === w - 1 || pxY === 0 || pxY === h - 1) {
          borderSum += g;
          borderCount++;
        }
      }

      const avgBorderGray = borderCount > 0 ? borderSum / borderCount : 127;
      const isBgLight = avgBorderGray > 127;

      // 4. Calculate optimal binarization threshold using Otsu's method
      const totalPixels = w * h;
      let sum = 0;
      for (let t = 0; t < 256; t++) {
        sum += t * histogram[t];
      }

      let sumB = 0;
      let wB = 0;
      let wF = 0;
      let varMax = 0;
      let otsuThresh = 127;

      for (let t = 0; t < 256; t++) {
        wB += histogram[t];
        if (wB === 0) continue;
        wF = totalPixels - wB;
        if (wF === 0) break;

        sumB += t * histogram[t];

        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;

        const varBetween = wB * wF * (mB - mF) * (mB - mF);
        if (varBetween > varMax) {
          varMax = varBetween;
          otsuThresh = t;
        }
      }

      // 5. Build localized stroke image data
      const tempCanvas = platform.createCanvas(w, h);
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      const tempImgData = tempCtx.createImageData(w, h);
      const tempImgBytes = tempImgData.data;

      for (let i = 0; i < w * h; i++) {
        const g = gray[i];
        // If background is light (white speech bubble), text is dark (< Otsu threshold)
        // If background is dark, text is light (>= Otsu threshold)
        const isTextPixel = isBgLight ? (g < otsuThresh) : (g >= otsuThresh);
        
        const idx = i * 4;
        if (isTextPixel) {
          tempImgBytes[idx] = 255;   // R
          tempImgBytes[idx + 1] = 255; // G
          tempImgBytes[idx + 2] = 255; // B
          tempImgBytes[idx + 3] = 255; // Alpha
        } else {
          tempImgBytes[idx] = 0;
          tempImgBytes[idx + 1] = 0;
          tempImgBytes[idx + 2] = 0;
          tempImgBytes[idx + 3] = 0; // Transparent background for dilation
        }
      }
      tempCtx.putImageData(tempImgData, 0, 0);

      // 6. Clip the binarized source to the exact polygon before dilation, so we don't pick up noise outside the text area
      tempCtx.globalCompositeOperation = 'destination-in';
      tempCtx.beginPath();
      tempCtx.moveTo(poly[0].x - x, poly[0].y - y);
      for (let p = 1; p < poly.length; p++) {
        tempCtx.lineTo(poly[p].x - x, poly[p].y - y);
      }
      tempCtx.closePath();
      tempCtx.fill();
      tempCtx.globalCompositeOperation = 'source-over'; // restore

      // 7. Dynamic Circular Dilation (mimicking OpenCV cv2.dilate with MORPH_ELLIPSE)
      // Cotrans dynamically sets dilate_size based on text size: dilate_size = int(text_size * 0.3)
      // Since padding is radius, padding = text_size * 0.15
      const dynamicPadding = Math.max(Math.floor(Math.min(w, h) * PADDING_RATIO), 1);

      const radiusSq = dynamicPadding * dynamicPadding;
      for (let dy = -dynamicPadding; dy <= dynamicPadding; dy++) {
        for (let dx = -dynamicPadding; dx <= dynamicPadding; dx++) {
          if (dx * dx + dy * dy <= radiusSq) {
            maskCtx.drawImage(tempCtx.canvas || tempCanvas, x + dx, y + dy);
          }
        }
      }
    }

    return maskCtx.canvas || maskCanvas;
  }
}
