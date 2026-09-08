/**
 * Cloudflare Workers AI Native Binding Adapter
 * 
 * Invokes native @cf/meta/m2m100-1.2b or text-generation models via env.AI.
 */

import { ProviderRouteConfig } from '../config/providers';
import { OpenAIChatRequest, OpenAIChatResponse } from '../types';
import { AdapterExecutionResult } from './openai-compatible';

/**
 * Execute a translation or text generation request against Cloudflare Workers AI binding.
 * Supports both dedicated translation models (e.g., m2m100) and general LLM text models,
 * wrapping the output into an OpenAI-compatible chat response structure.
 *
 * @param route - Provider route configuration containing the Workers AI model name.
 * @param request - OpenAI-compatible chat request with messages and sampling parameters.
 * @param aiBinding - The Cloudflare Workers AI binding instance (env.AI).
 * @param timeoutMs - Maximum allowed duration for the AI model inference in milliseconds.
 * @returns An AdapterExecutionResult containing success status, status code, and parsed response or error.
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

  // Extract prompt text from last user message
  const userMsg = request.messages.findLast((m) => m.role === 'user')?.content || '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let resultText = '';

    if (route.modelName.includes('m2m100')) {
      // Translation-specific parameter shape for m2m100
      // Default to English target if unspecified
      const aiResult = await aiBinding.run(route.modelName, {
        text: userMsg,
        target_lang: 'en',
      });
      resultText = aiResult?.translated_text || '';
    } else {
      // General LLM prompt shape
      const aiResult = await aiBinding.run(route.modelName, {
        messages: request.messages,
        max_tokens: request.max_tokens ?? 1024,
      });
      resultText = aiResult?.response || '';
    }

    clearTimeout(timer);

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
            content: resultText,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: Math.ceil(userMsg.length / 4),
        completion_tokens: Math.ceil(resultText.length / 4),
        total_tokens: Math.ceil((userMsg.length + resultText.length) / 4),
      },
    };

    return {
      success: true,
      statusCode: 200,
      data: syntheticResponse,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err?.name === 'AbortError';
    return {
      success: false,
      statusCode: isTimeout ? 408 : 500,
      error: isTimeout ? `Workers AI timeout after ${timeoutMs}ms` : (err?.message || 'Workers AI error'),
    };
  }
}
