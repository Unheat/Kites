/**
 * poolContract.ts
 *
 * Shared protocol contract constants and response format types for community translation pool.
 * Platform-independent: no Chrome or DOM dependencies.
 */

/**
 * Maximum allowed cumulative characters summed across all messages (system, user, SOURCE, and glossary)
 * in a single community translation pool request.
 * Client batch splitters ensure that the total sum of `message.content.length` across all request messages <= 2048.
 */
export const MAX_POOL_MESSAGE_CHARS = 2048;

/**
 * Maximum allowed serialized request body size in bytes (32 KB) as defined by the community
 * translation pool local contract budget.
 */
export const MAX_POOL_REQUEST_BYTES = 32768;

/**
 * Maximum completion tokens the translation answer itself may need.
 *
 * A batch carries at most {@link MAX_POOL_MESSAGE_CHARS} characters of source text, so a faithful
 * keyed-JSON translation of it never needs more than this. `maxTokensForBatch` clamps its estimate
 * here. This is the *answer* budget: it deliberately excludes private reasoning, which is granted
 * separately by {@link REASONING_OUTPUT_HEADROOM} so that thinking cannot eat the translation.
 */
export const MAX_POOL_ANSWER_TOKENS = 1024;

/**
 * Private-reasoning allowance added on top of the answer budget for models that think.
 *
 * Reasoning tokens are charged to the same `max_tokens` box as the answer on every
 * OpenAI-compatible endpoint, so a thinking model given only {@link MAX_POOL_ANSWER_TOKENS} can
 * spend it all before emitting anything and return an empty or truncated object. Routes that
 * declare `thinking: true` in the catalog therefore get this much room on top. Unused room is
 * free: providers bill generated tokens, not the ceiling.
 */
export const REASONING_OUTPUT_HEADROOM = 1024;

/**
 * Hard ceiling on completion tokens for any pool request, reasoning included.
 *
 * This is the security bound, not an estimate: the worker request validator rejects anything above
 * it, and every adapter falls back to it when a request omits `max_tokens`. A caller that bypasses
 * the extension and hits the Worker directly can therefore buy at most this much, instead of the
 * upstream model's full 16K (or 128K context) allowance.
 */
export const MAX_POOL_OUTPUT_TOKENS = MAX_POOL_ANSWER_TOKENS + REASONING_OUTPUT_HEADROOM;

/**
 * Resolves the completion-token budget to request for one route.
 *
 * @param answerTokens - Answer budget the caller asked for, or `undefined` for the default.
 * @param thinking - Whether the target route can spend completion tokens on private reasoning.
 * @returns Budget clamped to the answer ceiling, plus reasoning headroom, never above the hard cap.
 */
export function outputBudgetForRoute(answerTokens: number | undefined, thinking: boolean | undefined): number {
  const answer = Math.min(answerTokens ?? MAX_POOL_ANSWER_TOKENS, MAX_POOL_ANSWER_TOKENS);
  const withReasoning = thinking ? answer + REASONING_OUTPUT_HEADROOM : answer;
  return Math.min(withReasoning, MAX_POOL_OUTPUT_TOKENS);
}

/**
 * Standard JSON schema response format matching OpenAI and Cloudflare Worker structured outputs.
 */
export interface JsonSchemaResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
}

/**
 * Creates a standard response_format payload with json_schema for structured output endpoints.
 *
 * @param schema - Strict JSON schema object defining the expected keyed structure.
 * @param name - Identifier for the schema (defaults to 'translation_response').
 * @returns Structured response_format object ready for OpenAI/Cloudflare request bodies.
 */
export function createJsonSchemaResponseFormat(
  schema: Record<string, unknown>,
  name = 'translation_response'
): JsonSchemaResponseFormat {
  return {
    type: 'json_schema',
    json_schema: {
      name,
      strict: true,
      schema,
    },
  };
}
