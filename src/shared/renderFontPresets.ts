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
    fontFamily: '"CC Wild Words", "WildWords", "CCWildWords", "Kites Comic", sans-serif',
    description: 'Authentic manga dialogue font'
  },
  'anime-ace': {
    id: 'anime-ace',
    label: 'Anime Ace',
    fontFamily: '"Anime Ace", "MTO Comic 2", cursive, sans-serif',
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

/** Prefix marking a library font selection (downloaded catalog face or user import). */
export const CUSTOM_FONT_PREFIX = 'font:';
/** Characters that would break the canvas font shorthand; library family names strip them. */
const UNSAFE_FAMILY_CHARS = /["';{}]/g;

/**
 * Sanitizes a library family name for safe interpolation into canvas font shorthands.
 *
 * @param family - Raw family name from the library.
 * @returns Sanitized single-line family, or empty string when nothing usable remains.
 */
export function sanitizeLibraryFamily(family: string): string {
  return family.replace(UNSAFE_FAMILY_CHARS, '').trim();
}

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
  if (typeof value === 'string' && value.startsWith(CUSTOM_FONT_PREFIX)) {
    const family = sanitizeLibraryFamily(value.slice(CUSTOM_FONT_PREFIX.length));
    return family ? `${CUSTOM_FONT_PREFIX}${family}` : DEFAULT_RENDER_FONT_PRESET_ID;
  }
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
  if (typeof value === 'string' && value.startsWith(CUSTOM_FONT_PREFIX)) {
    const family = sanitizeLibraryFamily(value.slice(CUSTOM_FONT_PREFIX.length));
    // Library faces register under this exact family in both the dashboard and the
    // offscreen bake document; an unregistered name degrades to canvas fallback.
    return family || 'sans-serif';
  }
  const presetId = normalizeRenderFontPresetId(value);
  return fontRegistry[presetId]?.fontFamily ?? 'sans-serif';
}
