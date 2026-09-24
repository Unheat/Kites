export const MIN_MEDIA_WIDTH_PX = 150;
export const MIN_MEDIA_HEIGHT_PX = 150;
const MAX_SURFACE_ANCESTOR_DEPTH = 3;
const RECT_SIZE_TOLERANCE_RATIO = 0.2;
const POINTER_TOLERANCE_PX = 3;
const SRCSET_URL_SEPARATOR = ',';
const SRCSET_DESCRIPTOR_SEPARATOR = /\s+/;
const SRCSET_WIDTH_DESCRIPTOR = /^(\d+(?:\.\d+)?)w$/;
const SRCSET_DENSITY_DESCRIPTOR = /^(\d+(?:\.\d+)?)x$/;
const LAZY_SOURCE_ATTRIBUTE = /(?:^|[-_:])(src|srcset|url|image|original|highres|full)(?:$|[-_:])/i;
const PLACEHOLDER_SOURCE = /(?:blank|placeholder|spacer|spinner|loading|shimmer|blurhash|1x1)/i;
const MEDIA_SELECTOR = 'img, svg image';
const CSS_IMAGE_URL = /url\(["']?([^"')]+)["']?\)/g;

export type MediaTargetKind = 'img' | 'background' | 'svg-image';

export interface MediaTarget {
  kind: MediaTargetKind;
  imgElement?: HTMLImageElement;
  sourceElement: Element;
  surfaceElement: HTMLElement;
  anchorElement: HTMLElement;
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
 * Tests whether a URL is a known loading or empty placeholder.
 *
 * WORKAROUND: [Inline SVG placeholder backgrounds outrank real pages] -> Manga readers
 * (e.g. roliascan.com) render every lazy page inside a container whose ::before
 * pseudo-element carries the loading icon as `background-image: url("data:image/svg+xml;base64,...")`.
 * That icon is 500+ base64 characters, so the old `length < 300` heuristic accepted it as
 * real content; the container (larger than the img) then won hover resolution and the
 * placeholder itself was queued for translation -- every lazy page after the first (eager)
 * one failed to translate. Inline SVG data URLs are always UI icons or placeholders in
 * this context (real manga pages are raster), so all of them are treated as placeholders
 * and filtered out of every source tier, including background-image targets. A genuine
 * inline SVG <img> with no other source is still returned by resolveElementSource's final
 * direct-candidate fallback.
 *
 * @param url - Candidate image URL.
 * @returns Whether the URL should be ignored in favor of another source.
 */
function isPlaceholderSource(url: string): boolean {
  if (!url) return true;
  if (url.startsWith('data:image/svg+xml')) return true;
  if (url.startsWith('data:image/gif;base64,R0lGODlhAQAB')) return true;
  return PLACEHOLDER_SOURCE.test(url);
}

/**
 * Selects the highest-value URL candidate from an image srcset value.
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
 * Resolves an image-like element's best native, responsive, SVG, or lazy source.
 *
 * @param element - Image or SVG image whose source should be resolved.
 * @returns Best usable source URL, or an empty string.
 */
export function resolveElementSource(element: Element): string {
  const directCandidates: string[] = [];
  if (element instanceof HTMLImageElement) {
    directCandidates.push(element.currentSrc, element.src, element.getAttribute('src') || '');
  } else {
    directCandidates.push(element.getAttribute('href') || '', element.getAttribute('xlink:href') || '');
  }

  // WORKAROUND: [Long inline SVG lazy placeholders] -> Manga readers (e.g. roliascan.com)
  // lazy-load pages with <img src="data:image/svg+xml;base64,..."> icons plus data-src
  // holding the real page URL. The PLACEHOLDER_SOURCE / 300-char heuristics only recognize
  // short SVG placeholders, so the long icon URL was accepted as a real source and queued
  // for translation instead of the actual page -- every lazy-loaded image after the first
  // (eager) one failed to translate. Two demotions fix the ordering: inline SVG data URLs
  // fall through to the srcset/lazy-attribute tiers, and the lazy tier ignores the native
  // src/srcset attributes (they are already the direct candidates; LAZY_SOURCE_ATTRIBUTE's
  // pattern also matches bare 'src', which let the placeholder re-enter as a "lazy" hit).
  // A genuine inline SVG image with no other source is still returned by the final
  // directCandidates fallback.
  const realDirect = directCandidates.find((candidate) =>
    candidate && !isPlaceholderSource(candidate) && !candidate.startsWith('data:image/svg+xml'));
  if (realDirect) return realDirect;

  const srcsets = [element.getAttribute('srcset') || ''];
  if (element.parentElement instanceof HTMLPictureElement) {
    for (const source of Array.from(element.parentElement.querySelectorAll('source'))) {
      srcsets.push(source.srcset, source.getAttribute('data-srcset') || '');
    }
  }
  for (const srcset of srcsets) {
    const candidate = resolveBestSrcsetUrl(srcset);
    if (candidate && !isPlaceholderSource(candidate)) return candidate;
  }

  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === 'src' || attribute.name === 'srcset') continue;
    if (!LAZY_SOURCE_ATTRIBUTE.test(attribute.name)) continue;
    const candidate = attribute.name.toLowerCase().includes('srcset')
      ? resolveBestSrcsetUrl(attribute.value)
      : attribute.value.trim();
    if (candidate && !isPlaceholderSource(candidate)) return candidate;
  }
  return directCandidates.find(Boolean) || '';
}

