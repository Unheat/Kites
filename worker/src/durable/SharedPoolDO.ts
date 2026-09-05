/**
 * SharedPoolDO - Cloudflare Durable Object with SQLite Storage Backend
 * 
 * Responsibilities:
 * 1. Single authority for user rolling 24-hour quota (100 translations/day, timer starts on 1st request).
 * 2. SQLite storage optimization: exactly 1 SQL upsert per translation to stay within 100k daily write limit.
 * 3. In-memory Adaptive Cooldown & Circuit Breaker: 429/5xx triggers cooldown; avoids broken waterfalls.
 * 4. In-memory Adaptive Timeout: tracks EMA latency and bounds timeouts between 2000ms - 6000ms.
 * 5. Multi-provider waterfall: executes eligible providers in priority order.
 */

import { DurableObject } from 'cloudflare:workers';
import { Env, OpenAIChatRequest, OpenAIChatResponse, ProviderCircuitState, UserQuotaRecord } from '../types';
import { PROVIDER_ROUTES, ProviderRouteConfig } from '../config/providers';
import { executeOpenAICompatible } from '../adapters/openai-compatible';
import { executeWorkersAI } from '../adapters/workers-ai';
import { executeGemini } from '../adapters/gemini';

const USER_WINDOW_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_USER_QUOTA = 100;

const GLOBAL_DAILY_CAP = 70_000;
const MIN_TIMEOUT_MS = 2000;
const MAX_TIMEOUT_MS = 6000;

export class SharedPoolDO extends DurableObject {
  private env: Env;
  
  // In-memory cache to minimize SQLite reads
  private userQuotaCache = new Map<string, UserQuotaRecord>();
  
  // In-memory circuit breakers & latency tracker (0 SQLite writes)
  private providerCircuits = new Map<string, ProviderCircuitState>();

