/**
 * Timers that interrupt a generation only when it actually stops making progress.
 *
 * The previous watchdog multiplied the requested token budget by an assumed token rate, so it
 * measured permission rather than progress: a batch that legitimately took longer than the
 * assumption was interrupted mid-answer on a slow device, and a model that hung after two tokens
 * was allowed to keep the GPU busy until the same fixed deadline.
 *
 * Two independent bounds replace it:
 * - an idle window, re-armed every time a token arrives, which catches a genuinely stuck
 *   generation within seconds;
 * - an absolute ceiling, which guarantees the slot is released even if tokens keep trickling in.
 */
export class ProgressWatchdog {
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private ceilingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleMs: number;
  private readonly ceilingMs: number;
  private readonly onExpire: (reason: 'idle' | 'ceiling') => void;

  /**
   * @param idleMs - Longest silence tolerated between two tokens.
   * @param ceilingMs - Longest total time for one generation, progress or not.
   * @param onExpire - Called with the reason when a bound is hit.
   */
  constructor(idleMs: number, ceilingMs: number, onExpire: (reason: 'idle' | 'ceiling') => void) {
    this.idleMs = idleMs;
    this.ceilingMs = ceilingMs;
    this.onExpire = onExpire;
  }

  /**
   * Starts the absolute ceiling bound; call once per generation.
   *
   * @returns This instance, so construction and start can be chained.
   */
  start(): this {
    this.ceilingTimer = setTimeout(() => this.onExpire('ceiling'), this.ceilingMs);
    this.touch();
    return this;
  }

  /**
   * Records that the generation produced output, re-arming the idle bound.
   */
  touch(): void {
    if (this.ceilingTimer === null) return;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.onExpire('idle'), this.idleMs);
  }

  /**
   * Cancels both bounds; safe to call more than once.
   */
  stop(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    if (this.ceilingTimer !== null) clearTimeout(this.ceilingTimer);
    this.idleTimer = null;
    this.ceilingTimer = null;
  }
}
