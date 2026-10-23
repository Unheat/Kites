import { AD_NOISE_CONTAINER_SELECTORS, MANGA_READER_CONTAINER_SELECTORS } from '../shared/siteRules';

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
const MEDIA_SELECTOR = 'img, svg image, canvas';
const CSS_IMAGE_URL = /url\(["']?([^"')]+)["']?\)/g;

/** Maximum ancestor depth when searching for hidden/wrapped images during hover fallback. */
const MAX_HOVER_ANCESTOR_DEPTH = 2;
/** Maximum media candidate count to inspect within a single container to prevent feed-wide thrashing. */
const MAX_CONTAINER_MEDIA_ELEMENTS = 12;
/** Selector matching post/card containers that bound individual feed items (e.g. tweets, list items). */
const CARD_CONTAINER_SELECTOR = 'article, [role="article"], li, [data-testid*="cell"], [data-testid*="tweet"]';
/** Canvas DataURL cache TTL in milliseconds to prevent synchronous GPU stalls during hover/scan. */
const CANVAS_DATA_URL_CACHE_TTL_MS = 2000;

interface CanvasCacheEntry {
  url: string;
  width: number;
  height: number;
  timestamp: number;
}
const canvasCache = new WeakMap<HTMLCanvasElement, CanvasCacheEntry>();

export type MediaTargetKind = 'img' | 'background' | 'svg-image' | 'canvas';

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
export function isPlaceholderSource(url: string): boolean {
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
  const origSrc = element.getAttribute('data-kites-orig-src');
  if (origSrc && !isPlaceholderSource(origSrc)) {
    if (element instanceof HTMLImageElement) {
      const appliedSrc = element.getAttribute('data-kites-applied-src');
      const currentSrc = element.currentSrc || element.src || '';
      // If currentSrc is neither applied blob nor origSrc (e.g. host single-page reader navigated to next page),
      // the DOM element has been recycled for a new image. Clear stale Kites attributes so the new image is recognized.
      if (
        currentSrc &&
        !isPlaceholderSource(currentSrc) &&
        currentSrc !== appliedSrc &&
        currentSrc !== origSrc
      ) {
        element.removeAttribute('data-kites-orig-src');
        element.removeAttribute('data-kites-orig-srcset');
        element.removeAttribute('data-kites-applied-src');
        element.removeAttribute('data-kites-translated');
        element.removeAttribute('data-kites-show-original');
        element.removeAttribute('data-kites-job-id');
      } else {
        return origSrc;
      }
    } else {
      return origSrc;
    }
  }

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
  const normalizeCandidateUrl = (url: string): string => {
    if (!url) return '';
    const trimmed = url.trim();
    if (trimmed.startsWith('//')) {
      const proto = typeof window !== 'undefined' && window.location?.protocol.startsWith('http')
        ? window.location.protocol
        : 'https:';
      return `${proto}${trimmed}`;
    }
    return trimmed;
  };

  if (realDirect) return normalizeCandidateUrl(realDirect);

  const srcsets = [element.getAttribute('srcset') || ''];
  if (element.parentElement instanceof HTMLPictureElement) {
    for (const source of Array.from(element.parentElement.querySelectorAll('source'))) {
      srcsets.push(source.srcset, source.getAttribute('data-srcset') || '');
    }
  }
  for (const srcset of srcsets) {
    const candidate = resolveBestSrcsetUrl(srcset);
    if (candidate && !isPlaceholderSource(candidate)) return normalizeCandidateUrl(candidate);
  }

  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === 'src' || attribute.name === 'srcset') continue;
    if (!LAZY_SOURCE_ATTRIBUTE.test(attribute.name)) continue;
    const rawVal = attribute.name.toLowerCase().includes('srcset')
      ? resolveBestSrcsetUrl(attribute.value)
      : attribute.value.trim();
    if (rawVal && !isPlaceholderSource(rawVal)) return normalizeCandidateUrl(rawVal);
  }
  const fallback = directCandidates.find(Boolean) || '';
  return normalizeCandidateUrl(fallback);
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

  if (element instanceof HTMLCanvasElement) {
    const now = Date.now();
    const cached = canvasCache.get(element);
    let srcUrl = '';
    if (cached && cached.width === element.width && cached.height === element.height && (now - cached.timestamp) < CANVAS_DATA_URL_CACHE_TTL_MS) {
      srcUrl = cached.url;
    } else {
      try {
        srcUrl = element.toDataURL('image/png');
        canvasCache.set(element, {
          url: srcUrl,
          width: element.width,
          height: element.height,
          timestamp: now,
        });
      } catch {
        srcUrl = '';
      }
    }
    const anchorElement = resolveAnchorElement(element);
    if (!srcUrl || !anchorElement) return null;
    return {
      kind: 'canvas',
      sourceElement: element,
      surfaceElement: element,
      anchorElement,
      srcUrl,
      hiddenBacking: false,
    };
  }

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
  const doc = (root as Node).ownerDocument || (root instanceof Document ? root : (typeof document !== 'undefined' ? document : null));
  if (doc && typeof doc.createTreeWalker === 'function') {
    const showElement = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_ELEMENT : 1;
    const walker = doc.createTreeWalker(root as Node, showElement);
    let node = walker.nextNode();
    while (node) {
      const el = node as Element;
      if (el.shadowRoot) {
        roots.push(...collectQueryRoots(el.shadowRoot));
      }
      node = walker.nextNode();
    }
    return roots;
  }
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (element.shadowRoot) roots.push(...collectQueryRoots(element.shadowRoot));
  }
  return roots;
}

