export const MIN_MEDIA_WIDTH_PX = 150;
export const MIN_MEDIA_HEIGHT_PX = 150;
const MAX_SURFACE_ANCESTOR_DEPTH = 3;
const RECT_SIZE_TOLERANCE_RATIO = 0.2;
const SRCSET_URL_SEPARATOR = ',';
const SRCSET_DESCRIPTOR_SEPARATOR = /\s+/;
const SRCSET_WIDTH_DESCRIPTOR = /^(\d+(?:\.\d+)?)w$/;
const SRCSET_DENSITY_DESCRIPTOR = /^(\d+(?:\.\d+)?)x$/;

export interface MediaTarget {
  imgElement: HTMLImageElement;
  surfaceElement: HTMLElement;
  srcUrl: string;
  hiddenBacking: boolean;
}

/**
 * Reapplies translated visibility and associated background suppression after host style reversion.
 *
 * @param img - Translated image carrying Kites applied-style attributes.
 * @param surfaceElement - Visible media surface associated with the image.
 * @returns Nothing.
 */
export function reapplyMediaTargetStyles(img: HTMLImageElement, surfaceElement: HTMLElement): void {
  const opacity = img.getAttribute('data-kites-applied-opacity');
  const zIndex = img.getAttribute('data-kites-applied-z-index');
  const pointerEvents = img.getAttribute('data-kites-applied-pointer-events');
  if (opacity !== null) {
    img.style.opacity = opacity;
    img.style.visibility = 'visible';
  }
  if (zIndex !== null) img.style.zIndex = zIndex;
  if (pointerEvents !== null) img.style.pointerEvents = pointerEvents;
  if (surfaceElement.getAttribute('data-kites-background-suppressed') === 'true') {
    surfaceElement.style.backgroundImage = 'none';
  }
}

/**
 * Normalizes a media URL by removing query and hash components.
 *
 * @param url - URL to normalize.
 * @returns URL suitable for source identity comparisons.
 */
export function normalizeMediaUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url, window.location.href);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

/**
 * Selects the highest-value URL candidate from an image srcset value.
 * Width descriptors rank by pixels and density descriptors rank by scale, independent of input order.
 *
 * @param srcset - Responsive source candidate list.
 * @returns Highest-value candidate URL, or an empty string when no candidate exists.
 */
function resolveBestSrcsetUrl(srcset: string): string {
  return srcset
    .split(SRCSET_URL_SEPARATOR)
    .map((candidate, index) => {
      const [url = '', descriptor = ''] = candidate.trim().split(SRCSET_DESCRIPTOR_SEPARATOR);
      const width = descriptor.match(SRCSET_WIDTH_DESCRIPTOR);
      const density = descriptor.match(SRCSET_DENSITY_DESCRIPTOR);
      return { url, score: Number(width?.[1] || density?.[1] || 0), index };
    })
    .filter((candidate) => Boolean(candidate.url))
    .sort((first, second) => second.score - first.score || second.index - first.index)[0]?.url || '';
}

/**
 * Resolves the best available original source from native and lazy image attributes.
 *
 * @param img - Image whose source should be resolved.
 * @returns First usable currentSrc, src, srcset, or lazy-load URL.
 */
export function resolveImageSource(img: HTMLImageElement): string {
  const directCandidates = [img.currentSrc, img.src, img.getAttribute('src') || ''];
  for (const candidate of directCandidates) {
    if (candidate) return candidate;
  }

  const responsiveCandidate = resolveBestSrcsetUrl(img.srcset || img.getAttribute('srcset') || '');
  if (responsiveCandidate) return responsiveCandidate;

  const lazyAttributes = [
    'data-src',
    'data-original',
    'data-lazy-src',
    'data-actual-src',
    'data-url',
    'data-origin',
    'data-full-image',
    'data-real-src',
  ];
  for (const attribute of lazyAttributes) {
    const value = img.getAttribute(attribute);
    if (value) return value;
  }
  return '';
}

/**
 * Tests whether an element has a rendered rectangle large enough for translation.
 *
 * @param element - Candidate visible media surface.
 * @returns Whether rendered dimensions meet minimum media thresholds.
 */
function hasEligibleRect(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width >= MIN_MEDIA_WIDTH_PX && rect.height >= MIN_MEDIA_HEIGHT_PX;
}

/**
 * Tests whether a rendered element contains a viewport point.
 *
 * @param element - Rendered element whose rectangle should be tested.
 * @param clientX - Horizontal viewport coordinate.
 * @param clientY - Vertical viewport coordinate.
 * @returns Whether the point falls within the element rectangle, including its edges.
 */
