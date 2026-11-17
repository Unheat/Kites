import { describe, it, expect } from 'vitest';
import { BaseLlmTranslationEngine } from './BaseLlmTranslationEngine';

/** Engine that only needs the prompt, so the prompt rules can be asserted in isolation. */
class PromptOnlyEngine extends BaseLlmTranslationEngine {
  protected async requestLlm(): Promise<string> {
    return '{}';
  }

  /**
   * @param sourceLang - Source language name handed to the prompt.
   * @param targetLang - Target language name handed to the prompt.
   * @returns The system prompt a real request would carry.
   */
  public promptFor(sourceLang: string, targetLang: string): string {
    return this.buildSystemPrompt(sourceLang, targetLang, [], undefined);
  }

  /**
   * @param sourceLang - Source language name handed to the prompt.
   * @param targetLang - Target language name handed to the prompt.
   * @param texts - Segment texts to encode into the SOURCE payload.
   * @returns The user turn a real request would carry.
   */
  public userTurnFor(sourceLang: string, targetLang: string, texts: string[]): string {
    const messages = this.buildJsonMessages(
      texts.map((text) => ({ text })) as never,
      sourceLang,
      targetLang,
      [],
      undefined
    );
    return messages[1].content;
  }

  /**
   * @param sourceLang - Source language name handed to the prompt.
   * @param targetLang - Target language name handed to the prompt.
   * @returns The instruction line used by the batch-sizing estimate.
   */
  public estimateInstructionFor(sourceLang: string, targetLang: string): string {
    return this.buildUserInstruction(sourceLang, targetLang);
  }

  /**
   * @param lang - Language code or name to resolve.
   * @param role - Whether this is the source or the target language.
   * @returns The name the prompt will carry.
   */
  public resolveFor(lang: string | undefined, role: 'source' | 'target'): string {
    return this.resolveLanguage(lang, role);
  }
}

describe('copy rule in the system prompt', () => {
  it('asks for a translation of every value, with no escape hatch for hard lines', () => {
    const prompt = new PromptOnlyEngine().promptFor('Japanese', 'English');

    expect(prompt).toContain('Translate every value.');
    // The blanket "cannot be usefully translated" wording is what let a model skip a line.
    expect(prompt).not.toContain('cannot be usefully translated');
  });

  it('keeps the narrow cases that legitimately have no translation', () => {
    const prompt = new PromptOnlyEngine().promptFor('Japanese', 'English');

    expect(prompt).toContain('no words at all');
    expect(prompt).toContain('already in English');
  });

  it('does not license skipping text the model decides is debris', () => {
    const prompt = new PromptOnlyEngine().promptFor('Japanese', 'English');

    // Measured on a Chinese page whose OCR read two bubbles as rubble: with a debris clause the
    // model kept 5 of 6 slots as source text, without one it translated 6 of 6 and needed no
    // recovery request at all. Garbled input is still input - ask for a best effort, not a skip.
    expect(prompt).not.toContain('debris');
    expect(prompt).toContain('translate damaged or garbled text as best you can');
  });

  it('leaves punctuation to the deterministic passthrough instead of spending prompt tokens on it', () => {
    const prompt = new PromptOnlyEngine().promptFor('Japanese', 'English');

    // isDeterministicPassthrough resolves empty/punctuation/ellipsis before the model is called.
    expect(prompt).not.toContain('punctuation-only');
  });
});

describe('user instruction', () => {
  it('names the resolved direction and carries the SOURCE payload', () => {
    const userTurn = new PromptOnlyEngine().userTurnFor('Japanese', 'Vietnamese', ['こんにちは']);

    expect(userTurn).toBe('Translate SOURCE from Japanese to Vietnamese.\n\nSOURCE:\n{"b0":"こんにちは"}');
  });

  it('renders the same instruction the batch-size estimate is computed from', () => {
    const engine = new PromptOnlyEngine();
    const instruction = engine.estimateInstructionFor('Chinese', 'Thai');
    const userTurn = engine.userTurnFor('Chinese', 'Thai', ['你好']);

    // A drifted estimate describes a prompt that is never sent, so every batch is sized against
    // the wrong context budget. Exact prefix equality is the contract.
    expect(userTurn.startsWith(`${instruction}\n\nSOURCE:`)).toBe(true);
    expect(instruction).toBe('Translate SOURCE from Chinese to Thai.');
  });
});

describe('language resolution', () => {
  it('names the target the user actually picked', () => {
    const engine = new PromptOnlyEngine();

    expect(engine.resolveFor('en', 'target')).toBe('English');
    expect(engine.resolveFor('vi', 'target')).toBe('Vietnamese');
    expect(engine.resolveFor('ja', 'target')).toBe('Japanese');
  });

  it('treats an undeclared source as auto', () => {
    const engine = new PromptOnlyEngine();

    expect(engine.resolveFor('auto', 'source')).toBe('the detected source language');
    expect(engine.resolveFor(undefined, 'source')).toBe('the detected source language');
  });

  it('refuses an auto or missing target instead of silently picking English', () => {
    const engine = new PromptOnlyEngine();

    // 'auto' means "you decide" for a source only. Quietly answering "English" here would
    // translate the entire page into a language nobody asked for, with no error to notice.
    expect(() => engine.resolveFor('auto', 'target')).toThrow(/concrete language/);
    expect(() => engine.resolveFor('', 'target')).toThrow(/concrete language/);
    expect(() => engine.resolveFor(undefined, 'target')).toThrow(/concrete language/);
  });
});
