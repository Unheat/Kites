import { describe, expect, it } from 'vitest';
import {
  STRUCTURED_OUTPUT_MODES,
  detectStructuredOutputMode,
  isStructuredOutputModeId,
  normalizeCustomApiConfig,
  resolveStructuredOutputMode,
  validateCompatibleBaseUrl,
} from './customApi';

describe('customApi validation', () => {
  it('accepts valid OpenAI, Gemini, and Claude configurations', () => {
    expect(normalizeCustomApiConfig({ id: 'api-1', provider: 'openai', modelName: 'gpt-4o', apiKey: 'key' })).toEqual({
      id: 'api-1', provider: 'openai', modelName: 'gpt-4o', apiKey: 'key',
    });
    expect(normalizeCustomApiConfig({ id: 'api-2', provider: 'gemini', modelName: 'gemini-1.5', apiKey: 'key' })).toEqual({
      id: 'api-2', provider: 'gemini', modelName: 'gemini-1.5', apiKey: 'key',
    });
  });

  it('normalizes trailing slashes and validates compatible URLs', () => {
    expect(validateCompatibleBaseUrl('https://openrouter.ai/api/v1/')).toEqual({ normalized: 'https://openrouter.ai/api/v1' });
    expect(validateCompatibleBaseUrl('http://insecure.example.com')).toHaveProperty('error');
    expect(validateCompatibleBaseUrl('https://user:pass@example.com')).toHaveProperty('error');
    expect(validateCompatibleBaseUrl('http://localhost:8080')).toEqual({ normalized: 'http://localhost:8080' });
  });

  it('rejects malformed configs or unsupported providers', () => {
    expect(normalizeCustomApiConfig(null)).toBeUndefined();
    expect(normalizeCustomApiConfig({ id: '', provider: 'openai', modelName: 'gpt-4o', apiKey: 'key' })).toBeUndefined();
    expect(normalizeCustomApiConfig({ id: 'api-3', provider: 'unsupported', modelName: 'model', apiKey: 'key' })).toBeUndefined();
    expect(normalizeCustomApiConfig({ id: 'api-4', provider: 'openai-compatible', modelName: 'model', apiKey: 'key' })).toBeUndefined();
  });
});

describe('structured output catalog', () => {
  it('exposes only tiers that the worker capability catalog also defines', () => {
    expect(STRUCTURED_OUTPUT_MODES.map((mode) => mode.id)).toEqual(['prompt-only', 'json-object', 'json-schema']);
    expect(isStructuredOutputModeId('json-schema')).toBe(true);
    expect(isStructuredOutputModeId('json_schema')).toBe(false);
    expect(isStructuredOutputModeId(undefined)).toBe(false);
  });

  it('detects a tier per provider without a base URL', () => {
    expect(detectStructuredOutputMode('openai')).toBe('json-schema');
    // Anthropic Messages and Google generateContent carry no response_format in this engine.
    expect(detectStructuredOutputMode('claude')).toBe('prompt-only');
    expect(detectStructuredOutputMode('gemini')).toBe('prompt-only');
    expect(detectStructuredOutputMode('openai-compatible')).toBe('prompt-only');
  });

  it.each([
    ['https://api.groq.com/openai/v1', 'json-schema'],
    ['https://openrouter.ai/api/v1', 'json-schema'],
    ['https://api.mistral.ai/v1', 'json-schema'],
    ['https://api.x.ai/v1', 'json-schema'],
    ['https://api.deepseek.com/v1', 'json-object'],
    ['https://api.novita.ai/v3/openai', 'json-object'],
    // Subdomains inherit the table entry.
    ['https://eu.api.deepseek.com/v1', 'json-object'],
    // Proxies, self-hosted servers, and search endpoints must never be sent response_format.
    ['https://my-proxy.example.com/v1', 'prompt-only'],
    ['http://localhost:11434/v1', 'prompt-only'],
    ['not-a-url', 'prompt-only'],
  ])('detects %s as %s', (baseUrl, expected) => {
    expect(detectStructuredOutputMode('openai-compatible', baseUrl)).toBe(expected);
  });

  it('lets an explicit choice override detection and ignores an invalid stored value', () => {
    // Users may know their host better than the table does, in either direction.
    expect(resolveStructuredOutputMode('openai-compatible', 'https://my-proxy.example.com/v1', 'json-schema')).toBe('json-schema');
    expect(resolveStructuredOutputMode('openai-compatible', 'https://api.groq.com/openai/v1', 'prompt-only')).toBe('prompt-only');
    expect(resolveStructuredOutputMode('openai-compatible', 'https://api.groq.com/openai/v1', 'banana')).toBe('json-schema');
    // Gemini and Claude cannot express the field, so a stored tier is ignored rather than sent.
    expect(resolveStructuredOutputMode('gemini', undefined, 'json-schema')).toBe('prompt-only');
  });

  it('persists an explicit tier but never invents one for incompatible providers', () => {
    expect(normalizeCustomApiConfig({
      id: 'api-5', provider: 'openai-compatible', modelName: 'deepseek-chat', apiKey: 'key',
      baseUrl: 'https://api.deepseek.com/v1', outputMode: 'json-object',
    })).toEqual({
      id: 'api-5', provider: 'openai-compatible', modelName: 'deepseek-chat', apiKey: 'key',
      baseUrl: 'https://api.deepseek.com/v1', outputMode: 'json-object',
    });

    // A retired or hand-edited value is dropped, not trusted and not fatal.
    expect(normalizeCustomApiConfig({
      id: 'api-6', provider: 'openai', modelName: 'gpt-4o', apiKey: 'key', outputMode: 'json_schema',
    })).toEqual({ id: 'api-6', provider: 'openai', modelName: 'gpt-4o', apiKey: 'key' });

    // Configs saved before the field existed keep working unchanged.
    expect(normalizeCustomApiConfig({
      id: 'api-7', provider: 'claude', modelName: 'claude-3', apiKey: 'key', outputMode: 'json-schema',
    })).toEqual({ id: 'api-7', provider: 'claude', modelName: 'claude-3', apiKey: 'key' });
  });
});
