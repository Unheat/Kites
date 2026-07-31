// clipper-lib is plain CommonJS (single clipper.js, "main": "clipper"), so a static import
// resolves in the browser via the bundler and in Node/tsx via the `.default ||` interop.
//
// Do NOT reach for node:module's createRequire here. Vite shims `module` to `{}` for browser
// builds, so `createRequire` is undefined and calling it throws
// `TypeError: (0, l.createRequire) is not a function` on the hot path
// unclipPolygon -> extractPolygons -> detectPolygons, which breaks detection in the extension.
import clipperLibModule from 'clipper-lib';
const ClipperLib: any = (clipperLibModule as any).default || clipperLibModule;

export interface Point {
  X: number; // ClipperLib uses uppercase X, Y
  Y: number;
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Cotrans/PaddleOCR DBPostProcess `min_size` (detection/default_utils/dbnet_utils.py:10).
 * Minimum short side of a candidate's min-area-rect, in model-space pixels. Rejects
 * hairline slivers that survive binarization along panel borders and speech-bubble edges.
 */
const MIN_BOX_SIDE = 3;

/**
 * Minimum MEAN probability inside a blob's min-area-rect for it to be kept. Distinct from the
 * binarization `threshold` argument (0.3), which only decides which pixels join a blob: this
 * second gate rejects large, uniformly low-confidence smears.
 *
 * NOTE ON HARDWARE PRECISION DISCREPANCY:
 * Native CPU (onnxruntime-node) compiles to direct machine code and does intermediate accumulations
 * in 64-bit float registers (FP64), maintaining high precision. Browser WebAssembly (onnxruntime-web)
 * is sandboxed and limited to 128-bit vectors (FP32 SIMD/Relaxed SIMD), causing mantissa truncation
 * and operation reordering. This results in a systematic numerical drift (~0.004 score variance)
 * in DBNet probability outputs.
 *
 * To tolerate this without dropping valid text regions, we lower the threshold from the standard 0.6
 * (which matches PaddleOCR online API PP-OCRv6 `text_det_params.box_thresh`) to 0.5. This acts as a
 * software buffer zone (hysteresis) to absorb WebAssembly precision drift.
 */
const BOX_THRESHOLD = 0.5;

/**
 * Minimum number of binarized pixels for a blob to be considered at all. Cheap early-out
 * that runs before the more expensive hull/min-rect math.
 */
const MIN_BLOB_PIXELS = 15;

/** One detected text quadrilateral plus the DBNet confidence that produced it. */
export interface DetectedPolygon {
  /** 4-point min-area-rect in ORIGINAL image coordinates. */
  points: Point2D[];
  /** Cotrans box_score_fast: mean probability-map value inside the blob (0..1). */
  score: number;
}

/**
 * Replicates the DBPostProcess logic from PaddleOCR / CTD.
 */
export function extractRawMaskCanvas(
  platform: any,
  probMap: Float32Array,
  modelW: number,
  modelH: number,
  origW: number,
  origH: number,
  threshold: number = 0.3,
  resizeRatio?: number
): any {
  const modelCanvas = platform.createCanvas(modelW, modelH);
  const modelCtx = modelCanvas.getContext('2d');
  const imgData = modelCtx.createImageData(modelW, modelH);
  const data = imgData.data;

  for (let i = 0; i < modelW * modelH; i++) {
    const prob = probMap[i];
    const isText = prob >= threshold;
    const idx = i * 4;
    data[idx] = isText ? 255 : 0;
    data[idx + 1] = isText ? 255 : 0;
    data[idx + 2] = isText ? 255 : 0;
    data[idx + 3] = isText ? 255 : 0;
  }
  modelCtx.putImageData(imgData, 0, 0);

  const dilatedCanvas = platform.createCanvas(modelW, modelH);
  const dilatedCtx = dilatedCanvas.getContext('2d');
  dilatedCtx.fillStyle = '#000000';
  dilatedCtx.fillRect(0, 0, modelW, modelH);

  const dilateRadius = Math.max(6, Math.floor(Math.max(modelW, modelH) * 0.015));
  const radiusSq = dilateRadius * dilateRadius;

  for (let dy = -dilateRadius; dy <= dilateRadius; dy += 2) {
    for (let dx = -dilateRadius; dx <= dilateRadius; dx += 2) {
      if (dx * dx + dy * dy <= radiusSq) {
        dilatedCtx.drawImage(modelCanvas, dx, dy);
      }
    }
  }

  const ratio = resizeRatio ?? (modelW / origW);
  const resizeW = Math.min(modelW, Math.round(origW * ratio));
  const resizeH = Math.min(modelH, Math.round(origH * ratio));

  const origCanvas = platform.createCanvas(origW, origH);
  // This canvas is returned as `maskRawCanvas` and read back (getImageData) by the
  // inpaint engines. getContext attributes are sticky on the first call, so set
  // willReadFrequently here — otherwise the inpaint engines' own flag is a no-op.
  const origCtx = origCanvas.getContext('2d', { willReadFrequently: true });
  origCtx.imageSmoothingEnabled = false;
  origCtx.drawImage(dilatedCanvas, 0, 0, resizeW, resizeH, 0, 0, origW, origH);

  return origCanvas;
}

/**
 * Short side of a 4-point min-area-rect. 1:1 with the `sside` returned by Cotrans
 * `get_mini_boxes` (dbnet_utils.py), which is what `min_size` is compared against.
 *
 * @param rect - Min-area-rect corners in [tl, tr, br, bl] order.
 * @returns The length of the rectangle's shorter side, in the rect's own coordinate units.
 */
function minRectShortSide(rect: Point2D[]): number {
  if (rect.length < 4) return 0;
  const w = Math.hypot(rect[1].x - rect[0].x, rect[1].y - rect[0].y);
  const h = Math.hypot(rect[3].x - rect[0].x, rect[3].y - rect[0].y);
  return Math.min(w, h);
}

/**
 * 1:1 port of PaddleOCR `DBPostProcess.box_score_fast` (db_postprocess.py:189-204): the mean
 * probability-map value inside a candidate's min-area-rect.
 *
 * PaddleOCR builds the AABB of the 4-point min-box, allocates a mask, fills the rotated rect
 * via `cv2.fillPoly`, then takes `cv2.mean(bitmap[AABB], mask)`. Crucially the mask includes
 * background pixels sitting between text strokes inside the rect — those sub-threshold pixels
 * drag the mean DOWN, which is what makes `box_thresh=0.6` an effective noise filter. Our
 * previous implementation averaged only flood-fill pixels (all `>= thresh`), biasing the mean
 * UP and letting sparse-probability noise slip through the same threshold.
 *
 * Per AGENTS.md §8 this is the "Library -> Custom JS" case: `platform`/canvas isn't in scope
 * here, so we rasterize the convex quad via a point-in-polygon test instead of `fillPoly`.
 *
 * @param probMap - The raw DBNet probability map (model resolution, row-major).
 * @param width - Probability map width, used to index pixels.
 * @param minBox - The 4-point min-area-rect [tl, tr, br, bl] in model-space pixels.
 * @returns Mean probability over the filled min-rect, in 0..1.
 */
function boxScoreFast(probMap: Float32Array, width: number, minBox: Point2D[]): number {
  if (minBox.length < 3) return 0;

  // AABB of the min-box, clipped to the prob map bounds. Matches Paddle's
  // xmin/xmax/ymin/ymax with floor/ceil (db_postprocess.py:195-198).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of minBox) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.max(0, Math.ceil(maxX));
  maxY = Math.max(0, Math.ceil(maxY));

  let sum = 0;
  let count = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // Sample at pixel center (+0.5) so the boundary test is symmetric.
      if (pointInConvexQuad(x + 0.5, y + 0.5, minBox)) {
        sum += probMap[y * width + x];
        count++;
      }
    }
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * Point-in-convex-quad test via consistent cross-product sign. The quad must be in
 * consecutive (either CW or CCW) vertex order — `minAreaRect` returns [tl, tr, br, bl] which
 * is consecutive, so this works.
 *
 * @param px - Point x (pixel-center sampled, so +0.5).
 * @param py - Point y.
 * @param quad - Exactly 4 vertices in consecutive order.
 * @returns True if the point lies inside or on the boundary of the quad.
 */
function pointInConvexQuad(px: number, py: number, quad: Point2D[]): boolean {
  let prevSign = 0;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (cross === 0) continue;
    const sign = cross > 0 ? 1 : -1;
    if (prevSign === 0) prevSign = sign;
    else if (sign !== prevSign) return false;
  }
  return true;
}

