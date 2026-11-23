/**
 * Resolves the color tier a Studio colorize request must run.
 *
 * An explicit request wins even when it is `'none'`: Studio's Disabled tier means
 * "do not colorize", not "use the global tier". Global and canonical defaults only
 * fill a request that omitted the field.
 *
 * @param requestedTier - Tier sent by the caller, if any.
 * @param activeColorId - Normalized global color tier.
 * @param defaultColorId - Canonical fallback when neither source names a tier.
 * @returns The tier id the color manager must run.
 */
export function resolveStudioColorTier(
  requestedTier: string | undefined,
  activeColorId: string | undefined,
  defaultColorId: string,
): string {
  return requestedTier || activeColorId || defaultColorId;
}