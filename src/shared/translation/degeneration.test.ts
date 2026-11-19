import { describe, expect, it } from 'vitest';
import { hasRunawayRepetition } from './degeneration';

/**
 * Repeats a phrase the way a degenerating model does.
 *
 * @param phrase - Phrase to repeat.
 * @param times - Repetition count.
 * @returns The repeated string.
 */
const repeat = (phrase: string, times: number): string => phrase.repeat(times);

describe('hasRunawayRepetition', () => {
  it('catches the word loop observed in the browser log', () => {
    // "Eyes, don't you dare make a squeaky squeaky squeaky ..." filled one bubble.
    const looped = `{"b0":"Eyes, don't you dare make a ${repeat('squeaky ', 180)}"}`;
    expect(hasRunawayRepetition(looped)).toBe(true);
  });

  it('catches the phrase loop that truncated the second page', () => {
    const looped = `{"b2":"But when it comes down to it, I'll say, ${repeat("'I'm the one who's being caught', or ", 29)}"}`;
    expect(hasRunawayRepetition(looped)).toBe(true);
  });

  it('leaves ordinary translated dialogue alone', () => {
    const page = JSON.stringify({
      b0: 'What are you doing?',
      b1: 'Let go',
      b2: 'Where are you going?',
      b3: 'That is not supposed to be happening',
      b4: 'Help me!',
      b5: 'Too late',
      b6: 'Why...',
      b7: 'I cannot believe it',
    });
    expect(hasRunawayRepetition(page)).toBe(false);
  });

  it('leaves a page of short repeated exclamations alone', () => {
    // Real pages repeat short lines across bubbles; that is dialogue, not degeneration.
    const page = JSON.stringify({ b0: '……', b1: 'はい', b2: 'はい', b3: 'はい', b4: 'はい', b5: 'はい' });
    expect(hasRunawayRepetition(page)).toBe(false);
  });

  it('leaves a long varied Chinese page alone', () => {
    const page = JSON.stringify({
      b0: '殷想題以限C的人啊',
      b1: '所说被抓住的时候还是孤身一',
      b2: '不过从造成这种规模的破坏来看，老实交代，你的同伙都在哪？',
      b3: '即公，你似的哦修吗？',
      b4: '再说了，我可是客人呐，你得对我更客气点才行啊',
    });
    expect(hasRunawayRepetition(page)).toBe(false);
  });
});
