/**
 * Google Gemini REST Adapter
 *
 * Invokes generativelanguage.googleapis.com using x-goog-api-key header and formats into OpenAI Chat Response.
 * Filters out thought/reasoning segments, detects promptFeedback and candidate finishReason safety refusals first,
 * fails closed on unknown or missing finishReason, bounds response body to 64KB, and sanitizes errors.
 */

import { ProviderRouteConfig } from '../config/providers';
import { OpenAIChatRequest, OpenAIChatResponse } from '../types';
import { AdapterExecutionResult, parseRetryAfter } from './openai-compatible';
import { readUpstreamBody, MAX_UPSTREAM_RESPONSE_BYTES } from './responseBody';

const MAX_RESPONSE_BYTES = MAX_UPSTREAM_RESPONSE_BYTES; // 64 KB maximum response body guard

/**
 * Normalizes Google Gemini candidate finishReason to standard OpenAI finish_reason.
 * Fails closed by returning null for missing or unknown finish reasons.
 *
 * @param geminiReason - Finish reason string from Gemini API.
 * @returns Standard finish reason or null if unrecognized.
 */
function normalizeFinishReason(geminiReason?: string): string | null {
  switch (geminiReason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
    case 'IMAGE_SAFETY':
      return 'content_filter';
    default:
      return null;
  }
}

/**
 * Execute a chat completion request against Google Gemini's generateContent REST API.
 *
 * @param route - Provider route configuration containing the Gemini model name.
 * @param request - OpenAI-compatible chat completion request.
 * @param apiKey - Google Gemini API key passed via x-goog-api-key header.
 * @param timeoutMs - Maximum allowed duration for the HTTP call in milliseconds.
 * @returns AdapterExecutionResult containing success status, status code, and parsed response or error.
 */
export async function executeGemini(
  route: ProviderRouteConfig,
  request: OpenAIChatRequest,
  apiKey: string,
  timeoutMs: number
): Promise<AdapterExecutionResult> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${route.modelName}:generateContent`;

  const systemMsg = request.messages.find((m) => m.role === 'system');
  const nonSystemMsgs = request.messages.filter((m) => m.role !== 'system');

  const contents = nonSystemMsgs.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const generationConfig: Record<string, unknown> = {
    temperature: request.temperature ?? 0.1,
    maxOutputTokens: request.max_tokens ?? 1024,
  };

  // Structured output support: only configure schema when route capability is json-schema
  if (route.outputCapability === 'json-schema' && request.response_format?.type === 'json_schema') {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseJsonSchema = request.response_format.json_schema.schema;
  }

  const bodyObj: Record<string, unknown> = {
    contents,
    generationConfig,
  };

  if (systemMsg) {
    bodyObj.systemInstruction = {
      parts: [{ text: systemMsg.content }],
    };
  }

  const body = JSON.stringify(bodyObj);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
      return {
        success: false,
        statusCode: response.status,
        error: `Gemini API returned HTTP status ${response.status}`,
        retryAfterSeconds: retryAfter ?? (response.status === 429 ? 60 : undefined),
      };
    }

    // Guard response body size before parsing
    let responseText: string;
    try {
      responseText = await readUpstreamBody(response, MAX_RESPONSE_BYTES);
    } catch {
      return {
        success: false,
        statusCode: 502,
        error: `Gemini response exceeded maximum body guard (${MAX_RESPONSE_BYTES} bytes)`,
      };
    }

    const data = JSON.parse(responseText) as any;

    // 1. Detect promptFeedback safety block reason FIRST (terminal refusal)
    if (data?.promptFeedback?.blockReason) {
      return {
        success: false,
        statusCode: 400,
        isTerminalRefusal: true,
        error: `Gemini prompt blocked due to safety policy (${data.promptFeedback.blockReason})`,
      };
    }

    const candidate = data?.candidates?.[0];

    // 2. Detect candidate-level finishReason safety refusal FIRST
    const rawFinishReason = candidate?.finishReason;
    const normalizedFinish = normalizeFinishReason(rawFinishReason);

    if (normalizedFinish === 'content_filter') {
      return {
        success: false,
        statusCode: 400,
        isTerminalRefusal: true,
        error: `Gemini candidate generation refused by content safety filter (${rawFinishReason})`,
      };
    }

    // Fail closed if finishReason is missing or unknown
    if (!normalizedFinish) {
      return {
        success: false,
        statusCode: 502,
        error: `Gemini candidate returned unrecognized finishReason: ${rawFinishReason || 'missing'}`,
      };
    }

    // 3. Extract and filter parts
    const candidateParts = candidate?.content?.parts || [];
    const nonThoughtParts = candidateParts.filter(
      (part: any) => !part.thought && typeof part.text === 'string'
    );
    const nonThoughtText = nonThoughtParts.map((part: any) => part.text).join('').trim();

    if (!nonThoughtText) {
      const hasThoughtOnly = candidateParts.some((part: any) => part.thought);
      return {
        success: false,
        statusCode: 502,
        error: hasThoughtOnly
          ? 'Gemini returned only thought reasoning parts with no final translation text'
          : 'Gemini returned empty candidate content parts',
      };
    }

    const promptTokens = data?.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = data?.usageMetadata?.candidatesTokenCount ?? 0;
    const totalTokens = data?.usageMetadata?.totalTokenCount ?? (promptTokens + completionTokens);

    const syntheticResponse: OpenAIChatResponse = {
      id: `gemini-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: route.modelName,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: nonThoughtText,
          },
          finish_reason: normalizedFinish,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
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
      error: isTimeout ? `Gemini timeout after ${timeoutMs}ms` : 'Gemini connection error',
    };
  } finally {
    clearTimeout(timer);
  }
}
