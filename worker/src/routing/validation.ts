/**
 * Validation and Safety Refusal Service
 *
 * Enforces canonical Keyed JSON Protocol validation and explicit terminal refusal handling.
 * Authoritative expected keys are extracted directly from SOURCE messages rather than arbitrary RPC inputs.
 * Ensures dialogue containing words like "as an AI" or "cannot translate" parses normally when properly formatted in JSON.
 */

import { OpenAIChatRequest } from '../types';
import { extractSourceObject, validateKeyedJson, buildSchema } from '../../../src/shared/translation/keyedJson';

/**
 * Anchored formal refusal patterns for non-JSON model prose.
 * Requires both an explicit refusal verb AND a safety/policy reference.
 */
const ANCHORED_FORMAL_REFUSAL_PATTERN =
  /^(?:I (?:cannot|can't|am unable to) (?:fulfill|complete|process|translate|generate|comply))[\s\S]+(?:safety|content|usage|ethical)\s+(?:policy|guidelines|standards)/i;

export interface ValidationResult {
  valid: boolean;
  isTerminalRefusal?: boolean;
  error?: string;
  parsed?: Record<string, string>;
}

/**
 * Derives expected slot keys from SOURCE in messages as the authoritative source of truth.
 *
 * @param request - Incoming chat request.
 * @returns Array of expected slot keys (e.g. ['b0', 'b1']).
 * @throws Error if SOURCE is missing or empty.
 */
export function deriveExpectedKeys(request: OpenAIChatRequest): string[] {
  const sourceObj = extractSourceObject(request.messages);
  const derivedKeys = Object.keys(sourceObj);
  if (derivedKeys.length === 0) {
    throw new Error('Failed to derive expected keys: SOURCE object is empty');
  }
  return derivedKeys;
}

/**
 * Synthesizes standard bounded response_format matching authoritative expected keys.
 *
 * @param request - Original request.
 * @param expectedKeys - Derived keys.
 * @returns Request with verified response_format.
 */
export function ensureRequestResponseFormat(
  request: OpenAIChatRequest,
  expectedKeys: string[]
): OpenAIChatRequest {
  return {
    ...request,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'translation_response',
        strict: true,
        schema: buildSchema(expectedKeys.length),
      },
    },
  };
}

/**
 * Detects whether a non-JSON prose string represents an anchored formal safety refusal.
 *
 * @param text - Raw non-JSON text from model.
 * @returns True if text is a formal policy refusal.
 */
export function isNonJsonSafetyRefusal(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return ANCHORED_FORMAL_REFUSAL_PATTERN.test(text.trim());
}

/**
 * Validates model completion output against expected slot keys.
 * Evaluates Keyed JSON protocol FIRST so that legitimate speech bubble dialogue is not falsely flagged.
 *
 * @param rawContent - Raw text output from model.
 * @param expectedKeys - Expected slot keys.
 * @returns ValidationResult with validity, terminal refusal flag, or parsed record.
 */
export function validateCompletion(
  rawContent: string,
  expectedKeys: string[]
): ValidationResult {
  if (!rawContent || typeof rawContent !== 'string') {
    return {
      valid: false,
      error: 'Empty or non-string completion received from upstream model',
    };
  }

  // 1. Attempt Keyed JSON validation FIRST
  try {
    const parsed = validateKeyedJson(rawContent, expectedKeys);

    // Reject if all translated values are empty
    const allEmpty = expectedKeys.length > 0 && expectedKeys.every((k) => (parsed[k] || '').trim() === '');
    if (allEmpty) {
      return {
        valid: false,
        error: 'Model output contains only empty strings for all expected slots',
      };
    }

    return {
      valid: true,
      parsed,
    };
  } catch (err: unknown) {
    // 2. If JSON parsing failed, check if the raw non-JSON text was a formal safety refusal
    if (isNonJsonSafetyRefusal(rawContent)) {
      return {
        valid: false,
        isTerminalRefusal: true,
        error: 'Upstream model formally refused request due to content safety policy',
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: `Output failed Keyed JSON validation: ${message}`,
    };
  }
}
