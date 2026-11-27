/**
 * lineBreakRules.ts
 * Line-break legality predicates for the dialogue tokenizer and the reflow unwrapper.
 *
 * Character data provenance: codepoint ranges transcribed from public typographic
 * standards — Unicode UAX #14 line-break classes (OP open punctuation, QU quotes,
 * PR numeric prefixes, CL close punctuation, EX exclamations, HY/BA dashes,
 * NS non-starters, IN inseparables), the W3C "Requirements for Japanese Text Layout"
 * appendix tables of characters forbidden at line start, and Unicode Script property
 * ranges for scripts written without inter-word spaces. Ranges live in data tables
 * instead of inline regex literals so every group can cite its source class; the
 * surrounding typesetting test suites lock the observable behavior.
 */

/** Closed codepoint range [start, end] inclusive. */
interface CodePointRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Marks that bind forward to the following word (UAX #14 classes OP/QU/PR:
 * opening brackets, opening quotes, currency and other numeric prefixes).
 */
const OPENING_MARK_RANGES: readonly CodePointRange[] = [
  { start: 0x0023, end: 0x0024 }, // # $ (PR)
  { start: 0x0028, end: 0x0028 }, // ( (OP)
  { start: 0x005b, end: 0x005b }, // [ (OP)
  { start: 0x007b, end: 0x007b }, // { (OP)
  { start: 0x00a1, end: 0x00a1 }, // ¡
  { start: 0x00a3, end: 0x00a3 }, // £ (PR)
  { start: 0x00a5, end: 0x00a5 }, // ¥ (PR)
  { start: 0x00a7, end: 0x00a7 }, // §
  { start: 0x00ab, end: 0x00ab }, // « (QU)
  { start: 0x00bf, end: 0x00bf }, // ¿
  { start: 0x0e3f, end: 0x0e3f }, // ฿ (PR)
  { start: 0x2018, end: 0x2018 }, // ‘ (QU)
  { start: 0x201a, end: 0x201c }, // ‚ ‛ “ (QU)
  { start: 0x201e, end: 0x201f }, // „ ‟ (QU)
  { start: 0x2039, end: 0x2039 }, // ‹ (QU)
  { start: 0x20a6, end: 0x20a6 }, // ₦ (PR)
  { start: 0x20a9, end: 0x20a9 }, // ₩ (PR)
  { start: 0x20ac, end: 0x20ac }, // € (PR)
  { start: 0x20b1, end: 0x20b1 }, // ₱ (PR)
  { start: 0x20b9, end: 0x20b9 }, // ₹ (PR)
  { start: 0x20bd, end: 0x20bd }, // ₽ (PR)
  { start: 0x2116, end: 0x2116 }, // № (PR)
  { start: 0x2329, end: 0x2329 }, // 〈 (OP, deprecated angle)
  { start: 0x3008, end: 0x3008 }, // 〈 (OP)
  { start: 0x300a, end: 0x300a }, // 《 (OP)
  { start: 0x300c, end: 0x300c }, // 「 (OP)
  { start: 0x300e, end: 0x300e }, // 『 (OP)
  { start: 0x3010, end: 0x3010 }, // 【 (OP)
  { start: 0x3014, end: 0x3014 }, // 〔 (OP)
  { start: 0x3016, end: 0x3016 }, // 〖 (OP)
  { start: 0x3018, end: 0x3018 }, // 〘 (OP)
  { start: 0x301a, end: 0x301a }, // 〚 (OP)
  { start: 0x301d, end: 0x301d }, // 〝 (OP)
  { start: 0xff08, end: 0xff08 }, // （ (OP, fullwidth)
  { start: 0xff3b, end: 0xff3b }, // ［ (OP, fullwidth)
  { start: 0xff5b, end: 0xff5b }, // ｛ (OP, fullwidth)
  { start: 0xff5f, end: 0xff5f }, // ｟ (OP, fullwidth)
  { start: 0xff62, end: 0xff62 }, // ｢ (OP, halfwidth)
];