export function surfaceContainsPoint(element: Element, clientX: number, clientY: number): boolean {
  const rect = element.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

/**
 * Tests whether an element is visibly rendered by computed CSS.
 *
 * @param element - Candidate surface element.
 * @returns Whether CSS allows the element to remain visible.
 */
function isVisibleElement(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/**
 * Extracts normalized URL values from a CSS background-image declaration.
 *
 * @param backgroundImage - Computed or inline background-image value.
 * @returns Normalized image URLs found in the declaration.
 */
function getBackgroundUrls(backgroundImage: string): string[] {
  return Array.from(backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g), (match) => normalizeMediaUrl(match[1]));
}

/**
 * Tests whether two rendered rectangles have approximately matching dimensions.
 *
 * @param first - First rectangle.
 * @param second - Second rectangle.
 * @returns Whether width and height differ only within the structural tolerance.
 */
function haveSimilarSize(first: DOMRect, second: DOMRect): boolean {
  const widthBase = Math.max(first.width, second.width);
  const heightBase = Math.max(first.height, second.height);
  return widthBase > 0 && heightBase > 0
    && Math.abs(first.width - second.width) / widthBase <= RECT_SIZE_TOLERANCE_RATIO
    && Math.abs(first.height - second.height) / heightBase <= RECT_SIZE_TOLERANCE_RATIO;
}

/**
 * Finds a visible ancestor surface structurally associated with a hidden backing image.
 * Association requires either a matching background URL or approximately matching media geometry.
 *
 * @param img - Hidden backing image candidate.
 * @param srcUrl - Resolved backing image source.
 * @returns Associated visible surface, or null when evidence is insufficient.
 */
function findAssociatedSurface(img: HTMLImageElement, srcUrl: string): HTMLElement | null {
  const normalizedSource = normalizeMediaUrl(srcUrl);
  const imageRect = img.getBoundingClientRect();
  let ancestor = img.parentElement;
  let depth = 0;

  while (ancestor && depth < MAX_SURFACE_ANCESTOR_DEPTH) {
    const style = window.getComputedStyle(ancestor);
    const backgroundMatches = getBackgroundUrls(style.backgroundImage).includes(normalizedSource);
    const geometryMatches = imageRect.width > 0 && imageRect.height > 0
      && haveSimilarSize(imageRect, ancestor.getBoundingClientRect());
    if (isVisibleElement(ancestor) && hasEligibleRect(ancestor) && (backgroundMatches || geometryMatches)) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
    depth += 1;
  }
  return null;
}

/**
 * Converts an image element into a validated media target.
 * Ordinary visible images preserve their existing image-as-surface behavior; hidden backing images
 * require structural association with a visible ancestor surface.
 *
 * @param img - Candidate image element.
 * @returns Validated media target, or null when the image is unsupported.
 */
export function createMediaTarget(img: HTMLImageElement): MediaTarget | null {
  const srcUrl = resolveImageSource(img);
  if (!srcUrl) return null;

  if (isVisibleElement(img) && hasEligibleRect(img)) {
    return { imgElement: img, surfaceElement: img, srcUrl, hiddenBacking: false };
  }

  const surfaceElement = findAssociatedSurface(img, srcUrl);
  return surfaceElement
    ? { imgElement: img, surfaceElement, srcUrl, hiddenBacking: true }
    : null;
}

/**
 * Discovers document media targets and removes duplicates sharing one backing image or surface.
 *
 * @param root - Document or subtree to scan.
 * @returns Unique validated media targets.
 */
export function discoverMediaTargets(root: ParentNode = document): MediaTarget[] {
  const seenImages = new Set<HTMLImageElement>();
  const seenSurfaces = new Set<HTMLElement>();
  const targets: MediaTarget[] = [];

  for (const img of Array.from(root.querySelectorAll('img'))) {
    const target = createMediaTarget(img);
    if (!target || seenImages.has(target.imgElement) || seenSurfaces.has(target.surfaceElement)) continue;
    seenImages.add(target.imgElement);
    seenSurfaces.add(target.surfaceElement);
    targets.push(target);
  }
  return targets;
}

/**
 * Resolves the best media target for a hover event using direct, composed-path, point-hit,
 * and narrow wrapper-descendant candidates, preferring the largest eligible surface.
 *
 * @param event - Mouse event used for target and pointer information.
 * @returns Largest matching media target, or null when no supported media exists.
 */
export function resolveHoverMediaTarget(event: MouseEvent): MediaTarget | null {
  const elements = new Set<Element>();
  if (event.target instanceof Element) elements.add(event.target);
  for (const node of event.composedPath()) {
    if (node instanceof Element) elements.add(node);
  }
  for (const element of document.elementsFromPoint?.(event.clientX, event.clientY) || []) {
    elements.add(element);
  }

  const images = new Set<HTMLImageElement>();
  for (const element of elements) {
    if (element instanceof HTMLImageElement) images.add(element);
    for (const img of Array.from(element.querySelectorAll<HTMLImageElement>(':scope > img, :scope > picture > img'))) {
      images.add(img);
    }
  }

  return Array.from(images)
    .map(createMediaTarget)
    .filter((target): target is MediaTarget => target !== null)
    .filter((target) => surfaceContainsPoint(target.surfaceElement, event.clientX, event.clientY))
    .sort((first, second) => {
      const firstRect = first.surfaceElement.getBoundingClientRect();
      const secondRect = second.surfaceElement.getBoundingClientRect();
      return secondRect.width * secondRect.height - firstRect.width * firstRect.height;
    })[0] || null;
}
