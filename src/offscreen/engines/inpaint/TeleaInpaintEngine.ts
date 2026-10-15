/**
 * @file TeleaInpaintEngine.ts
 * Tier 2 Inpainting Engine: Mathematical Fast Marching Method (FMM) Diffusion.
 *
 * Implements Alexandru Telea's Fast Marching Method inpainting algorithm (2004)
 * adapted from pyheal (olvb) and OpenCV's photo/src/inpaint.cpp (icvTeleaInpaintFMM).
 * See THIRD_PARTY_NOTICES.md for full license and copyright notice.
 *
 * Solves the Eikonal PDE to march the boundary front inward in distance order.
 * Propagates surrounding background colors and directional image gradients (isophotes)
 * along level sets using directional, level-set, and distance weighting.
 * Preserves panel borders, speech bubbles, and background drawings.
 * Very fast, 0MB download footprint.
 */

import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';

/** Pixel flag: clean known background or already inpainted pixel. */
export const FLAG_KNOWN = 0;
/** Pixel flag: narrow band boundary pixel actively propagating. */
export const FLAG_BAND = 1;
/** Pixel flag: masked pixel awaiting inpainting. */
export const FLAG_INSIDE = 2;

/** Sentinel representing infinity for initial distance field values. */
export const INF_DISTANCE = 1.0e6;
/** Epsilon floor for directional dot products and normalization to avoid zero-division. */
export const EPSILON = 1.0e-6;
/** Default inpainting radius in pixels (matching OpenCV standard range=3). */
export const DEFAULT_INPAINT_RADIUS = 3;
/** Context padding in pixels around bounding boxes to guarantee clean background context. */
export const CROP_CONTEXT_PADDING = 15;
/** Mask stroke line width in pixels for polygon inflation to swallow anti-aliased text fringes. */
export const POLYGON_STROKE_WIDTH = 2;

/**
 * Zero-allocation flat binary min-heap priority queue using TypedArrays.
 */
export class MinHeap {
  private values: Float32Array;
  private indices: Int32Array;
  private count = 0;

  /**
   * Constructs a typed min-heap with initial capacity.
   *
   * @param capacity - Initial capacity of the heap.
   */
  constructor(capacity: number) {
    this.values = new Float32Array(Math.max(16, capacity));
    this.indices = new Int32Array(Math.max(16, capacity));
  }

  /**
   * Current number of elements in the heap.
   */
  get size(): number {
    return this.count;
  }

  /**
   * Pushes a new item with key `val` and payload `idx` into the min-heap.
   * Dynamically resizes backing storage if capacity is reached.
   *
   * @param val - Priority key (distance / arrival time).
   * @param idx - Item identifier (flat pixel coordinate index).
   */
  push(val: number, idx: number): void {
    if (this.count >= this.values.length) {
      const newCap = this.values.length * 2;
      const newVals = new Float32Array(newCap);
      const newIdxs = new Int32Array(newCap);
      newVals.set(this.values);
      newIdxs.set(this.indices);
      this.values = newVals;
      this.indices = newIdxs;
    }

    let i = this.count++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.values[parent] <= val) break;
      this.values[i] = this.values[parent];
      this.indices[i] = this.indices[parent];
      i = parent;
    }
    this.values[i] = val;
    this.indices[i] = idx;
  }

  /**
   * Pops and returns the item identifier with the lowest priority value.
   *
   * @returns Item index, or -1 if empty.
   */
  pop(): number {
    if (this.count === 0) return -1;
    const minIdx = this.indices[0];
    const lastVal = this.values[--this.count];
    const lastIdx = this.indices[this.count];

    if (this.count > 0) {
      let i = 0;
      const half = this.count >> 1;
      while (i < half) {
        let left = (i << 1) + 1;
        const right = left + 1;
        if (right < this.count && this.values[right] < this.values[left]) {
          left = right;
        }
        if (lastVal <= this.values[left]) break;
        this.values[i] = this.values[left];
        this.indices[i] = this.indices[left];
        i = left;
      }
      this.values[i] = lastVal;
      this.indices[i] = lastIdx;
    }

    return minIdx;
  }
}

/**
 * Solves a single quadrant step of the upwind discretized Eikonal equation:
 * (max(T - T1, 0))^2 + (max(T - T2, 0))^2 = 1
 *
 * @param i1 - Row index of first neighbor.
 * @param j1 - Col index of first neighbor.
 * @param i2 - Row index of second neighbor.
 * @param j2 - Col index of second neighbor.
 * @param f - Flags array (padded).
 * @param t - Distance field array (padded).
 * @param stride - Stride (padded width).
 * @returns Computed arrival distance.
 */
