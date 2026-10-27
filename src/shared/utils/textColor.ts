/**
 * @file textColor.ts
 * Background-adaptive text color selection.
 *
 * Ported and adapted from XianScan by Arben Apura.
 * Licensed under the MIT License.
 * Reference: https://github.com/ArbenApura/xianscan-rust (web/src/lib/server/typeset/color.ts)
 * See THIRD_PARTY_NOTICES.md for full license and copyright notice.
 *
 * 1:1 port of XianScan `web/src/lib/server/typeset/color.ts` (pure functions only;
 * canvas sampling lives in the renderer). Picks readable fill/stroke pairs based on
 * the WCAG relative luminance of the sampled background.
 *
 * Also hosts the per-bubble ink detection helpers (`pickInkColor`, `snapTextColor`)
 * that recover the original text color from the pre-inpaint image and snap
 * near-black/near-white tones to the pure extremes.
 */

export interface BackgroundColor {
  r: number;
  g: number;
  b: number;
}

export interface TextColorChoice {
  fill: string;
  stroke: string;
}

/** WCAG relative luminance from linearized sRGB channels. */
function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Picks a readable text color pair for the given background.
 * Dark backgrounds (< 0.18 luminance) get white text with a black outline;
 * everything else gets black text with a white outline.
 *
 * @param bg - Sampled mean background color.
 * @returns Fill color and contrasting stroke color.
 */
export function pickTextColor(bg: BackgroundColor): TextColorChoice {
  return relativeLuminance(bg.r, bg.g, bg.b) < 0.18
    ? { fill: 'white', stroke: 'black' }
    : { fill: 'black', stroke: 'white' };
}

// ---------------------------------------------------------------------------
// Koharu 1:1 Color Clustering & Text Paint Inference.
//
// Solves thin-stroke antialiasing dilution in raster manga text:
// In manga scans, antialiased edge pixels (grey RGB 100-220) outnumber pure
// black core pixels by 2:1 to 3:1. A flat median across all non-background
// pixels erroneously lands in the 120-140 range (grey).
// Koharu segments window pixels into 4 K-means clusters initialized with:
// [background_seed, darkest_palette_bin, lightest_palette_bin, distant_bin].
// Cluster 1 converges to the pure ink core (RGB ~20-30), which then wins the
// quadratic contrast score `distance_squared * evidence` by a 5x margin over
// the washed-out antialiasing fringe. The median of that winning cluster
// cleanly snaps to pure black (#000000).
// Reference: scratches/reference/koharu/crates/koharu-pipeline/src/stages/detection.rs
// ---------------------------------------------------------------------------

/** Pixel sampled from the local typography window. */
export interface MaskPixel {
  x: number;
  y: number;
  color: RGBColor;
  insideMask: boolean;
}

/** Minimum pixel count for an extreme palette color bin to be considered significant. */
export const MIN_EXTREME_COLOR_PIXELS = 4;
/** Number of color clusters used by the K-Means color decomposition. */
export const COLOR_CLUSTER_COUNT = 4;
/** Minimum measured stroke width in pixels to accept an explicit text outline. */
export const MIN_MEASURED_STROKE_WIDTH = 2;

/** Quantized 16x16x16 color bin with running channel accumulators. */
export class ColorBin {
  count = 0;
  sums: [number, number, number] = [0, 0, 0];

  add(color: RGBColor): void {
    this.count += 1;
    this.sums[0] += color.r;
    this.sums[1] += color.g;
    this.sums[2] += color.b;
  }

  color(): RGBColor {
    if (this.count === 0) return { r: 0, g: 0, b: 0 };
    const half = Math.floor(this.count / 2);
    return {
      r: Math.floor((this.sums[0] + half) / this.count),
      g: Math.floor((this.sums[1] + half) / this.count),
      b: Math.floor((this.sums[2] + half) / this.count),
    };
  }
}

/** Accumulator for K-Means cluster centers. */
export class ColorAccumulator {
  count = 0;
  sums: [number, number, number] = [0, 0, 0];

  add(bin: ColorBin): void {
    this.count += bin.count;
    this.sums[0] += bin.sums[0];
    this.sums[1] += bin.sums[1];
    this.sums[2] += bin.sums[2];
  }

  color(): RGBColor | null {
    if (this.count === 0) return null;
    const half = Math.floor(this.count / 2);
    return {
      r: Math.floor((this.sums[0] + half) / this.count),
      g: Math.floor((this.sums[1] + half) / this.count),
      b: Math.floor((this.sums[2] + half) / this.count),
    };
  }
}

