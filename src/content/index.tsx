import { createRoot } from 'react-dom/client';
import '../index.css'; 

function TranslateOverlay({ srcUrl }: { srcUrl: string }) {
  const handleTranslate = () => {
    chrome.runtime.sendMessage({ type: 'TRANSLATE_IMAGE', url: srcUrl });
  };

  return (
    <button 
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleTranslate();
      }}
      className="absolute top-2 left-2 z-[999999] bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded shadow-lg text-sm cursor-pointer border-none"
      style={{ pointerEvents: 'auto' }}
    >
      Translate
    </button>
  );
}

function injectOverlays() {
  const images = document.querySelectorAll('img');
  
  images.forEach(img => {
    // Skip tiny icons
    if (img.width < 100 || img.height < 100) return;
    
    // Avoid double injection
    if (img.parentElement?.dataset.kitesInjected) return;
    
    // Wrap the image to establish relative positioning context
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    wrapper.dataset.kitesInjected = 'true';
    
    img.parentNode?.insertBefore(wrapper, img);
    wrapper.appendChild(img);
    
    const uiContainer = document.createElement('div');
    uiContainer.style.position = 'absolute';
    uiContainer.style.top = '0';
    uiContainer.style.left = '0';
    uiContainer.style.width = '100%';
    uiContainer.style.height = '100%';
    uiContainer.style.pointerEvents = 'none'; // Let clicks pass through to image except on button
    
    wrapper.appendChild(uiContainer);
    
    const root = createRoot(uiContainer);
    root.render(<TranslateOverlay srcUrl={img.src} />);
  });
}

// Run on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectOverlays);
} else {
  injectOverlays();
}

// Observe dynamic additions
const observer = new MutationObserver(() => {
  injectOverlays();
});
observer.observe(document.body, { childList: true, subtree: true });
