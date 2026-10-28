import type { BoxRect } from '../../utils/bubbleExpansion';
import { discoverHeuristicRegion, initialSearchBounds } from './heuristicRegionSearch';
import { paperCoverage } from './heuristicPaperComponents';
import { MIN_HEURISTIC_TEXT_COVERAGE } from './heuristicCandidateValidation';

// Adaptive luminance tuning: the binarization threshold is anchored to the background sampled on a
// ring just outside the text box (see sampleBackgroundLuminance). FLOOR guards against dark artwork
// fooling the extractor into calling every pixel interior; MARGIN keeps anti-aliased glyph edges and
// faint screentones from being swallowed into the bubble mask.
/** Ring distance in pixels outside the text box where background samples are taken. */
export const ADAPTIVE_LUM_SAMPLE_OFFSET = 4;
/** Subtracted from (or added to for dark bubbles) sampled background luminance to derive threshold. */
export const ADAPTIVE_LUM_MARGIN = 35;
/** Lower bound of the derived dynamic threshold for bright bubbles (never binarize below this). */
export const ADAPTIVE_LUM_FLOOR = 130;
/** Fallback binarization threshold when no background sample is available (legacy hardcoded value). */
export const DEFAULT_LUMINANCE_THRESHOLD = 200;

/** Number of luminance quantization bins for interior polarity analysis. Aligned with SimpleInpaintEngine. */
export const LUMINANCE_HISTOGRAM_BINS = 16;
/** Upper bound bin index considered dark background paper (bins 0..5 correspond to lum 0..95). */
export const DARK_PAPER_MAX_BIN = 5;
/** Lower bound bin index considered bright background paper (bins 10..15 correspond to lum 160..255). */
export const BRIGHT_PAPER_MIN_BIN = 10;
/** Upper ceiling threshold for dark background paper binarization. */
export const DARK_PAPER_LUMINANCE_CEILING = 95;
/** Fallback binarization threshold for dark bubbles when no ring sample is available. */
export const DEFAULT_DARK_LUMINANCE_THRESHOLD = 50;