/**
 * Quantizes image pixels into a 16x16x16 (4096-entry) color histogram.
 */
export function colorPalette(pixels: readonly MaskPixel[]): ColorBin[] {
  const bins = new Map<number, ColorBin>();
  for (const pixel of pixels) {
    const r = pixel.color.r >> 4;
    const g = pixel.color.g >> 4;
    const b = pixel.color.b >> 4;
    const key = (r << 8) | (g << 4) | b;
    let bin = bins.get(key);
    if (!bin) {
      bin = new ColorBin();
      bins.set(key, bin);
    }
    bin.add(pixel.color);
  }
  return Array.from(bins.values());
}

/**
 * Finds the darkest or lightest significant palette color by Rec.601 luminance.
 */
export function extremePaletteColor(palette: readonly ColorBin[], darkest: boolean): RGBColor {
  const select = (significantOnly: boolean): ColorBin | null => {
    let bestBin: ColorBin | null = null;
    let bestLum = darkest ? Infinity : -Infinity;
    for (const bin of palette) {
      if (significantOnly && bin.count < MIN_EXTREME_COLOR_PIXELS) continue;
      const lum = colorLuminance601(bin.color());
      if (darkest ? lum < bestLum : lum > bestLum) {
        bestLum = lum;
        bestBin = bin;
      }
    }
    return bestBin;
  };

  const selected = select(true) ?? select(false);
  return selected ? selected.color() : (darkest ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 });
}

/**
 * Minimum squared distance from a color to a set of reference centers.
 */
export function minimumColorDistance(color: RGBColor, centers: readonly RGBColor[]): number {
  let min = Infinity;
  for (const center of centers) {
    const d = colorDistanceSquared(color, center);
    if (d < min) min = d;
  }
  return Number.isFinite(min) ? min : 0;
}

/**
 * Finds the palette color that maximizes distance to existing centers weighted by count.
 */
export function distantPaletteColor(palette: readonly ColorBin[], centers: readonly RGBColor[]): RGBColor {
  let bestScore = -1;
  let bestColor: RGBColor = { r: 0, g: 0, b: 0 };
  for (const bin of palette) {
    const col = bin.color();
    const score = minimumColorDistance(col, centers) * Math.min(bin.count, 64);
    if (score > bestScore) {
      bestScore = score;
      bestColor = col;
    }
  }
  return bestColor;
}

export interface ColorCluster {
  color: RGBColor;
  pixels: MaskPixel[];
}

/**
 * Decomposes typography window pixels into 4 K-Means clusters initialized with
 * [background_seed, darkest, lightest, distant] centers.
 */
export function colorClusters(pixels: readonly MaskPixel[], backgroundSeed: RGBColor): ColorCluster[] {
  const palette = colorPalette(pixels);
  const darkest = extremePaletteColor(palette, true);
  const lightest = extremePaletteColor(palette, false);
  const distant = distantPaletteColor(palette, [backgroundSeed, darkest, lightest]);
  const centers: RGBColor[] = [
    { ...backgroundSeed },
    { ...darkest },
    { ...lightest },
    { ...distant },
  ];

  for (let iter = 0; iter < 4; iter++) {
    const accumulators = Array.from({ length: COLOR_CLUSTER_COUNT }, () => new ColorAccumulator());
    for (const entry of palette) {
      const col = entry.color();
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let c = 0; c < COLOR_CLUSTER_COUNT; c++) {
        const d = colorDistanceSquared(col, centers[c]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = c;
        }
      }
      accumulators[bestIdx].add(entry);
    }
    for (let c = 0; c < COLOR_CLUSTER_COUNT; c++) {
      const updated = accumulators[c].color();
      if (updated) {
        centers[c] = updated;
      }
    }
  }

  const groups: MaskPixel[][] = Array.from({ length: COLOR_CLUSTER_COUNT }, () => []);
  for (const pixel of pixels) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let c = 0; c < COLOR_CLUSTER_COUNT; c++) {
      const d = colorDistanceSquared(pixel.color, centers[c]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = c;
      }
    }
    groups[bestIdx].push(pixel);
  }

  return centers.map((color, idx) => ({
    color,
    pixels: groups[idx],
  }));
}

/**
 * Quadratic ink score: distance_squared from background * evidence (up to 4096).
 * Strongly favors high-contrast ink core pixels over antialiased edge pixels.
 */
