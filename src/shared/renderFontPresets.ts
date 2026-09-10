/** Allowlisted identifier for a global translation render font preset. */
export type RenderFontPresetId = 'standard' | 'comic' | 'serif' | 'monospace';

/** User-facing render font preset metadata. */
export interface RenderFontPreset {
  id: RenderFontPresetId;
  label: string;
  fontFamily: string;
}

/** Default preset used for new, missing, and invalid popup state. */
export const DEFAULT_RENDER_FONT_PRESET_ID: RenderFontPresetId = 'standard';

/** Ordered allowlist shared by settings, state validation, and rendering. */
export const RENDER_FONT_PRESETS: readonly RenderFontPreset[] = [
  { id: 'standard', label: 'Standard', fontFamily: 'sans-serif' },
  {
    id: 'comic',
    label: 'Comic',
    fontFamily: '"Kites Comic", "SVN-Wild Words", "CC Wild Words", "HL-Wild Words", "VNF-Wild Words", "MTO COMIC 1", "SVN-Anime Ace 2.0", "Patrick Hand SC", "Comic Sans MS", cursive, sans-serif'
  },
  { id: 'serif', label: 'Serif', fontFamily: 'Georgia, "Times New Roman", serif' },
  { id: 'monospace', label: 'Monospace', fontFamily: '"Courier New", Courier, monospace' },
] as const;

const RENDER_FONT_PRESET_BY_ID = new Map<RenderFontPresetId, RenderFontPreset>(
  RENDER_FONT_PRESETS.map((preset) => [preset.id, preset])
);

/**
 * Normalizes untrusted persisted input to an allowlisted render font preset ID.
 *
 * @param value - Candidate preset identifier from storage or another runtime boundary.
 * @returns Matching allowlisted ID, or the Standard preset ID when invalid.
 */
export function normalizeRenderFontPresetId(value: unknown): RenderFontPresetId {
  return typeof value === 'string' && RENDER_FONT_PRESET_BY_ID.has(value as RenderFontPresetId)
    ? value as RenderFontPresetId
    : DEFAULT_RENDER_FONT_PRESET_ID;
}

/**
 * Resolves an untrusted preset identifier to its safe CSS font-family stack.
 *
 * @param value - Candidate preset identifier.
 * @returns Allowlisted font-family stack, defaulting to sans-serif.
 */
export function resolveRenderFontFamily(value: unknown): string {
  const presetId = normalizeRenderFontPresetId(value);
  return RENDER_FONT_PRESET_BY_ID.get(presetId)?.fontFamily ?? 'sans-serif';
}
