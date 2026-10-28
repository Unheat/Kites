import { describe, expect, it } from 'vitest';
import { FONT_CATALOG, findCatalogEntryByFamily } from './fontCatalog';
import { CUSTOM_FONT_PREFIX, normalizeRenderFontPresetId, resolveRenderFontFamily, sanitizeLibraryFamily } from './renderFontPresets';

describe('fontCatalog integrity', () => {
  it('contains unique ids and families with verifiable entries', () => {
    const ids = new Set(FONT_CATALOG.map((entry) => entry.id));
    const families = new Set(FONT_CATALOG.map((entry) => entry.family));
    expect(ids.size).toBe(FONT_CATALOG.length);
    expect(families.size).toBe(FONT_CATALOG.length);
    for (const entry of FONT_CATALOG) {
      expect(entry.url.startsWith('https://')).toBe(true);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.sizeBytes).toBeGreaterThan(0);
      expect(entry.license).toBe('OFL');
    }
  });

  it('resolves catalog entries by family', () => {
    expect(findCatalogEntryByFamily('Bangers')?.id).toBe('bangers');
    expect(findCatalogEntryByFamily('Not A Font')).toBeUndefined();
  });
});

describe('library font selection passthrough', () => {
  it('normalizes and resolves font: selections to the registered family', () => {
    const value = `${CUSTOM_FONT_PREFIX}Bangers`;
    expect(normalizeRenderFontPresetId(value)).toBe(value);
    expect(resolveRenderFontFamily(value)).toBe('Bangers');
  });

  it('strips unsafe characters that could corrupt the canvas font shorthand', () => {
    expect(sanitizeLibraryFamily('Bad "Font"; drop{}table')).toBe('Bad Font droptable');
    expect(normalizeRenderFontPresetId(`${CUSTOM_FONT_PREFIX}Bad "Font"`))
      .toBe(`${CUSTOM_FONT_PREFIX}Bad Font`);
  });

  it('falls back to Standard when a font: selection has no usable family', () => {
    expect(normalizeRenderFontPresetId(`${CUSTOM_FONT_PREFIX}  `)).toBe('standard');
    expect(resolveRenderFontFamily(`${CUSTOM_FONT_PREFIX}`)).toBe('sans-serif');
  });

  it('keeps preset resolution untouched', () => {
    expect(resolveRenderFontFamily('comic')).toContain('Kites Comic');
    expect(normalizeRenderFontPresetId('nonexistent-preset')).toBe('standard');
  });
});
