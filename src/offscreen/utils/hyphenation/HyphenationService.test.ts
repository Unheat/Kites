import { describe, it, expect, beforeEach } from 'vitest';
import {
  HyphenationService,
  parseHyphenationPatterns,
  hyphenationPoints,
  syllablesFromPoints,
  loadHyphenationLanguage,
  syllables,
  hyphenation_lang_from_tag,
  hasHypherSupport,
} from './index';
import { HYPHER_TRIE_LOADERS } from './hypherData';
import { getHypherHyphenationCharacter } from './hypherCompat';

describe('LiangEngine pattern parsing', () => {
  it('parses basic patterns with weights', () => {
    const raw = `
.a4
as3t3
.ab2r
`;
    const parsed = parseHyphenationPatterns(raw);
    expect(parsed.patterns.size).toBe(3);
    expect(parsed.longest).toBeGreaterThan(0);
    const ast = parsed.patterns.get('ast');
    expect(ast).toBeDefined();
    expect(ast?.values).toEqual([3, 3]);

    const pts = hyphenationPoints('testing', parsed, 2);
    expect(Array.isArray(pts)).toBe(true);
    const syls = syllablesFromPoints('testing', pts);
    expect(syls.join('')).toBe('testing');
  });

  it('ignores comments and blank lines', () => {
    const raw = `
# comment
    
.a1b
`;
    const parsed = parseHyphenationPatterns(raw);
    expect(parsed.patterns.size).toBe(1);
    expect(parsed.patterns.has('.ab')).toBe(true);
  });
});

