/**
 * @file textUnwrap.ts
 * Normalizes soft hyphens, soft line breaks, and paragraph boundaries across reflow cycles.
 */

import { isIntraWordDash, isNoSpaceScriptChar } from './kinsokuShori';

/**
 * Invisible word joiner Unicode character used to mark inserted soft hyphens.
 * Distinguishes dynamically inserted line-wrap hyphens from authored dashes.
 */
export const INSERTED_HYPHEN = '-\u2060';

/**
 * Heals typesetter line-break word splits while preserving the overall line structure.
 * Rejoins "com-\nmunity" -> "community", tolerating the INSERTED_HYPHEN Word Joiner
 * marker and uppercase lettering, so legacy rows whose lines carry only a plain
 * trailing hyphen are healed too. A hyphen immediately before a line break is treated
 * as a wrap split (pre-existing semantic) and rejoined without it; authored inline
 * dashes are untouched because no line break follows them. Unlike
 * {@link unwrapWrappedText}, single newlines are kept.
 *
 * @param text - Multi-line text potentially containing hyphenated line breaks.
 * @returns Text with hyphenated word splits rejoined, newline structure intact.
 */
export function healLineBreakHyphens(text: string): string {
  return text.replace(/([a-zA-Z]+)-\u2060?\s*\r?\n\s*\u2060?([a-zA-Z]+)/g, '$1$2');
}

/**
 * Strips inserted soft hyphens and unwraps soft newlines into a continuous sentence.
 * Preserves intentional paragraph breaks (\n\n) and intra-word dashes.
 *
 * @param text - Dialogue text potentially containing `\n` or inserted soft hyphens.
 * @returns Clean unwrapped sentence ready for reflow.
 */
export function unwrapWrappedText(text: string): string {
  if (!text) return '';
  const clean = healLineBreakHyphens(text);

  let out = '';
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch !== '\n' && ch !== '\r') {
      out += ch;
      continue;
    }
    let newlineCount = 0;
    while (i < clean.length && (clean[i] === '\n' || clean[i] === '\r')) {
      if (clean[i] === '\n') newlineCount++;
      i++;
    }
    i--;

    if (newlineCount >= 2) {
      out += '\n\n';
      continue;
    }

    if (out.endsWith(INSERTED_HYPHEN)) {
      out = out.slice(0, -INSERTED_HYPHEN.length);
      continue;
    }
    const prevChar = out.length > 0 ? out[out.length - 1] : '';
    const nextChar = i + 1 < clean.length ? clean[i + 1] : '';
    if (isNoSpaceScriptChar(prevChar) && isNoSpaceScriptChar(nextChar)) continue;
    if (nextChar && isIntraWordDash(out)) continue;
    out += ' ';
  }

  return out
    .split(INSERTED_HYPHEN)
    .join('')
    .replace(/\u2060/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
