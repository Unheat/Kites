import { describe, expect, it } from 'vitest';
import { resolveStudioColorTier } from './studioColorizeTier';

describe('Studio color tier resolution', () => {
  it('keeps an explicit disabled tier instead of falling back to global settings', () => {
    expect(resolveStudioColorTier('none', 'manga-colorization-v2', 'none')).toBe('none');
  });

  it('falls back to the global tier only when the request omitted one', () => {
    expect(resolveStudioColorTier(undefined, 'manga-colorization-v2', 'none')).toBe('manga-colorization-v2');
    expect(resolveStudioColorTier('', 'manga-colorization-v2', 'none')).toBe('manga-colorization-v2');
  });

  it('uses the canonical default when neither the request nor global state names a tier', () => {
    expect(resolveStudioColorTier(undefined, undefined, 'none')).toBe('none');
  });
});