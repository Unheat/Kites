import { createCanvas, type CanvasRenderingContext2D, type Image } from 'canvas';
import type { BubbleGeometry } from '../../offscreen/engines/bubble/BaseBubbleEngine.js';
import { resolveBubbleLayoutsDetailed } from '../../offscreen/services/BubbleLayoutService.js';
import { renderTextBlocksBatch, measureBubbleLayoutFontSize, type TextBlockItem } from '../../offscreen/utils/canvasTypesetting.js';
import type { OcrFixture, FixtureLayout } from './fixtureTypes.js';
import { FONT_FAMILY } from './fixtures.js';

type Curvatures = BubbleGeometry['curvatures'];

/** Build one aligned text block. @param ocr - Frozen input. @param texts - Fixed text. @param index - OCR index.
 * @returns Renderer source block before fixed geometry is applied.
 */
function sourceBlock(ocr: OcrFixture, texts: string[], index: number): TextBlockItem {
  return { text: texts[index], polygon: ocr.polygons[index], fontSize: ocr.fontSizes?.[index],
    direction: ocr.directions?.[index], angle: ocr.angles?.[index], originalText: ocr.texts[index],
    sourceLineCount: ocr.lineCounts?.[index] };
}

/** Use actual production fit gate. @param geometry - Engine evidence. @param ocr - Frozen OCR.
 * @param texts - Fixed text. @param ctx - Measurement context. @returns Production resolved layout.
 */
export function resolveHarnessLayout(geometry: BubbleGeometry, ocr: OcrFixture, texts: string[], ctx: CanvasRenderingContext2D) {
  return resolveBubbleLayoutsDetailed({
    ...geometry, boxes: ocr.boxes, directions: ocr.directions, angles: ocr.angles,
    pageWidth: ocr.metadata.pageWidth, pageHeight: ocr.metadata.pageHeight,
    accept: (index, proposed) => {
      const curv = geometry.curvatures?.[index];
      const block: TextBlockItem = { ...sourceBlock(ocr, texts, index), isRounded: curv?.isRounded,
        borderRadius: curv?.borderRadius, typesetMode: curv?.isRounded ? 'contour' : 'simple' };
      return measureBubbleLayoutFontSize(ctx as any, block, proposed, FONT_FAMILY, true) > 0;
    },
  });
}

/** Compose renderer blocks; normalize JSON null array slots back to undefined.
 * @param ocr - Frozen OCR. @param texts - Fixed same-text input. @param layout - Resolved layout.
 * @param curvatures - Engine curvature. @returns Renderer blocks in original OCR order.
 */
export function buildRenderBlocks(ocr: OcrFixture, texts: string[], layout: FixtureLayout, curvatures: Curvatures): TextBlockItem[] {
  return texts.flatMap((text, i) => {
    if (!text || !ocr.polygons[i]) return [];
    const typesetBox = layout.typesetBoxes[i] ?? undefined;
    const fixed = typesetBox !== undefined;
    const curv = fixed ? curvatures?.[i] : undefined;
    return [{ ...sourceBlock(ocr, texts, i), direction: ocr.directions?.[i] || 'h', typesetBox,
      isRounded: fixed ? Boolean(curv?.isRounded) : false,
      borderRadius: fixed ? (curv?.borderRadius ?? 0) : 0,
      typesetMode: fixed ? (curv?.isRounded ? 'contour' : 'simple') : 'balloon',
      contourPoints: fixed ? (layout.contourPoints[i] ?? undefined) : undefined }];
  });
}

/** Render with actual batch renderer. @param ocr - Frozen OCR. @param texts - Fixed text.
 * @param layout - Accepted geometry. @param curvatures - Engine curvature. @param background - Optional cleaned image.
 * @returns Canvas and production render metadata. Native Canvas does not establish browser pixel parity.
 */
export function renderHarnessLayout(ocr: OcrFixture, texts: string[], layout: FixtureLayout, curvatures: Curvatures, background?: Image) {
  const { pageWidth: width, pageHeight: height } = ocr.metadata;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (background) ctx.drawImage(background, 0, 0);
  const blocks = buildRenderBlocks(ocr, texts, layout, curvatures);
  const renderInfos = renderTextBlocksBatch(ctx as any, blocks, 'en', { width, height }, FONT_FAMILY, true);
  return { canvas, renderInfos };
}
