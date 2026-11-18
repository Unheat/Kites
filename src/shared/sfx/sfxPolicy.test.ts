import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SFX_POLICY,
  SFX_POLICIES,
  SFX_POLICY_STRATEGIES,
  isPreservedArtwork,
  isSfxPolicyId,
  resolveSfxPolicyStrategy,
} from './sfxPolicy';
import { DEFAULT_POPUP_STATE } from '../types';

describe('sfxPolicy catalog', () => {
  it('keeps the non-destructive policy as the default', () => {
    expect(DEFAULT_SFX_POLICY).toBe('preserve');
    expect(DEFAULT_POPUP_STATE.sfxPolicy).toBe('preserve');
  });

  it('provides a strategy for every catalogued policy', () => {
    for (const policy of SFX_POLICIES) {
      expect(SFX_POLICY_STRATEGIES[policy.id].id, policy.id).toBe(policy.id);
    }
    expect(Object.keys(SFX_POLICY_STRATEGIES)).toHaveLength(SFX_POLICIES.length);
  });

  it('marks only the preserve policy as artwork-preserving', () => {
    expect(resolveSfxPolicyStrategy('preserve').preservesArtwork).toBe(true);
    expect(resolveSfxPolicyStrategy('translate-plainly').preservesArtwork).toBe(false);
  });

  it('rejects values outside the catalog', () => {
    expect(isSfxPolicyId('preserve')).toBe(true);
    expect(isSfxPolicyId('translate-plainly')).toBe(true);
    expect(isSfxPolicyId('translate')).toBe(false);
    expect(isSfxPolicyId(undefined)).toBe(false);
    expect(isSfxPolicyId(42)).toBe(false);
  });
});

describe('isPreservedArtwork', () => {
  const preserve = resolveSfxPolicyStrategy('preserve');
  const translatePlainly = resolveSfxPolicyStrategy('translate-plainly');

  it('keeps every artwork kind as ink under the preserve policy', () => {
    // Under 'preserve' nothing is translated or erased, whatever the classifier called it.
    expect(isPreservedArtwork('sound-effect', preserve)).toBe(true);
    expect(isPreservedArtwork('display-lettering', preserve)).toBe(true);
    expect(isPreservedArtwork('fragment', preserve)).toBe(true);
  });

  it('lets the policy decide only for real lettering', () => {
    // 'translate-plainly' buys a translation for sound effects and display lettering...
    expect(isPreservedArtwork('sound-effect', translatePlainly)).toBe(false);
    expect(isPreservedArtwork('display-lettering', translatePlainly)).toBe(false);
    // ...but a fragment is a bare glyph pulled out of the drawing, not language. Translating it
    // returns noise, so no policy translates it, and the three consumers of this predicate must
    // agree on that or one of them erases art the others still paint.
    expect(isPreservedArtwork('fragment', translatePlainly)).toBe(true);
  });
});
