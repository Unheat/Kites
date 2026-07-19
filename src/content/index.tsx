import { createRoot } from 'react-dom/client';
import { useEffect, useState, useRef } from 'react';
import './content.css'; 
import { Languages } from 'lucide-react';
import type { PopupState } from '../popup/index';

// Minimum image size to avoid detect small icons
const MIN_WIDTH_IMAGE_PX = 150;
const MIN_HEIGHT_IMAGE_PX = 150;

const TIMEOUT_MS = 300; // Debounce timeout in ms

/**
 * Renders the floating translation button using modern CSS Anchor Positioning.
 * 
 * @param {Object} props - The component properties.
 * @param {string} props.srcUrl - The URL of the image to translate.
 * @param {string} props.anchorName - The unique CSS anchor-name (e.g., "--kites-img-123") attached to the target image.
 * @returns {JSX.Element} The floating button component.
 */
function TranslateButton({ srcUrl, anchorName }: { srcUrl: string, anchorName: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  useEffect(() => {
    if (buttonRef.current) {
      // Direct DOM manipulation bypasses React's style object filtering for cutting-edge CSS
      buttonRef.current.style.setProperty('position-anchor', anchorName);
      buttonRef.current.style.setProperty('top', 'anchor(top)');
      buttonRef.current.style.setProperty('left', 'anchor(left)');
    }
  }, [anchorName]);

  const handleTranslate = () => {
    if (!srcUrl) {
      console.error('[Content Script] Cannot translate: No image URL provided.');
      return;
    }
    setIsTranslating(true);
    console.log('[Content Script] Sending TRANSLATE_IMAGE to background:', srcUrl);
    chrome.runtime.sendMessage({ type: 'TRANSLATE_IMAGE', url: srcUrl }, () => {
      setIsTranslating(false);
      if (chrome.runtime.lastError) {
        console.error('[Content Script] Message failed:', chrome.runtime.lastError.message);
      }
    });
  };

  return (
    <button 
      ref={buttonRef}
      id="kites-translate-btn"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleTranslate();
      }}
      // We use 'fixed' instead of 'absolute' so the viewport is the containing block.
      // This is required for CSS Anchors to target elements outside the React root.
      className={`fixed z-[999999] w-8 h-8 flex items-center justify-center rounded-full bg-transparent hover:bg-black/5 transition-colors cursor-pointer border-none text-black ${isTranslating ? 'animate-spin' : ''}`}
      style={{ 
        marginTop: '8px',
        marginLeft: '8px',
        pointerEvents: 'auto' 
      }}
      title="Translate Image"
    >
      <Languages size={18} className="opacity-80 hover:opacity-100 transition-opacity" />
    </button>
  );
}

// Keep track of which URLs we have already sent to the background to avoid spamming
const processedUrls = new Set<string>();

/**
 * Manages the global state of the translation overlays.
 * In Hover Mode, tracks the mouse to anchor a single button.
 * In Consistent Mode, periodically scans the DOM to anchor buttons to all valid images.
 * 
 * @returns {JSX.Element|null} The collection of TranslateButtons or null if none active.
 */
