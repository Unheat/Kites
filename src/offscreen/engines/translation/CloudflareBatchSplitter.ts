/**
 * CloudflareBatchSplitter.ts
 *
 * Partitions translation segments into bounded batches that strictly conform
 * to Cloudflare community pool contract limits without dialogue loss.
 */

import type { LlmChatMessage, LlmTranslationSegment } from './BaseLlmTranslationEngine';
import {
  MAX_POOL_MESSAGE_CHARS,
  MAX_POOL_REQUEST_BYTES,
  createJsonSchemaResponseFormat,
} from '../../../shared/translation/poolContract';
import { CLOUDFLARE_TRANSLATE_MODEL } from '../../../shared/constants';
import type { GlossaryEntry } from '../../../shared/glossary';

/**
 * Thrown when a single source segment plus fixed prompt overhead exceeds
 * the community pool message character or serialized byte limits.
 * Allows TranslationManager to catch and cleanly fall back to the next engine in the waterfall.
 */
export class CloudflarePayloadLimitError extends Error {
  readonly code = 'payload_too_large';
  readonly segmentIndex: number;
  readonly chars: number;
  readonly bytes: number;

  constructor(message: string, segmentIndex: number, chars: number, bytes: number) {
    super(message);
    this.name = 'CloudflarePayloadLimitError';
    this.segmentIndex = segmentIndex;
    this.chars = chars;
    this.bytes = bytes;
  }
}

export interface CloudflareSplitterContext {
  sourceLang?: string;
  targetLang?: string;
  glossary?: readonly GlossaryEntry[];
  customPrompt?: string;
}

/**
 * Accurately measures cumulative characters summed across all chat message contents.
 */
export function countMessageChars(messages: readonly LlmChatMessage[]): number {
  return messages.reduce((sum, m) => sum + (m?.content ? m.content.length : 0), 0);
}

/**
 * Measures serialized UTF-8 bytes of a JSON payload.
 */
export function countSerializedBytes(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

/**
 * Splits translation segments into batches compliant with Cloudflare community pool contract:
 * 1. Bubble count <= batchSize
 * 2. Cumulative prompt message characters <= MAX_POOL_MESSAGE_CHARS (2048)
 * 3. Serialized request body bytes <= MAX_POOL_REQUEST_BYTES (32768)
 *
 * If a single segment alone exceeds either ceiling, it throws CloudflarePayloadLimitError
 * rather than truncating dialogue so that TranslationManager waterfall can try the next engine.
 *
 * @param segments - Segments to partition.
 * @param batchSize - Maximum segments per batch.
 * @param buildMessages - Hook to generate structured messages for candidate chunks.
 * @param buildSchemaHook - Hook to build strict JSON schema for chunk slot count.
 * @param context - Optional translation context (language pair, glossary, custom prompt).
 * @returns Array of segmented batches.
 * @throws CloudflarePayloadLimitError if an individual segment alone exceeds pool limits.
 */
export function splitCloudflareBatch(
  segments: LlmTranslationSegment[],
  batchSize: number,
  buildMessages: (
    chunk: LlmTranslationSegment[],
    sourceLang: string,
    targetLang: string,
    glossary: readonly GlossaryEntry[],
    customPrompt?: string
  ) => LlmChatMessage[],
  buildSchemaHook: (slotCount: number) => Record<string, unknown>,
  context?: CloudflareSplitterContext
): LlmTranslationSegment[][] {
  if (segments.length === 0) return [];

  const chunks: LlmTranslationSegment[][] = [];
  let currentChunk: LlmTranslationSegment[] = [];

  const sourceLang = context?.sourceLang || 'auto';
  const targetLang = context?.targetLang || 'en';
  const glossary = context?.glossary || [];
  const customPrompt = context?.customPrompt;

  const buildCandidatePayload = (candidate: LlmTranslationSegment[]) => {
    const messages = buildMessages(candidate, sourceLang, targetLang, glossary, customPrompt);
    const schema = buildSchemaHook(candidate.length);
    const body = {
      model: CLOUDFLARE_TRANSLATE_MODEL,
      messages,
      temperature: 0,
      stream: false,
      response_format: createJsonSchemaResponseFormat(schema),
    };
    return {
      messages,
      totalChars: countMessageChars(messages),
      totalBytes: countSerializedBytes(body),
    };
  };

  for (const segment of segments) {
    const candidateChunk = [...currentChunk, segment];
    const { totalChars, totalBytes } = buildCandidatePayload(candidateChunk);

    const wouldExceedCount = currentChunk.length >= batchSize;
    const wouldExceedChars = totalChars > MAX_POOL_MESSAGE_CHARS;
    const wouldExceedBytes = totalBytes > MAX_POOL_REQUEST_BYTES;

    if (currentChunk.length > 0 && (wouldExceedCount || wouldExceedChars || wouldExceedBytes)) {
      chunks.push(currentChunk);
      currentChunk = [];
    }

    if (currentChunk.length === 0) {
      const singlePayload = buildCandidatePayload([segment]);
      if (
        singlePayload.totalChars > MAX_POOL_MESSAGE_CHARS ||
        singlePayload.totalBytes > MAX_POOL_REQUEST_BYTES
      ) {
        throw new CloudflarePayloadLimitError(
          `Single segment at index ${segment.originalIndex} exceeds Cloudflare pool contract ` +
            `(${singlePayload.totalChars} chars > ${MAX_POOL_MESSAGE_CHARS} or ${singlePayload.totalBytes} bytes > ${MAX_POOL_REQUEST_BYTES}). ` +
            `Routing to fallback engine without dialogue truncation.`,
          segment.originalIndex,
          singlePayload.totalChars,
          singlePayload.totalBytes
        );
      }
      currentChunk.push(segment);
    } else {
      currentChunk.push(segment);
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}
