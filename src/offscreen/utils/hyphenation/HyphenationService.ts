/**
 * Central singleton service for on-demand hyphenation dictionary loading, caching,
 * and multi-language syllable resolution across Kites offscreen pipeline and Studio.
 */

import {
  HYPHENATION_DICTIONARY_MAP,
  HYPHEN_MAX_WORD_LENGTH,
  HYPHEN_MIN_LETTERS,
  HYPHEN_MIN_SIDE,
  INDIC_SYLLABLE_LANGS,
  VOWEL_SYLLABLE_LANGS,
} from './types';
import {
  hyphenationPoints,
  parseHyphenationPatterns,
  syllablesFromPoints,
} from './LiangEngine';
import { indicAksharaPoints, vowelPatternPoints } from './syllableRules';
import { getHypherBounds, hyphenation_lang_from_tag } from './hypherCompat';
import { HyphenationDataStore } from './HyphenationDataStore';
import { HYPHER_TRIE_LOADERS } from './hypherData';
import { hasUsablePatterns, isPlausibleHypherTrie } from './hyphenationValidation';
import { contourSyllables, findContourHyphenationPoints } from './contourHyphenation';

export class HyphenationService {
  private static instance: HyphenationService | null = null;

  /** Maximum entries retained in the word hyphenation points cache. */
  private static readonly MAX_WORD_POINTS_CACHE = 2000;

  /** Custom loader hook for testing/node environments to avoid bundling Node built-ins. */
  private static customLoader?: (dictName: string) => Promise<string | null | undefined>;

