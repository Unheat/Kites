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
 * Strips inserted soft hyphens and unwraps soft newlines into a continuous sentence.
 * Preserves intentional paragraph breaks (\n\n) and intra-word dashes.
 *
 * @param text - Dialogue text potentially containing `\n` or inserted soft hyphens.
 * @returns Clean unwrapped sentence ready for reflow.
 */
export function unwrapWrappedText(text: string): string {
  if (!text) return '';
  // Heal standard line-break word splits (e.g. "com-\nmunity" -> "community")
  const clean = text.replace(/([a-zA-Z]+)-\s*\r?\n\s*([a-z]+)/g, '$1$2');

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
