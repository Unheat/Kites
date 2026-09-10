import { describe, it, expect } from 'vitest';
import {
  BaseLlmTranslationEngine,
  isDeterministicPassthrough,
  countCodePoints,
  maxTokensForBatch,
  buildSchema,
  stripMarkdownFormatting,
  cleanTranslatedLine,
  type LlmChatMessage,
} from './BaseLlmTranslationEngine';

class MockLlmEngine extends BaseLlmTranslationEngine {
  public mockResponse: string = '';
  public promptHistory: string[] = [];
  public messageHistory: (LlmChatMessage[] | undefined)[] = [];
  public schemaHistory: (Record<string, unknown> | undefined)[] = [];

  constructor(batchSize = 15, throwOnMismatch = false) {
    super();
    this.batchSize = batchSize;
    this.throwOnCountMismatch = throwOnMismatch;
  }

  protected async requestLlm(
    prompt: string,
    messages?: LlmChatMessage[],
    schema?: Record<string, unknown>
  ): Promise<string> {
    this.promptHistory.push(prompt);
    this.messageHistory.push(messages);
    this.schemaHistory.push(schema);
    return this.mockResponse;
  }

  public setAllowPartialMissingLines(value: boolean): void {
    this.allowPartialMissingLines = value;
  }
}

describe('isDeterministicPassthrough', () => {
  it('identifies punctuation, ellipses, and symbol-only strings', () => {
    expect(isDeterministicPassthrough('...')).toBe(true);
    expect(isDeterministicPassthrough('……')).toBe(true);
    expect(isDeterministicPassthrough('!?')).toBe(true);
    expect(isDeterministicPassthrough('！？')).toBe(true);
    expect(isDeterministicPassthrough('ーー')).toBe(true);
    expect(isDeterministicPassthrough('——')).toBe(true);
    expect(isDeterministicPassthrough('   ')).toBe(true);
    expect(isDeterministicPassthrough('')).toBe(true);
  });

  it('preserves text with linguistic characters for LLM translation', () => {
    expect(isDeterministicPassthrough('行こう！')).toBe(false);
    expect(isDeterministicPassthrough('What?!')).toBe(false);
    expect(isDeterministicPassthrough('休')).toBe(false);
    expect(isDeterministicPassthrough('ドン')).toBe(false);
    expect(isDeterministicPassthrough('123')).toBe(false);
  });
});

describe('maxTokensForBatch and countCodePoints', () => {
  it('accurately counts Unicode code points including emojis and multi-byte CJK', () => {
    expect(countCodePoints('行こう！')).toBe(4);
    expect(countCodePoints('Hello')).toBe(5);
  });

  it('calculates dynamic token safety cap bounded within bounds', () => {
    const tokensSmall = maxTokensForBatch(['Hi']);
    expect(tokensSmall).toBeGreaterThanOrEqual(64);
    expect(tokensSmall).toBeLessThanOrEqual(384);

    const longBatch = new Array(6).fill('This is a longer manga text bubble with many words.');
    const tokensLong = maxTokensForBatch(longBatch);
    expect(tokensLong).toBeLessThanOrEqual(384);
  });
});

describe('buildSchema', () => {
  it('generates exact keyed schema for batch slots', () => {
    const schema = buildSchema(3) as any;
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['b0', 'b1', 'b2']);
    expect(schema.properties.b0).toEqual({ type: 'string' });
    expect(schema.properties.b1).toEqual({ type: 'string' });
    expect(schema.properties.b2).toEqual({ type: 'string' });
  });
});

describe('stripMarkdownFormatting', () => {
  it('strips bold and italic asterisks correctly', () => {
    expect(stripMarkdownFormatting('**Preface**')).toBe('Preface');
    expect(stripMarkdownFormatting('*whispering*')).toBe('whispering');
    expect(stripMarkdownFormatting('***Important***')).toBe('Important');
  });

  it('strips bold and italic underscores correctly', () => {
    expect(stripMarkdownFormatting('__Bold Text__')).toBe('Bold Text');
    expect(stripMarkdownFormatting('_Italic Text_')).toBe('Italic Text');
  });

  it('strips inline backticks', () => {
    expect(stripMarkdownFormatting('`inline text`')).toBe('inline text');
  });

  it('handles complex manga translation with mixed formatting', () => {
    const raw = '**Welcome to "Sweet Garden"** *(designed for adult care)*';
    expect(stripMarkdownFormatting(raw)).toBe('Welcome to "Sweet Garden" (designed for adult care)');
  });
});

describe('cleanTranslatedLine tag debris & filler shield', () => {
  it('strips malformed tag debris from translated output', () => {
    expect(cleanTranslatedLine('<|1|> Hello')).toBe('Hello');
    expect(cleanTranslatedLine('|1|> Hello')).toBe('Hello');
    expect(cleanTranslatedLine('[1] Hello')).toBe('Hello');
    expect(cleanTranslatedLine('1. Hello')).toBe('Hello');
    expect(cleanTranslatedLine('1: Hello')).toBe('Hello');
  });

  it('strips leading labels and quotes', () => {
    expect(cleanTranslatedLine('Translated: "I want to deliver something much better."')).toBe(
      'I want to deliver something much better.'
    );
    expect(cleanTranslatedLine('Translation: \'Wait for me!\'')).toBe('Wait for me!');
    expect(cleanTranslatedLine('Output: “Good morning”')).toBe('Good morning');
  });
});

