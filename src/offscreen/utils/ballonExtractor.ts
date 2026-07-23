/**
 * 1:1 port of Cotrans `rendering/ballon_extractor.py`.
 *
 * Extracts the binary mask of the speech balloon that contains a text region:
 * 1. Crop an enlarged window around the text region.
 * 2. Detect edges (Gaussian blur + Canny 70/140, L2 gradient).
 * 3. For every large edge component, flood fill from the window center — the
 *    smallest fill that still covers >30% of the window is the balloon interior.
 * 4. Morphological cleanup (dilate + close), producing a 255=interior mask.
 *
 * All operations run on plain Uint8Array/Float32Array buffers so the module works
 * in both Offscreen Documents (extension) and node-canvas (tests).
 *
 * Deviations from the cv2 implementation (documented, equivalent in effect):
 * - `cv2.drawContours(thickness=2)` of an edge component is emulated by stamping the
 *   component's pixels dilated by 1px (identical for the 1px-thin Canny edge chains).
 * - Resizing uses bilinear interpolation instead of INTER_AREA (soft mask edges only).
 */

/** Flood fill tolerance used by Cotrans for all balloon fills (loDiff = upDiff = 10). */
const FLOOD_DIFF = 10;
/** Edge components must cover at least this fraction of the window to be balloon candidates. */
const MIN_COMPONENT_RECT_RATIO = 0.4;
/** A candidate flood fill must cover more than this fraction of the window. */
const MIN_FILL_RATIO = 0.3;
/** Canny hysteresis thresholds (Cotrans: cv2.Canny(img, 70, 140, L2gradient=True)). */
const CANNY_LOW = 70;
const CANNY_HIGH = 140;

export interface GrayImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface BallonRegionResult {
  /** Balloon mask, 255 = balloon interior, 0 = outside. */
  mask: GrayImage;
  /** Crop window [x1, y1, x2, y2] in full-image coordinates. */
  xyxy: [number, number, number, number];
}

/**
 * 1:1 port of Cotrans `enlarge_window`: grows a rect so its area increases by `ratio`,
 * distributing growth according to the aspect ratio, clamped to the image bounds.
 *
 * @param rect - [x1, y1, x2, y2] of the region.
 * @param imW - Image width.
 * @param imH - Image height.
 * @param ratio - Target area growth ratio (> 1).
 * @param aspectRatio - Width growth per unit of height growth.
 * @returns Enlarged [x1, y1, x2, y2], clamped to the image.
 */
export function enlargeWindow(
  rect: [number, number, number, number],
  imW: number,
  imH: number,
  ratio = 2.5,
  aspectRatio = 1.0
): [number, number, number, number] {
  const [x1, y1, x2, y2] = rect;
  const w = x2 - x1;
  const h = y2 - y1;

  if (w <= 0 || h <= 0) return [0, 0, 0, 0];

  // Solve aspectRatio * d^2 + (w + h * aspectRatio) * d + (1 - ratio) * w * h = 0 for the largest root
  const a = aspectRatio;
  const b = w + h * aspectRatio;
  const c = (1 - ratio) * w * h;
  const discriminant = b * b - 4 * a * c;
  const root = a !== 0
    ? (-b + Math.sqrt(Math.max(0, discriminant))) / (2 * a)
    : -c / b;

  const delta = Math.round(root / 2);
  let deltaW = Math.trunc(delta * aspectRatio);
  deltaW = Math.min(x1, imW - x2, deltaW);
  const deltaH = Math.min(y1, imH - y2, delta);

  const out: [number, number, number, number] = [
    Math.round(x1 - deltaW), Math.round(y1 - deltaH),
    Math.round(x2 + deltaW), Math.round(y2 + deltaH)
  ];
  out[0] = Math.max(0, Math.min(out[0], imW - 1));
  out[2] = Math.max(0, Math.min(out[2], imW - 1));
  out[1] = Math.max(0, Math.min(out[1], imH - 1));
  out[3] = Math.max(0, Math.min(out[3], imH - 1));
  return out;
}

/**
 * Bilinearly resizes a single-channel image.
 *
 * @param src - Source gray image.
 * @param dstW - Destination width.
 * @param dstH - Destination height.
 * @returns Resized gray image.
 */
