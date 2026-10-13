import {
  discoverMediaTargets,
  isPlaceholderSource,
  normalizeMediaUrl,
} from './mediaTargets';

export interface ScannedPageImage {
  id: string;
  url: string;
  width: number;
  height: number;
  top: number;
  left: number;
  isTranslated: boolean;
  translatedUrl?: string;
}

const LAZY_IMAGE_ATTRIBUTES = [
  'data-src',
  'data-original',
  'data-url',
  'data-lazy-src',
  'data-actual-src',
  'data-full-image',
  'data-real-src',
  'data-origin',
];

/**
 * Filter outlier thumbnails (such as recommendation widget covers or thumbnails)
 * when the manga strip has full-sized comic panels.
 * Ported from XianScan sorter.ts.
 *
 * @param images - Scanned image candidates.
 * @returns Filtered array without thumbnail noise.
 */
export function filterOutlierThumbnails(images: ScannedPageImage[]): ScannedPageImage[] {
  if (images.length < 2) return images;

  const hasLargePanels = images.some((i) => i.height >= 600 || i.width >= 500);
  if (hasLargePanels) {
    return images.filter((img) => {
      if (img.height >= 600) return true;
      if (img.width > 0 && img.height > 0 && img.width <= 320 && img.height <= 450) {
        return false;
      }
      return true;
    });
  }
  return images;
}

/**
 * Filters out extreme aspect-ratio resolution outliers (e.g. short horizontal banner ads).
 * Ported from XianScan sorter.ts.
 *
 * @param images - Scanned image candidates.
 * @returns Filtered array without banner ads.
 */
export function filterResolutionOutliers(images: ScannedPageImage[]): ScannedPageImage[] {
  if (images.length < 3) return images;

  return images.filter((img) => {
    if (img.height >= 600) return true;
    if (img.width > 0 && img.height > 0) {
      const ratio = img.width / img.height;
      if (ratio >= 2.5 && img.height <= 260) return false;
      if (img.height <= 50) return false;
    }
    return true;
  });
}

/**
 * Sorts scanned images spatially from top-to-bottom primary, left-to-right secondary,
 * with natural alphanumeric tiebreaker.
 * Ported from XianScan sorter.ts.
 *
 * @param images - Scanned image candidates.
 * @returns Spatially sorted images.
 */
export function sortScannedImages(images: ScannedPageImage[]): ScannedPageImage[] {
  return [...images].sort((first, second) => {
    const topDiff = first.top - second.top;
    if (Math.abs(topDiff) > 20) {
      return topDiff;
    }
    const leftDiff = first.left - second.left;
    if (Math.abs(leftDiff) > 20) {
      return leftDiff;
    }
    return first.url.localeCompare(second.url, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/**
 * Finds a scrollable container inside the manga reading area (if one exists).
 *
 * @param root - Document or root element.
 * @returns Scrollable container HTMLElement or null.
 */
function findScrollableReaderContainer(root: Document = document): HTMLElement | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      '[class*="reader"], [id*="reader"], [class*="viewport"], [class*="scroll-container"], main'
    )
  );
  for (const el of candidates) {
    const style = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (!style) continue;
    const overflowY = style.overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      if (el.scrollHeight > el.clientHeight + 1) {
        return el;
      }
    }
  }
  return null;
}

/**
 * Promotes known lazy-load attributes directly on reader images to trigger instant preloading.
 *
 * @param root - Document or container to promote in.
 * @returns Number of promoted attributes.
 */
export function forcePromoteLazyAttributes(root: Document | Element = document): number {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img, picture img'));
  let promoted = 0;

  for (const img of imgs) {
    for (const attr of LAZY_IMAGE_ATTRIBUTES) {
      const val = img.getAttribute(attr);
      if (val && !isPlaceholderSource(val) && (!img.src || isPlaceholderSource(img.src))) {
        try {
          const absolute = new URL(val, window.location.href).href;
          img.src = absolute;
          promoted++;
          break;
        } catch {}
      }
    }
  }
  return promoted;
}

