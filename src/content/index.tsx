import { createRoot } from 'react-dom/client';
import { useEffect, useState, useRef } from 'react';
import '../index.css'; 

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
    console.log('[Content Script] Sending TRANSLATE_IMAGE to background:', srcUrl);
    chrome.runtime.sendMessage({ type: 'TRANSLATE_IMAGE', url: srcUrl }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Content Script] Message failed:', chrome.runtime.lastError.message);
      } else {
        console.log('[Content Script] Response from background:', response);
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
      className="fixed z-[999999] bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded shadow-lg text-sm cursor-pointer border-none"
      style={{ 
        marginTop: '8px',
        marginLeft: '8px',
        pointerEvents: 'auto' 
      }}
    >
      Translate
    </button>
  );
}

// Toggle this flag to test Consistent Mode vs Hover Mode
const TEST_CONSISTENT_MODE = true;

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
  
  const activeImgRef = useRef(activeImg);
  activeImgRef.current = activeImg;

  useEffect(() => {
    if (TEST_CONSISTENT_MODE) { // Consistent Mode
      const updateImages = () => {
        const imgs = Array.from(document.querySelectorAll('img'));
        const validImgs = imgs.filter(img => {
          // Use getBoundingClientRect for accurate rendered size, bypassing lazy-load 0 width attributes
          const rect = img.getBoundingClientRect();
          return img.src && rect.width >= 100 && rect.height >= 100;
        });

        const newConsistentImages = validImgs.map(img => {
          let anchorName = img.style.getPropertyValue('anchor-name');
          if (!anchorName) {
            anchorName = `--kites-img-${Math.random().toString(36).substr(2, 9)}`;
            img.style.setProperty('anchor-name', anchorName);
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
        timeoutId = window.setTimeout(updateImages, 300);
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
          if (!img.src || rect.width < 100 || rect.height < 100) return; // skip small icons

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
  }, []);

  if (TEST_CONSISTENT_MODE) {
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