export function resizeGray(src: GrayImage, dstW: number, dstH: number): GrayImage {
  const dst = new Uint8Array(dstW * dstH);
  const xRatio = src.width / dstW;
  const yRatio = src.height / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min((y + 0.5) * yRatio - 0.5, src.height - 1);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min((x + 0.5) * xRatio - 0.5, src.width - 1);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);

      const v00 = src.data[y0 * src.width + x0];
      const v01 = src.data[y0 * src.width + x1];
      const v10 = src.data[y1 * src.width + x0];
      const v11 = src.data[y1 * src.width + x1];
      const top = v00 + (v01 - v00) * fx;
      const bottom = v10 + (v11 - v10) * fx;
      dst[y * dstW + x] = Math.round(top + (bottom - top) * fy);
    }
  }
  return { data: dst, width: dstW, height: dstH };
}

/**
 * Applies a 3x3 Gaussian blur (sigma computed like cv2 for ksize=3: 0.8) with
 * REFLECT_101 borders to one channel.
 *
 * @param src - Channel values.
 * @param w - Width.
 * @param h - Height.
 * @returns Blurred channel as Float32Array.
 */
function gaussianBlur3(src: Float32Array, w: number, h: number): Float32Array {
  // getGaussianKernel(3, 0.8) normalized
  const k0 = 0.23899227;
  const k1 = 0.52201546;
  const reflect = (i: number, n: number) => {
    if (n === 1) return 0;
    if (i < 0) return -i;
    if (i >= n) return 2 * n - i - 2;
    return i;
  };

  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xm = reflect(x - 1, w);
      const xp = reflect(x + 1, w);
      tmp[y * w + x] = k0 * src[y * w + xm] + k1 * src[y * w + x] + k0 * src[y * w + xp];
    }
  }
  const dst = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = reflect(y - 1, h);
    const yp = reflect(y + 1, h);
    for (let x = 0; x < w; x++) {
      dst[y * w + x] = k0 * tmp[ym * w + x] + k1 * tmp[y * w + x] + k0 * tmp[yp * w + x];
    }
  }
  return dst;
}

/**
 * Canny edge detection (aperture 3, L2 gradient) on an RGB crop, matching
 * cv2.Canny's multi-channel behavior: per pixel, the channel with the largest
 * gradient magnitude wins.
 *
 * @param channels - The 3 blurred color channels.
 * @param w - Width.
 * @param h - Height.
 * @param low - Low hysteresis threshold.
 * @param high - High hysteresis threshold.
 * @returns Edge map (255 = edge).
 */
function cannyEdges(channels: Float32Array[], w: number, h: number, low: number, high: number): Uint8Array {
  const reflect = (i: number, n: number) => {
    if (n === 1) return 0;
    if (i < 0) return -i;
    if (i >= n) return 2 * n - i - 2;
    return i;
  };

  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const ym = reflect(y - 1, h);
    const yp = reflect(y + 1, h);
    for (let x = 0; x < w; x++) {
      const xm = reflect(x - 1, w);
      const xp = reflect(x + 1, w);
      let bestMag = -1;
      let bestGx = 0;
      let bestGy = 0;
      for (const ch of channels) {
        // Sobel 3x3
        const tl = ch[ym * w + xm], tc = ch[ym * w + x], tr = ch[ym * w + xp];
        const ml = ch[y * w + xm], mr = ch[y * w + xp];
        const bl = ch[yp * w + xm], bc = ch[yp * w + x], br = ch[yp * w + xp];
        const dx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
        const dy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
        const m = Math.sqrt(dx * dx + dy * dy);
        if (m > bestMag) {
          bestMag = m;
          bestGx = dx;
          bestGy = dy;
        }
      }
      const idx = y * w + x;
      gx[idx] = bestGx;
      gy[idx] = bestGy;
      mag[idx] = bestMag;
    }
  }

  // Non-maximum suppression along the gradient direction (4 quantized sectors)
  const TAN_22_5 = 0.4142135623730951;
  const nms = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const m = mag[idx];
      if (m < low) continue;
      const dx = gx[idx];
      const dy = gy[idx];
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);

      let n1: number, n2: number;
      if (ay <= ax * TAN_22_5) {
        // Horizontal gradient -> compare left/right
        n1 = mag[idx - 1];
        n2 = mag[idx + 1];
      } else if (ax <= ay * TAN_22_5) {
        // Vertical gradient -> compare up/down
        n1 = mag[idx - w];
        n2 = mag[idx + w];
      } else if ((dx > 0) === (dy > 0)) {
        // 45deg diagonal
        n1 = mag[idx - w - 1];
        n2 = mag[idx + w + 1];
      } else {
        // 135deg diagonal
        n1 = mag[idx - w + 1];
        n2 = mag[idx + w - 1];
      }
      if (m > n1 && m >= n2) {
        nms[idx] = m;
      }
    }
  }

  // Hysteresis: BFS from strong pixels through weak pixels (8-connectivity)
  const edges = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (nms[i] > high) {
      edges[i] = 255;
      stack.push(i);
    }
  }
  while (stack.length > 0) {
    const idx = stack.pop()!;
    const x = idx % w;
    const y = (idx - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (edges[nIdx] === 0 && nms[nIdx] > low) {
          edges[nIdx] = 255;
          stack.push(nIdx);
        }
      }
    }
  }
  return edges;
}

