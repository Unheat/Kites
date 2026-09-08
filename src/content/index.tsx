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

    if (image) setActiveImg(image);
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
      const targetImg = Array.from(document.querySelectorAll('img')).find((img) => img.src === originalUrl);
      if (!targetImg) return;

      // Instant native swap (no opacity fade/blink)
      targetImg.src = bakedBase64;
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
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLImageElement && mutation.attributeName === 'src') {
          translatedImages.add(mutation.target);
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
        isTranslating={translatingUrl === image.srcUrl} onTranslate={(srcUrl) => requestTranslation(srcUrl)} />
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