/**
 * Checks whether an element is located inside an advertisement or noise container,
 * unless it is contained within an established manga reader container.
 *
 * @param element - DOM element to test.
 * @returns Whether the element is likely non-chapter ad/sidebar noise.
 */
export function isElementInNoiseContainer(element: Element): boolean {
  for (const readerSelector of MANGA_READER_CONTAINER_SELECTORS) {
    try {
      if (element.closest(readerSelector)) return false;
    } catch {}
  }
  for (const noiseSelector of AD_NOISE_CONTAINER_SELECTORS) {
    try {
      if (element.closest(noiseSelector)) return true;
    } catch {}
  }
  return false;
}

/**
 * Discovers document media targets and removes duplicates sharing one source or surface.
 * Prioritizes user-configured custom selectors when available, and excludes noise/ad containers.
 *
 * @param root - Document or subtree to scan.
 * @param customSelector - Optional custom CSS selector override matching image elements.
 * @returns Unique validated media targets.
 */
export function discoverMediaTargets(root: ParentNode = document, customSelector?: string): MediaTarget[] {
  const seenSurfaces = new Set<HTMLElement>();
  const targets: MediaTarget[] = [];

  if (customSelector) {
    for (const queryRoot of collectQueryRoots(root)) {
      try {
        for (const element of Array.from(queryRoot.querySelectorAll(customSelector))) {
          const target = element instanceof HTMLImageElement ? createMediaTarget(element) : createNonHtmlImageTarget(element);
          if (!target || seenSurfaces.has(target.surfaceElement)) continue;
          seenSurfaces.add(target.surfaceElement);
          targets.push(target);
        }
      } catch (err) {
        console.warn('[MediaTargets] Custom selector query failed:', err);
      }
    }
    if (targets.length > 0) return targets;
  }

  const MEDIA_QUERY_SELECTOR = 'img, picture img, svg image, [style*="background-image"]';
  for (const queryRoot of collectQueryRoots(root)) {
    for (const element of Array.from(queryRoot.querySelectorAll(MEDIA_QUERY_SELECTOR))) {
      if (isElementInNoiseContainer(element)) continue;
      const target = element instanceof HTMLImageElement ? createMediaTarget(element) : createNonHtmlImageTarget(element);
      if (!target || seenSurfaces.has(target.surfaceElement)) continue;
      seenSurfaces.add(target.surfaceElement);
      targets.push(target);
    }
  }
  return targets;
}

/**
 * Discovers media targets within a freshly inserted DOM subtree, checking the node
 * itself in addition to its descendants. Used by incremental MutationObserver scans
 * so a bare `<img>` added without a wrapper element is not missed (querySelectorAll
 * never matches the query root itself).
 *
 * @param node - Element that was just inserted into the document.
 * @param customSelector - Optional custom CSS selector override matching image elements.
 * @returns Unique validated media targets inside the subtree (including the node itself).
 */