/**
 * Draws a 1px rectangle border of the given value onto a gray image
 * (cv2.rectangle((0,0),(w-1,h-1), value, 1) equivalent).
 */
function drawBorder(img: GrayImage, value: number): void {
  const { data, width: w, height: h } = img;
  for (let x = 0; x < w; x++) {
    data[x] = value;
    data[(h - 1) * w + x] = value;
  }
  for (let y = 0; y < h; y++) {
    data[y * w] = value;
    data[y * w + w - 1] = value;
  }
}

interface EdgeComponent {
  pixels: number[];
  rectW: number;
  rectH: number;
}

/**
 * Finds 8-connected components of nonzero pixels with their bounding rects
 * (equivalent to iterating cv2.findContours results with cv2.boundingRect).
 *
 * @param img - Binary edge map.
 * @returns Components in scan order.
 */
function findEdgeComponents(img: GrayImage): EdgeComponent[] {
  const { data, width: w, height: h } = img;
  const labels = new Int32Array(w * h);
  const components: EdgeComponent[] = [];
  const stack: number[] = [];

  for (let i = 0; i < w * h; i++) {
    if (data[i] === 0 || labels[i] !== 0) continue;
    const label = components.length + 1;
    const pixels: number[] = [];
    let minX = w, maxX = 0, minY = h, maxY = 0;
    labels[i] = label;
    stack.push(i);
    while (stack.length > 0) {
      const idx = stack.pop()!;
      pixels.push(idx);
      const x = idx % w;
      const y = (idx - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (data[nIdx] !== 0 && labels[nIdx] === 0) {
            labels[nIdx] = label;
            stack.push(nIdx);
          }
        }
      }
    }
    components.push({ pixels, rectW: maxX - minX + 1, rectH: maxY - minY + 1 });
  }
  return components;
}

/**
 * Stamps an edge component onto a mask with a 3x3 disk per pixel — the equivalent of
 * cv2.drawContours(mask, contours, i, value, thickness=2) for thin Canny edge chains.
 */
function stampComponent(img: GrayImage, component: EdgeComponent, value: number): void {
  const { data, width: w, height: h } = img;
  for (const idx of component.pixels) {
    const x = idx % w;
    const y = (idx - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        data[ny * w + nx] = value;
      }
    }
  }
}

/**
 * 1:1 port of cv2.floodFill with floating range (flags=4, loDiff=upDiff=diff):
 * fills 4-connected pixels whose value differs from their already-filled neighbor
 * by at most `diff`, writing `newVal`.
 *
 * @param img - Gray image, modified in place.
 * @param seedX - Seed x.
 * @param seedY - Seed y.
 * @param newVal - Fill value.
 * @param diff - Per-step tolerance.
 * @returns Number of filled pixels (cv2 retval).
 */
export function floodFill(img: GrayImage, seedX: number, seedY: number, newVal: number, diff: number = FLOOD_DIFF): number {
  const { data, width: w, height: h } = img;
  if (seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) return 0;

  // Keep original values for the floating-range comparison
  const orig = data.slice();
  const seedIdx = seedY * w + seedX;
  const visited = new Uint8Array(w * h);
  const stack = [seedIdx];
  visited[seedIdx] = 1;
  let count = 0;

  while (stack.length > 0) {
    const idx = stack.pop()!;
    data[idx] = newVal;
    count++;
    const x = idx % w;
    const y = (idx - x) / w;
    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < w - 1 ? idx + 1 : -1,
      y > 0 ? idx - w : -1,
      y < h - 1 ? idx + w : -1
    ];
    for (const nIdx of neighbors) {
      if (nIdx < 0 || visited[nIdx]) continue;
      if (Math.abs(orig[nIdx] - orig[idx]) <= diff) {
        visited[nIdx] = 1;
        stack.push(nIdx);
      }
    }
  }
  return count;
}

