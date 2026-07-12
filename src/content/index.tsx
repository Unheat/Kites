import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../index.css'; 

// Decoupled UI Component: Avoid hardcoding the button style in the core logic.
// In the future, this can easily be swapped for a Spinner, a Magic Lens UI, or a custom Icon.
interface TranslateButtonProps {
  srcUrl: string;
  top: number;
  left: number;
  onHide: () => void;
}

function TranslateButton({ srcUrl, top, left, onHide }: TranslateButtonProps) {
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
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleTranslate();
      }}
      onMouseLeave={onHide}
      className="absolute z-[999999] bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded shadow-lg text-sm cursor-pointer border-none"
      style={{ 
        top: `${top}px`, 
        left: `${left}px`,
        pointerEvents: 'auto' 
      }}
    >
      Translate
    </button>
  );
}

// Global Orchestrator: We use a single floating overlay attached to the body.
// We DO NOT mutate the DOM by wrapping <img> tags, because that breaks React/Vue virtual DOMs
// on sites like Reddit and nHentai, causing them to delete the images or break grid CSS layouts.
function GlobalOverlay() {
  const [activeImg, setActiveImg] = useState<{ srcUrl: string, top: number, left: number } | null>(null);

  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.tagName === 'IMG') {
        const img = target as HTMLImageElement;
        
        // Defensive checks: skip invalid or tiny icons
        if (!img.src || img.width < 100 || img.height < 100) return;

        // Calculate absolute position on the document
        const rect = img.getBoundingClientRect();
        
        // If image is out of bounds or hidden, ignore
        if (rect.width === 0 || rect.height === 0) return;

        setActiveImg({
          srcUrl: img.src,
          top: rect.top + window.scrollY + 8, // 8px padding from top
          left: rect.left + window.scrollX + 8, // 8px padding from left
        });
      }
    };

    const handleScroll = () => {
      // Hide on scroll to prevent the button from floating detached if the DOM shifts
      setActiveImg(null);
    };

    document.addEventListener('mouseover', handleMouseOver);
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      document.removeEventListener('mouseover', handleMouseOver);
      window.addEventListener('scroll', handleScroll);
    };
  }, []);

  if (!activeImg) return null;

  return (
    <TranslateButton 
      srcUrl={activeImg.srcUrl} 
      top={activeImg.top} 
      left={activeImg.left} 
      onHide={() => setActiveImg(null)}
    />
  );
}

// Run on load
try {
  // Create a 0x0 container so it doesn't interfere with the page layout
  const overlayRoot = document.createElement('div');
  overlayRoot.id = 'kites-global-overlay';
  overlayRoot.style.position = 'absolute'; 
  overlayRoot.style.top = '0';
  overlayRoot.style.left = '0';
  overlayRoot.style.width = '0';
  overlayRoot.style.height = '0';
  overlayRoot.style.overflow = 'visible';
  overlayRoot.style.zIndex = '999999';
  
  document.body.appendChild(overlayRoot);
  
  const root = createRoot(overlayRoot);
  root.render(<GlobalOverlay />);
  
  console.log('[Content Script] Initialized Kites Global Hover Overlay.');
} catch (error) {
  console.error('[Content Script] Failed to initialize overlay:', error);
}