export function clusterInkScore(cluster: ColorCluster, background: RGBColor): number {
  let inside = 0;
  for (const pixel of cluster.pixels) {
    if (pixel.insideMask) inside++;
  }
  const evidence = inside >= 8 ? inside + cluster.pixels.length : cluster.pixels.length;
  return colorDistanceSquared(cluster.color, background) * Math.min(evidence, 4096);
}

/**
 * Representative ink color: per-channel median of pixels belonging to this cluster.
 */
export function representativeInkColor(cluster: ColorCluster): RGBColor {
  const inside = cluster.pixels.filter((p) => p.insideMask);
  if (inside.length >= 8) {
    return medianColor(inside.map((p) => p.color));
  }
  return cluster.pixels.length > 0
    ? medianColor(cluster.pixels.map((p) => p.color))
    : cluster.color;
}

/**
 * Checks if candidate RGB color lies on the linear gradient vector between start and end.
 */
export function colorLiesBetween(candidate: RGBColor, start: RGBColor, end: RGBColor): boolean {
  const dirR = end.r - start.r;
  const dirG = end.g - start.g;
  const dirB = end.b - start.b;
  const lenSq = dirR * dirR + dirG * dirG + dirB * dirB;
  if (lenSq <= 1e-6) return false;

  const proj =
    ((candidate.r - start.r) * dirR +
      (candidate.g - start.g) * dirG +
      (candidate.b - start.b) * dirB) /
    lenSq;
  if (proj < 0.0 || proj > 1.0) return false;

  const diffR = candidate.r - (start.r + dirR * proj);
  const diffG = candidate.g - (start.g + dirG * proj);
  const diffB = candidate.b - (start.b + dirB * proj);
  const distSq = diffR * diffR + diffG * diffG + diffB * diffB;
  return distSq <= 24.0 * 24.0 * 3.0;
}

export interface InferredOutlinePaint {
  fillColor: RGBColor;
  strokeColor: RGBColor;
  strokeWidth: number;
  score: number;
}

/**
 * Flood-fills reachable pixels from window boundaries without stepping onto barrier cluster.
 */
function reachableWithoutCluster(
  assignments: Int32Array,
  barrier: number,
  width: number,
  height: number,
): Uint8Array {
  const reachable = new Uint8Array(assignments.length);
  const queueX: number[] = [];
  const queueY: number[] = [];
  function push(x: number, y: number) {
    const idx = y * width + x;
    if (!reachable[idx] && assignments[idx] !== barrier) {
      reachable[idx] = 1;
      queueX.push(x);
      queueY.push(y);
    }
  }
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  let head = 0;
  while (head < queueX.length) {
    const x = queueX[head];
    const y = queueY[head++];
    if (x > 0) push(x - 1, y);
    if (x + 1 < width) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < height) push(x, y + 1);
  }
  return reachable;
}

/**
 * Detects whether a real stroke outline encloses fill text in the local window.
 */
export function inferOutline(
  clusters: readonly ColorCluster[],
  background: RGBColor,
  width: number,
  height: number,
): InferredOutlinePaint | null {
  if (width < 8 || height < 8) return null;
  const assignments = new Int32Array(width * height).fill(-1);
  for (let c = 0; c < clusters.length; c++) {
    for (const p of clusters[c].pixels) {
      if (p.x >= 0 && p.x < width && p.y >= 0 && p.y < height) {
        assignments[p.y * width + p.x] = c;
      }
    }
  }

  let bgIdx = -1;
  let minBgDist = Infinity;
  for (let c = 0; c < clusters.length; c++) {
    if (clusters[c].pixels.length === 0) continue;
    const d = colorDistanceSquared(clusters[c].color, background);
    if (d < minBgDist) {
      minBgDist = d;
      bgIdx = c;
    }
  }
  if (bgIdx === -1) return null;

  let best: InferredOutlinePaint | null = null;
  for (let strokeIdx = 0; strokeIdx < clusters.length; strokeIdx++) {
    const strokeCluster = clusters[strokeIdx];
    if (strokeCluster.pixels.length < 8 || strokeIdx === bgIdx) continue;

    const outside = reachableWithoutCluster(assignments, strokeIdx, width, height);

    for (let fillIdx = 0; fillIdx < clusters.length; fillIdx++) {
      if (fillIdx === strokeIdx || clusters[fillIdx].pixels.length === 0) continue;
      const enclosedFill: MaskPixel[] = [];
      for (const p of clusters[fillIdx].pixels) {
        const idx = p.y * width + p.x;
        if (!outside[idx]) {
          enclosedFill.push(p);
        }
      }
      if (enclosedFill.length < 8) continue;

      const fillColor = medianColor(enclosedFill.map((p) => p.color));
      const strokeColor = medianColor(strokeCluster.pixels.map((p) => p.color));
      const contrast = colorDistanceSquared(fillColor, strokeColor);

      if (
        contrast < INK_MIN_COLOR_DISTANCE_SQUARED ||
        colorDistanceSquared(fillColor, background) < INK_MIN_COLOR_DISTANCE_SQUARED ||
        colorDistanceSquared(strokeColor, background) < INK_MIN_COLOR_DISTANCE_SQUARED ||
        colorLiesBetween(strokeColor, fillColor, background) ||
        colorLiesBetween(fillColor, strokeColor, background)
      ) {
        continue;
      }

      const normalizedFill = snapTextColor(fillColor);
      const normalizedStroke = snapTextColor(strokeColor);
      if (
        normalizedFill.r === normalizedStroke.r &&
        normalizedFill.g === normalizedStroke.g &&
        normalizedFill.b === normalizedStroke.b
      ) {
        continue;
      }

      const insideFill = enclosedFill.filter((p) => p.insideMask).length;
      const evidence = enclosedFill.length + insideFill;
      const score = contrast * Math.min(evidence, 4096);

      if (!best || score > best.score) {
        best = {
          fillColor: normalizedFill,
          strokeColor: normalizedStroke,
          strokeWidth: 2,
          score,
        };
      }
    }
  }

  return best;
}

