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

    expect(prompt).toContain('already in English');
    expect(prompt).toContain('illegible OCR debris');
  });

  it('leaves punctuation to the deterministic passthrough instead of spending prompt tokens on it', () => {
    const prompt = new PromptOnlyEngine().promptFor('Japanese', 'English');

    // isDeterministicPassthrough resolves empty/punctuation/ellipsis before the model is called.
    expect(prompt).not.toContain('punctuation-only');
  });
});
