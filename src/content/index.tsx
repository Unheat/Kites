import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import './content.css';
import { Languages } from 'lucide-react';
import type { PopupState } from '../shared/types';

// Minimum rendered dimensions prevent controls and thumbnails from entering the pipeline.
const MIN_WIDTH_IMAGE_PX = 150;
const MIN_HEIGHT_IMAGE_PX = 150;
const IMAGE_SCAN_DEBOUNCE_MS = 300;
const HOVER_LEAVE_DELAY_MS = 150;
const SELF_MUTATION_RESET_DELAY_MS = 50;
const MAX_PARENT_BG_SEARCH_DEPTH = 2;

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

// In-memory registry mapping original/base image URLs to live DOM HTMLImageElement references
const imageElementRegistry = new Map<string, HTMLImageElement>();

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
  try {
    const parsed = new URL(url, window.location.href);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

/**
 * Attaches a unique Kites tracking ID and registers the image element in our in-memory map.
 *
 * @param img - Target image element to register.
 * @param srcUrl - Image URL used as lookup key.
 * @returns The assigned tracking ID.
 */
function registerImageElement(img: HTMLImageElement, srcUrl: string): string {
  let kitesId = img.getAttribute('data-kites-id');
  if (!kitesId) {
    kitesId = `kites-${Math.random().toString(36).substring(2, 11)}`;
    img.setAttribute('data-kites-id', kitesId);
  }
  imageElementRegistry.set(srcUrl, img);
  const normalized = getNormalizedBaseUrl(srcUrl);
  if (normalized) {
    imageElementRegistry.set(normalized, img);
  }
  return kitesId;
}

/**
 * Resolves the target HTMLImageElement using a robust multi-tier fallback lookup:
 * 1. Direct in-memory registry reference (if still attached to the DOM).
 * 2. Exact match on img.src or img.currentSrc.
 * 3. Match on data-kites-orig-src attribute.
 * 4. Normalized base URL match (stripping CDN resolution parameters).
 *
 * @param originalUrl - The original image URL requested for translation.
 * @returns The resolved HTMLImageElement, or null if no matching element exists in DOM.
 */
function resolveTargetImageElement(originalUrl: string): HTMLImageElement | null {
  // Tier 1: Check in-memory registry
  const registered = imageElementRegistry.get(originalUrl);
  if (registered && document.contains(registered)) {
    return registered;
  }

  const normalized = getNormalizedBaseUrl(originalUrl);
  if (normalized) {
    const normRegistered = imageElementRegistry.get(normalized);
    if (normRegistered && document.contains(normRegistered)) {
      return normRegistered;
    }
  }

  const allImgs = Array.from(document.querySelectorAll('img'));

  // Tier 2: Exact URL match on src or currentSrc
  const exactMatch = allImgs.find((img) => img.src === originalUrl || img.currentSrc === originalUrl);
  if (exactMatch) return exactMatch;

  // Tier 3: Match on data-kites-orig-src attribute
  const origAttrMatch = allImgs.find((img) => img.getAttribute('data-kites-orig-src') === originalUrl);
  if (origAttrMatch) return origAttrMatch;

  // Tier 4: Match on normalized base URL
  if (normalized) {
    const baseMatch = allImgs.find((img) => {
      const imgNorm = getNormalizedBaseUrl(img.src || img.currentSrc);
      return imgNorm === normalized;
    });
    if (baseMatch) return baseMatch;
  }

  return null;
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
function suppressParentBackgroundImage(img: HTMLImageElement): void {
  let parent = img.parentElement;
  let depth = 0;
  while (parent && depth < MAX_PARENT_BG_SEARCH_DEPTH) {
    const bg = parent.style.backgroundImage || window.getComputedStyle(parent).backgroundImage;
    if (bg && bg !== 'none' && bg.includes('url(')) {
      if (!parent.getAttribute('data-kites-orig-bg')) {
        parent.setAttribute('data-kites-orig-bg', parent.style.backgroundImage || bg);
      }
      parent.style.backgroundImage = 'none';
    }
    parent = parent.parentElement;
    depth++;
  }
}

/**
 * Attaches a MutationObserver shield to the translated image.
 * If a host framework (React/Vue) or lazy-loader reverts src or re-applies srcset,
 * the shield immediately restores the translated image.
 *
 * WORKAROUND: [SPA Virtual DOM Reconciliation Resets] -> Modern SPAs (Twitter/X, Reddit, Threads)
 * maintain their own internal component state. Whenever user interactions trigger a React re-render
 * (hovering, scrolling, liking, timeline stream updates), React's reconciliation loop compares the real
 * DOM against its virtual DOM and immediately reverts img.src back to the host CDN URL.
 * This shield intercepts any such reset on src/srcset and re-applies our translated URL immediately.
 *
 * @param img - The translated image element to protect.
 * @param safeUrl - The safe Blob/Data URL of the translated image.
 */
function attachReversionShield(img: HTMLImageElement, safeUrl: string): void {
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
          });
        }
        if (mutation.attributeName === 'srcset' && img.srcset) {
          console.log('[Content Script] Host SPA restored srcset, clearing.');
          runSelfMutation(() => {
            img.srcset = '';
            img.removeAttribute('srcset');
          });
        }
      }
    }
  });

  observer.observe(img, {
    attributes: true,
    attributeFilter: ['src', 'srcset', ...LAZY_LOAD_ATTRIBUTES],
  });

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
function replaceImageWithTranslation(targetImg: HTMLImageElement, bakedBase64: string, originalUrl: string): void {
  const safeUrl = createSafeBlobUrlFromData(bakedBase64);

  runSelfMutation(() => {
    sanitizeImageAttributes(targetImg);
    targetImg.setAttribute('data-kites-applied-src', safeUrl);
    targetImg.setAttribute('data-kites-translated', 'true');
    targetImg.src = safeUrl;
    targetImg.style.display = '';
    targetImg.style.filter = 'none';
    suppressParentBackgroundImage(targetImg);
  });

  attachReversionShield(targetImg, safeUrl);
  console.log(`[Content Script] Successfully replaced image for: ${originalUrl}`);
}

