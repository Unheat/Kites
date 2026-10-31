/**
 * Upstream Error Taxonomy and Cooldown Calculation
 *
 * Distinguishes transient burst 429s, rate limits, timeouts, and explicit account-scope suspensions.
 * Enforces that daily/account cooldowns require explicit account-level error signals.
 */

export const COOLDOWN_BURST_MS = 2_000;
export const COOLDOWN_RATE_LIMIT_MS = 60_000;
export const COOLDOWN_TIMEOUT_FIRST_MS = 5_000;
export const COOLDOWN_TIMEOUT_CONSECUTIVE_MS = 15_000;
export const COOLDOWN_DEFAULT_MS = 30_000;
export const BACKOFF_5XX_STEPS_MS = [10_000, 30_000, 120_000, 300_000] as const;

/** Specific signals proving an entire API account / credential has been suspended or exhausted */
const EXPLICIT_ACCOUNT_ERROR_SIGNALS = [
  'account_deactivated',
  'billing_not_active',
  'insufficient_funds',
  'credit balance',
  'organization_restricted',
  'account suspended',
  'billing_hard_limit_reached',
] as const;

/**
 * Checks whether an upstream failure represents an explicit account-level suspension or exhaustion.
 * Note: Generic rate limits (429) or daily wording alone do not constitute account evidence.
 *
 * @param statusCode - HTTP status code.
 * @param errorText - Raw error text from provider.
 * @returns True if the error is explicitly scoped to the entire account credential.
 */
export function isExplicitAccountScopeError(statusCode: number, errorText = ''): boolean {
  if (statusCode === 402) return true;
  const lower = errorText.toLowerCase();
  return EXPLICIT_ACCOUNT_ERROR_SIGNALS.some((sig) => lower.includes(sig));
}

/**
 * Calculates cooldown duration in milliseconds based on error taxonomy and Retry-After headers.
 * Does not make arbitrary assumptions about midnight resets or infer RPS from config alone.
 *
 * @param statusCode - Upstream HTTP status code.
 * @param errorText - Error response text.
 * @param retryAfterSeconds - Explicit Retry-After duration in seconds if provided by header.
 * @param consecutiveFailures - Failure streak.
 * @returns Duration in milliseconds to cool down the route.
 */
export function calculateRouteCooldown(
  statusCode: number,
  errorText = '',
  retryAfterSeconds?: number,
  consecutiveFailures = 1
): number {
  // 1. Upstream Retry-After takes top precedence
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  // 2. Gateway / Connection Timeout (HTTP 408)
  if (statusCode === 408) {
    return consecutiveFailures <= 1 ? COOLDOWN_TIMEOUT_FIRST_MS : COOLDOWN_TIMEOUT_CONSECUTIVE_MS;
  }

  // 3. Rate Limits (HTTP 429)
  if (statusCode === 429) {
    const lower = errorText.toLowerCase();
    // Only use short burst cooldown if error explicitly specifies second/concurrency limit
    if (lower.includes('per second') || lower.includes('concurrency limit') || lower.includes('too many concurrent')) {
      return COOLDOWN_BURST_MS;
    }
    // Standard conservative rate limit cooldown
    return COOLDOWN_RATE_LIMIT_MS;
  }

  // 4. Server Errors (HTTP 5xx) and Network Exceptions
  const stepIdx = Math.min(Math.max(0, consecutiveFailures - 1), BACKOFF_5XX_STEPS_MS.length - 1);
  return BACKOFF_5XX_STEPS_MS[stepIdx] ?? COOLDOWN_DEFAULT_MS;
}
