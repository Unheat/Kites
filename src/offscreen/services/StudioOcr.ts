import type { PopupState, StudioOcrPayload } from '../../shared/types';
import { calculateRotationAngle } from '../../shared/utils/geometry';
import type { Point2D } from '../engines/inpaint/BaseInpaintEngine';
import type { OcrResult } from '../engines/ocr/BaseOcrEngine';
import type { OcrManager } from './OcrManager';
import type { InpaintManager, InpaintTier } from './InpaintManager';
import type { TranslationManager } from './TranslationManager';
import type { BubbleManager } from './BubbleManager';
import { SUPPORTED_INPAINT_IDS } from '../../shared/inpaintTiers';
import { getRenderedBlockGeometry } from '../utils/canvasTypesetting';
import { detectBlockTextColors, type DetectedTextColor } from '../utils/textColorDetection';
import { resolveBubbleLayoutsDetailed, type BubbleGeometry } from './BubbleLayoutService';
import { precomputeStudioOcrLayouts } from './studioOcrTypeset';
import { createPageBubbleOwnership, type PageBubbleOwnership } from './PageBubbleOwnership';
import { analyzePageText } from './PageTextAnalysis';
import { DEFAULT_SFX_POLICY, isPreservedArtwork, resolveSfxPolicyStrategy } from '../../shared/sfx/sfxPolicy';
import { DEFAULT_OCR_TIER_ID } from '../../shared/ocrTiers';
import type { BoxRect } from '../utils/bubbleExpansion';

// Preserve Studio's minimum editable text-handle dimensions.
const MIN_TEXT_OBJECT_SIZE = 20;
// Polygon-only inference contract requires at least a triangle.
const MIN_POLYGON_POINTS = 3;
// Include all supported inpaint tiers derived from canonical catalog
const INPAINT_TIERS: readonly string[] = Array.from(SUPPORTED_INPAINT_IDS);

/**
 * Creates a canvas and 2D context safely across worker, offscreen, and node-test runtimes.
 */
function createSafeCanvas(width: number, height: number): { canvas: any; ctx: any } | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  }
  return null;
}

export interface StudioOcrDependencies {
  getPopupState: () => Promise<PopupState>;
  getOcrManager: () => Pick<OcrManager, 'processImage'>;
  getInpaintManager: () => Pick<InpaintManager, 'eraseText'>;
  translationManager: Pick<TranslationManager, 'processTranslation'>;
  blobToBase64: (blob: Blob) => Promise<string>;
  getBubbleManager?: () => BubbleManager;
}

export interface StudioOcrResponse {
  inpaintedPatchBase64: string;
  textObjects: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    originalText: string;
    fontSize?: number;
    fontFamily?: string;
    bold?: boolean;
    targetLang?: string;
    positionedLines?: import('../utils/contourTypeset').PositionedLine[];
    lines?: string[];
    lineSpacing?: number;
    typesetMode?: string;
    borderRadius?: number;
    isRounded?: boolean;
    contourPoints?: Point2D[];
    isVertical?: boolean;
    /** OCR block rotation in degrees; Studio rotates the unrotated box around its center. */
    rotation: number;
    /** Detected per-bubble ink color ('#rrggbb'); undefined falls back to Studio defaults. */
    color?: string;
    /** Outline color derived from the detected ink; undefined falls back to Studio defaults. */
    strokeColor?: string;
    /** Outline thickness in pixels. */
    strokeWidth?: number;
    /** Horizontal alignment. */
    align?: 'left' | 'center' | 'right';
    /** Italic text. */
    italic?: boolean;
    /** True when the region is artwork Studio keeps as ink: never painted, never translated. */
    isArtwork?: boolean;
    /** True when `text` was reconstructed from pipeline-generated layout lines. */
    textFromGeneratedLines?: boolean;
  }>;
}

