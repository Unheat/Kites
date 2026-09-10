/** Allowlisted identifier for a global translation render font preset. */
export type RenderFontPresetId = string;

/** User-facing render font preset metadata. */
export interface RenderFontPreset {
  id: string;
  label: string;
  fontFamily: string;
  description?: string;
}

/** Default preset used for new, missing, and invalid popup state. */
export const DEFAULT_RENDER_FONT_PRESET_ID: string = 'standard';

/**
 * Extensible central font registry.
 * Any font added here automatically appears in settings dropdowns,
 * validates in state normalization, and renders in offscreen canvas & studio.
 */
export const fontRegistry: Record<string, RenderFontPreset> = {
  'standard': {
    id: 'standard',
    label: 'Standard',
    fontFamily: 'sans-serif',
    description: 'Clean system sans-serif font.'
  },
  'comic': {
    id: 'comic',
    label: 'Wild Words',
    fontFamily: '"Kites Comic", "SVN-Wild Words", "CC Wild Words", "HL-Wild Words", "VNF-Wild Words", "MTO COMIC 1", cursive, sans-serif',
    description: 'Authentic manga dialogue font'
  },
  'anime-ace': {
    id: 'anime-ace',
    label: 'Anime Ace',
    fontFamily: '"MTO Comic 2", "SVN-Anime Ace 2.0", "Anime Ace 2.0 BB", "Anime Ace", cursive, sans-serif',
    description: 'Popular comic dialogue font'
  },
  'comic-hand': {
    id: 'comic-hand',
    label: 'Comic Hand',
    fontFamily: '"Patrick Hand SC", "Comic Sans MS", cursive, sans-serif',
    description: 'Natural small-caps comic lettering'
  },
  'serif': {
    id: 'serif',
    label: 'Serif',
    fontFamily: 'Georgia, "Times New Roman", serif',
    description: 'Traditional literary serif font'
  },
  'monospace': {
    id: 'monospace',
    label: 'Monospace',
    fontFamily: '"Courier New", Courier, monospace',
    description: 'Fixed-width typewriter font'
  }
};

/**
 * Ordered list of available presets for UI dropdowns.
 * Dynamically populated from fontRegistry.
 */
export const RENDER_FONT_PRESETS: readonly RenderFontPreset[] = Object.values(fontRegistry);

/** Known aliases mapped to their canonical registered ID. */
const FONT_PRESET_ALIASES: Record<string, string> = {
  'wild-words': 'comic',
  'manga': 'comic',
  'wildwords': 'comic',
  'animeace': 'anime-ace'
};

/**
 * Normalizes untrusted persisted input to a registered render font preset ID.
 * Supports aliases (e.g. 'wild-words' -> 'comic') and falls back to 'standard'.
 *
 * @param value - Candidate preset identifier from storage or another runtime boundary.
 * @returns Matching registered ID, or the Standard preset ID when invalid.
 */
export function normalizeRenderFontPresetId(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_RENDER_FONT_PRESET_ID;
  const canonical = FONT_PRESET_ALIASES[value] ?? value;
  return fontRegistry[canonical] ? canonical : DEFAULT_RENDER_FONT_PRESET_ID;
}

/**
 * Resolves an untrusted preset identifier to its safe CSS font-family stack.
 *
 * @param value - Candidate preset identifier.
 * @returns Registered font-family stack, defaulting to sans-serif.
 */
export function resolveRenderFontFamily(value: unknown): string {
  const presetId = normalizeRenderFontPresetId(value);
  return fontRegistry[presetId]?.fontFamily ?? 'sans-serif';
}
