import type { IOcrEngine, OcrResult } from '../engines/ocr/BaseOcrEngine';
import { PaddleOcrEngine } from '../engines/ocr/PaddleOcrEngine';
import type { Point2D, BoundingBox } from '../../shared/utils/geometry';
import { calculateBoundingBox, computeConvexHull, polygonDistance, calculateRotationAngle, splitTextRegion, Quadrilateral } from '../../shared/utils/geometry';

export class OcrManager {
  private engine: IOcrEngine | null = null;
  // Stores the in-flight initialization promise so that concurrent callers
  // all await the same work rather than spinning in a polling loop.
  private initPromise: Promise<IOcrEngine> | null = null;

  /**
   * Returns the initialized OCR engine, creating and initializing it on first call.
   * Uses the singleton promise pattern: if initialization is already in progress,
   * concurrent callers await the same promise instead of busy-waiting with setTimeout.
   *
   * @returns A promise that resolves to the loaded OCR engine instance.
   */
  async getOrLoadEngine(): Promise<IOcrEngine> {
    if (this.engine) return this.engine;

    if (!this.initPromise) {
      this.initPromise = (async () => {
        console.log('[OcrManager] Instantiating PaddleOcrEngine...');
        const engine = new PaddleOcrEngine();
        await engine.init();
        this.engine = engine;
        return engine;
      })();
    }

    return this.initPromise;
  }

  /**
   * 👱‍♀️ ponytail: Ported 1:1 from Cotrans quadrilateral_can_merge_region.
   */
  private canMergeQuadrilaterals(
    p1: Point2D[], p2: Point2D[], b1: BoundingBox, b2: BoundingBox,
    ratio = 1.9, discard_connection_gap = 2, 
    char_gap_tolerance = 0.6, char_gap_tolerance2 = 1.5, 
    font_size_ratio_tol = 1.5, aspect_ratio_tol = 2
  ): boolean {
    const fs1 = Math.min(b1.width, b1.height);
    const fs2 = Math.min(b2.width, b2.height);
    const charSize = Math.min(fs1, fs2);
    
    const x1 = b1.x, y1 = b1.y, w1 = b1.width, h1 = b1.height;
    const x2 = b2.x, y2 = b2.y, w2 = b2.width, h2 = b2.height;

    const dist = polygonDistance(p1, p2);
    
    if (dist > discard_connection_gap * charSize) return false;
    if (Math.max(fs1, fs2) / charSize > font_size_ratio_tol) return false;
    
    const ar1 = w1 / h1;
    const ar2 = w2 / h2;
    if (ar1 > aspect_ratio_tol && ar2 < 1 / aspect_ratio_tol) return false;
    if (ar2 > aspect_ratio_tol && ar1 < 1 / aspect_ratio_tol) return false;

    // Both are Axis-Aligned (since paddle OCR boxes are almost always axis-aligned)
    if (dist < charSize * char_gap_tolerance) {
      if (Math.abs(x1 + w1 / 2 - (x2 + w2 / 2)) < char_gap_tolerance2) return true;
      if (w1 > h1 * ratio && h2 > w2 * ratio) return false;
      if (w2 > h2 * ratio && h1 > w1 * ratio) return false;
      if (w1 > h1 * ratio || w2 > h2 * ratio) {
        // Horizontal
        return Math.abs(x1 - x2) < charSize * char_gap_tolerance2 || Math.abs(x1 + w1 - (x2 + w2)) < charSize * char_gap_tolerance2;
      } else if (h1 > w1 * ratio || h2 > w2 * ratio) {
        // Vertical
        return Math.abs(y1 - y2) < charSize * char_gap_tolerance2 || Math.abs(y1 + h1 - (y2 + h2)) < charSize * char_gap_tolerance2;
      }
      return false;
    }
    
    // Fallback for N-point convex hulls or non-axis-aligned
    // Cotrans falls back to checking poly_distance again
    const angle1 = calculateRotationAngle(p1);
    const angle2 = calculateRotationAngle(p2);
    if (Math.abs(angle1 - angle2) < 15 * Math.PI / 180) {
      if (dist > charSize * char_gap_tolerance2) return false;
      if (Math.abs(fs1 - fs2) / charSize > 0.25) return false;
      return true;
    }
    
    return false;
  }

