/**
 * keyedJson.ts
 *
 * Core Keyed JSON Protocol validation and extraction utilities for translation pipelines.
 * Platform-independent: no Chrome or DOM dependencies.
 * Safe for use in browser extensions, web workers, and Cloudflare Workers.
 */

/** Maximum slots allowed in a single translation schema or batch */
export const MAX_KEYED_SLOT_COUNT = 100;

/** In-memory cache for compiled JSON schemas across standard batch sizes (1..100) */
const SCHEMA_CACHE = new Map<number, Record<string, unknown>>();

/**
 * Builds strict JSON schema for a fixed number of keyed slots (b0, b1, ... b{slotCount-1}).
 * Used by XGrammar in WebLLM and structured-output endpoints (Cloudflare, OpenAI) to enforce exact keys.
 * Memoized via SCHEMA_CACHE to avoid object allocation and GC churn per batch.
 *
 * @param slotCount - Number of slots in the batch (must be integer between 0 and 100).
 * @returns JSON schema object with required properties and additionalProperties: false.
 * @throws Error if slotCount is not an integer within [0, MAX_KEYED_SLOT_COUNT].
 */
export function buildSchema(slotCount: number): Record<string, unknown> {
  if (!Number.isInteger(slotCount) || slotCount < 0 || slotCount > MAX_KEYED_SLOT_COUNT) {
    throw new Error(`Invalid slotCount: must be an integer between 0 and ${MAX_KEYED_SLOT_COUNT}`);
  }

  const cached = SCHEMA_CACHE.get(slotCount);
  if (cached) return cached;

  const properties: Record<string, { type: 'string' }> = {};
  const required: string[] = [];

  for (let i = 0; i < slotCount; i++) {
    const key = `b${i}`;
    properties[key] = { type: 'string' };
    required.push(key);
  }

  const schema = {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
  SCHEMA_CACHE.set(slotCount, schema);
  return schema;
}

/**
 * Extracts and parses the SOURCE JSON object embedded within a structured chat messages array.
 * Strictly requires the 'SOURCE:' marker in a message with role 'user'.
 * Validates canonical contiguous keys (b0..b{N-1}) within allowable bounds without prototype pollution.
 * Robust against trailing glossary directives, escape sequences, and punctuation/braces within text.
 *
 * @param messages - Array of structured ChatMessage turns.
 * @returns Parsed mapping of slot keys to original source text strings with null prototype.
 * @throws Error on missing user message, missing SOURCE marker, non-contiguous keys, or invalid JSON.
 */
export function extractSourceObject(
  messages: readonly { role: string; content: string }[]
): Record<string, string> {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('Invalid messages payload');
  }

  // Strictly locate user role message containing 'SOURCE:'
  const userMsg = messages.find(
    (m) => m && m.role === 'user' && typeof m.content === 'string' && m.content.includes('SOURCE:')
  );

  if (!userMsg) {
    throw new Error('No user message containing SOURCE: marker found');
  }

  const sourceMarkerIndex = userMsg.content.indexOf('SOURCE:');
  const searchStart = sourceMarkerIndex + 'SOURCE:'.length;
  const startIndex = userMsg.content.indexOf('{', searchStart);

  if (startIndex === -1) {
    throw new Error('SOURCE: marker is not followed by a JSON object');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let endIndex = -1;

  for (let i = startIndex; i < userMsg.content.length; i++) {
    const char = userMsg.content[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }
  }

  if (endIndex === -1 || depth !== 0) {
    throw new Error('Unterminated JSON object in SOURCE message');
  }

  const jsonSubstring = userMsg.content.slice(startIndex, endIndex + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSubstring);
  } catch {
    // Generic error to prevent leaking raw OCR/payload snippets from Node 20+ JSON.parse errors
    throw new Error('Failed to parse SOURCE JSON: syntax error');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SOURCE JSON must be a non-null object');
  }

  const parsedObj = parsed as Record<string, unknown>;
  const keys = Object.keys(parsedObj);
  const slotCount = keys.length;

  if (slotCount > MAX_KEYED_SLOT_COUNT) {
    throw new Error('SOURCE slot count exceeds maximum allowable limit');
  }

  // Validate non-canonical keys
  for (const k of keys) {
    if (!/^b\d+$/.test(k)) {
      throw new Error('SOURCE JSON contains non-canonical key');
    }
  }

  const result: Record<string, string> = Object.create(null);

  // Strictly enforce canonical contiguous keys: b0, b1, ..., b{slotCount-1}
  for (let i = 0; i < slotCount; i++) {
    const expectedKey = `b${i}`;
    if (!Object.prototype.hasOwnProperty.call(parsedObj, expectedKey)) {
      throw new Error('SOURCE JSON keys must be canonical contiguous slots starting at b0');
    }
    const val = parsedObj[expectedKey];
    if (typeof val !== 'string') {
      throw new Error('SOURCE slot value must be a string');
    }
    result[expectedKey] = val;
  }

  return result;
}

