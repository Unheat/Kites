import type { BoxRect } from '../../utils/bubbleExpansion';

export interface ImagePatchData {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface HeuristicExtractionOptions {
  /** Maximum downscale dimension for the local patch to guarantee sub-millisecond execution. Default 200. */
  maxPatchDimension?: number;
  /** Disk erosion radius at standard resolution. Default 14. */
  baseErodeRadius?: number;
  /** Minimum luminance threshold (0..255) for white bubble interior. Default 200. */
  luminanceThreshold?: number;
}

/**
 * Tier 1 Adaptive Heuristic Carrier Extractor.
 *
 * Implements morphological opening (disk erosion + flood fill + dilation) to extract
 * the speech bubble chamber and sever narrow pointing tails, with resolution-invariant
 * patch downscaling (< 1.5ms per bubble).
 */
export class HeuristicBubbleExtractor {
  /**
   * Extracts a carrier chamber BoxRect around a text box from the provided full-image pixel buffer.
   *
   * @param image - Image pixel buffer (RGBA or RGB).
   * @param textBox - Bounding box of the detected/merged text block.
   * @param options - Tunable morphology options.
   * @returns Detected carrier chamber BoxRect, or null if the text is in open/unbounded artwork.
   */
  static extractCarrierBox(
    image: ImagePatchData,
    textBox: BoxRect,
    options: HeuristicExtractionOptions = {}
  ): BoxRect | null {
    const { width: imgW, height: imgH, data } = image;
    const channels = data.length >= imgW * imgH * 4 ? 4 : 3;

    if (textBox.w < 10 || textBox.h < 10 || imgW < 20 || imgH < 20) {
      return null;
    }

    // 1. Expand patch around text box (slack for bubble borders)
    const padX = Math.round(Math.max(40, textBox.w * 0.8));
    const padY = Math.round(Math.max(40, textBox.h * 0.8));

    const minX = Math.max(0, textBox.x - padX);
    const minY = Math.max(0, textBox.y - padY);
    const maxX = Math.min(imgW, textBox.x + textBox.w + padX);
    const maxY = Math.min(imgH, textBox.y + textBox.h + padY);

    const origPatchW = maxX - minX;
    const origPatchH = maxY - minY;
    if (origPatchW < 20 || origPatchH < 20) {
      return null;
    }

    // 2. Compute downscale factor to bound computational complexity
    const maxDim = options.maxPatchDimension ?? 200;
    const scale = Math.min(1.0, maxDim / Math.max(origPatchW, origPatchH));
    const patchW = Math.max(10, Math.round(origPatchW * scale));
    const patchH = Math.max(10, Math.round(origPatchH * scale));

    const lumThresh = options.luminanceThreshold ?? 200;

    // 3. Build binary mask of bubble interior
    // Pixel is interior if inside text box or has light luminance (white bubble)
    const mask = new Uint8Array(patchW * patchH);
    let borderTouchCount = 0;

    for (let py = 0; py < patchH; py++) {
      const origY = Math.min(imgH - 1, minY + Math.floor(py / scale));
      for (let px = 0; px < patchW; px++) {
        const origX = Math.min(imgW - 1, minX + Math.floor(px / scale));

        const inText =
          origX >= textBox.x &&
          origX < textBox.x + textBox.w &&
          origY >= textBox.y &&
          origY < textBox.y + textBox.h;

        const pIdx = (origY * imgW + origX) * channels;
        const r = data[pIdx];
        const g = data[pIdx + 1];
        const b = data[pIdx + 2];
        const isLight = r >= lumThresh && g >= lumThresh && b >= lumThresh;

        const isInterior = inText || isLight;
        if (isInterior) {
          mask[py * patchW + px] = 1;
          // Track if light pixels touch the outer perimeter of our expanded patch
          if (px === 0 || px === patchW - 1 || py === 0 || py === patchH - 1) {
            borderTouchCount++;
          }
        }
      }
    }

    // Leak Guard: if light pixels leak across >= 70% of the patch perimeter,
    // this is uncontained open artwork / paper margin, not an enclosed bubble.
    const perimeter = 2 * (patchW + patchH);
    if (borderTouchCount > perimeter * 0.70) {
      return null;
    }

    // 4. Morphological erosion with disk radius R
    const baseR = options.baseErodeRadius ?? 14;
    const rErode = Math.max(4, Math.round(baseR * scale));
    const rSq = rErode * rErode;
    const eroded = new Uint8Array(patchW * patchH);

    for (let py = rErode; py < patchH - rErode; py++) {
      for (let px = rErode; px < patchW - rErode; px++) {
        if (mask[py * patchW + px] === 0) continue;

        let fits = true;
        for (let dy = -rErode; dy <= rErode; dy++) {
          const dySq = dy * dy;
          for (let dx = -rErode; dx <= rErode; dx++) {
            if (dx * dx + dySq <= rSq) {
              const nx = px + dx;
              const ny = py + dy;
              if (mask[ny * patchW + nx] === 0) {
                fits = false;
                break;
              }
            }
          }
          if (!fits) break;
        }

        if (fits) {
          eroded[py * patchW + px] = 1;
        }
      }
    }

    // 5. Find seed point near text center in eroded mask
    const textCenterX = Math.max(0, Math.min(patchW - 1, Math.round((textBox.x + textBox.w / 2 - minX) * scale)));
    const textCenterY = Math.max(0, Math.min(patchH - 1, Math.round((textBox.y + textBox.h / 2 - minY) * scale)));

    let seedX = -1;
    let seedY = -1;

    if (eroded[textCenterY * patchW + textCenterX] === 1) {
      seedX = textCenterX;
      seedY = textCenterY;
    } else {
      let minDist = Infinity;
      for (let py = 0; py < patchH; py++) {
        for (let px = 0; px < patchW; px++) {
          if (eroded[py * patchW + px] === 1) {
            const dist = (px - textCenterX) ** 2 + (py - textCenterY) ** 2;
            if (dist < minDist) {
              minDist = dist;
              seedX = px;
              seedY = py;
            }
          }
        }
      }
    }

    // If erosion wiped out the entire mask, fall back to geometric bounds or null
    if (seedX === -1 || seedY === -1) {
      return null;
    }

    // 6. BFS flood fill on connected component of eroded mask
    const visited = new Uint8Array(patchW * patchH);
    const queueX: number[] = [seedX];
    const queueY: number[] = [seedY];
    let qHead = 0;
    visited[seedY * patchW + seedX] = 1;

    const componentX: number[] = [];
    const componentY: number[] = [];

    while (qHead < queueX.length) {
      const cx = queueX[qHead];
      const cy = queueY[qHead];
      qHead++;
      componentX.push(cx);
      componentY.push(cy);

      const neighbors = [
        [cx - 1, cy],
        [cx + 1, cy],
        [cx, cy - 1],
        [cx, cy + 1]
      ];

      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < patchW && ny >= 0 && ny < patchH) {
          const idx = ny * patchW + nx;
          if (eroded[idx] === 1 && visited[idx] === 0) {
            visited[idx] = 1;
            queueX.push(nx);
            queueY.push(ny);
          }
        }
      }
    }

