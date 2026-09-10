import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from 'canvas';

const ICONS_DIR = path.resolve('public/icons');
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

// Master SVG: The Origami Manga Kite (Spatial Speech Bubble & Kite)
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <!-- Facet Gradients -->
    <linearGradient id="facet-tl" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#38BDF8" />
      <stop offset="100%" stop-color="#0284C7" />
    </linearGradient>
    <linearGradient id="facet-tr" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#E879F9" />
      <stop offset="100%" stop-color="#818CF8" />
    </linearGradient>
    <linearGradient id="facet-bl" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0284C7" />
      <stop offset="100%" stop-color="#092648" />
    </linearGradient>
    <linearGradient id="facet-br" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F43F5E" />
      <stop offset="100%" stop-color="#8B5CF6" />
    </linearGradient>

    <!-- Streamer Gradient -->
    <linearGradient id="streamer-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#EC4899" />
      <stop offset="50%" stop-color="#8B5CF6" />
      <stop offset="100%" stop-color="#38BDF8" />
    </linearGradient>

    <!-- Tail Ribbon Bow Gradients -->
    <linearGradient id="bow-cyan" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38BDF8" />
      <stop offset="100%" stop-color="#0284C7" />
    </linearGradient>
    <linearGradient id="bow-pink" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FB7185" />
      <stop offset="100%" stop-color="#E11D48" />
    </linearGradient>

    <!-- Crisp Soft Ambient Drop Shadow -->
    <filter id="crisp-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2.5" stdDeviation="3" flood-color="#020617" flood-opacity="0.35" />
    </filter>
  </defs>

  <g filter="url(#crisp-shadow)">
    <!-- Flowing Kite Streamer String -->
    <path d="M 64,98 Q 48,110 68,118 T 56,126" 
          fill="none" 
          stroke="url(#streamer-grad)" 
          stroke-width="3.5" 
          stroke-linecap="round" />

    <!-- Ribbon Bow 1 (Cyan) -->
    <polygon points="53,109 63,111 59,115 51,113" fill="url(#bow-cyan)" />
    <!-- Ribbon Bow 2 (Pink) -->
    <polygon points="61,120 71,122 67,126 59,124" fill="url(#bow-pink)" />

    <!-- Speech Bubble Tail / Manga Dialogue Pointer -->
    <path d="M 50,92 L 30,114 L 64,98 Z" 
          fill="#0284C7" 
          stroke="#0284C7" 
          stroke-width="1" 
          stroke-linejoin="round" />

    <!-- 4 Origami Facets -->
    <!-- Top-Left (Vibrant Cyan) -->
    <polygon points="64,6 14,50 64,56" 
             fill="url(#facet-tl)" 
             stroke="#38BDF8" 
             stroke-width="0.75" 
             stroke-linejoin="round" />
    
    <!-- Top-Right (Electric Lavender / Indigo) -->
    <polygon points="64,6 114,50 64,56" 
             fill="url(#facet-tr)" 
             stroke="#C084FC" 
             stroke-width="0.75" 
             stroke-linejoin="round" />
    
    <!-- Bottom-Left (Deep Azure) -->
    <polygon points="14,50 64,98 64,56" 
             fill="url(#facet-bl)" 
             stroke="#0284C7" 
             stroke-width="0.75" 
             stroke-linejoin="round" />
    
    <!-- Bottom-Right (Vivid Magenta / Violet) -->
    <polygon points="114,50 64,98 64,56" 
             fill="url(#facet-br)" 
             stroke="#F43F5E" 
             stroke-width="0.75" 
             stroke-linejoin="round" />

    <!-- Spine & Crossbar Crease Highlights -->
    <line x1="64" y1="6" x2="64" y2="98" stroke="#FFFFFF" stroke-width="1.8" stroke-opacity="0.65" stroke-linecap="round" />
    <line x1="14" y1="50" x2="114" y2="50" stroke="#FFFFFF" stroke-width="1.2" stroke-opacity="0.45" stroke-linecap="round" />

    <!-- Center Spatial Translation Sparkle -->
    <polygon points="64,48 66,55 73,56 66,57 64,64 62,57 55,56 62,55" fill="#FFFFFF" />
  </g>
</svg>`;

async function main() {
  // Write master vector assets
  fs.writeFileSync('public/icon.svg', svgContent, 'utf-8');
  fs.writeFileSync('public/favicon.svg', svgContent, 'utf-8');
  console.log('Saved public/icon.svg and public/favicon.svg');

  const img = await loadImage(Buffer.from(svgContent));

  // Sizes required by Chrome Manifest V3:
  // 16: Extension toolbar & dropdown list
  // 32: Windows & Retina 2x toolbar
  // 48: chrome://extensions management page
  // 128: Chrome Web Store & installation badge
  const sizes = [16, 32, 48, 128];

  for (const size of sizes) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, size, size);

    const outPath = path.join(ICONS_DIR, `icon${size}.png`);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`Generated ${outPath} (${size}x${size})`);
  }

  // Clean up temporary test files
  const testFiles = [
    'public/test-icon.svg',
    'public/test-icon-16.png',
    'public/test-icon-32.png',
    'public/test-icon-48.png',
    'public/test-icon-128.png',
    'public/test-kites-icon.svg',
    'public/icon-standalone.svg',
    'public/icon-badge.svg',
    'public/icon-standalone-16.png',
    'public/icon-standalone-32.png',
    'public/icon-standalone-48.png',
    'public/icon-standalone-128.png',
    'public/icon-badge-16.png',
    'public/icon-badge-32.png',
    'public/icon-badge-48.png',
    'public/icon-badge-128.png'
  ];
  for (const file of testFiles) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
  console.log('Temporary icon files cleaned up.');
}

main().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