/**
 * Morphological dilate (max filter) with an NxN ones kernel, single iteration.
 */
export function dilate(img: GrayImage, k: number): GrayImage {
  return morph(img, k, true);
}

/**
 * Morphological erode (min filter) with an NxN ones kernel, single iteration.
 */
export function erode(img: GrayImage, k: number): GrayImage {
  return morph(img, k, false);
}

function morph(img: GrayImage, k: number, isMax: boolean): GrayImage {
  const { data, width: w, height: h } = img;
  const anchor = Math.floor(k / 2);
  const lo = -anchor;
  const hi = k - 1 - anchor;

  // Separable: horizontal pass then vertical pass
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = isMax ? 0 : 255;
      for (let d = lo; d <= hi; d++) {
        const nx = Math.max(0, Math.min(w - 1, x + d));
        const v = data[y * w + nx];
        if (isMax ? v > best : v < best) best = v;
      }
      tmp[y * w + x] = best;
    }
  }
  const dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = isMax ? 0 : 255;
      for (let d = lo; d <= hi; d++) {
        const ny = Math.max(0, Math.min(h - 1, y + d));
        const v = tmp[ny * w + x];
        if (isMax ? v > best : v < best) best = v;
      }
      dst[y * w + x] = best;
    }
  }
  return { data: dst, width: w, height: h };
}

/**
 * Computes the centroid of a gray mask via image moments (cv2.moments equivalent).
 *
 * @param img - Gray mask (weights are the pixel values).
 * @returns Integer centroid { x, y }, or the image center if the mask is empty.
 */
export function maskCentroid(img: GrayImage): { x: number; y: number } {
  const { data, width: w, height: h } = img;
  let m00 = 0, m10 = 0, m01 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      if (v === 0) continue;
      m00 += v;
      m10 += v * x;
      m01 += v * y;
    }
  }
  if (m00 === 0) return { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  return { x: Math.trunc(m10 / m00), y: Math.trunc(m01 / m00) };
}

/**
 * Bounding rect of all nonzero pixels (cv2.boundingRect(cv2.findNonZero(mask)) equivalent).
 *
 * @param img - Gray mask.
 * @returns { x, y, w, h }, or the full image when the mask is empty.
 */
export function maskBoundingRect(img: GrayImage): { x: number; y: number; w: number; h: number } {
  const { data, width, height } = img;
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Rotates a gray mask counterclockwise (as displayed) by angleDeg with canvas expansion,
 * matching PIL Image.rotate(angle, expand=True) with nearest-neighbor resampling.
 *
 * @param img - Source mask.
 * @param angleDeg - Rotation in degrees (visual counterclockwise).
 * @returns Rotated, expanded mask.
 */
export function rotateMaskExpand(img: GrayImage, angleDeg: number): GrayImage {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { width: w, height: h } = img;
  const newW = Math.ceil(Math.abs(w * cos) + Math.abs(h * sin));
  const newH = Math.ceil(Math.abs(w * sin) + Math.abs(h * cos));
  const dst = new Uint8Array(newW * newH);

  const cxd = newW / 2;
  const cyd = newH / 2;
  const cxs = w / 2;
  const cys = h / 2;

  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const xr = x + 0.5 - cxd;
      const yr = y + 0.5 - cyd;
      // Visual CCW rotation in y-down coordinates: source = R(+angle) * dest
      const xs = xr * cos - yr * sin + cxs;
      const ys = xr * sin + yr * cos + cys;
      const sx = Math.floor(xs);
      const sy = Math.floor(ys);
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) {
        dst[y * newW + x] = img.data[sy * w + sx];
      }
    }
  }
  return { data: dst, width: newW, height: newH };
}

/**
 * 1:1 port of Cotrans `extract_ballon_region`.
 * Extracts the speech balloon interior mask around a text region.
 *
 * @param pageData - Full page RGBA pixel data (e.g. from ctx.getImageData).
 * @param pageWidth - Full page width.
 * @param pageHeight - Full page height.
 * @param ballonRect - Text region [x, y, w, h] in page coordinates.
 * @param enlargeRatio - Window enlargement ratio (1 = no enlargement).
 * @returns Balloon mask (255 = interior) and the crop window used.
 */
