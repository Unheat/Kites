/**
 * Probe: neural (YOLO) balloon association with and without the per-line retry.
 *
 * Runs real OCR, real YOLO11-seg inference and the real neural engine on one page, then reports how
 * many merged regions gain a balloon when the engine is allowed to re-ask with their child lines.
 * Complements probeArtworkClassification.ts, which covers the heuristic tier.
 *
 * Usage: npx tsx src/test/scripts/probeNeuralBubbleAssociation.ts <image-path>
 */
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage } from 'canvas';
import { OcrManager } from '../../offscreen/services/OcrManager';
import { NeuralBubbleEngine } from '../../offscreen/engines/bubble/NeuralBubbleEngine';
import { resolveBubbleLayoutsDetailed } from '../../offscreen/services/BubbleLayoutService';
import { inferNeuralDetection, buildNeuralShapes } from '../regression/neuralDetection';

const imagePath = process.argv[2];
if (!imagePath) {
  console.error('Usage: npx tsx src/test/scripts/probeNeuralBubbleAssociation.ts <image-path>');
  process.exit(1);
}

const modelPath = path.resolve(process.cwd(), 'models/manga109_yolo11n_seg_1024.onnx');

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
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height);

  const detection = await inferNeuralDetection(image, modelPath);
  const { shapes } = buildNeuralShapes(detection.bubbles, detection.items ?? [], boxes, image.width, image.height);
  const precomputed = { bubbles: detection.bubbles, shapes };

  const withoutLines = await NeuralBubbleEngine.buildGeometry(null, pixels, boxes, undefined, precomputed);
  const withLines = await NeuralBubbleEngine.buildGeometry(null, pixels, boxes, undefined, precomputed, result.mergedGroupLineBoxes);
  if (!withoutLines || !withLines) throw new Error('Neural geometry build failed');

  const unmatchedBefore = withoutLines.proposals.filter((proposal) => !proposal).length;
  const unmatchedAfter = withLines.proposals.filter((proposal) => !proposal).length;
  console.log(`\n[neural-probe] ${detection.bubbles.length} YOLO balloons, ${boxes.length} merged regions`);
  console.log(`[neural-probe] unmatched regions: ${unmatchedBefore} without line retry, ${unmatchedAfter} with`);
  withLines.proposals.forEach((proposal, index) => {
    if (!withoutLines.proposals[index] && proposal) {
      console.log(`[neural-probe]   recovered #${index} "${result.texts?.[index] ?? ''}" -> ${JSON.stringify(proposal)}`);
    }
  });

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
  console.log(
    `[neural-probe] typeset frames: ${layoutBefore.typesetBoxes.filter(Boolean).length}/${boxes.length} without line retry, ` +
    `${layoutAfter.typesetBoxes.filter(Boolean).length}/${boxes.length} with`,
  );
  layoutAfter.typesetBoxes.forEach((box, index) => {
    if (!layoutBefore.typesetBoxes[index] && box) {
      console.log(`[neural-probe]   newly framed #${index} "${result.texts?.[index] ?? ''}" -> ${JSON.stringify(box)}`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
