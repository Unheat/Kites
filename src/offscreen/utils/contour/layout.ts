import type { Point2D } from '../../../shared/utils/geometry';
import type {
  WrapContourOptions, WrapContourResult, SegmentTemplate, LineBreakResult,
} from './types';
import { buildSegmentTemplates, measureSegments, buildSegmentMeasures } from './segments';
import { exactProfiledLineBreaks, uniformWithPolicy, betterLineBreak } from './lineBreaks';
import { largestFittingFontSize, searchFillPolicy, searchLastResort } from './fontSearch';
import { contourProfiles, computeContourProfiles, resolveBalloonAir, comicLineCapacity } from './profiles';
import { polygonInlineSpans } from './geometry';
import { resolveMetrics, measureInkBandWithSource, type ResolvedMetrics } from './metrics';
import { DEFAULT_INLINE_AIR, DEFAULT_LINE_PITCH, MINIMUM_READABLE_FONT_SIZE } from './constants';
import { mul, sub } from './numeric';
import { finalizeContourLayout } from './placement';

export {
  buildSegmentTemplates, measureSegments, buildSegmentMeasures, exactProfiledLineBreaks,
  uniformWithPolicy, betterLineBreak, largestFittingFontSize, searchLastResort, searchFillPolicy,
  contourProfiles, computeContourProfiles, polygonInlineSpans, resolveMetrics,
  resolveBalloonAir, comicLineCapacity,
};

/** Explicit frame plus legacy translation back to source coordinates. */
interface FrameContext { width: number; height: number; offsetX: number; offsetY: number }

/** Resolve frame and translate contour into frame-local coordinates. With an explicit frame,
 * the contour is already frame-local; without one, its bounding box becomes the frame and
 * positions are translated back for compatibility.
 * @param contour Source contour. @param frame Explicit frame, if provided.
 * @returns Frame and offsets. */
function resolveFrame(contour: Point2D[], frame?: { width: number; height: number }): FrameContext {
  if (frame) return { ...frame, offsetX: 0, offsetY: 0 };
  const xs = contour.map((point) => point.x);
  const ys = contour.map((point) => point.y);
  const minX = Math.min(...xs); const minY = Math.min(...ys);
  return { width: Math.max(...xs) - minX, height: Math.max(...ys) - minY, offsetX: minX, offsetY: minY };
}

/**
 * Top-level Koharu contour typesetter. Accepts explicit frame, measured metrics,
 * and preserves all existing compatibility callbacks.
 * @param text Source dialogue. @param contour Frame-local contour.
 * @param ctx Canvas context for default measurement. @param fontFamily Font.
 * @param options Sizing, hyphenation, line pitch, measurement injection.
 * @returns Best layout in frame, or null when the resolved frame has no usable area.
 */