/**
 * Programmatically scrolls down the page in small increments to trigger lazy-loads
 * and then restores the user's scroll position.
 * Ported from XianScan fastScrollPreload.
 *
 * @param root - Document to scroll.
 * @param customSelector - Optional custom selector override.
 * @param isTranslatedCheck - Optional check if a URL is translated.
 * @returns Scanned images after fast scroll.
 */
export async function fastScrollPreload(
  root: Document = document,
  customSelector?: string,
  isTranslatedCheck?: (url: string) => { isTranslated: boolean; translatedUrl?: string }
): Promise<ScannedPageImage[]> {
  forcePromoteLazyAttributes(root);

  const step = 600;
  const delay = 35;
  const initScrollY = typeof window !== 'undefined' ? window.scrollY : 0;

  type ScrollTarget = {
    getMax: () => number;
    init: number;
    set: (y: number) => void;
  };
  const targets: ScrollTarget[] = [];

  if (typeof window !== 'undefined') {
    targets.push({
      getMax: () => Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0),
      init: initScrollY,
      set: (y) => {
        window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
        window.dispatchEvent(new Event('scroll', { bubbles: true }));
      },
    });
  }

  const inner = findScrollableReaderContainer(root);
  if (inner) {
    targets.push({
      getMax: () => inner.scrollHeight,
      init: inner.scrollTop,
      set: (y) => {
        inner.scrollTop = y;
        inner.dispatchEvent(new Event('scroll', { bubbles: true }));
      },
    });
  }

  for (const target of targets) {
    let currentY = 0;
    let maxCycles = 150; // Cap to 90,000px maximum
    while (currentY < target.getMax() && maxCycles > 0) {
      currentY += step;
      target.set(currentY);
      maxCycles--;

      forcePromoteLazyAttributes(root);
      await new Promise((r) => setTimeout(r, delay));
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('scroll'));
    }
    await new Promise((r) => setTimeout(r, 60));

    target.set(target.init);
  }

  return scanChapterPages(root, customSelector, isTranslatedCheck);
}

/**
 * Scans the active page DOM for eligible manga/comic images, computes their
 * document coordinates, and returns a clean, deduplicated, sorted list.
 *
 * @param root - Document or container to scan.
 * @param customSelector - Optional custom selector override.
 * @param isTranslatedCheck - Optional check if a URL is translated.
 * @returns Ordered array of ScannedPageImage.
 */
export function scanChapterPages(
  root: Document | Element = document,
  customSelector?: string,
  isTranslatedCheck?: (url: string) => { isTranslated: boolean; translatedUrl?: string }
): ScannedPageImage[] {
  const mediaTargets = discoverMediaTargets(root, customSelector);
  const seenUrls = new Set<string>();
  const scanned: ScannedPageImage[] = [];

  const scrollX = typeof window !== 'undefined' ? window.scrollX : 0;
  const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;

  for (const target of mediaTargets) {
    const rawUrl = target.srcUrl;
    if (!rawUrl || isPlaceholderSource(rawUrl)) continue;

    const canonical = normalizeMediaUrl(rawUrl);
    if (seenUrls.has(canonical)) continue;
    seenUrls.add(canonical);

    const el = target.imgElement || target.surfaceElement;
    let width = 0;
    let height = 0;
    let top = 0;
    let left = 0;

    if (el) {
      const rect = el.getBoundingClientRect();
      width = target.imgElement?.naturalWidth || Math.round(rect.width);
      height = target.imgElement?.naturalHeight || Math.round(rect.height);
      top = Math.round(rect.top + scrollY);
      left = Math.round(rect.left + scrollX);
    }

    const check = isTranslatedCheck ? isTranslatedCheck(rawUrl) : { isTranslated: false };
    const hasDomTranslated = el?.getAttribute('data-kites-translated') === 'true';

    scanned.push({
      id: canonical || rawUrl,
      url: rawUrl,
      width,
      height,
      top,
      left,
      isTranslated: check.isTranslated || hasDomTranslated,
      translatedUrl: check.translatedUrl,
    });
  }

  // Filter noise and sort spatially
  const clean = filterResolutionOutliers(filterOutlierThumbnails(scanned));
  return sortScannedImages(clean);
}
