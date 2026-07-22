import type { IOcrEngine, OcrResult } from '../engines/ocr/BaseOcrEngine';
import { PaddleOcrEngine } from '../engines/ocr/PaddleOcrEngine';
import { type Point2D, type BoundingBox, Quadrilateral, calculateBoundingBox, computeMinAreaRect, polygonDistance, calculateRotationAngle, splitTextRegion } from '../../shared/utils/geometry';

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
   * [ARCHITECTURE NOTE]: This logic is strictly decoupled. If a "Combine Text Bubbles" toggle is requested in the future, simply bypass calling this function to instantly revert to raw, uncombined text boxes.
   * Based on the strict `quadrilateral_can_merge_region` logic from Cotrans.
   * Uses convex hull to generate accurate bounding polygons for merged blocks,
   * and concatenates text right-to-left.
   */
  private mergeTextBlocks(result: OcrResult): OcrResult {
    // Merge algorithm entry point
    const { texts, polygons = [], scores = [] } = result;
    if (texts.length <= 1 || polygons.length === 0) return result;

    const mergedPolygons: any[] = [];
    const mergedTexts: string[] = [];
    const mergedScores: number[] = [];
    const mergedBoxes: { x: number, y: number, w: number, h: number }[] = [];

    // Pre-calculate bounding boxes for fast distance checks
    const boxes = polygons.map(p => calculateBoundingBox(p));
    
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

    // Pairwise distance checking
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        // We use Cotrans' char_gap_tolerance=1, char_gap_tolerance2=3 for manga translation
        // (these values are used in manga_translator/textline_merge/__init__.py)
        const shouldMerge = this.canMergeQuadrilaterals(
          polygons[i], polygons[j], boxes[i], boxes[j],
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

    // Step 2: Postprocess - further split each region using Cotrans Kruskal MST math
    const finalGroups: number[][] = [];
    for (const groupIndices of groups.values()) {
      const splitSets = splitTextRegion(polygons, boxes, new Set(groupIndices));
      for (const set of splitSets) {
        finalGroups.push(Array.from(set));
      }
    }

    // Process each split group
    for (const groupIndices of finalGroups) {
      // Determine majority direction using Cotrans Quadrilateral objects
      const quads = groupIndices.map(idx => new Quadrilateral(polygons[idx]));
      const vCount = quads.filter(q => q.direction === 'v').length;
      const hCount = quads.filter(q => q.direction === 'h').length;
      const isVerticalGroup = vCount >= hCount;

      if (isVerticalGroup) {
        // Vertical manga: sort right-to-left (X descending)
        groupIndices.sort((a, b) => quads[groupIndices.indexOf(b)].centroid.x - quads[groupIndices.indexOf(a)].centroid.x);
      } else {
        // Horizontal text: sort top-to-bottom (Y ascending)
        groupIndices.sort((a, b) => quads[groupIndices.indexOf(a)].centroid.y - quads[groupIndices.indexOf(b)].centroid.y);
      }
      
      // 1:1 Cotrans CJK aware text concatenation (textblock.py)
      let groupText = '';
      if (groupIndices.length > 0) {
        groupText = texts[groupIndices[0]] || '';
        for (let k = 1; k < groupIndices.length; k++) {
          const txt = texts[groupIndices[k]] || '';
          const lastChar = groupText.slice(-1);
          const firstChar = txt.slice(0, 1);
          const isLastCJK = lastChar >= '\u3000' && lastChar <= '\u9fff';
          const isFirstCJK = firstChar >= '\u3000' && firstChar <= '\u9fff';

          if (isLastCJK || isFirstCJK) {
            groupText += txt;
          } else {
            groupText += ' ' + txt;
          }
        }
      }

      console.log(`[OcrManager] Merged Speech Bubble: "${groupText}" (${isVerticalGroup ? 'v' : 'h'}) from ${groupIndices.length} lines`);
      const groupScore = groupIndices.reduce((sum, idx) => sum + (scores[idx] || 1), 0) / groupIndices.length;
      
      // 1:1 Cotrans average angle calculation and threshold snapping (textline_merge/__init__.py)
      const groupPolygons = groupIndices.map(idx => polygons[idx]);
      const meanAngleRad = groupPolygons.reduce((sum, poly) => sum + calculateRotationAngle(poly), 0) / groupPolygons.length;
      let angleDeg = (meanAngleRad * 180) / Math.PI;
      if (Math.abs(angleDeg) < 3) {
        angleDeg = 0;
      }

      // 1:1 Cotrans min_rect computation (textblock.py min_rect property - ALWAYS 4 points)
      const minRect = computeMinAreaRect(groupPolygons, angleDeg);
      const minBox = calculateBoundingBox(minRect);

      mergedTexts.push(groupText);
      mergedScores.push(groupScore);
      mergedPolygons.push(minRect);
      mergedBoxes.push({ x: minBox.x, y: minBox.y, w: minBox.width, h: minBox.height });
    }
    
    // rawPolygons retains the raw unmerged 4-point line quadrilaterals for inpainting
    return { texts: mergedTexts, polygons: mergedPolygons, scores: mergedScores, boxes: mergedBoxes, rawPolygons: polygons, maskRawCanvas: result.maskRawCanvas };
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
