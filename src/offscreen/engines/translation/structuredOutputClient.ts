/**
 * structuredOutputClient.ts
 *
 * Raw OpenAI-shaped chat-completions transport used when a custom API profile asks for
 * structured output.
 *
 * The Vercel AI SDK path cannot carry a caller-supplied strict schema through every
 * OpenAI-compatible host, while `response_format` is plain JSON on the wire. Sending the body
 * ourselves keeps the request identical to what `CloudflareTranslateEngine` already proves
 * works, and keeps the tier visible in one place instead of hidden inside a provider client.
 */

import { createJsonSchemaResponseFormat } from '../../../shared/translation/poolContract';
import type { StructuredOutputModeId } from '../../../shared/customApi';

/** Maximum characters of an upstream error message kept for logs and UI error copy. */
const ERROR_DETAIL_CLIP_CHARS = 300;

/** One chat-completions request for the structured-output transport. */
export interface StructuredChatRequest {
  /** Normalized API root without a trailing slash, e.g. `https://api.openai.com/v1`. */
  root: string;
  /** Bearer credential for the configured endpoint. */
  apiKey: string;
  /** Provider model identifier. */
  model: string;
  /** Assembled chat turns (system + user). */
  messages: ReadonlyArray<{ role: string; content: string }>;
  /** Tier to request; already resolved from the profile. */
  mode: StructuredOutputModeId;
  /** Strict keyed schema for the batch slots (b0..bN). */
  schema: Record<string, unknown>;
  /** Completion token ceiling for this batch; omitted from the body when undefined. */
  maxTokens?: number;
  /** OpenRouter needs this flag or it may route to a backend that ignores the schema. */
  requireSchemaParameters: boolean;
  /** Optional caller cancellation signal. */
  signal?: AbortSignal;
}

/** Parsed pieces of a chat-completions reply that the engine reacts to. */
export interface StructuredChatReply {
  /** Assistant message content, guaranteed to be a non-empty string. */
  text: string;
  /** Upstream finish reason (`stop`, `length`, `content_filter`, ...). */
  finishReason: string;
}

/**
 * Raised when an endpoint rejects the structured-output request itself (HTTP 400).
 *
 * Distinguishing this from credential/rate/transport failures matters: only a rejection may be
 * answered by retrying without `response_format`, because the endpoint is telling us the
 * parameter is unsupported rather than that the request failed.
 */
export class StructuredOutputUnsupportedError extends Error {
  /** Upstream HTTP status code; always 400 for this error type. */
  readonly status = 400;

  /**
   * Creates the degradation-triggering error.
   *
   * @param detail - Upstream error message, already clipped.
   */
  constructor(detail: string) {
    super(detail);
    this.name = 'StructuredOutputUnsupportedError';
  }
}

/**
 * Raised for any non-400 upstream HTTP failure.
 *
 * The status is carried as a property so the engine's retry classifier can treat 408/429/5xx as
 * transient without parsing the message string.
 */
export class CustomApiHttpError extends Error {
  /** Upstream HTTP status code. */
  readonly status: number;

  /**
   * Creates the error from an upstream response.
   *
   * @param status - Upstream HTTP status code.
   * @param detail - Clipped upstream error message.
   */
  constructor(status: number, detail: string) {
    super(`Custom API request failed (${status}): ${detail}`);
    this.name = 'CustomApiHttpError';
    this.status = status;
  }
}

/**
 * Builds the chat-completions body for a structured request.
 *
 * `temperature` is deliberately omitted: several reasoning models answer 400 to any explicit
 * sampling temperature, and manga translation wants deterministic output anyway.
 *
 * @param request - Request parts to serialize.
 * @returns Request body with the tier's `response_format` applied.
 */
export function buildStructuredChatBody(request: Omit<StructuredChatRequest, 'root' | 'apiKey' | 'signal'>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: false,
  };
  if (request.maxTokens !== undefined) {
    body.max_tokens = request.maxTokens;
  }

  switch (request.mode) {
    case 'json-schema':
      body.response_format = createJsonSchemaResponseFormat(request.schema);
      if (request.requireSchemaParameters) {
        // OpenRouter only guarantees the downstream backend honors response_format when this is set.
        body.provider = { require_parameters: true };
      }
      return body;
    case 'json-object':
      body.response_format = { type: 'json_object' };
      return body;
    case 'prompt-only':
      // Only the token ceiling and messages are sent; some endpoints hard-reject response_format.
      return body;
    default: {
      const unreachable: never = request.mode;
      throw new Error(`Unsupported structured output mode: ${String(unreachable)}`);
    }
  }
}

/**
 * Parses and validates a chat-completions reply body.
 *
 * Fails fast on malformed shapes instead of returning a silent empty string, because an empty
 * translation set would otherwise look like "the model translated nothing".
 *
 * @param payload - Parsed JSON response body.
 * @returns Assistant text and finish reason.
 * @throws Error when the body shape is not a chat completion or content is missing/empty.
 */
export function parseStructuredChatReply(payload: unknown): StructuredChatReply {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Custom API response was not a JSON object.');
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('Custom API response contained no completion choices.');
  }
  const choice = choices[0] as { message?: { content?: unknown }; finish_reason?: unknown };
  const content = choice?.message?.content;
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : 'unknown';

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(
      `Custom API response did not contain message content (finish_reason: ${finishReason}).`
    );
  }
  return { text: content, finishReason };
}

/**
 * Clips an upstream error body down to a log-safe, single-line detail string.
 *
 * @param response - Failed HTTP response.
 * @returns Clipped upstream message, or the status text when the body is unusable.
 */
async function readErrorDetail(response: Response): Promise<string> {
  let raw = '';
  try {
    raw = await response.text();
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown } };
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, ERROR_DETAIL_CLIP_CHARS);
  } catch {
    // Body was not JSON; fall through to the raw text.
  }
  const detail = raw.trim().replace(/\s+/g, ' ').slice(0, ERROR_DETAIL_CLIP_CHARS);
  return detail || response.statusText || `HTTP ${response.status}`;
}

/**
 * Sends one chat-completions request that carries the resolved `response_format`.
 *
 * @param request - Fully resolved request parts.
 * @returns Assistant completion text plus finish reason.
 * @throws StructuredOutputUnsupportedError on HTTP 400 so the caller can degrade the tier.
 * @throws Error on malformed payloads, network failures, and all other HTTP statuses.
 */
export async function requestStructuredChatCompletion(request: StructuredChatRequest): Promise<StructuredChatReply> {
  const body = buildStructuredChatBody(request);
  const response = await fetch(`${request.root}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${request.apiKey}`,
      'HTTP-Referer': 'https://kites.ai',
      'X-Title': 'Kites Manga Translator',
    },
    body: JSON.stringify(body),
    signal: request.signal,
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    if (response.status === 400) {
      throw new StructuredOutputUnsupportedError(detail);
    }
    throw new CustomApiHttpError(response.status, detail);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Custom API response was not valid JSON.');
  }
  return parseStructuredChatReply(payload);
}
