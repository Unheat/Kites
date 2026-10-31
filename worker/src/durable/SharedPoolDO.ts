/**
 * SharedPoolDO - Cloudflare Durable Object Orchestrator
 *
 * Thin orchestrator coordinating:
 * 1. User rolling 24-hour quota & atomic reservations via QuotaAccountingService.
 * 2. Pre-dispatch rate checks and circuit breaker state via CircuitBreakerService.
 * 3. Workload-bucketed latency timeouts via LatencyHealthTracker.
 * 4. Keyed JSON output verification, canonicalization, and terminal safety refusals via ValidationService.
 */

import { DurableObject } from 'cloudflare:workers';
import { Env, OpenAIChatRequest, ProviderAttemptLog, ProviderMetadata, TranslationQuotaInfo, TranslationResult } from '../types';
import { PROVIDER_ROUTES, ProviderRouteConfig } from '../config/providers';
import { executeOpenAICompatible, AdapterExecutionResult } from '../adapters/openai-compatible';
import { executeWorkersAI } from '../adapters/workers-ai';
import { executeGemini } from '../adapters/gemini';
import { QuotaAccountingService } from './quotaService';
import { DurableSqlStore } from './quotaStore';
import { CircuitBreakerService } from '../routing/circuitBreaker';
import { LatencyHealthTracker, MIN_TIMEOUT_MS } from '../routing/latencyHealth';
import { deriveExpectedKeys, ensureRequestResponseFormat, validateCompletion } from '../routing/validation';
import { estimateTokenCount } from '../../../src/shared/translation/tokenEstimation';

const MAX_TOTAL_WATERFALL_MS = 12_500;

function assertNever(x: never): never {
  throw new Error(`Unhandled provider route type: ${x}`);
}

export class SharedPoolDO extends DurableObject<Env> {
  private quotaService = new QuotaAccountingService();
  private circuitBreaker = new CircuitBreakerService();
  private latencyTracker = new LatencyHealthTracker();

  private get store(): DurableSqlStore {
    return {
      sql: this.ctx.storage.sql,
      transactionSync: <T>(cb: () => T): T => (this.ctx.storage as any).transactionSync(cb),
    };
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.quotaService.initSchema(this.store);
    this.quotaService.loadPersistedState(this.store);
  }

  /** Read-only user quota query. */
  async getQuota(userHash: string): Promise<TranslationQuotaInfo> {
    return this.quotaService.getQuota(userHash, this.store);
  }

  /** Exhaustively dispatches request to adapter based on route protocol. */
  private async dispatchAdapter(
    route: ProviderRouteConfig,
    request: OpenAIChatRequest,
    timeoutMs: number
  ): Promise<AdapterExecutionResult> {
    switch (route.type) {
      case 'openai-compatible': {
        const apiKey = (route.apiKeyEnvVar ? this.env[route.apiKeyEnvVar] : '') || '';
        return executeOpenAICompatible(route, request, apiKey, timeoutMs);
      }
      case 'workers-ai':
        return executeWorkersAI(route, request, this.env.AI, timeoutMs);
      case 'gemini': {
        const apiKey = (route.apiKeyEnvVar ? this.env[route.apiKeyEnvVar] : '') || '';
        return executeGemini(route, request, apiKey, timeoutMs);
      }
      default:
        return assertNever(route.type);
    }
  }