  /** Composed data ownership and loading, independent of word lookup policy. */
  private readonly data = new HyphenationDataStore(() => this.wordPointsCache.clear());

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
      HyphenationService.instance.data.clear();
      HyphenationService.instance.wordPointsCache.clear();
      HyphenationService.instance = null;
    }
  }

  /**
   * Maps a source or target language code to its legacy Liang dictionary filename.
   * After the hypher unification only the languages with no vendored trie
   * (id, ms, ro) remain dictionary-backed; all other languages resolve through
   * `resolveHypherKey` instead. Signature preserved for existing callers.
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
   * Maps a language tag to its hypher ISO 639-1 key for contour trie loading.
   *
   * @param lang - BCP-47 language tag.
   * @returns ISO 639-1 key, or undefined when hypher has no data.
   */
  public resolveHypherKey(lang: string): string | undefined {
    return hyphenation_lang_from_tag(lang)?.key;
  }

  /**
   * Checks whether the hyphenation data for a language is ready for synchronous
   * queries. Any language with a vendored hypher trie waits for that trie;
   * rule-fallback languages without trie data (ne, az, uz) are always ready;
   * remaining languages wait for their legacy dictionary. Keep this precedence
   * identical to {@link findHyphenationPoints}.
   *
   * @param lang - Target language code.
   * @returns True if the backing trie/dictionary is cached or not required.
   */
  public isLoaded(lang: string): boolean {
    const baseLang = (lang || 'en').split('-')[0].toLowerCase();

    const trieKey = this.resolveHypherKey(baseLang);
    if (trieKey && HYPHER_TRIE_LOADERS[trieKey]) {
      return this.data.hypherTrieCache.has(trieKey);
    }
    if (INDIC_SYLLABLE_LANGS.has(baseLang) || VOWEL_SYLLABLE_LANGS.has(baseLang)) {
      return true;
    }

    const dictName = this.resolveDictionaryName(lang);
    if (!dictName) return true; // No-data languages (CJK, unknown) need no dictionary
    return this.data.patternsCache.has(dictName);
  }

  /**
   * Checks whether the contour-specific hypher trie is ready for a language.
   * Contour segmentation must not fall back to the legacy Liang dictionary, so
   * callers should await `loadLanguage(lang)` when this returns false.
   *
   * @param lang - BCP-47 language tag.
   * @returns True when the trie is cached, or when hypher has no data for the language.
   */
  public isContourReady(lang: string): boolean {
    const hypherKey = this.resolveHypherKey(lang);
    if (!hypherKey) return true; // No contour hyphenation expected
    return this.data.hypherTrieCache.has(hypherKey);
  }

  /**
   * Manually registers raw pattern text into the in-memory cache (legacy Liang format).
   *
   * @param dictName - Target dictionary key (e.g. 'id_ID', 'ro_RO').
   * @param text - Raw Liang pattern text content.
   */
  public registerPatterns(dictName: string, text: string): void {
    const parsed = parseHyphenationPatterns(text);
    if (!hasUsablePatterns(parsed)) {
      throw new Error(`Malformed hyphenation dictionary "${dictName}": no weighted patterns`);
    }
    this.data.patternsCache.set(dictName, parsed);
    this.wordPointsCache.clear();
  }

  /**
   * Manually registers hypher trie binary data.
   *
   * @param hypherKey - ISO 639-1 language code (e.g. 'en', 'de').
   * @param trieData - Raw trie binary data (Uint8Array).
   */
  public registerHypherTrie(hypherKey: string, trieData: Uint8Array): void {
    if (!isPlausibleHypherTrie(trieData)) {
      throw new Error(`Malformed hypher trie "${hypherKey}": invalid header`);
    }
    this.data.hypherTrieCache.set(hypherKey, trieData);
    this.wordPointsCache.clear();
  }

  /**
   * Primes independent legacy dictionaries and contour tries for a language.
   * Concurrent callers share an in-flight load and failures can be retried.
   * @param lang - Target language tag.
   * @returns Promise settled when mapped data loading finishes.
   */
  public async loadLanguage(lang: string): Promise<void> {
    return this.data.load(this.resolveDictionaryName(lang), this.resolveHypherKey(lang),
      HyphenationService.customLoader);
  }

  /**
   * Computes legal hyphenation slice points for a word in the specified language.
   * Dispatch policy: any language with a vendored hypher trie resolves through
   * the curated TeX patterns with the same per-language bounds the contour route
   * uses, so a word splits identically no matter which wrap route renders it.
   * Rule-class languages without trie data (ne, az, uz) use the syllable rules
   * fallback; the remaining languages (id, ms, ro) use the legacy Liang
   * dictionary. The comic-lettering length gates (min letters / max word) apply
   * on the trie path exactly as on the dict path, so words under 6 letters stay
   * whole even though the contour route gates at its own caller instead.
   *
   * @param word - Raw alphabetic token.
   * @param targetLang - Language of the word (default: 'en').
   * @param minSide - Minimum characters required on either side of the hyphen
   *                  (governs the syllable-rules and dictionary paths; the trie
   *                  path uses the language's hypher bounds for route parity).
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

    // Data-backed languages must not memoize "no points" before the data is ready.
    // Prior defect: an early lookup cached [] forever, so a later successful load
    // never took effect for that word. Rule-fallback languages are always ready.
    const trieKey = this.resolveHypherKey(baseLang);
    const trieCapable = trieKey !== undefined && HYPHER_TRIE_LOADERS[trieKey] !== undefined;
    const ruleClass = INDIC_SYLLABLE_LANGS.has(baseLang) || VOWEL_SYLLABLE_LANGS.has(baseLang);
    const cacheable = trieCapable
      ? this.data.hypherTrieCache.has(trieKey)
      : ruleClass
        ? true
        : this.isLoaded(targetLang);

    let points: number[] = [];

    // 1. Languages with vendored hypher tries: curated TeX patterns, per-language
    //    bounds, identical to the contour route.
    if (trieCapable) {
      if (!word || word.length < HYPHEN_MIN_LETTERS || word.length > HYPHEN_MAX_WORD_LENGTH) {
        points = [];
      } else {
        const bounds = getHypherBounds(baseLang);
        points = findContourHyphenationPoints(this.data.hypherTrieCache, word, baseLang, bounds.left, bounds.right);
      }
    } else if (INDIC_SYLLABLE_LANGS.has(baseLang)) {
      // 2a. Indic languages without trie data (Nepali) - akshara rules
      points = indicAksharaPoints(word, minSide);
    } else if (VOWEL_SYLLABLE_LANGS.has(baseLang)) {
      // 2b. Vowel-harmonic languages without trie data (az, uz) - vowel rules
      points = vowelPatternPoints(word, baseLang, minSide);
    } else {
      // 3. Dict-only languages (id, ms, ro) - legacy Liang engine
      const dictName = this.resolveDictionaryName(targetLang);
      if (dictName) {
        const patterns = this.data.patternsCache.get(dictName);
        if (patterns) {
          points = hyphenationPoints(word, patterns, minSide);
        }
      }
    }

    // Cache management
    if (cacheable) {
      if (this.wordPointsCache.size >= HyphenationService.MAX_WORD_POINTS_CACHE) {
        this.wordPointsCache.clear();
      }
      this.wordPointsCache.set(cacheKey, points);
    }
    return points;
  }

  /**
   * @param word - Alphabetic core. @param targetLang - Language tag.
   * @param leftMin - Minimum prefix scalars. @param rightMin - Minimum suffix scalars.
   * @returns Contour-only UTF-16 cuts, or [] until trie data is ready.
   */
  public findContourHyphenationPoints(word: string, targetLang: string,
    leftMin: number, rightMin: number): number[] {
    return findContourHyphenationPoints(this.data.hypherTrieCache, word, targetLang, leftMin, rightMin);
  }

  /**
   * @param word - Alphabetic core. @param targetLang - Language tag.
   * @param leftMin - Minimum prefix scalars. @param rightMin - Minimum suffix scalars.
   * @returns Contour-only syllables, preserving the original word when data is unavailable.
   */
  public contourSyllables(word: string, targetLang: string,
    leftMin: number, rightMin: number): string[] {
    return contourSyllables(this.data.hypherTrieCache, word, targetLang, leftMin, rightMin);
  }

  /**
   * Splits a word into ordered syllables for line-breaking and text measurement.
   * Uses hypher trie if available, otherwise legacy Liang engine.
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