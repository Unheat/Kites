import type { BubbleGeometry } from '../../offscreen/engines/bubble/BaseBubbleEngine.js';
import type { BoxRect } from '../../offscreen/utils/bubbleExpansion.js';
import type { Point2D } from '../../shared/utils/geometry.js';
import type { BaselineFixture, BoxDiff, FixtureLayout, RenderInfos } from './fixtureTypes.js';

const GEOMETRY_TOLERANCE = 0.5; // Existing half-pixel regression tolerance.

/** Compare rectangles. @param a - Current. @param b - Frozen. @returns Equality within tolerance. */
function isBoxEqual(a?: BoxRect | null, b?: BoxRect | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) <= GEOMETRY_TOLERANCE && Math.abs(a.y - b.y) <= GEOMETRY_TOLERANCE
    && Math.abs(a.w - b.w) <= GEOMETRY_TOLERANCE && Math.abs(a.h - b.h) <= GEOMETRY_TOLERANCE;
}

/** Compare contour vertices in order. @param a - Current. @param b - Frozen. @returns Equality within tolerance. */
function isContourEqual(a?: Point2D[] | null, b?: Point2D[] | null): boolean {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((point, i) => Math.abs(point.x - b[i].x) <= GEOMETRY_TOLERANCE
    && Math.abs(point.y - b[i].y) <= GEOMETRY_TOLERANCE);
}

/** Compare acquisition/layout/render stages, preserving original comparison contract.
 * @param geometry - Current evidence. @param layout - Current resolved geometry. @param renders - Current render metadata.
 * @param baseline - Frozen expected result. @param texts - Source OCR. @param mappedTexts - Fixed text.
 * @param changedPixelCount - Native rendered pixel difference. @returns Differential summary.
 */
export function compareBaseline(geometry: BubbleGeometry, layout: FixtureLayout, renders: RenderInfos,
  baseline: BaselineFixture, texts: string[], mappedTexts: string[], changedPixelCount: number) {
  const boxDiffs: BoxDiff[] = [];
  texts.forEach((originalText, i) => {
    const currCarrier = geometry.carriers[i], baseCarrier = baseline.carriers[i];
    const currProposal = geometry.proposals[i], baseProposal = baseline.proposals[i];
    const currCurv = geometry.curvatures?.[i], baseCurv = baseline.curvatures?.[i];
    const currContour = geometry.contours?.[i], baseContour = baseline.contours?.[i];
    const currTypeset = layout.typesetBoxes[i], baseTypeset = baseline.resolvedLayout.typesetBoxes[i];
    const currRender = renders[i], baseRender = baseline.renderInfos[i];
    const carrierDiff = !isBoxEqual(currCarrier, baseCarrier);
    const proposalDiff = !isBoxEqual(currProposal, baseProposal);
    const curvatureDiff = Boolean(currCurv?.isRounded) !== Boolean(baseCurv?.isRounded)
      || (currCurv?.borderRadius ?? 0) !== (baseCurv?.borderRadius ?? 0);
    const contourDiff = !isContourEqual(currContour, baseContour);
    const typesetBoxDiff = !isBoxEqual(currTypeset, baseTypeset);
    const renderInfoDiff = currRender?.fontSize !== baseRender?.fontSize || currRender?.lineCount !== baseRender?.lineCount;
    if (!(carrierDiff || proposalDiff || curvatureDiff || contourDiff || typesetBoxDiff || renderInfoDiff)) return;
    const details: string[] = [];
    if (carrierDiff) details.push(`Carrier mismatch: curr=${JSON.stringify(currCarrier)} base=${JSON.stringify(baseCarrier)}`);
    if (proposalDiff) details.push(`Proposal mismatch: curr=${JSON.stringify(currProposal)} base=${JSON.stringify(baseProposal)}`);
    if (curvatureDiff) details.push(`Curvature mismatch: curr=${JSON.stringify(currCurv)} base=${JSON.stringify(baseCurv)}`);
    if (contourDiff) details.push(`Contour mismatch: currPoints=${currContour?.length ?? 0} basePoints=${baseContour?.length ?? 0}`);
    if (typesetBoxDiff) details.push(`TypesetBox mismatch: curr=${JSON.stringify(currTypeset)} base=${JSON.stringify(baseTypeset)}`);
    if (renderInfoDiff) details.push(`RenderInfo mismatch: currFont=${currRender?.fontSize} baseFont=${baseRender?.fontSize}`);
    boxDiffs.push({ boxIndex: i, originalText, mappedText: mappedTexts[i], carrierDiff, proposalDiff,
      curvatureDiff, contourDiff, typesetBoxDiff, renderInfoDiff, details });
  });
  return { baselineCompared: true, totalDifferences: boxDiffs.length, matchingBoxes: texts.length - boxDiffs.length,
    mismatchedBoxes: boxDiffs.length, boxDiffs, isIdenticalToBaseline: boxDiffs.length === 0 && changedPixelCount === 0 };
}
