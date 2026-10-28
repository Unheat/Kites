import { createCanvas, type Image } from 'canvas';
import * as ort from 'onnxruntime-node';
import { NeuralBubbleDetector } from '../../offscreen/engines/bubble/NeuralBubbleDetector.js';
import { HeuristicBubbleExtractor, type BubbleShapeEvidence } from '../../offscreen/engines/bubble/HeuristicBubbleExtractor.js';
import type { BoxRect } from '../../offscreen/utils/bubbleExpansion.js';
import type { SavedYoloItem, ShapeMetadata } from './fixtureTypes.js';

const INPUT_SIZE = 1024;
const PROTOTYPE_SIZE = 256;
const SCORE_THRESHOLD = 0.35;
const NMS_THRESHOLD = 0.45;
const MIN_EROSION_RADIUS = 3;
const PAGE_EROSION_RADIUS = 14;
export type Detection = ReturnType<typeof NeuralBubbleDetector.parseYolo11Output>;
type DetectionItem = NonNullable<Detection['items']>[number];

export async function inferNeuralDetection(image: Image, modelPath: string): Promise<Detection> {
  const session = await ort.InferenceSession.create(modelPath);
  try {
    const canvas = createCanvas(INPUT_SIZE, INPUT_SIZE);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const floats = NeuralBubbleDetector.preprocessImage(ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data, INPUT_SIZE);
    const output = await session.run({ images: new ort.Tensor('float32', floats, [1, 3, INPUT_SIZE, INPUT_SIZE]) });
    return NeuralBubbleDetector.parseYolo11Output(output.output0, image.width, image.height,
      INPUT_SIZE, SCORE_THRESHOLD, NMS_THRESHOLD, output.output1);
  } finally {
    await session.release();
  }
}

export function decodeSavedItems(items: SavedYoloItem[]): DetectionItem[] {
  return items.map((item) => ({
    box: item.box, score: item.score, rawBox: item.rawBox,
    protoMask: item.protoMask ? {
      pw: item.protoMask.pw, ph: item.protoMask.ph, px1: item.protoMask.px1, py1: item.protoMask.py1,
      mask: new Uint8Array(Buffer.from(item.protoMask.maskBase64, 'base64')),
    } : undefined,
  }));
}

export function encodeDetectionItems(items: DetectionItem[]): SavedYoloItem[] {
  return items.map((item) => ({
    box: item.box, score: item.score, rawBox: item.rawBox,
    protoMask: item.protoMask ? {
      pw: item.protoMask.pw, ph: item.protoMask.ph, px1: item.protoMask.px1, py1: item.protoMask.py1,
      maskBase64: Buffer.from(item.protoMask.mask).toString('base64'),
    } : undefined,
  }));
}

export function buildNeuralShapes(bubbles: BoxRect[], items: DetectionItem[], boxes: BoxRect[], pageWidth: number, pageHeight: number) {
  const shapes: (BubbleShapeEvidence | undefined)[] = new Array(boxes.length).fill(undefined);
  const shapesMetadata: ShapeMetadata[] = [];
  boxes.forEach((textBox, i) => {
    const matchedIdx = NeuralBubbleDetector.matchBubbleIndex(textBox, bubbles);
    if (matchedIdx === -1) return;
    const item = items[matchedIdx];
    if (!item?.protoMask) return;
    const { mask, pw, ph, px1, py1 } = item.protoMask;
    const minX = Math.round(px1 * (pageWidth / PROTOTYPE_SIZE));
    const minY = Math.round(py1 * (pageHeight / PROTOTYPE_SIZE));
    const origPatchW = Math.max(1, Math.round(pw * (pageWidth / PROTOTYPE_SIZE)));
    const origPatchH = Math.max(1, Math.round(ph * (pageHeight / PROTOTYPE_SIZE)));
    const scaleX = pw / origPatchW, scaleY = ph / origPatchH;
    const avgScale = (scaleX + scaleY) / 2;
    const textCenterX = Math.max(0, Math.min(pw - 1, Math.round((textBox.x + textBox.w / 2 - minX) * scaleX)));
    const textCenterY = Math.max(0, Math.min(ph - 1, Math.round((textBox.y + textBox.h / 2 - minY) * scaleY)));
    const severed = HeuristicBubbleExtractor.severTailOnBinaryMask(mask, pw, ph, textCenterX, textCenterY,
      Math.max(MIN_EROSION_RADIUS, Math.round(PAGE_EROSION_RADIUS * avgScale)),
      origPatchW, origPatchH, minX, minY, scaleX, scaleY, false);
    const carrierBox = severed ? severed.carrier : bubbles[matchedIdx];
    shapes[i] = {
      x: minX, y: minY, scale: avgScale, scaleX, scaleY, width: pw, height: ph,
      interior: mask, observedInterior: mask, eroded: severed ? severed.eroded : mask,
      carrierBox, isSeveredCarrier: Boolean(severed),
    };
    shapesMetadata.push({ boxIndex: i, matchedBubbleIndex: matchedIdx, isSevered: Boolean(severed),
      minX, minY, origPatchW, origPatchH, scaleX, scaleY, avgScale, carrierBox });
  });
  return { shapes, shapesMetadata };
}