    if (componentX.length === 0) {
      return null;
    }

    // 7. Dilate connected component by R bounded by original mask
    const reconstructed = new Uint8Array(patchW * patchH);
    for (let i = 0; i < componentX.length; i++) {
      const cx = componentX[i];
      const cy = componentY[i];

      for (let dy = -rErode; dy <= rErode; dy++) {
        const dySq = dy * dy;
        for (let dx = -rErode; dx <= rErode; dx++) {
          if (dx * dx + dySq <= rSq) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && nx < patchW && ny >= 0 && ny < patchH) {
              const idx = ny * patchW + nx;
              if (mask[idx] === 1) {
                reconstructed[idx] = 1;
              }
            }
          }
        }
      }
    }

    // 8. Extract bounding box of reconstructed carrier
    let minPx = patchW;
    let maxPx = 0;
    let minPy = patchH;
    let maxPy = 0;

    for (let py = 0; py < patchH; py++) {
      for (let px = 0; px < patchW; px++) {
        if (reconstructed[py * patchW + px] === 1) {
          if (px < minPx) minPx = px;
          if (px > maxPx) maxPx = px;
          if (py < minPy) minPy = py;
          if (py > maxPy) maxPy = py;
        }
      }
    }

    if (minPx > maxPx || minPy > maxPy) {
      return null;
    }

    // Scale coordinates back to original image space
    const carrierX = Math.round(minX + minPx / scale);
    const carrierY = Math.round(minY + minPy / scale);
    const carrierW = Math.round((maxPx - minPx + 1) / scale);
    const carrierH = Math.round((maxPy - minPy + 1) / scale);

    // Sanity clamp: carrier must at least contain the original text box
    const finalX = Math.min(carrierX, textBox.x);
    const finalY = Math.min(carrierY, textBox.y);
    const finalW = Math.max(carrierW, textBox.w, (carrierX + carrierW) - finalX);
    const finalH = Math.max(carrierH, textBox.h, (carrierY + carrierH) - finalY);

    return {
      x: Math.max(0, finalX),
      y: Math.max(0, finalY),
      w: Math.min(imgW - finalX, finalW),
      h: Math.min(imgH - finalY, finalH)
    };
  }
}