  /**
   * Main Translation Entrypoint via DO RPC or HTTP fetch.
   */
  async handleTranslation(
    userHash: string,
    rawRequest: OpenAIChatRequest,
    requestId?: string
  ): Promise<TranslationResult> {
    const now = Date.now();
    const correlationId = requestId || crypto.randomUUID();

    let expectedKeys: string[];
    try {
      expectedKeys = deriveExpectedKeys(rawRequest);
    } catch (err) {
      return {
        status: 400,
        body: { error: { message: err instanceof Error ? err.message : 'Invalid request', type: 'invalid_request_error', code: 'invalid_source' } },
      };
    }

    const structuredRequest = ensureRequestResponseFormat(rawRequest, expectedKeys);
    const reservation = this.quotaService.reserveQuota(userHash, this.store, now);
    if (!reservation.allowed || !reservation.token) {
      return {
        status: reservation.statusCode || 429,
        body: { error: { message: reservation.errorMessage || 'Quota exceeded', type: 'insufficient_quota', code: reservation.errorCode || 'quota_exhausted' } },
        quota: reservation.quota,
      };
    }

    const token = reservation.token;
    let settled = false;

    try {
      const combinedPrompt = structuredRequest.messages.map((m) => m.content || '').join(' ');
      const promptTokens = estimateTokenCount(combinedPrompt);
      const estimatedTokens = Math.max(promptTokens * 2, 20);

      const orderedRoutes = this.latencyTracker.orderRoutes(PROVIDER_ROUTES);
      const waterfallDeadline = now + MAX_TOTAL_WATERFALL_MS;
      const attempts: ProviderAttemptLog[] = [];

      for (let attemptIx = 0; attemptIx < orderedRoutes.length; attemptIx++) {
        const route = orderedRoutes[attemptIx];
        const remainingBudget = waterfallDeadline - Date.now();
        if (remainingBudget < MIN_TIMEOUT_MS) break;

        const predispatch = this.circuitBreaker.acquireRoute(route, this.env, Date.now());
        if (!predispatch.acquired) continue;

        const timeoutMs = Math.min(this.latencyTracker.calculateTimeout(route, estimatedTokens, Date.now()), remainingBudget);
        const startTime = Date.now();
        let result: AdapterExecutionResult;

        try {
          result = await this.dispatchAdapter(route, structuredRequest, timeoutMs);
        } finally {
          this.circuitBreaker.releaseRoute(route.id);
        }

        const elapsed = Date.now() - startTime;
        console.log(JSON.stringify({
          event: 'attempt',
          requestId: correlationId,
          attemptIndex: attemptIx,
          routeId: route.id,
          model: route.modelName,
          status: result.statusCode,
          latencyMs: elapsed,
        }));

        // Safety refusal: terminal, release probe without opening circuit cooldown
        if (result.isTerminalRefusal) {
          this.circuitBreaker.recordSafetyRefusal(route, predispatch.generation);
          this.quotaService.releaseReservation(token);
          settled = true;
          attempts.push({ routeId: route.id, model: route.modelName, statusCode: result.statusCode, latencyMs: elapsed, errorType: 'safety_refusal' });
          return {
            status: 400,
            body: { error: { message: result.error || 'Generation refused by safety policy', type: 'invalid_request_error', code: 'content_filter' } },
            quota: this.quotaService.getQuota(userHash, this.store),
            providerMetadata: { routeId: route.id, model: route.modelName, attempts, totalAttempts: attempts.length },
          };
        }

        if (result.success && result.data) {
          const choice = result.data.choices?.[0];
          // Envelope finish_reason validation: only 'stop' is valid
          if (choice?.finish_reason !== 'stop') {
            this.circuitBreaker.recordOutcome(route, false, 502, predispatch.generation, `Truncated: ${choice?.finish_reason}`);
            attempts.push({ routeId: route.id, model: route.modelName, statusCode: 502, latencyMs: elapsed, errorType: 'truncated_output' });
            continue;
          }

          const content = choice?.message?.content || '';
          const validation = validateCompletion(content, expectedKeys);

          if (validation.valid && validation.parsed) {
            // Canonicalize content to strictly formatted Keyed JSON
            choice.message.content = JSON.stringify(validation.parsed);

            const tokensUsed = result.data.usage?.total_tokens || estimatedTokens;
            this.circuitBreaker.recordOutcome(route, true, 200, predispatch.generation);
            this.latencyTracker.recordSuccess(route.id, elapsed, estimatedTokens, tokensUsed);

            const finalQuota = this.quotaService.commitSuccess(token, this.store);
            settled = true;

            attempts.push({ routeId: route.id, model: route.modelName, statusCode: 200, latencyMs: elapsed });
            console.log(JSON.stringify({
              event: 'final',
              requestId: correlationId,
              success: true,
              routeId: route.id,
              actualModel: result.data.model,
              latencyMs: Date.now() - now,
            }));

            const metadata: ProviderMetadata = {
              routeId: route.id,
              model: route.modelName,
              actualModel: result.data.model,
              attempts,
              totalAttempts: attempts.length,
            };
            return { status: 200, body: result.data, quota: finalQuota, providerMetadata: metadata };
          }

          if (validation.isTerminalRefusal) {
            this.circuitBreaker.recordSafetyRefusal(route, predispatch.generation);
            this.quotaService.releaseReservation(token);
            settled = true;
            attempts.push({ routeId: route.id, model: route.modelName, statusCode: 400, latencyMs: elapsed, errorType: 'safety_refusal' });
            return {
              status: 400,
              body: { error: { message: validation.error || 'Content safety refusal', type: 'invalid_request_error', code: 'content_filter' } },
              quota: this.quotaService.getQuota(userHash, this.store),
              providerMetadata: { routeId: route.id, model: route.modelName, attempts, totalAttempts: attempts.length },
            };
          }

          this.circuitBreaker.recordOutcome(route, false, 502, predispatch.generation, validation.error);
          attempts.push({ routeId: route.id, model: route.modelName, statusCode: 502, latencyMs: elapsed, errorType: 'invalid_keyed_json' });
        } else {
          if (result.statusCode === 408) this.latencyTracker.recordTimeout(route.id, estimatedTokens, elapsed);
          this.circuitBreaker.recordOutcome(route, false, result.statusCode, predispatch.generation, result.error, result.retryAfterSeconds);
          attempts.push({ routeId: route.id, model: route.modelName, statusCode: result.statusCode, latencyMs: elapsed, errorType: 'upstream_error' });
        }
      }

      console.log(JSON.stringify({
        event: 'final',
        requestId: correlationId,
        success: false,
        attempts: attempts.length,
        latencyMs: Date.now() - now,
      }));

      // Release reservation before computing final quota headers
      this.quotaService.releaseReservation(token);
      settled = true;

      return {
        status: 502,
        body: { error: { message: 'All eligible translation providers failed or are cooling down', type: 'provider_error', code: 'all_providers_cooling_down' } },
        quota: this.quotaService.getQuota(userHash, this.store),
        providerMetadata: { attempts, totalAttempts: attempts.length },
      };
    } finally {
      if (!settled) {
        this.quotaService.releaseReservation(token);
      }
    }
  }
}
