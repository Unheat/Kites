import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildStructuredChatBody,
  CustomApiHttpError,
  parseStructuredChatReply,
  requestStructuredChatCompletion,
  StructuredOutputUnsupportedError,
  type StructuredChatRequest,
} from './structuredOutputClient';

const keyedSchema = {
  type: 'object',
  properties: { b0: { type: 'string' } },
  required: ['b0'],
  additionalProperties: false,
};

/**
 * Builds a complete structured request fixture.
 *
 * @param overrides - Request fields to replace.
 * @returns A request ready to hand to the transport.
 */
function createRequest(overrides: Partial<StructuredChatRequest> = {}): StructuredChatRequest {
  return {
    root: 'https://api.groq.com/openai/v1',
    apiKey: 'secret',
    model: 'llama-test',
    messages: [{ role: 'user', content: 'SOURCE:\n{"b0":"hello"}' }],
    mode: 'json-schema',
    schema: keyedSchema,
    maxTokens: 4096,
    requireSchemaParameters: false,
    ...overrides,
  };
}

/**
 * Creates a JSON response with a selected status.
 *
 * @param payload - Body returned by the endpoint.
 * @param status - HTTP status code.
 * @returns A fetch-compatible response.
 */
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Minimal successful chat-completions body matching the keyed protocol. */
const successReply = {
  id: 'chatcmpl-1',
  choices: [{ index: 0, message: { role: 'assistant', content: '{"b0":"bonjour"}' }, finish_reason: 'stop' }],
};

/**
 * Starts a throwaway chat-completions endpoint on an ephemeral localhost port, so the transport
 * is exercised through real sockets instead of a mocked `fetch`.
 *
 * @param status - HTTP status the endpoint answers with.
 * @param reply - Body the endpoint answers with.
 * @returns The API root, every request body it received, and a closer.
 */
async function startLocalEndpoint(
  status: number,
  reply: unknown
): Promise<{ root: string; received: Record<string, unknown>[]; close: () => Promise<void> }> {
  const received: Record<string, unknown>[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      received.push(raw ? JSON.parse(raw) as Record<string, unknown> : {});
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    root: `http://localhost:${port}/v1`,
    received,
    close: () => new Promise((resolve) => {
      // undici keeps sockets alive, so drop them before waiting for the handle to release.
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

describe('structuredOutputClient', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('serializes a strict keyed schema for json-schema mode', () => {
    const body = buildStructuredChatBody(createRequest());
    expect(body).toEqual({
      model: 'llama-test',
      messages: [{ role: 'user', content: 'SOURCE:\n{"b0":"hello"}' }],
      stream: false,
      max_tokens: 4096,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'translation_response', strict: true, schema: keyedSchema },
      },
    });
  });

  it('serializes a bare json_object response_format', () => {
    const body = buildStructuredChatBody(createRequest({ mode: 'json-object' }));
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('omits response_format and the token ceiling when nothing can be sent', () => {
    const body = buildStructuredChatBody(createRequest({ mode: 'prompt-only', maxTokens: undefined }));
    expect(body).not.toHaveProperty('response_format');
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('asks OpenRouter to require downstream schema parameters only for schema requests', () => {
    const schemaBody = buildStructuredChatBody(
      createRequest({ root: 'https://openrouter.ai/api/v1', requireSchemaParameters: true })
    );
    expect(schemaBody.provider).toEqual({ require_parameters: true });

    const objectBody = buildStructuredChatBody(
      createRequest({ mode: 'json-object', requireSchemaParameters: true })
    );
    expect(objectBody).not.toHaveProperty('provider');
  });

  it('posts to the resolved root and returns the assistant text', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(successReply));

    const reply = await requestStructuredChatCompletion(createRequest());

    expect(reply).toEqual({ text: '{"b0":"bonjour"}', finishReason: 'stop' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer secret' }) })
    );
  });

  it('classifies HTTP 400 as an unsupported-parameter rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: { message: 'This response_format type is unavailable now' } }, 400)
    );

    await expect(requestStructuredChatCompletion(createRequest())).rejects.toBeInstanceOf(
      StructuredOutputUnsupportedError
    );
  });

  it('carries non-400 statuses on the thrown error so retries can classify them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: { message: 'upstream down' } }, 503));

    const error = await requestStructuredChatCompletion(createRequest()).catch((caught) => caught);
    expect(error).toBeInstanceOf(CustomApiHttpError);
    expect((error as CustomApiHttpError).status).toBe(503);
    expect((error as CustomApiHttpError).message).toContain('upstream down');
  });

  it('rejects a reply without assistant content instead of returning an empty batch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'length' }] })
    );

    await expect(requestStructuredChatCompletion(createRequest())).rejects.toThrow(/did not contain message content/);
  });

  it('rejects a non-JSON response body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }));

    await expect(requestStructuredChatCompletion(createRequest())).rejects.toThrow(/not valid JSON/);
  });

  it('carries the strict schema to a real endpoint and parses its reply', async () => {
    const endpoint = await startLocalEndpoint(200, successReply);
    try {
      const reply = await requestStructuredChatCompletion(createRequest({ root: endpoint.root }));

      expect(reply).toEqual({ text: '{"b0":"bonjour"}', finishReason: 'stop' });
      expect(endpoint.received).toHaveLength(1);
      expect(endpoint.received[0]).toMatchObject({
        model: 'llama-test',
        max_tokens: 4096,
        stream: false,
        response_format: {
          type: 'json_schema',
          json_schema: { strict: true, schema: keyedSchema },
        },
      });
    } finally {
      await endpoint.close();
    }
  });

  it('classifies a real HTTP 400 rejection from a live endpoint', async () => {
    const endpoint = await startLocalEndpoint(400, { error: { message: 'This response_format type is unavailable now' } });
    try {
      const error = await requestStructuredChatCompletion(createRequest({ root: endpoint.root })).catch((caught) => caught);

      expect(error).toBeInstanceOf(StructuredOutputUnsupportedError);
      expect((error as Error).message).toContain('response_format type is unavailable');
    } finally {
      await endpoint.close();
    }
  });

  it('validates reply shape strictly', () => {
    expect(() => parseStructuredChatReply(null)).toThrow(/not a JSON object/);
    expect(() => parseStructuredChatReply({ choices: [] })).toThrow(/no completion choices/);
    expect(parseStructuredChatReply(successReply)).toEqual({ text: '{"b0":"bonjour"}', finishReason: 'stop' });
  });
});