export function discoverAddedMediaTargets(node: Element, customSelector?: string): MediaTarget[] {
  const seenSurfaces = new Set<HTMLElement>();
  const targets: MediaTarget[] = [];
  const candidates: Element[] = [node, ...node.querySelectorAll('img, picture img, svg image')];
  for (const element of candidates) {
    if (isElementInNoiseContainer(element)) continue;
    const target = element instanceof HTMLImageElement ? createMediaTarget(element) : createNonHtmlImageTarget(element);
    if (!target || seenSurfaces.has(target.surfaceElement)) continue;
    seenSurfaces.add(target.surfaceElement);
    targets.push(target);
  }
  if (customSelector) {
    try {
      for (const element of Array.from(node.querySelectorAll(customSelector))) {
        const target = element instanceof HTMLImageElement ? createMediaTarget(element) : createNonHtmlImageTarget(element);
        if (!target || seenSurfaces.has(target.surfaceElement)) continue;
        seenSurfaces.add(target.surfaceElement);
        targets.push(target);
      }
    } catch (err) {
      console.warn('[MediaTargets] Custom selector query failed:', err);
    }
  }
  return targets;
}

/**
 * Checks whether a style mutation on an existing element revealed a new background
 * image target, examining only the element itself (never its subtree) so style
 * storms on large containers stay O(1) per element.
 *
 * @param element - Element whose style attribute just changed.
 * @returns Validated background target, or null when the element carries no new image.
 */
export function createStyleRevealedTarget(element: Element): MediaTarget | null {
  // Canvases paint from their bitmap and SVG images from href attributes — neither is
  // revealed by a style mutation, and resolving them here would trigger canvas
  // toDataURL GPU stalls during style storms.
  if (element instanceof HTMLImageElement || element instanceof HTMLCanvasElement || element instanceof SVGElement) return null;
  if (isElementInNoiseContainer(element)) return null;
  return createNonHtmlImageTarget(element);
}

/**
 * Tests whether a media target satisfies selector overrides, noise filtering, and pointer containment.
 *
 * @param target - Candidate media target.
 * @param clientX - Horizontal viewport coordinate.
 * @param clientY - Vertical viewport coordinate.
 * @param customSelector - Optional custom selector override.
 * @returns Whether the target is valid and contains the pointer.
 */
function isValidHoverTarget(
  target: MediaTarget,
  clientX: number,
  clientY: number,
  customSelector?: string
): boolean {
  if (customSelector) {
    try {
      const matches = Boolean(
        target.surfaceElement.closest(customSelector) ||
        target.sourceElement.closest(customSelector) ||
        target.imgElement?.closest(customSelector)
      );
      if (!matches) return false;
    } catch {
      return false;
    }
  } else {
    if (isElementInNoiseContainer(target.surfaceElement) || isElementInNoiseContainer(target.sourceElement)) {
      return false;
    }
  }
  return surfaceContainsPoint(target.surfaceElement, clientX, clientY);
}

/**
 * Deduplicates candidate media targets by surface and selects the largest by rendered area.
 *
 * @param targets - Validated media target candidates.
 * @returns Largest media target by rendered area, or null.
 */
function selectLargestTarget(targets: MediaTarget[]): MediaTarget | null {
  if (targets.length === 0) return null;
  const uniqueTargets = targets.filter(
    (target, index) => targets.findIndex((candidate) => candidate.surfaceElement === target.surfaceElement) === index
  );
  if (uniqueTargets.length <= 1) return uniqueTargets[0] || null;

  return uniqueTargets.sort((first, second) => {
    const firstRect = first.surfaceElement.getBoundingClientRect();
    const secondRect = second.surfaceElement.getBoundingClientRect();
    return secondRect.width * secondRect.height - firstRect.width * firstRect.height;
  })[0] || null;
}

/**
 * Resolves hover media using composed paths, point hit-testing, descendants, and CSS backgrounds.
 * Prioritizes customSelector when configured, and excludes noise containers when unconfigured.
 *
 * FAST-PATH: [Penetrates anti-scrape wrappers without tree traversal] -> On sites like X.com or Pixiv,
 * transparent overlay divs or link wrappers sit on top of the image. elementsFromPoint already lists
 * all layers under the pointer in native C++ order. Direct point inspection resolves the <img> or
 * background surface in sub-millisecond time. A shallow descendant fallback is only invoked if the
 * direct hit test returns no valid media.
 *
 * @param event - Mouse event used for target and pointer information.
 * @param customSelector - Optional custom CSS selector override.
 * @returns Largest matching media target, or null.
 */