/**
 * Extracts oriented text quadrilaterals from a raw DBNet probability map.
 *
 * Mirrors PaddleOCR `DBPostProcess.boxes_from_bitmap` (db_postprocess.py:109-158), which
 * rejects a candidate at three separate gates, in this exact order:
 *   1. get_mini_boxes + min-area-rect short side < min_size, BEFORE unclip expansion;
 *   2. box_score_fast (mean probability inside the FILLED min-rect) < box_thresh;
 *   3. get_mini_boxes + min-area-rect short side < min_size + 2, AFTER unclip expansion.
 * The unclip step expands the 4-point min-box (not the convex hull), matching Paddle exactly.
 * Survivors are rescaled from model resolution back to original image coordinates.
 *
 * @param probMap - Raw DBNet probability map at model resolution, row-major.
 * @param width - Probability map width.
 * @param height - Probability map height.
 * @param originalWidth - Original image width, for rescaling the output.
 * @param originalHeight - Original image height, for rescaling the output.
 * @param threshold - Binarization threshold deciding which pixels join a blob.
 * @param unclipRatio - Polygon dilation factor (Clipper offset), matching DBPostProcess.
 * @returns Accepted quadrilaterals in original image coordinates, each with its DBNet score.
 */
export function extractPolygons(
  probMap: Float32Array,
  width: number,
  height: number,
  originalWidth: number,
  originalHeight: number,
  threshold: number = 0.3,
  unclipRatio: number = 1.5,
  resizeRatio?: number
): DetectedPolygon[] {
  const binaryMap = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    binaryMap[i] = probMap[i] >= threshold ? 1 : 0;
  }

  const visited = new Uint8Array(width * height);
  const polygons: DetectedPolygon[] = [];
  let rejectedSmallPre = 0;
  let rejectedLowScore = 0;
  let rejectedSmallPost = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (binaryMap[idx] === 1 && visited[idx] === 0) {
        const blobPoints: Point2D[] = [];
        const queue: number[] = [idx];
        visited[idx] = 1;

        while (queue.length > 0) {
          const curr = queue.pop()!;
          const cy = Math.floor(curr / width);
          const cx = curr % width;
          blobPoints.push({ x: cx, y: cy });

          const neighbors = [
            curr - 1, curr + 1, curr - width, curr + width
          ];

          for (const nIdx of neighbors) {
            if (nIdx >= 0 && nIdx < width * height && binaryMap[nIdx] === 1 && visited[nIdx] === 0) {
              const nx = nIdx % width;
              const ny = Math.floor(nIdx / width);
              if (Math.abs(nx - cx) <= 1 && Math.abs(ny - cy) <= 1) {
                visited[nIdx] = 1;
                queue.push(nIdx);
              }
            }
          }
        }

        if (blobPoints.length < MIN_BLOB_PIXELS) continue;

        const hull = convexHull(blobPoints);
        if (hull.length < 3) continue;

        // Gate 1 (Paddle: get_mini_boxes + sside < min_size, before unclip) — drop hairline
        // slivers. The min-box is reused below for scoring AND unclipping, exactly as Paddle's
        // boxes_from_bitmap does (db_postprocess.py:132-143).
        const minBox = minAreaRect(hull);
        if (minRectShortSide(minBox) < MIN_BOX_SIDE) {
          rejectedSmallPre++;
          continue;
        }

        // Gate 2 (Paddle: box_score_fast on the min-box + box_thresh) — drop low-confidence
        // smears. Score is computed over the FILLED min-rect (includes background pixels between
        // strokes), matching Paddle's cv2.fillPoly mask — see boxScoreFast.
        const score = boxScoreFast(probMap, width, minBox);
        if (score < BOX_THRESHOLD) {
          rejectedLowScore++;
          continue;
        }

        // Unclip the 4-point min-box (NOT the convex hull), matching Paddle's
        // unclip(points=min-box). The hull has many more vertices and a larger perimeter, which
        // changes the offset distance (area*ratio/length) and produces a different expanded rect.
        const unclipped = unclipPolygon(minBox, unclipRatio);
        // Paddle rejects if pyclipper returned >1 path (db_postprocess.py:144-145); we treat the
        // same case as degenerate.
        if (unclipped.length < 3) continue;

        const minRect = minAreaRect(unclipped);

        // Gate 3 (Paddle: get_mini_boxes + sside < min_size + 2, after unclip) — the expansion
        // must have produced a box with real area, otherwise the candidate was degenerate.
        if (minRectShortSide(minRect) < MIN_BOX_SIDE + 2) {
          rejectedSmallPost++;
          continue;
        }

        // Map model space back to original image space. preprocessDetection resizes the page
        // isotropically by resizeRatio, then PADS up to a multiple of 32 with the image in the
        // top-left corner — so `width`/`height` here are the padded tensor dimensions, not the
        // resized image. Dividing by the padded dimensions (the old behaviour) both over-scales
        // and, because the two axes are padded by different amounts, skews the box anisotropically.
        // ppu-paddle-ocr's own convertToOriginalCoordinates uses `coord / resizeRatio`; match it.
        const scale = resizeRatio && resizeRatio > 0
          ? 1 / resizeRatio
          : originalWidth / width;

        const scaledRect = minRect.map(p => ({
          x: Math.max(0, Math.min(originalWidth, Math.round(p.x * scale))),
          y: Math.max(0, Math.min(originalHeight, Math.round(p.y * scale)))
        }));

        if (scaledRect[0].x < 20 && scaledRect[0].y > 1000) {
          // Dump stats of the empty bottom-left box
          let maxVal = -1, minVal = 2;
          for (const p of blobPoints) {
            const val = probMap[p.y * width + p.x];
            if (val > maxVal) maxVal = val;
            if (val < minVal) minVal = val;
          }
          console.log(`[extractPolygons] DEBUG Empty box x0=${scaledRect[0].x}, y0=${scaledRect[0].y}: size=${blobPoints.length}, score=${score.toFixed(4)}, minProb=${minVal.toFixed(4)}, maxProb=${maxVal.toFixed(4)}`);
        } else {
          console.log(`[extractPolygons] Kept box at x0=${scaledRect[0].x}, y0=${scaledRect[0].y} score=${score.toFixed(4)}`);
        }

        polygons.push({ points: scaledRect, score });
      }
    }
  }

  console.log(
    `[extractPolygons] Kept ${polygons.length} boxes. Rejected: ${rejectedSmallPre} tiny (pre-unclip), ` +
    `${rejectedLowScore} below box_threshold ${BOX_THRESHOLD}, ${rejectedSmallPost} tiny (post-unclip).`
  );

  return polygons;
}

