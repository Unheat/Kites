import { describe, it, expect } from 'vitest';
import { CircuitBreakerService } from '../src/routing/circuitBreaker';
import { calculateRouteCooldown, isExplicitAccountScopeError } from '../src/routing/errorTaxonomy';
import { LatencyHealthTracker, getWorkloadBucket, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS } from '../src/routing/latencyHealth';
import { ProviderRouteConfig } from '../src/config/providers';
import { Env } from '../src/types';

describe('Production CircuitBreakerService and ErrorTaxonomy', () => {
  const testRoute: ProviderRouteConfig = {
    id: 'test-groq',
    name: 'Test Groq',
    enabled: true,
    priority: 1,
    qualityTier: 'high',
    type: 'openai-compatible',
    modelName: 'test-model',
    apiKeyEnvVar: 'GROQ_API_KEY',
    rpsLimit: 2,
    rpmLimit: 5,
    rpdLimit: 100,
    maxInflight: 2,
    defaultTimeoutMs: 3000,
    outputCapability: 'json-schema',
    verificationEvidence: 'documented',
  };

  const testEnv: Env = {
    SHARED_POOL: {} as any,
    GROQ_API_KEY: 'test-secret-key',
  };

  it('correctly calculates cooldown based on explicit error taxonomy', () => {
    // 1. Retry-After header takes highest precedence
    expect(calculateRouteCooldown(429, 'too many requests', 15)).toBe(15_000);

    // 2. HTTP 408 Timeout: short 5s on first failure, 15s on consecutive
    expect(calculateRouteCooldown(408, 'timeout', undefined, 1)).toBe(5_000);
    expect(calculateRouteCooldown(408, 'timeout', undefined, 2)).toBe(15_000);

    // 3. HTTP 429: burst 2s cooldown if error explicitly specifies per-second/concurrency
    expect(calculateRouteCooldown(429, 'rate limit: 2 requests per second')).toBe(2_000);
    expect(calculateRouteCooldown(429, 'too many concurrent requests')).toBe(2_000);

    // 4. HTTP 429: standard 60s cooldown if generic rate limit
    expect(calculateRouteCooldown(429, 'rate limit exceeded')).toBe(60_000);

    // 5. HTTP 5xx: exponential backoff steps [10s, 30s, 120s, 300s]
    expect(calculateRouteCooldown(500, 'server error', undefined, 1)).toBe(10_000);
    expect(calculateRouteCooldown(503, 'service unavailable', undefined, 2)).toBe(30_000);
    expect(calculateRouteCooldown(502, 'bad gateway', undefined, 3)).toBe(120_000);
    expect(calculateRouteCooldown(500, 'crash', undefined, 4)).toBe(300_000);
  });

  it('detects explicit account-scope errors without confusing generic 429s', () => {
    expect(isExplicitAccountScopeError(402, 'payment required')).toBe(true);
    expect(isExplicitAccountScopeError(403, 'organization_restricted: account suspended')).toBe(true);
    expect(isExplicitAccountScopeError(400, 'insufficient_funds in credit balance')).toBe(true);

    // Generic 429 or daily quota message is NOT an account suspension
    expect(isExplicitAccountScopeError(429, 'Daily request limit reached')).toBe(false);
    expect(isExplicitAccountScopeError(429, 'Too many requests')).toBe(false);
  });

  it('enforces predispatch rate limits (RPS, RPM) and max in-flight bounds', () => {
    const service = new CircuitBreakerService();
    const t0 = 1700000000000;

    // First request: acquired
    const req1 = service.acquireRoute(testRoute, testEnv, t0);
    expect(req1.acquired).toBe(true);

    // Second request: acquired (rpsLimit is 2, maxInflight is 2)
    const req2 = service.acquireRoute(testRoute, testEnv, t0);
    expect(req2.acquired).toBe(true);

    // Third request at same second: rejected by both rpsLimit and maxInflight
    const req3 = service.acquireRoute(testRoute, testEnv, t0);
    expect(req3.acquired).toBe(false);

    // Release one in-flight lease
    service.releaseRoute(testRoute.id);

    // Advance 1 second: RPS resets, in-flight is 1 -> can acquire
    const req4 = service.acquireRoute(testRoute, testEnv, t0 + 1000);
    expect(req4.acquired).toBe(true);
  });

  it('enforces single HALF-OPEN probe guard and circuit state transitions', () => {
    const service = new CircuitBreakerService();
    const t0 = 1700000000000;

    // Acquire and record failure
    const req1 = service.acquireRoute(testRoute, testEnv, t0);
    service.releaseRoute(testRoute.id);
    service.recordOutcome(testRoute, false, 500, req1.generation, 'error', undefined, t0);

    const circuit = service.getCircuit(testRoute.id, t0);
    expect(circuit.state).toBe('OPEN');
    expect(circuit.cooldownUntil).toBe(t0 + 10_000);

    // While OPEN during cooldown: acquisition rejected
    const blockedReq = service.acquireRoute(testRoute, testEnv, t0 + 5_000);
    expect(blockedReq.acquired).toBe(false);

    // After cooldown expires (t0 + 10_000): transitions to HALF-OPEN for single probe
    const probeReq1 = service.acquireRoute(testRoute, testEnv, t0 + 10_001);
    expect(probeReq1.acquired).toBe(true);
    expect(circuit.state).toBe('HALF-OPEN');
    expect(circuit.halfOpenInFlight).toBe(true);

    // Concurrent second request during HALF-OPEN probe is REJECTED
    const probeReq2 = service.acquireRoute(testRoute, testEnv, t0 + 10_002);
    expect(probeReq2.acquired).toBe(false);
    expect(probeReq2.reason).toContain('HALF-OPEN');

    // Probe succeeds: circuit closes
    service.releaseRoute(testRoute.id);
    service.recordOutcome(testRoute, true, 200, probeReq1.generation, undefined, undefined, t0 + 10_100);
    expect(circuit.state).toBe('CLOSED');
    expect(circuit.consecutiveFailures).toBe(0);
    expect(circuit.halfOpenInFlight).toBe(false);
  });

  it('rejects stale outcomes from an older generation', () => {
    const service = new CircuitBreakerService();
    const t0 = 1700000000000;

    const req = service.acquireRoute(testRoute, testEnv, t0);
    const staleGen = req.generation;

    // Simulate circuit state transition incrementing generation
    service.getCircuit(testRoute.id).generation += 1;

    // Stale outcome reported: ignored without corrupting new circuit state
    service.recordOutcome(testRoute, false, 500, staleGen, 'stale timeout', undefined, t0);
    expect(service.getCircuit(testRoute.id).state).toBe('CLOSED');
  });
});

