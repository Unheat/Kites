/**
 * Detects lines that are already written in the target language, so they are left alone.
 *
 * Why this exists: `hasNativeScriptForLang` is a *script* test, and French and English share the
 * script, so it answers "yes, this is source text" for every Latin line. Measured consequence on a
 * page holding two French and two already-English lines: the English lines were re-asked as if they
 * had failed, costing 4 model requests and 3.1 s (`Model echoed 2/4 slots back unchanged (b2, b3)
 * after 4 recovery request(s)`). CJK pages prune correctly; European pages pruned nothing.
 *
 * Why a model and not a rule: there is no script difference to test, and the two candidate rules
 * both fail on measurement. Dropping recovery on a bare echo is unsound — an echo means either
 * "already the target" or "the model failed on this French line", and the reason cannot tell them
 * apart. Nor can any lexical rule: `Sorry to keep you waiting` and `Pardon de vous faire attendre`
 * are the same shape.
 *
 * Scope: the oracle may only make the pipeline *skip work*. It never rejects a translation, never
 * marks a page untranslated, and never reaches the prompt. A wrongly skipped line stays visibly
 * untranslated and a second run translates it; a wrongly rejected one silently loses content.
 */

/**
 * Minimum Latin letters before the oracle is consulted at all.
 *
 * Measured on `eld/large` at confidence 0.6: the only lines it wrongly called English were 2-3
 * character bubbles (`Yes` 0.80, `Ah` 0.68). Shorter than this is missing information, not a
 * classification problem, so the guard excludes them instead of tuning the threshold.
 */
export const MIN_LATIN_LETTERS_FOR_ORACLE = 4;

/**
 * Detector confidence required to treat a line as already being the target language.
 *
 * Measured with `eld/large` over 22 English, 18 French, 18 German, 18 Spanish, 18 Vietnamese and
 * 11 romanised-Japanese lines: at 0.6 the oracle skipped 22/22 English and **zero** lines from the
 * other languages once the length guard excluded 2-3 character bubbles. At 0.7 recall is the same
 * with one fewer false skip; at 0.8 recall halves (12/22); at 0.9 it is zero.
 */
export const TARGET_LANGUAGE_CONFIDENCE = 0.6;

/** Latin-script language ids the oracle may consult, from `LanguageRegistry`. */
const LATIN_TARGET_IDS = [
  'af', 'az', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'en', 'es', 'et', 'eu', 'fi', 'fr', 'ga',
  'gl', 'hr', 'hu', 'id', 'is', 'it', 'la', 'lt', 'lv', 'ms', 'mt', 'nl', 'no', 'pl', 'pt',
  'ro', 'sk', 'sl', 'sq', 'sv', 'sw', 'tl', 'tr', 'vi', 'yo', 'zu',
];

/** One line's Latin letter count, used for the length guard. */
const LATIN_LETTER_RE = /[A-Za-z]/g;

/**
 * Text has only Latin letters or non-letters, and enough of them to classify.
 *
 * @param text - Candidate line.
 * @returns Whether the oracle should be asked about this line.
 */
function isClassifiableLatin(text: string): boolean {
  const latinLetters = text.match(LATIN_LETTER_RE)?.length ?? 0;
  if (latinLetters < MIN_LATIN_LETTERS_FOR_ORACLE) return false;
  // Any letter outside Latin (CJK, Cyrillic, Thai, Arabic, kana) means this is not a Latin line and
  // a Latin target cannot already be its language.
  return !/[^\s\p{Script=Latin}\p{N}\p{P}\p{S}]/u.test(text);
}

/**
 * Whether the oracle should run at all for this language pair.
 *
 * @param sourceLangId - Requested source language id (`auto` allowed).
 * @param targetLangId - Requested target language id.
 * @returns Whether a Latin-script target is involved and the pair is not a no-op.
 */
export function shouldConsultOracle(sourceLangId: string, targetLangId: string): boolean {
  const target = (targetLangId || '').trim().toLowerCase();
  const source = (sourceLangId || '').trim().toLowerCase();
  if (!target || !source) return false;
  if (!LATIN_TARGET_IDS.some((id) => target === id || target.startsWith(`${id}-`) || target.startsWith(`${id}_`))) {
    return false;
  }
  // Translating a language into itself is not a real request; leave it to the engine.
  if (source === target || source.startsWith(`${target}-`) || source.startsWith(`${target}_`)) {
    return false;
  }
  // `auto` is deliberately allowed: page-level resolution only names ja/ko/zh, so a European page
  // under `auto` gets no script pruning whatsoever (`hasNativeScriptForLang` answers `true` for every
  // Latin line). That is the case where this oracle earns its bundle.
  return true;
}

