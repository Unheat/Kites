/**
 * Canonical catalog of sound-effect handling policies, plus the strategy each one selects.
 *
 * Single source of truth: the popup control renders `SFX_POLICIES`, the storage boundary validates
 * with `isSfxPolicyId`, and the pipeline reads behaviour from `SFX_POLICY_STRATEGIES`. Because that
 * record is keyed by the catalog's identifier union, TypeScript fails the build if a catalogued
 * policy is ever added without a handler.
 */

/** One selectable sound-effect policy, as presented to the user. */
export interface SfxPolicy {
  /** Stable identifier persisted in `chrome.storage.local`. */
  readonly id: 'preserve' | 'translate-plainly';
  /** Short label for the settings control. */
  readonly label: string;
  /** One-line explanation shown next to the control. */
  readonly description: string;
}

/** Behaviour a policy selects. Services read these flags instead of comparing identifiers. */
export interface SfxPolicyStrategy {
  /** Identifier this strategy implements, for logging and diagnostics. */
  readonly id: SfxPolicy['id'];
  /** Whether sound-effect lettering is left as drawn (never inpainted, never overlaid). */
  readonly preservesArtwork: boolean;
}

/** Every sound-effect policy the pipeline can honour. */
export const SFX_POLICIES: readonly SfxPolicy[] = [
  {
    id: 'preserve',
    label: 'Leave as artwork',
    description: 'Sound effects stay as drawn. Erasing hand lettering cannot be undone, so the drawing is kept until it can be replaced in a matching style.',
  },
  {
    id: 'translate-plainly',
    label: 'Translate plainly',
    description: 'Erase the sound effect and render the translation in the normal display font. Understandable, but visibly different from the original lettering.',
  },
];

/** Identifier union derived from the catalog. */
export type SfxPolicyId = (typeof SFX_POLICIES)[number]['id'];

/** Policy applied when storage holds nothing valid; the non-destructive one. */
export const DEFAULT_SFX_POLICY: SfxPolicyId = 'preserve';

/** Strategy per policy. Exhaustively keyed, so a catalogued policy cannot lack behaviour. */
export const SFX_POLICY_STRATEGIES: Readonly<Record<SfxPolicyId, SfxPolicyStrategy>> = {
  'preserve': { id: 'preserve', preservesArtwork: true },
  'translate-plainly': { id: 'translate-plainly', preservesArtwork: false },
};

/**
 * Resolves the strategy for a policy identifier.
 *
 * @param policy - Validated policy identifier.
 * @returns The matching strategy; callers never branch on identifiers themselves.
 */
export function resolveSfxPolicyStrategy(policy: SfxPolicyId): SfxPolicyStrategy {
  return SFX_POLICY_STRATEGIES[policy];
}

/**
 * Narrows an arbitrary stored value to a known policy identifier.
 *
 * @param value - Value read from storage or a message payload.
 * @returns True when the value names a catalogued policy.
 */
export function isSfxPolicyId(value: unknown): value is SfxPolicyId {
  return SFX_POLICIES.some((policy) => policy.id === value);
}
