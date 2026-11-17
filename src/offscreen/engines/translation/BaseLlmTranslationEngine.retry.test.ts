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

  private readonly script: string[];
  private readonly responder?: (call: number) => string | undefined;

  /**
   * @param script - Canned completion payloads, consumed in call order.
   * @param batchSize - Segments per request; kept small so tests stage one chunk per case.
   * @param responder - Optional per-call override, for cases that need the call number.
   */
  constructor(script: string[], batchSize = 15, responder?: (call: number) => string | undefined) {
    super();
    this.script = script;
    this.batchSize = batchSize;
    this.responder = responder;
  }

  protected async requestLlm(
    _prompt: string,
    messages?: LlmChatMessage[],
    _schema?: Record<string, unknown>,
    _signal?: AbortSignal,
    maxTokens?: number
  ): Promise<string> {
    this.requests.push({ messages, maxTokens });
    const override = this.responder?.(this.requests.length);
    return override ?? this.script.shift() ?? '{}';
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

  it('stops after one recovery request when the model repeats the same failure', async () => {
    // The retry echoes the source again: nothing was recovered, and asking a third time would not help.
    const engine = new ScriptedEngine([
      '{"b0":"I like cats.","b1":"犬が好き"}',
      '{"b0":"犬が好き"}',
    ], 2);

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

  it('skips recovery entirely when a page lost most of its slots', async () => {
    // Every slot lost is a broken model, not an accident: the established policy is to tolerate
    // the loss rather than pay for a second pass that would fail the same way.
    const sources = Array.from({ length: 20 }, (_, i) => `台詞${i}`);
    const echoAll = (texts: string[]) =>
      JSON.stringify(Object.fromEntries(texts.map((text, i) => [`b${i}`, text])));
    const engine = new ScriptedEngine([echoAll(sources)], 20);

    const out = await engine.translate(sources, 'ja', 'en');

    expect(engine.requests).toHaveLength(1);
    expect(out).toEqual(sources);
  });

  it('spends exactly one follow-up, capped in size, when the loss is a minority of the page', async () => {
    const sources = Array.from({ length: 4 }, (_, i) => `台詞${i}`);
    const engine = new ScriptedEngine(['{"b0":"first","b1":"second","b2":"third"}', '{"b0":"fourth"}'], 4);

    const out = await engine.translate(sources, 'ja', 'en');

    expect(engine.requests).toHaveLength(1 + MAX_RETRY_REQUESTS);
    expect(Object.keys(sourceOf(engine, 1))).toHaveLength(1);
    expect(Object.keys(sourceOf(engine, 1)).length).toBeLessThanOrEqual(MAX_RETRY_SEGMENTS);
    expect(out).toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('recovers a whole tail chunk, the shape a real local model produced', async () => {
    // A 0.8B model translated eight of twelve lines and echoed the four-line tail chunk back
    // unchanged (measured). Four of twelve is a minority, so it must be worth one follow-up.
    const sources = Array.from({ length: 12 }, (_, i) => `台詞${i}`);
    const firstPass = Object.fromEntries(sources.slice(0, 8).map((_, i) => [`b${i}`, `line ${i}`]));
    const engine = new ScriptedEngine([JSON.stringify(firstPass), ''], 12, (call) => {
      // The second page-less call answers the four lost slots.
      if (call === 2) return JSON.stringify({ b0: 'run!', b1: 'damn', b2: 'well done', b3: 'not next time' });
      return undefined;
    });

    const out = await engine.translate(sources, 'ja', 'en');

    expect(Object.keys(sourceOf(engine, 1))).toHaveLength(4);
    expect(out.slice(8)).toEqual(['run!', 'damn', 'well done', 'not next time']);
  });

  it('does not spend a retry on a slot that holds no source-language text', async () => {
    // Latin junk from OCR is not translatable: re-asking invites the model to invent a meaning.
    const engine = new ScriptedEngine(['{"b1":"Hi."}']);

    const out = await engine.translate(['P-/M M.', 'こんにちは'], 'ja', 'en');

    expect(out).toEqual(['P-/M M.', 'Hi.']);
    expect(engine.requests).toHaveLength(1);
  });
});
