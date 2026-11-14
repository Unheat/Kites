/**
 * Renders one page through the production heuristic-tier pipeline for visual inspection.
 *
 * Runs OCR with per-line balloon ownership, inpainting, Google translation and the shared layout
 * resolver, then writes a PNG. Used to eyeball a reported page without loading the extension.
 *
 * Usage: npx tsx src/test/scripts/renderPageCheck.ts <image-path> <output.png>
 */
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage } from 'canvas';
import { OcrManager } from '../../offscreen/services/OcrManager';
import { InpaintManager } from '../../offscreen/services/InpaintManager';
import { GoogleTranslateEngine } from '../../offscreen/engines/translation/GoogleTranslateEngine';
import { resolveBubbleLayoutsDetailed } from '../../offscreen/services/BubbleLayoutService';
import {
  renderTextBlocksBatch,
  measureBubbleLayoutFontSize,
  DEFAULT_RENDER_FONT_FAMILY,
  type TextBlockItem,
} from '../../offscreen/utils/canvasTypesetting';
import { createHeuristicOwnership } from '../ownershipHarness';

const [imagePath, outputPath] = process.argv.slice(2);
if (!imagePath || !outputPath) {
  console.error('Usage: npx tsx src/test/scripts/renderPageCheck.ts <image-path> <output.png>');
  process.exit(1);
}

const image = await loadImage(imagePath);
const buffer = fs.readFileSync(imagePath);
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
const pageWidth = image.width;
const pageHeight = image.height;

const source = createCanvas(pageWidth, pageHeight);
const sourceCtx = source.getContext('2d');
sourceCtx.drawImage(image, 0, 0);
const pixels = sourceCtx.getImageData(0, 0, pageWidth, pageHeight);

const ownership = createHeuristicOwnership({
  canvas: source as any,
  image: { data: pixels.data, width: pageWidth, height: pageHeight },
  pageWidth,
  pageHeight,
});

const ocrManager = new OcrManager();
const ocr = await ocrManager.processImage(arrayBuffer, 'v6-small', { pageWidth, pageHeight, sfxPolicy: 'preserve' },
  undefined, { partitionLines: (lines) => ownership.partition(lines) });
await ocrManager.cleanup();

const geometry = ownership.geometryForRegions(ocr.groupLineIndices ?? []);
const artwork = new Set((ocr.artwork ?? []).map((item) => item.index));

const inpaint = new InpaintManager();
const cleaned = await inpaint.eraseText(arrayBuffer, (ocr.rawPolygons ?? []) as any, 'simple');
await inpaint.cleanup();
const cleanedImage = await loadImage(Buffer.from(cleaned));

const canvas = createCanvas(pageWidth, pageHeight);
const ctx = canvas.getContext('2d');
ctx.drawImage(cleanedImage, 0, 0);

const translator = new GoogleTranslateEngine();
await translator.init();
const translated = await translator.translate(ocr.texts, 'auto', 'en');

const items: TextBlockItem[] = [];
const indices: number[] = [];
ocr.texts.forEach((text, index) => {
  if (artwork.has(index)) return;
  const polygon = ocr.polygons?.[index];
  if (!translated[index] || !polygon) return;
  items.push({
    text: translated[index],
    polygon: polygon as any,
    direction: ocr.directions?.[index] ?? 'h',
    fontSize: ocr.fontSizes?.[index],
    angle: ocr.angles?.[index],
    originalText: text,
    sourceLineCount: ocr.lineCounts?.[index],
  });
  indices.push(index);
});

if (geometry) {
  const detailed = resolveBubbleLayoutsDetailed({
    ...geometry,
    boxes: ocr.boxes,
    directions: ocr.directions,
    angles: ocr.angles,
    pageWidth,
    pageHeight,
    accept: (index, proposed, _ratio, contour) => {
      const item = items[indices.indexOf(index)];
      if (!item) return false;
      const block = { ...item, isRounded: true, borderRadius: 24, typesetMode: 'contour' as const, contourPoints: contour };
      return measureBubbleLayoutFontSize(ctx as any, block, proposed, DEFAULT_RENDER_FONT_FAMILY, false, 'en', 6,
        { width: proposed.w, height: proposed.h }) > 0;
    },
  });
  indices.forEach((index, position) => {
    const box = detailed.typesetBoxes?.[index];
    if (box) {
      items[position].typesetBox = box;
      items[position].contourPoints = detailed.contourPoints?.[index];
      items[position].isRounded = true;
      items[position].typesetMode = 'contour';
    }
    if (detailed.skipped?.[index]) items[position].isSkipped = true;
  });
}

renderTextBlocksBatch(ctx as any, items, 'en', { width: pageWidth, height: pageHeight }, DEFAULT_RENDER_FONT_FAMILY);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
console.log(`[renderPageCheck] wrote ${outputPath} (${items.length} blocks)`);
