import type { PopupState, StudioOcrPayload } from '../../shared/types';
import { calculateRotationAngle } from '../../shared/utils/geometry';
import type { Point2D } from '../engines/inpaint/BaseInpaintEngine';
import type { OcrResult } from '../engines/ocr/BaseOcrEngine';
import type { OcrManager } from './OcrManager';
import type { InpaintManager, InpaintTier } from './InpaintManager';
import type { TranslationManager } from './TranslationManager';
import { SUPPORTED_INPAINT_IDS } from '../../shared/inpaintTiers';
import { getRenderedBlockGeometry } from '../utils/canvasTypesetting';
import { detectBlockTextColors, type DetectedTextColor } from '../utils/textColorDetection';

// Preserve Studio's minimum editable text-handle dimensions.
const MIN_TEXT_OBJECT_SIZE = 20;
// Polygon-only inference contract requires at least a triangle.
const MIN_POLYGON_POINTS = 3;
// Include all supported inpaint tiers derived from canonical catalog
const INPAINT_TIERS: readonly string[] = Array.from(SUPPORTED_INPAINT_IDS);

export interface StudioOcrDependencies {
  getPopupState: () => Promise<PopupState>;
  getOcrManager: () => Pick<OcrManager, 'processImage'>;
  getInpaintManager: () => Pick<InpaintManager, 'eraseText'>;
  translationManager: Pick<TranslationManager, 'processTranslation'>;
  blobToBase64: (blob: Blob) => Promise<string>;
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
    isVertical?: boolean;
    /** OCR block rotation in degrees; Studio rotates the unrotated box around its center. */
    rotation: number;
    /** Detected per-bubble ink color ('#rrggbb'); undefined falls back to Studio defaults. */
    color?: string;
    /** Outline color derived from the detected ink; undefined falls back to Studio defaults. */
    strokeColor?: string;
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
  const result = await dependencies.getOcrManager().processImage(
    imageBuffer,
    payload.ocrEngineId || popupState.activeOcrId || 'v6-small',
    {
      sourceLang: popupState.sourceLang !== 'auto' ? popupState.sourceLang : undefined,
      pageWidth: payload.width,
      pageHeight: payload.height,
    },
  );
  const regions = normalizeRegions(result);
  const unchangedPatch = payload.backgroundPatchBase64 ?? payload.imagePatchBase64;
  console.log(`[Studio OCR] Detected ${regions.length} regions; translate=${payload.translate !== false}, inpaint=${payload.inpaint !== false}.`);
  if (regions.length === 0) return { inpaintedPatchBase64: unchangedPatch, textObjects: [] };

  // Per-region ink detection on the ORIGINAL patch bytes ("Recognition uses original
  // artwork"), so Studio text objects inherit each bubble's real text color with
  // snap-to-pure-black/white normalization instead of assuming black-on-white.
  let detectedTextColors: (DetectedTextColor | null)[] = [];
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

  const originalTexts = regions.map(region => region.text);
  let texts = originalTexts;
  if (payload.translate !== false) {
    const effectiveState = payload.translationEngineId
      ? { ...popupState, activeEngineId: payload.translationEngineId }
      : popupState;
    // TranslationManager owns fallback chains. Exhausted chains must reach Studio as errors.
    texts = await dependencies.translationManager.processTranslation(
      originalTexts, popupState.sourceLang || 'auto', popupState.targetLang || 'en', undefined, effectiveState,
    );
    if (!Array.isArray(texts) || texts.length !== regions.length || texts.some(text => typeof text !== 'string' || !text.trim())) {
      throw new Error('Studio OCR translation returned incomplete text regions.');
    }
  }

  let inpaintedPatchBase64 = unchangedPatch;
  if (payload.inpaint !== false) {
    // OcrManager supplies surviving unmerged lines for precise masks. Never forward DBNet maskRawCanvas.
    // If blank regions were removed here, only mask retained renderable polygons.
    const maskPolygons = regions.length === result.texts.length && result.rawPolygons?.length
      ? result.rawPolygons
      : regions.map(region => region.polygon);
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

  const timestamp = Date.now();
  const textObjects = regions.map(({ polygon, text: originalText, index: origIndex }, index) => {
    const xs = polygon.map(point => point.x);
    const ys = polygon.map(point => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const resolvedIndex = origIndex ?? index;
    const detectedFontSize = result.fontSizes?.[resolvedIndex];
    const detectedDirection = result.directions?.[resolvedIndex];
    // Studio stores a centered, unrotated rectangle plus an angle. An AABB of a rotated
    // region would be larger and then rotated a second time, so derive the same
    // edge-midpoint rectangle the pipeline renderer persists for Studio.
    const geometry = getRenderedBlockGeometry(polygon) ?? {
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY,
    };
    // Prefer OcrManager's snapped block angle; older/partial engine results fall back to
    // the source polygon's top-edge rotation. Missing angle must stay an upright block.
    const detectedAngle = result.angles?.[resolvedIndex];
    const rotation = typeof detectedAngle === 'number' && Number.isFinite(detectedAngle)
      ? detectedAngle
      : (calculateRotationAngle(polygon) * 180) / Math.PI;
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
      isVertical: detectedDirection === 'v',
      rotation,
      color: detectedTextColors[resolvedIndex]?.textColor,
      strokeColor: detectedTextColors[resolvedIndex]?.strokeColor,
    };
  });
  return { inpaintedPatchBase64, textObjects };
}