/**
 * Characters forbidden at line start (W3C jlreq 行頭禁則 table, backed by the
 * UAX #14 CL/EX/NS/IN classes: closers, exclamations, dashes, iteration marks).
 */
const LINE_START_FORBIDDEN_RANGES: readonly CodePointRange[] = [
  { start: 0x0021, end: 0x0021 }, // !
  { start: 0x0029, end: 0x0029 }, // )
  { start: 0x002c, end: 0x002c }, // ,
  { start: 0x002d, end: 0x002d }, // -
  { start: 0x003a, end: 0x003b }, // : ;
  { start: 0x003f, end: 0x003f }, // ?
  { start: 0x005d, end: 0x005d }, // ]
  { start: 0x007d, end: 0x007d }, // }
  { start: 0x007e, end: 0x007e }, // ~
  { start: 0x060c, end: 0x060c }, // ، (Arabic comma)
  { start: 0x06d4, end: 0x06d4 }, // ۔ (Urdu full stop)
  { start: 0x0e46, end: 0x0e46 }, // ๆ (Thai repetition, IN)
  { start: 0x0e4f, end: 0x0e4f }, // ฯ (Thai fongman)
  { start: 0x2012, end: 0x2015 }, // ‒ – — ― (dashes)
  { start: 0x2025, end: 0x2026 }, // ‥ … (IN)
  { start: 0x2500, end: 0x2500 }, // ─
  { start: 0x266a, end: 0x266a }, // ♪
  { start: 0x3001, end: 0x3002 }, // 、 。 (CL)
  { start: 0x3009, end: 0x300b }, // 〉 》 (CL)
  { start: 0x300d, end: 0x300f }, // 」 』 (CL)
  { start: 0x3011, end: 0x3011 }, // 】 (CL)
  { start: 0x3017, end: 0x3017 }, // 〕 (CL)
  { start: 0x3019, end: 0x3019 }, // 〙 (CL)
  { start: 0x301b, end: 0x301b }, // 〛 (CL)
  { start: 0x30fc, end: 0x30fc }, // ー (NS, prolonged sound mark)
  { start: 0x31f0, end: 0x31ff }, // small katakana phonetic extensions (NS)
  { start: 0xff01, end: 0xff01 }, // ！ (CL, fullwidth)
  { start: 0xff09, end: 0xff09 }, // ） (CL, fullwidth)
  { start: 0xff0c, end: 0xff0c }, // ， (CL, fullwidth)
  { start: 0xff0e, end: 0xff0e }, // ． (CL, fullwidth)
  { start: 0xff1a, end: 0xff1b }, // ： ； (CL, fullwidth)
  { start: 0xff1f, end: 0xff1f }, // ？ (CL, fullwidth)
  { start: 0xff5e, end: 0xff5e }, // ～ (NS, fullwidth tilde)
  { start: 0xff64, end: 0xff64 }, // ｡ (CL, halfwidth ideographic full stop)
];

/**
 * Dashes a line may split at when they sit inside a word (UAX #14 HY/BA members).
 */
const BREAKABLE_DASH_RANGES: readonly CodePointRange[] = [
  { start: 0x002d, end: 0x002d }, // - (HY)
  { start: 0x2010, end: 0x2010 }, // ‐ (HY)
  { start: 0x2012, end: 0x2015 }, // ‒ – — ― (BA)
];

/**
 * Scripts written without inter-word spaces (Unicode Script property ranges:
 * Thai, Lao, Myanmar, Khmer, kana, CJK ideographs and their compatibility forms).
 */
