import type { IOcrEngine, OcrResult } from '../engines/ocr/BaseOcrEngine';
import { PaddleOcrEngine } from '../engines/ocr/PaddleOcrEngine';
import { resolveOcrTier } from '../engines/ocr/ocrRegistry';
import { Quadrilateral, Graph, calculateBoundingBox, computeMinAreaRect, polygonArea, quadrilateralCanMergeRegion, splitTextRegion } from '../../shared/utils/geometry';
import {
  isScanlatorWatermark,
  isThoughtBubbleTailOrnament,
  isStandaloneDigitOrOrnamentNoise,
} from '../../shared/utils/textCleaning';

/**
 * 1:1 Cotrans is_valuable_char check (generic2.py).
 * Checks if a character is not punctuation, whitespace, digit, or control character.
 */
export function isValuableChar(ch: string): boolean {
  if (!ch) return false;
  if (/[\s\d]/.test(ch)) return false;
  if (/[\u0000-\u001F\u007F-\u009F]/.test(ch)) return false;
  if (/\p{P}/u.test(ch) || /[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~]/.test(ch)) return false;
  return true;
}

/**
 * 1:1 Cotrans is_valuable_text check (generic2.py).
 * Returns true if text contains at least one valuable character.
 */
export function isValuableText(text: string): boolean {
  if (!text) return false;
  for (const ch of text) {
    if (isValuableChar(ch)) return true;
  }
  return false;
}

/**
 * Available OCR tiers. Defaults to 'v6-small'.
 * Dynamically maps to any preset registered in ocrRegistry.
 */
export type OcrTier = string;

export class OcrManager {
  private engines: Map<string, IOcrEngine> = new Map();
  // Stores the in-flight initialization promise so that concurrent callers
  // all await the same work rather than spinning in a polling loop.
  private initPromises: Map<string, Promise<IOcrEngine>> = new Map();

  /**
   * Returns the initialized OCR engine, creating and initializing it on first call.
   * Uses the singleton promise pattern: if initialization is already in progress,
   * concurrent callers await the same promise instead of busy-waiting with setTimeout.
   *
   * @returns A promise that resolves to the loaded OCR engine instance.
   */
  async getOrLoadEngine(tier: OcrTier = 'v6-small'): Promise<IOcrEngine> {
    const canonicalTier = resolveOcrTier(tier);
    if (this.engines.has(canonicalTier)) return this.engines.get(canonicalTier)!;

    if (!this.initPromises.has(canonicalTier)) {
      const promise = (async () => {
        console.log(`[OcrManager] Instantiating OCR Engine for tier: ${canonicalTier}...`);
        if (canonicalTier === 'none') {
          throw new Error('[OcrManager] None OCR engine is not yet implemented.');
        }
        const engine = new PaddleOcrEngine(canonicalTier);
        await engine.init();
        this.engines.set(canonicalTier, engine);
        return engine;
      })();
      this.initPromises.set(canonicalTier, promise);
    }

    return this.initPromises.get(canonicalTier)!;
  }

  /**
   * 1:1 port of Cotrans ocr/common.py `_generate_text_direction`.
   * Groups text lines into coarse components (quadrilateral_can_merge_region with
   * aspect_ratio_tol=1) and assigns every line the component's majority reading
   * direction. This assignedDirection drives Quadrilateral.distance() during the
   * MST split, exactly like Cotrans sets assigned_direction during the OCR stage.
   *
   * @param quads - All valid text line quadrilaterals (mutated in place).
   */
  private assignTextDirections(quads: Quadrilateral[]): void {
    const graph = new Graph();
    for (let i = 0; i < quads.length; i++) graph.addNode(i);
    for (let i = 0; i < quads.length; i++) {
      for (let j = i + 1; j < quads.length; j++) {
        // Cotrans call: quadrilateral_can_merge_region(ubox, vbox, aspect_ratio_tol=1)
        if (quadrilateralCanMergeRegion(quads[i], quads[j], 1.9, 2, 0.6, 1.5, 1.5, 1)) {
          graph.addEdge(i, j);
        }
      }
    }

    for (const component of graph.connectedComponents()) {
      const nodes = Array.from(component);
      // Majority vote (Counter.most_common(1): highest count, first-seen wins ties)
      const counts = new Map<'h' | 'v', number>();
      for (const n of nodes) {
        const dir = quads[n].direction;
        counts.set(dir, (counts.get(dir) || 0) + 1);
      }
      let majorityDir: 'h' | 'v' = quads[nodes[0]].direction;
      let bestCount = -1;
      for (const n of nodes) {
        const dir = quads[n].direction;
        const c = counts.get(dir)!;
        if (c > bestCount) {
          bestCount = c;
          majorityDir = dir;
        }
      }
      for (const n of nodes) {
        quads[n].assignedDirection = majorityDir;
      }
    }
  }

