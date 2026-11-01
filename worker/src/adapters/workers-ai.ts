/**
 * Cloudflare Workers AI Native Binding Adapter
 *
 * Invokes native @cf/meta/llama-3.2-1b-instruct via env.AI.
 * Guarantees in-flight concurrency lease retention across timeout races to prevent unbounded background overlap.
 * Compliant with ES2022 (no findLast), validates string responses, and forwards temperature.
 */

import { ProviderRouteConfig } from '../config/providers';
import { OpenAIChatRequest, OpenAIChatResponse } from '../types';
import { AdapterExecutionResult } from './openai-compatible';

/** Maximum concurrent background Workers AI executions permitted simultaneously */
const MAX_CONCURRENT_WORKERS_AI = 2;

/** Module-level active in-flight execution counter */
let activeWorkersAiInFlight = 0;

/**
 * Returns current count of in-flight Workers AI requests (including background-settling promises).
 *
 * @returns Number of active executions.
 */
export function getActiveWorkersAiInFlight(): number {
  return activeWorkersAiInFlight;
}

/**
 * Resets in-flight count for isolated testing.
 */
export function resetWorkersAiInFlightForTesting(): void {
  activeWorkersAiInFlight = 0;
}

/**
 * Finds content of the last user message in backwards-compatible ES2022 manner.
 *
 * @param messages - Array of chat messages.
 * @returns Content string of last user turn or empty string.
 */
function getLastUserMessageContent(messages: readonly { role: string; content: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content || '';
    }
  }
  return '';
}

/**
 * Execute a translation or text generation request against Cloudflare Workers AI binding.
 *
 * @param route - Provider route configuration containing the Workers AI model name.
 * @param request - OpenAI-compatible chat request.
 * @param aiBinding - Cloudflare Workers AI binding instance (env.AI).
 * @param timeoutMs - Maximum allowed duration before returning a timeout error.
 * @returns AdapterExecutionResult containing success status, status code, and parsed response or error.
 */
export async function executeWorkersAI(
  route: ProviderRouteConfig,
  request: OpenAIChatRequest,
  aiBinding: any,
  timeoutMs: number
): Promise<AdapterExecutionResult> {
  if (!aiBinding) {
    return {
      success: false,
      statusCode: 500,
      error: 'Cloudflare Workers AI binding (env.AI) is not configured',
    };
  }

  // Concurrency cap: if active executions have reached max, reject immediately
  if (activeWorkersAiInFlight >= MAX_CONCURRENT_WORKERS_AI) {
    return {
      success: false,
      statusCode: 429,
      error: `Workers AI concurrent execution capacity reached (${activeWorkersAiInFlight}/${MAX_CONCURRENT_WORKERS_AI})`,
      retryAfterSeconds: 2,
    };
  }

  const userMsg = getLastUserMessageContent(request.messages);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Workers AI timeout after ${timeoutMs}ms`);
      err.name = 'AbortError';
      reject(err);
    }, timeoutMs);
  });

  // Acquire in-flight lease
  activeWorkersAiInFlight++;

  // Wrap underlying execution so lease is retained until it actually settles, even if race times out
  const underlyingRunPromise = (async () => {
    try {
      // Note: Historical m2m100 dedicated translation model is retired; all modern Workers AI
      // models use standard conversational messages format.
      const runOptions: Record<string, unknown> = {
        messages: request.messages,
        max_tokens: request.max_tokens ?? 1024,
        temperature: request.temperature ?? 0.1,
      };

      if (route.outputCapability === 'json-schema') {
        if (request.response_format?.type === 'json_schema') {
          runOptions.response_format = {
            type: 'json_schema',
            json_schema: request.response_format.json_schema.schema,
          };
        } else {
          runOptions.response_format = { type: 'json_object' };
        }
      } else if (route.outputCapability === 'json-object') {
        runOptions.response_format = { type: 'json_object' };
      }

      return await aiBinding.run(route.modelName, runOptions);
    } finally {
      // Lease release happens when the actual worker task resolves or fails
      activeWorkersAiInFlight = Math.max(0, activeWorkersAiInFlight - 1);
    }
  })();

  try {
    const aiResult: any = await Promise.race([
      underlyingRunPromise,
      timeoutPromise,
    ]);

    // Validate response payload type: accepts string or parsed JSON object from Workers AI JSON Mode
    const rawResponse = aiResult?.response;
    let contentString: string;
    if (typeof rawResponse === 'string') {
      contentString = rawResponse;
    } else if (rawResponse !== null && typeof rawResponse === 'object') {
      contentString = JSON.stringify(rawResponse);
    } else {
      return {
        success: false,
        statusCode: 502,
        error: 'Workers AI returned non-string and non-object response payload',
      };
    }

    const promptTokens = aiResult?.usage?.prompt_tokens ?? Math.max(1, Math.ceil(userMsg.length / 4));
    const completionTokens = aiResult?.usage?.completion_tokens ?? Math.max(1, Math.ceil(contentString.length / 4));
    const finishReason = aiResult?.finish_reason || 'stop';

    const syntheticResponse: OpenAIChatResponse = {
      id: `cf-ai-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: route.modelName,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: contentString,
          },
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };

    return {
      success: true,
      statusCode: 200,
      data: syntheticResponse,
    };
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return {
      success: false,
      statusCode: isTimeout ? 408 : 500,
      error: isTimeout ? `Workers AI timeout after ${timeoutMs}ms` : 'Workers AI execution failure',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
