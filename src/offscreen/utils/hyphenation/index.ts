/**
 * Entry point for the on-demand hyphenation subsystem.
 */

export * from './types';
export * from './LiangEngine';
export * from './RuleBasedEngine';
export * from './HyphenationService';

import { HyphenationService } from './HyphenationService';
import { HYPHEN_MIN_SIDE } from './types';

/**
 * Functional convenience helper to split a word into ordered syllables.
 *
 * @param word - Word to split.
 * @param targetLang - Target language code (default 'en').
 * @param minSide - Minimum characters required on either side.
 * @returns Ordered syllable array.
 */
export function syllables(
  word: string,
  targetLang: string = 'en',
  minSide: number = HYPHEN_MIN_SIDE
): string[] {
  return HyphenationService.getInstance().syllables(word, targetLang, minSide);
}

/**
 * Functional convenience helper to pre-load a language dictionary into memory.
 *
 * @param targetLang - Target language code.
 */
export async function loadHyphenationLanguage(targetLang: string): Promise<void> {
  return HyphenationService.getInstance().loadLanguage(targetLang);
}
