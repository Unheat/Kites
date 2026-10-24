import type { ChapterTranslationRecord } from './chapterZip';
import {
  isPlaceholderSource,
  normalizeMediaUrl,
  reapplyMediaTargetStyles,
  resolveImageSource,
  type MediaTarget,
} from './mediaTargets';

const SELF_MUTATION_RESET_DELAY_MS = 50;
const MAX_PARENT_BG_SEARCH_DEPTH = 2;
const REVEALED_BACKING_OPACITY = '1';
const REVEALED_BACKING_Z_INDEX = '1';
const REVEALED_BACKING_POINTER_EVENTS = 'none';
export const IMAGE_DISPLAY_CHANGED_EVENT = 'kites-image-display-changed';

/** Standard lazy-load attributes commonly used by host websites and CMSs */
export const LAZY_LOAD_ATTRIBUTES = [
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-actual-src',
  'data-url',
  'data-origin',
  'data-full-image',
  'data-real-src',
];

// Track created same-origin Blob URLs to prevent memory leaks and allow eventual revocation
export const activeObjectUrls = new Set<string>();

// WeakMap holding active MutationObserver shields for each translated image element
export const activeShieldObservers = new WeakMap<HTMLImageElement, MutationObserver>();

// Guard flag suppressing internal MutationObservers during Kites DOM modifications
export let isSelfMutating = false;

/**
 * Runs a DOM mutation callback while temporarily suppressing internal MutationObservers
 * to avoid recursive event triggering or feedback loops.
 *
 * WORKAROUND: [SPA / Framework Mutation Loops] -> When mutating DOM attributes on images,
 * our own MutationObservers would catch the mutation and trigger duplicate handling or infinite loops.
 * Wrapping in isSelfMutating with a tick delay suppresses self-triggered mutations.
 *
 * @param fn - Callback performing DOM mutations.
 */
export function runSelfMutation(fn: () => void): void {
  isSelfMutating = true;
  try {
    fn();
  } finally {
    window.setTimeout(() => {
      isSelfMutating = false;
    }, SELF_MUTATION_RESET_DELAY_MS);
  }
}

/**
 * Converts a Base64 Data URL into a local same-origin Blob URL.
 * Adopts the XianScan production pattern to bypass strict inline data: CSP rules
 * and avoid multi-megabyte string bloat in DOM attributes.
 *
 * WORKAROUND: [CSP & DOM Bloat Mitigation] -> Storing multi-megabyte base64 strings
 * in raw img.src attributes causes memory pressure and triggers strict host site CSP
 * blocks (e.g. img-src without data:). Converting to a local same-origin blob: URL keeps
 * the DOM attribute footprint negligible and complies with host-origin image loading.
 *
 * @param dataUrl - Base64 data URL from the pipeline.
 * @returns Same-origin Blob URL or original data URL on error.
 */