export function extractBallonRegion(
  pageData: Uint8ClampedArray | Uint8Array,
  pageWidth: number,
  pageHeight: number,
  ballonRect: [number, number, number, number],
  enlargeRatio = 1
): BallonRegionResult {
  let x1 = ballonRect[0];
  let y1 = ballonRect[1];
  let x2 = ballonRect[2] + ballonRect[0];
  let y2 = ballonRect[3] + ballonRect[1];
  if (enlargeRatio > 1) {
    [x1, y1, x2, y2] = enlargeWindow(
      [x1, y1, x2, y2], pageWidth, pageHeight, enlargeRatio,
      ballonRect[2] !== 0 ? ballonRect[3] / ballonRect[2] : 1
    );
  }
  x1 = Math.max(0, Math.min(Math.round(x1), pageWidth - 1));
  x2 = Math.max(x1 + 1, Math.min(Math.round(x2), pageWidth));
  y1 = Math.max(0, Math.min(Math.round(y1), pageHeight - 1));
  y2 = Math.max(y1 + 1, Math.min(Math.round(y2), pageHeight));

  const oriW = x2 - x1;
  const oriH = y2 - y1;

  // Crop RGB channels out of the page RGBA buffer
  let channels: Float32Array[] = [0, 1, 2].map(() => new Float32Array(oriW * oriH));
  for (let y = 0; y < oriH; y++) {
    for (let x = 0; x < oriW; x++) {
      const srcIdx = ((y + y1) * pageWidth + (x + x1)) * 4;
      const dstIdx = y * oriW + x;
      channels[0][dstIdx] = pageData[srcIdx];
      channels[1][dstIdx] = pageData[srcIdx + 1];
      channels[2][dstIdx] = pageData[srcIdx + 2];
    }
  }

  // Cotrans scale factor selection
  let scaleR = 1;
  if (oriH > 300 && oriW > 300) {
    scaleR = 0.6;
  } else if (oriH < 120 || oriW < 120) {
    scaleR = 1.4;
  }

  let w = oriW;
  let h = oriH;
  if (scaleR !== 1) {
    w = Math.trunc(oriW * scaleR);
    h = Math.trunc(oriH * scaleR);
    channels = channels.map(ch => {
      const asGray: GrayImage = {
        data: new Uint8Array(ch.length).map((_, i) => ch[i]),
        width: oriW,
        height: oriH
      };
      const resized = resizeGray(asGray, w, h);
      return new Float32Array(resized.data);
    });
  }
  const imgArea = w * h;

  // Edge detection: GaussianBlur(3x3) + Canny(70, 140, L2)
  const blurred = channels.map(ch => gaussianBlur3(ch, w, h));
  const detectedEdges: GrayImage = { data: cannyEdges(blurred, w, h, CANNY_LOW, CANNY_HIGH), width: w, height: h };

  // Cotrans draws a white border before findContours so open balloons close at the window edge
  drawBorder(detectedEdges, 255);
  const components = findEdgeComponents(detectedEdges);
  drawBorder(detectedEdges, 0);

  // Candidate selection: smallest center flood fill above 30% of the window
  let ballonMask: GrayImage = { data: new Uint8Array(w * h), width: w, height: h };
  let minRetval = Infinity;
  const mask: GrayImage = { data: new Uint8Array(w * h), width: w, height: h };
  const seedX = Math.trunc(w / 2);
  const seedY = Math.trunc(h / 2);

  for (const component of components) {
    if (component.rectW * component.rectH < imgArea * MIN_COMPONENT_RECT_RATIO) continue;

    stampComponent(mask, component, 255);
    const cpmask: GrayImage = { data: mask.data.slice(), width: w, height: h };
    drawBorder(mask, 255);
    const retval = floodFill(cpmask, seedX, seedY, 127);

    if (retval <= imgArea * MIN_FILL_RATIO) {
      stampComponent(mask, component, 0);
    }
    if (retval < minRetval && retval > imgArea * MIN_FILL_RATIO) {
      minRetval = retval;
      ballonMask = cpmask;
    }
  }

  // ballon_mask = 127 - ballon_mask (uint8 wraparound like numpy)
  for (let i = 0; i < ballonMask.data.length; i++) {
    ballonMask.data[i] = (127 - ballonMask.data[i]) & 0xFF;
  }
  ballonMask = dilate(ballonMask, 3);
  const ballonArea = floodFill(ballonMask, seedX, seedY, 30);
  // ballon_mask = 30 - ballon_mask (uint8 wraparound)
  for (let i = 0; i < ballonMask.data.length; i++) {
    ballonMask.data[i] = (30 - ballonMask.data[i]) & 0xFF;
  }
  // threshold(1, 255, THRESH_BINARY) then bitwise_not -> interior 255, rest 0
  for (let i = 0; i < ballonMask.data.length; i++) {
    ballonMask.data[i] = ballonMask.data[i] > 1 ? 0 : 255;
  }

  // Closing with a balloon-size dependent kernel
  const boxKernel = Math.trunc(Math.sqrt(ballonArea) / 30);
  if (boxKernel > 1) {
    ballonMask = dilate(ballonMask, boxKernel);
    ballonMask = erode(ballonMask, boxKernel);
  }

  if (scaleR !== 1) {
    ballonMask = resizeGray(ballonMask, oriW, oriH);
  }

  return { mask: ballonMask, xyxy: [x1, y1, x2, y2] };
}

