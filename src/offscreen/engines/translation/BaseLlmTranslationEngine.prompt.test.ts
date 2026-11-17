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
  it('forbids returning source-language dialogue as the answer', () => {
    const prompt = new PromptOnlyEngine().promptFor('Japanese', 'English');

    expect(prompt).toMatch(/Never copy Japanese(?: text| dialogue)?/);
  });

  it('keeps the narrow cases that legitimately have no translation', () => {
    const prompt = new PromptOnlyEngine().promptFor('Japanese', 'English');

    // Punctuation, empty lines and already-translated text must still pass through untouched.
    expect(prompt).toContain('punctuation-only');
    expect(prompt).toContain('already written in English');
    expect(prompt).toContain('illegible OCR debris');
  });

  it('drops the blanket escape that let a model skip any line it did not want to translate', () => {
    const prompt = new PromptOnlyEngine().promptFor('Japanese', 'English');

    expect(prompt).not.toContain('cannot be usefully translated');
  });
});
