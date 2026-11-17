/**
 * poolContract.test.ts
 *
 * Guards the split between the answer-estimate budget and the hard output ceiling. Collapsing those
 * two constants is the regression this file exists to catch: with one constant, raising the ceiling
 * to give reasoning room silently doubles the answer estimate, and a reasoning route given only the
 * answer estimate spends it all thinking and returns a truncated object.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_POOL_ANSWER_TOKENS,
  MAX_POOL_OUTPUT_TOKENS,
  REASONING_OUTPUT_HEADROOM,
  outputBudgetForRoute,
} from './poolContract';

describe('outputBudgetForRoute', () => {
  it('never asks for more than the answer budget on a route that does not think', () => {
    expect(outputBudgetForRoute(undefined, undefined)).toBe(MAX_POOL_ANSWER_TOKENS);
    expect(outputBudgetForRoute(500, false)).toBe(500);
    // A caller asking for more than the answer estimate is clamped, not trusted.
    expect(outputBudgetForRoute(9999, false)).toBe(MAX_POOL_ANSWER_TOKENS);
  });

  it('adds reasoning headroom on a thinking route so thinking cannot eat the answer', () => {
    expect(outputBudgetForRoute(MAX_POOL_ANSWER_TOKENS, true)).toBe(MAX_POOL_OUTPUT_TOKENS);
    expect(outputBudgetForRoute(64, true)).toBe(64 + REASONING_OUTPUT_HEADROOM);
    expect(outputBudgetForRoute(undefined, true)).toBe(MAX_POOL_OUTPUT_TOKENS);
  });

  it('keeps the ceiling exactly one answer budget plus one headroom, so they cannot drift', () => {
    expect(MAX_POOL_OUTPUT_TOKENS).toBe(MAX_POOL_ANSWER_TOKENS + REASONING_OUTPUT_HEADROOM);
    expect(MAX_POOL_OUTPUT_TOKENS).toBeGreaterThan(MAX_POOL_ANSWER_TOKENS);
  });
});