describe('BaseLlmTranslationEngine Keyed JSON Protocol', () => {
  it('returns empty array when input is empty without invoking requestLlm', async () => {
    const engine = new MockLlmEngine();
    const result = await engine.translate([]);
    expect(result).toEqual([]);
    expect(engine.promptHistory).toHaveLength(0);
  });

  it('resolves deterministic punctuation-only tokens directly without dispatching to LLM', async () => {
    const engine = new MockLlmEngine();
    engine.mockResponse = JSON.stringify({ b0: 'Hello', b1: 'World' });

    const result = await engine.translate(['Hi', '...', '!?', 'Earth'], 'en', 'en');
    expect(result).toEqual(['Hello', '...', '!?', 'World']);
    expect(engine.promptHistory).toHaveLength(1);
    // Only 'Hi' and 'Earth' were sent to the LLM (b0, b1)
    expect(engine.promptHistory[0]).toContain('"b0":"Hi"');
    expect(engine.promptHistory[0]).toContain('"b1":"Earth"');
    expect(engine.promptHistory[0]).not.toContain('...');
  });

  it('chunks items into batches according to batchSize and supplies schema', async () => {
    const engine = new MockLlmEngine(2); // Small batch size 2
    engine.mockResponse = JSON.stringify({ b0: 'T0', b1: 'T1' });

    const inputs = ['A', 'B', 'C', 'D'];
    const result = await engine.translate(inputs, 'en', 'ja');

    // 4 items with batchSize 2 -> 2 batches
    expect(engine.promptHistory).toHaveLength(2);
    expect(engine.schemaHistory).toHaveLength(2);
    expect((engine.schemaHistory[0] as any).required).toEqual(['b0', 'b1']);
    expect(result).toEqual(['T0', 'T1', 'T0', 'T1']);
  });

  it('builds structured chat messages with Keyed JSON zero-shot instructions', () => {
    const engine = new MockLlmEngine();
    const msgs = (engine as any).buildJsonMessages(
      [{ originalIndex: 0, text: 'One' }, { originalIndex: 1, text: 'Two' }],
      'Japanese',
      'English'
    );

    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('Return only one JSON object matching the required schema');
    expect(msgs[0].content).toContain('Keep every output key exactly as required (e.g. b0, b1)');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('"b0":"One"');
    expect(msgs[1].content).toContain('"b1":"Two"');
  });

  it('handles re-ordered JSON keys with zero positional drift', async () => {
    const engine = new MockLlmEngine();
    // Model emitted b1 before b0
    engine.mockResponse = JSON.stringify({
      b1: 'Second Translation',
      b0: 'First Translation',
    });

    const result = await engine.translate(['Item 0', 'Item 1'], 'ja', 'en');
    expect(result[0]).toBe('First Translation');
    expect(result[1]).toBe('Second Translation');
  });

  it('recovers accurately from markdown-wrapped JSON responses', async () => {
    const engine = new MockLlmEngine();
    engine.mockResponse = '```json\n{"b0": "Deliver the best possible thing", "b1": "Haha, top"}\n```';

    const result = await engine.translate(['Item 0', 'Item 1'], 'ja', 'en');
    expect(result).toEqual(['Deliver the best possible thing', 'Haha, top']);
  });

  it('guarantees slot isolation: missing key slot falls back to its own source without cascading shift', async () => {
    const engine = new MockLlmEngine(15, false);
    // 3 items: [0: "Kotoha", 1: "Name:", 2: "Story"]
    // Model omits key "b1", providing only "b0" and "b2"
    engine.mockResponse = JSON.stringify({
      b0: 'Kotoha',
      b2: 'The story of our park',
    });

    const inputs = ['Kotoha', 'Name:', 'Story'];
    const result = await engine.translate(inputs, 'ja', 'en');

    // Slot 0 translated to Kotoha
    expect(result[0]).toBe('Kotoha');
    // Slot 1 was omitted: isolated fallback to original text 'Name:' without shifting slot 2!
    expect(result[1]).toBe('Name:');
    // Slot 2 correctly mapped to its own slot!
    expect(result[2]).toBe('The story of our park');
  });

  it('parses resilient keyed regex fallback if JSON syntax is slightly broken', async () => {
    const engine = new MockLlmEngine();
    // Broken JSON without closing braces, but with clear key lines
    engine.mockResponse = 'b0: "Deliver the best"\nb1: "Just one more month"';

    const result = await engine.translate(['Item 0', 'Item 1'], 'ja', 'en');
    expect(result[0]).toBe('Deliver the best');
    expect(result[1]).toBe('Just one more month');
  });

  it('rejects partial translated output when the strict production gate is enabled', async () => {
    const engine = new MockLlmEngine(15, false);
    engine.setAllowPartialMissingLines(false);
    engine.mockResponse = JSON.stringify({ b0: 'Deliver the best', b1: 'Haha, top' }); // missing b2

    await expect(engine.translate(['Item 0', 'Item 1', 'Item 2'], 'ja', 'en'))
      .rejects.toThrow('Translation dropped 1/3 lines instead of satisfying the 1:1 key contract.');
  });
});
