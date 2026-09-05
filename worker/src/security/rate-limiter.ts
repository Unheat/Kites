/**
 * Edge IP Rate Limiter & Bad-Actor Jail
 * 
 * Runs entirely in Cloudflare Worker memory (Map).
 * Costs $0.00 and consumes 0 SQLite writes.
 * 
 * Rules:
 * - Burst Limit: Max 5 requests / second per IP
 * - Window Limit: Max 100 requests / minute per IP
 * - Bad-Actor Jail: 5 auth failures in 60s -> 10-minute ban
 */

export interface IpRateState {
  secondWindow: number;
  secondCount: number;
  minuteWindow: number;
  minuteCount: number;
  authFailures: number;
  authFailureWindow: number;
  jailedUntil: number;
}

export interface RateLimitResult {
  allowed: boolean;
  statusCode?: number;
  reason?: string;
  retryAfterSeconds?: number;
}

const BURST_LIMIT_PER_SEC = 5;
const WINDOW_LIMIT_PER_MIN = 100;
const MAX_AUTH_FAILURES = 5;
const JAIL_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export class IpRateLimiter {
  private ipStates = new Map<string, IpRateState>();

  private getOrInitState(ip: string, now: number): IpRateState {
    let state = this.ipStates.get(ip);
    if (!state) {
      state = {
        secondWindow: Math.floor(now / 1000),
        secondCount: 0,
        minuteWindow: Math.floor(now / 60000),
        minuteCount: 0,
        authFailures: 0,
        authFailureWindow: Math.floor(now / 60000),
        jailedUntil: 0,
      };
      this.ipStates.set(ip, state);
    }
    return state;
  }

  /**
   * Check whether an incoming request from this IP is allowed.
   */
  checkRateLimit(ip: string, now = Date.now()): RateLimitResult {
    const state = this.getOrInitState(ip, now);

    // 1. Check if IP is currently in Jail
    if (state.jailedUntil > now) {
      const remainingSec = Math.ceil((state.jailedUntil - now) / 1000);
      return {
        allowed: false,
        statusCode: 403,
        reason: 'IP temporarily suspended due to repeated authentication failures.',
        retryAfterSeconds: remainingSec,
      };
    }

    // 2. Rotate second window (burst limit)
    const currentSec = Math.floor(now / 1000);
    if (state.secondWindow !== currentSec) {
      state.secondWindow = currentSec;
      state.secondCount = 0;
    }

    // 3. Rotate minute window (throughput limit)
    const currentMin = Math.floor(now / 60000);
    if (state.minuteWindow !== currentMin) {
      state.minuteWindow = currentMin;
      state.minuteCount = 0;
    }

    // 4. Check Burst Limit (5 req / sec)
    if (state.secondCount >= BURST_LIMIT_PER_SEC) {
      return {
        allowed: false,
        statusCode: 429,
        reason: `Burst rate limit exceeded: max ${BURST_LIMIT_PER_SEC} requests/second.`,
        retryAfterSeconds: 1,
      };
    }

    // 5. Check Window Limit (100 req / min)
    if (state.minuteCount >= WINDOW_LIMIT_PER_MIN) {
      return {
        allowed: false,
        statusCode: 429,
        reason: `Rate limit exceeded: max ${WINDOW_LIMIT_PER_MIN} requests/minute.`,
        retryAfterSeconds: 30,
      };
    }

    // Increment request counters
    state.secondCount += 1;
    state.minuteCount += 1;

    return { allowed: true };
  }

  /**
   * Record an authentication failure for this IP.
   * Multiple failures place the IP in Jail to stop token-guessing attacks.
   */
  recordAuthFailure(ip: string, now = Date.now()): void {
    const state = this.getOrInitState(ip, now);

    const currentMin = Math.floor(now / 60000);
    if (state.authFailureWindow !== currentMin) {
      state.authFailureWindow = currentMin;
      state.authFailures = 0;
    }

    state.authFailures += 1;

    if (state.authFailures >= MAX_AUTH_FAILURES) {
      state.jailedUntil = now + JAIL_DURATION_MS;
      state.authFailures = 0; // reset counter once jailed
    }
  }

  /**
   * Periodic memory cleanup of inactive IPs (prevents unbounded Map growth).
   */
  cleanup(now = Date.now()): void {
    const tenMinAgo = now - 10 * 60 * 1000;
    for (const [ip, state] of this.ipStates.entries()) {
      if (state.jailedUntil < now && state.minuteWindow * 60000 < tenMinAgo) {
        this.ipStates.delete(ip);
      }
    }
  }
}

export const ipRateLimiter = new IpRateLimiter();
