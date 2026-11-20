import { describe, expect, it } from 'vitest';
import { respectsFinishedJob } from './finishedJobRecovery';

describe('respectsFinishedJob', () => {
  it('drops a stall report for a job the offscreen document already completed', () => {
    expect(
      respectsFinishedJob('PROCESS_JOB made no progress for 67s (stall limit 60s)', 'completed')
    ).toBe(true);
  });

  it('keeps a stall report when the job did not finish', () => {
    for (const status of ['processing', 'queued', 'error', undefined]) {
      expect(respectsFinishedJob('PROCESS_JOB made no progress for 67s (stall limit 60s)', status)).toBe(false);
    }
  });

  it('ignores unrelated failures even when the job looks completed', () => {
    // A stale completed row must not swallow a genuine pipeline error for the current attempt.
    expect(respectsFinishedJob('PROCESS_JOB failed: device lost', 'completed')).toBe(false);
  });
});
