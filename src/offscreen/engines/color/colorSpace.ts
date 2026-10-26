/**
 * Color space conversion and CIELAB L* luminance channel fusion utilities.
 * Used for 100% ink-line and screentone preservation in manga colorization.
 */

const XN = 0.95047;
const YN = 1.00000;
const ZN = 1.08883;

const EPSILON = 0.0088564516790356308; // (6/29)^3
const KAPPA = 903.296296296296296;      // (29/3)^3

/** Precomputed 256-entry lookup table for sRGB to linear conversion (eliminates millions of Math.pow calls). */
export const SRGB_TO_LINEAR_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const s = i / 255;
  SRGB_TO_LINEAR_LUT[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Converts linear RGB channel [0..1] to clamped sRGB byte [0..255].
 */
export function toSrgbFast(c: number): number {
  const clamped = c < 0 ? 0 : c > 1 ? 1 : c;
  const s = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  const val = Math.round(s * 255);
  return val < 0 ? 0 : val > 255 ? 255 : val;
}

/**
 * Converts sRGB [0..255] to CIELAB [L*, a*, b*].
 *
 * @param r - Red [0..255]
 * @param g - Green [0..255]
 * @param b - Blue [0..255]
 * @returns [L*, a*, b*]
 */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  // sRGB to linear RGB
  const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  // Linear RGB to XYZ (D65 standard)
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / XN;
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb) / YN;
  const z = (0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb) / ZN;

  const f = (t: number): number => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116);

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  const L = Math.max(0, 116 * fy - 16);
  const a = 500 * (fx - fy);
  const bVal = 200 * (fy - fz);

  return [L, a, bVal];
}

/**
 * Converts CIELAB [L*, a*, b*] back to sRGB [0..255].
 *
 * @param L - Lightness [0..100]
 * @param a - a* chrominance [-128..127]
 * @param bVal - b* chrominance [-128..127]
 * @returns [r, g, b] clamped to [0..255]
 */
export function labToRgb(L: number, a: number, bVal: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - bVal / 200;

  const fx3 = fx * fx * fx;
  const fz3 = fz * fz * fz;

  const x = (fx3 > EPSILON ? fx3 : (116 * fx - 16) / KAPPA) * XN;
  const y = (L > KAPPA * EPSILON ? Math.pow((L + 16) / 116, 3) : L / KAPPA) * YN;
  const z = (fz3 > EPSILON ? fz3 : (116 * fz - 16) / KAPPA) * ZN;

  // XYZ to Linear RGB
  const lr =  3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const lg = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const lb =  0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

  // Linear RGB to sRGB
  const toSrgb = (c: number): number => {
    const clamped = Math.max(0, Math.min(1, c));
    const s = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(255, s * 255)));
  };

  return [toSrgb(lr), toSrgb(lg), toSrgb(lb)];
}

/**
 * Fuses colorized chrominance (a*, b*) with original black-and-white luminance (L*).
 * Replaces each pixel's L* in colorizedData with originalData's L*.
 * Guarantees zero lineart blur and 100% screentone sharpness.
 *
 * @param originalData - Source B&W/cleaned ImageData before colorization.
 * @param colorizedData - Colorized ImageData output from neural generator.
 */
export function fuseLightnessChannel(
  originalData: ImageData,
  colorizedData: ImageData
): void {
  const orig = originalData.data;
  const color = colorizedData.data;
  const totalPixels = color.length;

  for (let i = 0; i < totalPixels; i += 4) {
    // 1. Extract only L* from original image using LUT (skipping unused X, Z, a*, b*)
    const lrOrig = SRGB_TO_LINEAR_LUT[orig[i]];
    const lgOrig = SRGB_TO_LINEAR_LUT[orig[i + 1]];
    const lbOrig = SRGB_TO_LINEAR_LUT[orig[i + 2]];
    const yOrig = 0.2126729 * lrOrig + 0.7151522 * lgOrig + 0.0721750 * lbOrig;
    const fyOrig = yOrig > EPSILON ? Math.cbrt(yOrig) : (KAPPA * yOrig + 16) / 116;
    const origL = Math.max(0, 116 * fyOrig - 16);

    // 2. Extract a* and b* from neural colorization output
    const lrCol = SRGB_TO_LINEAR_LUT[color[i]];
    const lgCol = SRGB_TO_LINEAR_LUT[color[i + 1]];
    const lbCol = SRGB_TO_LINEAR_LUT[color[i + 2]];
    const xCol = (0.4124564 * lrCol + 0.3575761 * lgCol + 0.1804375 * lbCol) / XN;
    const yCol = 0.2126729 * lrCol + 0.7151522 * lgCol + 0.0721750 * lbCol;
    const zCol = (0.0193339 * lrCol + 0.1191920 * lgCol + 0.9503041 * lbCol) / ZN;

    const fxCol = xCol > EPSILON ? Math.cbrt(xCol) : (KAPPA * xCol + 16) / 116;
    const fyCol = yCol > EPSILON ? Math.cbrt(yCol) : (KAPPA * yCol + 16) / 116;
    const fzCol = zCol > EPSILON ? Math.cbrt(zCol) : (KAPPA * zCol + 16) / 116;

    const colorA = 500 * (fxCol - fyCol);
    const colorB = 200 * (fyCol - fzCol);

    // 3. Inlined labToRgb(origL, colorA, colorB) without array allocations
    const fy = (origL + 16) / 116;
    const fx = colorA / 500 + fy;
    const fz = fy - colorB / 200;

    const fx3 = fx * fx * fx;
    const fz3 = fz * fz * fz;

    const x = (fx3 > EPSILON ? fx3 : (116 * fx - 16) / KAPPA) * XN;
    const y = (origL > KAPPA * EPSILON ? Math.pow((origL + 16) / 116, 3) : origL / KAPPA) * YN;
    const z = (fz3 > EPSILON ? fz3 : (116 * fz - 16) / KAPPA) * ZN;

    const lr =  3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
    const lg = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
    const lb =  0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

    color[i] = toSrgbFast(lr);
    color[i + 1] = toSrgbFast(lg);
    color[i + 2] = toSrgbFast(lb);
    // Preserve source alpha channel (transparent PNGs, stickers)
    color[i + 3] = orig[i + 3];
  }
}
