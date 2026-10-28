import type { BoxRect } from '../../utils/bubbleExpansion';
import type { ImagePatchData } from './HeuristicBubbleExtractor';
import { fillEnclosedInk, samplePaperPatch, selectPaperComponent, type PaperComponent, type PaperPatch } from './heuristicPaperComponents';
import { incompleteFrontier, validatePaperCandidate } from './heuristicCandidateValidation';

/** Initial search margin, not a semantic limit on balloon size or sibling distance. */
const MIN_SEARCH_MARGIN = 50;
/** Native-resolution buffers are bounded independently from page dimensions. */
export const MAX_HEURISTIC_ROI_PIXELS = 2_000_000;
/** Each incomplete side grows geometrically; this also bounds worst-case repeated work. */
const MAX_SEARCH_PASSES = 10;
const SEARCH_GROWTH_RATIO = 0.5;
/** Probe the established adaptive luminance allowance rather than adjacent gray levels alone. */
const STABILITY_THRESHOLD_DELTA = 24;
/** Preserve antialiasing tolerance at pure channel extremes. */
const STABILITY_CHANNEL_EXTREME_MARGIN = 5;
/** A real paper cavity should not radically change with a small luminance perturbation. */
const MIN_STABLE_COMPONENT_IOU = 0.85;
/** Letter counters are smaller than a glyph; independent cavities are not ink holes. */
const GLYPH_COUNTER_AREA_RATIO = 0.25;

export interface HeuristicSearchSettings {
  dark: boolean;
  threshold: number;
  maxPixels?: number;
}
export type HeuristicSearchResult =
  | { status: 'accepted'; patch: PaperPatch; component: PaperComponent; filled: Uint8Array; passes: number }
  | { status: 'rejected'; reason: string; passes: number };

/** @param image Raw pixels. @param text OCR bounds. @returns Clamped initial native-pixel crop. */
export function initialSearchBounds(image: ImagePatchData, text: BoxRect): BoxRect {
  const padX = Math.max(MIN_SEARCH_MARGIN, Math.ceil(text.w));
  const padY = Math.max(MIN_SEARCH_MARGIN, Math.ceil(text.h));
  const x = Math.max(0, Math.floor(text.x - padX)), y = Math.max(0, Math.floor(text.y - padY));
  return { x, y, w: Math.min(image.width, Math.ceil(text.x + text.w + padX)) - x,
    h: Math.min(image.height, Math.ceil(text.y + text.h + padY)) - y };
}
/** @param image Raw pixels. @param bounds Current crop. @param sides Incomplete artificial frontiers. @returns Expanded crop. */
function growBounds(image: ImagePatchData, bounds: BoxRect, sides: PaperComponent['frontier']): BoxRect {
  const dx = Math.ceil(bounds.w * SEARCH_GROWTH_RATIO), dy = Math.ceil(bounds.h * SEARCH_GROWTH_RATIO);
  const x = sides.left ? Math.max(0, bounds.x - dx) : bounds.x;
  const y = sides.top ? Math.max(0, bounds.y - dy) : bounds.y;
  const right = Math.min(image.width, bounds.x + bounds.w + (sides.right ? dx : 0));
  const bottom = Math.min(image.height, bounds.y + bounds.h + (sides.bottom ? dy : 0));
  return { x, y, w: right - x, h: bottom - y };
}
/** @param image Raw pixels. @param patch Accepted-size crop. @param mask Candidate cavity. @param text OCR bounds. @param settings Polarity and threshold. @returns Whether small threshold shifts preserve this cavity. */
function stableCandidate(image: ImagePatchData, patch: PaperPatch, mask: Uint8Array, text: BoxRect, settings: HeuristicSearchSettings): boolean {
  for (const delta of [-STABILITY_THRESHOLD_DELTA, STABILITY_THRESHOLD_DELTA]) {
    const threshold = Math.max(STABILITY_CHANNEL_EXTREME_MARGIN, Math.min(255 - STABILITY_CHANNEL_EXTREME_MARGIN, settings.threshold + delta));
    const probe = samplePaperPatch(image, patch.bounds, threshold, settings.dark);
    const selected = selectPaperComponent(probe, text);
    if (!selected) return false;
    const filled = fillEnclosedInk(selected.mask, patch.bounds.w, probe.mask, Math.min(text.w, text.h) ** 2 * GLYPH_COUNTER_AREA_RATIO);
    let intersection = 0, union = 0;
    for (let i = 0; i < mask.length; i++) { intersection += Number(Boolean(mask[i] && filled[i])); union += Number(Boolean(mask[i] || filled[i])); }
    if (intersection / Math.max(1, union) < MIN_STABLE_COMPONENT_IOU) return false;
  }
  return true;
}
/** Follows actual paper frontiers beyond local crops; artificial crop closure never certifies a bubble.
 * @param image Original image. @param text OCR region supplying paper anchors. @param settings Classifier and resource limits. @returns Supported complete component or explicit rejection. */
export function discoverHeuristicRegion(image: ImagePatchData, text: BoxRect, settings: HeuristicSearchSettings): HeuristicSearchResult {
  let bounds = initialSearchBounds(image, text);
  for (let pass = 1; pass <= MAX_SEARCH_PASSES; pass++) {
    if (bounds.w * bounds.h > (settings.maxPixels ?? MAX_HEURISTIC_ROI_PIXELS)) return { status: 'rejected', reason: 'pixel-budget', passes: pass };
    const patch = samplePaperPatch(image, bounds, settings.threshold, settings.dark);
    const component = selectPaperComponent(patch, text);
    if (!component) return { status: 'rejected', reason: 'no-observed-paper', passes: pass };
    const frontier = incompleteFrontier(component, patch, image);
    if (Object.values(frontier).some(Boolean)) { bounds = growBounds(image, bounds, frontier); continue; }
    const filled = fillEnclosedInk(component.mask, bounds.w, patch.mask, Math.min(text.w, text.h) ** 2 * GLYPH_COUNTER_AREA_RATIO);
    const reason = validatePaperCandidate(image, patch, component, filled, text);
    if (reason) return { status: 'rejected', reason, passes: pass };
    if (!stableCandidate(image, patch, filled, text, settings)) return { status: 'rejected', reason: 'unstable-paper', passes: pass };
    return { status: 'accepted', patch, component, filled, passes: pass };
  }
  return { status: 'rejected', reason: 'pass-budget', passes: MAX_SEARCH_PASSES };
}