/**
 * Resolves the best available original source from native and lazy image attributes.
 *
 * @param img - Image whose source should be resolved.
 * @returns First usable currentSrc, src, srcset, or lazy-load URL.
 */
export function resolveImageSource(img: HTMLImageElement): string {
  return resolveElementSource(img);
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
 * @returns Whether the point falls within the element rectangle.
 */
export function surfaceContainsPoint(element: Element, clientX: number, clientY: number): boolean {
  const rect = element.getBoundingClientRect();
  return clientX >= rect.left - POINTER_TOLERANCE_PX
    && clientX <= rect.right + POINTER_TOLERANCE_PX
    && clientY >= rect.top - POINTER_TOLERANCE_PX
    && clientY <= rect.bottom + POINTER_TOLERANCE_PX;
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
 * Extracts URL values from a CSS image declaration.
 *
 * @param backgroundImage - Computed image declaration.
 * @returns Absolute image URLs found in the declaration.
 */
export function getBackgroundUrls(backgroundImage: string): string[] {
  return Array.from(backgroundImage.matchAll(CSS_IMAGE_URL), (match) => {
    try {
      return new URL(match[1], window.location.href).href;
    } catch {
      return match[1];
    }
  }).filter((url) => !isPlaceholderSource(url));
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
    const backgroundMatches = getBackgroundUrls(style.backgroundImage).some((url) => normalizeMediaUrl(url) === normalizedSource);
    const geometryMatches = imageRect.width > 0 && imageRect.height > 0
      && haveSimilarSize(imageRect, ancestor.getBoundingClientRect());
    if (isVisibleElement(ancestor) && hasEligibleRect(ancestor) && (backgroundMatches || geometryMatches)) return ancestor;
    ancestor = ancestor.parentElement;
    depth += 1;
  }
  return null;
}

/**
 * Resolves a document-tree anchor for CSS anchor positioning.
 *
 * @param surface - Actual visible media surface.
 * @returns Surface, SVG container, or Shadow DOM host visible to Kites' overlay root.
 */
function resolveAnchorElement(surface: Element): HTMLElement | null {
  let anchor: Element = surface instanceof SVGElement ? surface.ownerSVGElement || surface : surface;
  let root = anchor.getRootNode();
  while (root instanceof ShadowRoot) {
    anchor = root.host;
    root = anchor.getRootNode();
  }
  return anchor instanceof HTMLElement ? anchor : null;
}

/**
 * Converts an image element into a validated media target.
 *
 * @param img - Candidate image element.
 * @returns Validated media target, or null when unsupported.
 */
export function createMediaTarget(img: HTMLImageElement): MediaTarget | null {
  const srcUrl = resolveImageSource(img);
  if (!srcUrl) return null;
  const surfaceElement = isVisibleElement(img) && hasEligibleRect(img) ? img : findAssociatedSurface(img, srcUrl);
  if (!surfaceElement) return null;
  const anchorElement = resolveAnchorElement(surfaceElement);
  return anchorElement ? {
    kind: 'img',
    imgElement: img,
    sourceElement: img,
    surfaceElement,
    anchorElement,
    srcUrl,
    hiddenBacking: surfaceElement !== img,
  } : null;
}

/**
 * Converts a CSS background or SVG image into a validated media target.
 *
 * @param element - Candidate rendered element.
 * @returns Validated target, or null when no usable image exists.
 */
function createNonHtmlImageTarget(element: Element): MediaTarget | null {
  if (!hasEligibleRect(element) || !isVisibleElement(element)) return null;
  const isSvgImage = element instanceof SVGElement
    && element.localName === 'image'
    && element.namespaceURI === 'http://www.w3.org/2000/svg';
  const sourceElement = element;
  const surfaceElement = isSvgImage ? element.ownerSVGElement?.parentElement : element;
  if (!(surfaceElement instanceof HTMLElement)) return null;
  const srcUrl = isSvgImage
    ? resolveElementSource(element)
    : getBackgroundUrls(window.getComputedStyle(element).backgroundImage)[0]
      || getBackgroundUrls(window.getComputedStyle(element, '::before').backgroundImage)[0]
      || getBackgroundUrls(window.getComputedStyle(element, '::after').backgroundImage)[0]
      || '';
  const anchorElement = resolveAnchorElement(surfaceElement);
  if (!srcUrl || !anchorElement) return null;
  return {
    kind: isSvgImage ? 'svg-image' : 'background',
    sourceElement,
    surfaceElement,
    anchorElement,
    srcUrl,
    hiddenBacking: false,
  };
}

/**
 * Recursively yields normal DOM and open Shadow DOM roots.
 *
 * @param root - Root whose descendants should be inspected.
 * @returns Every reachable query root.
 */
export function collectQueryRoots(root: ParentNode): ParentNode[] {
  const roots: ParentNode[] = [root];
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (element.shadowRoot) roots.push(...collectQueryRoots(element.shadowRoot));
  }
  return roots;
}

