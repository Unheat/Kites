/**
 * Latency and Health Routing Service
 *
 * Implements bounded workload-bucketed end-to-end EWMA and mean deviation tracking.
 * Treats timeouts as censored lower-bound observations to directly raise predicted latency.
 * Employs normalized ms/token solely as diagnostic observability metrics.
 * Uses strictly deterministic static priority order for candidate routes.
 */

import { ProviderRouteConfig } from '../config/providers';

export const MIN_TIMEOUT_MS = 2000;
export const MAX_TIMEOUT_MS = 6000;
const STALE_CONFIDENCE_MS = 60 * 60 * 1000; // 1 hour

/** Empirical workload buckets for text batch sizes */
export type WorkloadBucket = 'small' | 'medium' | 'large';

export function getWorkloadBucket(estimatedTokens: number): WorkloadBucket {
  if (estimatedTokens < 50) return 'small';
  if (estimatedTokens <= 200) return 'medium';
  return 'large';
}

export interface BucketStats {
  ewmaLatencyMs: number;
  meanDeviationMs: number;
  sampleCount: number;
  lastSampleAt: number;
  consecutiveTimeouts: number;
}

export interface RouteStats {
  buckets: Record<WorkloadBucket, BucketStats>;
  diagnosticEmaMsPerToken: number;
  totalSamples: number;
}

function createDefaultBucketStats(defaultLatencyMs: number): BucketStats {
  return {
    ewmaLatencyMs: defaultLatencyMs,
    meanDeviationMs: 0,
    sampleCount: 0,
    lastSampleAt: 0,
    consecutiveTimeouts: 0,
  };
}

export class LatencyHealthTracker {
  private routeStats = new Map<string, RouteStats>();

  /**
   * Retrieves or initializes stats for a given route.
   *
   * @param routeId - Route unique identifier.
   * @param defaultTimeoutMs - Route baseline timeout.
   * @returns Mutable RouteStats.
   */
  getStats(routeId: string, defaultTimeoutMs = 3500): RouteStats {
    let stats = this.routeStats.get(routeId);
    if (!stats) {
      stats = {
        buckets: {
          small: createDefaultBucketStats(Math.max(MIN_TIMEOUT_MS, Math.round(defaultTimeoutMs * 0.7))),
          medium: createDefaultBucketStats(defaultTimeoutMs),
          large: createDefaultBucketStats(Math.min(MAX_TIMEOUT_MS, Math.round(defaultTimeoutMs * 1.3))),
        },
        diagnosticEmaMsPerToken: 12,
        totalSamples: 0,
      };
      this.routeStats.set(routeId, stats);
    }
    return stats;
  }

  /**
   * Calculates adaptive timeout using workload-bucketed EWMA and deviation.
   * Respects censored lower-bound timeout observations and decays confidence on stale samples.
   *
   * @param route - Target provider route.
   * @param estimatedTokens - Estimated token volume for the translation request.
   * @param now - Current epoch timestamp.
   * @returns Bounded timeout in milliseconds [MIN_TIMEOUT_MS, MAX_TIMEOUT_MS].
   */
  calculateTimeout(route: ProviderRouteConfig, estimatedTokens: number, now = Date.now()): number {
    const defaultTimeout = route.defaultTimeoutMs ?? 3500;
    const stats = this.getStats(route.id, defaultTimeout);
    const bucketType = getWorkloadBucket(estimatedTokens);
    const bucket = stats.buckets[bucketType];

    // Stale confidence decay
    if (bucket.lastSampleAt > 0 && now - bucket.lastSampleAt > STALE_CONFIDENCE_MS) {
      bucket.sampleCount = Math.min(bucket.sampleCount, 2);
    }

    let predicted: number;
    if (bucket.sampleCount < 3) {
      predicted = defaultTimeout;
    } else {
      // Statistical ceiling: EWMA + 2 * mean deviation
      predicted = Math.round(bucket.ewmaLatencyMs + 2 * bucket.meanDeviationMs);
    }

    // Censored lower-bound inflation: if previously timed out, true latency is at least the timeout floor
    if (bucket.consecutiveTimeouts > 0) {
      predicted = Math.max(predicted, bucket.ewmaLatencyMs + 500);
    }

    return Math.min(Math.max(predicted, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
  }

  /**
   * Records a successful execution into the appropriate workload bucket and updates diagnostic rate.
   * Bucket selection is derived consistently from estimatedTokens to match calculateTimeout.
   *
   * @param routeId - Route unique identifier.
   * @param latencyMs - Measured round-trip elapsed duration.
   * @param estimatedTokens - Request estimated token volume used for bucket alignment.
   * @param actualTokens - Optional upstream reported token count for diagnostic rate calculation.
   * @param now - Current epoch timestamp.
   */
  recordSuccess(
    routeId: string,
    latencyMs: number,
    estimatedTokens: number,
    actualTokens?: number,
    now = Date.now()
  ): void {
    const stats = this.getStats(routeId);
    const bucketType = getWorkloadBucket(estimatedTokens);
    const bucket = stats.buckets[bucketType];

    bucket.consecutiveTimeouts = 0;
    bucket.lastSampleAt = now;

    if (bucket.sampleCount === 0) {
      bucket.ewmaLatencyMs = latencyMs;
      bucket.meanDeviationMs = 0;
    } else {
      const dev = Math.abs(latencyMs - bucket.ewmaLatencyMs);
      bucket.meanDeviationMs = Math.round(bucket.meanDeviationMs * 0.7 + dev * 0.3);
      bucket.ewmaLatencyMs = Math.round(bucket.ewmaLatencyMs * 0.7 + latencyMs * 0.3);
    }
    bucket.sampleCount += 1;
    stats.totalSamples += 1;

    // Diagnostic-only normalized speed update (bounded [2, 50] ms/token)
    const tokens = Math.max(actualTokens ?? estimatedTokens, 10);
    const rawRate = latencyMs / tokens;
    const clampedRate = Math.min(Math.max(rawRate, 2), 50);
    stats.diagnosticEmaMsPerToken = Number(
      (stats.diagnosticEmaMsPerToken * 0.7 + clampedRate * 0.3).toFixed(2)
    );
  }

  /**
   * Records a censored timeout observation. Directly establishes a lower-bound on the bucket's EWMA.
   *
   * @param routeId - Route unique identifier.
   * @param estimatedTokens - Estimated token volume of the timed-out request.
   * @param elapsedMs - Measured duration before timeout abort.
   * @param now - Current epoch timestamp.
   */
  recordTimeout(
    routeId: string,
    estimatedTokens: number,
    elapsedMs: number,
    now = Date.now()
  ): void {
    const stats = this.getStats(routeId);
    const bucketType = getWorkloadBucket(estimatedTokens);
    const bucket = stats.buckets[bucketType];

    bucket.consecutiveTimeouts += 1;
    bucket.lastSampleAt = now;
    // Censored observation: true duration was >= elapsedMs
    bucket.ewmaLatencyMs = Math.max(bucket.ewmaLatencyMs, elapsedMs);
  }

  /**
   * Orders candidate routes.
   * Adheres strictly to deterministic static priority order to guarantee transitivity.
   *
   * @param routes - Candidate routes.
   * @returns Ordered route list.
   */
  orderRoutes(routes: readonly ProviderRouteConfig[]): ProviderRouteConfig[] {
    return [...routes].sort((a, b) => a.priority - b.priority);
  }
}
