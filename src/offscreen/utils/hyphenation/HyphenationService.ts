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

  /** Maximum entries retained in the word hyphenation points cache. */
  private static readonly MAX_WORD_POINTS_CACHE = 2000;

  /** Custom loader hook for testing/node environments to avoid bundling Node built-ins. */
  private static customLoader?: (dictName: string) => Promise<string | null | undefined>;

  /** Cache of parsed Liang pattern collections keyed by dictionary name (e.g. 'en_US', 'de_DE'). */
  private patternsCache = new Map<string, ParsedPatterns>();

  /** Active load promises to prevent redundant simultaneous fetches for the same dictionary. */
  private pendingLoads = new Map<string, Promise<void>>();

  /** Word-level memoization cache for hyphenation points: key = `${targetLang}:${word}:${minSide}` */
  private wordPointsCache = new Map<string, number[]>();

  private constructor() {}

  /**
   * Registers a custom pattern file loader (e.g. test environment filesystem reader).
   */
  public static setCustomLoader(loader: ((dictName: string) => Promise<string | null | undefined>) | undefined): void {
    HyphenationService.customLoader = loader;
  }

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
      HyphenationService.instance.wordPointsCache.clear();
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
   * Internal loader that fetches pattern text from extension assets or custom loader fallback.
   */
  private async fetchAndParseDictionary(dictName: string): Promise<void> {
    // 1. Try registered custom loader (e.g. test environment Node reader)
    if (HyphenationService.customLoader) {
      try {
        const customContent = await HyphenationService.customLoader(dictName);
        if (customContent) {
          this.patternsCache.set(dictName, parseHyphenationPatterns(customContent));
          return;
        }
      } catch {
        // Fall through to runtime fetch
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
    const cacheKey = `${baseLang}:${word}:${minSide}`;
    const cached = this.wordPointsCache.get(cacheKey);
    if (cached) return cached;

    let points: number[] = [];

    // 1. Indic scripts (Devanagari, Bengali, Tamil, etc.)
    if (INDIC_SYLLABLE_LANGS.has(baseLang)) {
      points = getIndicSyllablePoints(word, minSide);
    } else if (VOWEL_SYLLABLE_LANGS.has(baseLang)) {
      // 2. Vowel-syllabic languages (Turkish, Finnish, Azerbaijani)
      points = getVowelSyllablePoints(word, baseLang, minSide);
    } else {
      // 3. Dictionary-backed Liang engine
      const dictName = this.resolveDictionaryName(targetLang);
      if (dictName) {
        const patterns = this.patternsCache.get(dictName);
        if (patterns) {
          points = hyphenationPoints(word, patterns, minSide);
        }
      }
    }

    if (this.wordPointsCache.size >= HyphenationService.MAX_WORD_POINTS_CACHE) {
      this.wordPointsCache.clear();
    }
    this.wordPointsCache.set(cacheKey, points);
    return points;
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
