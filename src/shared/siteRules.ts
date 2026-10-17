import type { SiteSelectorRule } from './types';

/** Built-in high-priority container selectors ported from XianScan scanner heuristics. */
export const MANGA_READER_CONTAINER_SELECTORS: readonly string[] = [
  '#readerarea',
  'div[class*="reading-content"]',
  'div[class*="reader-area"]',
  'div[class*="readerarea"]',
  'div[class*="chapter-images"]',
  'div[class*="wt_viewer"]',
  '#comic_view_area',
  'div[class*="viewer-cnt"]',
  'div[class*="v-reader"]',
];

/** Noise and advertisement selectors ported from XianScan ad detector to prevent translating ad banners. */
export const AD_NOISE_CONTAINER_SELECTORS: readonly string[] = [
  'header',
  'footer',
  'nav',
  'aside',
  '[class*="sidebar"]',
  '[class*="comment"]',
  '[id*="disqus"]',
  '[class*="advert"]',
  '[class*="banner"]',
  '[class*="sponsor"]',
  '[class*="recommend"]',
];

/**
 * Normalizes a hostname or URL to a clean lowercase domain string.
 *
 * @param input - Raw URL or hostname (e.g. "https://MangaDex.Org/chapter/1").
 * @returns Clean lowercase hostname or trimmed string.
 */
export function normalizeDomain(input: string): string {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim().toLowerCase();
  try {
    if (trimmed.includes('://')) {
      const parsed = new URL(trimmed);
      return parsed.hostname.toLowerCase();
    }
  } catch {
    // Fall back to string parsing if URL constructor fails
  }
  // Strip paths, query strings, and port numbers if present
  return trimmed
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .split(':')[0]
    .trim();
}

/**
 * Checks whether a given hostname is matched in a list of disabled domains,
 * supporting exact match and wildcard subdomains (e.g. "*.example.com").
 *
 * @param hostname - Target hostname to check.
 * @param disabledDomains - Configured list of disabled domain patterns.
 * @returns Whether the domain is disabled.
 */
export function isDomainDisabled(hostname: string, disabledDomains: readonly string[] | undefined): boolean {
  if (!hostname || !disabledDomains || disabledDomains.length === 0) return false;
  const target = normalizeDomain(hostname);
  if (!target) return false;

  return disabledDomains.some((pattern) => {
    const normalizedPattern = normalizeDomain(pattern);
    if (!normalizedPattern) return false;
    if (normalizedPattern.startsWith('*.')) {
      const root = normalizedPattern.slice(2);
      return target === root || target.endsWith(`.${root}`);
    }
    return target === normalizedPattern;
  });
}

/**
 * Sanitizes and deduplicates a list of disabled domains.
 *
 * @param rawList - Raw stored array or unknown input.
 * @returns Clean, unique array of normalized domain strings.
 */
export function normalizeDisabledDomains(rawList: unknown): string[] {
  if (!Array.isArray(rawList)) return [];
  const result: string[] = [];
  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const clean = normalizeDomain(item);
    if (clean && !result.includes(clean)) {
      result.push(clean);
    }
  }
  return result;
}

/**
 * Validates a CSS selector string to ensure it won't crash querySelector.
 *
 * @param selector - Candidate CSS selector string.
 * @returns Whether the selector is non-empty and syntactically plausible.
 */
export function isValidCssSelector(selector: string): boolean {
  if (!selector || typeof selector !== 'string') return false;
  const trimmed = selector.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return false;
  // Plausible character check before DOM execution: reject HTML tags, curly braces, and backslashes
  if (/[<{}\\]/.test(trimmed)) return false;
  return true;
}

/**
 * Canonical chapter scope resolver.
 * Single Source of Truth for ZIP export, Reader modal, and Stack selection panel.
 * Normalizes webtoon chapter URLs, removes hash/pagination query parameters,
 * and strips trailing page indices on paginated manga/gallery readers (e.g. nhentai /g/123/4/ -> /g/123/).
 *
 * @param rawUrl - Full page or image source URL.
 * @returns Canonical chapter/gallery identifier URL.
 */
export function getChapterScopeId(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const url = new URL(rawUrl);

    // 1. Paginated galleries (e.g. nhentai /g/677759/6/ -> /g/677759/)
    if (/\/g\/\d+\/\d+\/?$/.test(url.pathname)) {
      return `${url.origin}${url.pathname.replace(/\/\d+\/?$/, '/')}`;
    }

    // 2. Explicit page suffixes (e.g. /chapter-1/page-2/ or /ch1/p5 or /chapter-1/p-2/)
    if (/\/(?:page|p)[-_]?\d+\/?$/i.test(url.pathname)) {
      return `${url.origin}${url.pathname.replace(/\/(?:page|p)[-_]?\d+\/?$/i, '/')}`;
    }

    // 3. Webtoon / SPA chapter: remove page-specific query parameters while preserving chapter path/hash
    url.searchParams.delete('page');
    url.searchParams.delete('p');
    return `${url.origin}${url.pathname}${url.search ? url.search : ''}${url.hash || ''}`;
  } catch {
    return rawUrl.split('?')[0].split('#')[0];
  }
}


/**
 * Normalizes user-defined site selector rules.
 *
 * @param rawRules - Stored array or unknown input.
 * @returns Clean list of valid site selector rules, deduplicated by domain.
 */
export function normalizeSiteRules(rawRules: unknown): SiteSelectorRule[] {
  if (!Array.isArray(rawRules)) return [];
  const seenDomains = new Set<string>();
  const rules: SiteSelectorRule[] = [];

  for (const item of rawRules) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<SiteSelectorRule>;
    if (typeof candidate.domain !== 'string' || typeof candidate.selector !== 'string') continue;

    const domain = normalizeDomain(candidate.domain);
    const selector = candidate.selector.trim();

    if (!domain || !isValidCssSelector(selector)) continue;
    if (seenDomains.has(domain)) continue;

    seenDomains.add(domain);
    rules.push({
      domain,
      selector,
      enabled: candidate.enabled !== false,
    });
  }

  return rules;
}

/**
 * Finds the first active custom selector rule matching the given hostname.
 *
 * @param hostname - Current page hostname.
 * @param siteRules - List of configured site selector rules.
 * @returns Matching SiteSelectorRule or undefined.
 */
export function findMatchingSiteRule(
  hostname: string,
  siteRules: readonly SiteSelectorRule[] | undefined
): SiteSelectorRule | undefined {
  if (!hostname || !siteRules || siteRules.length === 0) return undefined;
  const target = normalizeDomain(hostname);
  if (!target) return undefined;

  return siteRules.find((rule) => {
    if (!rule.enabled) return false;
    const ruleDomain = normalizeDomain(rule.domain);
    if (ruleDomain.startsWith('*.')) {
      const root = ruleDomain.slice(2);
      return target === root || target.endsWith(`.${root}`);
    }
    return target === ruleDomain;
  });
}