  /**
   * Evaluates proximity and geometry to group multiple text lines into single cohesive blocks.
   * Based on the strict `quadrilateral_can_merge_region` and direction voting from Cotrans.
   */
  private mergeTextBlocks(result: OcrResult): OcrResult {
    const { texts, polygons = [], scores = [] } = result;
    if (texts.length <= 1 || polygons.length === 0) return result;

    // Build Quadrilateral objects for each detection
    const quads = polygons.map((poly, i) => new Quadrilateral(poly, texts[i], scores[i] || 1.0));

    const mergedPolygons: Point2D[][] = [];
    const mergedTexts: string[] = [];
    const mergedScores: number[] = [];
    const mergedBoxes: { x: number, y: number, w: number, h: number }[] = [];

    const boxes = quads.map(q => q.aabb);
    
    // Union-Find data structure
    const parent = Array.from({ length: texts.length }, (_, i) => i);
    const find = (i: number): number => {
      if (parent[i] === i) return i;
      return parent[i] = find(parent[i]);
    };
    const union = (i: number, j: number) => {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) {
        parent[rootI] = rootJ;
      }
    };

    // Pairwise distance checking using Quadrilateral properties
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const shouldMerge = this.canMergeQuadrilaterals(
          quads[i].pts, quads[j].pts, boxes[i], boxes[j],
          1.9, 2.0, 1.0, 3.0, 2.0, 1.3
        );
        if (shouldMerge) {
          union(i, j);
        }
      }
    }

    // Group by connected components
    const groups = new Map<number, number[]>();
    for (let i = 0; i < texts.length; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(i);
    }

    // Postprocess - further split each region using Kruskal MST
    const finalGroups: number[][] = [];
    for (const groupIndices of groups.values()) {
      const splitSets = splitTextRegion(polygons, boxes, new Set(groupIndices));
      for (const set of splitSets) {
        finalGroups.push(Array.from(set));
      }
    }

    // Process each split group with Cotrans direction voting
    for (const groupIndices of finalGroups) {
      const groupQuads = groupIndices.map(idx => quads[idx]);
      
      // Direction voting (utils/generic.py:157)
      const vCount = groupQuads.filter(q => q.direction === 'v').length;
      const hCount = groupQuads.filter(q => q.direction === 'h').length;
      const isVerticalGroup = vCount >= hCount;

      if (isVerticalGroup) {
        // Vertical Japanese text lines: sort right-to-left, join without spaces
        groupIndices.sort((a, b) => boxes[b].centerX - boxes[a].centerX);
      } else {
        // Horizontal text lines: sort top-to-bottom, join with spaces
        groupIndices.sort((a, b) => boxes[a].centerY - boxes[b].centerY);
      }

      const joinDelimiter = isVerticalGroup ? '' : ' ';
      const groupText = groupIndices.map(idx => texts[idx]).join(joinDelimiter);
      const groupScore = groupIndices.reduce((sum, idx) => sum + (scores[idx] || 1), 0) / groupIndices.length;

      // Retain child line polygons directly
      for (const idx of groupIndices) {
        mergedTexts.push(texts[idx]);
        mergedScores.push(scores[idx] || groupScore);
        mergedPolygons.push(polygons[idx]);
        const box = boxes[idx];
        mergedBoxes.push({ x: box.x, y: box.y, w: box.width, h: box.height });
      }
    }
    
    return { texts: mergedTexts, polygons: mergedPolygons, scores: mergedScores, boxes: mergedBoxes };
  }

  /**
   * Process the image buffer to extract text and bounding boxes.
   *
   * @param imageBuffer - The raw ArrayBuffer of the image.
   * @returns A promise that resolves to the standardized OCR result.
   */
  async processImage(imageBuffer: ArrayBuffer): Promise<OcrResult> {
    const engine = await this.getOrLoadEngine();
    const rawResult = await engine.recognize(imageBuffer);
    return this.mergeTextBlocks(rawResult);
  }

  /**
   * Unloads the engine from memory to free up VRAM/RAM.
   *
   * @returns A promise that resolves when cleanup is complete.
   */
  async cleanup(): Promise<void> {
    if (this.engine) {
      await this.engine.destroy();
      this.engine = null;
      this.initPromise = null;
    }
  }
}
