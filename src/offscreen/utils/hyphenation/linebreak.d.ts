/**
 * Type declarations for `linebreak` npm package v1.1.0 (MIT).
 * Pure JavaScript implementation of the Unicode Line Breaking Algorithm (UAX #14).
 * No @types/linebreak package exists on npm; these are the minimal types we use.
 */

declare module 'linebreak' {
  export interface Break {
    /** UTF-16 code-unit index where the next line may begin. */
    position: number;
    /** True when the break is required (hard line break). */
    required: boolean;
  }

  /**
   * Stateful line breaker. Construct with the full text, then call `nextBreak()`
   * until it returns null.
   */
  export default class LineBreaker {
    /**
     * @param text - Text to segment.
     */
    constructor(text: string);

    /**
     * Returns the next break, or null when no breaks remain.
     */
    nextBreak(): Break | null;
  }
}