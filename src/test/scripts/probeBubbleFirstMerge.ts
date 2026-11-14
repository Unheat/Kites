/**
 * Probe: bubble-first merge on a real page.
 *
 * Runs the real OCR pipeline with ownership resolved per raw line (the new order), for one tier, and
 * reports: balloons, bucket assignment, merged regions, which regions gained a balloon frame, the
 * artwork marks, and the inpaint mask list. Also asserts the new invariant — no region may contain
 * lines from two different buckets.
 *
 * Usage: npx tsx src/test/scripts/probeBubbleFirstMerge.ts <image-path> [neural|heuristic]
 */
import * as fs from 'fs';
import { createCanvas, loadImage } from 'canvas';
import { OcrManager } from '../../offscreen/services/OcrManager';
import { HeuristicBubbleEngine } from '../../offscreen/engines/bubble/HeuristicBubbleEngine';
import { matchBoxToBubbleIndex } from '../../offscreen/engines/bubble/bubbleAssociation';
import { resolveLineBuckets } from '../../offscreen/services/PageBubbleOwnership';
import { resolveBubbleLayoutsDetailed } from '../../offscreen/services/BubbleLayoutService';
import type { BoxRect } from '../../offscreen/utils/bubbleExpansion';
import type { BubbleGeometry } from '../../offscreen/engines/bubble/BaseBubbleEngine';
import type { PreparedPageLine } from '../../offscreen/engines/ocr/BaseOcrEngine';
import { inferNeuralDetection } from '../regression/neuralDetection';

const imagePath = process.argv[2];
const tier = (process.argv[3] ?? 'neural') as 'neural' | 'heuristic';
if (!imagePath) {
  console.error('Usage: npx tsx src/test/scripts/probeBubbleFirstMerge.ts <image-path> [neural|heuristic]');
  process.exit(1);
}

async function main(): Promise<void> {
  const image = await loadImage(imagePath);
  const buffer = fs.readFileSync(imagePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height);
  const imagePatch = { width: image.width, height: image.height, data: pixels.data };

  let balloons: BoxRect[] = [];
  let lineGeometry: BubbleGeometry | undefined;

  const partitionLines = async (lines: PreparedPageLine[]): Promise<number[]> => {
    const boxes = lines.map((line) => line.box);
    if (tier === 'neural') {
      const detection = await inferNeuralDetection(image, 'models/manga109_yolo11n_seg_1024.onnx');
      balloons = detection.bubbles;
      lineGeometry = {
        pageWidth: image.width,
        pageHeight: image.height,
        carriers: boxes.map((box) => balloons[matchBoxToBubbleIndex(box, balloons)] ?? null),
        proposals: boxes.map((box) => balloons[matchBoxToBubbleIndex(box, balloons)] ?? null),
        shapes: [],
      } as BubbleGeometry;
    } else {
      const geometry = HeuristicBubbleEngine.buildGeometry(imagePatch, boxes);
      balloons = resolveLineBuckets(geometry).balloons;
      lineGeometry = geometry;
    }
    return resolveLineBuckets(lineGeometry).buckets;
  };

  const ocrManager = new OcrManager();
  const result = await ocrManager.processImage(arrayBuffer, 'v6-small', {
    pageWidth: image.width,
    pageHeight: image.height,
    sfxPolicy: 'preserve',
  }, undefined, { partitionLines });
  await ocrManager.cleanup();

  const artwork = new Map((result.artwork ?? []).map((item) => [item.index, item.kind]));
  const groups = result.groupLineIndices ?? [];
  console.log(`\n[probe:${tier}] ${balloons.length} balloon(s), ${groups.length} merged region(s), ` +
    `${result.rawPolygons?.length ?? 0} mask polygons`);

  let invariantBreaks = 0;
  groups.forEach((lineIndices, index) => {
    const bucket = lineGeometry?.proposals[lineIndices[0]] ?? null;
    const lineBuckets = resolveLineBuckets(lineGeometry);
    const balloonIndex = bucket ? balloons.indexOf(bucket) : -1;
    const kind = artwork.get(index) ?? '-';
    const mixed = lineIndices.some((lineIndex) => (lineGeometry?.proposals[lineIndex] ?? null) !== bucket);
    if (mixed) invariantBreaks += 1;
    console.log(
      `#${String(index).padStart(2)} lines=${lineIndices.length} balloon=${String(balloonIndex).padStart(2)} ` +
      `bucket=${lineBuckets.buckets[lineIndices[0]] ?? '?'} ` +
      `${mixed ? 'MIXED ' : ''}${kind.padEnd(16)} "${result.texts[index]}"`,
    );
  });
  console.log(`[probe:${tier}] regions spanning two buckets: ${invariantBreaks} (must be 0)`);
  console.log(`[probe:${tier}] artwork: ${result.artwork?.length ?? 0}/${groups.length}`);

  if (lineGeometry) {
    const regionGeometry: BubbleGeometry = {
      ...lineGeometry,
      pageWidth: image.width,
      carriers: groups.map((indices) => lineGeometry!.carriers[indices[0]] ?? null),
      proposals: groups.map((indices) => lineGeometry!.proposals[indices[0]] ?? null),
      shapes: groups.map(() => undefined),
      curvatures: groups.map((indices) => lineGeometry!.curvatures?.[indices[0]] ?? { isRounded: false, borderRadius: 0 }),
      contours: groups.map((indices) => lineGeometry!.contours?.[indices[0]]),
    };
    const layout = resolveBubbleLayoutsDetailed({
      ...regionGeometry,
      boxes: result.boxes,
      directions: result.directions,
      angles: result.angles,
      pageWidth: image.width,
      pageHeight: image.height,
      accept: () => true,
    });
    console.log(`[probe:${tier}] typeset frames: ${layout.typesetBoxes.filter(Boolean).length}/${groups.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
