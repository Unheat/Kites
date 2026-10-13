// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  sortScannedImages,
  filterOutlierThumbnails,
  filterResolutionOutliers,
  scanChapterPages,
  type ScannedPageImage,
} from './scanner';

describe('scanner unit tests', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('sorts images spatially by top coordinate first, then left, with numeric tiebreaker', () => {
    const raw: ScannedPageImage[] = [
      { id: '3', url: 'https://example.com/p10.jpg', width: 800, height: 1200, top: 1500, left: 0, isTranslated: false },
      { id: '1', url: 'https://example.com/p2.jpg', width: 800, height: 1200, top: 100, left: 10, isTranslated: false },
      { id: '2', url: 'https://example.com/p1.jpg', width: 800, height: 1200, top: 100, left: 0, isTranslated: false },
      { id: '4', url: 'https://example.com/p3.jpg', width: 800, height: 1200, top: 800, left: 0, isTranslated: false },
    ];

    const sorted = sortScannedImages(raw);
    expect(sorted.map((s) => s.url)).toEqual([
      'https://example.com/p1.jpg',
      'https://example.com/p2.jpg',
      'https://example.com/p3.jpg',
      'https://example.com/p10.jpg',
    ]);
  });

  it('filters outlier recommendation thumbnails when full-sized manga panels dominate chapter reader', () => {
    const images: ScannedPageImage[] = [
      { id: '1', url: 'https://example.com/p1.jpg', width: 800, height: 1200, top: 0, left: 0, isTranslated: false },
      { id: '2', url: 'https://example.com/p2.jpg', width: 800, height: 1200, top: 1200, left: 0, isTranslated: false },
      { id: '3', url: 'https://example.com/p3.jpg', width: 800, height: 1200, top: 2400, left: 0, isTranslated: false },
      { id: 'thumb', url: 'https://example.com/rec-thumb.jpg', width: 180, height: 240, top: 3600, left: 0, isTranslated: false },
    ];

    const filtered = filterOutlierThumbnails(images);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((f) => f.id)).toEqual(['1', '2', '3']);
  });

  it('preserves all manga covers on gallery and artist catalog pages', () => {
    const galleryCovers: ScannedPageImage[] = [
      { id: '1', url: 'https://t.nhentai.net/1.jpg', width: 250, height: 350, top: 0, left: 0, isTranslated: false },
      { id: '2', url: 'https://t.nhentai.net/2.jpg', width: 250, height: 350, top: 0, left: 260, isTranslated: false },
      { id: '3', url: 'https://t.nhentai.net/3.jpg', width: 250, height: 350, top: 360, left: 0, isTranslated: false },
      { id: '4', url: 'https://t.nhentai.net/4.jpg', width: 250, height: 350, top: 360, left: 260, isTranslated: false },
    ];

    const filtered = filterOutlierThumbnails(galleryCovers);
    expect(filtered).toHaveLength(4);
    expect(filtered.map((f) => f.id)).toEqual(['1', '2', '3', '4']);
  });

  it('filters resolution outliers (short wide banner ads)', () => {
    const images: ScannedPageImage[] = [
      { id: '1', url: 'https://example.com/p1.jpg', width: 800, height: 1200, top: 0, left: 0, isTranslated: false },
      { id: 'banner', url: 'https://example.com/banner.jpg', width: 728, height: 90, top: 1250, left: 0, isTranslated: false },
      { id: '2', url: 'https://example.com/p2.jpg', width: 800, height: 1200, top: 1400, left: 0, isTranslated: false },
    ];

    const filtered = filterResolutionOutliers(images);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((f) => f.id)).toEqual(['1', '2']);
  });

  it('scans DOM, deduplicates, and marks already-translated pages', () => {
    const img1 = document.createElement('img');
    img1.src = 'https://example.com/chapter/1.jpg';
    vi.spyOn(img1, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 1200, width: 800, height: 1200, toJSON: () => ({}),
    } as DOMRect);

    const img2 = document.createElement('img');
    img2.src = 'https://example.com/chapter/2.jpg';
    img2.setAttribute('data-kites-translated', 'true');
    vi.spyOn(img2, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 1200, top: 1200, left: 0, right: 800, bottom: 2400, width: 800, height: 1200, toJSON: () => ({}),
    } as DOMRect);

    document.body.appendChild(img1);
    document.body.appendChild(img2);

    const checkTranslated = (url: string) => {
      if (url.includes('2.jpg')) {
        return { isTranslated: true, translatedUrl: 'blob:translated-2' };
      }
      return { isTranslated: false };
    };

    const scanned = scanChapterPages(document, undefined, checkTranslated);
    expect(scanned).toHaveLength(2);
    expect(scanned[0].url).toBe('https://example.com/chapter/1.jpg');
    expect(scanned[0].isTranslated).toBe(false);
    expect(scanned[1].url).toBe('https://example.com/chapter/2.jpg');
    expect(scanned[1].isTranslated).toBe(true);
    expect(scanned[1].translatedUrl).toBe('blob:translated-2');
  });
});
