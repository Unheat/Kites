/**
 * @file kinsokuShori.ts
 * Punctuation binding, script boundary detection, and Japanese Kinsoku Shori line-start barring rules.
 */

/** Opening punctuation marks that must bind to the following word token. */
export const OPENING_MARK_RE = /[¡¿([{«‹‘‚‛“„‟〈《「『【〔〖〘〚〝（［｛｟｢#@$£¥§₦₩€₱₹₽฿№]/;

/** Characters forbidden from starting a rendered line (Kinsoku Shori / western punctuation). */
export const NO_LINE_START_RE = /^[\.,!\?:;…\-—―–‒ー－～─‥）」』】》〉，、。：；！？，。、،۔\)\]}）】ฯៗๆ\u31F0-\u31FF〕〗”’♪~．〙〛]/;

/** Dashes that may break if intra-word. */
export const BREAKABLE_DASH_RE = /[\-‐‒–—―]/;

/** Unicode script ranges for no-space writing systems (CJK, Thai, Lao, Khmer, Burmese, etc.). */
export const NO_SPACE_SCRIPT_RE = /[\u0E00-\u0EFF\u1000-\u109F\u1780-\u17FF\u2E80-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF9F]/;

/**
 * Checks if a character belongs to a script without inter-word whitespace (e.g. CJK, Thai).
 *
 * @param ch - Single character to inspect.
 * @returns True if character belongs to a non-spaced script.
 */
export function isNoSpaceScriptChar(ch: string): boolean {
  return !!ch && NO_SPACE_SCRIPT_RE.test(ch);
}

/**
 * Checks if a string cluster ends in an intra-word dash.
 *
 * @param cluster - String segment ending in a possible dash.
 * @returns True if the dash is inside a word rather than standalone punctuation.
 */
export function isIntraWordDash(cluster: string): boolean {
  if (!cluster || cluster.length < 2) return false;
  if (!BREAKABLE_DASH_RE.test(cluster[cluster.length - 1])) return false;
  const before = cluster[cluster.length - 2];
  return !/\s/.test(before) && !BREAKABLE_DASH_RE.test(before) && !OPENING_MARK_RE.test(before);
}

/**
 * Checks if a token is barred from starting a line under Kinsoku Shori rules.
 *
 * @param token - Candidate line-start token.
 * @returns True if starting a line with this token is prohibited.
 */
export function barredStart(token: string): boolean {
  return NO_LINE_START_RE.test(token) || /^[»›](?![\p{L}\p{N}])/u.test(token);
}

/**
 * Checks if a line break before index k in tokens is barred.
 *
 * @param tokens - Full token array.
 * @param k - Candidate break index.
 * @returns True if breaking before token k is prohibited.
 */
export function lineStartBarred(tokens: string[], k: number): boolean {
  if (k <= 0 || k >= tokens.length) return false;
  return (
    barredStart(tokens[k].trim()) ||
    (tokens[k][0] === '・' && /[\p{L}・]$/u.test(tokens[k - 1] ?? '')) ||
    (!tokens[k].trim() && k + 1 < tokens.length && barredStart(tokens[k + 1].trim()))
  );
}

/**
 * Merges raw punctuation and word tokens into clusters that must stay together.
 *
 * @param tokens - Raw word and punctuation tokens.
 * @returns Cohesive bound tokens.
 */
export function bindWrapTokens(tokens: string[]): string[] {
  const bound: string[] = [];
  let pendingOpen = false;

  for (const token of tokens) {
    if (!token) continue;
    const prev = bound.length > 0 ? bound[bound.length - 1] : '';
    let bind = false;

    if (prev) {
      const prevChar = prev[prev.length - 1];
      const nextChar = token[0];
      if (pendingOpen) {
        bind = true;
      } else if (!/\s/.test(prevChar) && !/\s/.test(nextChar)) {
        const dashBreak = isIntraWordDash(prev) && !BREAKABLE_DASH_RE.test(nextChar);
        bind = !isNoSpaceScriptChar(prevChar) && !isNoSpaceScriptChar(nextChar) && !dashBreak;
      }
    }

    if (bind) {
      bound[bound.length - 1] = prev + token;
    } else {
      bound.push(token);
    }

    const core = bound[bound.length - 1].replace(/\s+$/, '');
    pendingOpen = core.length > 0 && OPENING_MARK_RE.test(core[core.length - 1]);
  }

  return bound;
}
