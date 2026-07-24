/**
 * Minimal type shims for the `hypher` Liang-algorithm hyphenation library and its
 * `hyphenation.en-us` pattern pack. Only the surface we use is declared.
 */
declare module 'hypher' {
  interface HyphenationPatterns {
    id: string;
    leftmin: number;
    rightmin: number;
    patterns: Record<string, string>;
    exceptions?: Record<string, string>;
  }

  export default class Hypher {
    constructor(patterns: HyphenationPatterns);
    /** Splits a single word into its syllable fragments (in order). */
    hyphenate(word: string): string[];
    /** Inserts soft hyphens; unused here but part of the API. */
    hyphenateText(text: string, minLength?: number): string;
  }
}

declare module 'hyphenation.en-us' {
  const patterns: import('hypher').HyphenationPatterns;
  export default patterns;
}
