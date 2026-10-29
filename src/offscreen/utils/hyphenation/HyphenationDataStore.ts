/** Composed on-demand data store; legacy patterns and contour tries remain independent. */
import type { ParsedPatterns } from './types';
import { parseHyphenationPatterns } from './LiangEngine';
import { HYPHER_TRIE_LOADERS } from './hypherData';
import { hasUsablePatterns, isPlausibleHypherTrie } from './hyphenationValidation';

/** Optional test/runtime source for raw legacy dictionary text. */
export type DictionaryLoader = (dictName: string) => Promise<string | null | undefined>;

export class HyphenationDataStore {
  /** Parsed legacy Liang data, keyed by dictionary asset name. */
  public readonly patternsCache = new Map<string, ParsedPatterns>();
  /** Exact contour trie data, keyed by canonical ISO language code. */
  public readonly hypherTrieCache = new Map<string, Uint8Array>();
  /** In-flight data loads shared by callers of the same language. */
  private readonly pendingLoads = new Map<string, Promise<void>>();
  private readonly invalidateWordPoints: () => void;

  /**
   * @param invalidateWordPoints - Clears dependent lookup memoization after loading.
   * @returns A data store with independent legacy and contour caches.
   */
  public constructor(invalidateWordPoints: () => void) {
    this.invalidateWordPoints = invalidateWordPoints;
  }

  /** Clears all data and in-flight bookkeeping; returns nothing. */
  public clear(): void {
    this.patternsCache.clear();
    this.hypherTrieCache.clear();
    this.pendingLoads.clear();
  }

  /**
   * Asynchronously loads and parses the pattern dictionary for a given language.
   * Primes BOTH legacy Liang dictionary AND hypher trie (if available for the language).
   * Safe to call multiple times concurrently; subsequent calls share the in-flight Promise.
   *
   * @param dictName - Resolved legacy dictionary name, if any.
   * @param hypherKey - Resolved contour trie key, if any.
   * @param customLoader - Optional legacy dictionary source.
   * @returns Promise that settles after the mapped data has been loaded.
   */
  public async load(
    dictName: string | undefined, hypherKey: string | undefined, customLoader?: DictionaryLoader
  ): Promise<void> {

    // No dictionary or trie required for this language (CJK, etc.)
    if (!dictName && !hypherKey) return;

    // Check if every mapped source is already loaded.
    const legacyLoaded = dictName === undefined || this.patternsCache.has(dictName);
    const hypherLoaded = hypherKey === undefined || this.hypherTrieCache.has(hypherKey);
    if (legacyLoaded && hypherLoaded) return;

    // Create cache key for pending load (use hypherKey if available, else dictName)
    const loadKey = hypherKey ?? dictName!;
    const inFlight = this.pendingLoads.get(loadKey);
    if (inFlight) {
      return inFlight;
    }

    const loadPromise = this.fetchAndParseDictionary(dictName, hypherKey, customLoader)
      .finally(() => {
        this.pendingLoads.delete(loadKey);
      });

    this.pendingLoads.set(loadKey, loadPromise);
    return loadPromise;
  }

  /**
   * Internal loader that fetches pattern text from extension assets or custom loader fallback.
   * Clears partial state on failure and rejects total failures so callers can retry.
   * @param dictName - Legacy dictionary name.
   * @param hypherKey - Contour trie key.
   * @param customLoader - Optional legacy dictionary source.
   * @returns Promise settled after both independent sources have been attempted.
   */
  private async fetchAndParseDictionary(
    dictName: string | undefined, hypherKey: string | undefined, customLoader?: DictionaryLoader
  ): Promise<void> {
    const errors: Error[] = [];

    // 1. Prime missing legacy data only; loading an independent contour trie
    // must not replace an already registered Liang dictionary.
    if (dictName && !this.patternsCache.has(dictName)) {
      try {
        // Try registered custom loader first (test environment)
        if (customLoader) {
          try {
            const customContent = await customLoader(dictName);
            if (customContent) {
              const parsed = parseHyphenationPatterns(customContent);
              if (!hasUsablePatterns(parsed)) {
                throw new Error(`Malformed hyphenation dictionary "${dictName}": no weighted patterns`);
              }
              this.patternsCache.set(dictName, parsed);
            }
          } catch (customErr) {
            // Fall through to runtime fetch
            errors.push(customErr as Error);
          }
        }

        // If not loaded via custom loader, fetch from runtime
        if (!this.patternsCache.has(dictName)) {
          const assetUrl =
            typeof chrome !== 'undefined' && chrome.runtime?.getURL
              ? chrome.runtime.getURL(`assets/hyphenation/${dictName}.txt`)
              : `/assets/hyphenation/${dictName}.txt`;

          const response = await fetch(assetUrl);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} fetching ${dictName}.txt`);
          }
          const text = await response.text();
          const parsed = parseHyphenationPatterns(text);
          if (!hasUsablePatterns(parsed)) {
            throw new Error(`Malformed hyphenation dictionary "${dictName}": no weighted patterns`);
          }
          this.patternsCache.set(dictName, parsed);
        }
      } catch (err) {
        errors.push(err as Error);
        // Do not retain corrupt or partial dictionary state.
        if (dictName) this.patternsCache.delete(dictName);
      }
    }

    // 2. Load hypher trie if available for this language
    if (hypherKey && HYPHER_TRIE_LOADERS[hypherKey]) {
      try {
        const trieData = await this.fetchHypherTrie(hypherKey);
        if (trieData) {
          this.hypherTrieCache.set(hypherKey, trieData);
        }
      } catch (err) {
        errors.push(err as Error);
        if (hypherKey) this.hypherTrieCache.delete(hypherKey);
      }
    }

    // Invalidate word-level memoization once new data is available. Without this,
    // a lookup performed before the dictionary/trie was ready could keep returning
    // its pre-load [] result forever (the original cache defect).
    const loadedAny =
      (dictName !== undefined && this.patternsCache.has(dictName)) ||
      (hypherKey !== undefined && this.hypherTrieCache.has(hypherKey));
    if (loadedAny) {
      this.invalidateWordPoints();
    }

    // If both failed and we have errors, throw the first one so caller knows load failed
    // This enables retry logic: caller can catch and call loadLanguage again
    if (errors.length > 0 && !this.patternsCache.has(dictName!) && !this.hypherTrieCache.has(hypherKey!)) {
      throw errors[0];
    }

    // Log warnings for partial failures but don't throw if at least one succeeded
    for (const err of errors) {
      const target = dictName ?? hypherKey ?? 'unknown';
      console.warn(`[HyphenationService] Failed to load hyphenation data for "${target}":`, err);
    }
  }

  /**
   * Loads the exact hypher 0.1.8 trie chunk for a language via the static loader map.
   * Each language is a separate dynamic-import chunk; nothing is eager.
   *
   * @param hypherKey - ISO 639-1 language code.
   * @returns Raw trie bytes, or null if the language has no hypher data.
   */
  private async fetchHypherTrie(hypherKey: string): Promise<Uint8Array | null> {
    const loader = HYPHER_TRIE_LOADERS[hypherKey];
    if (!loader) return null;

    const mod = await loader();
    const base64 = mod.default;
    if (!base64) return null;

    // Decode base64 to raw bytes without Node Buffer (browser + Node compatible).
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    if (!isPlausibleHypherTrie(bytes)) {
      throw new Error(`Malformed hypher trie "${hypherKey}": invalid header`);
    }
    return bytes;
  }

}
