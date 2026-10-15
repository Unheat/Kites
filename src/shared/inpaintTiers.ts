/**
 * Single Source of Truth for Inpainting Tiers across Kites.
 *
 * Consumed by:
 * - Frontend UI: Popup (EngineSelectionPanel) & Studio Canvas (StudioEngineSelector)
 * - Background: normalizePopupState allowed engine sets
 * - Offscreen: InpaintManager lifecycle & model status checks
 */

export interface InpaintTierDescriptor {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  readonly isModel?: boolean;
  readonly isBuiltin?: boolean;
  readonly sizeEstimate?: string;
}

export const INPAINT_TIER_CATALOG: readonly InpaintTierDescriptor[] = [
  { id: 'none', name: 'None (Bypass)', tag: 'Raw Canvas', isBuiltin: true },
  { id: 'simple', name: 'Simple Fill', tag: 'Fast Color', isBuiltin: true },
  { id: 'stroke-fill', name: 'Precise Fill', tag: 'Text Stroke', isBuiltin: true },
  { id: 'telea', name: 'Telea Diffusion', tag: 'Fast Diffusion', isBuiltin: true },
  { id: 'lama-manga', name: 'LaMa Manga', tag: 'Neural Dynamic', isModel: true, sizeEstimate: '~50 MB' },
  { id: 'aotgan', name: 'AOT-GAN', tag: 'Neural High-Detail', isModel: true, sizeEstimate: '~60 MB' },
] as const;

export type InpaintTierId =
  | 'none'
  | 'simple'
  | 'stroke-fill'
  | 'telea'
  | 'lama-manga'
  | 'aotgan'
  | 'aot'; // legacy alias

/** Set of tier IDs that run locally in pure JS/math without downloading weights. */
export const BUILTIN_INPAINT_IDS = new Set<string>(
  INPAINT_TIER_CATALOG.filter((t) => t.isBuiltin).map((t) => t.id),
);

/** Set of all supported inpainting tier IDs. */
export const SUPPORTED_INPAINT_IDS = new Set<string>([
  ...INPAINT_TIER_CATALOG.map((t) => t.id),
  'aot',
]);
