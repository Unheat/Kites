import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RENDER_FONT_PRESET_ID,
  RENDER_FONT_PRESETS,
  fontRegistry,
  normalizeRenderFontPresetId,
  resolveRenderFontFamily,
  type RenderFontPresetId
} from './renderFontPresets';

describe('renderFontPresets', () => {
  it('defines the required registered presets in fontRegistry', () => {
    expect(fontRegistry['standard']).toBeDefined();
    expect(fontRegistry['comic']).toBeDefined();
    expect(fontRegistry['anime-ace']).toBeDefined();
    const presetMap = new Map(RENDER_FONT_PRESETS.map((preset) => [preset.id, preset.fontFamily]));

    expect(DEFAULT_RENDER_FONT_PRESET_ID).toBe('standard');
    expect(presetMap.get('standard')).toBe('sans-serif');
    expect(presetMap.get('comic')).toBe('"Kites Comic", "SVN-Wild Words", "CC Wild Words", "HL-Wild Words", "VNF-Wild Words", "MTO COMIC 1", cursive, sans-serif');
    expect(presetMap.get('anime-ace')).toBe('"MTO Comic 2", "SVN-Anime Ace 2.0", "Anime Ace 2.0 BB", "Anime Ace", cursive, sans-serif');
    expect(presetMap.get('comic-hand')).toBe('"Patrick Hand SC", "Comic Sans MS", cursive, sans-serif');
    expect(presetMap.get('serif')).toBe('Georgia, "Times New Roman", serif');
    expect(presetMap.get('monospace')).toBe('"Courier New", Courier, monospace');
  });

  it('normalizes valid, aliased, and invalid preset identifiers', () => {
    const validIds: RenderFontPresetId[] = ['standard', 'comic', 'anime-ace', 'comic-hand', 'serif', 'monospace'];
    for (const id of validIds) {
      expect(normalizeRenderFontPresetId(id)).toBe(id);
    }

    // Aliases
    expect(normalizeRenderFontPresetId('wild-words')).toBe('comic');
    expect(normalizeRenderFontPresetId('manga')).toBe('comic');
    expect(normalizeRenderFontPresetId('animeace')).toBe('anime-ace');

    // Unknown and invalid
    expect(normalizeRenderFontPresetId('unknown-preset')).toBe('standard');
    expect(normalizeRenderFontPresetId('')).toBe('standard');
    expect(normalizeRenderFontPresetId(null)).toBe('standard');
    expect(normalizeRenderFontPresetId(undefined)).toBe('standard');
    expect(normalizeRenderFontPresetId(42)).toBe('standard');
  });

  it('resolves font family stacks with safe fallback', () => {
    expect(resolveRenderFontFamily('comic')).toBe('"Kites Comic", "SVN-Wild Words", "CC Wild Words", "HL-Wild Words", "VNF-Wild Words", "MTO COMIC 1", cursive, sans-serif');
    expect(resolveRenderFontFamily('wild-words')).toBe('"Kites Comic", "SVN-Wild Words", "CC Wild Words", "HL-Wild Words", "VNF-Wild Words", "MTO COMIC 1", cursive, sans-serif');
    expect(resolveRenderFontFamily('anime-ace')).toBe('"MTO Comic 2", "SVN-Anime Ace 2.0", "Anime Ace 2.0 BB", "Anime Ace", cursive, sans-serif');
    expect(resolveRenderFontFamily('comic-hand')).toBe('"Patrick Hand SC", "Comic Sans MS", cursive, sans-serif');
    expect(resolveRenderFontFamily('serif')).toBe('Georgia, "Times New Roman", serif');
    expect(resolveRenderFontFamily('monospace')).toBe('"Courier New", Courier, monospace');
    expect(resolveRenderFontFamily('standard')).toBe('sans-serif');
    expect(resolveRenderFontFamily('invalid-id')).toBe('sans-serif');
    expect(resolveRenderFontFamily(undefined)).toBe('sans-serif');
  });
});