describe('HyphenationService multi-language integration', () => {
  beforeEach(() => {
    HyphenationService.resetInstance();
  });

  it('never hyphenates words shorter than 6 letters', async () => {
    await loadHyphenationLanguage('en');
    const service = HyphenationService.getInstance();
    expect(service.findHyphenationPoints('tea', 'en')).toEqual([]);
    expect(service.findHyphenationPoints('apple', 'en')).toEqual([]);
    expect(service.syllables('apple', 'en')).toEqual(['apple']);
  });

  it('correctly splits English words into syllables', async () => {
    await loadHyphenationLanguage('en');
    const service = HyphenationService.getInstance();
    const points = service.findHyphenationPoints('extraordinary', 'en');
    expect(points.length).toBeGreaterThan(0);

    const syls = service.syllables('extraordinary', 'en');
    expect(syls.join('')).toBe('extraordinary');
    expect(syls.length).toBeGreaterThan(1);
  });

  it('correctly splits German compound words', async () => {
    await loadHyphenationLanguage('de');
    const service = HyphenationService.getInstance();
    const syls = service.syllables('Geschwindigkeit', 'de');
    expect(syls.join('')).toBe('Geschwindigkeit');
    expect(syls.length).toBeGreaterThan(1);
  });

  it('correctly splits Spanish long words', async () => {
    await loadHyphenationLanguage('es');
    const service = HyphenationService.getInstance();
    const syls = service.syllables('desafortunadamente', 'es');
    expect(syls.join('')).toBe('desafortunadamente');
    expect(syls.length).toBeGreaterThan(1);
  });

  it('correctly splits French long words', async () => {
    await loadHyphenationLanguage('fr');
    const service = HyphenationService.getInstance();
    const syls = service.syllables('inconstitutionnel', 'fr');
    expect(syls.join('')).toBe('inconstitutionnel');
    expect(syls.length).toBeGreaterThan(1);
  });

  it('correctly splits Russian long words', async () => {
    await loadHyphenationLanguage('ru');
    const service = HyphenationService.getInstance();
    const syls = service.syllables('достопримечательность', 'ru');
    expect(syls.join('')).toBe('достопримечательность');
    expect(syls.length).toBeGreaterThan(1);
  });

  it('handles unknown or unloaded languages gracefully with fallback', () => {
    const service = HyphenationService.getInstance();
    const syls = service.syllables('supercalifragilistic', 'unknown_lang');
    expect(syls).toEqual(['supercalifragilistic']);
  });

  it('functional helper syllables() matches service instance', async () => {
    await loadHyphenationLanguage('en');
    const s1 = syllables('international', 'en');
    const s2 = HyphenationService.getInstance().syllables('international', 'en');
    expect(s1).toEqual(s2);
    expect(s1.join('')).toBe('international');
  });

  it('keeps legacy Liang output unchanged when the independent hypher trie becomes ready', async () => {
    const service = HyphenationService.getInstance();
    // Deliberately different from donor hypher ex-ten-sive. This verifies actual
    // source isolation instead of comparing two dictionaries that happen to agree.
    service.registerPatterns('en_US', 'ext1ensive');
    expect(service.isContourReady('en')).toBe(false);
    expect(service.findHyphenationPoints('extensive', 'en', 2)).toEqual([3]);

    await service.loadLanguage('en');
    expect(service.isContourReady('en')).toBe(true);
    expect(service.findContourHyphenationPoints('extensive', 'en', 2, 3)).toEqual([2, 5]);
    expect(service.findHyphenationPoints('extensive', 'en', 2)).toEqual([3]);
    expect(service.findHyphenationPoints('extensive', 'en', 2)).toEqual([3]);
  });

  it('loads every explicit trie chunk and resolves Norwegian aliases to the same data', async () => {
    const service = HyphenationService.getInstance();
    const entries = Object.entries(HYPHER_TRIE_LOADERS);
    expect(entries).toHaveLength(48);
    for (const [language, loader] of entries) {
      const { default: base64 } = await loader();
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      service.registerHypherTrie(language, bytes);
      expect(service.isContourReady(language), language).toBe(true);
    }
    for (const alias of ['no', 'nb', 'nn']) {
      expect(service.resolveHypherKey(alias)).toBe('no');
      expect(service.isContourReady(alias)).toBe(true);
      expect(service.contourSyllables('hyphenation', alias, 2, 2))
        .toEqual(service.contourSyllables('hyphenation', 'no', 2, 2));
    }
  });

  // REGRESSION TESTS FOR FIXES

  it('REGRESSION: query before load does not permanently cache empty array', async () => {
    const service = HyphenationService.getInstance();
    
    // 1. Query before load - should return []
    const pointsPreLoad = service.findHyphenationPoints('extraordinary', 'en');
    expect(pointsPreLoad).toEqual([]);
    
    // 2. Load language now
    await service.loadLanguage('en');
    
    // 3. Query same word again - MUST return hyphenation points, NOT cached empty array!
    // Prior bug: wordPointsCache retained the pre-load [] indefinitely.
    const pointsPostLoad = service.findHyphenationPoints('extraordinary', 'en');
    expect(pointsPostLoad.length).toBeGreaterThan(0);
    expect(pointsPostLoad).not.toEqual(pointsPreLoad);
  });

  it('REGRESSION: load error clears pending state allowing retry', async () => {
    const service = HyphenationService.getInstance();
    
    // Setup custom loader that fails first time then succeeds
    let attempts = 0;
    HyphenationService.setCustomLoader(async (_dictName: string) => {
      attempts++;
      if (attempts === 1) {
        throw new Error('Network error simulated');
      }
      return '.ex1tra2or3di4na5ry.';
    });

    try {
      // Use a legacy-only language (id has no hypher trie) so a dictionary failure
      // is a genuine total failure rather than being masked by a successful trie load.
      await expect(service.loadLanguage('id')).rejects.toThrow('Network error simulated');
      expect(service.isLoaded('id')).toBe(false);

      // Second attempt should succeed because pending state was cleared
      await expect(service.loadLanguage('id')).resolves.not.toThrow();
      expect(service.isLoaded('id')).toBe(true);
    } finally {
      // Restore the filesystem loader installed by test.setup.ts (do not leave undefined).
      HyphenationService.setCustomLoader(async (dictName: string) => {
        const fs = await import('fs');
        const path = await import('path');
        const candidatePaths = [
          path.resolve(process.cwd(), 'public/assets/hyphenation', `${dictName}.txt`),
          path.resolve(process.cwd(), 'dist/assets/hyphenation', `${dictName}.txt`),
        ];
        for (const p of candidatePaths) {
          if (fs.existsSync(p)) {
            return fs.readFileSync(p, 'utf-8');
          }
        }
        return null;
      });
    }
  });

  it('REGRESSION: isLoaded reflects actual state accurately', async () => {
    const service = HyphenationService.getInstance();
    
    // Unloaded dictionary-backed language
    expect(service.isLoaded('en')).toBe(false);
    expect(service.isLoaded('de')).toBe(false);
    
    // Rule-based language needs no dictionary -> always loaded
    expect(service.isLoaded('hi')).toBe(true); // Indic
    expect(service.isLoaded('tr')).toBe(true); // Vowel-syllable
    expect(service.isLoaded('ja')).toBe(true); // CJK
    
    // Load English
    await service.loadLanguage('en');
    expect(service.isLoaded('en')).toBe(true);
    expect(service.isLoaded('de')).toBe(false);
  });

  it('REGRESSION: malformed dictionary fails instead of silently disabling', async () => {
    const service = HyphenationService.getInstance();
    const restoreLoader = async (dictName: string) => {
      const fs = await import('fs');
      const path = await import('path');
      const candidate = path.resolve(process.cwd(), 'public/assets/hyphenation', `${dictName}.txt`);
      return fs.existsSync(candidate) ? fs.readFileSync(candidate, 'utf-8') : null;
    };

    try {
      HyphenationService.setCustomLoader(async () => 'not a pattern file');
      await expect(service.loadLanguage('id')).rejects.toThrow(/Malformed hyphenation dictionary/);
      expect(service.isLoaded('id')).toBe(false);

      // A valid retry must still work after the malformed failure.
      HyphenationService.setCustomLoader(async () => '.ex1tra2or3di4na5ry.');
      await expect(service.loadLanguage('id')).resolves.not.toThrow();
      expect(service.isLoaded('id')).toBe(true);
    } finally {
      HyphenationService.setCustomLoader(restoreLoader);
    }
  });

  it('rejects malformed hypher trie and pattern registration', () => {
    const service = HyphenationService.getInstance();
    expect(() => service.registerHypherTrie('en', new Uint8Array(2))).toThrow(/Malformed hypher trie/);
    expect(() => service.registerPatterns('xx', 'no weights here')).toThrow(/Malformed hyphenation dictionary/);
  });
});

