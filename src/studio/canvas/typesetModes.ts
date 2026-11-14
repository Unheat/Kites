/**
 * typesetModes.ts
 * Availability rules for the Studio typesetting engine switcher.
 *
 * Provenance problem this module solves: `typesetMode` records the engine a text object is
 * using *right now*, so a bubble that the user switched to Caption Box / Balanced Fit no longer
 * says "contour". Using it as the availability gate would trap that bubble out of Bubble Contour
 * forever. The detected chamber polygon (`contourPoints`, and its `originalContourPoints`
 * baseline) is the durable evidence that this text sits inside a bubble, and it survives every
 * mode switch — that is what these helpers read.
 */

import {
  availableTypesetModes,
  TYPESET_MODES,
  type TypesetMode,
} from '../../shared/constants';
import type { TextObject } from '../types';

/** Minimum vertices for a polygon the contour solver can actually fit inside. */
export const MIN_CONTOUR_POINTS = 3;

/** Object fields that carry detected bubble-chamber evidence. */
export type ContourEvidence = Pick<TextObject, 'contourPoints' | 'originalContourPoints'>;

/**
 * Reports whether an object belongs to a detected bubble chamber.
 *
 * Either polygon counts: `originalContourPoints` is the pristine detection baseline and is
 * present even if `contourPoints` was cleared, while `contourPoints` is what the canvas draws
 * and what the solver reads.
 *
 * @param object - Text object (or a pick of its contour fields), possibly undefined.
 * @returns True when a drawable chamber polygon exists.
 */
export function hasBubbleContour(object: ContourEvidence | undefined | null): boolean {
  if (!object) return false;
  return (object.contourPoints?.length ?? 0) >= MIN_CONTOUR_POINTS
    || (object.originalContourPoints?.length ?? 0) >= MIN_CONTOUR_POINTS;
}

/**
 * Lists the engines the switcher may offer for this object.
 * @param object - Text object whose bubble membership is being checked.
 * @returns Contour plus the two contour-free engines for bubbles; the two contour-free engines
 *          only for captions/narration/free text.
 */
export function availableTypesetModesFor(object: ContourEvidence | undefined | null): TypesetMode[] {
  return availableTypesetModes(hasBubbleContour(object));
}

/**
 * Reports whether one engine may be selected for this object.
 * @param object - Text object being edited.
 * @param mode - Engine the user wants.
 * @returns True when the object can actually fit with that engine.
 */
export function isTypesetModeAvailable(
  object: ContourEvidence | undefined | null,
  mode: TypesetMode
): boolean {
  return availableTypesetModesFor(object).includes(mode);
}

/**
 * Resolves the engine an edit should really use.
 *
 * A requested mode that the object cannot fit with (e.g. the global default is Bubble Contour
 * while the selection is a caption, or an older document stored `contour` on free text) falls
 * back to the first engine both the object and the canonical catalog allow.
 *
 * @param object - Text object being edited.
 * @param requested - Requested engine, if any.
 * @returns Requested mode when available, otherwise the first available fallback.
 */
export function resolveTypesetMode(
  object: ContourEvidence | undefined | null,
  requested: TypesetMode | undefined
): TypesetMode {
  if (requested && isTypesetModeAvailable(object, requested)) return requested;
  const allowed = availableTypesetModesFor(object);
  // `TYPESET_MODES` order is the canonical preference order, so the first allowed entry wins.
  return TYPESET_MODES.find((mode) => allowed.includes(mode)) ?? 'balloon';
}
