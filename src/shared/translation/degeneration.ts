/**
 * Detects a generation that stopped translating and started repeating itself.
 *
 * Why this exists: a small quantized model under a constrained JSON schema occasionally collapses
 * into a loop that spends the whole completion budget repeating one fragment, which truncates the
 * JSON and leaves every later key missing. The pipeline then reported the page as "echoed" and kept
 * the source text, while the looped fragment itself was rendered into the bubble — the browser log
 * shows both shapes: one bubble filled with "squeaky" ~200 times, another with a nine-word English
 * phrase 29 times.
 *
 * The check is character-level on purpose. It must work for scripts without spaces, for space-filled
 * Latin output, and for JSON punctuation between values, without a tokenizer or a language model.
 * Degeneration is a *contiguous* run — the same block repeated back to back — which is what
 * separates it from a page that legitimately repeats one short line across several bubbles: those
 * are separated by JSON keys, so `"はい","b2":"はい"` is not periodic while a loop is.
 *
 * @module
 */

/** Longest repeated block, in characters, that the detector will look for. */
export const REPETITION_MAX_PERIOD_CHARS = 40;

/** How many times a block must repeat back to back before the completion counts as degenerate. */
export const REPETITION_MIN_REPEATS = 4;

/**
 * Whether a completion contains a block repeated back to back.
 *
 * Walks every candidate period up to `REPETITION_MAX_PERIOD_CHARS` and tracks the longest run where
 * text stays equal to itself shifted by that period. A run of `period * (minRepeats - 1)` matching
 * characters is exactly `minRepeats` consecutive copies of one block.
 *
 * @param text - Raw model output, before parsing.
 * @param maxPeriod - Longest block length to consider, in characters.
 * @param minRepeats - Required number of back-to-back copies.
 * @returns True when the text carries a runaway repetition.
 */
export function hasRunawayRepetition(
  text: string,
  maxPeriod: number = REPETITION_MAX_PERIOD_CHARS,
  minRepeats: number = REPETITION_MIN_REPEATS,
): boolean {
  if (minRepeats < 2) return false;
  for (let period = 1; period <= maxPeriod; period += 1) {
    const needed = period * (minRepeats - 1);
    let run = 0;
    for (let index = period; index < text.length; index += 1) {
      run = text[index] === text[index - period] ? run + 1 : 0;
      if (run >= needed) return true;
    }
  }
  return false;
}
