/**
 * Standalone OCR text sanitization and manga noise predicates.
 *
 * Pure functions shared by detection, merge, and typesetting stages. These ports
 * intentionally accept only text strings so they stay safe when the caller does
 * not know the source language or image context.
 */

export const CJK_SCRIPT_REGEX = /[\u3040-\u30ff\u3180-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]/;

// Scanlator group markers and site URLs frequently embedded in manga scans.
// Keep this conservative: it should only match strings that are almost always
// scanlator noise when they appear in OCR output.
const SCANLATOR_WATERMARK_REGEX = /(https?:\/\/|www\.|\.(?:com|net|org|cc|xyz|top|biz|club|icu|online|website|info|store|app|me|tv|co)\b|discord\.gg|patreon\.com|t\.me\/|baozimh|baozi|包子|bilibili|bili|哔哩|嗶哩|colamanga|colamanhua|colam|kamirenjaku|kagane|kownoon|mangatoto|mangadex|mangaowl|mangaclash|manganelo|mangareader|mangahere|manhuascan|manhuaus|manhwatop|readmanga|readcomiconline|comick|lekhmanga|lezhin|tapas|汉化组|漢化組|翻译组|翻譯組|汉化|漢化|修图|嵌字|扫图|掃圖|录入|严禁转载|嚴禁轉載|独家首发|獨家首發|未完待续|未完待續|微信群|公众号|qq群|QQ群|企鹅群|企鵝群|copied\s+from|scanlated\s+by|translate\s+by|translated\s+by)/iu;

// Thought bubble tails render as repeated circles/halves in OCR ("0OO", "ooo").
const THOUGHT_BUBBLE_TAIL_REGEX = /^[0oO○●⊙◯]{2,}$/i;
const PURE_ELLIPSIS_OR_DOT_REGEX = /^[.．。・⋅‥…·〜~()（）\s]+$/;

/** True when the OCR text is a manga scanlator watermark instead of panel content. */
export function isScanlatorWatermark(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return SCANLATOR_WATERMARK_REGEX.test(trimmed);
}

/** True when OCR read a thought-bubble tail chain as fake text. */
export function isThoughtBubbleTailOrnament(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (THOUGHT_BUBBLE_TAIL_REGEX.test(trimmed)) return true;
  if (PURE_ELLIPSIS_OR_DOT_REGEX.test(trimmed)) return true;
  if (trimmed.length <= 8 && /^[0oO○●⊙◯.．。・⋅‥…·〜~()（）\s]+$/.test(trimmed)) return true;
  if (trimmed.length <= 8 && /^[oO0○●⊙◯]{2,}$/.test(trimmed)) return true;
  return false;
}

/** True for thought-bubble tail digit chains and circle/dot ornament rows. */
export function isStandaloneDigitOrOrnamentNoise(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (PURE_ELLIPSIS_OR_DOT_REGEX.test(trimmed)) return true;
  // Thought-bubble tail digit chains: ONLY circle-like digits {0,2,3,5,8,9} up to 4 chars
  // (is_pure_watermark_region). Meaningful numbers ("365", "15", page numbers) survive;
  // leftover pure-digit lines still fall through to Cotrans isValuableText.
  if (trimmed.length <= 4 && /^[023589]+$/.test(trimmed)) return true;
  // Circle/half-circle ornament chains mixed with dot separators ("0oO", "○.○")
  if (/^[.．。・⋅‥…·〜~()（）\s]*[0oO○●⊙◯]{2,}[.．。・⋅‥…·〜~()（）\s]*$/.test(trimmed)) return true;
  return false;
}

/** Trailing digit-noise run after an ellipsis/dot ("ちょっと…200000"). */
const ELLIPSIS_TAIL_DIGIT_NOISE = /([.．…·。])[0oO23589]{3,8}$/;

/**
 * Universal per-line cleaning for OCR artifacts (XianScan `clean_stray_ocr_artifacts`).
 * Strips trailing ellipsis-attached digit noise runs and trailing slash/backslash debris.
 * Pure string rewrite — the caller keeps the line and its polygon.
 *
 * @param text - Raw OCR line text.
 * @returns Cleaned text.
 */
export function cleanStrayOcrArtifacts(text: string): string {
  let t = text.replace(/\s+$/, '');
  // "ちょっと…200000" -> "ちょっと…" (keep the ellipsis, drop the digit run)
  let match: RegExpExecArray | null;
  while ((match = ELLIPSIS_TAIL_DIGIT_NOISE.exec(t)) !== null) {
    t = t.slice(0, match.index + 1);
  }
  if (t.endsWith('/') || t.endsWith('\\')) {
    t = t.slice(0, -1).trimEnd();
  }
  return t.trim();
}

/**
 * Normalize translated text for comic typesetting.
 *
 * Converts CJK punctuation into rendering-safe ASCII punctuation where that is
 * the intended western font path, collapses spaced letter OCR duplicates, and
 * removes whitespace artifacts. This intentionally does not uppercase text.
 */
export function sanitizeTypesetText(text: string): string {
  if (!text) return '';
  let out = text.trim();

  if (!CJK_SCRIPT_REGEX.test(out)) {
    out = out
      // CJK brackets/quotes to ASCII typography
      .replace(/[【〔〖]/g, '[')
      .replace(/[】〕〗]/g, ']')
      .replace(/[《「『]/g, '"')
      .replace(/[》」』]/g, '"')
      .replace(/[“”„‟]/g, '"')
      .replace(/[‘’‚‛＇]/g, "'")
      .replace(/[〜～∼]/g, '~')
      .replace(/[．。﹒・]/g, '.');

    // Collapse isolated letters produced by broken OCR spacing: "H E L L O".
    // Do not merge common contractions (I'M, IT'S) because apostrophes remain word-boundary separation.
    out = out.replace(/(?<![\w'’])(?:[A-Za-z][\s]+){2,}[A-Za-z](?![\w'’])/g, (match) => {
      const tokens = match.trim().split(/\s+/);
      return tokens.every((token) => token.length === 1) ? tokens.join('') : match;
    });

    // Fix punctuation debris introduced by line breaks or OCR spacing.
    out = out
      .replace(/,\s*,/g, ', ')
      .replace(/\.\s*,/g, '. ')
      .replace(/!\s*,/g, '! ')
      .replace(/\?\s*,/g, '? ')
      .replace(/…\s*,/g, '… ')
      .replace(/,\s*([.!?…])/g, '$1')
      .replace(/,\s*$/g, '')
      .replace(/[ \t]{2,}/g, ' ');

    return out.trim();
  }

  // True CJK content needs only whitespace consolidation and full-width tilde normalization.
  return out.replace(/[〜～]/g, '~').replace(/[ \t]{2,}/g, ' ').trim();
}