/**
 * Discovers document media targets and removes duplicates sharing one source or surface.
 *
 * @param root - Document or subtree to scan.
 * @returns Unique validated media targets.
 */
export function discoverMediaTargets(root: ParentNode = document): MediaTarget[] {
  const seenSurfaces = new Set<HTMLElement>();
  const targets: MediaTarget[] = [];
  for (const queryRoot of collectQueryRoots(root)) {
    for (const element of Array.from(queryRoot.querySelectorAll('*'))) {
      const target = element instanceof HTMLImageElement ? createMediaTarget(element) : createNonHtmlImageTarget(element);
      if (!target || seenSurfaces.has(target.surfaceElement)) continue;
      seenSurfaces.add(target.surfaceElement);
      targets.push(target);
    }
  }
  return targets;
}

/**
 * Resolves hover media using composed paths, point hit-testing, descendants, and CSS backgrounds.
 *
 * @param event - Mouse event used for target and pointer information.
 * @returns Largest matching media target, or null.
 */
export function resolveHoverMediaTarget(event: MouseEvent): MediaTarget | null {
  const elements = new Set<Element>();
  if (event.target instanceof Element) elements.add(event.target);
  for (const node of event.composedPath()) if (node instanceof Element) elements.add(node);
  for (const element of document.elementsFromPoint?.(event.clientX, event.clientY) || []) elements.add(element);

  const targets: MediaTarget[] = [];
  for (const element of elements) {
    const directTarget = element instanceof HTMLImageElement
      ? createMediaTarget(element)
      : createNonHtmlImageTarget(element);
    if (directTarget) targets.push(directTarget);
    for (const child of Array.from(element.querySelectorAll(MEDIA_SELECTOR))) {
      const childTarget = child instanceof HTMLImageElement ? createMediaTarget(child) : createNonHtmlImageTarget(child);
      if (childTarget) targets.push(childTarget);
    }
  }

  return targets
    .filter((target, index) => targets.findIndex((candidate) => candidate.surfaceElement === target.surfaceElement) === index)
    .filter((target) => surfaceContainsPoint(target.surfaceElement, event.clientX, event.clientY))
    .sort((first, second) => {
      const firstRect = first.surfaceElement.getBoundingClientRect();
      const secondRect = second.surfaceElement.getBoundingClientRect();
      return secondRect.width * secondRect.height - firstRect.width * firstRect.height;
    })[0] || null;
}
