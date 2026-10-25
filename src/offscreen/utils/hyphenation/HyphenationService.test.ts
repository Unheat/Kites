import { describe, it, expect, beforeEach } from 'vitest';
import {
  HyphenationService,
  parseHyphenationPatterns,
  hyphenationPoints,
  syllablesFromPoints,
  loadHyphenationLanguage,
  syllables,
} from './index';

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
});