describe('hypherCompat language bounds and metadata', () => {
  it('correctly maps BCP-47 tags to hypher language keys and bounds', () => {
    // English
    const en = hyphenation_lang_from_tag('en-US');
    expect(en).not.toBeNull();
    expect(en?.key).toBe('en');
    expect(en?.bounds.left).toBe(2);
    expect(en?.bounds.right).toBe(3);
    expect(en?.bounds.hyphenationCharacter).toBe('\u00ad');

    // German
    const de = hyphenation_lang_from_tag('de-DE');
    expect(de?.key).toBe('de');
    expect(de?.bounds.left).toBe(2);
    expect(de?.bounds.right).toBe(2);

    // Greek (1, 1 bounds)
    const el = hyphenation_lang_from_tag('el');
    expect(el?.bounds.left).toBe(1);
    expect(el?.bounds.right).toBe(1);

    // Indic language (no hyphenation character)
    const hi = hyphenation_lang_from_tag('hi-IN');
    expect(hi?.bounds.hyphenationCharacter).toBeNull();
    expect(getHypherHyphenationCharacter('hi-IN')).toBeNull();

    // Unsupported language
    expect(hyphenation_lang_from_tag('ja-JP')).toBeNull();
    expect(hyphenation_lang_from_tag('invalid')).toBeNull();
  });

  it('covers all Koharu-supported hypher languages', () => {
    // Check key languages from donor segment.rs tests
    const donorCases = [
      'af', 'sq', 'as', 'be', 'bn', 'bg', 'ca', 'hr', 'cs', 'da',
      'nl', 'en-US', 'et', 'fi', 'fr-FR', 'gl', 'ka', 'de-DE', 'el',
      'gu', 'hi', 'hu', 'is', 'it-IT', 'kn', 'ku', 'la', 'lt', 'ml',
      'mr', 'mn', 'no', 'nb', 'nn', 'or', 'pa', 'pl', 'pt-BR', 'ru',
      'sa', 'sr', 'sk', 'sl', 'es-ES', 'sv', 'ta', 'te', 'tr', 'tk', 'uk'
    ];

    for (const tag of donorCases) {
      expect(hasHypherSupport(tag), `Expected support for ${tag}`).toBe(true);
    }
  });
});
