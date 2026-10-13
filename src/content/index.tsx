import { createRoot } from 'react-dom/client';
import './content.css';
import { GlobalOverlay, revokeContentObjectUrls } from './contentUi';

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
window.addEventListener('beforeunload', revokeContentObjectUrls);
