import { HeuristicBubbleExtractor, type BubbleShapeEvidence, type ImagePatchData } from '../engines/bubble/HeuristicBubbleExtractor';
import { NeuralBubbleDetector } from '../engines/bubble/NeuralBubbleDetector';
import { boxIoU, bubbleCore, computeTypesetBox, SHARED_CONTAINER_IOU, SIBLING_GAP, type BoxRect } from '../utils/bubbleExpansion';

/** Experimental fit guard, compared only with a caller-supplied valid source reference. */
export const MIN_SHARED_FONT_RATIO = 0.85;
/** Production and visual harness intentionally share the same association threshold. */
export const BUBBLE_MATCH_COVERAGE = 0.50;

export interface BubbleGeometry {
  pageWidth: number;
  carriers: (BoxRect | null)[];
  /** Object identity is the neural proposal identity, not rectangle overlap. */
  proposals: (BoxRect | null)[];
  shapes: (BubbleShapeEvidence | undefined)[];
}

export interface BubbleLayoutInput extends BubbleGeometry {
  boxes: BoxRect[];
  directions?: string[];
  angles?: number[];
  pageWidth: number;
  pageHeight: number;
  /** Runs after translation and font readiness. False rolls the entire candidate group back. */
  accept: (index: number, proposed: BoxRect, minimumFontRatio?: number) => boolean;
  /** Optional concise production/harness diagnostics; counts reflect final post-rollback results. */
  onDiagnostics?: (counts: { single: number; xy: number; fallback: number }) => void;
}

/**
 * Acquires geometry without translating, fitting fonts, or mutating OCR/inpaint geometry.
 * @param image - Original image pixels.
 * @param boxes - Original utterance boxes.
 * @param neuralProposals - Optional class-0 proposals; missing matches use heuristic carriers.
 * @returns Aligned carriers, exact proposal references, and existing morphology evidence.
 */
export function acquireBubbleGeometry(image: ImagePatchData, boxes: BoxRect[], neuralProposals?: BoxRect[] | null): BubbleGeometry {
  const carriers: (BoxRect | null)[] = [];
  const proposals: (BoxRect | null)[] = [];
  const shapes: (BubbleShapeEvidence | undefined)[] = [];
  boxes.forEach((box, index) => {
    const proposal = NeuralBubbleDetector.matchBubble(box, neuralProposals ?? [], BUBBLE_MATCH_COVERAGE);
    proposals[index] = proposal;
    const heuristic = HeuristicBubbleExtractor.extractCarrierBox(image, box, {
      allTextBoxes: boxes,
      onShapeEvidence: (shape) => { shapes[index] = shape; }
    });
    carriers[index] = proposal ?? heuristic;
  });
  return { pageWidth: image.width, carriers, proposals, shapes };
}

/** @param a - Outer rectangle. @param b - Inner rectangle. @returns Whether all inner edges are contained. */
function contains(a: BoxRect, b: BoxRect): boolean {
  return b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
}

/** @param a - First rectangle. @param b - Second rectangle. @returns Positive-area intersection. */
function overlaps(a: BoxRect, b: BoxRect): boolean {
  return Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x)
    && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
}

/**
 * Labels existing local mask components, recording components that escape the patch boundary.
 * @param mask - Existing binary interior or erosion mask.
 * @param shape - Local patch geometry.
 * @returns Component labels and boundary-touching IDs; no new segmentation or image processing.
 */
function labelComponents(mask: Uint8Array, shape: BubbleShapeEvidence): { labels: Int32Array; open: Set<number> } {
  const { width, height } = shape;
  const labels = new Int32Array(mask.length);
  const open = new Set<number>();
  let id = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    id++;
    const queue = [start];
    labels[start] = id;
    for (let head = 0; head < queue.length; head++) {
      const pixel = queue[head];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) open.add(id);
      const neighbors = [x > 0 ? pixel - 1 : -1, x + 1 < width ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1, y + 1 < height ? pixel + width : -1];
      for (const next of neighbors) {
        if (next >= 0 && mask[next] && !labels[next]) {
          labels[next] = id;
          queue.push(next);
        }
      }
    }
  }
  return { labels, open };
}

/** @param shape - Patch geometry. @param box - Source box. @returns Center pixel index, or -1 outside patch. */
function centerPixel(shape: BubbleShapeEvidence, box: BoxRect): number {
  const x = Math.round((box.x + box.w / 2 - shape.x) * shape.scale);
  const y = Math.round((box.y + box.h / 2 - shape.y) * shape.scale);
  return x >= 0 && y >= 0 && x < shape.width && y < shape.height ? y * shape.width + x : -1;
}

