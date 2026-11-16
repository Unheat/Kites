import type { CustomApiConfig } from './types';

const SUPPORTED_PROVIDERS = new Set<CustomApiConfig['provider']>(['openai', 'openai-compatible', 'gemini', 'claude']);

export {
  STRUCTURED_OUTPUT_MODES,
  isStructuredOutputModeId,
  type StructuredOutputModeId,
} from './translation/outputModes';

import {
  isStructuredOutputModeId,
  type StructuredOutputModeId,
} from './translation/outputModes';

/**
 * Host to structured-output tier table.
 *
 * Only OpenAI-shaped chat-completions endpoints can be given a `response_format`, so this
 * table exists to pick the strongest tier a host is known to accept. Hosts absent from the
 * table (local Ollama/vLLM servers, unknown proxies, search-only endpoints) fall back to
 * `prompt-only` because an unrecognized `response_format` is a hard 400 on those servers.
 */
export const STRUCTURED_OUTPUT_HOST_MODES: ReadonlyArray<{ host: string; mode: StructuredOutputModeId }> = [
  // Native strict json_schema (grammar-constrained decoding).
  { host: 'api.openai.com', mode: 'json-schema' },
  { host: 'openrouter.ai', mode: 'json-schema' },
  { host: 'api.groq.com', mode: 'json-schema' },
  { host: 'api.fireworks.ai', mode: 'json-schema' },
  { host: 'api.together.xyz', mode: 'json-schema' },
  { host: 'api.together.ai', mode: 'json-schema' },
  { host: 'api.mistral.ai', mode: 'json-schema' },
  { host: 'api.cerebras.ai', mode: 'json-schema' },
  { host: 'api.sambanova.ai', mode: 'json-schema' },
  { host: 'api.x.ai', mode: 'json-schema' },
  { host: 'api.studio.nebius.ai', mode: 'json-schema' },
  { host: 'api.deepinfra.com', mode: 'json-schema' },
  // Valid JSON only: these answer 400 to `type: "json_schema"`. DeepSeek documents it as
  // "This response_format type is unavailable now"; Novita rejects it on most models.
  { host: 'api.deepseek.com', mode: 'json-object' },
  { host: 'api.novita.ai', mode: 'json-object' },
  { host: 'api.hyperbolic.xyz', mode: 'json-object' },
  { host: 'api.lepton.ai', mode: 'json-object' },
  // `api.opentyphoon.ai` is intentionally absent: a live probe showed it accepts `response_format`
  // but ignores it entirely, so it must stay on the `prompt-only` fallback. Do not add it here
  // based on a 200 response alone.
];

/**
 * Checks whether a provider's HTTP shape can carry a `response_format` field at all.
 *
 * Anthropic Messages and Google generateContent take provider-specific schema options that this
 * engine does not send, so they are pinned to `prompt-only` rather than advertised as schema-capable.
 *
 * @param provider - Saved provider kind.
 * @returns True for the OpenAI-shaped chat-completions providers.
 */
export function supportsStructuredOutputSelection(provider: CustomApiConfig['provider']): boolean {
  return provider === 'openai' || provider === 'openai-compatible';
}

/**
 * Resolves the structured-output tier a provider would use without an explicit user choice.
 *
 * @param provider - Saved provider kind.
 * @param baseUrl - Optional OpenAI-compatible base URL used for host detection.
 * @returns The detected tier; `prompt-only` when nothing can be proven.
 */
export function detectStructuredOutputMode(
  provider: CustomApiConfig['provider'],
  baseUrl?: string
): StructuredOutputModeId {
  switch (provider) {
    case 'openai':
      return 'json-schema';
    case 'gemini':
    case 'claude':
      return 'prompt-only';
    case 'openai-compatible': {
      if (!baseUrl?.trim()) return 'prompt-only';
      let host: string;
      try {
        host = new URL(baseUrl.trim()).hostname.toLowerCase();
      } catch {
        // A malformed URL cannot be attributed to a known host; the engine rejects it later.
        return 'prompt-only';
      }
      const match = STRUCTURED_OUTPUT_HOST_MODES.find(
        (entry) => host === entry.host || host.endsWith(`.${entry.host}`)
      );
      return match ? match.mode : 'prompt-only';
    }
    default: {
      const unreachable: never = provider;
      throw new Error(`Unsupported Custom API provider: ${String(unreachable)}`);
    }
  }
}

