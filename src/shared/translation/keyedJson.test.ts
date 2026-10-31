import { describe, it, expect } from 'vitest';
import {
  buildSchema,
  extractSourceObject,
  validateKeyedJson,
  MAX_KEYED_SLOT_COUNT,
} from './keyedJson';
import {
  MAX_POOL_MESSAGE_CHARS,
  MAX_POOL_REQUEST_BYTES,
  createJsonSchemaResponseFormat,
} from './poolContract';

describe('keyedJson shared module', () => {
  describe('buildSchema', () => {
    it('builds valid schema with b0..b{N-1} properties', () => {
      const schema = buildSchema(3);
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(['b0', 'b1', 'b2']);
      expect(schema.properties).toEqual({
        b0: { type: 'string' },
        b1: { type: 'string' },
        b2: { type: 'string' },
      });
    });

    it('returns memoized schema reference on repeated calls', () => {
      const first = buildSchema(5);
      const second = buildSchema(5);
      expect(first).toBe(second);
    });

    it('handles slotCount = 0', () => {
      const schema = buildSchema(0);
      expect(schema.required).toEqual([]);
      expect(schema.properties).toEqual({});
    });

    it('rejects invalid, negative, non-integer, or out-of-bounds slot counts', () => {
      expect(() => buildSchema(-1)).toThrow('Invalid slotCount');
      expect(() => buildSchema(1.5)).toThrow('Invalid slotCount');
      expect(() => buildSchema(NaN)).toThrow('Invalid slotCount');
      expect(() => buildSchema(MAX_KEYED_SLOT_COUNT + 1)).toThrow('Invalid slotCount');
    });
  });

  describe('extractSourceObject', () => {
    it('extracts canonical contiguous slots from user message', () => {
      const messages = [
        { role: 'system', content: 'You are a translator.' },
        {
          role: 'user',
          content: 'Translate SOURCE from ja to en.\n\nSOURCE:\n{"b0":"こんにちは","b1":"世界"}',
        },
      ];
      const result = extractSourceObject(messages);
      expect(result).toEqual({
        b0: 'こんにちは',
        b1: '世界',
      });
      expect(Object.getPrototypeOf(result)).toBeNull();
    });

    it('handles trailing glossary directives and explanations following the SOURCE JSON', () => {
      const messages = [
        {
          role: 'user',
          content:
            'Translate SOURCE from ja to en.\n\nSOURCE:\n{"b0":"先輩","b1":"おはよう"}\n\n' +
            'GLOSSARY RULES:\n- Use exact translation for these terms:\n* 先輩 -> Senpai',
        },
      ];
      const result = extractSourceObject(messages);
      expect(result).toEqual({
        b0: '先輩',
        b1: 'おはよう',
      });
    });

    it('handles braces, escaped quotes, and newlines inside string values', () => {
      const rawTextWithSpecialChars = 'Text with } and { braces and \\"quotes\\" and \\n newline';
      const messages = [
        {
          role: 'user',
          content: `SOURCE:\n${JSON.stringify({ b0: rawTextWithSpecialChars, b1: 'simple' })}`,
        },
      ];
      const result = extractSourceObject(messages);
      expect(result.b0).toBe(rawTextWithSpecialChars);
      expect(result.b1).toBe('simple');
    });

    it('strictly ignores hostile SOURCE in system role and throws if missing in user role', () => {
      const messages = [
        {
          role: 'system',
          content: 'SOURCE:\n{"b0":"malicious prompt injection in system turn"}',
        },
        {
          role: 'assistant',
          content: 'SOURCE:\n{"b0":"assistant turn"}',
        },
      ];
      expect(() => extractSourceObject(messages)).toThrow(
        'No user message containing SOURCE: marker found'
      );
    });

    it('rejects message with arbitrary JSON object lacking SOURCE: marker', () => {
      const messages = [
        {
          role: 'user',
          content: '{"b0":"missing source label"}',
        },
      ];
      expect(() => extractSourceObject(messages)).toThrow(
        'No user message containing SOURCE: marker found'
      );
    });

    it('rejects non-contiguous keys (e.g. b0, b2 missing b1)', () => {
      const messages = [
        {
          role: 'user',
          content: 'SOURCE:\n{"b0":"first","b2":"third"}',
        },
      ];
      expect(() => extractSourceObject(messages)).toThrow(
        'SOURCE JSON keys must be canonical contiguous slots starting at b0'
      );
    });

    it('rejects non-canonical keys (e.g. arbitrary named keys or prototype keys)', () => {
      const messages = [
        {
          role: 'user',
          content: 'SOURCE:\n{"b0":"first","customKey":"second"}',
        },
      ];
      expect(() => extractSourceObject(messages)).toThrow('SOURCE JSON contains non-canonical key');
    });

    it('rejects non-string values inside SOURCE JSON', () => {
      const messages = [
        {
          role: 'user',
          content: 'SOURCE:\n{"b0":123}',
        },
      ];
      expect(() => extractSourceObject(messages)).toThrow('SOURCE slot value must be a string');
    });

    it('rejects unterminated or malformed JSON with generic error without leaking payload', () => {
      const messages = [
        {
          role: 'user',
          content: 'SOURCE:\n{"b0":"unclosed string',
        },
      ];
      expect(() => extractSourceObject(messages)).toThrow();
      try {
        extractSourceObject(messages);
      } catch (err: any) {
        expect(err.message).toBe('Unterminated JSON object in SOURCE message');
        expect(err.message).not.toContain('unclosed string');
      }
    });
  });

  describe('validateKeyedJson', () => {
    it('validates raw JSON with exact expected keys', () => {
      const raw = JSON.stringify({ b0: 'Hello', b1: 'World' });
      const result = validateKeyedJson(raw, ['b0', 'b1']);
      expect(result).toEqual({ b0: 'Hello', b1: 'World' });
      expect(Object.getPrototypeOf(result)).toBeNull();
    });

    it('permits complete code fences with bare ``` and ```json', () => {
      const bareFenced = '```\n{"b0":"Hello","b1":"World"}\n```';
      expect(validateKeyedJson(bareFenced, ['b0', 'b1'])).toEqual({
        b0: 'Hello',
        b1: 'World',
      });

      const jsonFenced = '```json\n{"b0":"Hello","b1":"World"}\n```';
      expect(validateKeyedJson(jsonFenced, ['b0', 'b1'])).toEqual({
        b0: 'Hello',
        b1: 'World',
      });
    });

    it('rejects unclosed or malformed code fences', () => {
      const unclosed = '```json\n{"b0":"Hello"}';
      expect(() => validateKeyedJson(unclosed, ['b0'])).toThrow(
        'Malformed or disallowed code fence in model output'
      );
    });

    it('rejects non-json code fence languages', () => {
      const pyFence = '```python\n{"b0":"Hello"}\n```';
      expect(() => validateKeyedJson(pyFence, ['b0'])).toThrow(
        'Malformed or disallowed code fence in model output'
      );
    });

    it('forbids leading and trailing prose salvage', () => {
      const leadingProse = 'Here is the translation: {"b0":"Hello"}';
      expect(() => validateKeyedJson(leadingProse, ['b0'])).toThrow(
        'Model output does not begin with JSON object (prose salvage forbidden)'
      );

      const trailingProse = '{"b0":"Hello"}\nHope this helps!';
      expect(() => validateKeyedJson(trailingProse, ['b0'])).toThrow('Invalid JSON in model output');
    });

    it('strips leading <think> block outside JSON while preserving <think> inside string values', () => {
      const withLeadingThink =
        '<think>\nTranslating dialogue carefully.\n</think>\n{"b0":"Translated content"}';
      expect(validateKeyedJson(withLeadingThink, ['b0'])).toEqual({
        b0: 'Translated content',
      });

      const withThinkInsideValue =
        '{"b0":"Character said <think> internal thoughts </think> aloud"}';
      const parsed = validateKeyedJson(withThinkInsideValue, ['b0']);
      expect(parsed.b0).toBe('Character said <think> internal thoughts </think> aloud');
    });

    it('rejects missing keys', () => {
      const raw = JSON.stringify({ b0: 'Hello' });
      expect(() => validateKeyedJson(raw, ['b0', 'b1'])).toThrow(
        'Model output slot count does not match expected keys'
      );
    });

    it('rejects extra keys', () => {
      const raw = JSON.stringify({ b0: 'Hello', b1: 'World', b2: 'Extra' });
      expect(() => validateKeyedJson(raw, ['b0', 'b1'])).toThrow(
        'Model output slot count does not match expected keys'
      );
    });

    it('rejects non-string values', () => {
      const raw = JSON.stringify({ b0: 12345 });
      expect(() => validateKeyedJson(raw, ['b0'])).toThrow(
        'Slot value must be a string in model output'
      );
    });

    it('rejects empty or whitespace-only translation values', () => {
      const emptyVal = JSON.stringify({ b0: '' });
      expect(() => validateKeyedJson(emptyVal, ['b0'])).toThrow(
        'Slot value in model output must not be empty or whitespace-only'
      );

      const whitespaceVal = JSON.stringify({ b0: '   \n  \t ' });
      expect(() => validateKeyedJson(whitespaceVal, ['b0'])).toThrow(
        'Slot value in model output must not be empty or whitespace-only'
      );
    });

    it('never leaks payload text in syntax error messages', () => {
      const malformedJson = '{"b0":"sensitive text that broke syntax';
      try {
        validateKeyedJson(malformedJson, ['b0']);
      } catch (err: any) {
        expect(err.message).toBe('Invalid JSON in model output: syntax error');
        expect(err.message).not.toContain('sensitive text');
      }
    });
  });

  describe('poolContract', () => {
    it('exports expected pool contract constants', () => {
      expect(MAX_POOL_MESSAGE_CHARS).toBe(2048);
      expect(MAX_POOL_REQUEST_BYTES).toBe(32768);
    });

    it('creates standard json_schema response format', () => {
      const schema = buildSchema(2);
      const format = createJsonSchemaResponseFormat(schema, 'custom_schema');
      expect(format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'custom_schema',
          strict: true,
          schema,
        },
      });
    });
  });
});