export function wrapTextContour(text: string, contour: Point2D[], ctx: CanvasRenderingContext2D,
  fontFamily: string, options: WrapContourOptions = {}): WrapContourResult | null {
  const cleanText = text.trim();
  if (!cleanText || contour.length < 3) {
    return { lines: [cleanText], fontSize: 14, width: 50, height: 20, overflowed: false };
  }
  const frame = resolveFrame(contour, options.frame);
  if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width <= 0 || frame.height <= 0) {
    return null;
  }
  const local = options.frame ? contour
    : contour.map((point) => ({ x: point.x - frame.offsetX, y: point.y - frame.offsetY }));

  const minFont = options.minFontSize ?? MINIMUM_READABLE_FONT_SIZE;
  const targetLang = options.targetLang ?? 'en';
  const linePitch = options.linePitch ?? DEFAULT_LINE_PITCH;
  const inlineAir = options.inlineAir ?? DEFAULT_INLINE_AIR;
  // Donor automatic_maximum for horizontal balloon text is the usable frame width.
  const maxFont = options.maxFontSize ? Math.max(minFont, options.maxFontSize) : Math.max(minFont, frame.width);

  const family = (fontFamily || 'sans-serif').trim();
  const familyStack = family.includes(',') ? family
    : (family.startsWith('"') || family.startsWith("'") ? family : `"${family}"`);
  const stylePrefix = `${options.isItalic ? 'italic ' : ''}${options.isBold ? 'bold ' : ''}`;
  // Preserve fractional probe sizes: donor shapes and measures at unrounded f32 sizes.
  const fontSpec = (size: number): string => `${stylePrefix}${size}px ${familyStack}`;

  const measureAt = (size: number): ((s: string) => number) => {
    ctx.font = fontSpec(size);
    const cache = options.measureCache;
    return cache ? (s: string) => cache.measure(s) : (s: string) => ctx.measureText(s).width;
  };
  const metricsAt = (size: number): ((s: string) => ResolvedMetrics) => {
    ctx.font = fontSpec(size);
    if (options.measureMetrics) {
      const injected = options.measureMetrics;
      return (s: string) => resolveMetrics(injected(s, size), size);
    }
    const originalAlign = ctx.textAlign; const originalBaseline = ctx.textBaseline;
    return (s: string) => {
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const measured = resolveMetrics(ctx.measureText(s), size);
      ctx.textAlign = originalAlign; ctx.textBaseline = originalBaseline;
      return measured;
    };
  };

  const templateCache = new Map<boolean, SegmentTemplate[]>();
  const templatesFor = (hyphenate: boolean): SegmentTemplate[] => {
    if (!templateCache.has(hyphenate)) {
      templateCache.set(hyphenate, buildSegmentTemplates(cleanText, hyphenate, targetLang));
    }
    return templateCache.get(hyphenate)!;
  };

  /** Count discretionary hyphen cuts among the chosen break points. */
  const countHyphenCuts = (chosen: LineBreakResult, measured: ReturnType<typeof measureSegments>): number =>
    chosen.breaks.filter((index) => measured[index - 1]?.isHyphenBreak).length;

  const evaluate = (size: number, hyphenate: boolean): LineBreakResult & { discretionaryCuts: number } => {
    const templates = templatesFor(hyphenate);
    const segments = measureSegments(templates, measureAt(size));
    const ink = measureInkBandWithSource(templates, metricsAt(size));
    const lineHeight = mul(size, linePitch);
    const air = resolveBalloonAir(inlineAir, ink.band);
    const maxLines = comicLineCapacity(frame.height, air, ink.band, lineHeight, segments.length);
    const fallbackWidth = Math.max(1, sub(frame.width, mul(air, 2)));
    // The Kites fill policy prices cut count, so the evaluator reports how many of the
    // chosen break points are discretionary hyphens (clean templates can never cut).
    const withCuts = (chosen: LineBreakResult): LineBreakResult & { discretionaryCuts: number } =>
      ({ ...chosen, discretionaryCuts: hyphenate ? countHyphenCuts(chosen, segments) : 0 });
    if (maxLines <= 0) {
      return withCuts({ ...uniformWithPolicy(segments, fallbackWidth, hyphenate), overflowed: true });
    }
    let best: LineBreakResult | null = null;
    for (let count = 1; count <= maxLines; count++) {
      const profiles = contourProfiles(local, count, lineHeight, ink.band, frame, air, air);
      if (!profiles) continue;
      const candidate = exactProfiledLineBreaks(segments, profiles, hyphenate);
      if (candidate && betterLineBreak(candidate, best)) best = candidate;
    }
    return withCuts(best ?? { ...uniformWithPolicy(segments, fallbackWidth, hyphenate), overflowed: true });
  };

  // Each probe still prefers clean breaks; hyphenation is a last resort within the size.
  const probe = (size: number, lastResort: boolean): LineBreakResult & { fontSize: number; discretionaryCuts: number } => {
    const clean = evaluate(size, false);
    // LastResort is selected by chord overflow before padded run bounds are checked.
    const broken = !clean.overflowed || !lastResort ? clean : evaluate(size, true);
    const placed = finalizeContourLayout(broken, size, mul(size, linePitch), metricsAt(size), frame);
    return {
      ...broken, width: placed.width, height: placed.height, overflowed: placed.overflowed,
      fontSize: size, discretionaryCuts: broken.discretionaryCuts,
    };
  };
  // Donor global policy: clean-first with floor-bucket LastResort recovery. The Kites
  // `fill` policy compares the largest clean fit against the largest split fit instead.
  const selected = options.sizingPolicy === 'fill'
    ? searchFillPolicy(minFont, maxFont, probe)
    : searchLastResort(minFont, maxFont, probe);

  const finalSize = selected.fontSize ?? minFont;
  const finalMetrics = metricsAt(finalSize);
  // Provenance is a property of the measurement provider, not of which probe won.
  const finalInk = measureInkBandWithSource(templatesFor(false), finalMetrics);
  const placement = finalizeContourLayout(selected, finalSize, mul(finalSize, linePitch), finalMetrics, frame,
    { offsetX: frame.offsetX, offsetY: frame.offsetY });
  return { lines: selected.lines, ...placement, fontSize: finalSize, metricsSource: finalInk.source };
}
