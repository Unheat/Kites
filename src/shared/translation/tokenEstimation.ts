/**
 * tokenEstimation.ts
 *
 * Token estimation, Unicode code-point accounting, and deterministic passthrough utilities.
 * Platform-independent: no Chrome or DOM dependencies.
 */

/**
 * Detects whether a text string consists entirely of punctuation, ellipses, symbols, or whitespace
 * without linguistic alphanumeric characters (e.g. "...", "！？", "——", "ーー").
 * Such tokens bypass the LLM and are resolved deterministically as source passthroughs.
 *
 * @param text - The raw source text.
 * @returns True if the text contains no letters or digits.
 */
export function isDeterministicPassthrough(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // Strip prolonged sound marks (ー, U+30FC), dashes, wave dashes, and dots
  const stripped = trimmed.replace(/[ー—–\-_~〜…·・\s]/gu, '');
  if (!stripped) return true;
  // Unicode property escapes: check if remaining text has any Letter or Number
  return !/[\p{L}\p{N}]/u.test(stripped);
}

/**
 * Accurately counts Unicode code points (properly handling surrogate pairs and emoji).
 *
 * @param text - The text string.
 * @returns Count of Unicode code points.
 */
export function countCodePoints(text: string): number {
  return [...text].length;
}

/**
 * Estimates token count for multilingual text across modern BPE / SentencePiece tokenizers.
 * Accurately models token fertility across scripts:
 * - Basic Latin ASCII [A-Za-z]: ~0.30 tokens/char (~3.3 chars per token)
 * - Vietnamese Latin Extended: ~0.35 tokens/char (~1.1-1.3 tokens per word)
 * - Cyrillic (Russian, Ukrainian): ~0.42 tokens/char
 * - Arabic / Hebrew: ~0.45 tokens/char
 * - Thai / Lao: ~0.60 tokens/char
 * - Devanagari / Indic: ~1.00 tokens/char
 * - CJK Ideographs (Hanzi / Kanji): ~0.90 tokens/char
 * - CJK Kana (Hiragana, Katakana, SFX): ~1.05 tokens/char
 * - Hangul Syllables: ~0.85 tokens/char
 * - Digits: ~0.60 tokens/char
 * - Whitespace: ~0.20 tokens/char
 * - Symbols & Punctuation: ~0.90 tokens/char
 * - Emojis & Astral planes: ~2.50 tokens/char
 *
 * Runs in a single O(N) pass with zero memory allocation.
 *
 * @param text - Input text string.
 * @returns Conservative upper-bound estimated token count.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let totalTokens = 1.0; // Baseline BOS / string prefix
  const len = trimmed.length;

  for (let i = 0; i < len; i++) {
    const cp = trimmed.codePointAt(i)!;
    if (cp > 0xffff) i++; // Step over surrogate pair

    if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) {
      totalTokens += 0.30; // Latin ASCII
    } else if (cp >= 0x4e00 && cp <= 0x9fff) {
      totalTokens += 0.90; // CJK Hanzi / Kanji
    } else if (cp >= 0x3040 && cp <= 0x30ff) {
      totalTokens += 1.05; // Hiragana / Katakana / SFX
    } else if (cp >= 0xac00 && cp <= 0xd7af) {
      totalTokens += 0.85; // Hangul
    } else if (cp >= 0x0400 && cp <= 0x04ff) {
      totalTokens += 0.42; // Cyrillic
    } else if (cp >= 0x1ea0 && cp <= 0x1ef9) {
      totalTokens += 0.35; // Vietnamese Latin
    } else if ((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0590 && cp <= 0x05ff)) {
      totalTokens += 0.45; // Arabic / Hebrew
    } else if (cp >= 0x0e00 && cp <= 0x0e7f) {
      totalTokens += 0.60; // Thai
    } else if (cp >= 0x0900 && cp <= 0x097f) {
      totalTokens += 1.00; // Devanagari
    } else if (cp >= 48 && cp <= 57) {
      totalTokens += 0.60; // Digits
    } else if (cp <= 32) {
      totalTokens += 0.20; // Whitespace
    } else if (cp > 0xffff) {
      totalTokens += 2.50; // Emoji / astral planes
    } else {
      totalTokens += 0.90; // Punctuation / brackets / symbols
    }
  }

  return Math.ceil(totalTokens);
}

/**
 * Computes dynamic token safety bound for a batch of source strings based on
 * number of bubbles and total Unicode code points.
 * Formula: Math.min(1024, Math.max(64, 32 + 16 * N + Math.ceil(2.5 * C)))
 *
 * @param sources - Array of source texts in the batch.
 * @returns Maximum completion tokens.
 */
export function maxTokensForBatch(sources: string[]): number {
  const n = sources.length;
  const c = sources.reduce((sum, s) => sum + countCodePoints(s.trim()), 0);
  return Math.min(1024, Math.max(64, 32 + 16 * n + Math.ceil(2.5 * c)));
}

/**
 * Strips common LLM markdown formatting (bold, italic, backticks, fences) from a text string.
 *
 * @param text - The raw text potentially containing markdown decorators.
 * @returns Cleaned text with markdown syntax stripped.
 */
export function stripMarkdownFormatting(text: string): string {
  if (!text) return '';
  let out = text
    // Strip bold/italic asterisks: ***both***, **bold**, *italic*
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    // Strip bold/italic underscores: ___both___, __bold__, _italic_
    .replace(/___(.*?)___/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    // Strip inline backticks: `code`
    .replace(/`([^`]+)`/g, '$1');

  // Strip any lingering markdown fence or dangling asterisks/underscores
  out = out.replace(/^[*_~`#]+\s*/, '').replace(/\s*[*_~`#]+$/, '');
  return out.trim();
}

/**
 * Cleans translated text by stripping markdown formatting, leaked tag debris (<|1|>, |1|>, [1], 1.),
 * leading labels (Translated:, Translation:), and wrapping quotes.
 *
 * @param text - The raw translation string.
 * @returns Sanitized plain text translation ready for typesetting.
 */
export function cleanTranslatedLine(text: string): string {
  if (!text) return '';
  let out = stripMarkdownFormatting(text);

  // 1. Strip leading tag debris, e.g. `<|1|>`, `|1|>`, `[1]`, `1. ` or `1: ` (require whitespace after dot/colon)
  out = out.replace(/^(?:<\||\[|\|)?\s*\d+\s*(?:\|>|\]|[.:]\s+)\s*/, '');

  // 2. Strip leading labels like `Translated:`, `Translation:`, `Answer:`
  out = out.replace(/^(?:translated|translation|output|result|target):\s*/i, '');

  // 3. Strip outer quotation marks
  if (
    (out.startsWith('"') && out.endsWith('"') && out.length > 1) ||
    (out.startsWith('\'') && out.endsWith('\'') && out.length > 1) ||
    (out.startsWith('“') && out.endsWith('”') && out.length > 1) ||
    (out.startsWith('「') && out.endsWith('」') && out.length > 1)
  ) {
    out = out.slice(1, -1).trim();
  }

  // 4. Strip any lingering leading tag debris
  out = out.replace(/^(?:<\||\[|\|)?\s*\d+\s*(?:\|>|\]|[.:]\s+)\s*/, '');

  return stripMarkdownFormatting(out);
}
