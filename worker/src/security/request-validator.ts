/**
 * Strict Request Validator for OpenAI Chat Translation Requests
 *
 * Invariants: reject stream, bound total chars (2048), strict roles, strict numeric bounds,
 * virtual model whitelist, mandatory SOURCE extraction (b0..b{n-1}), and canonical buildSchema(n)
 * substitution discarding raw client schema ($ref/URLs). Zero error reflection.
 */

import { MAX_POOL_MESSAGE_CHARS } from '../../../src/shared/translation/poolContract';
import { buildSchema, extractSourceObject } from '../../../src/shared/translation/keyedJson';
import { OpenAIChatRequest, OpenAIMessage, ResponseFormat, ResponseFormatJsonSchema } from '../types';
import { InvalidRequestError, PayloadTooLargeError } from './errors';

const VALID_ROLES = new Set(['system', 'user', 'assistant']);
const MAX_MESSAGES_COUNT = 20;
const MIN_MESSAGES_COUNT = 1;
const MAX_TOKENS_LIMIT = 4096;
const ALLOWED_MODELS = new Set([
  'kites-translation',
  'kites-translation-community',
  'gpt-4o-mini', // legacy client alias
]);
const SCHEMA_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validate and sanitize an incoming JSON payload into a strict OpenAIChatRequest.
 *
 * @param raw - The parsed JSON body from readBoundedJsonBody.
 * @returns Sanitized and validated OpenAIChatRequest.
 * @throws InvalidRequestError or PayloadTooLargeError if validation fails.
 */