export interface ImagePatchData {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Existing local morphology buffers retained only for conservative layout validation. */
export interface BubbleShapeEvidence {
  x: number;
  y: number;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  width: number;
  height: number;
  interior: Uint8Array;
  /** Observed paper pixels (light or dark depending on polarity), excluding force-filled OCR rectangles. */
  observedInterior: Uint8Array;
  eroded: Uint8Array;
  /** Reconstructed carrier chamber mask (1 inside chamber, 0 outside) after tail severing and dilation. */
  reconstructed?: Uint8Array;
  carrierBox?: BoxRect;
  isSeveredCarrier?: boolean;
  /** Heuristic-only proof that the full observed component passed enclosure validation. */
  validatedComponent?: boolean;
}

export interface SeveredTailResult {
  carrier: BoxRect;
  eroded: Uint8Array;
  reconstructed: Uint8Array;
}

export interface HeuristicExtractionOptions {
  /** Maximum geometry-raster dimension after native-resolution validation. Default 200. */
  maxPatchDimension?: number;
  /** Disk erosion radius at standard resolution. Default 14. */
  baseErodeRadius?: number;
  /** Manual binarization threshold (0..255) override. Default: adaptive — sampled background ring minus ADAPTIVE_LUM_MARGIN, floored at ADAPTIVE_LUM_FLOOR (fallback DEFAULT_LUMINANCE_THRESHOLD). */
  luminanceThreshold?: number;
  /** OCR boxes used as supported chamber seeds, never force-painted over outlines. */
  allTextBoxes?: BoxRect[];
  /** Receives existing masks, including when tail severing leaves only one lobe. No extra segmentation. */
  onShapeEvidence?: (evidence: BubbleShapeEvidence) => void;
  /** Native-pixel search allocation ceiling; exhaustion rejects rather than inventing closure. */
  maxSearchPixels?: number;
  /** Receives accepted/rejected search diagnostics without per-pixel logging. */
  onDiagnostics?: (diagnostics: { status: string; reason?: string; passes: number }) => void;
}

/**
 * Tier 1 Adaptive Heuristic Carrier Extractor.
 *
   * Validates observed paper topology with bounded adaptive search before morphological
   * opening (disk erosion + flood fill + dilation) severs narrow pointing tails.
   * Search uses native pixels; the final geometry raster is downscaled independently.
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

    const bounds = initialSearchBounds(image, textBox);
    const minX = bounds.x, minY = bounds.y;
    const maxX = bounds.x + bounds.w, maxY = bounds.y + bounds.h;

    // Adaptive dual-polarity luminance:
    // Pass 1: analyze dominant background paper polarity inside the text box.
    // Paper occupies ~70-85% of interior area while glyph ink is ~15-30%.
    // Mode (peakBin <= 5) indicates dark paper (e.g. scream or demonic speech bubbles).
    const peakBin = HeuristicBubbleExtractor.sampleInteriorPolarity(
      data, imgW, imgH, channels, textBox
    );
    const isDarkBubble = peakBin <= DARK_PAPER_MAX_BIN;

    const bgLum = HeuristicBubbleExtractor.sampleBackgroundLuminance(
      data, imgW, imgH, channels, textBox, minX, minY, maxX, maxY
    );

    let lumThresh: number;
    let darkThresh: number;
    if (options.luminanceThreshold !== undefined) {
      lumThresh = options.luminanceThreshold;
      darkThresh = options.luminanceThreshold;
    } else if (isDarkBubble) {
      const darkBase = bgLum !== null ? bgLum : DEFAULT_DARK_LUMINANCE_THRESHOLD;
      darkThresh = Math.min(DARK_PAPER_LUMINANCE_CEILING, darkBase + ADAPTIVE_LUM_MARGIN);
      lumThresh = DEFAULT_LUMINANCE_THRESHOLD;
    } else {
      const lightBase = bgLum !== null ? bgLum : DEFAULT_LUMINANCE_THRESHOLD;
      lumThresh = Math.max(ADAPTIVE_LUM_FLOOR, lightBase - ADAPTIVE_LUM_MARGIN);
      darkThresh = DEFAULT_DARK_LUMINANCE_THRESHOLD;
    }

    const discovered = discoverHeuristicRegion(image, textBox, {
      dark: isDarkBubble,
      threshold: isDarkBubble ? darkThresh : lumThresh,
      maxPixels: options.maxSearchPixels,
    });
    options.onDiagnostics?.({ status: discovered.status,
      reason: discovered.status === 'rejected' ? discovered.reason : undefined, passes: discovered.passes });
    if (discovered.status === 'rejected') return null;

    const region = discovered.patch.bounds;
    const scale = Math.min(1, (options.maxPatchDimension ?? 200) / Math.max(region.w, region.h));
    const width = Math.max(1, Math.round(region.w * scale));
    const height = Math.max(1, Math.round(region.h * scale));
    const scaleX = width / region.w, scaleY = height / region.h;
    const mask = new Uint8Array(width * height);
    const observed = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const source = Math.min(region.h - 1, Math.floor(y / scaleY)) * region.w
        + Math.min(region.w - 1, Math.floor(x / scaleX));
      mask[y * width + x] = discovered.filled[source];
      observed[y * width + x] = discovered.component.mask[source];
    }
    const reconstructed = new Uint8Array(mask.length);
    let eroded: Uint8Array = new Uint8Array(mask.length);
    const seeds = (options.allTextBoxes ?? [textBox]).filter((box) =>
      paperCoverage(discovered.filled, region, box) >= MIN_HEURISTIC_TEXT_COVERAGE);
    for (const seed of seeds) {
      const cx = Math.max(0, Math.min(width - 1, Math.round((seed.x + seed.w / 2 - region.x) * scaleX)));
      const cy = Math.max(0, Math.min(height - 1, Math.round((seed.y + seed.h / 2 - region.y) * scaleY)));
      const severed = HeuristicBubbleExtractor.severTailOnBinaryMask(mask, width, height, cx, cy,
        Math.max(1, Math.round((options.baseErodeRadius ?? 14) * scale)),
        region.w, region.h, region.x, region.y, scaleX, scaleY, false);
      if (!severed) continue;
      eroded = severed.eroded;
      for (let i = 0; i < mask.length; i++) reconstructed[i] |= severed.reconstructed[i];
    }
    // Small valid cavities can disappear under erosion. Keep the verified cavity, not an OCR rectangle.
    const chamber = reconstructed.some(Boolean) ? reconstructed : mask;
    let left = width, top = height, right = -1, bottom = -1;
    for (let i = 0; i < chamber.length; i++) if (chamber[i]) {
      left = Math.min(left, i % width); right = Math.max(right, i % width);
      top = Math.min(top, Math.floor(i / width)); bottom = Math.max(bottom, Math.floor(i / width));
    }
    if (right < left) return null;
    const carrier = { x: region.x + left / scaleX, y: region.y + top / scaleY,
      w: (right - left + 1) / scaleX, h: (bottom - top + 1) / scaleY };
    options.onShapeEvidence?.({ x: region.x, y: region.y, scale, scaleX, scaleY, width, height,
      interior: mask, observedInterior: observed, eroded, reconstructed: chamber,
      carrierBox: carrier, isSeveredCarrier: true, validatedComponent: true });
    return carrier;
  }

  /**
   * Applies morphological opening (disk erosion + BFS flood fill from seed + constrained dilation)
   * on a binary mask to sever narrow pointing tails and extract the main carrier chamber bounding box.
   *
   * @param mask - Binary mask array (width * height), 1 inside, 0 outside.
   * @param patchW - Mask width in pixels.
   * @param patchH - Mask height in pixels.
   * @param textCenterX - Target center X in patch coordinates.
   * @param textCenterY - Target center Y in patch coordinates.
   * @param rErode - Disk erosion radius.
   * @param origPatchW - Original image patch width.
   * @param origPatchH - Original image patch height.
   * @param minX - Origin X in image space.
   * @param minY - Origin Y in image space.
   * @param scaleX - Horizontal scale factor (patchW / origPatchW).
   * @param scaleY - Vertical scale factor (patchH / origPatchH).
   * @param leakGuard - Whether to reject components filling >= 96% of patch (true for heuristic, false for AI mask).
   * @returns Bounding box in image space and internal morphological buffers, or null if eroded away.
   */
  static severTailOnBinaryMask(
    mask: Uint8Array,
    patchW: number,
    patchH: number,
    textCenterX: number,
    textCenterY: number,
    rErode: number,
    origPatchW: number,
    origPatchH: number,
    minX: number,
    minY: number,
    scaleX: number,
    scaleY: number,
    leakGuard: boolean = true
  ): SeveredTailResult | null {
    if (patchW <= 0 || patchH <= 0 || rErode <= 0) return null;

    const rSq = rErode * rErode;
    const eroded = new Uint8Array(patchW * patchH);

    // 1. Disk erosion
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

    // 2. Find seed point near text center in eroded mask
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

    if (seedX === -1 || seedY === -1) {
      return null;
    }

    // 3. BFS flood fill on connected component of eroded mask
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

    // 4. Dilate connected component by rErode bounded by original mask
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

    // 5. Extract bounding box of reconstructed carrier
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
    const carrierX = Math.round(minX + minPx / scaleX);
    const carrierY = Math.round(minY + minPy / scaleY);
    const carrierW = Math.round((maxPx - minPx + 1) / scaleX);
    const carrierH = Math.round((maxPy - minPy + 1) / scaleY);

    if (leakGuard && carrierW >= origPatchW * 0.96 && carrierH >= origPatchH * 0.96) {
      return null;
    }

    return {
      carrier: { x: carrierX, y: carrierY, w: carrierW, h: carrierH },
      eroded,
      reconstructed,
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

  /**
   * Samples interior pixels of the text box into a 16-bin luminance histogram to detect
   * dominant background paper polarity (paper takes ~70%-85% area; glyph ink ~15%-30%).
   * Aligned with SimpleInpaintEngine (PR #13 / Issue #12).
   *
   * @param data - Pixel buffer.
   * @param imgW - Image width in pixels.
   * @param imgH - Image height in pixels.
   * @param channels - Bytes per pixel (3 or 4).
   * @param textBox - Bounding box of the text block.
   * @returns Dominant peak bin index (0..15).
   */
  static sampleInteriorPolarity(
    data: Uint8ClampedArray | Uint8Array,
    imgW: number,
    imgH: number,
    channels: number,
    textBox: BoxRect
  ): number {
    const hist = new Uint32Array(LUMINANCE_HISTOGRAM_BINS);
    const startX = Math.max(0, Math.round(textBox.x));
    const startY = Math.max(0, Math.round(textBox.y));
    const endX = Math.min(imgW, Math.round(textBox.x + textBox.w));
    const endY = Math.min(imgH, Math.round(textBox.y + textBox.h));

    const step = Math.max(1, Math.floor(Math.max(endX - startX, endY - startY) / 30));

    for (let y = startY; y < endY; y += step) {
      for (let x = startX; x < endX; x += step) {
        const idx = (y * imgW + x) * channels;
        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        const bin = Math.min(LUMINANCE_HISTOGRAM_BINS - 1, Math.floor(lum / 16));
        hist[bin]++;
      }
    }

    let peakBin = 0;
    let peakCount = 0;
    for (let b = 0; b < LUMINANCE_HISTOGRAM_BINS; b++) {
      if (hist[b] > peakCount) {
        peakCount = hist[b];
        peakBin = b;
      }
    }
    return peakBin;
  }
}
