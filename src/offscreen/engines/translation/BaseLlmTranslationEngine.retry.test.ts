/**
 * BaseLlmTranslationEngine.retry.test.ts
 *
 * Reproduces the "dropped lines" failure measured on a real 16-page run: 26 slots came back
 * untranslated because the model either skipped a key or echoed the source text, and the engine
 * logged the loss instead of recovering it.
 *
 * The guard is behavioural: a scripted model answers the first request badly and the second one
 * well, so these assertions only pass when the engine actually re-asks for the failed slots.
 */

import { describe, expect, it } from 'vitest';
import {
  BaseLlmTranslationEngine,
  MAX_RETRY_REQUESTS,
  MAX_RETRY_SEGMENTS,
  type LlmChatMessage,
} from './BaseLlmTranslationEngine';

/** Engine whose completions come from a script, so a failure can be staged exactly. */
class ScriptedEngine extends BaseLlmTranslationEngine {
  public readonly requests: { messages: LlmChatMessage[] | undefined; maxTokens: number | undefined }[] = [];

  constructor(private readonly script: string[], batchSize = 15) {
    super();
    this.batchSize = batchSize;
  }

  protected async requestLlm(
    _prompt: string,
    messages?: LlmChatMessage[],
    _schema?: Record<string, unknown>,
    _signal?: AbortSignal,
    maxTokens?: number
  ): Promise<string> {
    this.requests.push({ messages, maxTokens });
    return this.script.shift() ?? '{}';
  }
}

/**
 * Reads the SOURCE object out of a request, to prove what the retry actually asked for.
 *
 * @param engine - Engine that recorded its requests.
 * @param index - Request index to inspect.
 * @returns The SOURCE mapping that request sent.
 */
function sourceOf(engine: ScriptedEngine, index: number): Record<string, string> {
  const user = engine.requests[index]?.messages?.find((m) => m.role === 'user')?.content ?? '';
  const json = user.slice(user.indexOf('SOURCE:') + 'SOURCE:'.length).trim();
  return JSON.parse(json);
}

describe('recovery of slots the model skipped or echoed', () => {
  it('re-asks for an omitted slot instead of leaving its source text on the page', async () => {
    const engine = new ScriptedEngine([
      '{"b0":"I like cats."}',
      '{"b0":"I like dogs."}',
    ]);

    const out = await engine.translate(['猫が好き', '犬が好き'], 'ja', 'en');

    expect(out).toEqual(['I like cats.', 'I like dogs.']);
    expect(engine.requests).toHaveLength(2);
    // The retry must ask for the lost slot only, re-keyed from zero, not re-send the whole batch.
    expect(sourceOf(engine, 1)).toEqual({ b0: '犬が好き' });
  });

  it('re-asks when the model echoes the source text back unchanged', async () => {
    const engine = new ScriptedEngine([
      '{"b0":"この野郎","b1":"Thank you."}',
      '{"b0":"You bastard."}',
    ]);

    const out = await engine.translate(['この野郎', 'ありがとう'], 'ja', 'en');

    expect(out).toEqual(['You bastard.', 'Thank you.']);
    expect(engine.requests).toHaveLength(2);
    expect(sourceOf(engine, 1)).toEqual({ b0: 'この野郎' });
  });

  it('spends at most one retry per translate call when the model keeps failing', async () => {
    const engine = new ScriptedEngine(['{"b0":"I like cats."}', '{"b0":"still wrong"}'], 2);

    const out = await engine.translate(['猫が好き', '犬が好き'], 'ja', 'en');

    // Second slot stays source: honest degradation, but no third request.
    expect(out).toEqual(['I like cats.', '犬が好き']);
    expect(engine.requests).toHaveLength(2);
  });

  it('costs nothing when every slot survived', async () => {
    const engine = new ScriptedEngine(['{"b0":"Hello.","b1":"Bye."}']);

    await engine.translate(['こんにちは', 'さようなら'], 'ja', 'en');

    expect(engine.requests).toHaveLength(1);
  });

  it('caps the retry budget so a systematically bad model cannot multiply the page cost', async () => {
    // Every slot fails; 20 slots would need three follow-ups at MAX_RETRY_SEGMENTS each.
    const sources = Array.from({ length: 20 }, (_, i) => `台詞${i}`);
    const engine = new ScriptedEngine(['{}', '{}', '{}', '{}'], 20);

    const out = await engine.translate(sources, 'ja', 'en');

    expect(engine.requests.length).toBeLessThanOrEqual(1 + MAX_RETRY_REQUESTS);
    expect(out).toEqual(sources);
    // Never ask for more than the segment cap in one follow-up.
    for (let i = 1; i < engine.requests.length; i += 1) {
      expect(Object.keys(sourceOf(engine, i)).length).toBeLessThanOrEqual(MAX_RETRY_SEGMENTS);
    }
  });

  it('does not spend a retry on a slot that holds no source-language text', async () => {
    // Latin junk from OCR is not translatable: re-asking invites the model to invent a meaning.
    const engine = new ScriptedEngine(['{"b1":"Hi."}']);

    const out = await engine.translate(['P-/M M.', 'こんにちは'], 'ja', 'en');

    expect(out).toEqual(['P-/M M.', 'Hi.']);
    expect(engine.requests).toHaveLength(1);
  });
});
