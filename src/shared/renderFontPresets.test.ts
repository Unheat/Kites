import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RENDER_FONT_PRESET_ID,
  RENDER_FONT_PRESETS,
  normalizeRenderFontPresetId,
  resolveRenderFontFamily,
  type RenderFontPresetId
} from './renderFontPresets';

describe('renderFontPresets', () => {
  it('defines the four required allowlisted presets', () => {
    const presetMap = new Map(RENDER_FONT_PRESETS.map((preset) => [preset.id, preset.fontFamily]));

    expect(DEFAULT_RENDER_FONT_PRESET_ID).toBe('standard');
    expect(presetMap.get('standard')).toBe('sans-serif');
    expect(presetMap.get('comic')).toBe('"Comic Sans MS", "Comic Sans", cursive');
    expect(presetMap.get('serif')).toBe('Georgia, "Times New Roman", serif');
    expect(presetMap.get('monospace')).toBe('"Courier New", Courier, monospace');
  });

  it('normalizes valid and invalid preset identifiers', () => {
    const validIds: RenderFontPresetId[] = ['standard', 'comic', 'serif', 'monospace'];
    for (const id of validIds) {
      expect(normalizeRenderFontPresetId(id)).toBe(id);
    }

    expect(normalizeRenderFontPresetId('unknown-preset')).toBe('standard');
    expect(normalizeRenderFontPresetId('')).toBe('standard');
    expect(normalizeRenderFontPresetId(null)).toBe('standard');
    expect(normalizeRenderFontPresetId(undefined)).toBe('standard');
    expect(normalizeRenderFontPresetId(42)).toBe('standard');
  });

  it('resolves font family stacks with safe fallback', () => {
    expect(resolveRenderFontFamily('comic')).toBe('"Comic Sans MS", "Comic Sans", cursive');
    expect(resolveRenderFontFamily('serif')).toBe('Georgia, "Times New Roman", serif');
    expect(resolveRenderFontFamily('monospace')).toBe('"Courier New", Courier, monospace');
    expect(resolveRenderFontFamily('standard')).toBe('sans-serif');
    expect(resolveRenderFontFamily('invalid-id')).toBe('sans-serif');
    expect(resolveRenderFontFamily(undefined)).toBe('sans-serif');
  });
});