export function validateChatCompletionRequest(raw: unknown): OpenAIChatRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidRequestError('Request body must be a JSON object', 'invalid_body');
  }

  const input = raw as Record<string, unknown>;

  // 1. Model parameter: strictly bounded to approved virtual models
  if (typeof input.model !== 'string') {
    throw new InvalidRequestError('model parameter is required and must be a string', 'missing_model');
  }
  const trimmedModel = input.model.trim();
  if (!ALLOWED_MODELS.has(trimmedModel)) {
    throw new InvalidRequestError(
      'Unsupported model parameter. Expected kites-translation',
      'invalid_model'
    );
  }

  // 2. Reject stream: true or non-boolean stream
  if (input.stream !== undefined) {
    if (typeof input.stream !== 'boolean') {
      throw new InvalidRequestError('stream parameter must be a boolean', 'invalid_stream');
    }
    if (input.stream === true) {
      throw new InvalidRequestError('Streaming is not supported on this endpoint', 'stream_not_supported');
    }
  }

  // 3. Messages array validation
  const messagesRaw = input.messages;
  if (!Array.isArray(messagesRaw) || messagesRaw.length < MIN_MESSAGES_COUNT) {
    throw new InvalidRequestError('messages array is required and cannot be empty', 'missing_messages');
  }

  if (messagesRaw.length > MAX_MESSAGES_COUNT) {
    throw new InvalidRequestError(
      `Too many messages in request (max ${MAX_MESSAGES_COUNT})`,
      'too_many_messages'
    );
  }

  const validatedMessages: OpenAIMessage[] = [];
  let totalChars = 0;

  for (let i = 0; i < messagesRaw.length; i++) {
    const item = messagesRaw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new InvalidRequestError(`Message at index ${i} must be an object`, 'invalid_message');
    }

    const { role, content } = item as Record<string, unknown>;

    if (typeof role !== 'string' || !VALID_ROLES.has(role)) {
      throw new InvalidRequestError(
        'Invalid message role. Must be system, user, or assistant',
        'invalid_role'
      );
    }

    if (typeof content !== 'string') {
      throw new InvalidRequestError(`Message content at index ${i} must be a string`, 'invalid_content');
    }

    totalChars += content.length;
    validatedMessages.push({
      role: role as 'system' | 'user' | 'assistant',
      content,
    });
  }

  // Enforce max characters ceiling across all messages
  if (totalChars > MAX_POOL_MESSAGE_CHARS) {
    throw new PayloadTooLargeError(
      `Payload exceeds maximum character limit of ${MAX_POOL_MESSAGE_CHARS} characters`,
      'payload_too_large'
    );
  }

  // 4. Strict SOURCE block extraction for community translation pool
  let sourceObj: Record<string, string>;
  try {
    sourceObj = extractSourceObject(validatedMessages);
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : '';
    if (
      rawMsg.includes('canonical contiguous slots') ||
      rawMsg.includes('non-canonical key') ||
      rawMsg.includes('must be a string')
    ) {
      throw new InvalidRequestError(rawMsg, 'invalid_source_slots');
    }
    throw new InvalidRequestError(
      'Request messages must contain a valid SOURCE JSON block',
      'missing_source'
    );
  }

  const sourceKeys = Object.keys(sourceObj);
  if (sourceKeys.length === 0) {
    throw new InvalidRequestError('SOURCE block must contain at least one text slot', 'empty_source');
  }

  // Verify all slots follow canonical sequential numbering: b0, b1, ... b{n-1}
  for (let i = 0; i < sourceKeys.length; i++) {
    const expectedKey = `b${i}`;
    if (typeof sourceObj[expectedKey] !== 'string') {
      throw new InvalidRequestError(
        'SOURCE slots must be sequential strings starting from b0',
        'invalid_source_slots'
      );
    }
  }

  // 5. Strict numeric parameter checks (no type coercion)
  let sanitizedTemperature: number | undefined;
  if (input.temperature !== undefined) {
    if (typeof input.temperature !== 'number' || !Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2) {
      throw new InvalidRequestError('temperature must be a finite number between 0 and 2', 'invalid_temperature');
    }
    sanitizedTemperature = input.temperature;
  }

  let sanitizedMaxTokens: number | undefined;
  if (input.max_tokens !== undefined) {
    if (
      typeof input.max_tokens !== 'number' ||
      !Number.isFinite(input.max_tokens) ||
      !Number.isInteger(input.max_tokens) ||
      input.max_tokens < 1 ||
      input.max_tokens > MAX_TOKENS_LIMIT
    ) {
      throw new InvalidRequestError(
        `max_tokens must be an integer between 1 and ${MAX_TOKENS_LIMIT}`,
        'invalid_max_tokens'
      );
    }
    sanitizedMaxTokens = input.max_tokens;
  }

  // 6. Optional reasoning_effort
  let sanitizedReasoningEffort: 'low' | 'medium' | 'high' | undefined;
  if (input.reasoning_effort !== undefined) {
    if (input.reasoning_effort === 'low' || input.reasoning_effort === 'medium' || input.reasoning_effort === 'high') {
      sanitizedReasoningEffort = input.reasoning_effort;
    } else {
      throw new InvalidRequestError('reasoning_effort must be one of: low, medium, high', 'invalid_reasoning_effort');
    }
  }

  // 7. Optional response_format validation & canonical schema generation
  let sanitizedResponseFormat: ResponseFormat | undefined;
  if (input.response_format !== undefined && input.response_format !== null) {
    if (typeof input.response_format !== 'object' || Array.isArray(input.response_format)) {
      throw new InvalidRequestError('response_format must be an object', 'invalid_response_format');
    }

    const rf = input.response_format as Record<string, unknown>;

    if (rf.type === 'json_object') {
      sanitizedResponseFormat = { type: 'json_object' };
    } else if (rf.type === 'json_schema') {
      const js = rf.json_schema;
      if (!js || typeof js !== 'object' || Array.isArray(js)) {
        throw new InvalidRequestError('json_schema object is required for json_schema response_format', 'invalid_schema');
      }

      const jsObj = js as Record<string, unknown>;
      const rawName = typeof jsObj.name === 'string' ? jsObj.name.trim() : '';
      const sanitizedName = SCHEMA_NAME_REGEX.test(rawName) ? rawName : 'translation_response';

      // Check client schema for hostile injection keys ($ref, $schema, external definitions)
      const clientSchema = jsObj.schema;
      if (clientSchema && typeof clientSchema === 'object' && !Array.isArray(clientSchema)) {
        const cs = clientSchema as Record<string, unknown>;
        if (cs['$ref'] || cs['$schema'] || cs['definitions'] || cs['$defs']) {
          throw new InvalidRequestError(
            'Schema references, definitions, and external URLs are forbidden',
            'hostile_schema'
          );
        }
      }

      // Completely discard any raw untrusted client schema and return canonical buildSchema(n)
      const trustedSchema = buildSchema(sourceKeys.length);

      sanitizedResponseFormat = {
        type: 'json_schema',
        json_schema: {
          name: sanitizedName,
          strict: true,
          schema: trustedSchema,
        },
      } as ResponseFormatJsonSchema;
    } else {
      throw new InvalidRequestError(
        'Unsupported response_format type. Supported types: json_object, json_schema',
        'invalid_response_format'
      );
    }
  }

  // Assemble strictly sanitized request
  const sanitized: OpenAIChatRequest = {
    model: trimmedModel,
    messages: validatedMessages,
    stream: false,
  };

  if (sanitizedTemperature !== undefined) sanitized.temperature = sanitizedTemperature;
  if (sanitizedMaxTokens !== undefined) sanitized.max_tokens = sanitizedMaxTokens;
  if (sanitizedReasoningEffort !== undefined) sanitized.reasoning_effort = sanitizedReasoningEffort;
  if (sanitizedResponseFormat !== undefined) sanitized.response_format = sanitizedResponseFormat;

  return sanitized;
}