export function createSafeBlobUrlFromData(dataUrl: string): string {
  try {
    if (!dataUrl.startsWith('data:')) return dataUrl;

    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binaryStr = atob(parts[1]);
    const len = binaryStr.length;
    const u8arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      u8arr[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([u8arr], { type: mime });
    const objUrl = URL.createObjectURL(blob);
    activeObjectUrls.add(objUrl);
    return objUrl;
  } catch (error) {
    console.warn('[Content Script] Failed to convert dataUrl to Blob URL, falling back to raw dataUrl:', error);
    return dataUrl;
  }
}

/**
 * Backs up original src, srcset, and lazy-loading attributes before stripping them,
 * preventing host site scripts and responsive loaders from overriding our replacement.
 *
 * WORKAROUND: [HTML5 Responsive Image Precedence] -> Under W3C/HTML5 specifications,
 * if an <img> contains a valid srcset attribute, the browser rendering engine evaluates
 * the srcset candidates first and completely ignores src. Merely updating img.src while
 * leaving srcset present causes the original image to continue displaying. We must back up
 * and wipe srcset = '' and remove the attribute.
 *
 * @param img - Target image element to sanitize.
 */
export function sanitizeImageAttributes(img: HTMLImageElement): void {
  if (!img.getAttribute('data-kites-orig-src')) {
    img.setAttribute('data-kites-orig-src', img.src || img.getAttribute('data-src') || '');
    img.setAttribute('data-kites-orig-srcset', img.srcset || '');
  }

  for (const attr of LAZY_LOAD_ATTRIBUTES) {
    if (img.hasAttribute(attr)) {
      const val = img.getAttribute(attr);
      if (val && !img.hasAttribute(`data-kites-orig-${attr}`)) {
        img.setAttribute(`data-kites-orig-${attr}`, val);
      }
      img.removeAttribute(attr);
    }
  }

  // Clear responsive candidate set so browser engine renders src
  img.srcset = '';
  img.removeAttribute('srcset');
}

/**
 * Suppresses matching background-image on parent containers (common in Twitter/X media wrappers)
 * so the original image does not bleed through.
 *
 * @param img - Image element whose parent containers should be inspected.
 * @param surfaceElement - Visual container or wrapper element.
 */
export function suppressParentBackgroundImage(img: HTMLImageElement, surfaceElement: HTMLElement = img): void {
  let parent: HTMLElement | null = surfaceElement === img ? img.parentElement : surfaceElement;
  let depth = 0;
  const originalSource = normalizeMediaUrl(img.getAttribute('data-kites-orig-src') || resolveImageSource(img));
  while (parent && depth < MAX_PARENT_BG_SEARCH_DEPTH) {
    const bg = parent.style.backgroundImage || window.getComputedStyle(parent).backgroundImage;
    if (bg && bg !== 'none' && bg.includes('url(') && (!originalSource || bg.includes(originalSource) || surfaceElement === parent)) {
      if (!parent.hasAttribute('data-kites-orig-bg')) {
        parent.setAttribute('data-kites-orig-bg', parent.style.backgroundImage);
      }
      parent.setAttribute('data-kites-background-suppressed', 'true');
      parent.style.backgroundImage = 'none';
    }
    parent = parent.parentElement;
    depth++;
  }
}

/**
 * Attaches a MutationObserver shield to the translated image and visible media surface.
 * If a host framework (React/Vue) or lazy-loader reverts source, visibility, or background state,
 * the shield immediately restores the translated presentation.
 *
 * WORKAROUND: [SPA Virtual DOM Reconciliation Resets] -> Modern SPAs (Twitter/X, Reddit, Threads)
 * maintain their own internal component state. Whenever user interactions trigger a React re-render
 * (hovering, scrolling, liking, timeline stream updates), React's reconciliation loop compares the real
 * DOM against its virtual DOM and immediately reverts img.src back to the host CDN URL.
 * This shield intercepts any such reset on src/srcset and re-applies our translated URL immediately.
 *
 * @param img - The translated image element to protect.
 * @param safeUrl - The safe Blob/Data URL of the translated image.
 * @param surfaceElement - Visible media surface whose suppressed background must remain hidden.
 */
export function attachReversionShield(img: HTMLImageElement, safeUrl: string, surfaceElement: HTMLElement = img): void {
  const existingObserver = activeShieldObservers.get(img);
  if (existingObserver) {
    existingObserver.disconnect();
  }

  const observer = new MutationObserver((mutations) => {
    if (isSelfMutating) return;

    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const appliedSrc = img.getAttribute('data-kites-applied-src') || safeUrl;
        const origSrc = img.getAttribute('data-kites-orig-src');
        if (mutation.attributeName === 'src') {
          const currentSrc = img.getAttribute('src') || img.src;
          if (!currentSrc || currentSrc === appliedSrc) continue;

          // If user is previewing original image, do not revert back to translated
          if (img.getAttribute('data-kites-show-original') === 'true') {
            continue;
          }

          // Check if host updated the element with a COMPLETELY NEW image (e.g. reader navigated to next page)
          // An SPA reset sets src back to origSrc. If new src is neither appliedSrc nor origSrc, it's a new image!
          const isSameImageReset = Boolean(origSrc && (currentSrc === origSrc || currentSrc.includes(origSrc)));
          if (!isSameImageReset && !isPlaceholderSource(currentSrc)) {
            console.log('[Content Script] New image detected on recycled element; disconnecting shield and resetting translation state.');
            observer.disconnect();
            activeShieldObservers.delete(img);
            img.removeAttribute('data-kites-translated');
            img.removeAttribute('data-kites-applied-src');
            img.removeAttribute('data-kites-show-original');
            img.removeAttribute('data-kites-orig-src');
            img.removeAttribute('data-kites-orig-srcset');
            img.removeAttribute('data-kites-job-id');
            surfaceElement.removeAttribute('data-kites-translated');
            surfaceElement.removeAttribute('data-kites-show-original');
            surfaceElement.removeAttribute('data-kites-job-id');
            continue;
          }

          console.log('[Content Script] Host SPA reset detected on src, restoring translated image.');
          runSelfMutation(() => {
            img.src = appliedSrc;
            img.srcset = '';
            img.removeAttribute('srcset');
            for (const attr of LAZY_LOAD_ATTRIBUTES) {
              img.removeAttribute(attr);
            }
            reapplyMediaTargetStyles(img, surfaceElement);
          });
        }
        if (mutation.attributeName === 'srcset' && img.srcset) {
          console.log('[Content Script] Host SPA restored srcset, clearing.');
          runSelfMutation(() => {
            img.srcset = '';
            img.removeAttribute('srcset');
          });
        }
        if (mutation.attributeName === 'style') {
          const imageStyleReverted = mutation.target === img;
          const surfaceStyleReverted = mutation.target === surfaceElement
            && surfaceElement.getAttribute('data-kites-background-suppressed') === 'true'
            && surfaceElement.style.backgroundImage !== 'none';
          if (imageStyleReverted || surfaceStyleReverted) {
            console.log('[Content Script] Host SPA reset detected on media style, restoring translated presentation.');
            runSelfMutation(() => reapplyMediaTargetStyles(img, surfaceElement));
          }
        }
      }
    }
  });

  observer.observe(img, {
    attributes: true,
    attributeFilter: ['src', 'srcset', 'style', ...LAZY_LOAD_ATTRIBUTES],
  });
  if (surfaceElement !== img) {
    observer.observe(surfaceElement, { attributes: true, attributeFilter: ['style'] });
  }

  activeShieldObservers.set(img, observer);
}

