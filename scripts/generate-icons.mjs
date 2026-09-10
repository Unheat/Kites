import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from 'canvas';

const ICONS_DIR = path.resolve('public/icons');
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

async function main() {
  const svgPath = path.resolve('public/icon.svg');
  const svgContent = fs.readFileSync(svgPath, 'utf-8');

  // Keep favicon in sync
  fs.writeFileSync('public/favicon.svg', svgContent, 'utf-8');

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
}

main().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
