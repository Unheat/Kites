import { describe, it, expect } from 'vitest';
import { deriveExpectedKeys, validateCompletion, ensureRequestResponseFormat } from '../src/routing/validation';
import { OpenAIChatRequest } from '../src/types';

describe('Keyed JSON Protocol & Validation Service', () => {
  const expectedKeys = ['b0', 'b1'];

  it('validates canonical Keyed JSON output', () => {
    const raw = '{"b0":"Hello","b1":"World"}';
    const res = validateCompletion(raw, expectedKeys);
    expect(res.valid).toBe(true);
    expect(res.parsed).toEqual({ b0: 'Hello', b1: 'World' });
  });

  it('permits complete markdown fences around Keyed JSON', () => {
    const raw = '```json\n{"b0":"Hello","b1":"World"}\n```';
    const res = validateCompletion(raw, expectedKeys);
    expect(res.valid).toBe(true);
    expect(res.parsed?.b0).toBe('Hello');
  });

  it('does NOT falsely flag legitimate dialogue containing refusal phrases inside valid JSON', () => {
    // A manga character speaking: "I cannot translate this ancient tome!"
    const raw = '{"b0":"I cannot translate this ancient tome!","b1":"As an AI, I must warn you."}';
    const res = validateCompletion(raw, expectedKeys);
    expect(res.valid).toBe(true);
    expect(res.isTerminalRefusal).toBeFalsy();
    expect(res.parsed?.b0).toBe('I cannot translate this ancient tome!');
    expect(res.parsed?.b1).toBe('As an AI, I must warn you.');
  });

  it('flags formal anchored non-JSON prose safety refusal as terminal refusal', () => {
    const rawRefusal = 'I cannot fulfill this request because it violates our content safety policy.';
    const res = validateCompletion(rawRefusal, expectedKeys);
    expect(res.valid).toBe(false);
    expect(res.isTerminalRefusal).toBe(true);
    expect(res.error).toContain('safety policy');
  });

  it('rejects output missing required keys', () => {
    const raw = '{"b0":"Hello"}'; // missing b1
    const res = validateCompletion(raw, expectedKeys);
    expect(res.valid).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('rejects output with extra unexpected keys', () => {
    const raw = '{"b0":"Hello","b1":"World","extra":"Spam"}';
    const res = validateCompletion(raw, expectedKeys);
    expect(res.valid).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('rejects output where all slot values are empty strings', () => {
    const raw = '{"b0":"   ","b1":""}';
    const res = validateCompletion(raw, expectedKeys);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('empty');
  });

  it('authoritatively extracts expected keys from SOURCE message turn', () => {
    const req: OpenAIChatRequest = {
      model: 'kites',
      messages: [
        { role: 'system', content: 'You are a translator.' },
        { role: 'user', content: 'Translate SOURCE.\n\nSOURCE:\n{"b0":"初めまして","b1":"よろしく"}' },
      ],
    };

    const keys = deriveExpectedKeys(req);
    expect(keys).toEqual(['b0', 'b1']);

    const structured = ensureRequestResponseFormat(req, keys);
    expect(structured.response_format?.type).toBe('json_schema');
    if (structured.response_format?.type === 'json_schema') {
      expect(structured.response_format.json_schema.name).toBe('translation_response');
    }
  });
});