type OverlayImage = {
  srcUrl: string;
  imgElement: HTMLImageElement;
  anchorName: string;
};

/**
 * Returns whether an image is a visible, supported translation target.
 *
 * @param img - Image element to inspect.
 * @returns Whether the image satisfies Kites' rendered-size and visibility requirements.
 */
function isValidImage(img: HTMLImageElement): boolean {
  const rect = img.getBoundingClientRect();
  if (!img.src || rect.width < MIN_WIDTH_IMAGE_PX || rect.height < MIN_HEIGHT_IMAGE_PX) return false;

  const style = window.getComputedStyle(img);
  return style.filter === 'none' && style.opacity !== '0' && style.visibility !== 'hidden';
}

/**
 * Returns whether an image meets Hover mode's original size-only eligibility rule.
 *
 * @param img - Image element under the cursor.
 * @returns Whether the image can receive a manual Hover button.
 */
function isHoverableImage(img: HTMLImageElement): boolean {
  const rect = img.getBoundingClientRect();
  return Boolean(img.src) && rect.width >= MIN_WIDTH_IMAGE_PX && rect.height >= MIN_HEIGHT_IMAGE_PX;
}

/**
 * Gets or assigns the CSS anchor used to place an image's translation button.
 *
 * @param img - Image element receiving an anchor.
 * @returns The image's CSS anchor name.
 */