export function solveEikonal(
  i1: number,
  j1: number,
  i2: number,
  j2: number,
  f: Uint8Array,
  t: Float32Array,
  stride: number,
): number {
  const idx1 = i1 * stride + j1;
  const idx2 = i2 * stride + j2;
  const a11 = t[idx1];
  const a22 = t[idx2];
  const m12 = a11 < a22 ? a11 : a22;

  const f1Known = f[idx1] !== FLAG_INSIDE;
  const f2Known = f[idx2] !== FLAG_INSIDE;

  if (f1Known) {
    if (f2Known) {
      const diff = Math.abs(a11 - a22);
      if (diff >= 1.0) {
        return 1.0 + m12;
      } else {
        const det = 2.0 - diff * diff;
        return (a11 + a22 + Math.sqrt(det > 0 ? det : 0)) * 0.5;
      }
    } else {
      return 1.0 + a11;
    }
  } else if (f2Known) {
    return 1.0 + a22;
  } else {
    return 1.0 + m12;
  }
}

export class TeleaInpaintEngine implements IInpaintEngine {
  private platform: any;

  constructor(platform: any) {
    this.platform = platform;
  }

  /**
   * Initializes the engine. This is a no-op as the FMM diffusion algorithm is purely mathematical and requires no external weights.
   *
   * @returns A promise that resolves immediately.
   */
  async init(): Promise<void> {
    // Math-based, no weights to download
    return Promise.resolve();
  }

  /**
   * Erases text using Alexandru Telea's Fast Marching Method (FMM) image inpainting algorithm.
   * Generates a dilated mask around each text polygon to swallow anti-aliased edges,
   * crops bounding boxes with extra padding, and diffuses surrounding colors inward.
   *
   * @param imageBuffer - Raw ArrayBuffer of the input image.
   * @param maskPolygons - Array of polygon vertex arrays bounding the text regions.
   * @param _strokeMaskCanvas - Unused; an inflated polygon mask is synthesized instead.
   * @returns A promise resolving to the inpainted image as an ArrayBuffer.
   */
  async inpaint(imageBuffer: ArrayBuffer, maskPolygons: Point2D[][], _strokeMaskCanvas?: any): Promise<ArrayBuffer> {
    if (!maskPolygons || maskPolygons.length === 0) {
      return imageBuffer;
    }

    // 1. Prepare canvases (prefer OffscreenCanvas to prevent headless compositor delays)
    const rawCanvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const width = rawCanvas.width;
    const height = rawCanvas.height;

    // Copy to CPU-backed canvas
    const sourceCanvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : this.platform.createCanvas(width, height);
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(rawCanvas, 0, 0);

    // 2. Generate an inflated solid mask canvas (on a fresh CPU canvas directly)
    const maskCanvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : this.platform.createCanvas(width, height);
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, width, height);

    maskCtx.fillStyle = '#ffffff';
    maskCtx.strokeStyle = 'white';
    maskCtx.lineWidth = POLYGON_STROKE_WIDTH; // Ensure stroke covers anti-aliased fringes
    maskCtx.lineJoin = 'round';
    maskCtx.lineCap = 'round';

    for (const poly of maskPolygons) {
      if (!poly || poly.length === 0) continue;
      maskCtx.beginPath();
      maskCtx.moveTo(poly[0].x, poly[0].y);
      for (let j = 1; j < poly.length; j++) {
        maskCtx.lineTo(poly[j].x, poly[j].y);
      }
      maskCtx.closePath();
      maskCtx.fill();
      maskCtx.stroke(); // Inflates edges to swallow grey anti-aliasing
    }

    // 3. Process each bounding box locally
    for (const poly of maskPolygons) {
      if (!poly || poly.length === 0) continue;

      // Calculate axis-aligned crop box
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;
      for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }

      const padding = CROP_CONTEXT_PADDING;
      const x = Math.max(0, Math.floor(minX) - padding);
      const y = Math.max(0, Math.floor(minY) - padding);
      const w = Math.min(width - x, Math.ceil(maxX - minX) + padding * 2);
      const h = Math.min(height - y, Math.ceil(maxY - minY) + padding * 2);

      if (w <= 0 || h <= 0) continue;

