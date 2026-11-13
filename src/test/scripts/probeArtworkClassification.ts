/**
 * Probe: artwork classification on a real page.
 *
 * Runs the real OCR + textline merge + artwork classifier over one image and prints, per merged
 * block, both the new glyph ratio (Cotrans block font size over page baseline) and the legacy one
 * (merged box short side over baseline), plus the classifier verdict. Lets a branch be compared
 * against the previous behaviour on the same page without running the extension.
 *
 * Usage: npx tsx src/test/scripts/probeArtworkClassification.ts <image-path>
 */
import * as fs from 'fs';
import { createCanvas, loadImage } from 'canvas';
import { OcrManager } from '../../offscreen/services/OcrManager';
import { HeuristicBubbleEngine } from '../../offscreen/engines/bubble/HeuristicBubbleEngine';
import { resolveBubbleLayoutsDetailed } from '../../offscreen/services/BubbleLayoutService';

const imagePath = process.argv[2];
if (!imagePath) {
  console.error('Usage: npx tsx src/test/scripts/probeArtworkClassification.ts <image-path>');
  process.exit(1);
}

/**
 * Character-weighted median of the merged box short sides, matching the classifier's own baseline.
 *
 * @param boxes - Merged region boxes.
 * @param texts - Merged region texts, parallel to `boxes`.
 * @returns The page body-text baseline in pixels.
 */
function legacyBaseline(boxes: { w: number; h: number }[], texts: string[]): number {
  const pairs = boxes
    .map((box, index) => ({ size: Math.min(box.w, box.h), weight: Math.max(Array.from(texts[index] ?? '').length, 1) }))
    .sort((a, b) => a.size - b.size);
  const totalWeight = pairs.reduce((sum, pair) => sum + pair.weight, 0);
  let accumulated = 0;
  for (const pair of pairs) {
    accumulated += pair.weight;
    if (accumulated >= totalWeight / 2) return pair.size;
  }
  return pairs[pairs.length - 1]?.size ?? 0;
}

async function main(): Promise<void> {
  const image = await loadImage(imagePath);
  const buffer = fs.readFileSync(imagePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

  const ocrManager = new OcrManager();
  const result = await ocrManager.processImage(arrayBuffer, 'v6-small', {
    pageWidth: image.width,
    pageHeight: image.height,
    sfxPolicy: 'preserve',
  });
  await ocrManager.cleanup();

  const boxes = result.boxes ?? [];
  const baseline = legacyBaseline(boxes, result.texts ?? []);
  const artwork = new Map((result.artwork ?? []).map((item) => [item.index, item.kind]));
  console.log(`\n[probe] page ${image.width}x${image.height}, ${boxes.length} merged blocks, baseline ${baseline}px`);
  (result.texts ?? []).forEach((text, index) => {
    const box = boxes[index];
    const fontSize = result.fontSizes?.[index] ?? 0;
    const lineCount = result.lineCounts?.[index] ?? 1;
    const legacyRatio = baseline > 0 ? Math.min(box.w, box.h) / baseline : 0;
    const newRatio = baseline > 0 && fontSize > 0 ? fontSize / baseline : 0;
    const kind = artwork.get(index) ?? '-';
    console.log(
      `#${String(index).padStart(2)} ${String(box.w).padStart(4)}x${String(box.h).padStart(4)} lines=${lineCount} ` +
      `font=${fontSize.toFixed(0).padStart(3)} legacy=${legacyRatio.toFixed(2)} new=${newRatio.toFixed(2)} ` +
      `${kind.padEnd(16)} "${text}"`,
    );
  });
  console.log(`\n[probe] artwork total: ${result.artwork?.length ?? 0}/${boxes.length}`);

  // Heuristic tier: does the per-line retry recover chambers the merged rectangle lost?
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height);
  const imagePatch = { width: image.width, height: image.height, data: pixels.data };
  const withoutLines = HeuristicBubbleEngine.buildGeometry(imagePatch, boxes);
  const withLines = HeuristicBubbleEngine.buildGeometry(imagePatch, boxes, result.mergedGroupLineBoxes);
  const nullBefore = withoutLines.carriers.filter((carrier) => !carrier).length;
  const nullAfter = withLines.carriers.filter((carrier) => !carrier).length;
  console.log(`\n[probe] heuristic carriers: null ${nullBefore}/${boxes.length} without line retry, ${nullAfter}/${boxes.length} with`);
  withLines.carriers.forEach((carrier, index) => {
    if (!withoutLines.carriers[index] && carrier) {
      console.log(`[probe]   recovered #${index} "${result.texts?.[index] ?? ''}" -> ${JSON.stringify(carrier)}`);
    }
  });

  // Full layout resolver: how many regions actually receive a balloon frame with and without the
  // per-line retry. Acceptance is stubbed true so only association/carrier recovery is measured.
  const layoutInput = (geometry: typeof withoutLines) => ({
    ...geometry,
    boxes,
    directions: result.directions,
    angles: result.angles,
    pageWidth: image.width,
    pageHeight: image.height,
    accept: () => true,
  });
  const layoutBefore = resolveBubbleLayoutsDetailed(layoutInput(withoutLines));
  const layoutAfter = resolveBubbleLayoutsDetailed(layoutInput(withLines));
  const framedBefore = layoutBefore.typesetBoxes.filter(Boolean).length;
  const framedAfter = layoutAfter.typesetBoxes.filter(Boolean).length;
  console.log(`[probe] typeset frames: ${framedBefore}/${boxes.length} without line retry, ${framedAfter}/${boxes.length} with`);
  layoutAfter.typesetBoxes.forEach((box, index) => {
    if (!layoutBefore.typesetBoxes[index] && box) {
      console.log(`[probe]   newly framed #${index} "${result.texts?.[index] ?? ''}" -> ${JSON.stringify(box)}`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
