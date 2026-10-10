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

      // Sort lines in reading order: top-to-bottom (Y ascending)
      const colSorted = [...cluster].sort(
        (a, b) => polygonBounds(a.polygon).y - polygonBounds(b.polygon).y
      );

      let subCluster: InputLine[] = [];
      let subClusterMaxBot: number | null = null;
      let prevText = '';

      for (const l of colSorted) {
        const { y: ly, h: lh } = polygonBounds(l.polygon);
        const currTopY = ly;
        const currBotY = ly + lh;

        if (subClusterMaxBot !== null) {
          const vertGap = currTopY - subClusterMaxBot;
          const endsWithTerm = endsWithTerminalPunctuation(prevText);

          const isVertLobeSplit =
            vertGap >= Math.max(22.0, medianTh * 1.35) ||
            (endsWithTerm && vertGap >= Math.max(6.0, medianTh * 0.45));

          if (isVertLobeSplit && subCluster.length > 0) {
            finalVertUtterances.push(subCluster);
            subCluster = [];
            subClusterMaxBot = null;
          }
        }

        subCluster.push(l);
        subClusterMaxBot = subClusterMaxBot === null ? currBotY : Math.max(subClusterMaxBot, currBotY);
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