describe('Production LatencyHealthTracker and Workload Buckets', () => {
  const trackerRoute: ProviderRouteConfig = {
    id: 'tracker-route',
    name: 'Tracker Route',
    enabled: true,
    priority: 1,
    qualityTier: 'high',
    type: 'openai-compatible',
    modelName: 'tracker-model',
    defaultTimeoutMs: 3500,
    outputCapability: 'json-schema',
    verificationEvidence: 'documented',
  };

  it('maps tokens to workload buckets correctly', () => {
    expect(getWorkloadBucket(20)).toBe('small');
    expect(getWorkloadBucket(49)).toBe('small');
    expect(getWorkloadBucket(50)).toBe('medium');
    expect(getWorkloadBucket(200)).toBe('medium');
    expect(getWorkloadBucket(201)).toBe('large');
    expect(getWorkloadBucket(500)).toBe('large');
  });

  it('uses default timeout during warm-up (< 3 samples)', () => {
    const tracker = new LatencyHealthTracker();
    expect(tracker.calculateTimeout(trackerRoute, 30)).toBe(3500);

    tracker.recordSuccess(trackerRoute.id, 1200, 30);
    expect(tracker.calculateTimeout(trackerRoute, 30)).toBe(3500);

    tracker.recordSuccess(trackerRoute.id, 1300, 30);
    expect(tracker.calculateTimeout(trackerRoute, 30)).toBe(3500);
  });

  it('predicts adaptive timeout using EWMA and deviation once trained (>= 3 samples)', () => {
    const tracker = new LatencyHealthTracker();
    const now = 1700000000000;

    tracker.recordSuccess(trackerRoute.id, 1000, 30, undefined, now);
    tracker.recordSuccess(trackerRoute.id, 1100, 30, undefined, now + 1000);
    tracker.recordSuccess(trackerRoute.id, 1050, 30, undefined, now + 2000);

    // Once trained, calculateTimeout reflects bucket EWMA + 2*deviation (clamped [2000, 6000])
    const timeout = tracker.calculateTimeout(trackerRoute, 30, now + 3000);
    expect(timeout).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS);
    expect(timeout).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
  });

  it('treats timeouts as censored lower bounds to directly inflate timeout floor', () => {
    const tracker = new LatencyHealthTracker();
    const now = 1700000000000;

    // Train with 3 samples
    tracker.recordSuccess(trackerRoute.id, 1500, 30, undefined, now);
    tracker.recordSuccess(trackerRoute.id, 1500, 30, undefined, now + 1000);
    tracker.recordSuccess(trackerRoute.id, 1500, 30, undefined, now + 2000);

    const baselineTimeout = tracker.calculateTimeout(trackerRoute, 30, now + 3000);

    // Record censored timeout at 3000ms
    tracker.recordTimeout(trackerRoute.id, 30, 3000, now + 4000);

    const inflatedTimeout = tracker.calculateTimeout(trackerRoute, 30, now + 5000);
    expect(inflatedTimeout).toBeGreaterThan(baselineTimeout);
  });

  it('decays sample confidence when last observation is stale (> 1 hour)', () => {
    const tracker = new LatencyHealthTracker();
    const now = 1700000000000;

    tracker.recordSuccess(trackerRoute.id, 1000, 30, undefined, now);
    tracker.recordSuccess(trackerRoute.id, 1000, 30, undefined, now + 1000);
    tracker.recordSuccess(trackerRoute.id, 1000, 30, undefined, now + 2000);

    const stats = tracker.getStats(trackerRoute.id);
    expect(stats.buckets.small.sampleCount).toBe(3);

    // 2 hours later
    const staleNow = now + 2 * 3600_000;
    tracker.calculateTimeout(trackerRoute, 30, staleNow);
    expect(stats.buckets.small.sampleCount).toBe(2); // Decayed back to warm-up
  });
});