export interface InferredTextPaintResult {
  color: RGBColor;
  strokeColor?: RGBColor;
  strokeWidth?: number;
}

/**
 * 1:1 Koharu text paint inference: decomposes pixels via K-Means, checks outline
 * enclosure, ranks clusters by quadratic contrast score, and normalizes extremes.
 */
export function inferTextPaint(
  pixels: readonly MaskPixel[],
  backgroundSeed: RGBColor,
  width: number = 0,
  height: number = 0,
): InferredTextPaintResult {
  if (pixels.length === 0) {
    return { color: snapTextColor(backgroundSeed) };
  }

  const clusters = colorClusters(pixels, backgroundSeed);

  // Check topological outline enclosure
  if (width > 0 && height > 0) {
    const outline = inferOutline(clusters, backgroundSeed, width, height);
    if (outline) {
      return {
        color: outline.fillColor,
        strokeColor: outline.strokeColor,
        strokeWidth: outline.strokeWidth,
      };
    }
  }

  const nonempty: number[] = [];
  for (let i = 0; i < clusters.length; i++) {
    if (clusters[i].pixels.length > 0) nonempty.push(i);
  }

  if (nonempty.length === 1) {
    return {
      color: snapTextColor(clusters[nonempty[0]].color),
    };
  }

  let bgIdx = nonempty[0];
  let minBgDist = Infinity;
  for (const idx of nonempty) {
    const d = colorDistanceSquared(clusters[idx].color, backgroundSeed);
    if (d < minBgDist) {
      minBgDist = d;
      bgIdx = idx;
    }
  }

  let bestFillIdx: number | null = null;
  let maxScore = -1;
  for (const idx of nonempty) {
    if (idx === bgIdx) continue;

    // If this cluster lies on the gradient between another candidate cluster and the
    // background, it represents antialiased edge pixels rather than core ink.
    let isFringe = false;
    for (const otherIdx of nonempty) {
      if (otherIdx === bgIdx || otherIdx === idx) continue;
      if (colorLiesBetween(clusters[idx].color, clusters[otherIdx].color, backgroundSeed)) {
        isFringe = true;
        break;
      }
    }

    const rawScore = clusterInkScore(clusters[idx], backgroundSeed);
    const score = isFringe ? rawScore * 0.1 : rawScore;
    if (score > maxScore) {
      maxScore = score;
      bestFillIdx = idx;
    }
  }

  const inkColor =
    bestFillIdx !== null
      ? representativeInkColor(clusters[bestFillIdx])
      : clusters[bgIdx].color;

  return {
    color: snapTextColor(inkColor),
  };
}

/** Generic RGB triple; structurally compatible with {@link BackgroundColor}. */
export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

/** Rec.601 luminance (integer weights) at or below which ink snaps to pure black. */
export const COLOR_SNAP_DARK_LUMINANCE = 64 * 256;
/** Rec.601 luminance (integer weights) at or above which ink snaps to pure white. */
export const COLOR_SNAP_LIGHT_LUMINANCE = 191 * 256;
/** Minimum squared RGB distance from the background seed for a pixel to count as ink. */
export const INK_MIN_COLOR_DISTANCE_SQUARED = 32 * 32;
/** Fewer ink candidates than this means detection is inconclusive and the caller must fall back. */
export const MIN_INK_PIXELS = 16;

