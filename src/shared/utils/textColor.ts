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
// Ink detection with snap-to-pure-black/white normalization.
//
// The binary picker above can only ever produce black or white text. The
// functions below recover the ORIGINAL text color from the pre-inpaint image:
// ink pixels are separated from a background seed, reduced by per-channel
// median (robust against antialiasing and JPEG artifacts), and tones that are
// merely "slightly off" black or white are snapped to the pure extremes so
// rendered text stays crisp. Genuinely colored text passes through unchanged.
// Thresholds follow the integer-luminance calibration proven by the donor
// reference implementation (see devlog for the full technique mapping).
// ---------------------------------------------------------------------------

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
