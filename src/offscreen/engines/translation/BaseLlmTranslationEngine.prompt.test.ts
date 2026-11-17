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

describe('format rules follow the structured-output tier', () => {
  /** Engine pinned to one structured-output tier, so the prompt can be inspected per tier. */
  class TieredPromptEngine extends BaseLlmTranslationEngine {
    /** Tier this instance pretends to negotiate. */
    public tier: 'prompt-only' | 'json-object' | 'json-schema' = 'prompt-only';

    protected override promptOutputMode(): 'prompt-only' | 'json-object' | 'json-schema' {
      return this.tier;
    }

    protected async requestLlm(): Promise<string> {
      return '{}';
    }

    /**
     * @param tier - Structured-output tier to pin this instance to.
     * @returns This instance, for a one-expression test setup.
     */
    public withTier(tier: 'prompt-only' | 'json-object' | 'json-schema'): this {
      this.tier = tier;
      return this;
    }

    /**
     * @returns The system prompt this tier would send.
     */
    public prompt(): string {
      return this.buildSystemPrompt('Japanese', 'English', [], undefined);
    }
  }

  it('keeps both format lines when nothing constrains the output', () => {
    const prompt = new TieredPromptEngine().withTier('prompt-only').prompt();

    expect(prompt).toContain('exact same keys as SOURCE');
    expect(prompt).toContain('Output raw JSON only');
  });

  it('drops only the raw-JSON guard when the host guarantees JSON syntax', () => {
    const prompt = new TieredPromptEngine().withTier('json-object').prompt();

    expect(prompt).toContain('exact same keys as SOURCE');
    expect(prompt).not.toContain('Output raw JSON only');
  });

  it('drops both format lines when decoding constrains the keys', () => {
    const prompt = new TieredPromptEngine().withTier('json-schema').prompt();

    expect(prompt).not.toContain('exact same keys as SOURCE');
    expect(prompt).not.toContain('Output raw JSON only');
    // Content rules must survive: only the output-format scaffolding is tier-dependent.
    expect(prompt).toContain('Keep every key from SOURCE unchanged');
    expect(prompt).toContain('Translate every value.');
  });
});