/**
 * Resolves the effective structured-output tier for a saved configuration.
 *
 * An explicit user choice always wins over detection so a user can force `json-schema` on a host
 * the table does not know, or force `prompt-only` on a host whose schema support is broken.
 *
 * @param provider - Saved provider kind.
 * @param baseUrl - Optional OpenAI-compatible base URL.
 * @param explicitMode - Persisted tier choice, if any.
 * @returns The tier the engine must request.
 */
export function resolveStructuredOutputMode(
  provider: CustomApiConfig['provider'],
  baseUrl: string | undefined,
  explicitMode: unknown
): StructuredOutputModeId {
  if (supportsStructuredOutputSelection(provider) && isStructuredOutputModeId(explicitMode)) {
    return explicitMode;
  }
  return detectStructuredOutputMode(provider, baseUrl);
}

/**
 * Validates and normalizes a user-configured OpenAI-compatible API root.
 *
 * @param baseUrl - The API root entered by the user.
 * @returns A normalized API root or an explanatory validation error.
 */
export function validateCompatibleBaseUrl(baseUrl: string): { normalized?: string; error?: string } {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return { error: 'Base URL must be an absolute HTTP(S) URL.' };
  }
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if ((url.protocol !== 'https:' && !(localhost && url.protocol === 'http:')) || url.username || url.password) {
    return { error: 'Base URL must use HTTPS (or HTTP localhost) and cannot contain credentials.' };
  }
  const normalized = url.toString()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '');
  return { normalized };
}

/**
 * Validates a saved custom API configuration without exposing its credential.
 *
 * @param value - Unknown persisted configuration data.
 * @returns A normalized configuration or undefined when it is malformed.
 */
export function normalizeCustomApiConfig(value: unknown): CustomApiConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const config = value as Partial<CustomApiConfig>;
  if (typeof config.id !== 'string' || !config.id.trim() || typeof config.modelName !== 'string' || !config.modelName.trim() || typeof config.apiKey !== 'string' || !config.apiKey.trim() || !SUPPORTED_PROVIDERS.has(config.provider as CustomApiConfig['provider'])) {
    return undefined;
  }
  const customPrompt = typeof config.customPrompt === 'string' && config.customPrompt.trim()
    ? config.customPrompt.trim().slice(0, 4000)
    : undefined;
  const provider = config.provider as CustomApiConfig['provider'];

  // Storage boundary: an unreadable or retired outputMode must be dropped, never trusted,
  // and never allowed to fail the whole configuration read.
  const outputMode = supportsStructuredOutputSelection(provider) && isStructuredOutputModeId(config.outputMode)
    ? config.outputMode
    : undefined;

  if (provider === 'openai-compatible') {
    if (typeof config.baseUrl !== 'string') return undefined;
    const { normalized } = validateCompatibleBaseUrl(config.baseUrl);
    if (!normalized) return undefined;
    return {
      id: config.id.trim(),
      provider,
      modelName: config.modelName.trim(),
      apiKey: config.apiKey.trim(),
      baseUrl: normalized,
      ...(customPrompt ? { customPrompt } : {}),
      ...(outputMode ? { outputMode } : {}),
    };
  }
  return {
    id: config.id.trim(),
    provider,
    modelName: config.modelName.trim(),
    apiKey: config.apiKey.trim(),
    ...(customPrompt ? { customPrompt } : {}),
    ...(outputMode ? { outputMode } : {}),
  };
}