      // Extract local image crop and local mask crop
      const imgData = ctx.getImageData(x, y, w, h);
      const mData = maskCtx.getImageData(x, y, w, h);

      // Perform local Fast Marching Method inpainting
      this.inpaintFMM(w, h, imgData.data, mData.data, DEFAULT_INPAINT_RADIUS);

      // Put cleaned pixels back onto source canvas
      ctx.putImageData(imgData, x, y);
    }

    return await this.canvasToArrayBuffer(sourceCanvas);
  }

  /**
   * Fast Marching Method (FMM) pixel-marching diffusion.
   * Runs locally inside the cropped bounding box with 1-pixel padded boundary.
   *
   * @param width - Crop box width in pixels.
   * @param height - Crop box height in pixels.
   * @param imgBytes - RGBA pixel buffer of the crop image (mutated in place).
   * @param maskBytes - RGBA pixel buffer of the crop mask (red channel > 127 = masked).
   * @param radius - Sampling radius in pixels (default = 3).
   */
  public inpaintFMM(
    width: number,
    height: number,
    imgBytes: Uint8ClampedArray,
    maskBytes: Uint8ClampedArray,
    radius: number = DEFAULT_INPAINT_RADIUS,
  ): void {
    if (width <= 0 || height <= 0) return;

    // 1-pixel border padding to eliminate out-of-bounds branching in the inner loop
    const pWidth = width + 2;
    const pHeight = height + 2;
    const pTotal = pWidth * pHeight;

    const flags = new Uint8Array(pTotal);
    const dists = new Float32Array(pTotal);
    const heap = new MinHeap(Math.min(pTotal, 65536));

    let maskedCount = 0;

    // 1. Initialize states & distances
    for (let y = 1; y <= height; y++) {
      const rowOffset = y * pWidth;
      const imgRowOffset = (y - 1) * width;
      for (let x = 1; x <= width; x++) {
        const maskIdx = (imgRowOffset + (x - 1)) * 4;
        const pIdx = rowOffset + x;
        if (maskBytes[maskIdx] > 127) {
          flags[pIdx] = FLAG_INSIDE;
          dists[pIdx] = INF_DISTANCE;
          maskedCount++;
        } else {
          flags[pIdx] = FLAG_KNOWN;
          dists[pIdx] = 0;
        }
      }
    }

    // If nothing to inpaint, return immediately
    if (maskedCount === 0) return;

    // Outer frame padding defaults to clean known boundary
    for (let x = 0; x < pWidth; x++) {
      flags[x] = FLAG_KNOWN;
      flags[(pHeight - 1) * pWidth + x] = FLAG_KNOWN;
    }
    for (let y = 0; y < pHeight; y++) {
      flags[y * pWidth] = FLAG_KNOWN;
      flags[y * pWidth + (pWidth - 1)] = FLAG_KNOWN;
    }

    // 2. Identify initial BAND pixels (known pixels adjacent to masked region)
    for (let y = 1; y <= height; y++) {
      const rowOffset = y * pWidth;
      for (let x = 1; x <= width; x++) {
        const pIdx = rowOffset + x;
        if (flags[pIdx] === FLAG_KNOWN) {
          if (
            flags[pIdx - 1] === FLAG_INSIDE ||
            flags[pIdx + 1] === FLAG_INSIDE ||
            flags[pIdx - pWidth] === FLAG_INSIDE ||
            flags[pIdx + pWidth] === FLAG_INSIDE
          ) {
            flags[pIdx] = FLAG_BAND;
            dists[pIdx] = 0;
            heap.push(0, pIdx);
          }
        }
      }
    }

    // Offsets for 4-connected neighbors: Up, Left, Down, Right
    const dRows = [-1, 0, 1, 0];
    const dCols = [0, -1, 0, 1];

    // 3. March wavefront inward
    while (heap.size > 0) {
      const pIdx = heap.pop();
      if (pIdx < 0) break;

      const py = Math.floor(pIdx / pWidth);
      const px = pIdx % pWidth;

      flags[pIdx] = FLAG_KNOWN;

      for (let k = 0; k < 4; k++) {
        const ny = py + dRows[k];
        const nx = px + dCols[k];
        const nIdx = ny * pWidth + nx;

        if (flags[nIdx] === FLAG_INSIDE) {
          // A. Solve Eikonal equation across 4 quadrants to find smallest arrival distance
          const d1 = solveEikonal(ny - 1, nx, ny, nx - 1, flags, dists, pWidth);
          const d2 = solveEikonal(ny + 1, nx, ny, nx - 1, flags, dists, pWidth);
          const d3 = solveEikonal(ny - 1, nx, ny, nx + 1, flags, dists, pWidth);
          const d4 = solveEikonal(ny + 1, nx, ny, nx + 1, flags, dists, pWidth);
          const sol = Math.min(d1, d2, d3, d4);
          dists[nIdx] = sol;

          // B. Compute distance gradient (normal vector N to advancing wavefront)
          let gradTx = 0;
          const fR = flags[ny * pWidth + (nx + 1)];
          const fL = flags[ny * pWidth + (nx - 1)];
          if (fR !== FLAG_INSIDE && fL !== FLAG_INSIDE) {
            gradTx = (dists[ny * pWidth + (nx + 1)] - dists[ny * pWidth + (nx - 1)]) * 0.5;
          } else if (fR !== FLAG_INSIDE) {
            gradTx = dists[ny * pWidth + (nx + 1)] - dists[nIdx];
          } else if (fL !== FLAG_INSIDE) {
            gradTx = dists[nIdx] - dists[ny * pWidth + (nx - 1)];
          }

          let gradTy = 0;
          const fD = flags[(ny + 1) * pWidth + nx];
          const fU = flags[(ny - 1) * pWidth + nx];
          if (fD !== FLAG_INSIDE && fU !== FLAG_INSIDE) {
            gradTy = (dists[(ny + 1) * pWidth + nx] - dists[(ny - 1) * pWidth + nx]) * 0.5;
          } else if (fD !== FLAG_INSIDE) {
            gradTy = dists[(ny + 1) * pWidth + nx] - dists[nIdx];
          } else if (fU !== FLAG_INSIDE) {
            gradTy = dists[nIdx] - dists[(ny - 1) * pWidth + nx];
          }

          // C. Inpaint pixel (nx, ny) from surrounding KNOWN pixels within radius
          this.inpaintPoint(
            nx,
            ny,
            gradTx,
            gradTy,
            flags,
            dists,
            pWidth,
            pHeight,
            width,
            height,
            imgBytes,
            radius,
          );

          // D. Add pixel to BAND and push to priority queue
          flags[nIdx] = FLAG_BAND;
          heap.push(sol, nIdx);
        }
      }
    }
  }

  /**
   * Inpaints a single pixel using weighted neighborhood color and first-order image gradients.
   */
  private inpaintPoint(
    nx: number,
    ny: number,
    gradTx: number,
    gradTy: number,
    flags: Uint8Array,
    dists: Float32Array,
    pWidth: number,
    pHeight: number,
    cropWidth: number,
    cropHeight: number,
    imgBytes: Uint8ClampedArray,
    radius: number,
  ): void {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumW = 0;

    const targetT = dists[ny * pWidth + nx];
    const radiusSq = radius * radius;

    const qyMin = Math.max(1, ny - radius);
    const qyMax = Math.min(pHeight - 2, ny + radius);
    const qxMin = Math.max(1, nx - radius);
    const qxMax = Math.min(pWidth - 2, nx + radius);

    for (let qy = qyMin; qy <= qyMax; qy++) {
      for (let qx = qxMin; qx <= qxMax; qx++) {
        const qIdx = qy * pWidth + qx;
        if (flags[qIdx] === FLAG_INSIDE) continue;

        const rx = nx - qx;
        const ry = ny - qy;
        const d2 = rx * rx + ry * ry;
        if (d2 > radiusSq || d2 === 0) continue;

        const d = Math.sqrt(d2);

        // Directional factor: projection of (p - q) onto distance gradient
        let dir = rx * gradTx + ry * gradTy;
        if (Math.abs(dir) <= 0.01) {
          dir = EPSILON;
        }

        // Geometric distance factor: 1 / (d * d^2) = 1 / d^3
        const dst = 1.0 / (d * d2);

        // Level set factor: closeness in wavefront arrival time
        const lev = 1.0 / (1.0 + Math.abs(dists[qIdx] - targetT));

        const w = Math.abs(dir * dst * lev);

        const imgX = qx - 1;
        const imgY = qy - 1;
        const qImgBase = (imgY * cropWidth + imgX) * 4;

        // Channel-wise first order Taylor estimate
        for (let c = 0; c < 3; c++) {
          let gradIx = 0;
          const hasRight = imgX + 1 < cropWidth && flags[qy * pWidth + (qx + 1)] !== FLAG_INSIDE;
          const hasLeft = imgX - 1 >= 0 && flags[qy * pWidth + (qx - 1)] !== FLAG_INSIDE;
          if (hasRight && hasLeft) {
            const rVal = imgBytes[(imgY * cropWidth + (imgX + 1)) * 4 + c];
            const lVal = imgBytes[(imgY * cropWidth + (imgX - 1)) * 4 + c];
            gradIx = (rVal - lVal) * 0.5;
          } else if (hasRight) {
            const rVal = imgBytes[(imgY * cropWidth + (imgX + 1)) * 4 + c];
            const cVal = imgBytes[qImgBase + c];
            gradIx = rVal - cVal;
          } else if (hasLeft) {
            const cVal = imgBytes[qImgBase + c];
            const lVal = imgBytes[(imgY * cropWidth + (imgX - 1)) * 4 + c];
            gradIx = cVal - lVal;
          }

          let gradIy = 0;
          const hasDown = imgY + 1 < cropHeight && flags[(qy + 1) * pWidth + qx] !== FLAG_INSIDE;
          const hasUp = imgY - 1 >= 0 && flags[(qy - 1) * pWidth + qx] !== FLAG_INSIDE;
          if (hasDown && hasUp) {
            const dVal = imgBytes[((imgY + 1) * cropWidth + imgX) * 4 + c];
            const uVal = imgBytes[((imgY - 1) * cropWidth + imgX) * 4 + c];
            gradIy = (dVal - uVal) * 0.5;
          } else if (hasDown) {
            const dVal = imgBytes[((imgY + 1) * cropWidth + imgX) * 4 + c];
            const cVal = imgBytes[qImgBase + c];
            gradIy = dVal - cVal;
          } else if (hasUp) {
            const cVal = imgBytes[qImgBase + c];
            const uVal = imgBytes[((imgY - 1) * cropWidth + imgX) * 4 + c];
            gradIy = cVal - uVal;
          }

          // Taylor expansion: I_q(p) = I(q) + gradI * (p - q)
          const Iq = imgBytes[qImgBase + c] + gradIx * rx + gradIy * ry;

          if (c === 0) sumR += w * Iq;
          else if (c === 1) sumG += w * Iq;
          else sumB += w * Iq;
        }

        sumW += w;
      }
    }

    const targetImgBase = ((ny - 1) * cropWidth + (nx - 1)) * 4;
    if (sumW > 0) {
      imgBytes[targetImgBase] = Math.max(0, Math.min(255, Math.round(sumR / sumW)));
      imgBytes[targetImgBase + 1] = Math.max(0, Math.min(255, Math.round(sumG / sumW)));
      imgBytes[targetImgBase + 2] = Math.max(0, Math.min(255, Math.round(sumB / sumW)));
    }
    imgBytes[targetImgBase + 3] = 255;
  }

  /**
   * Helper that converts a canvas context to an ArrayBuffer in a cross-platform manner.
   */
  private async canvasToArrayBuffer(canvas: any): Promise<ArrayBuffer> {
    const isNode = typeof window === 'undefined';
    if (isNode) {
      const buf = canvas.toBuffer('image/png');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } else {
      // Use the modern native Promise-based API (Chrome 76+) instead of the
      // legacy FileReader callback pattern — faster and simpler.
      if (typeof canvas.convertToBlob === 'function') {
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return await blob.arrayBuffer();
      } else if (typeof canvas.toDataURL === 'function') {
        // WORKAROUND: In Chromium offscreen documents, HTMLCanvasElement.toBlob() relies on
        // the asynchronous compositor frame loop which may not pump in unattached background frames.
        // canvas.toDataURL() + fetch() is synchronous and never stalls.
        const dataUrl = canvas.toDataURL('image/png');
        const res = await fetch(dataUrl);
        return await res.arrayBuffer();
      } else {
        return new Promise((resolve, reject) => {
          canvas.toBlob((blob: Blob | null) => {
            if (!blob) return reject(new Error('[TeleaInpaintEngine] Failed to convert canvas to blob'));
            blob.arrayBuffer().then(resolve).catch(reject);
          }, 'image/png');
        });
      }
    }
  }

  /**
   * Cleans up engine resources. This is a no-op since no resources are held.
   *
   * @returns A promise that resolves immediately.
   */
  async destroy(): Promise<void> {
    return Promise.resolve();
  }
}
