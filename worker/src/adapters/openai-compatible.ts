/**
 * Generic OpenAI-Compatible Adapter
 *
 * Used for Groq, OpenRouter, Mistral, and standard OpenAI-compatible endpoints.
 * Enforces route-specific structured output formatting, Groq reasoning controls,
 * OpenRouter strict feature-routing flags, 64KB response body bounds, and explicit refusal checks.
 */

import { ProviderRouteConfig } from '../config/providers';
import { OpenAIChatRequest, OpenAIChatResponse } from '../types';
import { readUpstreamBody, MAX_UPSTREAM_RESPONSE_BYTES } from './responseBody';

const MAX_RESPONSE_BYTES = MAX_UPSTREAM_RESPONSE_BYTES; // 64 KB response body guard

export interface AdapterExecutionResult {
  success: boolean;
  statusCode: number;
  data?: OpenAIChatResponse;
  error?: string;
  retryAfterSeconds?: number;
  isTerminalRefusal?: boolean;
}

/**
 * Parses HTTP Retry-After header supporting both delta-seconds (e.g. "120")
 * and RFC 2822 / RFC 7231 HTTP-date formats.
 *
 * @param header - Raw header string from HTTP response.
 * @returns Cooldown duration in integer seconds, or undefined if absent/unparseable.
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;

  const seconds = parseInt(trimmed, 10);
  if (!isNaN(seconds) && /^\d+$/.test(trimmed)) {
    return seconds > 0 ? seconds : undefined;
  }

  const dateParsed = Date.parse(trimmed);
  if (!isNaN(dateParsed)) {
    const diffSec = Math.ceil((dateParsed - Date.now()) / 1000);
    return diffSec > 0 ? diffSec : undefined;
  }

  return undefined;
}

/**
 * Builds the outbound payload for an OpenAI-compatible endpoint respecting provider capabilities
 * and route-specific reasoning controls.
 *
 * @param route - Target provider route configuration.
 * @param request - Inbound translation chat request.
 * @returns JSON-serializable request payload object.
 */
function buildRequestBody(route: ProviderRouteConfig, request: OpenAIChatRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: route.modelName,
    messages: request.messages,
    temperature: request.temperature ?? 0.1,
    max_tokens: request.max_tokens ?? 1024,
    stream: false,
  };

  // Structured output formatting based strictly on provider capabilities catalog
  if (route.outputCapability === 'json-schema') {
    if (request.response_format?.type === 'json_schema') {
      const format = request.response_format;
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: format.json_schema.name,
          strict: true,
          schema: format.json_schema.schema,
        },
      };
    } else {
      payload.response_format = { type: 'json_object' };
    }
  } else if (route.outputCapability === 'json-object') {
    payload.response_format = { type: 'json_object' };
  }

  // Route-specific reasoning controls to prevent token burnout
  if (route.id.startsWith('groq-gpt-oss')) {
    payload.include_reasoning = false;
    payload.reasoning_effort = 'low';
  } else if (route.id.startsWith('groq-qwen')) {
    payload.reasoning_format = 'parsed';
  }

  // OpenRouter strict feature-routing parameter
  if (route.id === 'openrouter-free') {
    payload.provider = { require_parameters: true };
  }

  return payload;
}

/**
 * Execute a chat completion request against any OpenAI-compatible HTTP endpoint.
 *
 * @param route - Provider route configuration containing baseUrl, modelName, and customHeaders.
 * @param request - OpenAI-compatible chat completion request payload.
 * @param apiKey - Upstream API authentication bearer token.
 * @param timeoutMs - Maximum allowed duration for the HTTP call in milliseconds before aborting.
 * @returns AdapterExecutionResult containing success status, HTTP status, and parsed response or error.
 */
export async function executeOpenAICompatible(
  route: ProviderRouteConfig,
  request: OpenAIChatRequest,
  apiKey: string,
  timeoutMs: number
): Promise<AdapterExecutionResult> {
  const endpoint = `${route.baseUrl?.replace(/\/+$/, '')}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    ...(route.customHeaders || {}),
  };

  const body = JSON.stringify(buildRequestBody(route, request));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const retryAfterSeconds = parseRetryAfter(response.headers.get('Retry-After'));
      return {
        success: false,
        statusCode: response.status,
        error: `Provider ${route.name} returned HTTP status ${response.status}`,
        retryAfterSeconds,
      };
    }

    let responseText: string;
    try {
      responseText = await readUpstreamBody(response, MAX_RESPONSE_BYTES);
    } catch {
      return {
        success: false,
        statusCode: 502,
        error: `Response from ${route.name} exceeded maximum body guard (${MAX_RESPONSE_BYTES} bytes)`,
      };
    }

    const data = JSON.parse(responseText) as OpenAIChatResponse;
    const choice = data?.choices?.[0];

    // Detect explicit refusal property or content_filter finish reason
    const refusal = (choice?.message as any)?.refusal;
    if (refusal || choice?.finish_reason === 'content_filter') {
      return {
        success: false,
        statusCode: 400,
        isTerminalRefusal: true,
        error: refusal || `Generation refused by ${route.name} safety policy (content_filter)`,
      };
    }

    return {
      success: true,
      statusCode: 200,
      data,
    };
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return {
      success: false,
      statusCode: isTimeout ? 408 : 500,
      error: isTimeout ? `Timeout after ${timeoutMs}ms` : 'Provider connection error',
    };
  } finally {
    clearTimeout(timer);
  }
}
