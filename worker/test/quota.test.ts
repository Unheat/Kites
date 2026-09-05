import { describe, it, expect } from 'vitest';

describe('Rolling 24-hour Quota Logic', () => {
  const WINDOW_MS = 24 * 60 * 60 * 1000;
  const MAX_LIMIT = 100;

  function simulateQuotaCheck(
    record: { windowStart: number; usedCount: number } | null,
    now: number
  ) {
    if (!record || now >= record.windowStart + WINDOW_MS) {
      return {
        record: { windowStart: now, usedCount: 1 },
        allowed: true,
        remaining: MAX_LIMIT - 1,
      };
    }
    if (record.usedCount >= MAX_LIMIT) {
      return {
        record,
        allowed: false,
        remaining: 0,
      };
    }
    const updated = { ...record, usedCount: record.usedCount + 1 };
    return {
      record: updated,
      allowed: true,
      remaining: MAX_LIMIT - updated.usedCount,
    };
  }

  it('starts fresh 24h window on first request', () => {
    const t0 = 1700000000000;
    const res = simulateQuotaCheck(null, t0);

    expect(res.allowed).toBe(true);
    expect(res.record.windowStart).toBe(t0);
    expect(res.record.usedCount).toBe(1);
    expect(res.remaining).toBe(99);
  });

  it('increments count within 24-hour window', () => {
    const t0 = 1700000000000;
    let state = { windowStart: t0, usedCount: 50 };

    const res = simulateQuotaCheck(state, t0 + 3600_000); // 1 hour later
    expect(res.allowed).toBe(true);
    expect(res.record.windowStart).toBe(t0);
    expect(res.record.usedCount).toBe(51);
    expect(res.remaining).toBe(49);
  });

  it('blocks when reaching 100 requests within window', () => {
    const t0 = 1700000000000;
    const state = { windowStart: t0, usedCount: 100 };

    const res = simulateQuotaCheck(state, t0 + 10_000);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
  });

  it('resets window when 24 hours have elapsed', () => {
    const t0 = 1700000000000;
    const state = { windowStart: t0, usedCount: 100 };

    const tAfter = t0 + WINDOW_MS + 1000; // 24 hours + 1s later
    const res = simulateQuotaCheck(state, tAfter);

    expect(res.allowed).toBe(true);
    expect(res.record.windowStart).toBe(tAfter);
    expect(res.record.usedCount).toBe(1);
    expect(res.remaining).toBe(99);
  });
});
