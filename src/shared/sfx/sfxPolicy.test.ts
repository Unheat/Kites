import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SFX_POLICY,
  SFX_POLICIES,
  SFX_POLICY_STRATEGIES,
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