function GlobalOverlay() {
  const [activeImg, setActiveImg] = useState<{ srcUrl: string, imgElement: HTMLImageElement, anchorName: string } | null>(null);
  const [consistentImages, setConsistentImages] = useState<{ srcUrl: string, anchorName: string }[]>([]);
  
  const [mode, setMode] = useState<'hover' | 'persistent'>('hover');
  const [autoTranslate, setAutoTranslate] = useState(false);

  const activeImgRef = useRef(activeImg);
  activeImgRef.current = activeImg;

  // 1. Fetch User Settings
  useEffect(() => {
    const loadSettings = () => {
      chrome.storage.local.get('popupState', (data) => {
        const state = data.popupState as PopupState | undefined;
        if (state) {
          setMode(state.manualMode || 'hover');
          setAutoTranslate(state.isAuto || false);
        }
      });
    };
    loadSettings();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.popupState) {
        loadSettings();
      }
    });
  }, []);

  // 2. Listen for the pub/sub IMAGE_TRANSLATED broadcast from Background Worker
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'IMAGE_TRANSLATED' && message.payload) {
        const { originalUrl, bakedBase64 } = message.payload;
        console.log(`[Content Script] Received translated image for: ${originalUrl}`);
        
        // Find the image on the page that matches the original URL
        const imgs = Array.from(document.querySelectorAll('img'));
        const targetImg = imgs.find(img => img.src === originalUrl);
        
        if (targetImg) {
          // Instant native swap!
          targetImg.src = bakedBase64;
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  useEffect(() => {
    if (mode === 'persistent') { // Consistent Mode
      const updateImages = () => {
        const imgs = Array.from(document.querySelectorAll('img'));
        const validImgs = imgs.filter(img => {
          // Use getBoundingClientRect for accurate rendered size, bypassing lazy-load 0 width attributes
          const rect = img.getBoundingClientRect();
          if (!img.src || rect.width < MIN_WIDTH_IMAGE_PX || rect.height < MIN_HEIGHT_IMAGE_PX) return false;
          
          // Ignore Reddit background images or other elements with CSS filters that break CSS Anchors
          const style = window.getComputedStyle(img);
          if (style.filter !== 'none' || style.opacity === '0' || style.visibility === 'hidden') return false;
          
          return true;
        });

        const newConsistentImages = validImgs.map(img => {
          let anchorName = img.style.getPropertyValue('anchor-name');
          if (!anchorName) {
            anchorName = `--kites-img-${Math.random().toString(36).substr(2, 9)}`;
            img.style.setProperty('anchor-name', anchorName);
          }
          
          if (autoTranslate && !processedUrls.has(img.src)) {
            processedUrls.add(img.src);
            console.log('[Content Script] Auto-Translating image:', img.src);
            chrome.runtime.sendMessage({ type: 'TRANSLATE_IMAGE', url: img.src }, () => {
              if (chrome.runtime.lastError) {
                console.error('[Content Script] Auto-Translate message failed:', chrome.runtime.lastError.message);
              }
            });
          }
          
          return { srcUrl: img.src, anchorName };
        });

        setConsistentImages(newConsistentImages);
      };

      updateImages();
      
      // Debounce the update call to prevent CPU spikes during heavy DOM mutations
      let timeoutId: number | null = null;
      const debouncedUpdate = () => {
        if (timeoutId) window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(updateImages, TIMEOUT_MS);
      };

      // Use a MutationObserver (Industry Standard) instead of setInterval to instantly catch dynamic images
      const observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;
        for (const mutation of mutations) {
          if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
            shouldUpdate = true;
            break;
          }
          if (mutation.type === 'attributes' && mutation.attributeName === 'src' && mutation.target.nodeName === 'IMG') {
            shouldUpdate = true;
            break;
          }
        }
        if (shouldUpdate) {
          debouncedUpdate();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src']
      });

      // Also update on window resize in case images change dimensions
      window.addEventListener('resize', debouncedUpdate, { passive: true });

      return () => {
        observer.disconnect();
        window.removeEventListener('resize', debouncedUpdate);
        if (timeoutId) window.clearTimeout(timeoutId);
      };
    } else {
      const handleMouseOver = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target && target.tagName === 'IMG') {
          const img = target as HTMLImageElement;
          
          // Use getBoundingClientRect for accurate rendered size
          const rect = img.getBoundingClientRect();
          if (!img.src || rect.width < MIN_WIDTH_IMAGE_PX || rect.height < MIN_HEIGHT_IMAGE_PX) return; // skip small icons

          let anchorName = img.style.getPropertyValue('anchor-name');
          if (!anchorName) {
            anchorName = `--kites-img-${Math.random().toString(36).substr(2, 9)}`;
            img.style.setProperty('anchor-name', anchorName);
          }

          setActiveImg({
            srcUrl: img.src,
            imgElement: img,
            anchorName,
          });
        }
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!activeImgRef.current) return;
        const target = e.target as HTMLElement;
        
        const isOverImg = target === activeImgRef.current.imgElement;
        const isOverButton = target.closest('#kites-translate-btn');
        
        if (!isOverImg && !isOverButton) {
          setActiveImg(null);
        }
      };

      document.addEventListener('mouseover', handleMouseOver);
      document.addEventListener('mousemove', handleMouseMove);

      return () => {
        document.removeEventListener('mouseover', handleMouseOver);
        document.removeEventListener('mousemove', handleMouseMove);
      };
    }
  }, [mode, autoTranslate]);

  if (mode === 'persistent') {
    return (
      <>
        {consistentImages.map((img) => (
          <TranslateButton 
            key={img.anchorName} 
            srcUrl={img.srcUrl} 
            anchorName={img.anchorName} 
          />
        ))}
      </>
    );
  }

  if (!activeImg) return null;

  return (
    <TranslateButton 
      srcUrl={activeImg.srcUrl} 
      anchorName={activeImg.anchorName} 
    />
  );
}

// Initialization
try {
  const overlayRoot = document.createElement('div');
  overlayRoot.id = 'kites-global-overlay';
  
  // Display contents ensures this wrapper does not create a new containing block
  // This is critical so the `fixed` positioned buttons inside can anchor to the main document
  overlayRoot.style.display = 'contents';
  
  document.body.appendChild(overlayRoot);
  
  const root = createRoot(overlayRoot);
  root.render(<GlobalOverlay />);
  
  console.log('[Content Script] Initialized Kites Global Hover Overlay with CSS Anchors.');
} catch (error) {
  console.error('[Content Script] Failed to initialize overlay:', error);
}
