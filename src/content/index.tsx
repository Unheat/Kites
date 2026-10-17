import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, useCallback, useId } from 'react';
import './content.css';
import { Languages, Eye, EyeOff, ExternalLink, X, Crop, RotateCcw, Download } from 'lucide-react';
import type { PopupState, CropOverlayItem, ViewportSelection, SiteSelectorRule } from '../shared/types';
import { STORAGE_KEYS } from '../shared/constants';
import { isDomainDisabled, findMatchingSiteRule, getChapterScopeId } from '../shared/siteRules';
import {
  createChapterTranslationRegistry,
  createChapterExporter,
  type ChapterTranslationRecord,
  type ChapterImageRecord,
} from './chapterZip';
import ChapterReaderModal, { type ChapterReaderPage } from './ChapterReaderModal';
import ChapterReaderFloatingPill from './ChapterReaderFloatingPill';
import { scanChapterPages, fastScrollPreload } from './scanner';
import { handleReadingKeydown, handleReadingKeyup, handleReadingCommand, type ReadingShortcutActions } from './readingShortcuts';
import {
  normalizeSelection,
  calculateCaptureSourceRect,
  computeCropBounds,
  cropCapturedDataUrl,
  waitForCleanFrames,
  saveLastCropSelection,
  loadLastCropSelection,
  type CropDragHandle,
} from './captureArea';
import {
  collectQueryRoots,
  discoverMediaTargets,
  isPlaceholderSource,
  normalizeMediaUrl,
  resolveHoverMediaTarget,
  resolveImageSource,
  resolveMediaTargetAtPoint,
  reapplyMediaTargetStyles,
  type MediaTarget,
} from './mediaTargets';

// Minimum rendered dimensions prevent controls and thumbnails from entering the pipeline.
const IMAGE_SCAN_DEBOUNCE_MS = 300;
const HOVER_LEAVE_DELAY_MS = 150;
const SELF_MUTATION_RESET_DELAY_MS = 50;
const MAX_PARENT_BG_SEARCH_DEPTH = 2;
const REVEALED_BACKING_OPACITY = '1';
const REVEALED_BACKING_Z_INDEX = '1';
const REVEALED_BACKING_POINTER_EVENTS = 'none';
const TRANSLATE_CONTROL_SELECTOR = '[data-kites-translate-control]';
const IMAGE_DISPLAY_CHANGED_EVENT = 'kites-image-display-changed';
// Snappy feedback: 150ms delay avoids flickering on sub-100ms no-ops while catching all genuine model inits
const MODEL_INITIALIZATION_LABEL_DELAY_MS = 150;
const MODEL_INITIALIZATION_LABEL = 'Preparing AI model…';

function formatModelInitializationLabel(stage?: string, modelName?: string): string {
  if (stage === 'ocr') return `Preparing OCR${modelName ? ` (${modelName})` : ''}…`;
  if (stage === 'inpaint') return `Preparing Inpainting${modelName ? ` (${modelName})` : ''}…`;
  if (stage === 'translation') return `Preparing Translation${modelName ? ` (${modelName})` : ''}…`;
  if (stage === 'bubble') return `Preparing Bubble Detector…`;
  return 'Preparing AI model…';
}
// How long the translate button keeps its visible failure state after a terminal error.
const TRANSLATION_FAILURE_VISIBLE_MS = 3000;
const TRANSLATION_FAILURE_LABEL = 'Translation failed. Click to retry.';

// Standard lazy-load attributes commonly used by host websites and CMSs
const LAZY_LOAD_ATTRIBUTES = [
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-actual-src',
  'data-url',
  'data-origin',
  'data-full-image',
  'data-real-src',
];

// In-memory registry mapping original/base image URLs to live DOM media targets
const mediaTargetRegistry = new Map<string, MediaTarget>();

// Track created same-origin Blob URLs to prevent memory leaks and allow eventual revocation
const activeObjectUrls = new Set<string>();

// WeakMap holding active MutationObserver shields for each translated image element
const activeShieldObservers = new WeakMap<HTMLImageElement, MutationObserver>();

