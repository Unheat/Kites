import { describe, expect, it } from 'vitest';
import { COLOR_TIER_CATALOG } from '../../shared/colorTiers';

describe('PageInfoSettings Color Label Resolution', () => {
  function resolveColorLabel(id?: string): string {
    if (!id || id === 'none') {
      return 'Disabled (Original B&W)';
    }
    const found = COLOR_TIER_CATALOG.find((t) => t.id === id);
    return found ? found.name : id;
  }

  it('resolves none or undefined to Disabled (Original B&W)', () => {
    expect(resolveColorLabel(undefined)).toBe('Disabled (Original B&W)');
    expect(resolveColorLabel('none')).toBe('Disabled (Original B&W)');
    expect(resolveColorLabel('')).toBe('Disabled (Original B&W)');
  });

  it('resolves manga-colorization-v2 to Manga Colorizer (AI)', () => {
    expect(resolveColorLabel('manga-colorization-v2')).toBe('Manga Colorizer (AI)');
  });

  it('falls back to raw id when unknown tier is passed', () => {
    expect(resolveColorLabel('custom-color-v3')).toBe('custom-color-v3');
  });
});
