/** Bounded upstream response reading shared by HTTP inference adapters. */
export const MAX_UPSTREAM_RESPONSE_BYTES = 64 * 1024;

/**
 * Read an upstream body within a byte ceiling, cancelling immediately on overflow.
 * @param response - Upstream response whose body remains covered by the fetch abort signal.
 * @param maxBytes - Maximum accepted encoded body size.
 * @returns UTF-8 text without logging provider content.
 */
export async function readUpstreamBody(response: Response, maxBytes = MAX_UPSTREAM_RESPONSE_BYTES): Promise<string> {
  if (!response.body) throw new Error('Missing upstream response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('Upstream response body limit exceeded');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
}

/**
 * Extract only allowlisted provider error signals; never retain raw errors or URLs.
 * @param raw - Bounded upstream error text.
 * @returns Safe classification text understood by the circuit policy.
 */
export function classifyUpstreamError(raw: string): string {
  const signals = [
    'account_deactivated', 'billing_not_active', 'insufficient_funds',
    'credit balance', 'organization_restricted', 'account suspended', 'billing_hard_limit_reached',
    'per second', 'concurrency limit', 'too many concurrent',
  ] as const;
  const normalized = raw.toLowerCase();
  return signals.find((signal) => normalized.includes(signal)) ?? 'upstream_request_failed';
}
