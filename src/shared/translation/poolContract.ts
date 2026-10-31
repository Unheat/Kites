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