/**
 * Validates OCR polygon geometry without inventing masks from axis-aligned boxes.
 * @param polygon - Engine-provided geometry to check.
 * @returns Whether the polygon has finite coordinates and nonzero area.
 */
function isValidPolygon(polygon: Point2D[]): boolean {
  if (!Array.isArray(polygon) || polygon.length < MIN_POLYGON_POINTS) return false;
  let twiceArea = 0;
  for (let i = 0; i < polygon.length; i++) {
    const point = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    if (!point || !next || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    twiceArea += point.x * next.y - next.x * point.y;
  }
  return Number.isFinite(twiceArea) && twiceArea !== 0;
}

/**
 * Normalizes the actual OcrManager parallel-array result, preserving text/polygon pairs.
 * @param result - Merged texts, polygons, and optional raw line polygons.
 * @returns Nonblank text regions; malformed nonempty results throw rather than look empty.
 */
function normalizeRegions(result: OcrResult) {
  if (!result || !Array.isArray(result.texts) || result.texts.some(text => typeof text !== 'string')) {
    throw new Error('Studio OCR returned invalid texts.');
  }
  if (result.texts.length === 0) return [];
  if (!Array.isArray(result.polygons) || result.polygons.length !== result.texts.length) {
    throw new Error('Studio OCR requires one polygon per text region.');
  }
  return result.texts.flatMap((text, index) => {
    if (!text.trim()) return [];
    const polygon = result.polygons![index];
    if (!isValidPolygon(polygon)) throw new Error(`Studio OCR returned invalid polygon at region ${index}.`);
    return [{ text, polygon, index }];
  });
}

/**
 * Reads image bytes and rejects HTTP failures before inference.
 * @param dataUrl - Recognition or edited-background crop data URL.
 * @returns Original encoded image bytes.
 */
async function readPatch(dataUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error(`Studio OCR patch could not be read (${response.status}).`);
  return response.arrayBuffer();
}

/**
 * Executes localized re-OCR, optional translation, and optional background inpainting
 * for Studio V2. Recognition uses original artwork; cleaning preserves edited raster.
 * @param payload - Crop, page offsets, engine overrides, and independently optional steps.
 * @param dependencies - Existing offscreen services and browser serialization adapters.
 * @returns Page-space text objects and cleaned (or exactly unchanged) background patch.
 */
export async function runStudioOcr(
  payload: StudioOcrPayload,
  dependencies: StudioOcrDependencies,
): Promise<StudioOcrResponse> {
  const imageBuffer = await readPatch(payload.imagePatchBase64);
  const popupState = await dependencies.getPopupState();

  // Balloon ownership is resolved per raw line inside the OCR stage, before merging, so the
  // detection canvas must exist first. Studio uses the same ownership service as the reader.
  const bubbleMode = popupState.bubbleMode;
  let safeCanvas: ReturnType<typeof createSafeCanvas> = null;
  let ownership: PageBubbleOwnership | undefined;
  if (bubbleMode && bubbleMode !== 'off' && dependencies.getBubbleManager && typeof createImageBitmap !== 'undefined') {
    safeCanvas = createSafeCanvas(payload.width, payload.height);
    if (safeCanvas) {
      const safeCtx = safeCanvas.ctx;
      const patchBitmap = await createImageBitmap(new Blob([imageBuffer], { type: 'image/png' }));
      try {
        safeCtx.drawImage(patchBitmap, 0, 0);
      } finally {
        patchBitmap.close();
      }
      ownership = createPageBubbleOwnership({
        acquireEngine: () => dependencies.getBubbleManager!().acquireEngine(bubbleMode, popupState),
        canvas: safeCanvas.canvas as any,
        // ImagePatchData contract: a real pixel buffer, not the 2D context — passing the ctx made
        // heuristic carrier extraction throw on the missing .data buffer and silently skip layout.
        // Supplied lazily: pages with at most one raw line never run the bubble tier.
        image: () => safeCtx.getImageData(0, 0, payload.width, payload.height),
        pageWidth: payload.width,
        pageHeight: payload.height,
        bubbleMode,
        popupState,
      });
    }
  }

  // Shared prefix with the reader: OCR (ownership-gated) then region geometry projection.
  const analysis = await analyzePageText({
    ocrManager: dependencies.getOcrManager(),
    imageBuffer,
    ocrTier: payload.ocrEngineId || popupState.activeOcrId || DEFAULT_OCR_TIER_ID,
    ocrContext: {
      sourceLang: popupState.sourceLang !== 'auto' ? popupState.sourceLang : undefined,
      pageWidth: payload.width,
      pageHeight: payload.height,
      sfxPolicy: popupState?.sfxPolicy ?? DEFAULT_SFX_POLICY,
    },
    ownership,
  });
  const result = analysis.ocrResult;
  const regions = normalizeRegions(result);
  const unchangedPatch = payload.backgroundPatchBase64 ?? payload.imagePatchBase64;
  console.log(`[Studio OCR] Detected ${regions.length} regions; translate=${payload.translate !== false}, inpaint=${payload.inpaint !== false}.`);
  if (regions.length === 0) return { inpaintedPatchBase64: unchangedPatch, textObjects: [] };

  // Per-region ink detection on the ORIGINAL patch bytes ("Recognition uses original
  // artwork"), so Studio text objects inherit each bubble's real text color with
  // snap-to-pure-black/white normalization instead of assuming black-on-white.
  let detectedTextColors: (DetectedTextColor | null)[] = [];
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const sourceBitmap = await createImageBitmap(new Blob([imageBuffer], { type: 'image/png' }));
      try {
        detectedTextColors = await detectBlockTextColors(sourceBitmap, result.boxes);
      } finally {
        sourceBitmap.close();
      }
    } catch (err) {
      console.warn('[Studio OCR] Text color detection failed; using default colors:', err);
    }
  }

  const originalTexts = regions.map(region => region.text);
  // Studio never paints artwork, so its text is never needed: translating it buys tokens for a
  // string that is discarded. The page pipeline decides the same boundary before dispatch, and both
  // read the one rule so a policy change cannot leave one of them paying for ink.
  const studioSfxPolicy = popupState?.sfxPolicy ?? DEFAULT_SFX_POLICY;
  const studioArtworkStrategy = resolveSfxPolicyStrategy(studioSfxPolicy);
  const artworkIndices = new Set(
    (result.artwork ?? [])
      .filter((item) => isPreservedArtwork(item.kind, studioArtworkStrategy))
      .map((item) => item.index),
  );
  const translatablePositions: number[] = [];
  regions.forEach((region, position) => {
    if (!artworkIndices.has(region.index)) translatablePositions.push(position);
  });
  let texts = originalTexts;
  if (payload.translate !== false && translatablePositions.length > 0) {
    const effectiveState = payload.translationEngineId
      ? { ...popupState, activeEngineId: payload.translationEngineId }
      : popupState;
    // TranslationManager owns fallback chains. Exhausted chains must reach Studio as errors.
    const translated = await dependencies.translationManager.processTranslation(
      translatablePositions.map(position => originalTexts[position]), popupState.sourceLang || 'auto', popupState.targetLang || 'en', undefined, effectiveState,
    );
    if (!Array.isArray(translated) || translated.length !== translatablePositions.length || translated.some(text => typeof text !== 'string' || !text.trim())) {
      throw new Error('Studio OCR translation returned incomplete text regions.');
    }
    // Scatter the answer back so every downstream index stays aligned with `regions`.
    texts = [...originalTexts];
    translatablePositions.forEach((position, offset) => {
      texts[position] = translated[offset];
    });
  }

  let inpaintedPatchBase64 = unchangedPatch;
  if (payload.inpaint !== false) {
    // OcrManager supplies surviving unmerged lines for precise masks. Never forward DBNet maskRawCanvas.
    // If blank regions were removed here, only mask retained renderable polygons.
    // Preserved artwork keeps its original ink, so exclude it from the erase mask the same way the
    // page pipeline does. The artwork gate above already decided which indices are preserved.
    const useRawPolygons = regions.length === result.texts.length && Boolean(result.rawPolygons?.length);
    const maskCandidates = useRawPolygons
      ? result.rawPolygons!
      : regions.map(region => region.polygon);
    const maskPolygons = maskCandidates.filter((_, i) => {
      if (useRawPolygons) return !artworkIndices.has(i);
      const region = regions[i];
      return region ? !artworkIndices.has(region.index) : true;
    });
    if (!maskPolygons.every(isValidPolygon)) throw new Error('Studio OCR returned invalid inpaint polygons.');
    const backgroundBuffer = payload.backgroundPatchBase64 && payload.backgroundPatchBase64 !== payload.imagePatchBase64
      ? await readPatch(payload.backgroundPatchBase64)
      : imageBuffer;
    const inpaintTier = payload.inpaintEngineId || popupState.activeInpaintId || 'lama-manga';
    if (!INPAINT_TIERS.includes(inpaintTier)) throw new Error(`Studio OCR received unknown inpaint tier: ${inpaintTier}.`);
    const cleanedBuffer = await dependencies.getInpaintManager().eraseText(
      backgroundBuffer, maskPolygons, inpaintTier as InpaintTier,
    );
    inpaintedPatchBase64 = await dependencies.blobToBase64(new Blob([cleanedBuffer], { type: 'image/png' }));
  }

  // Speech bubble carrier detection & layout expansion for Studio Retranslate
  let resolvedLayouts: (BoxRect | undefined)[] = [];
  let bubbleContours: (Point2D[] | undefined)[] = [];
  let bubbleGeometry: BubbleGeometry | undefined = undefined;
  // OCR-index-aligned flags for fragments absorbed into a dominant chamber (noise guard).
  let bubbleSkipped: boolean[] = [];

  if (ownership) {
    try {
      bubbleGeometry = analysis.bubbleGeometry;
      if (bubbleGeometry) {
        const detailed = resolveBubbleLayoutsDetailed({
          ...bubbleGeometry,
          boxes: result.boxes,
          directions: result.directions,
          angles: result.angles,
          pageWidth: payload.width,
          pageHeight: payload.height,
          accept: () => true
        });
        resolvedLayouts = detailed.typesetBoxes;
        bubbleSkipped = detailed.skipped ?? [];

        bubbleContours = result.boxes.map((_, bIdx) => {
          if (detailed.contourPoints?.[bIdx]) return detailed.contourPoints[bIdx];
          const box = resolvedLayouts[bIdx];
          if (!box) return undefined;
          return [
            { x: 0, y: 0 },
            { x: box.w, y: 0 },
            { x: box.w, y: box.h },
            { x: 0, y: box.h }
          ];
        });
      }
    } catch (bErr) {
      console.warn('[Studio OCR] Bubble detection skipped or failed:', bErr);
    }
  }

  const timestamp = Date.now();
  const textObjects = regions.map(({ polygon, text: originalText, index: origIndex }, index) => {
    const xs = polygon.map(point => point.x);
    const ys = polygon.map(point => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const resolvedIndex = origIndex ?? index;
    const detectedFontSize = result.fontSizes?.[resolvedIndex];
    const detectedDirection = result.directions?.[resolvedIndex];
    const isVertical = detectedDirection === 'v';

    const expandedBox = resolvedLayouts[resolvedIndex];
    const rawGeometry = getRenderedBlockGeometry(polygon) ?? {
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY,
    };
    const geometry = expandedBox
      ? { x: expandedBox.x, y: expandedBox.y, w: expandedBox.w, h: expandedBox.h }
      : rawGeometry;

    const contourPoints = bubbleContours[resolvedIndex] || [
      { x: 0, y: 0 },
      { x: geometry.w, y: 0 },
      { x: geometry.w, y: geometry.h },
      { x: 0, y: geometry.h }
    ];


    // Prefer OcrManager's snapped block angle; older/partial engine results fall back to
    // the source polygon's top-edge rotation. Missing angle must stay an upright block.
    const detectedAngle = result.angles?.[resolvedIndex];
    const rotation = typeof detectedAngle === 'number' && Number.isFinite(detectedAngle)
      ? detectedAngle
      : (calculateRotationAngle(polygon) * 180) / Math.PI;

    const curvature = bubbleGeometry?.curvatures?.[resolvedIndex];
    const rawContour = bubbleContours[resolvedIndex] ?? bubbleGeometry?.contours?.[resolvedIndex];
    const hasOrganicContour = Boolean(rawContour && rawContour.length >= 3 && rawContour.length !== 4);
    const isRounded = hasOrganicContour || Boolean(curvature?.isRounded);
    const borderRadius = curvature?.borderRadius ?? (isRounded ? Math.round(Math.min(geometry.w, geometry.h) / 2) : 0);
      const typesetMode: 'contour' | 'simple' | 'balloon' = expandedBox
        ? (isRounded ? 'contour' : 'simple')
        : 'balloon';

    return {
      id: `ocr-${timestamp}-${index}`,
      x: payload.offsetX + geometry.x,
      y: payload.offsetY + geometry.y,
      width: Math.max(MIN_TEXT_OBJECT_SIZE, geometry.w),
      height: Math.max(MIN_TEXT_OBJECT_SIZE, geometry.h),
      text: texts[index],
      originalText,
        fontSize: typeof detectedFontSize === 'number' && Number.isFinite(detectedFontSize) && detectedFontSize > 0
          ? Math.round(detectedFontSize)
          : undefined,
      typesetMode,
      borderRadius,
      isRounded,
      contourPoints,
      isVertical,
      // Noise-guard absorbed fragments stay as editable dashed boxes in Studio
      // (StudioCanvas renders skipped objects without painting their text).
      isSkipped: bubbleSkipped[resolvedIndex] ?? false,
      // Preserved artwork keeps its original ink. The resolved SFX policy is forwarded into OCR and
      // applied to the artwork gate above, so translate-plainly sound effects are inpainted/translated
      // while preserve keeps them as artwork.
      isArtwork: artworkIndices.has(resolvedIndex),
      rotation,
      color: detectedTextColors[resolvedIndex]?.textColor,
      strokeColor: popupState.renderFontStrokeDisabled ? 'transparent' : detectedTextColors[resolvedIndex]?.strokeColor,
    };
  });
    const typography = await precomputeStudioOcrLayouts(textObjects.map((object) => ({
      text: object.text, box: { x: 0, y: 0, w: object.width, h: object.height },
      mode: object.typesetMode, isVertical: object.isVertical, contourPoints: object.contourPoints,
    })), popupState, (width, height) => createSafeCanvas(width, height)?.ctx ?? null);
    return { inpaintedPatchBase64, textObjects: textObjects.map((object, index) => ({
      ...object,
      fontFamily: typography.fontFamily,
      bold: typography.bold,
      italic: popupState.renderFontItalic ?? false,
      align: popupState.renderFontAlignment && popupState.renderFontAlignment !== 'auto'
        ? popupState.renderFontAlignment
        : 'center',
      strokeWidth: popupState.renderFontStrokeDisabled ? 0 : 2,
      targetLang: typography.targetLang,
      ...(typography.layouts[index] ? { fontSize: typography.layouts[index]!.fontSize,
        lines: typography.layouts[index]!.lines, positionedLines: typography.layouts[index]!.positionedLines,
        // These lines are renderer output, so a later contour/caption resize may re-flow them.
        textFromGeneratedLines: true } : {}),
    })) };
}
