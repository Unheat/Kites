import type { BoxRect } from '../../utils/bubbleExpansion';

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
  /** Sibling text box indices verified to be enclosed in this same connected bubble chamber. */
  connectedBoxIndices?: number[];
}

export interface SeveredTailResult {
  carrier: BoxRect;
  eroded: Uint8Array;
  reconstructed: Uint8Array;
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
  /** Receives existing masks, including when tail severing leaves only one lobe. No extra segmentation. */
  onShapeEvidence?: (evidence: BubbleShapeEvidence) => void;
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

    // 1. Expand patch around text box (slack for bubble borders).
    // Bounded local patch: prevents open artwork or uniform textures (e.g. clothing)
    // from evading the >= 96% leakGuard ceiling.
    const padX = Math.round(Math.max(50, textBox.w * 0.9));
    const padY = Math.round(Math.max(50, textBox.h * 0.9));

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

    // 3. Build binary mask of bubble interior.
    // Only the target text box's interior is marked inText to prevent its own glyph strokes
    // from acting as obstacle walls. Connectivity across multiple lobes must be carried
    // by real observed paper pixels (isPaper), never manufactured across artwork borders.
    const mask = new Uint8Array(patchW * patchH);
    const observedInterior = options.onShapeEvidence ? new Uint8Array(patchW * patchH) : undefined;

    for (let py = 0; py < patchH; py++) {
      const origY = Math.min(imgH - 1, minY + Math.floor(py / scale));
      for (let px = 0; px < patchW; px++) {
        const origX = Math.min(imgW - 1, minX + Math.floor(px / scale));

        const inText = origX >= textBox.x && origX < textBox.x + textBox.w && origY >= textBox.y && origY < textBox.y + textBox.h;

        const pIdx = (origY * imgW + origX) * channels;
        const r = data[pIdx];
        const g = data[pIdx + 1];
        const b = data[pIdx + 2];
        const isPaper = isDarkBubble
          ? (r <= darkThresh && g <= darkThresh && b <= darkThresh)
          : (r >= lumThresh && g >= lumThresh && b >= lumThresh);

        if (isPaper && observedInterior) observedInterior[py * patchW + px] = 1;
        if (inText || isPaper) {
          mask[py * patchW + px] = 1;
        }
      }
    }

    // 4. Sever narrow pointing tails via morphological opening on binary mask
    const baseR = options.baseErodeRadius ?? 14;
    const rErode = Math.max(4, Math.round(baseR * scale));
    const textCenterX = Math.max(0, Math.min(patchW - 1, Math.round((textBox.x + textBox.w / 2 - minX) * scale)));
    const textCenterY = Math.max(0, Math.min(patchH - 1, Math.round((textBox.y + textBox.h / 2 - minY) * scale)));

    const severed = HeuristicBubbleExtractor.severTailOnBinaryMask(
      mask, patchW, patchH, textCenterX, textCenterY, rErode,
      origPatchW, origPatchH, minX, minY, scale, scale, true
    );

    if (!severed) {
      return null;
    }

    const carrier = severed.carrier;

    // Sanity clamp: carrier must at least contain the original text box
    const finalX = Math.min(carrier.x, textBox.x);
    const finalY = Math.min(carrier.y, textBox.y);
    const finalW = Math.max(carrier.w, textBox.w, (carrier.x + carrier.w) - finalX);
    const finalH = Math.max(carrier.h, textBox.h, (carrier.y + carrier.h) - finalY);

    const finalCarrier: BoxRect = {
      x: Math.max(0, finalX),
      y: Math.max(0, finalY),
      w: Math.min(imgW - Math.max(0, finalX), finalW),
      h: Math.min(imgH - Math.max(0, finalY), finalH),
    };

    // Verify which sibling text boxes from allTextBoxes are connected into this same chamber.
    // A sibling is only part of this chamber if:
    // 1. Its center falls inside the reconstructed morphology chamber (rec[cy][cx] === 1).
    // 2. The chamber bounding box strictly encloses the sibling box.
    const connectedBoxIndices: number[] = [];
    if (options.allTextBoxes && options.allTextBoxes.length > 1 && severed.reconstructed) {
      const rec = severed.reconstructed;
      const sX = patchW / origPatchW;
      const sY = patchH / origPatchH;
      for (let bi = 0; bi < options.allTextBoxes.length; bi++) {
        const b = options.allTextBoxes[bi];
        if (b === textBox) {
          connectedBoxIndices.push(bi);
          continue;
        }
        const isInsideCarrier = b.x >= finalCarrier.x && b.y >= finalCarrier.y
          && b.x + b.w <= finalCarrier.x + finalCarrier.w && b.y + b.h <= finalCarrier.y + finalCarrier.h;
        if (!isInsideCarrier) continue;

        const cx = Math.round(b.x + b.w / 2);
        const cy = Math.round(b.y + b.h / 2);
        if (cx >= minX && cx < maxX && cy >= minY && cy < maxY) {
          const px = Math.min(patchW - 1, Math.max(0, Math.round((cx - minX) * sX)));
          const py = Math.min(patchH - 1, Math.max(0, Math.round((cy - minY) * sY)));
          if (rec[py * patchW + px] === 1) {
            connectedBoxIndices.push(bi);
          }
        }
      }
    }

    // Preserve morphology evidence for conservative multi-lobe layout validation.
    options.onShapeEvidence?.({
      x: minX,
      y: minY,
      scale,
      scaleX: patchW / origPatchW,
      scaleY: patchH / origPatchH,
      width: patchW,
      height: patchH,
      interior: mask,
      observedInterior: observedInterior!,
      eroded: severed.eroded,
      reconstructed: severed.reconstructed,
      carrierBox: finalCarrier,
      isSeveredCarrier: true,
      connectedBoxIndices: connectedBoxIndices.length > 1 ? connectedBoxIndices : undefined,
    });

    return finalCarrier;
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
