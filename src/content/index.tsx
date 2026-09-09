import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, useCallback, useId } from 'react';
import './content.css';
import { Languages, Eye, EyeOff, ExternalLink, X, Crop, RotateCcw } from 'lucide-react';
import type { PopupState, CropOverlayItem, ViewportSelection } from '../shared/types';
import {
  normalizeSelection,
  calculateCaptureSourceRect,
  computeCropBounds,
  cropCapturedDataUrl,
  waitForCleanFrames,
  type CropDragHandle,
} from './captureArea';
import {
  discoverMediaTargets,
  normalizeMediaUrl,
  resolveHoverMediaTarget,
  resolveImageSource,
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
// Avoid flashing cold-start copy for model setup that completes quickly.
const MODEL_INITIALIZATION_LABEL_DELAY_MS = 700;
const MODEL_INITIALIZATION_LABEL = 'Preparing AI · first use this session';

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
  const { imgElement, srcUrl } = target;
  let kitesId = imgElement.getAttribute('data-kites-id');
  if (!kitesId) {
    kitesId = `kites-${Math.random().toString(36).substring(2, 11)}`;
    imgElement.setAttribute('data-kites-id', kitesId);
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
  if (registered && document.contains(registered.imgElement) && document.contains(registered.surfaceElement)) {
    return registered;
  }

  const normalized = getNormalizedBaseUrl(originalUrl);
  if (normalized) {
    const normRegistered = mediaTargetRegistry.get(normalized);
    if (normRegistered && document.contains(normRegistered.imgElement) && document.contains(normRegistered.surfaceElement)) {
      return normRegistered;
    }
  }

  const targets = discoverMediaTargets();

  // Tier 2: Exact URL match across native, responsive, and lazy source attributes
  const exactMatch = targets.find((target) => target.srcUrl === originalUrl);
  if (exactMatch) return exactMatch;

  // Tier 3: Match on data-kites-orig-src attribute
  const origAttrMatch = targets.find((target) => target.imgElement.getAttribute('data-kites-orig-src') === originalUrl);
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
        if (mutation.attributeName === 'src' && appliedSrc && img.src !== appliedSrc) {
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
 * @param targetImg - The target HTMLImageElement in the DOM.
 * @param bakedBase64 - The translated image data URL.
 * @param originalUrl - The original image URL for logging and attribution.
 */
function replaceImageWithTranslation(target: MediaTarget, bakedBase64: string, originalUrl: string): void {
  const { imgElement: targetImg, surfaceElement, hiddenBacking } = target;
  const previousUrl = targetImg.getAttribute('data-kites-applied-src');
  const safeUrl = createSafeBlobUrlFromData(bakedBase64);

  runSelfMutation(() => {
    sanitizeImageAttributes(targetImg);
    targetImg.setAttribute('data-kites-applied-src', safeUrl);
    targetImg.setAttribute('data-kites-translated', 'true');
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
  });

  if (previousUrl?.startsWith('blob:') && previousUrl !== safeUrl) {
    URL.revokeObjectURL(previousUrl);
    activeObjectUrls.delete(previousUrl);
  }
  attachReversionShield(targetImg, safeUrl, surfaceElement);
  console.log(`[Content Script] Successfully replaced image for: ${originalUrl}`);
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
function getAnchorName(img: HTMLElement): string {
  let anchorName = img.style.getPropertyValue('anchor-name');
  if (!anchorName) {
    anchorName = `--kites-img-${Math.random().toString(36).substring(2, 11)}`;
    img.style.setProperty('anchor-name', anchorName);
  }
  return anchorName;
}

/**
 * Renders a floating translation button anchored to an image.
 *
 * @param props - Button state and callbacks.
 * @param props.srcUrl - Image URL to translate.
 * @param props.anchorName - CSS anchor assigned to target image.
 * @param props.isTranslating - Whether this image has a pending translation job.
 * @param props.onTranslate - Queues translation for this image.
 * @returns Floating translate button.
 */
function TranslateButton({
  srcUrl,
  anchorName,
  isTranslating,
  onTranslate,
}: {
  srcUrl: string;
  anchorName: string;
  isTranslating: boolean;
  onTranslate: (srcUrl: string) => void;
}) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const initializationDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeInitializationJobIdRef = useRef<number | null>(null);
  const initializationLabelId = useId();
  const [localTranslating, setLocalTranslating] = useState(false);
  const [showInitializationLabel, setShowInitializationLabel] = useState(false);
  const activeTranslating = isTranslating || localTranslating;

  useEffect(() => {
    if (buttonRef.current) {
      buttonRef.current.style.setProperty('position-anchor', anchorName);
      buttonRef.current.style.setProperty('top', 'anchor(top)');
      buttonRef.current.style.setProperty('left', 'anchor(left)');
    }
  }, [anchorName]);

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
        }
      }
    };

    try {
      if (chrome.runtime?.id) {
        chrome.runtime.onMessage.addListener(handleMessage);
        return () => {
          clearInitializationFeedback();
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
      className="kites-translate-control fixed z-[999999] flex items-center gap-2"
      data-kites-translate-control="true"
      style={{ marginTop: '8px', marginLeft: '8px', pointerEvents: 'auto' }}
    >
      <button
        data-kites-translate-button="true"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setLocalTranslating(true);
          onTranslate(srcUrl);
        }}
        disabled={activeTranslating}
        className={`w-8 h-8 flex items-center justify-center rounded-full bg-[#ff2d75] transition-colors cursor-pointer border-none text-white disabled:cursor-wait ${activeTranslating ? 'kites-anim-spin' : ''}`}
        style={{ pointerEvents: 'auto' }}
        title="Translate Image"
        aria-label={showInitializationLabel ? MODEL_INITIALIZATION_LABEL : 'Translate Image'}
        aria-describedby={showInitializationLabel ? initializationLabelId : undefined}
      >
        <Languages
          size={18}
          aria-hidden="true"
          className={activeTranslating ? 'kites-anim-spin' : ''}
          style={activeTranslating ? { animation: 'kites-spin 1s linear infinite' } : undefined}
        />
      </button>
      {showInitializationLabel && (
        <span
          id={initializationLabelId}
          role="status"
          aria-live="polite"
          className="whitespace-nowrap rounded-full bg-[#171717]/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
        >
          {MODEL_INITIALIZATION_LABEL}
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
  const dragRef = useRef<{
    handle: CropDragHandle;
    startPageX: number;
    startPageY: number;
    initial: { left: number; top: number; width: number; height: number };
  } | null>(null);

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
    dragRef.current = {
      handle,
      startPageX: event.clientX + window.scrollX,
      startPageY: event.clientY + window.scrollY,
      initial: { left: crop.pageLeft, top: crop.pageTop, width: crop.width, height: crop.height },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const documentWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);
    const documentHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight);
    onGeometryChange(crop.id, computeCropBounds(
      drag.initial,
      drag.handle,
      event.clientX + window.scrollX - drag.startPageX,
      event.clientY + window.scrollY - drag.startPageY,
      { width: documentWidth, height: documentHeight }
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
        left: `${crop.pageLeft}px`,
        top: `${crop.pageTop}px`,
        width: `${crop.width}px`,
        height: `${crop.height}px`,
      }}
      onPointerDown={(event) => beginInteraction(event, 'move')}
      onPointerMove={updateInteraction}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
    >
      <div
        className={`kites-crop-toolbar ${crop.pageTop - window.scrollY < 44 ? 'kites-crop-toolbar-inside' : ''}`}
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
          <span>{crop.status === 'capturing' ? 'Capturing...' : 'Translating...'}</span>
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
  const [translatingUrl, setTranslatingUrl] = useState<string | null>(null);
  const [isSnipping, setIsSnipping] = useState<boolean>(false);
  const [crops, setCrops] = useState<CropOverlayItem[]>([]);

  const activeImgRef = useRef(activeImg);
  const translatingUrlRef = useRef(translatingUrl);
  activeImgRef.current = activeImg;
  translatingUrlRef.current = translatingUrl;

  /**
   * Sends an image to the background queue and keeps its overlay visible until completion.
   *
   * @param srcUrl - Original image URL to queue.
   * @param image - Optional DOM image for pinning Hover mode.
   * @returns Nothing.
   */
  const requestTranslation = (srcUrl: string, image?: OverlayImage): void => {
    if (!srcUrl || translatingUrlRef.current === srcUrl) return;

    if (image) {
      setActiveImg(image);
      registerMediaTarget(image);
    }
    setTranslatingUrl(srcUrl);
    console.log('[Content Script] Sending TRANSLATE_IMAGE to background:', srcUrl);

    try {
      if (!chrome.runtime?.id) {
        setTranslatingUrl(null);
        console.warn('[Content Script] Extension context invalidated. Please refresh the page.');
        return;
      }
      chrome.runtime.sendMessage({ type: 'TRANSLATE_IMAGE', url: srcUrl }, (response) => {
        if (chrome.runtime.lastError || response?.status === 'error') {
          setTranslatingUrl((current) => current === srcUrl ? null : current);
          console.error('[Content Script] Message failed:', chrome.runtime.lastError?.message || response?.error);
        }
      });
    } catch (error) {
      setTranslatingUrl((current) => current === srcUrl ? null : current);
      console.warn('[Content Script] Chrome runtime call failed (extension reloaded/invalidated):', error);
    }
  };

  const captureQueueRef = useRef<Promise<void>>(Promise.resolve());

  const handleCropComplete = (selection: ViewportSelection) => {
    setIsSnipping(false);
    const requestId = Math.random().toString(36).substring(2, 11);
    setCrops((prev) => [...prev, {
      id: requestId,
      sourceKey: `kites-capture:${requestId}`,
      pageLeft: selection.left + window.scrollX,
      pageTop: selection.top + window.scrollY,
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

      const selection: ViewportSelection = {
        left: crop.pageLeft - window.scrollX,
        top: crop.pageTop - window.scrollY,
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
      ? { ...candidate, pageLeft: bounds.left, pageTop: bounds.top, width: bounds.width, height: bounds.height }
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

  // Load user settings and react to popup updates.
  useEffect(() => {
    const loadSettings = () => {
      chrome.storage.local.get('popupState', (data) => {
        const state = data.popupState as PopupState | undefined;
        if (state) {
          setIsEnabled(state.isExtensionEnabled ?? true);
          setMode(state.manualMode || 'hover');
          setAutoTranslate(state.isAuto || false);
        }
      });
    };
    loadSettings();
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.popupState) loadSettings();
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  // Receive terminal job events, restore the image, and allow Hover mode to disappear again.
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'START_AREA_SELECTION') {
        setIsSnipping(true);
        return;
      }

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

      const { originalUrl, bakedBase64 } = message.payload;
      setTranslatingUrl((current) => current === originalUrl ? null : current);
      setActiveImg((current) => current?.srcUrl === originalUrl ? null : current);

      if (message.type !== 'IMAGE_TRANSLATED' || !bakedBase64) return;
      console.log(`[Content Script] Received translated image for: ${originalUrl}`);
      const target = resolveTargetMedia(originalUrl);
      if (!target) {
        console.warn(`[Content Script] Target media element could not be found in DOM for: ${originalUrl}`);
        return;
      }

      replaceImageWithTranslation(target, bakedBase64, originalUrl);
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  // Automatic mode observes only images entering the viewport. Queue capacity remains owned by background.
  useEffect(() => {
    if (!isEnabled || !autoTranslate) return;

    const queuedUrls = new Set<string>();
    const translatedImages = new WeakSet<HTMLImageElement>();
    const observedSurfaces = new WeakSet<HTMLElement>();
    const targetsBySurface = new WeakMap<HTMLElement, MediaTarget>();
    let timeoutId: number | null = null;

    const queueVisibleImage = (target: MediaTarget) => {
      const { imgElement, srcUrl } = target;
      if (translatedImages.has(imgElement) || queuedUrls.has(srcUrl)) return;
      registerMediaTarget(target);
      queuedUrls.add(srcUrl);
      console.log('[Content Script] Auto-Translating visible image:', srcUrl);
      chrome.runtime.sendMessage({ type: 'TRANSLATE_IMAGE', url: srcUrl }, (response) => {
        if (chrome.runtime.lastError || response?.status === 'error') {
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
      for (const target of discoverMediaTargets()) {
        if (!observedSurfaces.has(target.surfaceElement)) {
          observedSurfaces.add(target.surfaceElement);
          targetsBySurface.set(target.surfaceElement, target);
          intersectionObserver.observe(target.surfaceElement);
        }
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
            translatedImages.add(target);
          }
        }
      }
      scheduleObserve();
    });

    observeImages();
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
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

    let timeoutId: number | null = null;
    const updateImages = () => {
      setConsistentImages(discoverMediaTargets()
        .map((target) => ({ ...target, anchorName: getAnchorName(target.surfaceElement) })));
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
      if (hideTimeoutId === null && !translatingUrlRef.current) {
        hideTimeoutId = window.setTimeout(() => {
          if (!translatingUrlRef.current) setActiveImg(null);
          hideTimeoutId = null;
        }, HOVER_LEAVE_DELAY_MS);
      }
    };
    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (activeImgRef.current && (target === activeImgRef.current.surfaceElement || target.closest(TRANSLATE_CONTROL_SELECTOR))) {
        cancelHide();
        return;
      }
      const mediaTarget = resolveHoverMediaTarget(event);
      if (!mediaTarget) return;
      cancelHide();
      registerMediaTarget(mediaTarget);
      setActiveImg({ ...mediaTarget, anchorName: getAnchorName(mediaTarget.surfaceElement) });
    };
    const handleMouseOut = (event: MouseEvent) => {
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

    document.addEventListener('mouseover', handleMouseOver, { passive: true });
    document.addEventListener('mouseout', handleMouseOut, { passive: true });
    return () => {
      cancelHide();
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
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
          isTranslating={translatingUrl === image.srcUrl}
          onTranslate={(srcUrl) => requestTranslation(srcUrl, image)}
        />
      ))}

      {mode === 'hover' && activeImg && (
        <TranslateButton
          srcUrl={activeImg.srcUrl}
          anchorName={activeImg.anchorName}
          isTranslating={translatingUrl === activeImg.srcUrl}
          onTranslate={(srcUrl) => requestTranslation(srcUrl, activeImg)}
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