const CONTINUOUS_SCRIPT_RANGES: readonly CodePointRange[] = [
  { start: 0x0e00, end: 0x0eff }, // Thai + Lao
  { start: 0x1000, end: 0x109f }, // Myanmar
  { start: 0x1780, end: 0x17ff }, // Khmer
  { start: 0x2e80, end: 0x303f }, // CJK radicals + punctuation
  { start: 0x3040, end: 0x30ff }, // Hiragana + Katakana
  { start: 0x3400, end: 0x4dbf }, // CJK extension A
  { start: 0x4e00, end: 0x9fff }, // CJK unified ideographs
  { start: 0xf900, end: 0xfaff }, // CJK compatibility ideographs
  { start: 0xfe30, end: 0xfe4f }, // CJK compatibility forms
  { start: 0xff01, end: 0xff0f }, // fullwidth ASCII punctuation
  { start: 0xff1a, end: 0xff20 }, // fullwidth ： through @
  { start: 0xff3b, end: 0xff40 }, // fullwidth ［ through `
  { start: 0xff5b, end: 0xff9f }, // fullwidth ｛ through halfwidth kana
];

/**
 * Tests whether a single character falls inside a codepoint range table.
 *
 * @param ch - Single character to classify.
 * @param ranges - Closed codepoint ranges to scan.
 * @returns True when the character's primary codepoint lies in a range.
 */
function isCodePointInRanges(ch: string, ranges: readonly CodePointRange[]): boolean {
  if (!ch) return false;
  const code = ch.codePointAt(0)!;
  for (const range of ranges) {
    if (code >= range.start && code <= range.end) return true;
  }
  return false;
}

/**
 * Checks whether a character belongs to a script written without inter-word
 * spaces (CJK, kana, Thai, Lao, Myanmar, Khmer and their fullwidth forms).
 *
 * @param ch - Single character to inspect.
 * @returns True when the character belongs to a continuous (spaceless) script.
 */
export function isContinuousScriptChar(ch: string): boolean {
  return isCodePointInRanges(ch, CONTINUOUS_SCRIPT_RANGES);
}

/**
 * Checks whether a string cluster ends in a dash that sits inside a word
 * (e.g. the authored compound in "well-known") rather than standalone punctuation.
 *
 * @param cluster - String segment ending in a possible dash.
 * @returns True when the trailing dash bonds with the preceding letter.
 */
export function isCompoundDashTail(cluster: string): boolean {
  if (!cluster || cluster.length < 2) return false;
  if (!isCodePointInRanges(cluster[cluster.length - 1], BREAKABLE_DASH_RANGES)) return false;
  const before = cluster[cluster.length - 2];
  return (
    !/\s/.test(before) &&
    !isCodePointInRanges(before, BREAKABLE_DASH_RANGES) &&
    !isCodePointInRanges(before, OPENING_MARK_RANGES)
  );
}

/**
 * Checks whether a character is a dash a word may split at.
 *
 * @param ch - Single character to inspect.
 * @returns True when the character is a breakable dash.
 */
export function isBreakableDash(ch: string): boolean {
  return isCodePointInRanges(ch, BREAKABLE_DASH_RANGES);
}

/**
 * Checks whether any character in a token is a forward-binding opening mark.
 * Mirrors the tokenizer's token-level test: a token like 「こんにちは contains
 * an opening bracket and must absorb the following segment.
 *
 * @param text - Token text to scan.
 * @returns True when the token contains at least one opening mark.
 */
export function isOpeningMark(text: string): boolean {
  if (!text) return false;
  for (const ch of text) {
    if (isCodePointInRanges(ch, OPENING_MARK_RANGES)) return true;
  }
  return false;
}

/**
 * Checks whether a text's first character is forbidden from starting a rendered
 * line under the W3C Japanese layout line-start prohibition table.
 *
 * @param text - Candidate line-start text (leading character decides).
 * @returns True when starting a line with this text's first character is barred.
 */
export function isLineStartForbidden(text: string): boolean {
  if (!text) return false;
  return isCodePointInRanges(text[0], LINE_START_FORBIDDEN_RANGES);
}
