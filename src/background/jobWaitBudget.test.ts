import { describe, expect, it } from 'vitest';
import { buildJobWaitBudget } from './jobWaitBudget';

describe('buildJobWaitBudget', () => {
  it('reads the activity of the job it was built for', () => {
    const stamps = new Map([
      [1, 1000],
      [2, 5000],
    ]);
    const budget = buildJobWaitBudget(1, 60_000, 300_000, (jobId) => stamps.get(jobId) ?? 0);
    expect(budget.readActivityAt()).toBe(1000);
  });

  it('does not see another job reporting progress', () => {
    const stamps = new Map([[1, 1000]]);
    const budget = buildJobWaitBudget(1, 60_000, 300_000, (jobId) => stamps.get(jobId) ?? Date.now());
    stamps.set(2, Date.now());
    expect(budget.readActivityAt()).toBe(1000);
  });

  it('carries the limits through unchanged', () => {
    const budget = buildJobWaitBudget(4, 60_000, 300_000, () => 0);
    expect([budget.stallTimeoutMs, budget.maxTotalMs]).toEqual([60_000, 300_000]);
  });
});
