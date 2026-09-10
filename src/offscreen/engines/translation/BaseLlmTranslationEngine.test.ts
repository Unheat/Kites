import { describe, it, expect } from 'vitest';
import {
  BaseLlmTranslationEngine,
  stripMarkdownFormatting,
  cleanTranslatedLine,
} from './BaseLlmTranslationEngine';

class MockLlmEngine extends BaseLlmTranslationEngine {
  public mockResponse: string = '';
  public promptHistory: string[] = [];

  constructor(batchSize = 15, throwOnMismatch = false) {
    super();
    this.batchSize = batchSize;
    this.throwOnCountMismatch = throwOnMismatch;
  }

  protected async requestLlm(prompt: string): Promise<string> {
    this.promptHistory.push(prompt);
    return this.mockResponse;
  }
}

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

describe('BaseLlmTranslationEngine', () => {
  it('returns empty array when input is empty without invoking requestLlm', async () => {
    const engine = new MockLlmEngine();
    const result = await engine.translate([]);
    expect(result).toEqual([]);
    expect(engine.promptHistory).toHaveLength(0);
  });

  it('filters empty or whitespace-only strings and preserves array positions', async () => {
    const engine = new MockLlmEngine();
    engine.mockResponse = '<|1|> Hello\n<|2|> World';

    const result = await engine.translate(['Hi', '   ', '\n', 'Earth'], 'en', 'en');
    expect(result).toEqual(['Hello', '', '', 'World']);
    expect(engine.promptHistory).toHaveLength(1);
    expect(engine.promptHistory[0]).toContain('<|1|> Hi');
    expect(engine.promptHistory[0]).toContain('<|2|> Earth');
    expect(engine.promptHistory[0]).not.toContain('   ');
  });

  it('chunks items into batches according to batchSize', async () => {
    const engine = new MockLlmEngine(3); // Small batch size 3
    engine.mockResponse = '<|1|> T1\n<|2|> T2\n<|3|> T3';

    const inputs = ['A', 'B', 'C', 'D', 'E'];
    const result = await engine.translate(inputs, 'en', 'ja');

    // 5 items with batchSize 3 -> 2 batches (3 items, then 2 items)
    expect(engine.promptHistory).toHaveLength(2);
    expect(result).toHaveLength(5);
  });

  it('builds structured chat messages with system instructions and Cotrans 1-shot priming', () => {
    const engine = new MockLlmEngine();
    const msgs = (engine as any).buildMessages(
      [{ originalIndex: 0, text: 'One' }],
      'Japanese',
      'English'
    );

    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('automated translation engine');
    expect(msgs[0].content).toContain('Never output conversational filler');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('<|1|> 行こう！');
    expect(msgs[2].role).toBe('assistant');
    expect(msgs[2].content).toContain("<|1|> Let's go!");
    expect(msgs[3].role).toBe('user');
    expect(msgs[3].content).toContain('<|1|> One');
  });

  it('recovers accurately from missing bracket |1|> or [1] output', async () => {
    const engine = new MockLlmEngine();
    engine.mockResponse = '|1|> Deliver the best possible thing\n|2|> Haha, top\n|3|> Just one more month';

    const result = await engine.translate(['Item 1', 'Item 2', 'Item 3'], 'ja', 'en');
    expect(result).toEqual([
      'Deliver the best possible thing',
      'Haha, top',
      'Just one more month',
    ]);
  });

  it('filters out conversational preamble when model outputs intro text before translations', async () => {
    const engine = new MockLlmEngine();
    engine.mockResponse =
      "Sure, I'd be happy to help you translate the manga text! Here are the translations:\n" +
      '1. Deliver the best possible thing\n' +
      '2. Haha, top\n' +
      '3. Just one more month, please';

    const result = await engine.translate(['Item 1', 'Item 2', 'Item 3'], 'ja', 'en');
    expect(result).toEqual([
      'Deliver the best possible thing',
      'Haha, top',
      'Just one more month, please',
    ]);
  });

  it('prevents index shift when an item tag is omitted by LLM', async () => {
    const engine = new MockLlmEngine(15, false);
    // 3 items: [0: "Kotoha", 1: "Name:", 2: "Story"]
    // LLM skips tag 2 ("Name:"), outputting only tag 1 and tag 3
    engine.mockResponse = '<|1|> Kotoha\n<|3|> The story of our park';

    const inputs = ['Kotoha', 'Name:', 'Story'];
    const result = await engine.translate(inputs, 'zh', 'en');

    // Slot 0 translated to Kotoha
    expect(result[0]).toBe('Kotoha');
    // Slot 1 was dropped: safely kept as original text 'Name:' instead of shifting!
    expect(result[1]).toBe('Name:');
    // Slot 2 translated to The story of our park
    expect(result[2]).toBe('The story of our park');
  });

  it('throws error when throwOnCountMismatch is true and tag is omitted', async () => {
    const engine = new MockLlmEngine(15, true);
    engine.mockResponse = '<|1|> Line 1'; // 2 items requested, only 1 returned

    await expect(engine.translate(['First', 'Second'])).rejects.toThrow('Delimiter parsing failed for chunk');
  });
});
