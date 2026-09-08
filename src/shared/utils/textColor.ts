/**
 * Background-adaptive text color selection.
 *
 * 1:1 port of XianScan `web/src/lib/server/typeset/color.ts` (pure functions only;
 * canvas sampling lives in the renderer). Picks readable fill/stroke pairs based on
 * the WCAG relative luminance of the sampled background.
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