/**
 * Requires one enclosed raw component and distinct eroded components at every source center.
 * This is neck evidence from the extractor's existing morphology, never IoMin-only connectivity.
 * @param shape - Existing morphology buffers.
 * @param boxes - All siblings to validate together.
 * @returns Trusted interior label map, or undefined if evidence is insufficient.
 */
function connectedLobes(shape: BubbleShapeEvidence, boxes: BoxRect[]): { labels: Int32Array; id: number } | undefined {
  const patch = { x: shape.x, y: shape.y, w: shape.width / shape.scale, h: shape.height / shape.scale };
  const centers = boxes.map((box) => centerPixel(shape, box));
  if (centers.some((pixel) => pixel < 0) || boxes.some((box) => !contains(patch, box))) return undefined;
  const raw = labelComponents(shape.interior, shape);
  const id = raw.labels[centers[0]];
  if (!id || raw.open.has(id) || centers.some((pixel) => raw.labels[pixel] !== id)) return undefined;
  // Actual whitespace must connect the lobes without relying on force-filled OCR rectangles.
  const observed = labelComponents(shape.observedInterior, shape);
  const observedIds = boxes.map((box) => {
    const ids = new Set<number>();
    const left = Math.floor((box.x - shape.x) * shape.scale);
    const right = Math.min(shape.width - 1, Math.ceil((box.x + box.w - shape.x) * shape.scale));
    const top = Math.floor((box.y - shape.y) * shape.scale);
    const bottom = Math.min(shape.height - 1, Math.ceil((box.y + box.h - shape.y) * shape.scale));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const label = observed.labels[y * shape.width + x];
      if (label && !observed.open.has(label)) ids.add(label);
    }
    return ids;
  });
  if (![...observedIds[0]].some((label) => observedIds.every((ids) => ids.has(label)))) return undefined;
  const eroded = labelComponents(shape.eroded, shape);
  const lobeIds = centers.map((pixel) => eroded.labels[pixel]);
  if (lobeIds.some((lobe) => !lobe || eroded.open.has(lobe)) || new Set(lobeIds).size !== boxes.length) return undefined;
  return { labels: raw.labels, id };
}

/**
 * Checks every retained mask pixel under a proposed rectangle, not just its bounding-box corners.
 * @param shape - Trusted patch geometry. @param labels - Raw component IDs. @param id - Enclosed component.
 * @param box - Proposed fixed rectangle. @returns True only when the entire rectangle stays inside.
 */
function insideShape(shape: BubbleShapeEvidence, labels: Int32Array, id: number, box: BoxRect): boolean {
  const left = Math.floor((box.x - shape.x) * shape.scale);
  const top = Math.floor((box.y - shape.y) * shape.scale);
  const right = Math.ceil((box.x + box.w - shape.x) * shape.scale);
  const bottom = Math.ceil((box.y + box.h - shape.y) * shape.scale);
  if (left < 0 || top < 0 || right >= shape.width || bottom >= shape.height) return false;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) if (labels[y * shape.width + x] !== id) return false;
  }
  return true;
}

/**
 * Carves only a coherent simple X or Y chain, never negative/tiny gaps or true diagonals.
 * @param container - Shared carrier union. @param boxes - All original siblings.
 * @returns Territories in original order, or undefined for whole-group Disabled fallback.
 */
function axisTerritories(container: BoxRect, boxes: BoxRect[]): BoxRect[] | undefined {
  const core = bubbleCore(container);
  if (!core) return undefined;
  const axes = (['x', 'y'] as const).filter((axis) => {
    const other = axis === 'x' ? 'y' : 'x';
    const size = axis === 'x' ? 'w' : 'h';
    const otherSize = axis === 'x' ? 'h' : 'w';
    const sorted = [...boxes].sort((a, b) => a[axis] - b[axis]);
    // Common orthogonal span rules out zig-zags and diagonal chains, including >=3 siblings.
    if (Math.max(...boxes.map((b) => b[other])) >= Math.min(...boxes.map((b) => b[other] + b[otherSize]))) return false;
    return sorted.every((b, i) => i === 0 || b[axis] - (sorted[i - 1][axis] + sorted[i - 1][size]) >= SIBLING_GAP);
  });
  if (axes.length !== 1) return undefined;
  const axis = axes[0];
  const size = axis === 'x' ? 'w' : 'h';
  const sorted = boxes.map((box, index) => ({ box, index })).sort((a, b) => a.box[axis] - b.box[axis]);
  const territories: BoxRect[] = new Array(boxes.length);
  sorted.forEach(({ box, index }, position) => {
    const previous = sorted[position - 1]?.box;
    const next = sorted[position + 1]?.box;
    const low = previous ? (previous[axis] + previous[size] + box[axis] + SIBLING_GAP) / 2 : (axis === 'x' ? core.left : core.top);
    const high = next ? (box[axis] + box[size] + next[axis] - SIBLING_GAP) / 2 : (axis === 'x' ? core.right : core.bottom);
    territories[index] = axis === 'x'
      ? { x: low, y: core.top, w: high - low, h: core.bottom - core.top }
      : { x: core.left, y: low, w: core.right - core.left, h: high - low };
  });
  return territories.every((territory, index) => contains(territory, boxes[index])) ? territories : undefined;
}

