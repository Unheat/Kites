/**
 * Post-merge utterance splitting algorithm.
 *
 * 1:1 ground-truth port from XianScan `src/pipeline/region_builder/clustering.rs`.
 * Resolves staggered multi-utterance connected speech balloons (e.g., dual-lobe speech)
 * by detecting intra-balloon vertical gaps and terminal punctuation boundaries.
 */

export interface InputLine {
  id: number;
  polygon: { x: number; y: number }[];
  text: string;
}

/** Minimum horizontal step in pixels between adjacent columns to be considered distinct columns. */
export const VERTICAL_COLUMN_MIN_HORIZ_STEP = 15;

/** Maximum horizontal step in pixels within the same vertical column. */
export const SAME_COLUMN_MAX_HORIZ_STEP = 18;

/** Unconditional same-column split floor (no punctuation needed), as an absolute pixel floor and
 *  a ratio of median character thickness (~1.35 characters of visible empty space). */
export const SAME_COLUMN_MIN_GAP_PIXELS = 22.0;
export const SAME_COLUMN_MIN_GAP_RATIO = 1.35;

/**
 * Punctuation-gated same-column split floor, as an absolute pixel floor and a ratio of median
 * character thickness.
 *
 * Deliberate donor deviation from XianScan `clustering.rs` (donor: `max(6, 0.45 x thickness)`):
 * the donor's OCR segmenter emits per-utterance columns with near-zero intra-column slack, so a
 * sub-character gap after terminal punctuation is meaningful there. PaddleOCR chunks one
 * continuous column into quads with sub-character segmentation slack, so a sub-character gap is
 * noise, not a paragraph break — it false-split continuous speech the author wrote as a single
 * line. A visible paragraph break is at least one full character tall, so the bar is one full
 * character height. Only applies to the SAME-column path; the staggered-lobe path keeps the
 * donor threshold because those columns are physically distinct (horizStep >= 15).
 */
export const SAME_COLUMN_PUNCT_GAP_MIN_PIXELS = 12.0;
export const SAME_COLUMN_PUNCT_GAP_RATIO = 1.0;

/** Minimum vertical center translation in font size multiples for non-punctuated box splits. */
export const BOX_TRANSLATION_CENTER_SHIFT_RATIO = 0.85;
/** Minimum absolute vertical center translation in pixels for non-punctuated box splits. */
export const BOX_TRANSLATION_MIN_CENTER_SHIFT = 25.0;

/** Minimum top stagger in font size multiples for non-punctuated box splits. */
export const BOX_TRANSLATION_TOP_STAGGER_RATIO = 1.2;
/** Minimum absolute top stagger in pixels for non-punctuated box splits. */
export const BOX_TRANSLATION_MIN_TOP_STAGGER = 30.0;

/** Maximum allowable opposing bottom shrink in font size multiples (guards against convex oval bubble shrinkage). */
export const BOX_TRANSLATION_OPPOSING_SHRINK_TOLERANCE_RATIO = 0.5;

export function polygonThickness(poly: { x: number; y: number }[]): number {
  if (poly.length >= 4) {
    const dx01 = poly[1].x - poly[0].x;
    const dy01 = poly[1].y - poly[0].y;
    const len01 = Math.hypot(dx01, dy01);

    const dx12 = poly[2].x - poly[1].x;
    const dy12 = poly[2].y - poly[1].y;
    const len12 = Math.hypot(dx12, dy12);

    return Math.max(10.0, Math.min(len01, len12));
  }
  const ys = poly.map((p) => p.y);
  return Math.max(10.0, Math.max(...ys) - Math.min(...ys));
}

export function polygonBounds(poly: { x: number; y: number }[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY)
  };
}

export function endsWithTerminalPunctuation(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.endsWith('！') ||
    trimmed.endsWith('!') ||
    trimmed.endsWith('？') ||
    trimmed.endsWith('?') ||
    trimmed.endsWith('。') ||
    trimmed.endsWith('…') ||
    trimmed.endsWith('..') ||
    trimmed.endsWith('」') ||
    trimmed.endsWith('』') ||
    trimmed.endsWith('）') ||
    trimmed.endsWith('んだ…')
  );
}

