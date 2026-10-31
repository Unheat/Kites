/**
 * Bounded Body Stream Parser
 *
 * Enforces strict byte limits (default 32 KB) on incoming HTTP request bodies.
 * Streams data with an early-abort reader even if the Content-Length header is
 * omitted or manipulated by malicious clients.
 *
 * CRITICAL: In Node 20+, SyntaxError messages from JSON.parse embed the raw invalid input snippet.
 * To prevent private user OCR text from leaking into logs or client error responses,
 * raw parser errors are caught and transformed into sanitized typed categories.
 */

import { MAX_POOL_REQUEST_BYTES } from '../../../src/shared/translation/poolContract';
import { InvalidJsonError, PayloadTooLargeError } from './errors';

/**
 * Reads and validates an incoming HTTP request body within the specified byte ceiling.
 *
 * @param request - Incoming HTTP Request.
 * @param maxBytes - Maximum allowed payload size in bytes (defaults to MAX_POOL_REQUEST_BYTES = 32768).
 * @returns Parsed JSON body as unknown object.
 * @throws PayloadTooLargeError if body exceeds maxBytes.
 * @throws InvalidJsonError if body is empty or contains malformed JSON.
 */
export async function readBoundedJsonBody(
  request: Request,
  maxBytes = MAX_POOL_REQUEST_BYTES
): Promise<unknown> {
  // 1. Fast pre-check: inspect Content-Length header if present
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
      throw new PayloadTooLargeError(`Request entity too large: max ${maxBytes} bytes.`);
    }
  }

  // 2. Stream-based bounded read: protect against missing/chunked Content-Length
  if (!request.body) {
    throw new InvalidJsonError('Request body cannot be empty');
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel('Payload too large');
          throw new PayloadTooLargeError(`Request entity too large: max ${maxBytes} bytes.`);
        }
        chunks.push(value);
      }
    }
  } catch (err: unknown) {
    if (err instanceof PayloadTooLargeError) {
      throw err;
    }
    throw new InvalidJsonError('Failed reading request body stream');
  }

  if (totalBytes === 0) {
    throw new InvalidJsonError('Request body cannot be empty');
  }

  // Concatenate chunks into a single Uint8Array
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const rawText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(combined);

  // 3. Safe JSON parsing with sanitized error reporting
  try {
    return JSON.parse(rawText);
  } catch {
    // CRITICAL: Do NOT include err.message in error or logs (leaks OCR text in Node 20+)
    throw new InvalidJsonError('Invalid JSON request body');
  }
}
