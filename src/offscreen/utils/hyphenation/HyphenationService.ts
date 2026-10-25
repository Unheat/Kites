/**
 * Central singleton service for on-demand hyphenation dictionary loading, caching,
 * and multi-language syllable resolution across Kites offscreen pipeline and Studio.
 */

import {
  HYPHENATION_DICTIONARY_MAP,
  HYPHEN_MIN_SIDE,
  INDIC_SYLLABLE_LANGS,
  type ParsedPatterns,
  VOWEL_SYLLABLE_LANGS,
} from './types';
import {
  hyphenationPoints,
  parseHyphenationPatterns,
  syllablesFromPoints,
} from './LiangEngine';
import { getIndicSyllablePoints, getVowelSyllablePoints } from './RuleBasedEngine';

export class HyphenationService {
  private static instance: HyphenationService | null = null;

  /** Cache of parsed Liang pattern collections keyed by dictionary name (e.g. 'en_US', 'de_DE'). */
  private patternsCache = new Map<string, ParsedPatterns>();

  /** Active load promises to prevent redundant simultaneous fetches for the same dictionary. */
  private pendingLoads = new Map<string, Promise<void>>();

  private constructor() {}

  /**
   * Returns the shared singleton instance of HyphenationService.
   */
  public static getInstance(): HyphenationService {
    if (!HyphenationService.instance) {
      HyphenationService.instance = new HyphenationService();
    }
    return HyphenationService.instance;
  }

  /**
   * Resets the singleton instance and caches (used primarily during unit testing).
   */
  public static resetInstance(): void {
    if (HyphenationService.instance) {
      HyphenationService.instance.patternsCache.clear();
      HyphenationService.instance.pendingLoads.clear();
      HyphenationService.instance = null;
    }
  }

  /**
   * Maps a source or target language code to its canonical dictionary filename.
   *
   * @param lang - ISO 639-1 or composite language code (e.g. 'en', 'es-419', 'pt-BR').
   * @returns Dictionary filename without extension, or undefined if not dictionary-backed.
   */
  public resolveDictionaryName(lang: string): string | undefined {
    if (!lang) return undefined;
    const direct = HYPHENATION_DICTIONARY_MAP[lang];
    if (direct) return direct;
    const base = lang.split('-')[0].toLowerCase();
    return HYPHENATION_DICTIONARY_MAP[base];
  }

  /**
   * Checks whether the hyphenation rules/dictionary for a given language are ready for synchronous queries.
   *
   * @param lang - Target language code.
   * @returns True if the dictionary is cached or if the language is rule-based / monosyllabic.
   */
  public isLoaded(lang: string): boolean {
    const dictName = this.resolveDictionaryName(lang);
    if (!dictName) return true; // Rule-based or CJK needs no dictionary
    return this.patternsCache.has(dictName);
  }

  /**
   * Manually registers raw pattern text into the in-memory cache.
   *
   * @param dictName - Target dictionary key (e.g. 'en_US', 'es').
   * @param text - Raw Liang pattern text content.
   */
  public registerPatterns(dictName: string, text: string): void {
    this.patternsCache.set(dictName, parseHyphenationPatterns(text));
  }

  /**
   * Asynchronously loads and parses the pattern dictionary for a given language.
   * Safe to call multiple times concurrently; subsequent calls share the in-flight Promise.
   *
   * @param lang - Target language code (e.g. 'en', 'es', 'de', 'fr').
   */
  public async loadLanguage(lang: string): Promise<void> {
    const dictName = this.resolveDictionaryName(lang);
    if (!dictName) return; // No dictionary required for this language

    if (this.patternsCache.has(dictName)) {
      return;
    }

    const inFlight = this.pendingLoads.get(dictName);
    if (inFlight) {
      return inFlight;
    }

    const loadPromise = this.fetchAndParseDictionary(dictName)
      .finally(() => {
        this.pendingLoads.delete(dictName);
      });

    this.pendingLoads.set(dictName, loadPromise);
    return loadPromise;
  }

  /**
   * Internal loader that fetches pattern text from extension assets or filesystem fallback.
   */
  private async fetchAndParseDictionary(dictName: string): Promise<void> {
    // 1. Try Node.js filesystem read if in test / runner environment
    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const candidatePaths = [
          path.resolve(process.cwd(), 'public/assets/hyphenation', `${dictName}.txt`),
          path.resolve(process.cwd(), 'dist/assets/hyphenation', `${dictName}.txt`),
        ];
        for (const p of candidatePaths) {
          if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8');
            this.patternsCache.set(dictName, parseHyphenationPatterns(content));
            return;
          }
        }
      } catch {
        // Fall through to standard fetch
      }
    }

    // 2. Browser / Chrome Extension runtime fetch
    try {
      const assetUrl =
        typeof chrome !== 'undefined' && chrome.runtime?.getURL
          ? chrome.runtime.getURL(`assets/hyphenation/${dictName}.txt`)
          : `/assets/hyphenation/${dictName}.txt`;

      const response = await fetch(assetUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${dictName}.txt`);
      }
      const text = await response.text();
      this.patternsCache.set(dictName, parseHyphenationPatterns(text));
    } catch (err) {
      console.warn(`[HyphenationService] Failed to load hyphenation dictionary "${dictName}":`, err);
    }
  }

  /**
   * Computes legal hyphenation slice points for a word in the specified language.
   *
   * @param word - Raw alphabetic token.
   * @param targetLang - Language of the word (default: 'en').
   * @param minSide - Minimum characters required on either side of the hyphen.
   * @returns Array of character slice offsets where a hyphen may be inserted.
   */
  public findHyphenationPoints(
    word: string,
    targetLang: string = 'en',
    minSide: number = HYPHEN_MIN_SIDE
  ): number[] {
    const baseLang = (targetLang || 'en').split('-')[0].toLowerCase();

    // 1. Indic scripts (Devanagari, Bengali, Tamil, etc.)
    if (INDIC_SYLLABLE_LANGS.has(baseLang)) {
      return getIndicSyllablePoints(word, minSide);
    }

    // 2. Vowel-syllabic languages (Turkish, Finnish, Azerbaijani)
    if (VOWEL_SYLLABLE_LANGS.has(baseLang)) {
      return getVowelSyllablePoints(word, baseLang, minSide);
    }

    // 3. Dictionary-backed Liang engine
    const dictName = this.resolveDictionaryName(targetLang);
    if (dictName) {
      const patterns = this.patternsCache.get(dictName);
      if (patterns) {
        return hyphenationPoints(word, patterns, minSide);
      }
    }

    return [];
  }

  /**
   * Splits a word into ordered syllables for line-breaking and text measurement.
   *
   * @param word - Source word string without whitespace.
   * @param targetLang - Language of the word (default: 'en').
   * @param minSide - Minimum characters required on either side.
   * @returns Ordered syllable array whose join('') equals word.
   */
  public syllables(
    word: string,
    targetLang: string = 'en',
    minSide: number = HYPHEN_MIN_SIDE
  ): string[] {
    if (!word) return [];

    const points = this.findHyphenationPoints(word, targetLang, minSide);
    if (points.length > 0) {
      return syllablesFromPoints(word, points);
    }

    // Fallback: short words stay whole; longer words stay whole unless breaking is forced
    return [word];
  }
}