/**
 * Resolves fixed bubble rectangles after translation/font readiness. Uncertain candidate groups
 * roll back atomically to undefined (exact Disabled), without moving any sibling or source box.
 * @param input - Aligned original geometry, proposal identity, masks, and actual renderer fit gate.
 * @returns Optional fixed boxes; undefined entries retain the untouched Disabled renderer path.
 */
export function resolveBubbleLayouts(input: BubbleLayoutInput): (BoxRect | undefined)[] {
  const { boxes, carriers, proposals, shapes, directions, angles, pageWidth, pageHeight, accept } = input;
  /** @param box - Candidate/source rectangle. @returns Finite positive geometry inside the page. */
  const validBox = (box: BoxRect): boolean => [box.x, box.y, box.w, box.h].every(Number.isFinite)
    && box.w > 0 && box.h > 0 && box.x >= 0 && box.y >= 0
    && box.x + box.w <= pageWidth && box.y + box.h <= pageHeight;
  const result: (BoxRect | undefined)[] = new Array(boxes.length).fill(undefined);
  const groups = boxes.map((_, index) => [index]);
  // Overlap/nesting is uncertainty, not proof. It must prevent independent full-carrier expansion.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = carriers[i], b = carriers[j];
      const candidate = proposals[i] && proposals[i] === proposals[j]
        || a && b && (boxIoU(a, b) >= SHARED_CONTAINER_IOU || contains(a, b) || contains(b, a) || overlaps(a, b));
      if (!candidate) continue;
      const first = groups.find((g) => g.includes(i))!;
      const second = groups.find((g) => g.includes(j))!;
      if (first !== second) { first.push(...second); groups.splice(groups.indexOf(second), 1); }
    }
  }
  for (const group of groups) {
    if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0
      || group.some((i) => !carriers[i] || !validBox(boxes[i]) || !validBox(carriers[i]!)
        || !Number.isFinite(angles?.[i] ?? 0) || (angles?.[i] ?? 0) !== 0)) continue;
    if (group.length === 1) {
      const i = group[0];
      const box = computeTypesetBox(boxes[i], carriers[i]!, directions?.[i] === 'v', pageHeight, !proposals[i]);
      if (validBox(box) && accept(i, box, MIN_SHARED_FONT_RATIO)) {
        result[i] = box;
      }
      continue;
    }
    const siblings = group.map((i) => boxes[i]);
    const left = Math.min(...group.map((i) => carriers[i]!.x));
    const top = Math.min(...group.map((i) => carriers[i]!.y));
    const container = { x: left, y: top, w: Math.max(...group.map((i) => carriers[i]!.x + carriers[i]!.w)) - left,
      h: Math.max(...group.map((i) => carriers[i]!.y + carriers[i]!.h)) - top };
    const territories = axisTerritories(container, siblings);
    if (!territories) continue;
    const evidence = group.map((i) => shapes[i]).filter((shape): shape is BubbleShapeEvidence => !!shape)
      .map((shape) => ({ shape, connection: connectedLobes(shape, siblings) })).find((item) => item.connection);
    if (!evidence?.connection) continue;
    const candidates = group.map((i, position) => computeTypesetBox(boxes[i], territories[position], directions?.[i] === 'v', pageHeight, true, true));
    if (candidates.every((box, position) => validBox(box) && contains(territories[position], box)
      && insideShape(evidence.shape, evidence.connection!.labels, evidence.connection!.id, box)
      && accept(group[position], box, MIN_SHARED_FONT_RATIO))) {
      group.forEach((i, position) => { result[i] = candidates[position]; });
    }
  }
  // Validate against fixed candidates AND untouched originals. Never post-clamp or mutate siblings.
  // Repeat rollback until stable: reverting a box can expose its wider original to another candidate.
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (!group.some((i) => result[i])) continue;
      if (group.some((i) => result[i] && boxes.some((original, j) => i !== j && overlaps(result[i]!, result[j] ?? original)))) {
        group.forEach((i) => { result[i] = undefined; });
        changed = true;
      }
    }
  }
  input.onDiagnostics?.({
    single: groups.filter((group) => group.length === 1 && result[group[0]]).length,
    xy: groups.filter((group) => group.length > 1).reduce((sum, group) => sum + group.filter((i) => result[i]).length, 0),
    fallback: result.filter((box) => !box).length
  });
  return result;
}