function getAnchorName(img: HTMLImageElement): string {
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [localTranslating, setLocalTranslating] = useState(false);
  const activeTranslating = isTranslating || localTranslating;

  useEffect(() => {
    if (buttonRef.current) {
      buttonRef.current.style.setProperty('position-anchor', anchorName);
      buttonRef.current.style.setProperty('top', 'anchor(top)');
      buttonRef.current.style.setProperty('left', 'anchor(left)');
    }
  }, [anchorName]);

  useEffect(() => {
    const handleMessage = (message: any) => {
      if ((message.type === 'IMAGE_TRANSLATED' || message.type === 'TRANSLATION_ERROR') && message.payload) {
        if (message.payload.originalUrl === srcUrl) {
          setLocalTranslating(false);
        }
      }
    };

    try {
      if (chrome.runtime?.id) {
        chrome.runtime.onMessage.addListener(handleMessage);
        return () => {
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
    <button
      ref={buttonRef}
      id="kites-translate-btn"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setLocalTranslating(true);
        onTranslate(srcUrl);
      }}
      disabled={activeTranslating}
      className={`fixed z-[999999] w-8 h-8 flex items-center justify-center rounded-full bg-[#ff2d75] transition-colors cursor-pointer border-none text-white disabled:cursor-wait ${activeTranslating ? 'kites-anim-spin' : ''}`}
      style={{ marginTop: '8px', marginLeft: '8px', pointerEvents: 'auto' }}
      title="Translate Image"
    >
      <Languages 
        size={18} 
        aria-hidden="true" 
        className={activeTranslating ? 'kites-anim-spin' : ''} 
        style={activeTranslating ? { animation: 'kites-spin 1s linear infinite' } : undefined}
      />
    </button>
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
      registerImageElement(image.imgElement, srcUrl);
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
      if (!message.payload || (message.type !== 'IMAGE_TRANSLATED' && message.type !== 'TRANSLATION_ERROR')) return;

      const { originalUrl, bakedBase64 } = message.payload;
      setTranslatingUrl((current) => current === originalUrl ? null : current);
      setActiveImg((current) => current?.srcUrl === originalUrl ? null : current);

      if (message.type !== 'IMAGE_TRANSLATED' || !bakedBase64) return;
      console.log(`[Content Script] Received translated image for: ${originalUrl}`);
      const targetImg = resolveTargetImageElement(originalUrl);
      if (!targetImg) {
        console.warn(`[Content Script] Target image element could not be found in DOM for: ${originalUrl}`);
        return;
      }

      replaceImageWithTranslation(targetImg, bakedBase64, originalUrl);
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  // Automatic mode observes only images entering the viewport. Queue capacity remains owned by background.
  useEffect(() => {
    if (!isEnabled || !autoTranslate) return;

    const queuedUrls = new Set<string>();
    const translatedImages = new WeakSet<HTMLImageElement>();
    const observedImages = new WeakSet<HTMLImageElement>();
    let timeoutId: number | null = null;

    const queueVisibleImage = (img: HTMLImageElement) => {
      if (!isValidImage(img) || translatedImages.has(img) || queuedUrls.has(img.src)) return;
      registerImageElement(img, img.src);
      queuedUrls.add(img.src);
      console.log('[Content Script] Auto-Translating visible image:', img.src);
      chrome.runtime.sendMessage({ type: 'TRANSLATE_IMAGE', url: img.src }, (response) => {
        if (chrome.runtime.lastError || response?.status === 'error') {
          queuedUrls.delete(img.src);
          console.error('[Content Script] Auto-Translate message failed:', chrome.runtime.lastError?.message || response?.error);
        }
      });
    };

    const intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) queueVisibleImage(entry.target as HTMLImageElement);
      }
    });

    const observeImages = () => {
      for (const img of Array.from(document.querySelectorAll('img'))) {
        if (isValidImage(img) && !observedImages.has(img)) {
          observedImages.add(img);
          intersectionObserver.observe(img);
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
      setConsistentImages(Array.from(document.querySelectorAll('img'))
        .filter(isValidImage)
        .map((img) => ({ srcUrl: img.src, imgElement: img, anchorName: getAnchorName(img) })));
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
      if (activeImgRef.current && (target === activeImgRef.current.imgElement || target.closest('#kites-translate-btn'))) {
        cancelHide();
        return;
      }
      if (!(target instanceof HTMLImageElement) || !isHoverableImage(target)) return;
      cancelHide();
      registerImageElement(target, target.src);
      setActiveImg({ srcUrl: target.src, imgElement: target, anchorName: getAnchorName(target) });
    };
    const handleMouseOut = (event: MouseEvent) => {
      const current = activeImgRef.current;
      if (!current) return;
      const target = event.target as HTMLElement;
      const relatedTarget = event.relatedTarget as HTMLElement | null;
      if (relatedTarget && (relatedTarget === current.imgElement || relatedTarget.closest('#kites-translate-btn'))) {
        cancelHide();
        return;
      }
      if (target === current.imgElement || target.closest('#kites-translate-btn')) scheduleHide();
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

  if (mode === 'persistent') {
    return <>{consistentImages.map((image) => (
      <TranslateButton key={image.anchorName} srcUrl={image.srcUrl} anchorName={image.anchorName}
        isTranslating={translatingUrl === image.srcUrl} onTranslate={(srcUrl) => requestTranslation(srcUrl, image)} />
    ))}</>;
  }

  if (!activeImg) return null;
  return <TranslateButton srcUrl={activeImg.srcUrl} anchorName={activeImg.anchorName}
    isTranslating={translatingUrl === activeImg.srcUrl} onTranslate={(srcUrl) => requestTranslation(srcUrl, activeImg)} />;
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