  /**
   * 1:1 port of the Cotrans textline_merge majority direction vote, including the
   * top-2 tie-break that picks the direction of the most extreme aspect-ratio line.
   *
   * @param quads - The text lines of one merged region.
   * @returns The region's majority reading direction.
   */
  private majorityDirection(quads: Quadrilateral[]): 'h' | 'v' {
    const counts = new Map<'h' | 'v', number>();
    for (const q of quads) {
      counts.set(q.direction, (counts.get(q.direction) || 0) + 1);
    }

    if (counts.size === 1) {
      return quads[0].direction;
    }

    const hCount = counts.get('h') || 0;
    const vCount = counts.get('v') || 0;
    if (hCount === vCount) {
      // Tie: use the direction of the line with the most extreme aspect ratio
      let maxAspectRatio = -100;
      let majorityDir: 'h' | 'v' = quads[0].direction;
      for (const q of quads) {
        if (q.aspect_ratio > maxAspectRatio) {
          maxAspectRatio = q.aspect_ratio;
          majorityDir = q.direction;
        }
        if (1.0 / q.aspect_ratio > maxAspectRatio) {
          maxAspectRatio = 1.0 / q.aspect_ratio;
          majorityDir = q.direction;
        }
      }
      return majorityDir;
    }
    return hCount > vCount ? 'h' : 'v';
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
    const rawTexts = [...result.texts];
    const rawPolygons = [...(result.polygons || [])];
    const rawScores = [...(result.scores || [])];
    if (rawTexts.length <= 1 || rawPolygons.length === 0) return { ...result, rawPolygons };

    // XianScan-style orphan punctuation recovery. Cotrans deliberately drops pure punctuation
    // as noise, but vertical manga often detects a terminal `!`/`?` in its own small quad.
    const purePunctuation = /^[！!？?…~〜ー─―.]+$/;
    const claimedPunctuation = new Set<number>();
    for (let punctuationIndex = 0; punctuationIndex < rawTexts.length; punctuationIndex++) {
      const punctuation = rawTexts[punctuationIndex]?.trim();
      const punctuationPolygon = rawPolygons[punctuationIndex];
      if (!punctuation || !purePunctuation.test(punctuation) || !punctuationPolygon || punctuationPolygon.length < 3) continue;

      const punctuationBox = calculateBoundingBox(punctuationPolygon);
      let closestIndex = -1;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (let lineIndex = 0; lineIndex < rawTexts.length; lineIndex++) {
        if (lineIndex === punctuationIndex || !isValuableText(rawTexts[lineIndex] || '')) continue;
        const linePolygon = rawPolygons[lineIndex];
        if (!linePolygon || linePolygon.length < 3) continue;
        const lineBox = calculateBoundingBox(linePolygon);
        const horizontalGap = Math.max(lineBox.x - (punctuationBox.x + punctuationBox.width), punctuationBox.x - (lineBox.x + lineBox.width), 0);
        const verticalGap = Math.max(lineBox.y - (punctuationBox.y + punctuationBox.height), punctuationBox.y - (lineBox.y + lineBox.height), 0);
        const characterSize = Math.max(8, Math.min(lineBox.width, lineBox.height));
        const distance = Math.hypot(horizontalGap, verticalGap);
        if (distance <= characterSize * 1.5 && distance < closestDistance) {
          closestIndex = lineIndex;
          closestDistance = distance;
        }
      }

      if (closestIndex >= 0) {
        const lineBox = calculateBoundingBox(rawPolygons[closestIndex]);
        const append = punctuationBox.y >= lineBox.y || punctuationBox.x >= lineBox.x;
        rawTexts[closestIndex] = append
          ? `${rawTexts[closestIndex]}${punctuation}`
          : `${punctuation}${rawTexts[closestIndex]}`;
        claimedPunctuation.add(punctuationIndex);
        console.log(`[OcrManager] Attached orphan punctuation "${punctuation}" to "${rawTexts[closestIndex]}"`);
      }
    }

    // Stage 1: Cotrans Noise Filtering (area > 16, non-empty text, and isValuableText - manga_translator.py)
    const validIndices: number[] = [];
    for (let i = 0; i < rawTexts.length; i++) {
      const poly = rawPolygons[i];
      const txt = rawTexts[i];
      if (!poly || poly.length < 3) continue;
      if (!txt || !txt.trim()) continue;
      if (claimedPunctuation.has(i)) continue;

      if (!isValuableText(txt)) {
        console.log(`[OcrManager] Filtered out non-valuable noise line "${txt}"`);
        continue;
      }

      // XianScan noise rule: standalone 1-2 char Latin/digit noise (e.g. "er", "u", "N") on
      // speedlines and clothing folds with low score (< 0.65) is background artifact.
      const trimmedTxt = txt.trim();
      const isShortLatinNoise = trimmedTxt.length <= 2 
        && /^[a-zA-Z0-9]+$/.test(trimmedTxt) 
        && (rawScores[i] || 0) < 0.65;
      if (isShortLatinNoise) {
        console.log(`[OcrManager] Filtered out short Latin noise line "${trimmedTxt}" (score=${rawScores[i]})`);
        continue;
      }

      // XianScan text_clean ports: scanlator watermark, thought-bubble tail, digit ornaments
      if (isScanlatorWatermark(trimmedTxt)) {
        console.log(`[OcrManager] Filtered out scanlator watermark "${trimmedTxt}"`);
        continue;
      }
      if (isThoughtBubbleTailOrnament(trimmedTxt)) {
        console.log(`[OcrManager] Filtered out thought-bubble tail ornament "${trimmedTxt}"`);
        continue;
      }
      if (isStandaloneDigitOrOrnamentNoise(trimmedTxt)) {
        console.log(`[OcrManager] Filtered out ornament/digit noise "${trimmedTxt}"`);
        continue;
      }

      const area = polygonArea(poly);
      if (area < 16) continue; // Cotrans area filter (area > 16)

      // 1:1 Cotrans Furigana filter: filter out tiny reading-aid lines running parallel to main kanji lines (fs < 0.45 * main_fs)
      const b1 = calculateBoundingBox(poly);
      const fs1 = Math.min(b1.width, b1.height);
      let isFurigana = false;

      for (let j = 0; j < rawTexts.length; j++) {
        if (i === j) continue;

        // 1:1 Cotrans Furigana definition: Furigana consists strictly of Kana reading aids (Hiragana/Katakana \u3040-\u30ff)
        const isKanaOnly = (str: string) => /^[\u3040-\u30ff\s\.\-‥]+$/.test(str.trim());
        const hasKanji = (str: string) => /[\u4e00-\u9faf]/.test(str);

        // If line i contains Kanji (full sentence), it is NEVER Furigana
        if (hasKanji(txt) || !isKanaOnly(txt)) continue;

        const poly2 = rawPolygons[j];
        if (!poly2 || poly2.length < 3) continue;
        const b2 = calculateBoundingBox(poly2);
        const fs2 = Math.min(b2.width, b2.height);

        // If main CJK line j is significantly larger than CJK line i (fs1 < 0.45 * fs2) and runs parallel right next to it
        if (fs1 < 0.45 * fs2) {
          const isBothV = b1.height > b1.width * 1.2 && b2.height > b2.width * 1.2;
          const isBothH = b1.width > b1.height * 1.2 && b2.width > b2.height * 1.2;
          
          if (isBothV) {
            // Parallel vertical lines: Furigana runs side-by-side horizontally (small X gap)
            const xGap = Math.abs(b1.x - b2.x);
            const yOverlap = Math.max(0, Math.min(b1.y + b1.height, b2.y + b2.height) - Math.max(b1.y, b2.y));
            if (xGap < fs2 * 1.5 && yOverlap > fs1 * 0.5) {
              isFurigana = true;
              console.log(`[OcrManager] Filtered out vertical Furigana line "${txt}" (fs=${fs1} vs main fs=${fs2})`);
              break;
            }
          } else if (isBothH) {
            // Parallel horizontal lines: Furigana runs above/below vertically (small Y gap)
            const yGap = Math.abs(b1.y - b2.y);
            const xOverlap = Math.max(0, Math.min(b1.x + b1.width, b2.x + b2.width) - Math.max(b1.x, b2.x));
            if (yGap < fs2 * 1.5 && xOverlap > fs1 * 0.5) {
              isFurigana = true;
              console.log(`[OcrManager] Filtered out horizontal Furigana line "${txt}" (fs=${fs1} vs main fs=${fs2})`);
              break;
            }
          }
        }
      }

      if (isFurigana) continue;

      validIndices.push(i);
    }

    const filteredTexts = validIndices.map(i => rawTexts[i]);
    const filteredPolygons = validIndices.map(i => rawPolygons[i]);
    const filteredScores = validIndices.map(i => rawScores[i]);

    // PaddleOCR can report a complete line plus a nested substring slice, or two identical
    // quads for one physical glyph run. Drop the weaker duplicate before Cotrans MST.
    // Handles both vertical columns (substring slices) and horizontal rows (partial lines).
    const duplicateIndices = new Set<number>();
    for (let i = 0; i < filteredTexts.length; i++) {
      const textA = filteredTexts[i].trim();
      const scoreA = filteredScores[i] || 0;
      const boxA = calculateBoundingBox(filteredPolygons[i]);
      for (let j = i + 1; j < filteredTexts.length; j++) {
        const textB = filteredTexts[j].trim();
        const scoreB = filteredScores[j] || 0;
        const boxB = calculateBoundingBox(filteredPolygons[j]);

        // Geometric containment: intersection over the SMALLER box.
        const interW = Math.max(0, Math.min(boxA.x + boxA.width, boxB.x + boxB.width) - Math.max(boxA.x, boxB.x));
        const interH = Math.max(0, Math.min(boxA.y + boxA.height, boxB.y + boxB.height) - Math.max(boxA.y, boxB.y));
        const interArea = interW * interH;
        if (interArea <= 0) continue;
        const areaA = Math.max(1, boxA.width * boxA.height);
        const areaB = Math.max(1, boxB.width * boxB.height);
        const coversSmaller = interArea / Math.min(areaA, areaB);
        if (coversSmaller < 0.5) continue;

        // Text relationship: exact duplicate, or one is a substring slice of the other.
        const aContainsB = textA.length > textB.length && textA.includes(textB);
        const bContainsA = textB.length > textA.length && textB.includes(textA);
        const identical = textA === textB;
        if (!identical && !aContainsB && !bContainsA) continue;

        // Keep the longer text (the nested slice is its partial read); on identical
        // content keep the higher OCR confidence. Confidence never beats length —
        // a high-confidence slice is still missing glyphs the longer line captured.
        if (aContainsB) {
          duplicateIndices.add(j);
        } else if (bContainsA) {
          duplicateIndices.add(i);
        } else {
          duplicateIndices.add(scoreA >= scoreB ? j : i);
        }
      }
    }

    const texts = filteredTexts.filter((_, index) => !duplicateIndices.has(index));
    const polygons = filteredPolygons.filter((_, index) => !duplicateIndices.has(index));
    const scores = filteredScores.filter((_, index) => !duplicateIndices.has(index));

    if (texts.length === 0) {
      // Nothing to translate, but inpainting still needs the surviving erase polygons:
      // all noise-filtered lines (pre-dedup — dropped duplicates still have ink to erase)
      // plus orphan punctuation merged into neighbors.
      const emptyMaskPolygons = [...filteredPolygons];
      for (const idx of claimedPunctuation) {
        emptyMaskPolygons.push(rawPolygons[idx]);
      }
      return {
        ...result,
        texts: [],
        polygons: [],
        scores: [],
        boxes: [],
        directions: [],
        fontSizes: [],
        angles: [],
        lineCounts: [],
        rawPolygons: emptyMaskPolygons,
      };
    }

    const mergedPolygons: any[] = [];
    const mergedTexts: string[] = [];
    const mergedScores: number[] = [];
    const mergedBoxes: { x: number, y: number, w: number, h: number }[] = [];
    const mergedDirections: ('h' | 'v')[] = [];
    const mergedFontSizes: number[] = [];
    const mergedAngles: number[] = [];
    const mergedLineCounts: number[] = [];

    // Build Cotrans Quadrilateral objects once (sorts points, derives direction/font_size)
    const quads = polygons.map(p => new Quadrilateral(p));

    // Stage 1.5: assign per-line reading direction (Cotrans _generate_text_direction)
    this.assignTextDirections(quads);

    // Step 1: divide into text region candidates (textline_merge/__init__.py merge graph).
    // Cotrans call: quadrilateral_can_merge_region(ubox, vbox, aspect_ratio_tol=1.3,
    // font_size_ratio_tol=2, char_gap_tolerance=1, char_gap_tolerance2=3)
    const mergeGraph = new Graph();
    for (let i = 0; i < quads.length; i++) mergeGraph.addNode(i);
    for (let i = 0; i < quads.length; i++) {
      for (let j = i + 1; j < quads.length; j++) {
        if (quadrilateralCanMergeRegion(quads[i], quads[j], 1.9, 2, 1, 3, 2, 1.3)) {
          mergeGraph.addEdge(i, j);
        }
      }
    }

    // Step 2: postprocess - further split each region using Cotrans Kruskal MST statistics
    const finalGroups: number[][] = [];
    for (const component of mergeGraph.connectedComponents()) {
      const splitSets = splitTextRegion(quads, component);
      for (const set of splitSets) {
        finalGroups.push(Array.from(set));
      }
    }

    // Step 3: emit one merged region per final group
    for (const groupIndices of finalGroups) {
      const groupQuads = groupIndices.map(idx => quads[idx]);

      // Majority direction vote with Cotrans top-2 tie-break
      const majorityDir = this.majorityDirection(groupQuads);

      // Sort textlines in reading order (1:1 textline_merge/__init__.py)
      if (majorityDir === 'h') {
        // Horizontal text: sort top-to-bottom (Y ascending)
        groupIndices.sort((a, b) => quads[a].centroid.y - quads[b].centroid.y);
      } else {
        // Vertical manga: sort right-to-left (X descending)
        groupIndices.sort((a, b) => quads[b].centroid.x - quads[a].centroid.x);
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

      console.log(`[OcrManager] Merged Speech Bubble: "${groupText}" (${majorityDir}) from ${groupIndices.length} lines`);
      const groupScore = groupIndices.reduce((sum, idx) => sum + (scores[idx] || 1), 0) / groupIndices.length;

      // 1:1 Cotrans block font size: int(min(textline font sizes)) (textline_merge dispatch)
      const groupFontSize = Math.floor(Math.min(...groupIndices.map(idx => quads[idx].font_size)));

      // 1:1 Cotrans average angle calculation and threshold snapping (textline_merge/__init__.py):
      // angle = rad2deg(mean(line angles)) - 90, snapped to 0 below 3 degrees
      const meanAngleRad = groupIndices.reduce((sum, idx) => sum + quads[idx].angle, 0) / groupIndices.length;
      let angleDeg = (meanAngleRad * 180) / Math.PI - 90;
      if (Math.abs(angleDeg) < 3) {
        angleDeg = 0;
      }

      // 1:1 Cotrans min_rect computation (textblock.py min_rect property - ALWAYS 4 points)
      const groupPolygons = groupIndices.map(idx => quads[idx].pts);
      const minRect = computeMinAreaRect(groupPolygons, angleDeg);
      const minBox = calculateBoundingBox(minRect);

      mergedTexts.push(groupText);
      mergedScores.push(groupScore);
      mergedPolygons.push(minRect);
      mergedBoxes.push({ x: minBox.x, y: minBox.y, w: minBox.width, h: minBox.height });
      mergedDirections.push(majorityDir);
      mergedFontSizes.push(groupFontSize);
      mergedAngles.push(angleDeg);
      // Cotrans used_rows: number of source OCR lines merged into this region.
      mergedLineCounts.push(groupIndices.length);
    }

    // Cotrans sort_regions (textblock.py:423): order blocks top-to-bottom, right-to-left.
    // Graph connected-component order is arbitrary; without this, translation receives
    // bubbles in random spatial order which breaks cross-bubble context quality.
    // Candidates MUST be pre-sorted by centerY ascending (Cotrans line 426) — the
    // insertion logic below is only correct under that precondition.
    const rows: number[] = []; // indices into mergedBoxes, in panel reading order
    const candidates = mergedBoxes
      .map((b, index) => ({ index, centerY: b.y + b.h / 2 }))
      .sort((a, b) => a.centerY - b.centerY);
    for (const { index: cand } of candidates) {
      const b = mergedBoxes[cand];
      const centerY = b.y + b.h / 2;
      const centerX = b.x + b.w / 2;
      let placed = false;
      for (let i = 0; i < rows.length; i++) {
        const r = mergedBoxes[rows[i]];
        if (centerY > r.y + r.h) continue;
        if (centerY < r.y) {
          // pass the row: belongs after current row
          rows.splice(i + 1, 0, cand);
          placed = true;
          break;
        }
        // Same row band: right-to-left for manga reading order
        const rCenterX = r.x + r.w / 2;
        if (centerX > rCenterX) {
          rows.splice(i, 0, cand);
          placed = true;
          break;
        }
      }
      if (!placed) rows.push(cand);
    }

    const pick = <T>(arr: T[]): T[] => rows.map(i => arr[i]);

    // rawPolygons retains the raw unmerged 4-point line quadrilaterals for inpainting.
    // Built from PRE-dedup filtered polygons: a dedup-dropped duplicate still has ink
    // (its non-overlapping part) that must be erased. Orphan punctuation polygons that
    // were merged into neighbors' text are added too — their ink must also be erased.
    const maskPolygons = [...filteredPolygons];
    for (const idx of claimedPunctuation) {
      maskPolygons.push(rawPolygons[idx]);
    }
    return {
      texts: pick(mergedTexts),
      polygons: pick(mergedPolygons),
      scores: pick(mergedScores),
      boxes: pick(mergedBoxes),
      directions: pick(mergedDirections),
      fontSizes: pick(mergedFontSizes),
      angles: pick(mergedAngles),
      lineCounts: pick(mergedLineCounts),
      detectionScores: result.detectionScores,
      rawPolygons: maskPolygons,
      maskRawCanvas: result.maskRawCanvas
    };
  }

  /**
   * Process the image buffer to extract text and bounding boxes.
   *
   * @param imageBuffer - The raw ArrayBuffer of the image.
   * @returns A promise that resolves to the standardized OCR result.
   */
  async processImage(imageBuffer: ArrayBuffer, tier: OcrTier = 'v6-small'): Promise<OcrResult> {
    const engine = await this.getOrLoadEngine(tier);
    const rawResult = await engine.recognize(imageBuffer);
    return this.mergeTextBlocks(rawResult);
  }

  /**
   * Unloads the engine from memory to free up VRAM/RAM.
   *
   * @returns A promise that resolves when cleanup is complete.
   */
  async cleanup(): Promise<void> {
    for (const engine of this.engines.values()) {
      await engine.destroy();
    }
    this.engines.clear();
    this.initPromises.clear();
  }
}
