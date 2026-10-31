/**
 * Edge IP Rate Limiter & Bad-Actor Jail
 *
 * Runs entirely in Cloudflare Worker isolate memory (Map).
 * Costs $0.00 and consumes 0 SQLite writes.
 *
 * Rules:
 * - Burst Limit: Max 5 requests / 3 seconds per IP
 * - Window Limit: Max 100 requests / minute per IP
 * - Bad-Actor Jail: 5 auth failures in 60s -> 10-minute ban
 * - Memory Cap & Eviction: Prevents memory exhaustion via bounded Map capacity and periodic cleanup.
 */

export interface IpRateState {
  secondWindow: number;
  secondCount: number;
  minuteWindow: number;
  minuteCount: number;
  authFailures: number;
  authFailureWindow: number;
  jailedUntil: number;
  lastSeen: number;
}

export interface RateLimitResult {
  allowed: boolean;
  statusCode?: number;
  reason?: string;
  retryAfterSeconds?: number;
}

export const BURST_LIMIT = 5;
export const BURST_WINDOW_MS = 3_000;
export const WINDOW_LIMIT_PER_MIN = 100;
export const MAX_AUTH_FAILURES = 5;
export const JAIL_DURATION_MS = 10 * 60 * 1000; // 10 minutes
export const DEFAULT_MAX_IP_STATES = 10_000;
export const CLEANUP_INTERVAL_CALLS = 100;

export class IpRateLimiter {
  private ipStates = new Map<string, IpRateState>();
  private readonly maxStates: number;
  private callCount = 0;

  constructor(maxStates: number = DEFAULT_MAX_IP_STATES) {
    this.maxStates = maxStates;
  }

  /**
   * Retrieve existing IP state or initialize a fresh record.
   *
   * @param ip - Client IP string.
   * @param now - Current timestamp in milliseconds.
   * @returns Mutable state record for this IP.
   */
  private getOrInitState(ip: string, now: number): IpRateState {
    let state = this.ipStates.get(ip);
    if (!state) {
      this.ensureCapacity(now);
      state = {
        secondWindow: Math.floor(now / BURST_WINDOW_MS),
        secondCount: 0,
        minuteWindow: Math.floor(now / 60000),
        minuteCount: 0,
        authFailures: 0,
        authFailureWindow: Math.floor(now / 60000),
        jailedUntil: 0,
        lastSeen: now,
      };
      this.ipStates.set(ip, state);
    }
    state.lastSeen = now;
    return state;
  }

  /**
   * Check whether an incoming request from this IP is allowed.
   * Enforces bad-actor jail check, 60s window limit, and 3s burst limit.
   *
   * @param ip - Client IP address (from cf-connecting-ip or fallback).
   * @param now - Current timestamp (defaults to Date.now()).
   * @returns RateLimitResult indicating whether request is allowed or HTTP status/reason.
   */
  checkRateLimit(ip: string, now = Date.now()): RateLimitResult {
    this.callCount++;
    if (this.callCount % CLEANUP_INTERVAL_CALLS === 0) {
      this.cleanup(now);
    }

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

    // 2. Rotate fixed three-second window (burst limit)
    const currentBurstWindow = Math.floor(now / BURST_WINDOW_MS);
    if (state.secondWindow !== currentBurstWindow) {
      state.secondWindow = currentBurstWindow;
      state.secondCount = 0;
    }

    // 3. Rotate minute window (throughput limit)
    const currentMin = Math.floor(now / 60000);
    if (state.minuteWindow !== currentMin) {
      state.minuteWindow = currentMin;
      state.minuteCount = 0;
    }

    // 4. Check Window Limit (100 req / min) first so macro quota takes precedence
    if (state.minuteCount >= WINDOW_LIMIT_PER_MIN) {
      return {
        allowed: false,
        statusCode: 429,
        reason: `Rate limit exceeded: max ${WINDOW_LIMIT_PER_MIN} requests/minute.`,
        retryAfterSeconds: 30,
      };
    }

    // 5. Check Burst Limit (5 requests / 3 seconds)
    if (state.secondCount >= BURST_LIMIT) {
      const nextWindowAt = (currentBurstWindow + 1) * BURST_WINDOW_MS;
      return {
        allowed: false,
        statusCode: 429,
        reason: `Burst rate limit exceeded: max ${BURST_LIMIT} requests/${BURST_WINDOW_MS / 1000} seconds.`,
        retryAfterSeconds: Math.max(1, Math.ceil((nextWindowAt - now) / 1000)),
      };
    }

    // Increment request counters
    state.secondCount += 1;
    state.minuteCount += 1;

    return { allowed: true };
  }

  /**
   * Record an authentication failure for this IP.
   * Multiple failures within 60s place the IP in Jail to stop token-guessing attacks.
   *
   * @param ip - Client IP address.
   * @param now - Current timestamp (defaults to Date.now()).
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
   *
   * @param now - Current timestamp (defaults to Date.now()).
   */
  cleanup(now = Date.now()): void {
    const tenMinAgo = now - 10 * 60 * 1000;
    for (const [ip, state] of this.ipStates.entries()) {
      if (state.jailedUntil < now && state.lastSeen < tenMinAgo) {
        this.ipStates.delete(ip);
      }
    }
  }

  /**
   * Return number of tracked IP states.
   */
  get size(): number {
    return this.ipStates.size;
  }

  /**
   * Enforce memory bounds by purging expired entries and evicting oldest non-jailed entries if full.
   *
   * @param now - Current timestamp.
   */
  private ensureCapacity(now: number): void {
    if (this.ipStates.size < this.maxStates) {
      return;
    }

    // 1. Purge inactive unjailed entries
    this.cleanup(now);

    // 2. If still at capacity, evict oldest non-jailed entries
    if (this.ipStates.size >= this.maxStates) {
      for (const [ip, state] of this.ipStates.entries()) {
        if (state.jailedUntil <= now) {
          this.ipStates.delete(ip);
          if (this.ipStates.size < this.maxStates) break;
        }
      }
    }
  }
}

export const ipRateLimiter = new IpRateLimiter();
