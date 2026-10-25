/**
 * Single Source of Truth for Manga Colorization Tiers across Kites.
 *
 * Consumed by:
 * - Frontend UI: Popup (EngineSelectionPanel) & GpuAccelerationPanel
 * - Background: normalizePopupState allowed color engine sets
 * - Offscreen: ColorManager lifecycle & model status checks
 */

export interface ColorTierDescriptor {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  readonly isModel?: boolean;
  readonly isBuiltin?: boolean;
  readonly sizeEstimate?: string;
  readonly vramEstimate?: string;
}

export const COLOR_TIER_CATALOG: readonly ColorTierDescriptor[] = [
  { id: 'none', name: 'Disabled', tag: 'Original B&W', isBuiltin: true, vramEstimate: '0 MB' },
  { id: 'manga-colorization-v2', name: 'Manga Colorizer (AI)', tag: 'SEResNeXt U-Net', isModel: true, sizeEstimate: '~61 MB', vramEstimate: '~150 MB' },
] as const;

export type ColorTierId = 'none' | 'manga-colorization-v2';

/** Set of tier IDs that run locally in pure JS/math without downloading weights. */
export const BUILTIN_COLOR_IDS = new Set<string>(
  COLOR_TIER_CATALOG.filter((t) => t.isBuiltin).map((t) => t.id),
);

/** Set of all supported color tier IDs. */
export const SUPPORTED_COLOR_IDS = new Set<string>(
  COLOR_TIER_CATALOG.map((t) => t.id),
);