/**
 * Integer Rec.601 luminance on a 0–65280 scale (weights 54/183/19 sum to 256,
 * so the value equals 256× the perceived gray level).
 *
 * Deliberately NOT the WCAG {@link relativeLuminance}: the snap thresholds
 * below are calibrated on this linear-8-bit scale and would silently shift
 * if computed from linearized sRGB.
 *
 * @param color - RGB triple to measure.
 * @returns Weighted luminance in the range 0–65280.
 */
export function colorLuminance601(color: RGBColor): number {
  return color.r * 54 + color.g * 183 + color.b * 19;
}

/**
 * Squared Euclidean RGB distance between two colors.
 *
 * @param a - First color.
 * @param b - Second color.
 * @returns Sum of squared per-channel differences (0–195075).
 */
export function colorDistanceSquared(a: RGBColor, b: RGBColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

/**
 * Snaps a detected text color to pure black or white when its tone is only
 * slightly off the extreme, leaving genuinely colored text untouched.
 *
 * Known accepted tradeoff (inherited from the donor calibration): saturated
 * red has Rec.601 luminance 54/255 and therefore snaps to black, while green
 * and blue survive. Documented in the devlog.
 *
 * @param color - Detected ink color (typically a per-channel median).
 * @returns Pure black, pure white, or the input color unchanged.
 */
export function snapTextColor(color: RGBColor): RGBColor {
  const luminance = colorLuminance601(color);
  if (luminance <= COLOR_SNAP_DARK_LUMINANCE) return { r: 0, g: 0, b: 0 };
  if (luminance >= COLOR_SNAP_LIGHT_LUMINANCE) return { r: 255, g: 255, b: 255 };
  return color;
}

/**
 * Extracts the dominant ink color from raw window pixels given a background
 * seed. Pixels too close to the seed are treated as bubble interior and
 * discarded; the survivors are reduced per channel by median, which ignores
 * antialiased edge blends and compression noise that a mean would smear.
 *
 * @param pixels - Candidate pixels sampled from the text region window.
 * @param bgSeed - Representative background color (e.g. median of a ring around the text box).
 * @returns Per-channel median ink color, or null when fewer than {@link MIN_INK_PIXELS} candidates exist.
 */
export function pickInkColor(pixels: readonly RGBColor[], bgSeed: RGBColor): RGBColor | null {
  const inks: RGBColor[] = [];
  for (const pixel of pixels) {
    if (colorDistanceSquared(pixel, bgSeed) > INK_MIN_COLOR_DISTANCE_SQUARED) {
      inks.push(pixel);
    }
  }
  if (inks.length < MIN_INK_PIXELS) return null;
  return medianColor(inks);
}

/**
 * Picks an outline color that stays readable against the detected fill.
 * Dark fills get a white outline and vice versa; mid-tone colored fills are
 * stroked by their own luminance so the outline never matches the fill.
 *
 * @param fill - Final (already snapped) text fill color.
 * @returns Hex string '#ffffff' or '#000000'.
 */
export function deriveStrokeColor(fill: RGBColor): string {
  return colorLuminance601(fill) < 128 * 256 ? '#ffffff' : '#000000';
}

/**
 * Formats an RGB triple as a lowercase '#rrggbb' hex string.
 *
 * @param color - Color to format; channels are clamped to 0–255.
 * @returns Hex string usable as a canvas/CSS color.
 */
export function rgbToHexString(color: RGBColor): string {
  const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
  const channel = (value: number): string => clamp(value).toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/**
 * Per-channel median of a pixel collection (histogram sort, no float rounding).
 * Exported for boundary samplers that need a robust background seed (e.g. the
 * ring around a text box); {@link pickInkColor} uses it internally for ink.
 *
 * @param pixels - Non-empty pixel collection.
 * @returns Color whose channels are the medians of the inputs.
 */
export function medianColor(pixels: readonly RGBColor[]): RGBColor {
  const channels: number[][] = [[], [], []];
  for (const pixel of pixels) {
    channels[0].push(pixel.r);
    channels[1].push(pixel.g);
    channels[2].push(pixel.b);
  }
  return {
    r: channelMedian(channels[0]),
    g: channelMedian(channels[1]),
    b: channelMedian(channels[2]),
  };
}

/**
 * Median of one channel's values (averages the two central samples for even counts).
 *
 * @param values - Non-empty channel values.
 * @returns Median value.
 */
function channelMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
