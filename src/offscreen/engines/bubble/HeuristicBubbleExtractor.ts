import type { BoxRect } from '../../utils/bubbleExpansion';

// Adaptive luminance tuning: the binarization threshold is anchored to the background sampled on a
// ring just outside the text box (see sampleBackgroundLuminance). FLOOR guards against dark artwork
// fooling the extractor into calling every pixel interior; MARGIN keeps anti-aliased glyph edges and
// faint screentones from being swallowed into the bubble mask.
/** Ring distance in pixels outside the text box where background samples are taken. */
export const ADAPTIVE_LUM_SAMPLE_OFFSET = 4;
/** Subtracted from the sampled background luminance to derive the dynamic threshold. */
export const ADAPTIVE_LUM_MARGIN = 35;
/** Lower bound of the derived dynamic threshold (never binarize below this). */
export const ADAPTIVE_LUM_FLOOR = 130;
/** Fallback binarization threshold when no background sample is available (legacy hardcoded value). */
export const DEFAULT_LUMINANCE_THRESHOLD = 200;

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
  /** Manual binarization threshold (0..255) override. Default: adaptive — sampled background ring minus ADAPTIVE_LUM_MARGIN, floored at ADAPTIVE_LUM_FLOOR (fallback DEFAULT_LUMINANCE_THRESHOLD). */
  luminanceThreshold?: number;
  /** Optional array of all detected text boxes to treat as interior whitespace (prevents un-erased sibling text from acting as fake walls). */
  allTextBoxes?: BoxRect[];
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
    const padX = Math.round(Math.max(50, textBox.w * 1.0));
    const padY = Math.round(Math.max(50, textBox.h * 1.0));

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

    // Adaptive luminance: anchor the binarization threshold to the actual background ring around
    // the text. Translucent bubbles over dark artwork render as grey (RGB ~130-190) and the legacy
    // hardcoded 200 threshold cut them apart mid-chamber; sampling the background keeps them one
    // connected chamber. An explicit options.luminanceThreshold override still wins, and the legacy
    // DEFAULT_LUMINANCE_THRESHOLD applies when no ring sample is available (e.g. text box hugging
    // the image edge).
    let lumThresh = DEFAULT_LUMINANCE_THRESHOLD;
    if (options.luminanceThreshold !== undefined) {
      lumThresh = options.luminanceThreshold;
    } else {
      const bgLum = HeuristicBubbleExtractor.sampleBackgroundLuminance(
        data, imgW, imgH, channels, textBox, minX, minY, maxX, maxY
      );
      if (bgLum !== null) {
        lumThresh = Math.max(ADAPTIVE_LUM_FLOOR, bgLum - ADAPTIVE_LUM_MARGIN);
      }
    }

    // Filter nearby text boxes that intersect the patch so their dark glyph pixels
    // are treated as interior whitespace rather than artificial obstacle walls.
    const nearbyBoxes = options.allTextBoxes && options.allTextBoxes.length > 0
      ? options.allTextBoxes.filter((b) =>
          b.x + b.w > minX && b.x < maxX && b.y + b.h > minY && b.y < maxY
        )
      : [textBox];

    // 3. Build binary mask of bubble interior
    // Pixel is interior if inside any known text box or has light luminance (white bubble)
    const mask = new Uint8Array(patchW * patchH);

    for (let py = 0; py < patchH; py++) {
      const origY = Math.min(imgH - 1, minY + Math.floor(py / scale));
      for (let px = 0; px < patchW; px++) {
        const origX = Math.min(imgW - 1, minX + Math.floor(px / scale));

        let inText = false;
        for (let bi = 0; bi < nearbyBoxes.length; bi++) {
          const b = nearbyBoxes[bi];
          if (origX >= b.x && origX < b.x + b.w && origY >= b.y && origY < b.y + b.h) {
            inText = true;
            break;
          }
        }

        const pIdx = (origY * imgW + origX) * channels;
        const r = data[pIdx];
        const g = data[pIdx + 1];
        const b = data[pIdx + 2];
        const isLight = r >= lumThresh && g >= lumThresh && b >= lumThresh;

        if (inText || isLight) {
          mask[py * patchW + px] = 1;
        }
      }
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

    // Leak Guard: if the reconstructed component fills >= 96% of the expanded patch in BOTH dimensions,
    // this indicates an unbounded white background without enclosing dark borders (e.g. open page margin).
    if (carrierW >= origPatchW * 0.96 && carrierH >= origPatchH * 0.96) {
      return null;
    }

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

  /**
   * Samples the median background channel-min luminance on a ring just outside the text box.
   *
   * 16 samples are taken ADAPTIVE_LUM_SAMPLE_OFFSET pixels outside the box: 5 along the top edge,
   * 3 along the right, 5 along the bottom, 3 along the left. Per-sample value is min(r, g, b) so the
   * metric aligns with the per-channel binarization test that consumes the result; the median makes
   * the estimate robust against individual samples landing on glyph tips, bubble strokes, or
   * background artwork lines behind translucent bubbles.
   *
   * @param data - Full-image pixel buffer (RGBA or RGB).
   * @param imgW - Image width in pixels.
   * @param imgH - Image height in pixels.
   * @param channels - Bytes per pixel (3 or 4).
   * @param textBox - Bounding box of the text block whose surrounding background is sampled.
   * @param minX - Patch left bound (samples outside the patch are skipped).
   * @param minY - Patch top bound.
   * @param maxX - Patch right bound.
   * @param maxY - Patch bottom bound.
   * @returns Median background luminance in 0..255, or null when no sample landed inside the patch.
   */
  static sampleBackgroundLuminance(
    data: Uint8ClampedArray | Uint8Array,
    imgW: number,
    imgH: number,
    channels: number,
    textBox: BoxRect,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): number | null {
    const off = ADAPTIVE_LUM_SAMPLE_OFFSET;
    const samples: number[] = [];

    const push = (rawX: number, rawY: number) => {
      const x = Math.round(rawX);
      const y = Math.round(rawY);
      if (x < minX || x >= maxX || y < minY || y >= maxY) return;
      if (x < 0 || x >= imgW || y < 0 || y >= imgH) return;
      const idx = (y * imgW + x) * channels;
      samples.push(Math.min(data[idx], data[idx + 1], data[idx + 2]));
    };

    for (let k = 0; k <= 4; k++) {
      push(textBox.x + (textBox.w * k) / 4, textBox.y - off);
      push(textBox.x + (textBox.w * k) / 4, textBox.y + textBox.h + off);
    }
    for (let k = 1; k <= 3; k++) {
      push(textBox.x + textBox.w + off, textBox.y + (textBox.h * k) / 4);
      push(textBox.x - off, textBox.y + (textBox.h * k) / 4);
    }

    if (samples.length === 0) return null;
    samples.sort((a, b) => a - b);
    const mid = samples.length >> 1;
    return samples.length % 2 === 1 ? samples[mid] : Math.round((samples[mid - 1] + samples[mid]) / 2);
  }
}