/**
 * Clusters a set of merged OCR lines into distinct utterances based on spacing and punctuation.
 *
 * @param lines - Array of input lines in this cluster.
 * @param isCjk - Whether text is CJK/Korean.
 * @param isVertical - Whether primary reading orientation is vertical.
 * @param angleRad - Rotation angle in radians.
 * @returns Array of clustered line arrays (each represents an independent utterance).
 */
export function clusterLinesIntoUtterances(
  lines: InputLine[],
  isCjk: boolean = true,
  isVertical: boolean = true,
  angleRad: number = 0
): InputLine[][] {
  if (lines.length <= 1 || !isCjk) {
    return [lines];
  }

  const sinA = Math.sin(angleRad);
  const cosA = Math.cos(angleRad);

  interface LineMeta {
    line: InputLine;
    bounds: { x: number; y: number; w: number; h: number };
    thickness: number;
  }

  const metas: LineMeta[] = lines.map((l) => ({
    line: l,
    bounds: polygonBounds(l.polygon),
    thickness: polygonThickness(l.polygon)
  }));

  const sortedTh = metas.map((m) => m.thickness).sort((a, b) => a - b);
  const medianTh = Math.max(8.0, sortedTh[Math.floor(sortedTh.length / 2)] || 12.0);

  // 1. VERTICAL TBRL CLUSTERING FOR JAPANESE / CJK
  if (isVertical) {
    const sortedV = [...metas].sort((a, b) => {
      const aRx = (a.bounds.x + a.bounds.w / 2) * cosA + a.bounds.y * sinA;
      const bRx = (b.bounds.x + b.bounds.w / 2) * cosA + b.bounds.y * sinA;
      if (bRx !== aRx) {
        return bRx - aRx; // Right-to-left
      }
      return a.bounds.y - b.bounds.y; // Top-to-bottom
    });

    // Spatial Y-connected component clustering for vertical utterances
    const vertClusters: InputLine[][] = [];
    for (const m of sortedV) {
      const { x: lx, y: ly, w: lw, h: lh } = m.bounds;
      const mergedIndices: number[] = [];

      for (let cIdx = 0; cIdx < vertClusters.length; cIdx++) {
        const cluster = vertClusters[cIdx];
        const connects = cluster.some((cLine) => {
          const { x: cx, y: cy, w: cw, h: ch } = polygonBounds(cLine.polygon);
          const overlapY = Math.min(ly + lh, cy + ch) - Math.max(ly, cy);
          const vertGap = ly >= cy + ch ? ly - (cy + ch) : cy >= ly + lh ? cy - (ly + lh) : 0;
          const horizGap = lx >= cx + cw ? lx - (cx + cw) : cx >= lx + lw ? cx - (lx + lw) : 0;
          const maxHorizGap = Math.max(24.0, medianTh * 1.8);
          const maxVertGap = Math.max(12.0, medianTh * 0.8);

          return (overlapY > 0 && horizGap <= maxHorizGap) || (vertGap <= maxVertGap && horizGap <= maxHorizGap);
        });

        if (connects) {
          mergedIndices.push(cIdx);
        }
      }

      if (mergedIndices.length === 0) {
        vertClusters.push([m.line]);
      } else {
        const first = mergedIndices[0];
        vertClusters[first].push(m.line);
        for (let idx = mergedIndices.length - 1; idx >= 1; idx--) {
          const other = mergedIndices[idx];
          const otherLines = vertClusters.splice(other, 1)[0];
          vertClusters[first].push(...otherLines);
        }
      }
    }

    const finalVertUtterances: InputLine[][] = [];
    for (const cluster of vertClusters) {
      if (cluster.length <= 1) {
        finalVertUtterances.push(cluster);
        continue;
      }

      // Sort lines in reading order: Right-to-Left (X descending) then Top-to-Bottom (Y ascending)
      const colSorted = [...cluster].sort((a, b) => {
        const aBounds = polygonBounds(a.polygon);
        const bBounds = polygonBounds(b.polygon);
        const horizDiff = bBounds.x - aBounds.x;
        if (Math.abs(horizDiff) >= 15) {
          return horizDiff; // Right to left
        }
        return aBounds.y - bBounds.y; // Top to bottom
      });

      let subCluster: InputLine[] = [];
      let prevBounds: { x: number; y: number; w: number; h: number } | null = null;
      let prevText = '';

      for (const l of colSorted) {
        const b = polygonBounds(l.polygon);

        if (prevBounds !== null) {
          const endsWithTerm = endsWithTerminalPunctuation(prevText);
          const horizStep = Math.abs(b.x - prevBounds.x);
          const topStagger = b.y - prevBounds.y;
          const botStagger = (b.y + b.h) - (prevBounds.y + prevBounds.h);
          const vertGap = b.y - (prevBounds.y + prevBounds.h);

          const prevCenterY = prevBounds.y + prevBounds.h / 2;
          const currCenterY = b.y + b.h / 2;
          const centerShiftY = currCenterY - prevCenterY;

          // 1. Same-column vertical split (one utterance above another in same column).
          // Terminal punctuation lowers the gap bar only for a VISIBLE paragraph break
          // (one full character height); sub-character gaps inside a continuous column are
          // PaddleOCR segmentation slack and must stay merged (see SAME_COLUMN_PUNCT_GAP_* docs).
          const isSameColumnSplit =
            horizStep < SAME_COLUMN_MAX_HORIZ_STEP &&
            (vertGap >= Math.max(SAME_COLUMN_MIN_GAP_PIXELS, medianTh * SAME_COLUMN_MIN_GAP_RATIO) ||
              (endsWithTerm && vertGap >= Math.max(SAME_COLUMN_PUNCT_GAP_MIN_PIXELS, medianTh * SAME_COLUMN_PUNCT_GAP_RATIO)));

          const overlapY = Math.min(prevBounds.y + prevBounds.h, b.y + b.h) - Math.max(prevBounds.y, b.y);

          // 2. Staggered box/lobe translation parameters (XianScan clustering.rs:60-63)
          const minCenterShift = Math.max(BOX_TRANSLATION_MIN_CENTER_SHIFT, medianTh * BOX_TRANSLATION_CENTER_SHIFT_RATIO);
          const minTopStagger = Math.max(BOX_TRANSLATION_MIN_TOP_STAGGER, medianTh * BOX_TRANSLATION_TOP_STAGGER_RATIO);
          const maxOpposingShrink = medianTh * BOX_TRANSLATION_OPPOSING_SHRINK_TOLERANCE_RATIO;

          // 2a. Staggered multi-lobe split with terminal punctuation (XianScan clustering.rs:60-63):
          // Distinct utterances in conjoined/staggered double-bubbles (e.g. figure-8 lobes) are split
          // when the preceding line ends with terminal punctuation AND the column translates vertically
          // with a significant physical center shift (distinguishing separate lobes from multi-line text).
          const isPunctuationLobeSplit =
            horizStep >= VERTICAL_COLUMN_MIN_HORIZ_STEP &&
            endsWithTerm &&
            Math.abs(centerShiftY) >= minCenterShift &&
            (topStagger >= 15 || botStagger >= 25 || (overlapY <= 0 && vertGap >= Math.max(6.0, medianTh * 0.45)));

          // 2b. Staggered box/lobe translation WITHOUT terminal punctuation (concordant translation:
          // handles multi-box continuous sentences where top and bottom translate in the same direction,
          // with large vertical centroid shift, distinguishing separate boxes from symmetric oval shrinkage).
          const isDownwardBoxTranslation =
            topStagger >= minTopStagger &&
            botStagger >= -maxOpposingShrink &&
            centerShiftY >= minCenterShift;

          const isUpwardBoxTranslation =
            topStagger <= -minTopStagger &&
            botStagger <= maxOpposingShrink &&
            centerShiftY <= -minCenterShift;

          const isExtremeBoxTranslation =
            horizStep >= VERTICAL_COLUMN_MIN_HORIZ_STEP &&
            (isDownwardBoxTranslation || isUpwardBoxTranslation);

          const isStaggeredLobeSplit = isPunctuationLobeSplit || isExtremeBoxTranslation;

          if ((isSameColumnSplit || isStaggeredLobeSplit) && subCluster.length > 0) {
            finalVertUtterances.push(subCluster);
            subCluster = [];
            prevBounds = null;
          }
        }

        subCluster.push(l);
        prevBounds = b;
        prevText = l.text.trim();
      }

      if (subCluster.length > 0) {
        finalVertUtterances.push(subCluster);
      }
    }

    if (finalVertUtterances.length >= 2) {
      return finalVertUtterances;
    }
    return [lines];
  }

  // 2. HORIZONTAL ROW CLUSTERING FOR CJK
  const sortedLines = [...lines].sort((a, b) => {
    const aBounds = polygonBounds(a.polygon);
    const bBounds = polygonBounds(b.polygon);
    const aMy = -(aBounds.x + aBounds.w / 2) * sinA + (aBounds.y + aBounds.h / 2) * cosA;
    const bMy = -(bBounds.x + bBounds.w / 2) * sinA + (bBounds.y + bBounds.h / 2) * cosA;
    return aMy - bMy;
  });

  const rows: InputLine[][] = [];
  for (const l of sortedLines) {
    const bounds = polygonBounds(l.polygon);
    const lTh = polygonThickness(l.polygon);
    const lRotY = -(bounds.x + bounds.w / 2) * sinA + (bounds.y + lTh / 2) * cosA;
    let placed = false;
    for (const row of rows) {
      const rBounds = polygonBounds(row[0].polygon);
      const rTh = polygonThickness(row[0].polygon);
      const rRotY = -(rBounds.x + rBounds.w / 2) * sinA + (rBounds.y + rTh / 2) * cosA;
      const threshold = Math.max(4.0, Math.min(lTh, rTh) * 0.45);
      if (Math.abs(lRotY - rRotY) <= threshold) {
        row.push(l);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([l]);
    }
  }

  // Check for vertical paragraph gaps between rows
  const paragraphClusters: InputLine[][] = [];
  let currentCluster: InputLine[] = [];

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    if (rIdx > 0) {
      const prevRow = rows[rIdx - 1];
      const prevMaxY = Math.max(
        ...prevRow.map((l) => {
          const b = polygonBounds(l.polygon);
          const th = polygonThickness(l.polygon);
          return -(b.x + b.w / 2) * sinA + (b.y + th) * cosA;
        })
      );
      const currMinY = Math.min(
        ...row.map((l) => {
          const b = polygonBounds(l.polygon);
          return -(b.x + b.w / 2) * sinA + b.y * cosA;
        })
      );

      const prevRowText = prevRow.map((l) => l.text.trim()).join('');
      const endsWithPunct = endsWithTerminalPunctuation(prevRowText);

      const prevH = Math.max(...prevRow.map((l) => polygonBounds(l.polygon).h));
      const currH = Math.max(...row.map((l) => polygonBounds(l.polygon).h));
      const vertGap = currMinY - prevMaxY;
      const minLineH = Math.min(prevH, currH);

      const isSubstantialGap =
        vertGap >= Math.max(18.0, minLineH * 1.1) ||
        (endsWithPunct && vertGap >= Math.max(6.0, minLineH * 0.45));

      if (isSubstantialGap && currentCluster.length > 0) {
        paragraphClusters.push(currentCluster);
        currentCluster = [];
      }
    }

    currentCluster.push(...row);
  }

  if (currentCluster.length > 0) {
    paragraphClusters.push(currentCluster);
  }

  if (paragraphClusters.length >= 2) {
    return paragraphClusters;
  }

  return [lines];
}