/**
 * Performs a resilient, native image replacement with SPA protection,
 * srcset clearing, lazy attribute stripping, and parent background suppression.
 *
 * @param target - The target MediaTarget in the DOM.
 * @param record - Already archived translation; DOM and ZIP share the same blob URL.
 */
export function replaceImageWithTranslation(target: MediaTarget, record: ChapterTranslationRecord): void {
  const { imgElement: targetImg, sourceElement, surfaceElement, hiddenBacking, kind } = target;
  const { originalUrl, jobId, translatedUrl: safeUrl } = record;
  // Archive completed result before touching the DOM; registry owns referenced blob lifetimes.
  record.surfaceElement = surfaceElement;
  record.sourceElement = sourceElement;

  if (jobId) {
    sourceElement.setAttribute('data-kites-job-id', String(jobId));
    surfaceElement.setAttribute('data-kites-job-id', String(jobId));
  }

  runSelfMutation(() => {
    sourceElement.setAttribute('data-kites-applied-src', safeUrl);
    sourceElement.setAttribute('data-kites-translated', 'true');
    surfaceElement.setAttribute('data-kites-translated', 'true');
    if (targetImg) {
      sanitizeImageAttributes(targetImg);
      targetImg.src = safeUrl;
      targetImg.style.display = '';
      targetImg.style.filter = 'none';
      if (hiddenBacking) {
        if (!targetImg.hasAttribute('data-kites-orig-style')) targetImg.setAttribute('data-kites-orig-style', targetImg.getAttribute('style') || '');
        targetImg.setAttribute('data-kites-applied-opacity', REVEALED_BACKING_OPACITY);
        targetImg.setAttribute('data-kites-applied-z-index', REVEALED_BACKING_Z_INDEX);
        targetImg.setAttribute('data-kites-applied-pointer-events', REVEALED_BACKING_POINTER_EVENTS);
        targetImg.style.opacity = REVEALED_BACKING_OPACITY;
        targetImg.style.visibility = 'visible';
        targetImg.style.zIndex = REVEALED_BACKING_Z_INDEX;
        targetImg.style.pointerEvents = REVEALED_BACKING_POINTER_EVENTS;
      }
      suppressParentBackgroundImage(targetImg, surfaceElement);
      attachReversionShield(targetImg, safeUrl, surfaceElement);
    } else if (kind === 'background') {
      if (!surfaceElement.hasAttribute('data-kites-orig-bg')) surfaceElement.setAttribute('data-kites-orig-bg', surfaceElement.style.backgroundImage);
      surfaceElement.style.backgroundImage = `url("${safeUrl}")`;
    } else {
      sourceElement.setAttribute('href', safeUrl);
      sourceElement.setAttributeNS('http://www.w3.org/1999/xlink', 'href', safeUrl);
    }
  });

  console.log(`[Content Script] Successfully replaced image for: ${originalUrl}`);
}