/**
 * Share of a page's letters that must be Latin before the detector is loaded at all.
 *
 * The detector is a 4.6 MB chunk (1.27 MB gzipped) and parsing it costs ~585 ms, which a page that
 * is mostly CJK can never benefit from: measured over every fixture combo, the oracle skips **0 of
 * 186 lines** when the page is CJK, because a Chinese or Japanese line is not classifiable Latin
 * text. Requiring a mostly-Latin page keeps that cost off the common path entirely - a Japanese
 * page with one `Chapter 12` bubble measures 10 % Latin letters and never loads the chunk.
 */
export const MIN_PAGE_LATIN_SHARE_FOR_ORACLE = 0.5;

/**
 * Share of a page's letters that are Latin script.
 *
 * @param texts - Page lines.
 * @returns Latin letters over all letters, or 0 when the page has no letters.
 */
function pageLatinShare(texts: readonly string[]): number {
  let latin = 0;
  let letters = 0;
  for (const text of texts) {
    for (const char of text ?? '') {
      if (!/\p{L}/u.test(char)) continue;
      letters += 1;
      if (/\p{Script=Latin}/u.test(char)) latin += 1;
    }
  }
  return letters === 0 ? 0 : latin / letters;
}

/**
 * Memoised detector loader, so the 1.27 MB model is parsed once per offscreen document lifetime.
 *
 * The import is dynamic on purpose: content scripts and the popup must never pull this bundle, and
 * most pages (CJK sources) never need it.
 */
let detectorPromise: Promise<((text: string) => { language: string; score: number }) | null> | null = null;

/** Set only by {@link setOracleDisabledForTests}; false in production. */
let oracleDisabledForTests = false;

/**
 * Loads `eld/large` once and adapts it to a minimal shape.
 *
 * @returns A detector, or `null` when the model cannot be loaded (the caller then translates normally).
 */
function loadDetector(): Promise<((text: string) => { language: string; score: number }) | null> {
  if (!detectorPromise) {
    detectorPromise = import('eld/large')
      .then((module) => {
        const eld = (module as { eld?: { detect?: (text: string) => unknown } }).eld;
        if (!eld?.detect) return null;
        return (text: string) => {
          const result = eld.detect?.(text) as
            | { language?: string; score?: number; getScores?: () => Record<string, number> }
            | undefined;
          const language = result?.language ?? '';
          // `getScores()` reports per-language confidence; `score` alone is the raw top value.
          const score = result?.getScores?.()?.[language] ?? result?.score ?? 0;
          return { language, score };
        };
      })
      .catch(() => null);
  }
  return detectorPromise;
}

/**
 * Indices of lines the pipeline should leave exactly as they are.
 *
 * A line is returned when it is Latin text of at least {@link MIN_LATIN_LETTERS_FOR_ORACLE} letters,
 * the page is mostly Latin script, the language pair is Latin-to-Latin, and the detector names the
 * target language at {@link TARGET_LANGUAGE_CONFIDENCE} or above.
 *
 * @param texts - Page lines, in page order.
 * @param sourceLangId - Requested source language id.
 * @param targetLangId - Requested target language id.
 * @returns Indices already written in the target language; empty when the oracle does not apply.
 */
export async function findAlreadyTargetLines(
  texts: string[],
  sourceLangId: string,
  targetLangId: string
): Promise<Set<number>> {
  const already = new Set<number>();
  if (oracleDisabledForTests) return already;
  if (!shouldConsultOracle(sourceLangId, targetLangId)) return already;
  // Checked before the candidate scan: this is the cheapest way to skip loading the model on a page
  // that cannot benefit from it.
  if (pageLatinShare(texts) < MIN_PAGE_LATIN_SHARE_FOR_ORACLE) return already;

  const candidates = texts
    .map((text, index) => ({ text: text?.trim() ?? '', index }))
    .filter(({ text }) => Boolean(text) && isClassifiableLatin(text));
  if (candidates.length === 0) return already;

  const detect = await loadDetector();
  // A failed load degrades to "no opinion": the page translates as it did before this module existed.
  if (!detect) return already;

  const target = targetLangId.trim().toLowerCase();
  for (const { text, index } of candidates) {
    const { language, score } = detect(text);
    if (!language) continue;
    const matchesTarget = language === target || language.startsWith(`${target}-`);
    if (matchesTarget && score >= TARGET_LANGUAGE_CONFIDENCE) already.add(index);
  }
  return already;
}

/** Test seam: forget the loaded detector and its memoised promise. */
export function resetDetectorForTests(): void {
  detectorPromise = null;
  oracleDisabledForTests = false;
}

/**
 * Test seam: force the oracle to abstain.
 *
 * Protocol tests assert keyed-JSON mechanics on synthetic Latin fixtures (`Item 0`, `First text`)
 * sent as `ja -> en`. Those lines really are English, so the oracle would correctly skip them and
 * the test would never reach the model. Disabling it keeps such a test about the protocol.
 *
 * @param disabled - Whether the oracle must abstain.
 */
export function setOracleDisabledForTests(disabled: boolean): void {
  oracleDisabledForTests = disabled;
}
