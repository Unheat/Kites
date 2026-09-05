/**
 * Google Gemini REST Adapter
 * 
 * Invokes generativelanguage.googleapis.com and formats into OpenAI Chat Response.
 */

import { ProviderRouteConfig } from '../config/providers';
import { OpenAIChatRequest, OpenAIChatResponse } from '../types';
import { AdapterExecutionResult } from './openai-compatible';

export async function executeGemini(
  route: ProviderRouteConfig,
  request: OpenAIChatRequest,
  apiKey: string,
  timeoutMs: number
): Promise<AdapterExecutionResult> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${route.modelName}:generateContent?key=${apiKey}`;

  // Convert OpenAI messages to Gemini contents structure
  const contents = request.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = JSON.stringify({
    contents,
    generationConfig: {
      temperature: request.temperature ?? 0.1,
      maxOutputTokens: request.max_tokens ?? 1024,
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        statusCode: response.status,
        error: `Gemini API error (HTTP ${response.status}): ${errorText.slice(0, 300)}`,
        retryAfterSeconds: response.status === 429 ? 60 : undefined,
      };
    }

    const data = (await response.json()) as any;
    // Extract and concatenate all non-thought text parts per official Google docs
    const candidateParts = data?.candidates?.[0]?.content?.parts || [];
    const nonThoughtText = candidateParts
      .filter((part: any) => !part.thought && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('');

    // Fallback in the rare case where only thought parts exist
    const translatedText = nonThoughtText || candidateParts[candidateParts.length - 1]?.text || '';

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
            content: translatedText,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
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
      error: isTimeout ? `Gemini timeout after ${timeoutMs}ms` : (err?.message || 'Gemini error'),
    };
  }
}