/**
 * Validates raw model completion output against the strict Keyed JSON Protocol.
 * Requires an exact match against expectedKeys with no missing, extra, or non-string keys.
 * Rejects empty or whitespace-only translations for expected slots.
 * Permits complete markdown code fences (```json or bare ```) but forbids unclosed fences and prose salvage.
 * Strips leading thought block outside JSON without corrupting <think> inside JSON string values.
 *
 * @param raw - Raw string completion returned from the LLM or translation API.
 * @param expectedKeys - Readonly list of slot keys expected to be present in the output.
 * @returns Validated Record mapping slot keys to translated strings with null prototype.
 * @throws Error if output contains invalid JSON, unclosed fences, prose salvage, missing/extra keys, empty values, or wrong types.
 */
export function validateKeyedJson(
  raw: string,
  expectedKeys: readonly string[]
): Record<string, string> {
  if (typeof raw !== 'string') {
    throw new Error('Model output must be a string');
  }

  // 1. Strip leading complete thought block outside the JSON if present
  let clean = raw.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '').trim();

  // 2. Handle markdown code fences: only bare ``` or ```json are allowed
  if (clean.startsWith('```')) {
    const fenceMatch = clean.match(/^```([a-zA-Z0-9_-]*)\s*([\s\S]*?)\s*```$/);
    if (!fenceMatch) {
      throw new Error('Malformed or disallowed code fence in model output');
    }
    const lang = fenceMatch[1].trim().toLowerCase();
    if (lang !== '' && lang !== 'json') {
      throw new Error('Malformed or disallowed code fence in model output');
    }
    clean = fenceMatch[2].trim();
  }

  // 3. Strict check: forbid leading prose salvage
  if (!clean.startsWith('{')) {
    throw new Error('Model output does not begin with JSON object (prose salvage forbidden)');
  }

  // 4. Parse JSON with generic error (no payload snippet leakage)
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error('Invalid JSON in model output: syntax error');
  }

  // 5. Verify non-null object (not array)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model output must be a JSON object');
  }

  const parsedObj = parsed as Record<string, unknown>;
  const parsedKeys = Object.keys(parsedObj);
  const expectedSet = new Set(expectedKeys);

  if (parsedKeys.length !== expectedKeys.length) {
    throw new Error('Model output slot count does not match expected keys');
  }

  const result: Record<string, string> = Object.create(null);

  // 6. Verify all expected keys are present, types are string, and values are non-empty
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(parsedObj, key)) {
      throw new Error('Missing required slot key in model output');
    }
    const value = parsedObj[key];
    if (typeof value !== 'string') {
      throw new Error('Slot value must be a string in model output');
    }
    if (value.trim().length === 0) {
      throw new Error('Slot value in model output must not be empty or whitespace-only');
    }
    result[key] = value;
  }

  // 7. Verify no unexpected extra keys
  for (const key of parsedKeys) {
    if (!expectedSet.has(key)) {
      throw new Error('Unexpected extra slot key in model output');
    }
  }

  return result;
}