/**
 * Toggles an image between its translated version and its original artwork.
 *
 * @param target - Target media item in the DOM.
 * @param showOriginal - Whether to show the original image (true) or translated (false).
 * @param record - Optional translation record to update state on.
 */
export function toggleImageDisplay(target: MediaTarget, showOriginal: boolean, record?: ChapterTranslationRecord): void {
  const { imgElement: targetImg, sourceElement, surfaceElement, kind } = target;
  if (record) {
    record.showOriginal = showOriginal;
  }

  runSelfMutation(() => {
    if (showOriginal) {
      sourceElement.setAttribute('data-kites-show-original', 'true');
      surfaceElement.setAttribute('data-kites-show-original', 'true');

      if (targetImg) {
        const origSrc = targetImg.getAttribute('data-kites-orig-src') || target.srcUrl;
        const origSrcset = targetImg.getAttribute('data-kites-orig-srcset');
        targetImg.src = origSrc;
        if (origSrcset) {
          targetImg.srcset = origSrcset;
        }
        const origBg = surfaceElement.getAttribute('data-kites-orig-bg');
        if (origBg) {
          surfaceElement.style.backgroundImage = origBg;
        }
      } else if (kind === 'background') {
        const origBg = surfaceElement.getAttribute('data-kites-orig-bg') || '';
        surfaceElement.style.backgroundImage = origBg;
      } else {
        const origSrc = sourceElement.getAttribute('data-kites-orig-src') || target.srcUrl;
        sourceElement.setAttribute('href', origSrc);
        sourceElement.setAttributeNS('http://www.w3.org/1999/xlink', 'href', origSrc);
      }
    } else {
      sourceElement.removeAttribute('data-kites-show-original');
      surfaceElement.removeAttribute('data-kites-show-original');

      const appliedSrc = sourceElement.getAttribute('data-kites-applied-src') || record?.translatedUrl;
      if (appliedSrc) {
        if (targetImg) {
          targetImg.src = appliedSrc;
          targetImg.srcset = '';
          targetImg.removeAttribute('srcset');
          suppressParentBackgroundImage(targetImg, surfaceElement);
        } else if (kind === 'background') {
          surfaceElement.style.backgroundImage = `url("${appliedSrc}")`;
        } else {
          sourceElement.setAttribute('href', appliedSrc);
          sourceElement.setAttributeNS('http://www.w3.org/1999/xlink', 'href', appliedSrc);
        }
      }
    }
  });

  document.dispatchEvent(new CustomEvent(IMAGE_DISPLAY_CHANGED_EVENT, {
    detail: { srcUrl: target.srcUrl, showOriginal },
  }));
}
