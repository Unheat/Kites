import type { IOcrEngine, OcrResult } from '../engines/ocr/BaseOcrEngine';
import { PaddleOcrEngine } from '../engines/ocr/PaddleOcrEngine';
import { resolveOcrTier } from '../engines/ocr/ocrRegistry';
import type { Point2D } from '../../shared/utils/geometry';
import { Quadrilateral, Graph, calculateBoundingBox, computeMinAreaRect, polygonArea, quadrilateralCanMergeRegion, splitTextRegion, calculateRotationAngle } from '../../shared/utils/geometry';
import {
  isScanlatorWatermark,
  isThoughtBubbleTailOrnament,
  isStandaloneDigitOrOrnamentNoise,
  isStandaloneDigitOrParticleNoise,
  cleanStrayOcrArtifacts,
  isOnomatopoeiaOrShout,
  isNonLatinSource,
  hasNativeScriptForLang,
  stripTrailingWatermarkDebris,
  isStandaloneNoiseStroke,
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
 * Determines whether speech bubbles on a page should be ordered Right-to-Left (Japanese manga order)
 * or Left-to-Right (Western comic / Webtoon order).
 * Ported 1:1 from Cotrans `sort_regions(regions, right_to_left=True/False)` in textblock.py:423.
 *
 * @param sourceLang - Source language code if provided (e.g. 'ja', 'en', 'vi', 'ko').
 * @param mergedDirections - Majority directions of the merged bubbles ('h' | 'v').
 * @param mergedTexts - Text contents of the merged speech bubbles.
 * @returns True for RTL reading order (manga), false for LTR reading order (western comics/webtoons).
 */
export function isRightToLeftReadingOrder(
  sourceLang?: string,
  mergedDirections?: ('h' | 'v')[],
  mergedTexts?: string[]
): boolean {
  if (sourceLang) {
    const lang = sourceLang.trim().toLowerCase();
    if (lang.startsWith('ja') || lang === 'jpn') {
      return true;
    }
    // Explicit RTL writing systems (Arabic, Hebrew, Persian, Urdu)
    if (['ar', 'ara', 'he', 'heb', 'fa', 'pes', 'ur', 'urd'].includes(lang)) {
      return true;
    }
    // Explicit non-Japanese / LTR languages (English, Vietnamese, Korean, Chinese, European languages)
    return false;
  }

  // Fallback when sourceLang is 'auto' or undefined:
  // If vertical text blocks exist, or Japanese kana characters are detected, treat as Japanese manga (RTL).
  if (mergedDirections && mergedDirections.some(d => d === 'v')) {
    return true;
  }
  if (mergedTexts && mergedTexts.some(t => /[\u3040-\u30ff]/.test(t))) {
    return true;
  }

  // Default to LTR for pure horizontal text without Japanese indicators
  return false;
}

/**
 * Available OCR tiers. Defaults to 'v6-small'.
 * Dynamically maps to any preset registered in ocrRegistry.
 */
export type OcrTier = string;
export type InitializationLifecycleCallback = (phase: 'started' | 'finished') => void;

export class OcrManager {
  private activeTier: string | null = null;
  private activeEngine: IOcrEngine | null = null;
  private activeUsers = 0;
  private usersDrained: Promise<void> | null = null;
  private resolveUsersDrained: (() => void) | null = null;
  private lifecycleQueue: Promise<void> = Promise.resolve();

  /**
   * Runs one lifecycle mutation after earlier mutations finish, while keeping a rejected
   * mutation from poisoning the queue for later retries.
   *
   * @param operation - Lifecycle mutation to serialize.
   * @returns The operation result.
   */
  private async serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.lifecycleQueue;
    let releaseQueue!: () => void;
    this.lifecycleQueue = new Promise<void>(resolve => { releaseQueue = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      releaseQueue();
    }
  }

  /**
   * Waits until all operations using the current engine have released it.
   *
   * @returns A promise resolved when no active engine users remain.
   */
  private async waitForUsersToDrain(): Promise<void> {
    if (this.activeUsers === 0) return;
    if (!this.usersDrained) {
      this.usersDrained = new Promise<void>(resolve => { this.resolveUsersDrained = resolve; });
    }
    await this.usersDrained;
  }

  /**
   * Releases one operation's engine lease and wakes a pending tier switch when last user exits.
   *
   * @returns Nothing.
   */
  private releaseEngine(): void {
    this.activeUsers -= 1;
    if (this.activeUsers === 0) {
      this.resolveUsersDrained?.();
      this.resolveUsersDrained = null;
      this.usersDrained = null;
    }
  }

  /**
   * Returns requested initialized OCR engine, replacing another tier only after its users finish.
   * Same-tier calls reuse one engine. Serialized creation deduplicates initialization, and failed
   * initialization leaves no cached state so a later call can retry.
   *
   * @param tier - OCR model tier or registry alias.
   * @returns The initialized OCR engine instance.
   */

  /**
   * Acquires a counted lease on requested engine so tier replacement cannot destroy it in use.
   *
   * @param tier - OCR model tier or registry alias.
   * @returns Engine and idempotent release callback.
   */
  private async acquireEngine(
    tier: OcrTier,
    onInitialization?: InitializationLifecycleCallback,
  ): Promise<{ engine: IOcrEngine; release: () => void }> {
    return this.serializeLifecycle(async () => {
      const canonicalTier = resolveOcrTier(tier);
      let engine = this.activeEngine;
      if (!engine || this.activeTier !== canonicalTier) {
        engine = await this.loadEngineInsideLifecycle(canonicalTier, onInitialization);
      }
      this.activeUsers += 1;
      let released = false;
      return {
        engine,
        release: () => {
          if (released) return;
          released = true;
          this.releaseEngine();
        },
      };
    });
  }

  /**
   * Replaces current OCR engine while caller owns lifecycle serialization.
   *
   * @param canonicalTier - Canonical OCR registry tier.
   * @param onInitialization - Optional callback notified around genuine cold initialization.
   * @returns Initialized replacement engine.
   */
  private async loadEngineInsideLifecycle(
    canonicalTier: string,
    onInitialization?: InitializationLifecycleCallback,
  ): Promise<IOcrEngine> {
    if (canonicalTier === 'none') throw new Error('[OcrManager] None OCR engine is not yet implemented.');
    await this.waitForUsersToDrain();
    if (this.activeEngine) {
      console.log(`[OcrManager] Destroying OCR engine: ${this.activeTier}...`);
      await this.activeEngine.destroy();
      this.activeEngine = null;
      this.activeTier = null;
    }
    console.log(`[OcrManager] Instantiating OCR Engine for tier: ${canonicalTier}...`);
    const engine = new PaddleOcrEngine(canonicalTier);
    onInitialization?.('started');
    try {
      await engine.init();
    } catch (error) {
      console.error(`[OcrManager] Failed to initialize OCR tier: ${canonicalTier}`, error);
      await engine.destroy().catch(destroyError => console.error('[OcrManager] Failed to destroy partial engine', destroyError));
      throw error;
    } finally {
      onInitialization?.('finished');
    }
    this.activeTier = canonicalTier;
    this.activeEngine = engine;
    return engine;
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
  private mergeTextBlocks(
    result: OcrResult,
    context?: { sourceLang?: string; pageWidth?: number; pageHeight?: number }
  ): OcrResult {
    // Merge algorithm entry point
    const rawTexts = [...result.texts];
    const rawPolygons = [...(result.polygons || [])];
    const rawScores = [...(result.scores || [])];
    if (rawTexts.length <= 1 || rawPolygons.length === 0) return { ...result, rawPolygons };

    // XianScan clean_stray_ocr_artifacts: per-line rewrite BEFORE any filtering so
    // trailing digit runs after ellipsis ("ちょっと…200000") and slash debris are
    // cleaned once and every downstream filter sees the cleaned text.
    for (let i = 0; i < rawTexts.length; i++) {
      rawTexts[i] = cleanStrayOcrArtifacts(rawTexts[i]);
    }
    const sourceLang = context?.sourceLang;

    // XianScan fusion.rs:72-146 line pre-filter battery (geometry + score only).
    // Active only when page dimensions are provided. Drops: giant artwork
    // hallucinations, high-tilt low-confidence lines, non-Latin slanted non-native
    // lines, margin-flush architectural texture noise, and thin sliver subsegments.
    const pageWidth = context?.pageWidth;
    const pageHeight = context?.pageHeight;
    const allLineIndices = rawTexts
      .map((_, i) => i)
      .filter(i => rawTexts[i].trim() && rawPolygons[i] && rawPolygons[i].length >= 3);
    let universe = allLineIndices;
    if (pageWidth && pageHeight) {
      const survivors: number[] = [];
      for (const i of allLineIndices) {
        const poly = rawPolygons[i];
        const box = calculateBoundingBox(poly);
        const score = rawScores[i] || 0;
        const t = rawTexts[i].trim();
        const angleDeg = (Math.abs(calculateRotationAngle(poly)) * 180) / Math.PI;

        // 1. Giant artwork hallucination
        if (box.width >= pageWidth * 0.60 && box.height >= 120 && score < 0.75) {
          console.log(`[OcrManager] Battery: dropped giant hallucination "${t}" (${Math.round(box.width)}x${Math.round(box.height)}, score=${score.toFixed(2)})`);
          continue;
        }
        // 3. High-tilt non-dialogue with low confidence
        if (angleDeg >= 12.0 && score < 0.60) {
          console.log(`[OcrManager] Battery: dropped high-tilt line "${t}" (${angleDeg.toFixed(1)}deg, score=${score.toFixed(2)})`);
          continue;
        }
        // 3b. Non-Latin source + slanted + no native script
        if (sourceLang && isNonLatinSource(sourceLang) && angleDeg >= 10.0 && !hasNativeScriptForLang(t, sourceLang)) {
          console.log(`[OcrManager] Battery: dropped slanted non-native line "${t}" (${angleDeg.toFixed(1)}deg)`);
          continue;
        }
        // 4. Margin-flush architectural / border texture noise
        if ((box.x <= 5 || box.x + box.width >= pageWidth - 5) && score < 0.75) {
          console.log(`[OcrManager] Battery: dropped margin-flush line "${t}" (score=${score.toFixed(2)})`);
          continue;
        }
        survivors.push(i);
      }

      // 4b. Thin sliver subsegments (h <= 25) overlapping a normal-height line
      const normalIndices = survivors.filter(i => {
        const b = calculateBoundingBox(rawPolygons[i]);
        return b.height >= 28 && (rawScores[i] || 0) >= 0.65 && b.height <= b.width * 1.25;
      });
      universe = survivors.filter(i => {
        const b = calculateBoundingBox(rawPolygons[i]);
        if (b.height > b.width * 1.25 || b.height > 25) return true;
        const t = rawTexts[i].trim();
        const isSliver = normalIndices.some(ni => {
          const nb = calculateBoundingBox(rawPolygons[ni]);
          const ix = Math.min(b.x + b.width, nb.x + nb.width) - Math.max(b.x, nb.x);
          const iy = Math.min(b.y + b.height, nb.y + nb.height) - Math.max(b.y, nb.y);
          if (ix <= 0 || iy <= 0) return false;
          const overlapY = iy / b.height;
          const overlapX = ix / Math.min(b.width, nb.width);
          const nt = rawTexts[ni].trim();
          const isSub = nt.includes(t) && nt.length > t.length;
          return (overlapY >= 0.60 && overlapX >= 0.50) || (overlapY >= 0.50 && isSub);
        });
        if (isSliver) {
          console.log(`[OcrManager] Battery: dropped thin sliver "${rawTexts[i].trim()}" (h=${Math.round(b.height)})`);
        }
        return !isSliver;
      });
      console.log(`[OcrManager] Battery: ${allLineIndices.length} -> ${universe.length} lines after geometry pre-filter`);
    }

    // XianScan-style orphan punctuation recovery. Cotrans deliberately drops pure punctuation
    // as noise, but vertical manga often detects a terminal `!`/`?` in its own small quad.
    const purePunctuation = /^[！!？?…~〜ー─―.]+$/;
    const claimedPunctuation = new Set<number>();
    for (const punctuationIndex of universe) {
      const punctuation = rawTexts[punctuationIndex]?.trim();
      const punctuationPolygon = rawPolygons[punctuationIndex];
      if (!punctuation || !purePunctuation.test(punctuation) || !punctuationPolygon || punctuationPolygon.length < 3) continue;

      const punctuationBox = calculateBoundingBox(punctuationPolygon);
      let closestIndex = -1;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const lineIndex of universe) {
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
    for (const i of universe) {
      const poly = rawPolygons[i];
      let txt = rawTexts[i];
      if (!poly || poly.length < 3) continue;
      if (!txt || !txt.trim()) continue;
      if (claimedPunctuation.has(i)) continue;

      if (!isValuableText(txt)) {
        console.log(`[OcrManager] Filtered out non-valuable noise line "${txt}"`);
        continue;
      }

      // XianScan noise rule: standalone 1-2 char Latin/digit noise (e.g. "er", "u", "N") on
      // speedlines and clothing folds with low score (< 0.65) is background artifact.
      // SFX/shout exemption: real sound effects ("GO!", "KYAA") must survive.
      let trimmedTxt = txt.trim();

      // XianScan noise rule: standalone speedline and sword slash strokes
      // (e.g. "一", "丨", "丿", "─━") misread by OCR as single-stroke CJK kanji.
      if (isStandaloneNoiseStroke(trimmedTxt)) {
        console.log(`[OcrManager] Filtered out speedline stroke noise "${trimmedTxt}"`);
        continue;
      }

      // XianScan noise rule: standalone 1-2 char Latin/digit noise (e.g. "er", "u", "N") on
      // speedlines and clothing folds with low score (< 0.65) is background artifact.
      // SFX/shout exemption: real sound effects ("GO!", "KYAA") must survive.
      const isShortLatinNoise = trimmedTxt.length <= 2
        && /^[a-zA-Z0-9]+$/.test(trimmedTxt)
        && (rawScores[i] || 0) < 0.65
        && !isOnomatopoeiaOrShout(trimmedTxt);
      if (isShortLatinNoise) {
        console.log(`[OcrManager] Filtered out short Latin noise line "${trimmedTxt}" (score=${rawScores[i]})`);
        continue;
      }

      // XianScan strip_trailing_watermark_debris: a watermark FUSED to the end of a
      // dialogue line is cut (with polygon rescale) rather than dropping the whole line.
      if (sourceLang) {
        const debris = stripTrailingWatermarkDebris(trimmedTxt, sourceLang);
        if (debris.keepRatio <= 0.10) {
          console.log(`[OcrManager] Dropped line dominated by watermark debris "${trimmedTxt}"`);
          continue;
        }
        if (debris.keepRatio < 0.99) {
          rawTexts[i] = debris.text;
          const poly = rawPolygons[i];
          if (poly && poly.length === 4) {
            const polyBox = calculateBoundingBox(poly);
            if (polyBox.height > polyBox.width) {
              // Vertical line: shrink the bottom edge (points 2,3) upward (analyzer.rs multiline variant)
              poly[2] = { x: poly[2].x, y: poly[1].y + (poly[2].y - poly[1].y) * debris.keepRatio };
              poly[3] = { x: poly[3].x, y: poly[0].y + (poly[3].y - poly[0].y) * debris.keepRatio };
            } else {
              // Horizontal line: shrink the right edge (points 1,2) leftward (analyzer.rs single-line variant)
              poly[1] = { x: poly[0].x + (poly[1].x - poly[0].x) * debris.keepRatio, y: poly[1].y };
              poly[2] = { x: poly[3].x + (poly[2].x - poly[3].x) * debris.keepRatio, y: poly[2].y };
            }
          }
          console.log(`[OcrManager] Stripped trailing watermark debris "${trimmedTxt}" -> "${debris.text}" (keepRatio=${debris.keepRatio.toFixed(2)})`);
          // Keep downstream checks (watermark, thought-tail, furigana) on the CLEANED text
          txt = debris.text;
          trimmedTxt = debris.text.trim();
        }
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

    // XianScan builder.rs:189-205: in non-Latin sources, once native-script lines exist
    // on the page, pure-Latin words and digit/particle noise are clothing-fold/screentone
    // artifacts. Dialogue punctuation and sound effects are exempt. Runs at page level
    // (the source applies it per-container; a page-level native anchor is the faithful
    // approximation without containers). Skips entirely for Latin sources / no context.
    let langPrunedIndices = validIndices;
    if (sourceLang && isNonLatinSource(sourceLang)) {
      const anyNative = validIndices.some(idx => hasNativeScriptForLang(rawTexts[idx], sourceLang));
      if (anyNative) {
        langPrunedIndices = validIndices.filter(idx => {
          const t = rawTexts[idx].trim();
          if (!t) return false;
          if (hasNativeScriptForLang(t, sourceLang)) return true;
          if (/[！？!?…]/.test(t)) return true;
          if (isOnomatopoeiaOrShout(t)) return true;
          const isPureLatinWord = /^[\x20-\x7E]+$/.test(t) && /[a-zA-Z]/.test(t);
          const isNoiseOrDigit = isStandaloneDigitOrParticleNoise(t) || isThoughtBubbleTailOrnament(t);
          if (isPureLatinWord || isNoiseOrDigit) {
            console.log(`[OcrManager] Pruned non-native Latin noise "${t}" (source=${sourceLang})`);
            return false;
          }
          return true;
        });
      }
    }

    const filteredTexts = langPrunedIndices.map(i => rawTexts[i]);
    const filteredPolygons = langPrunedIndices.map(i => rawPolygons[i]);
    const filteredScores = langPrunedIndices.map(i => rawScores[i]);

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
      // Nothing to translate, so nothing should be erased.
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
        rawPolygons: [],
      };
    }

    // Build Cotrans Quadrilateral objects once (sorts points, derives direction/font_size)
    const quads = polygons.map(p => new Quadrilateral(p));

    // Stage 1.5: assign per-line reading direction (Cotrans _generate_text_direction)
    this.assignTextDirections(quads);

    // XianScan low-confidence suppression (builder.rs:278-282), NEIGHBORHOOD-GATED:
    // the source suppresses weak lines inside a container that also holds a strong
    // line. We have no containers pre-merge, so the gate is "can actually merge with"
    // a high-confidence line. A faint whisper bubble elsewhere on the page cannot
    // merge with the strong line and is untouched.
    let workingTexts = texts;
    let workingScores = scores;
    let workingQuads = quads;
    const pageMaxScore = scores.reduce((m, s) => Math.max(m, s || 0), 0);
    if (pageMaxScore >= 0.70) {
      const suppressed = new Set<number>();
      for (let i = 0; i < texts.length; i++) {
        const scoreI = scores[i] || 0;
        if (scoreI >= 0.60 || scoreI >= pageMaxScore * 0.85) continue;
        for (let j = 0; j < texts.length; j++) {
          if (i === j || (scores[j] || 0) < 0.70) continue;
          if (quadrilateralCanMergeRegion(quads[i], quads[j], 1.9, 2, 1, 3, 2, 1.3)) {
            suppressed.add(i);
            console.log(`[OcrManager] Suppressed low-confidence line "${texts[i].trim()}" (score=${scoreI.toFixed(2)}) near high-confidence line (score=${(scores[j] || 0).toFixed(2)})`);
            break;
          }
        }
      }
      if (suppressed.size > 0) {
        const kept = texts.map((_, i) => i).filter(i => !suppressed.has(i));
        workingTexts = kept.map(i => texts[i]);
        workingScores = kept.map(i => scores[i]);
        workingQuads = kept.map(i => quads[i]);
      }
    }

    const mergedPolygons: any[] = [];
    const mergedTexts: string[] = [];
    const mergedScores: number[] = [];
    const mergedBoxes: { x: number, y: number, w: number, h: number }[] = [];
    const mergedDirections: ('h' | 'v')[] = [];
    const mergedFontSizes: number[] = [];
    const mergedAngles: number[] = [];
    const mergedLineCounts: number[] = [];

    // Step 1: divide into text region candidates (textline_merge/__init__.py merge graph).
    // Cotrans call: quadrilateral_can_merge_region(ubox, vbox, aspect_ratio_tol=1.3,
    // font_size_ratio_tol=2, char_gap_tolerance=1, char_gap_tolerance2=3)
    const mergeGraph = new Graph();
    for (let i = 0; i < workingQuads.length; i++) mergeGraph.addNode(i);
    for (let i = 0; i < workingQuads.length; i++) {
      for (let j = i + 1; j < workingQuads.length; j++) {
        if (quadrilateralCanMergeRegion(workingQuads[i], workingQuads[j], 1.9, 2, 1, 3, 2, 1.3)) {
          mergeGraph.addEdge(i, j);
        }
      }
    }

    // Step 2: postprocess - further split each region using Cotrans Kruskal MST statistics
    const finalGroups: number[][] = [];
    for (const component of mergeGraph.connectedComponents()) {
      const splitSets = splitTextRegion(workingQuads, component);
      for (const set of splitSets) {
        finalGroups.push(Array.from(set));
      }
    }

    // Step 3: emit one merged region per final group that contains non-empty text
    const validFinalGroups: number[][] = [];
    for (const groupIndices of finalGroups) {
      const groupQuads = groupIndices.map(idx => workingQuads[idx]);

      // Majority direction vote with Cotrans top-2 tie-break
      const majorityDir = this.majorityDirection(groupQuads);

      // Sort textlines in reading order (1:1 textline_merge/__init__.py)
      if (majorityDir === 'h') {
        // Horizontal text: sort top-to-bottom (Y ascending)
        groupIndices.sort((a, b) => workingQuads[a].centroid.y - workingQuads[b].centroid.y);
      } else {
        // Vertical manga: sort right-to-left (X descending)
        groupIndices.sort((a, b) => workingQuads[b].centroid.x - workingQuads[a].centroid.x);
      }

      // 1:1 Cotrans CJK aware text concatenation (textblock.py)
      let groupText = '';
      if (groupIndices.length > 0) {
        groupText = workingTexts[groupIndices[0]] || '';
        for (let k = 1; k < groupIndices.length; k++) {
          const txt = workingTexts[groupIndices[k]] || '';
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

      // Do not emit empty or whitespace-only groups: no text will be placed on top
      if (!groupText.trim()) continue;

      console.log(`[OcrManager] Merged Speech Bubble: "${groupText}" (${majorityDir}) from ${groupIndices.length} lines`);
      const groupScore = groupIndices.reduce((sum, idx) => sum + (workingScores[idx] || 1), 0) / groupIndices.length;

      // 1:1 Cotrans block font size: int(min(textline font sizes)) (textline_merge dispatch)
      const groupFontSize = Math.floor(Math.min(...groupIndices.map(idx => workingQuads[idx].font_size)));

      // 1:1 Cotrans average angle calculation and threshold snapping (textline_merge/__init__.py):
      // angle = rad2deg(mean(line angles)) - 90, snapped to 0 below 3 degrees
      const meanAngleRad = groupIndices.reduce((sum, idx) => sum + workingQuads[idx].angle, 0) / groupIndices.length;
      let angleDeg = (meanAngleRad * 180) / Math.PI - 90;
      if (Math.abs(angleDeg) < 3) {
        angleDeg = 0;
      }

      // 1:1 Cotrans min_rect computation (textblock.py min_rect property - ALWAYS 4 points)
      const groupPolygons = groupIndices.map(idx => workingQuads[idx].pts);
      const minRect = computeMinAreaRect(groupPolygons, angleDeg);
      const minBox = calculateBoundingBox(minRect);

      validFinalGroups.push(groupIndices);
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

    // Cotrans sort_regions (textblock.py:423): order blocks top-to-bottom, right-to-left for manga
    // or top-to-bottom, left-to-right for western comics, webtoons, and LTR scripts.
    // Graph connected-component order is arbitrary; without this, translation receives
    // bubbles in random spatial order which breaks cross-bubble context quality.
    // Candidates MUST be pre-sorted by centerY ascending (Cotrans line 426) — the
    // insertion logic below is only correct under that precondition.
    const rightToLeft = isRightToLeftReadingOrder(sourceLang, mergedDirections, mergedTexts);
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
        // Same row band: right-to-left for manga reading order, or left-to-right for western/webtoon reading order
        const rCenterX = r.x + r.w / 2;
        if (rightToLeft ? centerX > rCenterX : centerX < rCenterX) {
          rows.splice(i, 0, cand);
          placed = true;
          break;
        }
      }
      if (!placed) rows.push(cand);
    }

    const pick = <T>(arr: T[]): T[] => rows.map(i => arr[i]);

    // INVARIANT: Only inpaint regions where replacement text will actually be rendered!
    // If a line was suppressed (low confidence), filtered out as noise, or dropped from
    // the final text groups, no translated text will be drawn over it — so inpainting
    // must NEVER erase it (preventing empty, blanked-out speech bubbles).
    const maskPolygons: Point2D[][] = [];
    for (const cand of rows) {
      const groupIndices = validFinalGroups[cand];
      if (!groupIndices) continue;
      for (const idx of groupIndices) {
        if (workingQuads[idx]?.pts) {
          maskPolygons.push(workingQuads[idx].pts);
        }
      }
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
   * @param tier - OCR model tier.
   * @param context - Optional pipeline context. `sourceLang` activates language-aware
   * filters (XianScan lang.rs); `pageWidth`/`pageHeight` activate the geometry
   * pre-filter battery. All undefined = legacy behavior (no language/geometry filters).
   * @param onInitialization - Optional callback notified around genuine cold initialization.
   * @returns A promise that resolves to the standardized OCR result.
   */
  async processImage(
    imageBuffer: ArrayBuffer,
    tier: OcrTier = 'v6-small',
    context?: { sourceLang?: string; pageWidth?: number; pageHeight?: number },
    onInitialization?: InitializationLifecycleCallback,
  ): Promise<OcrResult> {
    const { engine, release } = await this.acquireEngine(tier, onInitialization);
    try {
      const rawResult = await engine.recognize(imageBuffer);
      return this.mergeTextBlocks(rawResult, context);
    } finally {
      release();
    }
  }

  /**
   * Unloads the engine from memory to free up VRAM/RAM.
   *
   * @returns A promise that resolves when cleanup is complete.
   */
  async cleanup(): Promise<void> {
    await this.serializeLifecycle(async () => {
      await this.waitForUsersToDrain();
      if (this.activeEngine) {
        await this.activeEngine.destroy();
        this.activeEngine = null;
        this.activeTier = null;
      }
    });
  }
}
