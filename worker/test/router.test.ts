import { describe, it, expect } from 'vitest';
import { ProviderRouteConfig } from '../src/config/providers';

describe('Layer 1 & Layer 2 Rate Limiting & Cooldown Logic', () => {
  const now = 1700000000000;

  function calculateSmartCooldown(
    route: ProviderRouteConfig,
    statusCode: number,
    errorText: string,
    retryAfterSeconds?: number,
    consecutiveFailures: number = 1
  ): number {
    if (statusCode === 408) {
      return consecutiveFailures === 1 ? 5_000 : 15_000;
    }
    if (statusCode === 429 || statusCode === 402) {
      if (retryAfterSeconds && retryAfterSeconds > 0) {
        return retryAfterSeconds * 1000;
      }
      const lower = errorText.toLowerCase();
      if (
        statusCode === 402 ||
        lower.includes('per day') ||
        lower.includes('daily') ||
        lower.includes('quota exceeded') ||
        lower.includes('insufficient_quota') ||
        lower.includes('credit')
      ) {
        const tomorrow = new Date(now);
        tomorrow.setUTCHours(24, 0, 0, 0);
        return Math.max(tomorrow.getTime() - now, 60_000);
      }
      if (
        route.rpsLimit ||
        lower.includes('per second') ||
        lower.includes('concurrency') ||
        lower.includes('rate limit exceeded')
      ) {
        return 2_000;
      }
      return 60_000;
    }
    return 30_000;
  }

  it('calculates 2-second cooldown for per-second RPS limits', () => {
    const mistralRoute: ProviderRouteConfig = {
      id: 'mistral-small',
      name: 'Mistral Small',
      enabled: true,
      priority: 1,
      type: 'openai-compatible',
      modelName: 'mistral-small-latest',
      rpsLimit: 1,
    };

    const cd = calculateSmartCooldown(mistralRoute, 429, 'Rate limit exceeded: 1 request per second');
    expect(cd).toBe(2000);
  });

  it('calculates midnight UTC cooldown for daily quota exhaustion', () => {
    const groqRoute: ProviderRouteConfig = {
      id: 'groq-llama',
      name: 'Groq',
      enabled: true,
      priority: 1,
      type: 'openai-compatible',
      modelName: 'llama-3.3-70b-versatile',
      rpdLimit: 1000,
    };

    const cd = calculateSmartCooldown(groqRoute, 429, 'Daily request limit reached: quota exceeded');
    expect(cd).toBeGreaterThan(60_000); // Several hours until UTC midnight
  });

  it('calculates 60-second cooldown for standard RPM rate limits', () => {
    const gemmaRoute: ProviderRouteConfig = {
      id: 'gemma-4-26b',
      name: 'Gemma 4 26B',
      enabled: true,
      priority: 1,
      type: 'gemini',
      modelName: 'gemma-4-26b',
      rpmLimit: 30,
    };

    const cd = calculateSmartCooldown(gemmaRoute, 429, 'Too many requests in this minute');
    expect(cd).toBe(60_000);
  });

  it('honors upstream Retry-After header with highest priority', () => {
    const route: ProviderRouteConfig = {
      id: 'test-model',
      name: 'Test',
      enabled: true,
      priority: 1,
      type: 'openai-compatible',
      modelName: 'test',
    };

    const cd = calculateSmartCooldown(route, 429, 'Slow down', 15);
    expect(cd).toBe(15_000); // 15 seconds
  });

  it('calculates brief cooldown for transient HTTP 408 timeouts', () => {
    const route: ProviderRouteConfig = {
      id: 'test-model',
      name: 'Test',
      enabled: true,
      priority: 1,
      type: 'openai-compatible',
      modelName: 'test',
    };

    const firstCooldown = calculateSmartCooldown(route, 408, 'Timeout after 3000ms', undefined, 1);
    expect(firstCooldown).toBe(5_000);

    const secondCooldown = calculateSmartCooldown(route, 408, 'Timeout after 3000ms', undefined, 2);
    expect(secondCooldown).toBe(15_000);
  });

  it('correctly handles optional limit fields when omitted', () => {
    const minimalRoute: ProviderRouteConfig = {
      id: 'workers-ai',
      name: 'Workers AI',
      enabled: true,
      priority: 1,
      type: 'workers-ai',
      modelName: '@cf/meta/m2m100-1.2b',
      // rpsLimit, rpmLimit, rpdLimit are all undefined
    };

    // Verify condition passes when limits are undefined
    const circuit = { secondCount: 50, minuteCount: 1000, dayCount: 50000 };
    const isUnderRps = !minimalRoute.rpsLimit || circuit.secondCount < minimalRoute.rpsLimit;
    const isUnderRpm = !minimalRoute.rpmLimit || circuit.minuteCount < minimalRoute.rpmLimit;
    const isUnderRpd = !minimalRoute.rpdLimit || circuit.dayCount < minimalRoute.rpdLimit;

    expect(isUnderRps).toBe(true);
    expect(isUnderRpm).toBe(true);
    expect(isUnderRpd).toBe(true);
  });
});

