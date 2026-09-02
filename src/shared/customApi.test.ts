import { describe, expect, it } from 'vitest';
import { normalizeCustomApiConfig, validateCompatibleBaseUrl } from './customApi';

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
