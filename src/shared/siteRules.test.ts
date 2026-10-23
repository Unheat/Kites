import { describe, it, expect } from 'vitest';
import {
  normalizeDomain,
  isDomainDisabled,
  normalizeDisabledDomains,
  isValidCssSelector,
  normalizeSiteRules,
  findMatchingSiteRule,
  MANGA_READER_CONTAINER_SELECTORS,
  getChapterScopeId,
  hasMangaReaderContainer,
} from './siteRules';

describe('siteRules utilities', () => {
  describe('normalizeDomain', () => {
    it('normalizes full URLs to lowercase hostnames', () => {
      expect(normalizeDomain('https://MangaDex.org/chapter/123')).toBe('mangadex.org');
      expect(normalizeDomain('http://sub.domain.co.uk:8080/read')).toBe('sub.domain.co.uk');
      expect(normalizeDomain('HTTPS://TEST.COM?foo=bar#hash')).toBe('test.com');
    });

    it('normalizes bare hostnames with mixed case or trailing slashes', () => {
      expect(normalizeDomain('  MangaDex.Org/ ')).toBe('mangadex.org');
      expect(normalizeDomain('readmanga.today:443')).toBe('readmanga.today');
    });

    it('returns empty string for invalid input', () => {
      expect(normalizeDomain('')).toBe('');
      expect(normalizeDomain(null as any)).toBe('');
      expect(normalizeDomain(undefined as any)).toBe('');
    });
  });

  describe('isDomainDisabled', () => {
    const disabled = ['mangadex.org', '*.bato.to', 'rawkuma.net'];

    it('matches exact domains case-insensitively', () => {
      expect(isDomainDisabled('mangadex.org', disabled)).toBe(true);
      expect(isDomainDisabled('MangaDex.ORG', disabled)).toBe(true);
      expect(isDomainDisabled('https://mangadex.org/chapter/1', disabled)).toBe(true);
    });

    it('supports wildcard subdomain matching', () => {
      expect(isDomainDisabled('bato.to', disabled)).toBe(true);
      expect(isDomainDisabled('mto.bato.to', disabled)).toBe(true);
      expect(isDomainDisabled('v3.bato.to', disabled)).toBe(true);
      expect(isDomainDisabled('notbato.to', disabled)).toBe(false);
    });

    it('returns false for enabled domains or empty lists', () => {
      expect(isDomainDisabled('asurascans.com', disabled)).toBe(false);
      expect(isDomainDisabled('mangadex.org', [])).toBe(false);
      expect(isDomainDisabled('mangadex.org', undefined)).toBe(false);
    });
  });

  describe('normalizeDisabledDomains', () => {
    it('cleans, normalizes, and deduplicates domain arrays', () => {
      const raw = [' MangaDex.Org ', 'mangadex.org', 'https://bato.to/read', '', 123, null];
      expect(normalizeDisabledDomains(raw)).toEqual(['mangadex.org', 'bato.to']);
    });

    it('handles non-array inputs gracefully', () => {
      expect(normalizeDisabledDomains(null)).toEqual([]);
      expect(normalizeDisabledDomains('not-array')).toEqual([]);
    });
  });

  describe('isValidCssSelector', () => {
    it('accepts standard CSS selectors', () => {
      expect(isValidCssSelector('#readerarea img')).toBe(true);
      expect(isValidCssSelector('div.reading-content > img.page-image')).toBe(true);
      expect(isValidCssSelector('.viewer-cnt img, [data-page] img')).toBe(true);
    });

    it('rejects suspicious or malformed characters', () => {
      expect(isValidCssSelector('<script>')).toBe(false);
      expect(isValidCssSelector('{display:none}')).toBe(false);
      expect(isValidCssSelector('\\bad-escape')).toBe(false);
      expect(isValidCssSelector('')).toBe(false);
      expect(isValidCssSelector('   ')).toBe(false);
    });
  });

  describe('normalizeSiteRules', () => {
    it('validates rules, trims, deduplicates by domain', () => {
      const raw = [
        { domain: 'MangaDex.Org', selector: ' #readerarea img ', enabled: true },
        { domain: 'mangadex.org', selector: 'div.dup img', enabled: true },
        { domain: '', selector: 'img', enabled: true },
        { domain: 'bato.to', selector: '<bad-selector>', enabled: true },
        { domain: 'rawkuma.net', selector: '.reading-content img', enabled: false },
        null,
      ];

      expect(normalizeSiteRules(raw)).toEqual([
        { domain: 'mangadex.org', selector: '#readerarea img', enabled: true },
        { domain: 'rawkuma.net', selector: '.reading-content img', enabled: false },
      ]);
    });
  });

  describe('findMatchingSiteRule', () => {
    const rules = [
      { domain: 'mangadex.org', selector: '#readerarea img', enabled: true },
      { domain: '*.bato.to', selector: 'div.reading-content img', enabled: true },
      { domain: 'disabled.com', selector: '.viewer img', enabled: false },
    ];

    it('matches exact active domain rule', () => {
      const rule = findMatchingSiteRule('https://mangadex.org/chapter/1', rules);
      expect(rule).toBeDefined();
      expect(rule?.selector).toBe('#readerarea img');
    });

    it('matches wildcard subdomain rule', () => {
      const rule = findMatchingSiteRule('mto.bato.to', rules);
      expect(rule).toBeDefined();
      expect(rule?.selector).toBe('div.reading-content img');
    });

    it('ignores disabled rules and non-matching domains', () => {
      expect(findMatchingSiteRule('disabled.com', rules)).toBeUndefined();
      expect(findMatchingSiteRule('other.com', rules)).toBeUndefined();
    });
  });

  describe('MANGA_READER_CONTAINER_SELECTORS', () => {
    it('contains XianScan reader container selectors', () => {
      expect(MANGA_READER_CONTAINER_SELECTORS).toContain('#readerarea');
      expect(MANGA_READER_CONTAINER_SELECTORS).toContain('div[class*="reading-content"]');
      expect(MANGA_READER_CONTAINER_SELECTORS).toContain('div[class*="wt_viewer"]');
    });

    it('detects manga reader container elements in DOM subtrees', () => {
      const container = document.createElement('div');
      expect(hasMangaReaderContainer(container)).toBe(false);

      const readerDiv = document.createElement('div');
      readerDiv.id = 'readerarea';
      container.appendChild(readerDiv);
      expect(hasMangaReaderContainer(container)).toBe(true);
    });
  });

  describe('getChapterScopeId', () => {
    it('normalizes paginated gallery readers to the common book root', () => {
      expect(getChapterScopeId('https://nhentai.net/g/677759/6/')).toBe('https://nhentai.net/g/677759/');
      expect(getChapterScopeId('https://nhentai.net/g/677759/7/')).toBe('https://nhentai.net/g/677759/');
      expect(getChapterScopeId('https://nhentai.net/g/677759/6')).toBe('https://nhentai.net/g/677759/');
    });

    it('normalizes generic paginated manga reader URLs', () => {
      expect(getChapterScopeId('https://example.com/manga/title/chapter-1/page-2/')).toBe(
        'https://example.com/manga/title/chapter-1/'
      );
      expect(getChapterScopeId('https://example.com/ch1/p5')).toBe('https://example.com/ch1/');
    });

    it('strips query parameters and preserves chapter routing from webtoon URLs', () => {
      expect(getChapterScopeId('https://mangadex.org/chapter/abcdef?page=3#header')).toBe(
        'https://mangadex.org/chapter/abcdef#header'
      );
      expect(getChapterScopeId('https://example.com/read/105?p=2&mode=webtoon')).toBe(
        'https://example.com/read/105?mode=webtoon'
      );
    });

    it('handles empty or malformed input gracefully', () => {
      expect(getChapterScopeId('')).toBe('');
      expect(getChapterScopeId(null as any)).toBe('');
      expect(getChapterScopeId('just-a-plain-string')).toBe('just-a-plain-string');
    });
  });
});
