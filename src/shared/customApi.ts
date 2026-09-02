import type { CustomApiConfig } from './types';

const SUPPORTED_PROVIDERS = new Set<CustomApiConfig['provider']>(['openai', 'openai-compatible', 'gemini', 'claude']);

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
  if (config.provider === 'openai-compatible') {
    if (typeof config.baseUrl !== 'string') return undefined;
    const { normalized } = validateCompatibleBaseUrl(config.baseUrl);
    if (!normalized) return undefined;
    return { id: config.id.trim(), provider: config.provider, modelName: config.modelName.trim(), apiKey: config.apiKey.trim(), baseUrl: normalized };
  }
  return { id: config.id.trim(), provider: config.provider as CustomApiConfig['provider'], modelName: config.modelName.trim(), apiKey: config.apiKey.trim() };
}