  // In-memory global daily counter
  private globalDailyCount = 0;
  private currentUtcDay = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
    this.initSqlite();
    this.initDayCounter();
  }

  /**
   * Initialize SQLite schema for user quotas.
   */
  private initSqlite() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS user_quotas (
        user_hash TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        used_count INTEGER NOT NULL
      );
    `);
  }

  private initDayCounter() {
    this.currentUtcDay = new Date().toISOString().slice(0, 10);
  }

  private checkAndRotateDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentUtcDay) {
      this.currentUtcDay = today;
      this.globalDailyCount = 0;
    }
  }

  /**
   * Get or load user quota from in-memory cache or SQLite.
   */
  private getUserQuota(userHash: string): UserQuotaRecord | null {
    if (this.userQuotaCache.has(userHash)) {
      return this.userQuotaCache.get(userHash)!;
    }

    const cursor = this.ctx.storage.sql.exec(
      `SELECT window_start, used_count FROM user_quotas WHERE user_hash = ?`,
      userHash
    );

    for (const row of cursor) {
      const record: UserQuotaRecord = {
        windowStart: row.window_start as number,
        usedCount: row.used_count as number,
      };
      this.userQuotaCache.set(userHash, record);
      return record;
    }

    return null;
  }

  /**
   * Check and consume 1 user translation ticket.
   * Starts rolling 24-hour window on the first request.
   */
  private checkAndConsumeQuota(userHash: string, now: number): { allowed: boolean; remaining: number; resetsAt: number } {
    let record = this.getUserQuota(userHash);

    if (!record || now >= record.windowStart + USER_WINDOW_DURATION_MS) {
      // First request ever OR previous 24h window has completely passed
      record = { windowStart: now, usedCount: 1 };
    } else if (record.usedCount >= MAX_USER_QUOTA) {
      return {
        allowed: false,
        remaining: 0,
        resetsAt: record.windowStart + USER_WINDOW_DURATION_MS,
      };
    } else {
      record.usedCount += 1;
    }

    // Update in-memory cache
    this.userQuotaCache.set(userHash, record);

    // Exactly 1 SQLite upsert write per translation
    this.ctx.storage.sql.exec(
      `INSERT INTO user_quotas (user_hash, window_start, used_count)
       VALUES (?, ?, ?)
       ON CONFLICT(user_hash) DO UPDATE SET
         window_start = excluded.window_start,
         used_count = excluded.used_count;`,
      userHash,
      record.windowStart,
      record.usedCount
    );

    return {
      allowed: true,
      remaining: MAX_USER_QUOTA - record.usedCount,
      resetsAt: record.windowStart + USER_WINDOW_DURATION_MS,
    };
  }

  /**
   * Get circuit state for a provider route with sliding rate window initialization.
   */
  private getCircuit(routeId: string, defaultTimeout: number): ProviderCircuitState {
    if (!this.providerCircuits.has(routeId)) {
      const now = Date.now();
      const currentUtcDay = new Date().toISOString().slice(0, 10);
      this.providerCircuits.set(routeId, {
        state: 'CLOSED',
        cooldownUntil: 0,
        consecutiveFailures: 0,
        emaLatencyMs: defaultTimeout,
        currentSecondWindow: Math.floor(now / 1000),
        secondCount: 0,
        currentMinuteWindow: Math.floor(now / 60000),
        minuteCount: 0,
        currentDayWindow: currentUtcDay,
        dayCount: 0,
      });
    }
    return this.providerCircuits.get(routeId)!;
  }

  /**
   * Rotate sliding rate windows (second, minute, day) based on current timestamp.
   */
  private rotateRateWindows(circuit: ProviderCircuitState, now: number) {
    const currentSec = Math.floor(now / 1000);
    if (circuit.currentSecondWindow !== currentSec) {
      circuit.currentSecondWindow = currentSec;
      circuit.secondCount = 0;
    }

    const currentMin = Math.floor(now / 60000);
    if (circuit.currentMinuteWindow !== currentMin) {
      circuit.currentMinuteWindow = currentMin;
      circuit.minuteCount = 0;
    }

    const currentDay = new Date(now).toISOString().slice(0, 10);
    if (circuit.currentDayWindow !== currentDay) {
      circuit.currentDayWindow = currentDay;
      circuit.dayCount = 0;
    }
  }

  /**
   * Determine whether a route is eligible for dispatch.
   * Checks both Layer 2 circuit cooldown and Layer 1 proactive rate limits.
   */
  private isRouteEligible(route: ProviderRouteConfig, now: number): boolean {
    if (!route.enabled) return false;

    // Verify required API key exists if needed
    if (route.apiKeyEnvVar && !this.env[route.apiKeyEnvVar]) {
      return false;
    }

    const circuit = this.getCircuit(route.id, route.defaultTimeoutMs ?? 3500);

    // Layer 2: Circuit Breaker Cooldown Check
    if (circuit.state === 'OPEN') {
      if (now >= circuit.cooldownUntil) {
        circuit.state = 'HALF-OPEN';
      } else {
        return false; // In cooldown -> skip without HTTP call
      }
    }

    // Layer 1: Proactive Sliding Window Rate Limits Check
    this.rotateRateWindows(circuit, now);

    if (route.rpsLimit && circuit.secondCount >= route.rpsLimit) {
      return false; // Reached per-second limit -> skip to next provider in waterfall
    }

    if (route.rpmLimit && circuit.minuteCount >= route.rpmLimit) {
      return false; // Reached per-minute limit -> skip to next provider in waterfall
    }

    if (route.rpdLimit && circuit.dayCount >= route.rpdLimit) {
      return false; // Reached daily limit -> skip to next provider in waterfall
    }

    return true;
  }

  /**
   * Calculate adaptive timeout using exponential moving average (EMA).
   */
  private calculateAdaptiveTimeout(circuit: ProviderCircuitState): number {
    const dynamic = circuit.emaLatencyMs * 1.5 + 500;
    return Math.round(Math.min(Math.max(dynamic, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS));
  }

  /**
   * Record outcome to update circuit breaker, smart cooldown, and adaptive latency.
   */
  private recordRouteOutcome(
    route: ProviderRouteConfig,
    success: boolean,
    statusCode: number,
    latencyMs: number,
    errorText?: string,
    retryAfterSeconds?: number
  ) {
    const circuit = this.getCircuit(route.id, route.defaultTimeoutMs ?? 3500);
    const now = Date.now();

    if (success) {
      circuit.state = 'CLOSED';
      circuit.consecutiveFailures = 0;
      // EMA smoothing (alpha = 0.3)
      circuit.emaLatencyMs = Math.round(circuit.emaLatencyMs * 0.7 + latencyMs * 0.3);
      return;
    }

    // Failure / Cooldown trigger
    circuit.consecutiveFailures += 1;

    let cooldownMs = 30_000; // default 30s
    const lowerError = (errorText || '').toLowerCase();

    if (statusCode === 429 || statusCode === 402) {
      // 1. Check upstream Retry-After header
      if (retryAfterSeconds && retryAfterSeconds > 0) {
        cooldownMs = retryAfterSeconds * 1000;
      } else if (
        statusCode === 402 ||
        lowerError.includes('per day') ||
        lowerError.includes('daily') ||
        lowerError.includes('quota exceeded') ||
        lowerError.includes('insufficient_quota') ||
        lowerError.includes('exceeded your current quota') ||
        lowerError.includes('credit')
      ) {
        // Daily quota exhausted -> cooldown until 00:00 UTC
        const tomorrow = new Date(now);
        tomorrow.setUTCHours(24, 0, 0, 0);
        cooldownMs = Math.max(tomorrow.getTime() - now, 60_000);
      } else if (
        route.rpsLimit ||
        lowerError.includes('per second') ||
        lowerError.includes('concurrency') ||
        lowerError.includes('rate limit exceeded')
      ) {
        // Per-second limit burst -> brief 2s pause
        cooldownMs = 2_000;
      } else {
        // Standard per-minute rate limit
        cooldownMs = 60_000;
      }
    } else {
      // Exponential backoff for 5xx/transport: 10s, 30s, 120s, 300s max
      const backoffSteps = [10_000, 30_000, 120_000, 300_000];
      const stepIdx = Math.min(circuit.consecutiveFailures - 1, backoffSteps.length - 1);
      cooldownMs = backoffSteps[Math.max(0, stepIdx)];
    }

    circuit.state = 'OPEN';
    circuit.cooldownUntil = now + cooldownMs;
  }

  /**
   * Main Translation Entrypoint via DO RPC or HTTP fetch
   */
  async handleTranslation(
    userHash: string,
    request: OpenAIChatRequest
  ): Promise<{ status: number; body: any }> {
    const now = Date.now();
    this.checkAndRotateDay();

    // 1. Global Daily Cap Check
    if (this.globalDailyCount >= GLOBAL_DAILY_CAP) {
      return {
        status: 429,
        body: {
          error: {
            message: 'Global translation pool daily quota exhausted. Resets at 00:00 UTC.',
            type: 'insufficient_quota',
            code: 'global_daily_exhausted',
          },
        },
      };
    }

    // 2. User Rolling 24-Hour Quota Check
    const quotaResult = this.checkAndConsumeQuota(userHash, now);
    if (!quotaResult.allowed) {
      return {
        status: 429,
        body: {
          error: {
            message: `User 24-hour quota exceeded (100/day limit). Resets at ${new Date(quotaResult.resetsAt).toISOString()}`,
            type: 'insufficient_quota',
            code: 'quota_exhausted',
            resetsAt: quotaResult.resetsAt,
          },
        },
      };
    }

    // 3. Filter and Sort Eligible Providers by Priority
    const sortedRoutes = [...PROVIDER_ROUTES]
      .sort((a, b) => a.priority - b.priority)
      .filter((route) => this.isRouteEligible(route, now));

    if (sortedRoutes.length === 0) {
      return {
        status: 503,
        body: {
          error: {
            message: 'All translation providers are currently cooling down or unavailable. Please try again later.',
            type: 'service_unavailable',
            code: 'all_providers_cooling_down',
          },
        },
      };
    }

    // 4. Waterfall Dispatch Loop
    let lastError = 'No providers succeeded';
    for (const route of sortedRoutes) {
      const circuit = this.getCircuit(route.id, route.defaultTimeoutMs ?? 3500);

      // Re-verify rate limit window right before calling in case concurrent requests occurred
      this.rotateRateWindows(circuit, Date.now());
      if (route.rpsLimit && circuit.secondCount >= route.rpsLimit) {
        continue; // Layer 1: Skip to next route in waterfall
      }
      if (route.rpmLimit && circuit.minuteCount >= route.rpmLimit) {
        continue; // Layer 1: Skip to next route in waterfall
      }

      // Proactively increment in-memory rate window counters
      circuit.secondCount += 1;
      circuit.minuteCount += 1;
      circuit.dayCount += 1;

      const timeoutMs = this.calculateAdaptiveTimeout(circuit);
      const startTime = Date.now();

      let result: any;
      if (route.type === 'openai-compatible') {
        const apiKey = (route.apiKeyEnvVar ? this.env[route.apiKeyEnvVar] : '') || '';
        result = await executeOpenAICompatible(route, request, apiKey, timeoutMs);
      } else if (route.type === 'workers-ai') {
        result = await executeWorkersAI(route, request, this.env.AI, timeoutMs);
      } else if (route.type === 'gemini') {
        const apiKey = (route.apiKeyEnvVar ? this.env[route.apiKeyEnvVar] : '') || '';
        result = await executeGemini(route, request, apiKey, timeoutMs);
      }

      const elapsed = Date.now() - startTime;

      if (result && result.success && result.data) {
        this.recordRouteOutcome(route, true, 200, elapsed);
        this.globalDailyCount += 1;

        return {
          status: 200,
          body: result.data,
        };
      }

      // Layer 2: Record failure, activate smart cooldown, and continue waterfall to next route
      this.recordRouteOutcome(
        route,
        false,
        result?.statusCode || 500,
        elapsed,
        result?.error,
        result?.retryAfterSeconds
      );
      lastError = result?.error || 'Unknown error';
    }

    // All attempted providers failed
    return {
      status: 502,
      body: {
        error: {
          message: `All eligible providers failed. Last error: ${lastError}`,
          type: 'provider_error',
          code: 'all_providers_cooling_down',
        },
      },
    };
  }
}