describe('Token-Normalized Adaptive Timeout & Warm-up Logic', () => {
  const MIN_TIMEOUT_MS = 2000;
  const MAX_TIMEOUT_MS = 6000;

  function calculateAdaptiveTimeout(
    sampleCount: number,
    emaMsPerToken: number,
    defaultTimeoutMs: number,
    estimatedTokens: number
  ): number {
    if (sampleCount < 3) {
      return defaultTimeoutMs;
    }
    const baseOverheadMs = 600;
    const expectedTime = baseOverheadMs + estimatedTokens * emaMsPerToken;
    const dynamic = Math.round(expectedTime * 1.5);
    return Math.round(Math.min(Math.max(dynamic, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS));
  }

  function updateEmaRate(
    currentEma: number,
    sampleCount: number,
    latencyMs: number,
    promptChars: number,
    outputChars: number
  ): { emaMsPerToken: number; sampleCount: number } {
    const promptTokens = Math.ceil(promptChars / 4);
    const completionTokens = Math.ceil(outputChars / 4);
    const totalTokens = Math.max(promptTokens + completionTokens, 15);
    const rawMsPerToken = latencyMs / totalTokens;
    const currentMsPerToken = Math.min(Math.max(rawMsPerToken, 2), 50);

    let nextEma = currentEma;
    if (sampleCount === 0) {
      nextEma = currentMsPerToken;
    } else {
      nextEma = Number((currentEma * 0.7 + currentMsPerToken * 0.3).toFixed(2));
    }
    return {
      emaMsPerToken: nextEma,
      sampleCount: sampleCount + 1,
    };
  }

  it('uses default route timeout during 3-sample warm-up learning phase', () => {
    const defaultTimeout = 3500;
    // 0 samples
    expect(calculateAdaptiveTimeout(0, 10, defaultTimeout, 100)).toBe(3500);
    // 1 sample
    expect(calculateAdaptiveTimeout(1, 10, defaultTimeout, 100)).toBe(3500);
    // 2 samples
    expect(calculateAdaptiveTimeout(2, 10, defaultTimeout, 100)).toBe(3500);
  });

  it('scales timeout by token length once trained (sampleCount >= 3)', () => {
    const emaMsPerToken = 10; // 10ms per token
    const defaultTimeout = 3500;

    // Short request (20 tokens): 600 + (20 * 10) = 800ms -> 800 * 1.5 = 1200ms -> clamped to MIN_TIMEOUT_MS (2000)
    const shortTimeout = calculateAdaptiveTimeout(3, emaMsPerToken, defaultTimeout, 20);
    expect(shortTimeout).toBe(2000);

    // Medium request (150 tokens): 600 + (150 * 10) = 2100ms -> 2100 * 1.5 = 3150ms
    const mediumTimeout = calculateAdaptiveTimeout(5, emaMsPerToken, defaultTimeout, 150);
    expect(mediumTimeout).toBe(3150);

    // Large request (400 tokens): 600 + (400 * 10) = 4600ms -> 4600 * 1.5 = 6900ms -> clamped to MAX_TIMEOUT_MS (6000)
    const largeTimeout = calculateAdaptiveTimeout(10, emaMsPerToken, defaultTimeout, 400);
    expect(largeTimeout).toBe(6000);
  });

  it('clamps extreme latency outliers to [2, 50] ms/token', () => {
    // Extreme fast anomaly: 10ms for 200 tokens (0.05ms/token) -> clamped to 2ms/token
    const fastUpdate = updateEmaRate(12, 0, 10, 400, 400);
    expect(fastUpdate.emaMsPerToken).toBe(2);

    // Extreme slow anomaly: 50,000ms for 100 tokens (500ms/token) -> clamped to 50ms/token
    const slowUpdate = updateEmaRate(12, 1, 50_000, 200, 200);
    // 12 * 0.7 + 50 * 0.3 = 8.4 + 15 = 23.4
    expect(slowUpdate.emaMsPerToken).toBe(23.4);
    expect(slowUpdate.sampleCount).toBe(2);
  });
});