// Guard flag suppressing internal MutationObservers during Kites DOM modifications
let isSelfMutating = false;

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
function runSelfMutation(fn: () => void): void {
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
 * Normalizes an image URL by stripping query parameters and hash fragments
 * to enable reliable matching when host CDNs dynamically change resolution flags.
 *
 * WORKAROUND: [Dynamic CDN Resolution Upgrades] -> Modern SPAs (Twitter, Reddit, etc.) dynamically
 * upgrade thumbnail URLs to high-res variants (e.g. ?name=medium -> ?name=large) while the background
 * translation pipeline is running. Exact string matching fails silently; stripping query parameters
 * allows matching the underlying image across quality upgrades.
 *
 * @param url - Raw image URL string.
 * @returns Cleaned URL without search query or hash parameters.
 */
function getNormalizedBaseUrl(url: string): string {
  return normalizeMediaUrl(url);
}

/**
 * Attaches a unique Kites tracking ID and registers a media target in the in-memory URL map.
 *
 * @param target - Media target and source URL to register.
 * @returns The assigned tracking ID.
 */
function registerMediaTarget(target: MediaTarget): string {
  const { sourceElement, srcUrl } = target;
  let kitesId = sourceElement.getAttribute('data-kites-id');
  if (!kitesId) {
    kitesId = `kites-${Math.random().toString(36).substring(2, 11)}`;
    sourceElement.setAttribute('data-kites-id', kitesId);
  }
  mediaTargetRegistry.set(srcUrl, target);
  const normalized = getNormalizedBaseUrl(srcUrl);
  if (normalized) {
    mediaTargetRegistry.set(normalized, target);
  }
  return kitesId;
}

/**
 * Resolves a media target using a robust multi-tier fallback lookup:
 * 1. Direct in-memory registry reference when image and surface remain attached.
 * 2. Exact resolved-source match across native, responsive, and lazy attributes.
 * 3. Match on data-kites-orig-src attribute.
 * 4. Normalized base URL match (stripping CDN resolution parameters).
 *
 * @param originalUrl - The original image URL requested for translation.
 * @returns Resolved media target, or null if no matching image/surface pair exists in DOM.
 */
function resolveTargetMedia(originalUrl: string): MediaTarget | null {
  // Tier 1: Check in-memory registry
  const registered = mediaTargetRegistry.get(originalUrl);
  if (registered && registered.sourceElement.isConnected && registered.surfaceElement.isConnected) {
    if (registered.sourceElement instanceof HTMLImageElement) {
      const origSrc = registered.sourceElement.getAttribute('data-kites-orig-src');
      const appliedSrc = registered.sourceElement.getAttribute('data-kites-applied-src');
      const currentSrc = registered.sourceElement.currentSrc || registered.sourceElement.src || '';
      const matchesOrig = origSrc === originalUrl || (currentSrc && (currentSrc === originalUrl || currentSrc === appliedSrc));
      if (matchesOrig) {
        return registered;
      }
    } else {
      return registered;
    }
  }

  const normalized = getNormalizedBaseUrl(originalUrl);
  if (normalized) {
    const normRegistered = mediaTargetRegistry.get(normalized);
    if (normRegistered && normRegistered.sourceElement.isConnected && normRegistered.surfaceElement.isConnected) {
      if (normRegistered.sourceElement instanceof HTMLImageElement) {
        const origSrc = normRegistered.sourceElement.getAttribute('data-kites-orig-src');
        const appliedSrc = normRegistered.sourceElement.getAttribute('data-kites-applied-src');
        const currentSrc = normRegistered.sourceElement.currentSrc || normRegistered.sourceElement.src || '';
        const matchesOrig = origSrc === originalUrl || (currentSrc && (currentSrc === originalUrl || currentSrc === appliedSrc));
        if (matchesOrig) {
          return normRegistered;
        }
      } else {
        return normRegistered;
      }
    }
  }

  const targets = discoverMediaTargets();

  // Tier 2: Exact URL match across native, responsive, and lazy source attributes
  const exactMatch = targets.find((target) => target.srcUrl === originalUrl);
  if (exactMatch) return exactMatch;

  // Tier 3: Match on data-kites-orig-src attribute
  const origAttrMatch = targets.find((target) => target.sourceElement.getAttribute('data-kites-orig-src') === originalUrl);
  if (origAttrMatch) return origAttrMatch;

  // Tier 4: Match on normalized base URL
  return normalized
    ? targets.find((target) => getNormalizedBaseUrl(target.srcUrl) === normalized) || null
    : null;
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
function createSafeBlobUrlFromData(dataUrl: string): string {
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
function sanitizeImageAttributes(img: HTMLImageElement): void {
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
 */
function suppressParentBackgroundImage(img: HTMLImageElement, surfaceElement: HTMLElement = img): void {
  let parent: HTMLElement | null = surfaceElement === img ? img.parentElement : surfaceElement;
  let depth = 0;
  const originalSource = getNormalizedBaseUrl(img.getAttribute('data-kites-orig-src') || resolveImageSource(img));
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

export type TranslatedImageRecord = ChapterTranslationRecord;

/** In-memory registry keeping track of translated images and their finished state, including detached pages. */
export const translatedRegistry = createChapterTranslationRegistry({
  getSourcePage: () => getChapterScopeId(window.location.href),
  createTranslatedUrl: createSafeBlobUrlFromData,
  revokeTranslatedUrl: (url) => {
    if (!url.startsWith('blob:')) return;
    URL.revokeObjectURL(url);
    activeObjectUrls.delete(url);
  },
});
const chapterExporter = createChapterExporter({
  getRecords: translatedRegistry.getRecords,
  getSourcePage: () => getChapterScopeId(window.location.href),
  getTitle: () => document.title,
});

/**
 * Stores queue-time document context before translation can finish after navigation or detachment.
 * @param originalUrl - Requested image URL.
 * @param target - Page surface available at queue time.
 * @returns Nothing.
 */
function rememberChapterRequest(originalUrl: string, target: MediaTarget | null): void {
  translatedRegistry.remember(originalUrl, target ?? undefined);
}

// Native context-menu requests are queued by background, so capture their target before it detaches.
// Keep one unconfirmed candidate separate from real overlay requests; unrelated menu choices
// must not lock stale context for a later translation of the same URL.
document.addEventListener('contextmenu', (event) => {
  const target = resolveHoverMediaTarget(event as MouseEvent);
  if (target) translatedRegistry.rememberContextMenu(target.srcUrl, target);
}, true);

let cachedSiteRules: SiteSelectorRule[] = [];
export function getActiveCustomSelector(): string | undefined {
  return findMatchingSiteRule(window.location.hostname, cachedSiteRules)?.selector;
}

// Top-frame v1: popup explicitly targets frameId 0, so embedded readers cannot create multiple archives.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'content' || message?.source !== 'popup' || message?.request !== true) return;
  if (message.type === 'GET_CHAPTER_ZIP_STATUS') {
    sendResponse(chapterExporter.getStatus());
    return;
  }
  if (message.type === 'EXPORT_CHAPTER_ZIP') {
    void chapterExporter.exportChapter(message.payload?.records).then(sendResponse).catch((error) => {
      console.error('[Chapter ZIP] Message failed:', error);
      sendResponse({ ...chapterExporter.getStatus(), phase: 'error', busy: false, message: 'ZIP export failed. Nothing downloaded.' });
    });
    return true;
  }
  if (message.type === 'OPEN_CHAPTER_READER') {
    document.dispatchEvent(
      new CustomEvent('kites-open-chapter-reader', {
        detail: message.payload,
      })
    );
    sendResponse({ status: 'success' });
    return;
  }
  if (message.type === 'SCAN_CHAPTER_PAGES') {
    const isTranslatedCheck = (url: string) => {
      const reg = translatedRegistry.get(url);
      return {
        isTranslated: Boolean(reg?.translatedUrl),
        translatedUrl: reg?.translatedUrl,
      };
    };
    const pages = scanChapterPages(document, getActiveCustomSelector(), isTranslatedCheck);
    sendResponse({ status: 'success', pages });
    return;
  }
  if (message.type === 'FAST_SCROLL_PRELOAD') {
    const isTranslatedCheck = (url: string) => {
      const reg = translatedRegistry.get(url);
      return {
        isTranslated: Boolean(reg?.translatedUrl),
        translatedUrl: reg?.translatedUrl,
      };
    };
    void fastScrollPreload(document, getActiveCustomSelector(), isTranslatedCheck)
      .then((pages) => {
        sendResponse({ status: 'success', pages });
      })
      .catch((err) => {
        console.warn('[Scanner] Fast scroll preload failed:', err);
        sendResponse({ status: 'error', error: String(err), pages: [] });
      });
    return true;
  }
});

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
function attachReversionShield(img: HTMLImageElement, safeUrl: string, surfaceElement: HTMLElement = img): void {
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
 * @returns Nothing.
 */
function replaceImageWithTranslation(target: MediaTarget, record: TranslatedImageRecord): void {
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
 */
function toggleImageDisplay(target: MediaTarget, showOriginal: boolean): void {
  const { imgElement: targetImg, sourceElement, surfaceElement, kind } = target;
  const record = translatedRegistry.get(target.srcUrl);
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

type OverlayImage = MediaTarget & {
  anchorName: string;
};

/**
 * Gets or assigns the CSS anchor used to place an image's translation button.
 *
 * @param img - Image element receiving an anchor.
 * @returns The image's CSS anchor name.
 */
function getAnchorName(element: HTMLElement): string {
  let anchorName = element.style.getPropertyValue('anchor-name');
  if (!anchorName) {
    anchorName = `--kites-img-${Math.random().toString(36).substring(2, 11)}`;
    element.style.setProperty('anchor-name', anchorName);
  }
  return anchorName;
}

/**
 * Renders a floating translation button anchored to an image.
 *
 * @param props - Button state and callbacks.
 * @param props.srcUrl - Image URL to translate.
 * @param props.anchorName - CSS anchor assigned to target image.
 * @param props.anchorElement - The anchor element whose viewport rect drives the scroll clamp.
 * @param props.isTranslating - Whether this image has a pending translation job.
 * @param props.onTranslate - Queues translation for this image.
 * @returns Floating translate button.
 */
function TranslateButton({
  srcUrl,
  anchorName,
  anchorElement,
  isTranslating,
  onTranslate,
}: {
  srcUrl: string;
  anchorName: string;
  anchorElement: HTMLElement;
  isTranslating: boolean;
  onTranslate: (srcUrl: string) => void;
}) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const initializationDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeInitializationJobIdRef = useRef<number | null>(null);
  const failureResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializationLabelId = useId();
  const [localTranslating, setLocalTranslating] = useState(false);
  const [showInitializationLabel, setShowInitializationLabel] = useState(false);
  const [initializationText, setInitializationText] = useState<string>(MODEL_INITIALIZATION_LABEL);
  // Visible failure feedback: terminal errors used to reset silently, so a dead queue
  // looked like nothing happened. The button shows the failure briefly, then returns to
  // its idle look so the next click reads as a retry.
  const [hasFailed, setHasFailed] = useState(false);

  const isElementTranslated = useCallback(() => {
    // 1. Direct registry check (primary ground truth for current session)
    const reg = translatedRegistry.get(srcUrl);
    if (reg?.translatedUrl) {
      return true;
    }

    // 2. DOM attribute check on anchorElement or inner img
    if (anchorElement.getAttribute('data-kites-translated') === 'true') {
      return true;
    }

    const img = anchorElement instanceof HTMLImageElement ? anchorElement : anchorElement.querySelector('img');
    if (img && img.getAttribute('data-kites-translated') === 'true') {
      return true;
    }

    // 3. MediaTarget resolution fallback
    const target = resolveTargetMedia(srcUrl);
    if (
      target?.sourceElement?.getAttribute('data-kites-translated') === 'true' ||
      target?.surfaceElement?.getAttribute('data-kites-translated') === 'true'
    ) {
      return true;
    }

    return false;
  }, [anchorElement, srcUrl]);

  const [isTranslated, setIsTranslated] = useState(isElementTranslated);
  const [showOriginal, setShowOriginal] = useState(() => {
    return Boolean(
      translatedRegistry.get(srcUrl)?.showOriginal ||
      anchorElement.getAttribute('data-kites-show-original') === 'true'
    );
  });
  const [jobId, setJobId] = useState<number | null>(() => {
    const reg = translatedRegistry.get(srcUrl)?.jobId;
    if (reg) return reg;
    const attr = anchorElement.getAttribute('data-kites-job-id');
    return attr ? Number(attr) : null;
  });

  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = setTimeout(() => {
      setIsTooltipVisible(true);
    }, 180);
  };

  const handleMouseLeave = () => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = null;
    setIsTooltipVisible(false);
  };

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    };
  }, []);

  const activeTranslating = isTranslating || localTranslating;

  useEffect(() => {
    const update = () => {
      const reg = translatedRegistry.get(srcUrl);
      if (reg?.translatedUrl && !reg.showOriginal && anchorElement.getAttribute('data-kites-show-original') !== 'true') {
        const isDomApplied = anchorElement.getAttribute('data-kites-translated') === 'true' ||
          (anchorElement instanceof HTMLImageElement ? anchorElement.getAttribute('data-kites-translated') === 'true' : anchorElement.querySelector('img')?.getAttribute('data-kites-translated') === 'true');
        if (!isDomApplied) {
          const target = resolveTargetMedia(srcUrl);
          if (target) {
            replaceImageWithTranslation(target, reg);
          }
        }
      }

      setIsTranslated(isElementTranslated());
      setShowOriginal(
        reg?.showOriginal ??
        (anchorElement.getAttribute('data-kites-show-original') === 'true')
      );
      const regJobId = reg?.jobId;
      const attr = anchorElement.getAttribute('data-kites-job-id');
      setJobId(regJobId ?? (attr ? Number(attr) : null));
    };

    update();

    const observer = new MutationObserver(update);
    observer.observe(anchorElement, {
      attributes: true,
      attributeFilter: ['src', 'data-kites-translated', 'data-kites-applied-src', 'data-kites-show-original'],
    });

    const img = anchorElement instanceof HTMLImageElement ? null : anchorElement.querySelector('img');
    if (img) {
      observer.observe(img, {
        attributes: true,
        attributeFilter: ['src', 'data-kites-translated', 'data-kites-applied-src', 'data-kites-show-original'],
      });
    }

    return () => observer.disconnect();
  }, [srcUrl, anchorElement, isElementTranslated]);

  useEffect(() => {
    /**
     * Keeps finished controls aligned with keyboard-driven display changes.
     * @param event - Image display event containing the changed original URL.
     * @returns Nothing.
     */
    const handleDisplayChange = (event: Event): void => {
      const detail = (event as CustomEvent<{ srcUrl: string; showOriginal: boolean }>).detail;
      if (detail?.srcUrl === srcUrl) setShowOriginal(detail.showOriginal);
    };
    document.addEventListener(IMAGE_DISPLAY_CHANGED_EVENT, handleDisplayChange);
    return () => document.removeEventListener(IMAGE_DISPLAY_CHANGED_EVENT, handleDisplayChange);
  }, [srcUrl]);

  const handleToggleOriginal = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const nextShowOriginal = !showOriginal;
    setShowOriginal(nextShowOriginal);
    const target = resolveTargetMedia(srcUrl);
    if (target) {
      toggleImageDisplay(target, nextShowOriginal);
    }
  }, [showOriginal, srcUrl]);

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = resolveTargetMedia(srcUrl);
    const downloadUrl =
      target?.sourceElement.getAttribute('data-kites-applied-src') ||
      translatedRegistry.get(srcUrl)?.translatedUrl;
    if (!downloadUrl) return;

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `kites-translated-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [srcUrl]);

  const handleEditInStudio = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = resolveTargetMedia(srcUrl);
    const targetJobId =
      jobId ||
      translatedRegistry.get(srcUrl)?.jobId ||
      (target ? Number(target.sourceElement.getAttribute('data-kites-job-id')) : null);

    try {
      chrome.runtime.sendMessage({
        target: 'background',
        source: 'content',
        request: true,
        type: 'OPEN_DASHBOARD',
        payload: targetJobId ? { jobId: targetJobId } : undefined,
      });
    } catch {
      const studioUrl = targetJobId
        ? chrome.runtime.getURL(`index.html?jobId=${targetJobId}`)
        : chrome.runtime.getURL('index.html');
      window.open(studioUrl, '_blank');
    }
  }, [jobId, srcUrl]);

  useEffect(() => {
    if (buttonRef.current) {
      buttonRef.current.style.setProperty('position-anchor', anchorName);
      buttonRef.current.style.setProperty('top', 'anchor(top)');
      buttonRef.current.style.setProperty('left', 'anchor(left)');
    }
  }, [anchorName]);

  // WORKAROUND: [Tall strip anchor scroll-off] -> CSS anchor(top) glues the button to the
  // image's top edge. On tall strips (pages taller than the viewport, e.g. 14,000px
  // manhwa) that edge scrolls far above the screen, dragging the button out of reach —
  // and Chromium 153 ignores max(anchor(top), Npx) clamping (verified empirically). A
  // passive scroll listener clamps the button to the image's VISIBLE top edge instead: it
  // rides the image while scrolling, stays inside the image bounds (never floating over
  // page chrome), and hands back to pure CSS anchor positioning once the real top edge is
  // on-screen again. Fully visible images keep the exact previous behavior.
  //
  // The un-clamp path must RE-SET 'top: anchor(top)' rather than removeProperty — the
  // positioning effect owns that inline declaration, and removing it drops CSS anchoring
  // entirely, throwing the button into document flow at the bottom of the page.
  useEffect(() => {
    const button = buttonRef.current;
    if (!button || !anchorElement) return;

    const BUTTON_INSET_PX = 16;
    const BUTTON_SLOT_PX = 48; // 32px button + 8px margins + breathing room
    let clamped = false;

    const updateClamp = (): void => {
      const rect = anchorElement.getBoundingClientRect();
      const shouldClamp = rect.top < BUTTON_INSET_PX && rect.bottom > BUTTON_INSET_PX;
      if (shouldClamp) {
        clamped = true;
        // Ride the image's visible top edge: never above the viewport inset, never below
        // the image's bottom edge, never past the viewport bottom.
        const clampedTop = Math.min(
          Math.max(rect.top, BUTTON_INSET_PX),
          Math.max(rect.bottom - BUTTON_SLOT_PX, BUTTON_INSET_PX),
          window.innerHeight - BUTTON_SLOT_PX
        );
        button.style.setProperty('top', `${clampedTop}px`);
      } else if (clamped) {
        clamped = false;
        button.style.setProperty('top', 'anchor(top)');
      }
    };

    updateClamp();
    window.addEventListener('scroll', updateClamp, { passive: true, capture: true });
    window.addEventListener('resize', updateClamp, { passive: true });
    return () => {
      window.removeEventListener('scroll', updateClamp, { capture: true } as any);
      window.removeEventListener('resize', updateClamp);
      button.style.setProperty('top', 'anchor(top)');
    };
  }, [anchorElement]);

  useEffect(() => {
    /**
     * Clears pending and visible model-initialization feedback for this image.
     *
     * @returns Nothing.
     */
    const clearInitializationFeedback = (): void => {
      if (initializationDelayRef.current !== null) {
        clearTimeout(initializationDelayRef.current);
        initializationDelayRef.current = null;
      }
      setShowInitializationLabel(false);
    };

    /**
     * Handles addressed lifecycle and terminal events for this image translation.
     *
     * @param message - Runtime event forwarded by background.
     * @returns Nothing.
     */
    const handleMessage = (message: any): void => {
      if (
        message.type === 'MODEL_INITIALIZATION' &&
        message.target === 'content' &&
        message.source === 'background' &&
        message.event === true &&
        message.payload?.originalUrl === srcUrl
      ) {
        const eventJobId = message.payload.jobId;
        if (!Number.isInteger(eventJobId)) return;
        if (message.payload.phase === 'started') {
          clearInitializationFeedback();
          activeInitializationJobIdRef.current = eventJobId;
          const label = formatModelInitializationLabel(message.payload.stage, message.payload.modelName);
          setInitializationText(label);
          initializationDelayRef.current = setTimeout(() => {
            initializationDelayRef.current = null;
            if (activeInitializationJobIdRef.current === eventJobId) setShowInitializationLabel(true);
          }, MODEL_INITIALIZATION_LABEL_DELAY_MS);
        } else if (
          message.payload.phase === 'finished' &&
          activeInitializationJobIdRef.current === eventJobId
        ) {
          activeInitializationJobIdRef.current = null;
          clearInitializationFeedback();
        }
        return;
      }

      if ((message.type === 'IMAGE_TRANSLATED' || message.type === 'TRANSLATION_ERROR') && message.payload) {
        if (message.payload.originalUrl === srcUrl) {
          setLocalTranslating(false);
          clearInitializationFeedback();
          if (failureResetTimeoutRef.current !== null) {
            clearTimeout(failureResetTimeoutRef.current);
            failureResetTimeoutRef.current = null;
          }
          if (message.type === 'TRANSLATION_ERROR') {
            setHasFailed(true);
            failureResetTimeoutRef.current = setTimeout(() => {
              failureResetTimeoutRef.current = null;
              setHasFailed(false);
            }, TRANSLATION_FAILURE_VISIBLE_MS);
          } else {
            setHasFailed(false);
            setIsTranslated(true);
            setShowOriginal(false);
            if (message.payload.jobId) {
              setJobId(message.payload.jobId);
            }
          }
        }
      }
    };

    try {
      if (chrome.runtime?.id) {
        chrome.runtime.onMessage.addListener(handleMessage);
        return () => {
          clearInitializationFeedback();
          if (failureResetTimeoutRef.current !== null) {
            clearTimeout(failureResetTimeoutRef.current);
            failureResetTimeoutRef.current = null;
          }
          try {
            if (chrome.runtime?.id) {
              chrome.runtime.onMessage.removeListener(handleMessage);
            }
          } catch (e) {}
        };
      }
    } catch (e) {}
  }, [srcUrl]);

  return (
    <div
      ref={buttonRef}
      className="kites-translate-control"
      data-kites-translate-control="true"
      style={{
        position: 'fixed',
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '8px',
        marginLeft: '8px',
        pointerEvents: 'auto',
      }}
    >
      <button
        id="kites-translate-btn"
        data-kites-translate-button="true"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (hasFailed) {
            if (failureResetTimeoutRef.current !== null) {
              clearTimeout(failureResetTimeoutRef.current);
              failureResetTimeoutRef.current = null;
            }
            setHasFailed(false);
          }
          setLocalTranslating(true);
          onTranslate(srcUrl);
        }}
        disabled={activeTranslating}
        className={`kites-translate-btn ${activeTranslating ? 'kites-anim-spin' : ''}`}
        style={{
          width: '32px',
          height: '32px',
          minWidth: '32px',
          minHeight: '32px',
          borderRadius: '50%',
          backgroundColor: hasFailed ? '#dc2626' : '#f4446d',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: activeTranslating ? 'wait' : 'pointer',
          color: '#ffffff',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
          flexShrink: 0,
          pointerEvents: 'auto',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        aria-label={
          hasFailed
            ? TRANSLATION_FAILURE_LABEL
            : showInitializationLabel
            ? initializationText
            : isTranslated && !activeTranslating
            ? 'Re-translate Image'
            : 'Translate Image'
        }
        aria-describedby={showInitializationLabel && !hasFailed ? initializationLabelId : undefined}
      >
        {hasFailed ? (
          <X size={18} aria-hidden="true" />
        ) : (
          <Languages
            size={18}
            aria-hidden="true"
            className={activeTranslating ? 'kites-anim-spin' : ''}
            style={activeTranslating ? { animation: 'kites-spin 1s linear infinite' } : undefined}
          />
        )}
      </button>

      {/* Snappy 180ms Custom Tooltip */}
      {isTooltipVisible && !activeTranslating && (
        <div
          className="kites-custom-tooltip"
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: '16px',
            transform: 'translateX(-50%)',
            backgroundColor: '#181a20',
            color: '#f1f5f9',
            border: '1px solid #33384c',
            borderRadius: '6px',
            padding: '3px 8px',
            fontSize: '11px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.45)',
            pointerEvents: 'none',
            zIndex: 1000000,
            animation: 'kites-fade-in 0.15s ease-out',
          }}
        >
          {hasFailed
            ? TRANSLATION_FAILURE_LABEL
            : isTranslated && !activeTranslating
            ? 'Re-translate Image'
            : 'Translate Image'}
        </div>
      )}

      {isTranslated && !activeTranslating && (
        <div
          className="kites-finished-actions"
          data-kites-finished-actions="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <button
            type="button"
            data-kites-toggle-btn="true"
            onClick={handleToggleOriginal}
            className="kites-action-btn"
            style={{
              width: '28px',
              height: '28px',
              minWidth: '28px',
              minHeight: '28px',
              borderRadius: '50%',
              backgroundColor: showOriginal ? '#f4446d' : '#12141c',
              border: showOriginal ? '1px solid #f4446d' : '1px solid #262a3b',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)',
              transition: 'all 0.15s ease',
            }}
            title={showOriginal ? 'Show Translated Image' : 'Show Original Image'}
            aria-label={showOriginal ? 'Show Translated Image' : 'Show Original Image'}
          >
            {showOriginal ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>

          <button
            type="button"
            data-kites-download-btn="true"
            onClick={handleDownload}
            className="kites-action-btn"
            style={{
              width: '28px',
              height: '28px',
              minWidth: '28px',
              minHeight: '28px',
              borderRadius: '50%',
              backgroundColor: '#12141c',
              border: '1px solid #262a3b',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)',
              transition: 'all 0.15s ease',
            }}
            title="Download Translated Image"
            aria-label="Download Translated Image"
          >
            <Download size={14} />
          </button>

          <button
            type="button"
            data-kites-edit-btn="true"
            onClick={handleEditInStudio}
            className="kites-action-btn"
            style={{
              width: '28px',
              height: '28px',
              minWidth: '28px',
              minHeight: '28px',
              borderRadius: '50%',
              backgroundColor: '#12141c',
              border: '1px solid #262a3b',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)',
              transition: 'all 0.15s ease',
            }}
            title="Edit in Studio (New Tab)"
            aria-label="Edit in Studio"
          >
            <ExternalLink size={14} />
          </button>
        </div>
      )}
      {showInitializationLabel && (
        <span
          id={initializationLabelId}
          role="status"
          aria-live="polite"
          className="whitespace-nowrap rounded-full bg-[#171717]/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
          style={{
            whiteSpace: 'nowrap',
            borderRadius: '9999px',
            backgroundColor: 'rgba(23, 23, 23, 0.9)',
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#ffffff',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
            pointerEvents: 'none',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {initializationText}
        </span>
      )}
    </div>
  );
}

interface ScreenSnipperProps {
  onComplete: (selection: ViewportSelection) => void;
  onCancel: () => void;
}

function ScreenSnipper({ onComplete, onCancel }: ScreenSnipperProps) {
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = { x: e.clientX, y: e.clientY };
    setStartPos(pos);
    setCurrentPos(pos);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startPos) return;
    e.preventDefault();
    e.stopPropagation();
    setCurrentPos({ x: e.clientX, y: e.clientY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startPos || !currentPos) {
      onCancel();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    const selection = normalizeSelection(
      startPos,
      currentPos,
      { width: window.innerWidth, height: window.innerHeight }
    );

    if (selection) {
      onComplete(selection);
    } else {
      onCancel();
    }
  };

  const activeSelection = startPos && currentPos
    ? normalizeSelection(startPos, currentPos, { width: window.innerWidth, height: window.innerHeight })
    : null;

  return (
    <div
      className="kites-snipper-backdrop"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="kites-snipper-hint">
        <Crop size={15} />
        Drag to select area · Esc to cancel
      </div>
      {activeSelection && (
        <div
          className="kites-snipper-selection"
          style={{
            left: `${activeSelection.left}px`,
            top: `${activeSelection.top}px`,
            width: `${activeSelection.width}px`,
            height: `${activeSelection.height}px`,
          }}
        >
          <div className="kites-snipper-badge">
            {activeSelection.width} × {activeSelection.height} px
          </div>
        </div>
      )}
    </div>
  );
}

interface CropOverlayBoxProps {
  crop: CropOverlayItem;
  onTranslate: (id: string) => void;
  onReset: (id: string) => void;
  onGeometryChange: (id: string, bounds: { left: number; top: number; width: number; height: number }) => void;
  onToggleOriginal: (id: string) => void;
  onRemove: (id: string) => void;
}

const CROP_RESIZE_HANDLES: Array<{ handle: CropDragHandle; className: string }> = [
  { handle: 'n', className: 'kites-resize-n' },
  { handle: 'e', className: 'kites-resize-e' },
  { handle: 's', className: 'kites-resize-s' },
  { handle: 'w', className: 'kites-resize-w' },
  { handle: 'nw', className: 'kites-resize-nw' },
  { handle: 'ne', className: 'kites-resize-ne' },
  { handle: 'se', className: 'kites-resize-se' },
  { handle: 'sw', className: 'kites-resize-sw' },
];

function CropOverlayBox({ crop, onTranslate, onReset, onGeometryChange, onToggleOriginal, onRemove }: CropOverlayBoxProps) {
  const isEditable = crop.status === 'draft' || crop.status === 'failed';
  const isTranslating = crop.status === 'capturing' || crop.status === 'translating';
  const displayUrl = crop.showOriginal ? crop.originalDataUrl : (crop.translatedDataUrl || crop.originalDataUrl);
  const [initFeedback, setInitFeedback] = useState<string | null>(null);
  const dragRef = useRef<{
    handle: CropDragHandle;
    startClientX: number;
    startClientY: number;
    initial: { left: number; top: number; width: number; height: number };
  } | null>(null);

  useEffect(() => {
    const handleMessage = (message: any) => {
      if (
        message.type === 'MODEL_INITIALIZATION' &&
        message.target === 'content' &&
        message.source === 'background' &&
        message.event === true &&
        message.payload?.requestId === crop.id
      ) {
        if (message.payload.phase === 'started') {
          setInitFeedback(formatModelInitializationLabel(message.payload.stage, message.payload.modelName));
        } else if (message.payload.phase === 'finished') {
          setInitFeedback(null);
        }
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [crop.id]);

  const openInStudio = () => {
    try {
      chrome.runtime.sendMessage({
        target: 'background',
        source: 'content',
        request: true,
        type: 'OPEN_DASHBOARD'
      });
    } catch {
      window.open(chrome.runtime.getURL('index.html'), '_blank');
    }
  };

  const beginInteraction = (event: React.PointerEvent<HTMLDivElement>, handle: CropDragHandle) => {
    if (event.button !== 0 || (handle !== 'move' && !isEditable)) return;
    event.preventDefault();
    event.stopPropagation();
    // Crop windows are screen-pinned (viewport coordinates): pointer deltas use
    // raw client coordinates so scrolling during or between drags never shifts
    // the window's on-screen anchor.
    dragRef.current = {
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      initial: { left: crop.left, top: crop.top, width: crop.width, height: crop.height },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    // Clamp to the viewport: a pinned window must stay reachable on screen,
    // even when the document is far taller than the viewport.
    onGeometryChange(crop.id, computeCropBounds(
      drag.initial,
      drag.handle,
      event.clientX - drag.startClientX,
      event.clientY - drag.startClientY,
      { width: window.innerWidth, height: window.innerHeight }
    ));
  };

  const endInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
  };

  return (
    <div
      className={`kites-crop-overlay ${isEditable ? 'kites-crop-editable' : 'kites-crop-frozen'}`}
      style={{
        left: `${crop.left}px`,
        top: `${crop.top}px`,
        width: `${crop.width}px`,
        height: `${crop.height}px`,
      }}
      onPointerDown={(event) => beginInteraction(event, 'move')}
      onPointerMove={updateInteraction}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
    >
      <div
        className={`kites-crop-toolbar ${crop.top < 44 ? 'kites-crop-toolbar-inside' : ''}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {isEditable && (
          <button type="button" className="kites-crop-toolbar-btn" onClick={() => onTranslate(crop.id)} title="Translate area">
            <Languages size={18} />
          </button>
        )}
        {crop.status === 'completed' && crop.originalDataUrl && (
          <button
            type="button"
            className={`kites-crop-toolbar-btn ${crop.showOriginal ? 'kites-crop-btn-active' : ''}`}
            onClick={() => onToggleOriginal(crop.id)}
            title={crop.showOriginal ? 'View Translated' : 'View Original'}
          >
            {crop.showOriginal ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
        {crop.status === 'completed' && (
          <button type="button" className="kites-crop-toolbar-btn" onClick={() => onReset(crop.id)} title="Reset crop">
            <RotateCcw size={18} />
          </button>
        )}
        {crop.jobId && (
          <button type="button" className="kites-crop-toolbar-btn" onClick={openInStudio} title="Open in Studio">
            <ExternalLink size={18} />
          </button>
        )}
        <button type="button" className="kites-crop-toolbar-btn" onClick={() => onRemove(crop.id)} title="Close">
          <X size={18} />
        </button>
      </div>

      {displayUrl && (
        <img src={displayUrl} alt="Cropped manga panel" className="kites-crop-overlay-img" draggable={false} />
      )}

      {isTranslating && crop.originalDataUrl && (
        <div className="kites-crop-loading-badge">
          <Languages size={16} className="kites-anim-spin" />
          <span>{initFeedback || (crop.status === 'capturing' ? 'Capturing...' : 'Translating...')}</span>
        </div>
      )}

      {crop.status === 'failed' && crop.error && <div className="kites-crop-error-pill">{crop.error}</div>}

      {isEditable && CROP_RESIZE_HANDLES.map(({ handle, className }) => (
        <div
          key={handle}
          className={`kites-crop-resize-handle ${className}`}
          onPointerDown={(event) => beginInteraction(event, handle)}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

/**
 * Manages automatic image detection plus hover/persistent manual translation overlays.
 *
 * @returns Collection of active translation buttons or null in idle Hover mode.
 */
function GlobalOverlay() {
  const [isEnabled, setIsEnabled] = useState<boolean>(true);
  const [activeImg, setActiveImg] = useState<OverlayImage | null>(null);
  const [consistentImages, setConsistentImages] = useState<OverlayImage[]>([]);
  const [mode, setMode] = useState<'hover' | 'persistent'>('hover');
  const [autoTranslate, setAutoTranslate] = useState(false);
  // Tracks every URL with a pending translation job. A Set (not a single slot) keeps
  // concurrent jobs from clobbering each other's UI state: with a single value, finishing
  // job B cleared the spinner that a still-queued job A was showing.
  const [translatingUrls, setTranslatingUrls] = useState<Set<string>>(new Set());
  const [isSnipping, setIsSnipping] = useState<boolean>(false);
  const [crops, setCrops] = useState<CropOverlayItem[]>([]);
  const [isReaderOpen, setIsReaderOpen] = useState<boolean>(false);
  const [isPillDismissed, setIsPillDismissed] = useState<boolean>(false);
  const [chapterPages, setChapterPages] = useState<ChapterReaderPage[]>([]);
  const [isTranslatingChapter, setIsTranslatingChapter] = useState<boolean>(false);
  const isCustomReaderRef = useRef<boolean>(false);

  const activeImgRef = useRef(activeImg);
  const translatingUrlsRef = useRef(translatingUrls);
  const siteRulesRef = useRef<SiteSelectorRule[]>([]);
  // Last known pointer position for scroll-driven hover re-resolution (scroll fires no
  // mouse events, so the hover target must be re-derived from the last cursor position).
  const lastCursorPositionRef = useRef<{ x: number; y: number } | null>(null);
  activeImgRef.current = activeImg;
  translatingUrlsRef.current = translatingUrls;

  /** Resolves the custom image selector for this domain if configured in site rules. */
  const getActiveCustomSelector = (): string | undefined => {
    return findMatchingSiteRule(window.location.hostname, siteRulesRef.current)?.selector;
  };

  /** Scans the document for all comic chapter pages and keeps translation states updated. */
  const refreshChapterPages = useCallback(() => {
    const isTranslatedCheck = (url: string) => {
      const reg = translatedRegistry.get(url);
      return {
        isTranslated: Boolean(reg?.translatedUrl),
        translatedUrl: reg?.translatedUrl,
      };
    };
    const scanned = scanChapterPages(document, getActiveCustomSelector(), isTranslatedCheck);
    setChapterPages(scanned);
    return scanned;
  }, []);

  useEffect(() => {
    if (!isEnabled) return;
    if (!isReaderOpen && !isCustomReaderRef.current) {
      refreshChapterPages();
    }
    const interval = setInterval(() => {
      if (!isReaderOpen && !isCustomReaderRef.current) refreshChapterPages();
    }, 4000);
    return () => clearInterval(interval);
  }, [isEnabled, isReaderOpen, refreshChapterPages]);

  const handleTranslateChapter = useCallback(async (urls: string[]) => {
    if (urls.length === 0) return;
    setIsTranslatingChapter(true);

    for (const url of urls) {
      rememberChapterRequest(url, resolveTargetMedia(url));
    }

    setChapterPages((prev) =>
      prev.map((page) =>
        urls.includes(page.url) && !page.isTranslated
          ? { ...page, status: 'queued' as const }
          : page
      )
    );

    try {
      await chrome.runtime.sendMessage({
        type: 'BATCH_QUEUE_TRANSLATIONS',
        payload: { urls },
      });
    } catch (err) {
      console.warn('[Content Script] Failed to dispatch batch chapter translation:', err);
      setIsTranslatingChapter(false);
    }
  }, []);

  useEffect(() => {
    const handleOpenReader = async (event: Event) => {
      const customEvent = event as CustomEvent<{ pages?: ChapterReaderPage[] } | undefined>;
      if (customEvent.detail?.pages && Array.isArray(customEvent.detail.pages) && customEvent.detail.pages.length > 0) {
        isCustomReaderRef.current = true;
        const initialPages = customEvent.detail.pages;
        setChapterPages(initialPages);
        setIsReaderOpen(true);

        // Resolve any history pages requiring durable, content-script-owned Blob URLs
        const historyPages = initialPages.filter((p) => p.jobId && (!p.translatedUrl || p.translatedUrl.startsWith('blob:chrome-extension:')));
        if (historyPages.length > 0) {
          try {
            const resolved = await Promise.all(
              historyPages.map(async (page) => {
                try {
                  const res = await chrome.runtime.sendMessage({
                    type: 'GET_JOB_IMAGE',
                    target: 'background',
                    source: 'content',
                    request: true,
                    payload: { jobId: page.jobId },
                  });
                  if (res?.status === 'success' && res.dataUrl) {
                    return { id: page.id, translatedUrl: createSafeBlobUrlFromData(res.dataUrl) };
                  }
                } catch {}
                return null;
              })
            );
            setChapterPages((current) =>
              current.map((page) => {
                const match = resolved.find((r) => r && r.id === page.id);
                return match ? { ...page, translatedUrl: match.translatedUrl } : page;
              })
            );
          } catch (err) {
            console.warn('[Content Script] Failed resolving history images:', err);
          }
        }
      } else {
        isCustomReaderRef.current = false;
        refreshChapterPages();
        setIsReaderOpen(true);
      }
    };
    document.addEventListener('kites-open-chapter-reader', handleOpenReader);
    return () => document.removeEventListener('kites-open-chapter-reader', handleOpenReader);
  }, [refreshChapterPages]);

  /**
   * Marks an image URL as no longer translating so its button leaves the spinner state.
   *
   * @param srcUrl - Original image URL whose pending job ended.
   * @returns Nothing.
   */
  const clearTranslatingUrl = (srcUrl: string): void => {
    setTranslatingUrls((current) => {
      if (!current.has(srcUrl)) return current;
      const next = new Set(current);
      next.delete(srcUrl);
      return next;
    });
  };

  /**
   * Sends an image to the background queue and keeps its overlay visible until completion.
   *
   * @param srcUrl - Original image URL to queue.
   * @param image - Optional DOM image for pinning Hover mode.
   * @returns Nothing.
   */
  const requestTranslation = (srcUrl: string, image?: OverlayImage): void => {
    if (!srcUrl || translatingUrlsRef.current.has(srcUrl)) return;

    const target = image ?? resolveTargetMedia(srcUrl);
    const cachedRecord = translatedRegistry.get(srcUrl);
    // If translation was already completed in this session and cached in registry, but the host site
    // just loaded or refreshed the raw image (e.g. single-page reader navigated back), re-apply instantly!
    const targetEl = target?.sourceElement || target?.imgElement;
    if (
      cachedRecord &&
      cachedRecord.translatedUrl &&
      target &&
      targetEl &&
      targetEl.getAttribute('data-kites-translated') !== 'true'
    ) {
      console.log('[Content Script] Re-applying existing translation from memory for:', srcUrl);
      if (image) {
        setActiveImg(image);
        registerMediaTarget(image);
      }
      replaceImageWithTranslation(target, cachedRecord);
      return;
    }

    if (image) {
      setActiveImg(image);
      registerMediaTarget(image);
    }
    // Lock queue-time document context: after SPA navigation the target may detach before completion.
    rememberChapterRequest(srcUrl, target);
    setTranslatingUrls((current) => new Set(current).add(srcUrl));
    console.log('[Content Script] Sending TRANSLATE_IMAGE to background:', srcUrl);

    try {
      if (!chrome.runtime?.id) {
        translatedRegistry.forget(srcUrl);
        clearTranslatingUrl(srcUrl);
        console.warn('[Content Script] Extension context invalidated. Please refresh the page.');
        return;
      }
      chrome.runtime.sendMessage({ type: 'TRANSLATE_IMAGE', url: srcUrl }, (response) => {
        if (chrome.runtime.lastError || response?.status === 'error') {
          translatedRegistry.forget(srcUrl);
          clearTranslatingUrl(srcUrl);
          console.error('[Content Script] Message failed:', chrome.runtime.lastError?.message || response?.error);
        }
      });
    } catch (error) {
      translatedRegistry.forget(srcUrl);
      clearTranslatingUrl(srcUrl);
      console.warn('[Content Script] Chrome runtime call failed (extension reloaded/invalidated):', error);
    }
  };

  const captureQueueRef = useRef<Promise<void>>(Promise.resolve());

  const handleCropComplete = (selection: ViewportSelection) => {
    setIsSnipping(false);
    const requestId = Math.random().toString(36).substring(2, 11);
    // Screen-pinned window: keep the exact viewport location the user drew at.
    // Page scrolling must never move it (issue #1).
    setCrops((prev) => [...prev, {
      id: requestId,
      sourceKey: `kites-capture:${requestId}`,
      left: selection.left,
      top: selection.top,
      width: selection.width,
      height: selection.height,
      originalDataUrl: '',
      status: 'draft',
      showOriginal: false,
    }]);
  };

  const requestVisibleTabCapture = async (): Promise<string> => {
    const overlayRoot = document.getElementById('kites-global-overlay');
    overlayRoot?.classList.add('kites-capture-hidden');
    try {
      await waitForCleanFrames();
      return await new Promise<string>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { target: 'background', source: 'content', request: true, type: 'CAPTURE_VISIBLE_TAB' },
          (response) => {
            if (chrome.runtime.lastError || response?.status !== 'success' || !response?.dataUrl) {
              reject(new Error(chrome.runtime.lastError?.message || response?.error || 'Failed to capture screen'));
              return;
            }
            resolve(response.dataUrl);
          }
        );
      });
    } finally {
      overlayRoot?.classList.remove('kites-capture-hidden');
    }
  };

  const handleTranslateCrop = (id: string) => {
    captureQueueRef.current = captureQueueRef.current.catch(() => undefined).then(async () => {
      const crop = crops.find((candidate) => candidate.id === id);
      if (!crop || (crop.status !== 'draft' && crop.status !== 'failed')) return;

      // The window is screen-pinned, so its stored viewport rectangle is
      // already the capture region; the crop must simply sit fully on screen.
      const selection: ViewportSelection = {
        left: crop.left,
        top: crop.top,
        width: crop.width,
        height: crop.height,
      };
      if (
        selection.left < 0 || selection.top < 0 ||
        selection.left + selection.width > window.innerWidth ||
        selection.top + selection.height > window.innerHeight
      ) {
        setCrops((prev) => prev.map((candidate) => candidate.id === id
          ? { ...candidate, status: 'failed', error: 'Move the crop fully into view before translating.' }
          : candidate));
        return;
      }
      saveLastCropSelection(selection);

      setCrops((prev) => prev.map((candidate) => candidate.id === id
        ? { ...candidate, status: 'capturing', originalDataUrl: '', translatedDataUrl: undefined, jobId: undefined, error: undefined, showOriginal: false }
        : candidate));

      try {
        const fullDataUrl = await requestVisibleTabCapture();
        const img = new Image();
        img.src = fullDataUrl;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to decode captured screen'));
        });

        const sourceRect = calculateCaptureSourceRect(
          selection,
          { width: window.innerWidth, height: window.innerHeight },
          img.naturalWidth,
          img.naturalHeight
        );
        const croppedDataUrl = await cropCapturedDataUrl(fullDataUrl, sourceRect);
        const safeOriginalBlob = createSafeBlobUrlFromData(croppedDataUrl);
        setCrops((prev) => prev.map((candidate) => candidate.id === id
          ? { ...candidate, originalDataUrl: safeOriginalBlob, status: 'translating' }
          : candidate));

        await new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              target: 'background', source: 'content', request: true,
              type: 'TRANSLATE_CAPTURED_IMAGE',
              payload: { requestId: id, dataUrl: croppedDataUrl },
            },
            (response) => {
              if (chrome.runtime.lastError || response?.status === 'error') {
                reject(new Error(chrome.runtime.lastError?.message || response?.error || 'Failed to queue translation'));
              } else {
                resolve();
              }
            }
          );
        });
      } catch (error) {
        console.error('[Content Script] Crop translation failed:', error);
        setCrops((prev) => prev.map((candidate) => candidate.id === id
          ? { ...candidate, status: 'failed', error: error instanceof Error ? error.message : String(error) }
          : candidate));
      }
    });
  };

  const handleGeometryChange = useCallback((id: string, bounds: { left: number; top: number; width: number; height: number }) => {
    setCrops((prev) => prev.map((candidate) => candidate.id === id
      ? { ...candidate, left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
      : candidate));
  }, []);

  const handleResetCrop = useCallback((id: string) => {
    setCrops((prev) => prev.map((candidate) => candidate.id === id
      ? { ...candidate, status: 'draft', originalDataUrl: '', translatedDataUrl: undefined, jobId: undefined, error: undefined, showOriginal: false }
      : candidate));
  }, []);

  const handleToggleOriginal = useCallback((id: string) => {
    setCrops((prev) =>
      prev.map((c) => (c.id === id ? { ...c, showOriginal: !c.showOriginal } : c))
    );
  }, []);

  const handleRemoveCrop = useCallback((id: string) => {
    setCrops((prev) => prev.filter((c) => c.id !== id));
  }, []);

  useEffect(() => {
    if (!isEnabled) return;

    const repeatLastScreenCrop = () => {
      const last = loadLastCropSelection();
      if (!last) return;
      const newId = `crop_${Date.now()}`;
      const newCrop: CropOverlayItem = {
        id: newId,
        sourceKey: `kites-capture:${newId}`,
        left: Math.max(0, Math.min(window.innerWidth - last.width, last.left)),
        top: Math.max(0, Math.min(window.innerHeight - last.height, last.top)),
        width: last.width,
        height: last.height,
        status: 'draft',
        originalDataUrl: '',
        showOriginal: false,
      };
      setCrops((prev) => [...prev, newCrop]);
      setTimeout(() => {
        handleTranslateCrop(newId);
      }, 50);
    };

    const actions: ReadingShortcutActions<MediaTarget> = {
      getContext: () => {
        const cursor = lastCursorPositionRef.current;
        const target = cursor ? resolveMediaTargetAtPoint(cursor.x, cursor.y, getActiveCustomSelector()) : null;
        return {
          enabled: isEnabled,
          busy: isSnipping || translatingUrlsRef.current.size > 0 ||
            crops.some((crop) => crop.status === 'capturing' || crop.status === 'translating'),
          target,
        };
      },
      hasTranslation: (target) => Boolean(translatedRegistry.get(target.srcUrl)),
      toggleOriginal: (target) => {
        const record = translatedRegistry.get(target.srcUrl);
        if (record) toggleImageDisplay(target, !record.showOriginal);
      },
      translate: (target) => requestTranslation(target.srcUrl, {
        ...target,
        anchorName: getAnchorName(target.surfaceElement),
      }),
      startAreaSelection: () => setIsSnipping(true),
      repeatLastScreenCrop,
      openChapterReader: () => {
        refreshChapterPages();
        setIsReaderOpen(true);
      },
    };
    /**
     * Saves live pointer coordinates for shortcut targeting in both manual modes.
     * @param event - Pointer movement over the current document.
     * @returns Nothing.
     */
    const trackPointer = (event: MouseEvent): void => {
      lastCursorPositionRef.current = { x: event.clientX, y: event.clientY };
    };
    /**
     * Clears stale hover context when the pointer leaves the document.
     * @param event - Boundary event whose related target may be outside the document.
     * @returns Nothing.
     */
    const clearPointer = (event: MouseEvent): void => {
      if (!event.relatedTarget) lastCursorPositionRef.current = null;
    };
    /**
     * Dispatches a guarded original-image toggle from the page keyboard.
     * @param event - Keyboard event outside editable page controls.
     * @returns Nothing.
     */
    const onKeydown = (event: KeyboardEvent): void => {
      handleReadingKeydown(event, actions);
    };
    const onKeyup = (event: KeyboardEvent): void => {
      handleReadingKeyup(event, actions);
    };
    /**
     * Routes browser commands without retaining an asynchronous response channel.
     * @param message - Runtime command forwarded by background.
     * @returns Nothing.
     */
    const onCommand = (message: unknown): void => {
      handleReadingCommand(message, actions);
    };
    document.addEventListener('mousemove', trackPointer, { passive: true });
    document.addEventListener('mouseout', clearPointer, { passive: true });
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('keyup', onKeyup);
    chrome.runtime.onMessage.addListener(onCommand);
    return () => {
      document.removeEventListener('mousemove', trackPointer);
      document.removeEventListener('mouseout', clearPointer);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('keyup', onKeyup);
      chrome.runtime.onMessage.removeListener(onCommand);
    };
  }, [isEnabled, isSnipping, crops, refreshChapterPages]);

  // Load user settings and react to popup updates.
  useEffect(() => {
    const applyState = (state: PopupState) => {
      cachedSiteRules = state.siteRules || [];
      siteRulesRef.current = state.siteRules || [];
      const currentHost = window.location.hostname;
      const disabled = isDomainDisabled(currentHost, state.disabledDomains);
      setIsEnabled((state.isExtensionEnabled ?? true) && !disabled);
      setMode(state.manualMode || 'hover');
      setAutoTranslate(state.isAuto || false);
    };

    const loadSettings = () => {
      chrome.storage.local.get(STORAGE_KEYS.POPUP_STATE, (data) => {
        const state = data[STORAGE_KEYS.POPUP_STATE] as PopupState | undefined;
        if (state) applyState(state);
      });
    };
    loadSettings();
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local' || !changes[STORAGE_KEYS.POPUP_STATE]?.newValue) return;
      const state = changes[STORAGE_KEYS.POPUP_STATE].newValue as PopupState;
      applyState(state);
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  // Remove every manual control immediately when the extension is disabled.
  useEffect(() => {
    if (isEnabled) return;
    setActiveImg(null);
    setConsistentImages([]);
    setTranslatingUrls(new Set());
  }, [isEnabled]);

  // Receive terminal job events, restore the image, and allow Hover mode to disappear again.
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'START_AREA_SELECTION') return;

      if (message.type === 'CAPTURE_TRANSLATED' && message.payload) {
        const { requestId, bakedBase64, jobId } = message.payload;
        setCrops((prev) =>
          prev.map((c) =>
            c.id === requestId
              ? {
                  ...c,
                  status: 'completed',
                  translatedDataUrl: createSafeBlobUrlFromData(bakedBase64),
                  jobId,
                }
              : c
          )
        );
        return;
      }

      if (message.type === 'CAPTURE_TRANSLATION_ERROR' && message.payload) {
        const { requestId, error } = message.payload;
        setCrops((prev) =>
          prev.map((c) =>
            c.id === requestId
              ? { ...c, status: 'failed', error: error || 'Translation failed' }
              : c
          )
        );
        return;
      }

      if (!message.payload || (message.type !== 'IMAGE_TRANSLATED' && message.type !== 'TRANSLATION_ERROR')) return;

      const { originalUrl, bakedBase64, jobId } = message.payload;
      clearTranslatingUrl(originalUrl);

      if (message.type !== 'IMAGE_TRANSLATED' || !bakedBase64) {
        translatedRegistry.forget(originalUrl);
        setChapterPages((prev) =>
          prev.map((page) =>
            page.url === originalUrl ? { ...page, status: 'error' as const } : page
          )
        );
        return;
      }
      console.log(`[Content Script] Received translated image for: ${originalUrl}`);
      const target = resolveTargetMedia(originalUrl);
      // Archive completed translation before requiring a DOM target; detached pages still enter the registry.
      const record = translatedRegistry.complete(originalUrl, bakedBase64, jobId, target ?? undefined);

      if (!record) {
        if (translatedRegistry.isLimitReached()) {
          console.warn(`[Content Script] Result not retained: session image limit reached for: ${originalUrl}`);
          setChapterPages((prev) => {
            const next = prev.map((page) =>
              page.url === originalUrl
                ? {
                    ...page,
                    status: 'error' as const,
                  }
                : page
            );
            if (next.every((p) => p.isTranslated || p.status === 'error')) {
              setIsTranslatingChapter(false);
            }
            return next;
          });
        }
        return;
      }

      // Reactively update chapter reader modal pages with the new translated image!
      setChapterPages((prev) => {
        const next = prev.map((page) =>
          page.url === originalUrl
            ? {
                ...page,
                isTranslated: true,
                translatedUrl: record.translatedUrl,
                status: 'completed' as const,
              }
            : page
        );
        if (next.every((p) => p.isTranslated || p.status === 'error')) {
          setIsTranslatingChapter(false);
        }
        return next;
      });

      // Late results belong to the queued chapter, never a same-URL image in the new SPA chapter.
      if (getChapterScopeId(record.sourcePage) !== getChapterScopeId(window.location.href) || !target) {
        console.warn(`[Content Script] Target media element detached or chapter changed; translation archived when context is known: ${originalUrl}`);
        return;
      }

      replaceImageWithTranslation(target, record);
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  // Automatic mode observes only images entering the viewport. Queue capacity remains owned by background.
  useEffect(() => {
    if (!isEnabled || !autoTranslate) return;

    const queuedUrls = new Set<string>();
    const translatedSources = new WeakSet<Element>();
    const observedSurfaces = new WeakSet<HTMLElement>();
    const targetsBySurface = new WeakMap<HTMLElement, MediaTarget>();
    const observedMutationRoots = new WeakSet<Node>();
    let timeoutId: number | null = null;

    const queueVisibleImage = (target: MediaTarget) => {
      const { sourceElement, srcUrl } = target;
      if (translatedSources.has(sourceElement) || queuedUrls.has(srcUrl)) return;
      registerMediaTarget(target);
      // Lock queue-time position before auto-translate fires; the reader may navigate before completion.
      rememberChapterRequest(srcUrl, target);
      queuedUrls.add(srcUrl);
      console.log('[Content Script] Auto-Translating visible image:', srcUrl);
      chrome.runtime.sendMessage({ type: 'TRANSLATE_IMAGE', url: srcUrl }, (response) => {
        if (chrome.runtime.lastError || response?.status === 'error') {
          translatedRegistry.forget(srcUrl);
          queuedUrls.delete(srcUrl);
          console.error('[Content Script] Auto-Translate message failed:', chrome.runtime.lastError?.message || response?.error);
        }
      });
    };

    const intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const target = targetsBySurface.get(entry.target as HTMLElement);
        if (entry.isIntersecting && target) queueVisibleImage(target);
      }
    });

    const observeImages = () => {
      for (const target of discoverMediaTargets(document, getActiveCustomSelector())) {
        if (!observedSurfaces.has(target.surfaceElement)) {
          observedSurfaces.add(target.surfaceElement);
          targetsBySurface.set(target.surfaceElement, target);
          intersectionObserver.observe(target.surfaceElement);
        }
      }
      for (const root of collectQueryRoots(document)) {
        if (root === document || observedMutationRoots.has(root)) continue;
        observedMutationRoots.add(root);
        mutationObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'style', 'href'] });
      }
    };

    const scheduleObserve = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(observeImages, IMAGE_SCAN_DEBOUNCE_MS);
    };

    const mutationObserver = new MutationObserver((mutations) => {
      if (isSelfMutating) return;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLImageElement && mutation.attributeName === 'src') {
          const target = mutation.target;
          if (target.getAttribute('data-kites-translated') === 'true' || target.src.startsWith('blob:') || target.src.startsWith('data:')) {
            translatedSources.add(target);
          }
        }
      }
      scheduleObserve();
    });

    observeImages();
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'style', 'href'] });
    window.addEventListener('resize', scheduleObserve, { passive: true });

    return () => {
      mutationObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener('resize', scheduleObserve);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [isEnabled, autoTranslate]);

  // Persistent mode creates a manual button for every valid image.
  useEffect(() => {
    if (!isEnabled || mode !== 'persistent') {
      setConsistentImages([]);
      return;
    }

    const observedMutationRoots = new WeakSet<Node>();
    let timeoutId: number | null = null;
    const updateImages = () => {
      setConsistentImages(discoverMediaTargets(document, getActiveCustomSelector())
        .map((target) => ({ ...target, anchorName: getAnchorName(target.anchorElement) })));
      for (const root of collectQueryRoots(document)) {
        if (root === document || observedMutationRoots.has(root)) continue;
        observedMutationRoots.add(root);
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'style', 'href'] });
      }
    };
    const scheduleUpdate = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(updateImages, IMAGE_SCAN_DEBOUNCE_MS);
    };
    const observer = new MutationObserver(scheduleUpdate);

    updateImages();
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [isEnabled, mode]);

  // Hover mode retains its normal fade behavior, except a queued translation remains pinned.
  useEffect(() => {
    if (!isEnabled || mode !== 'hover') {
      setActiveImg(null);
      return;
    }

    let hideTimeoutId: number | null = null;
    const cancelHide = () => {
      if (hideTimeoutId !== null) {
        window.clearTimeout(hideTimeoutId);
        hideTimeoutId = null;
      }
    };
    const scheduleHide = () => {
      if (hideTimeoutId === null && translatingUrlsRef.current.size === 0) {
        hideTimeoutId = window.setTimeout(() => {
          hideTimeoutId = null;
          if (translatingUrlsRef.current.size > 0) return;
          // WORKAROUND: [Event-ordering lottery on fast cursor exits] -> whether the button
          // hides depends on which coalesced mouseover/mouseout/mousemove events Chrome
          // delivers, not on where the cursor actually is (fast exits can skip the re-show,
          // edge-crossing oscillations can cancel the hide, and rapid moves coalesce so the
          // last delivered mousemove position is stale at the surface edge). Decide from the
          // UA's own :hover chain instead — Chromium recomputes it after every move and
          // scroll regardless of event delivery. Its recomputation can also LAG a burst of
          // coalesced moves (stale true at fire time), so a "still hovered" verdict
          // re-schedules the check instead of keeping the button indefinitely: the state
          // settles within a frame or two and the next poll hides.
          const surface = activeImgRef.current?.surfaceElement;
          let surfaceHovered = false;
          try {
            surfaceHovered = surface ? (surface.matches(':hover') || surface.querySelector(':hover') !== null) : false;
          } catch {
            // :hover unsupported in this environment — fall back to the last cursor
            // position against the surface rect (strict bounds, no tolerance).
            const cursor = lastCursorPositionRef.current;
            if (cursor && surface) {
              const rect = surface.getBoundingClientRect();
              surfaceHovered = cursor.x >= rect.left && cursor.x <= rect.right && cursor.y >= rect.top && cursor.y <= rect.bottom;
            }
          }
          if (surfaceHovered) {
            scheduleHide();
            return;
          }
          setActiveImg(null);
        }, HOVER_LEAVE_DELAY_MS);
      }
    };
    const handleMouseOver = (event: MouseEvent) => {
      lastCursorPositionRef.current = { x: event.clientX, y: event.clientY };
      const target = event.target as HTMLElement;
      if (activeImgRef.current && (target === activeImgRef.current.surfaceElement || activeImgRef.current.surfaceElement.contains(target) || target.closest(TRANSLATE_CONTROL_SELECTOR))) {
        cancelHide();
        return;
      }
      const mediaTarget = resolveHoverMediaTarget(event, getActiveCustomSelector());
      if (!mediaTarget) return;
      // WORKAROUND: [Tolerance halo cancels hide on exit] -> surfaceContainsPoint forgives
      // up to POINTER_TOLERANCE_PX (3px), so a cursor that just LEFT the image can still
      // resolve to it via a container's img descendant. Slow exits emit a mouseover inside
      // that halo which cancels the pending hide (button never hides); fast exits skip past
      // the halo between coalesced events (button hides) — the reported speed-dependence.
      // When the resolver returns the SAME surface but the cursor is strictly outside its
      // rect, treat it as a genuine leave and let the pending hide run.
      if (activeImgRef.current && mediaTarget.surfaceElement === activeImgRef.current.surfaceElement) {
        const rect = mediaTarget.surfaceElement.getBoundingClientRect();
        const strictlyOutside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
        if (strictlyOutside) return;
      }
      cancelHide();
      registerMediaTarget(mediaTarget);
      setActiveImg({ ...mediaTarget, anchorName: getAnchorName(mediaTarget.surfaceElement) });
    };
    const handleMouseOut = (event: MouseEvent) => {
      // WORKAROUND: [Document-exit coordinates resurrect cleared pointer] -> a mouseout with
      // no relatedTarget means the pointer left the window entirely. Reading shortcuts rely
      // on lastCursorPositionRef being null at that moment to reject Alt+Shift+Z/F with no
      // live target; writing the stale exit coordinates back (this listener registers after
      // the shortcut listener) would let a command translate the last-hovered image after
      // the user already left the page. Hide scheduling below still runs as usual.
      if (event.relatedTarget) {
        lastCursorPositionRef.current = { x: event.clientX, y: event.clientY };
      }
      const current = activeImgRef.current;
      if (!current) return;
      const target = event.target as HTMLElement;
      const relatedTarget = event.relatedTarget as HTMLElement | null;
      if (relatedTarget && (relatedTarget === current.surfaceElement || current.surfaceElement.contains(relatedTarget) || relatedTarget.closest(TRANSLATE_CONTROL_SELECTOR))) {
        cancelHide();
        return;
      }
      if (target === current.surfaceElement || current.surfaceElement.contains(target) || target.closest(TRANSLATE_CONTROL_SELECTOR)) scheduleHide();
    };

    // WORKAROUND: [Scrolling fires no boundary events] -> mouseover/mouseout only fire when
    // the pointer crosses element edges, so scrolling a tall page under a stationary cursor
    // went unnoticed: the pending hover-hide killed the button mid-scroll and nothing
    // re-showed it until the cursor physically re-entered the image. While scrolling,
    // cancel the pending hide; once scrolling settles, re-resolve the media target at the
    // last cursor position — the button follows the image actually under the cursor, and
    // hides only when that point genuinely has no media (a gap or outside the reader).
    const SCROLL_RESOLVE_DEBOUNCE_MS = 120;
    let scrollResolveTimeoutId: number | null = null;

    const resolveHoverAtCursor = (): void => {
      const cursor = lastCursorPositionRef.current;
      if (!cursor) return;
      const mediaTarget = resolveMediaTargetAtPoint(cursor.x, cursor.y, getActiveCustomSelector());
      if (mediaTarget) {
        cancelHide();
        if (!activeImgRef.current || activeImgRef.current.surfaceElement !== mediaTarget.surfaceElement) {
          registerMediaTarget(mediaTarget);
          setActiveImg({ ...mediaTarget, anchorName: getAnchorName(mediaTarget.surfaceElement) });
        }
      } else if (activeImgRef.current) {
        scheduleHide();
      }
    };

    const handleScroll = (): void => {
      cancelHide();
      if (scrollResolveTimeoutId !== null) window.clearTimeout(scrollResolveTimeoutId);
      scrollResolveTimeoutId = window.setTimeout(() => {
        scrollResolveTimeoutId = null;
        resolveHoverAtCursor();
      }, SCROLL_RESOLVE_DEBOUNCE_MS);
    };

    document.addEventListener('mouseover', handleMouseOver, { passive: true });
    document.addEventListener('mouseout', handleMouseOut, { passive: true });
    // Keep the cursor position continuously fresh — the hide-time position check and the
    // scroll re-resolve both rely on it, and boundary events alone leave it stale while
    // the pointer glides within one element.
    const handleMouseMove = (event: MouseEvent): void => {
      lastCursorPositionRef.current = { x: event.clientX, y: event.clientY };
    };
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    return () => {
      cancelHide();
      if (scrollResolveTimeoutId !== null) window.clearTimeout(scrollResolveTimeoutId);
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
      document.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('scroll', handleScroll, { capture: true } as any);
    };
  }, [isEnabled, mode]);

  if (!isEnabled) return null;

  return (
    <>
      {isSnipping && (
        <ScreenSnipper
          onComplete={handleCropComplete}
          onCancel={() => setIsSnipping(false)}
        />
      )}

      {crops.map((crop) => (
        <CropOverlayBox
          key={crop.id}
          crop={crop}
          onTranslate={handleTranslateCrop}
          onReset={handleResetCrop}
          onGeometryChange={handleGeometryChange}
          onToggleOriginal={handleToggleOriginal}
          onRemove={handleRemoveCrop}
        />
      ))}

      {mode === 'persistent' && consistentImages.map((image) => (
        <TranslateButton
          key={image.anchorName}
          srcUrl={image.srcUrl}
          anchorName={image.anchorName}
          anchorElement={image.anchorElement}
          isTranslating={translatingUrls.has(image.srcUrl)}
          onTranslate={(srcUrl) => requestTranslation(srcUrl, image)}
        />
      ))}

      {mode === 'hover' && activeImg && (
        <TranslateButton
          srcUrl={activeImg.srcUrl}
          anchorName={activeImg.anchorName}
          anchorElement={activeImg.surfaceElement}
          isTranslating={translatingUrls.has(activeImg.srcUrl)}
          onTranslate={(srcUrl) => requestTranslation(srcUrl, activeImg)}
        />
      )}

      {/* Full-Screen Distraction-Free Chapter Reader Modal */}
      <ChapterReaderModal
        isOpen={isReaderOpen}
        onClose={() => {
          setIsReaderOpen(false);
          isCustomReaderRef.current = false;
          refreshChapterPages();
        }}
        pages={chapterPages}
        title={document.title}
        onExportZip={async () => {
          const translatedPages = chapterPages.filter((p) => p.isTranslated && p.translatedUrl);
          if (translatedPages.length === 0) return;
          const recordsToExport: ChapterImageRecord[] = translatedPages.map((page, idx) => ({
            originalUrl: page.url,
            translatedUrl: page.translatedUrl!,
            sourcePage: getChapterScopeId(window.location.href),
            documentPath: null,
            documentY: page.top,
            sequence: idx + 1,
          }));
          await chapterExporter.exportChapter(recordsToExport);
        }}
        onTranslateAll={handleTranslateChapter}
        isTranslatingChapter={isTranslatingChapter}
      />

      {/* Floating Reader Launch Pill */}
      {!isReaderOpen && !isPillDismissed && (
        <ChapterReaderFloatingPill
          pageCount={chapterPages.length}
          onOpen={() => {
            isCustomReaderRef.current = false;
            refreshChapterPages();
            setIsReaderOpen(true);
          }}
          onDismiss={() => setIsPillDismissed(true)}
        />
      )}
    </>
  );
}

try {
  let overlayRoot = document.getElementById('kites-global-overlay');
  if (!overlayRoot) {
    overlayRoot = document.createElement('div');
    overlayRoot.id = 'kites-global-overlay';
    overlayRoot.style.display = 'contents';
    document.body.appendChild(overlayRoot);
  }

  let root = (overlayRoot as any)._reactRoot;
  if (!root) {
    root = createRoot(overlayRoot);
    (overlayRoot as any)._reactRoot = root;
  }
  root.render(<GlobalOverlay />);
  console.log('[Content Script] Initialized Kites image translation overlay.');
} catch (error) {
  console.error('[Content Script] Failed to initialize overlay:', error);
}

// Revoke any created same-origin Blob URLs when the tab/window is unloaded
window.addEventListener('beforeunload', () => {
  for (const objUrl of activeObjectUrls) {
    try {
      URL.revokeObjectURL(objUrl);
    } catch {}
  }
  activeObjectUrls.clear();
});