function convexHull(points: Point2D[]): Point2D[] {
  points.sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);

  const lower: Point2D[] = [];
  for (const p of points) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function crossProduct(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function unclipPolygon(hull: Point2D[], unclipRatio: number): Point2D[] {
  const Clipper = ClipperLib;
  const scaledHull = hull.map(p => ({ X: Math.round(p.x * 100), Y: Math.round(p.y * 100) }));
  
  let area = 0;
  let len = 0;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += hull[i].x * hull[j].y - hull[j].x * hull[i].y;
    const dx = hull[j].x - hull[i].x;
    const dy = hull[j].y - hull[i].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  area = Math.abs(area / 2);

  if (len === 0) return hull;

  const distance = (area * unclipRatio) / len;
  const scaledDistance = distance * 100;

  const co = new Clipper.ClipperOffset();
  const solution: any[] = [];

  if (!Clipper.Clipper.Orientation(scaledHull)) {
    scaledHull.reverse();
  }

  co.AddPath(scaledHull, Clipper.JoinType.jtRound, Clipper.EndType.etClosedPolygon);
  co.Execute(solution, scaledDistance);

  if (!solution || solution.length === 0) return hull;

  const resultPath = solution[0];
  const unclipped: Point2D[] = [];
  for (let i = 0; i < resultPath.length; i++) {
    const pt = resultPath[i];
    unclipped.push({ x: pt.X / 100, y: pt.Y / 100 });
  }

  return unclipped;
}

/**
 * Orders 4 rectangle corners deterministically as [topLeft, topRight, bottomRight, bottomLeft],
 * 1:1 with Baidu's `get_mini_boxes` (PaddleOCR predict_det.py).
 *
 * This matters far beyond tidiness. `PaddleOcrEngine.cropAndWarp` derives the crop's rotation
 * from the first edge, `theta = atan2(p1.y - p0.y, p1.x - p0.x)`. Rotating-calipers output
 * orders corners in the frame of whichever hull edge minimised the area, which may be the
 * short side rather than the long one — so theta lands 90 degrees out on an arbitrary subset
 * of boxes and the recogniser reads sideways text. Sorting into image space removes that
 * ambiguity.
 *
 * @param rect - Exactly 4 rectangle corners in any order.
 * @returns The same corners ordered [tl, tr, br, bl]; the input unchanged if not 4 points.
 */
function orderRectCorners(rect: Point2D[]): Point2D[] {
  if (rect.length !== 4) return rect;

  // 1. Sort by x to separate the left pair from the right pair.
  const sortedByX = [...rect].sort((a, b) => a.x - b.x);
  const leftPts = [sortedByX[0], sortedByX[1]];
  const rightPts = [sortedByX[2], sortedByX[3]];

  // 2. Within each pair, smaller y is the top corner.
  leftPts.sort((a, b) => a.y - b.y);
  rightPts.sort((a, b) => a.y - b.y);

  const [topLeft, bottomLeft] = leftPts;
  const [topRight, bottomRight] = rightPts;
  return [topLeft, topRight, bottomRight, bottomLeft];
}

function minAreaRect(points: Point2D[]): Point2D[] {
  let minArea = Infinity;
  let bestRect: Point2D[] = [];

  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];

    const edgeX = p2.x - p1.x;
    const edgeY = p2.y - p1.y;
    const len = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
    if (len === 0) continue;

    const ux = edgeX / len;
    const uy = edgeY / len;
    const vx = -uy;
    const vy = ux;

    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;

    for (const p of points) {
      const u = p.x * ux + p.y * uy;
      const v = p.x * vx + p.y * vy;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const area = (maxU - minU) * (maxV - minV);
    if (area < minArea) {
      minArea = area;
      bestRect = [
        { x: minU * ux + minV * vx, y: minU * uy + minV * vy },
        { x: maxU * ux + minV * vx, y: maxU * uy + minV * vy },
        { x: maxU * ux + maxV * vx, y: maxU * uy + maxV * vy },
        { x: minU * ux + maxV * vx, y: minU * uy + maxV * vy }
      ];
    }
  }

  return bestRect.length === 4 ? orderRectCorners(bestRect) : hullBoundingBox(points);
}

function hullBoundingBox(points: Point2D[]): Point2D[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY }
  ];
}