export function resolveHoverMediaTarget(event: MouseEvent, customSelector?: string): MediaTarget | null {
  const clientX = event.clientX;
  const clientY = event.clientY;

  // Phase 1 (Fast-Path): Direct point hit-testing on elements physically under the cursor.
  const pointElements: Element[] = [];
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (node instanceof Element) {
      pointElements.push(node);
      break;
    }
  }
  if (event.target instanceof Element && !pointElements.includes(event.target)) {
    pointElements.push(event.target);
  }
  if (typeof document.elementsFromPoint === 'function') {
    const hits = document.elementsFromPoint(clientX, clientY);
    if (hits) {
      for (const el of hits) {
        if (!pointElements.includes(el)) pointElements.push(el);
      }
    }
  }

  const directTargets: MediaTarget[] = [];
  for (const element of pointElements) {
    const target = element instanceof HTMLImageElement
      ? createMediaTarget(element)
      : createNonHtmlImageTarget(element);
    if (target && isValidHoverTarget(target, clientX, clientY, customSelector)) {
      directTargets.push(target);
    }
  }

  const directHit = selectLargestTarget(directTargets);
  if (directHit) return directHit;

  // Phase 2 (Fallback): Shallow descendant search on the hovered element and its immediate ancestors.
  // Handles cases where pointer-events: none on the image prevents direct point hits, or where the
  // event target is an image container wrapper with margins/padding.
  const fallbackTargets: MediaTarget[] = [];
  const startElement = event.target instanceof Element ? event.target : pointElements[0];
  if (!startElement) return null;

  let current: Element | null = startElement;
  let depth = 0;
  while (current && depth <= MAX_HOVER_ANCESTOR_DEPTH) {
    if (current === document.body || current === document.documentElement) break;

    const isCardBoundary = depth > 0 && Boolean(current.matches?.(CARD_CONTAINER_SELECTOR));

    try {
      const mediaElements = Array.from(current.querySelectorAll(MEDIA_SELECTOR));
      if (mediaElements.length <= MAX_CONTAINER_MEDIA_ELEMENTS) {
        for (const child of mediaElements) {
          const childTarget = child instanceof HTMLImageElement
            ? createMediaTarget(child)
            : createNonHtmlImageTarget(child);
          if (childTarget && isValidHoverTarget(childTarget, clientX, clientY, customSelector)) {
            fallbackTargets.push(childTarget);
          }
        }
      }
    } catch {}

    if (fallbackTargets.length > 0 || isCardBoundary) break;
    current = current.parentElement;
    depth++;
  }

  return selectLargestTarget(fallbackTargets);
}

/**
 * Resolves the media target at a raw viewport point without a mouse event.
 * Prioritizes customSelector when configured, and excludes noise containers when unconfigured.
 *
 * WORKAROUND: [Scrolling fires no boundary events] -> mouseover/mouseout only fire when the
 * pointer crosses element edges. When a tall page scrolls under a stationary cursor, no
 * event fires, so hover state silently went stale (button vanished mid-scroll and never
 * returned until the cursor physically re-entered). Callers re-resolve the target from the
 * last known cursor position on scroll using this function.
 *
 * @param clientX - Horizontal viewport coordinate.
 * @param clientY - Vertical viewport coordinate.
 * @param customSelector - Optional custom CSS selector override.
 * @returns Largest matching media target at the point, or null.
 */
export function resolveMediaTargetAtPoint(clientX: number, clientY: number, customSelector?: string): MediaTarget | null {
  if (typeof document.elementsFromPoint !== 'function') return null;
  const elements = document.elementsFromPoint(clientX, clientY) || [];

  // Phase 1 (Fast-Path): Direct point hit-testing
  const directTargets: MediaTarget[] = [];
  for (const element of elements) {
    const target = element instanceof HTMLImageElement
      ? createMediaTarget(element)
      : createNonHtmlImageTarget(element);
    if (target && isValidHoverTarget(target, clientX, clientY, customSelector)) {
      directTargets.push(target);
    }
  }

  const directHit = selectLargestTarget(directTargets);
  if (directHit) return directHit;

  // Phase 2 (Fallback): Shallow descendant search on the top hit element
  const topElement = elements[0];
  if (!topElement || topElement === document.body || topElement === document.documentElement) return null;

  const fallbackTargets: MediaTarget[] = [];
  try {
    const children = Array.from(topElement.querySelectorAll(MEDIA_SELECTOR));
    if (children.length <= MAX_CONTAINER_MEDIA_ELEMENTS) {
      for (const child of children) {
        const childTarget = child instanceof HTMLImageElement
          ? createMediaTarget(child)
          : createNonHtmlImageTarget(child);
        if (childTarget && isValidHoverTarget(childTarget, clientX, clientY, customSelector)) {
          fallbackTargets.push(childTarget);
        }
      }
    }
  } catch {}

  return selectLargestTarget(fallbackTargets);
}
