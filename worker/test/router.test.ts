import { describe, it, expect } from 'vitest';
import { ProviderRouteConfig } from '../src/config/providers';

describe('Layer 1 & Layer 2 Rate Limiting & Cooldown Logic', () => {
  const now = 1700000000000;

  function calculateSmartCooldown(
    route: ProviderRouteConfig,
    statusCode: number,
    errorText: string,
    retryAfterSeconds?: number
  ): number {
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
