/**
 * Generic OpenAI-Compatible Adapter
 * 
 * Used for NVIDIA Build, OpenRouter, Groq, and standard OpenAI endpoints.
 */

import { ProviderRouteConfig } from '../config/providers';
import { OpenAIChatRequest, OpenAIChatResponse } from '../types';

export interface AdapterExecutionResult {
  success: boolean;
  statusCode: number;
  data?: OpenAIChatResponse;
  error?: string;
  retryAfterSeconds?: number;
}

/**
 * Execute a chat completion request against any OpenAI-compatible HTTP endpoint
 * (such as NVIDIA Build, OpenRouter, Groq, or OpenAI).
 *
 * @param route - Provider route configuration containing baseUrl, modelName, and customHeaders.
 * @param request - OpenAI-compatible chat completion request payload.
 * @param apiKey - Upstream API authentication bearer token.
 * @param timeoutMs - Maximum allowed duration for the HTTP call in milliseconds before aborting.
 * @returns An AdapterExecutionResult containing success status, HTTP status, and parsed response or error.
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

  const body = JSON.stringify({
    model: route.modelName,
    messages: request.messages,
    temperature: request.temperature ?? 0.1,
    max_tokens: request.max_tokens ?? 1024,
    stream: false,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

      return {
        success: false,
        statusCode: response.status,
        error: `Provider ${route.name} error (HTTP ${response.status}): ${errorText.slice(0, 300)}`,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
      };
    }

    const data = (await response.json()) as OpenAIChatResponse;
    return {
      success: true,
      statusCode: 200,
      data,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err?.name === 'AbortError';
    return {
      success: false,
      statusCode: isTimeout ? 408 : 500,
      error: isTimeout ? `Timeout after ${timeoutMs}ms` : (err?.message || 'Network error'),
    };
  }
}
