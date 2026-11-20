/** Stall and ceiling limits applied to one background → offscreen job wait. */
export interface JobWaitBudget {
  /** Silence allowed before the job is considered dead. */
  stallTimeoutMs: number;
  /** Hard ceiling on the whole wait, however busy the job looks. */
  maxTotalMs: number;
  /** Timestamp of the job's most recent progress signal. */
  readActivityAt: () => number;
}

/**
 * Builds the wait budget for one job, bound to that job's own activity.
 *
 * The bound matters both ways: a job must not be aged by silence that happened before it started, and
 * it must not be kept alive by another job's chatter. Passing a shared timestamp instead of this
 * reader reintroduces both defects, so the call site must come through here.
 *
 * @param jobId - Job being awaited.
 * @param stallTimeoutMs - Silence allowed before the job is considered dead.
 * @param maxTotalMs - Hard ceiling on the whole wait.
 * @returns Budget whose activity reader is scoped to the given job.
 */
export function buildJobWaitBudget(
  jobId: number,
  stallTimeoutMs: number,
  maxTotalMs: number,
  readActivityAt: (jobId: number) => number
): JobWaitBudget {
  return { stallTimeoutMs, maxTotalMs, readActivityAt: () => readActivityAt(jobId) };
}