/**
 * 1:1 port of Cotrans `extract_ballon_region` using `@techstark/opencv-js` WASM bindings.
 * Matches Cotrans Python opencv calls 1:1 when OpenCV runtime is present.
 */
export function extractBallonRegionOpenCV(
  cv: any,
  pageData: Uint8ClampedArray | Uint8Array,
  pageWidth: number,
  pageHeight: number,
  ballonRect: [number, number, number, number],
  enlargeRatio = 1
): BallonRegionResult {
  let x1 = ballonRect[0];
  let y1 = ballonRect[1];
  let x2 = ballonRect[2] + ballonRect[0];
  let y2 = ballonRect[3] + ballonRect[1];
  if (enlargeRatio > 1) {
    [x1, y1, x2, y2] = enlargeWindow(
      [x1, y1, x2, y2], pageWidth, pageHeight, enlargeRatio,
      ballonRect[2] !== 0 ? ballonRect[3] / ballonRect[2] : 1
    );
  }
  x1 = Math.max(0, Math.min(Math.round(x1), pageWidth - 1));
  x2 = Math.max(x1 + 1, Math.min(Math.round(x2), pageWidth));
  y1 = Math.max(0, Math.min(Math.round(y1), pageHeight - 1));
  y2 = Math.max(y1 + 1, Math.min(Math.round(y2), pageHeight));

  const oriW = x2 - x1;
  const oriH = y2 - y1;

  // Extract crop RGBA image data
  const cropCanvas = new Uint8ClampedArray(oriW * oriH * 4);
  for (let y = 0; y < oriH; y++) {
    for (let x = 0; x < oriW; x++) {
      const srcIdx = ((y + y1) * pageWidth + (x + x1)) * 4;
      const dstIdx = (y * oriW + x) * 4;
      cropCanvas[dstIdx] = pageData[srcIdx];
      cropCanvas[dstIdx + 1] = pageData[srcIdx + 1];
      cropCanvas[dstIdx + 2] = pageData[srcIdx + 2];
      cropCanvas[dstIdx + 3] = pageData[srcIdx + 3];
    }
  }

  let scaleR = 1;
  if (oriH > 300 && oriW > 300) {
    scaleR = 0.6;
  } else if (oriH < 120 || oriW < 120) {
    scaleR = 1.4;
  }

  let mat = cv.matFromImageData({ data: cropCanvas, width: oriW, height: oriH });
  let srcMat = mat;
  if (scaleR !== 1) {
    const resized = new cv.Mat();
    const dsize = new cv.Size(Math.trunc(oriW * scaleR), Math.trunc(oriH * scaleR));
    cv.resize(mat, resized, dsize, 0, 0, cv.INTER_AREA);
    srcMat = resized;
  }

  const h = srcMat.rows;
  const w = srcMat.cols;
  const imgArea = h * w;

  // cv2.GaussianBlur(img, (3,3), cv2.BORDER_DEFAULT)
  const cpimg = new cv.Mat();
  cv.GaussianBlur(srcMat, cpimg, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

  // cv2.Canny(cpimg, 70, 140, L2gradient=True, apertureSize=3)
  const detectedEdges = new cv.Mat();
  cv.Canny(cpimg, detectedEdges, CANNY_LOW, CANNY_HIGH, 3, true);

  // cv2.rectangle(detectedEdges, (0, 0), (w-1, h-1), WHITE, 1, cv2.LINE_8)
  const white = new cv.Scalar(255, 255, 255, 255);
  const black = new cv.Scalar(0, 0, 0, 0);
  cv.rectangle(detectedEdges, new cv.Point(0, 0), new cv.Point(w - 1, h - 1), white, 1, cv.LINE_8);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(detectedEdges, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE);

  cv.rectangle(detectedEdges, new cv.Point(0, 0), new cv.Point(w - 1, h - 1), black, 1, cv.LINE_8);

  let ballonMask = cv.Mat.zeros(h, w, cv.CV_8UC1);
  let minRetval = Infinity;
  const seedPoint = new cv.Point(Math.trunc(w / 2), Math.trunc(h / 2));
  const loDiff = new cv.Scalar(FLOOD_DIFF, FLOOD_DIFF, FLOOD_DIFF);
  const upDiff = new cv.Scalar(FLOOD_DIFF, FLOOD_DIFF, FLOOD_DIFF);

  for (let i = 0; i < contours.size(); i++) {
    const rect = cv.boundingRect(contours.get(i));
    if (rect.width * rect.height < imgArea * MIN_COMPONENT_RECT_RATIO) continue;

    const mask = cv.Mat.zeros(h, w, cv.CV_8UC1);
    cv.drawContours(mask, contours, i, new cv.Scalar(255), 2);
    const cpmask = mask.clone();
    cv.rectangle(mask, new cv.Point(0, 0), new cv.Point(w - 1, h - 1), white, 1, cv.LINE_8);

    const filledRect = new cv.Rect();
    const retval = cv.floodFill(cpmask, mask, seedPoint, new cv.Scalar(127), filledRect, loDiff, upDiff, 4);

    if (retval <= imgArea * MIN_FILL_RATIO) {
      cv.drawContours(mask, contours, i, black, 2);
    }
    if (retval < minRetval && retval > imgArea * MIN_FILL_RATIO) {
      minRetval = retval;
      ballonMask = cpmask;
    }
    mask.delete();
  }

  // 127 - ballonMask
  const maskData = ballonMask.data;
  for (let i = 0; i < maskData.length; i++) {
    maskData[i] = (127 - maskData[i]) & 0xFF;
  }

  const kernel = cv.Mat.ones(3, 3, cv.CV_8UC1);
  cv.dilate(ballonMask, ballonMask, kernel, new cv.Point(-1, -1), 1);

  const filledRect = new cv.Rect();
  const ballonArea = cv.floodFill(ballonMask, new cv.Mat(), seedPoint, new cv.Scalar(30), filledRect, loDiff, upDiff, 4);

  for (let i = 0; i < maskData.length; i++) {
    maskData[i] = (30 - maskData[i]) & 0xFF;
  }

  cv.threshold(ballonMask, ballonMask, 1, 255, cv.THRESH_BINARY);
  cv.bitwise_not(ballonMask, ballonMask);

  const boxKernelSize = Math.trunc(Math.sqrt(ballonArea) / 30);
  if (boxKernelSize > 1) {
    const boxKernel = cv.Mat.ones(boxKernelSize, boxKernelSize, cv.CV_8UC1);
    cv.dilate(ballonMask, ballonMask, boxKernel, new cv.Point(-1, -1), 1);
    cv.erode(ballonMask, ballonMask, boxKernel, new cv.Point(-1, -1), 1);
    boxKernel.delete();
  }

  if (scaleR !== 1) {
    const resizedMask = new cv.Mat();
    cv.resize(ballonMask, resizedMask, new cv.Size(oriW, oriH), 0, 0, cv.INTER_NEAREST);
    ballonMask = resizedMask;
  }

  const outData = new Uint8Array(ballonMask.data);

  // Cleanup OpenCV WASM memory
  mat.delete();
  if (srcMat !== mat) srcMat.delete();
  cpimg.delete();
  detectedEdges.delete();
  contours.delete();
  hierarchy.delete();
  kernel.delete();

  return {
    mask: { data: outData, width: oriW, height: oriH },
    xyxy: [x1, y1, x2, y2]
  };
}

