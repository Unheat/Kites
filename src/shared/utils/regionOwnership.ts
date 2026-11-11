/**
 * Detection-region ownership: removes readings that swallow their own surroundings.
 *
 * OCR occasionally returns one box covering a whole balloon whose text disagrees with the two or
 * three column readings inside it (measured: `身体 要 来边1` over `喂一莲实酱，` and `一额一额的呢`).
 * Every one of those readings is translated separately, so the balloon gets two or three
 * translations drawn on top of each other.
 *
 * The donor rule set (XianScan `deduplicate_and_unify_regions`) does not fire here: it requires
 * shared text or near-identical boxes, and these readings share nothing at IoU 0.32. This module
 * adds the missing case as a pure geometric + textual rule.
 */

/** A detection region as this module sees it. */
export interface RegionCandidate {
  /** OCR text for the region. */
  readonly text: string;
  /** Axis-aligned bounding box in page pixels. */
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/** Fraction of a column's own area that must fall inside the container before it counts. */
const COLUMN_CONTAINMENT_RATIO = 0.6;

/** How many columns a container must swallow before it can be considered a bogus whole-balloon read. */
const MIN_CONTAINED_COLUMNS = 2;

/** Length of the text run used to prove a container read agrees with its contents. */
const SHARED_RUN_LENGTH = 3;

/**
 * Strips whitespace and punctuation so containment checks compare only meaningful glyphs.
 *
 * @param text - Raw region text.
 * @returns Glyph run without spaces or punctuation.
 */
function normalizeRegionText(text: string): string {
  return text.replace(/[\s、。,.！？!?…・「」『』（）()"'’‘\-ー~～]/g, '');
}

/**
 * Reports whether two normalized texts share any run of `SHARED_RUN_LENGTH` glyphs.
 *
 * @param a - First normalized text.
 * @param b - Second normalized text.
 * @returns True when a shared run exists, meaning the two readings agree on content.
 */
function sharesTextRun(a: string, b: string): boolean {
  if (a.length < SHARED_RUN_LENGTH || b.length < SHARED_RUN_LENGTH) return false;
  for (let i = 0; i + SHARED_RUN_LENGTH <= a.length; i++) {
    if (b.includes(a.slice(i, i + SHARED_RUN_LENGTH))) return true;
  }
  return false;
}

/**
 * Finds regions that cover several unrelated readings and should be dropped.
 *
 * A region is dropped only when all of these hold, so ordinary merged utterances (whose text is
 * built from the same lines) are never affected:
 * 1. it swallows at least two other regions (each ≥60% inside it),
 * 2. its text shares no 3-glyph run with any of them,
 * 3. it is not longer than the combined text of the regions it swallows.
 *
 * @param regions - Candidate regions in input order.
 * @returns Indices of regions to drop, ascending.
 */
export function findBogusContainerIndices(regions: readonly RegionCandidate[]): number[] {
  const normalized = regions.map((region) => normalizeRegionText(region.text));
  const dropped: number[] = [];

  for (let i = 0; i < regions.length; i++) {
    const container = regions[i].box;
    const containerArea = Math.max(1, container.width * container.height);
    if (containerArea <= 0) continue;
    const contained: number[] = [];

    for (let j = 0; j < regions.length; j++) {
      if (j === i) continue;
      const inner = regions[j].box;
      const innerArea = Math.max(1, inner.width * inner.height);
      // A container must be meaningfully larger than what it swallows.
      if (innerArea >= containerArea) continue;
      const overlapWidth = Math.max(0, Math.min(container.x + container.width, inner.x + inner.width) - Math.max(container.x, inner.x));
      const overlapHeight = Math.max(0, Math.min(container.y + container.height, inner.y + inner.height) - Math.max(container.y, inner.y));
      const overlapArea = overlapWidth * overlapHeight;
      if (overlapArea / innerArea < COLUMN_CONTAINMENT_RATIO) continue;
      if (normalized[j] === '') continue;
      contained.push(j);
    }

    if (contained.length < MIN_CONTAINED_COLUMNS) continue;
    if (contained.some((index) => sharesTextRun(normalized[i], normalized[index]))) continue;
    const containedLength = contained.reduce((sum, index) => sum + normalized[index].length, 0);
    if (normalized[i].length > containedLength) continue;

    dropped.push(i);
  }

  return dropped.sort((a, b) => a - b);
}
