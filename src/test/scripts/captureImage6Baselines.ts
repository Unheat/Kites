import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as ort from 'onnxruntime-node';
import { createCanvas, loadImage, registerFont } from 'canvas';
import { OcrManager } from '../../offscreen/services/OcrManager.js';
import { NeuralBubbleDetector } from '../../offscreen/engines/bubble/NeuralBubbleDetector.js';
import { HeuristicBubbleExtractor } from '../../offscreen/engines/bubble/HeuristicBubbleExtractor.js';
import { NeuralBubbleEngine } from '../../offscreen/engines/bubble/NeuralBubbleEngine.js';
import { resolveBubbleLayoutsDetailed } from '../../offscreen/services/BubbleLayoutService.js';
import { renderTextBlocksBatch, measureBubbleLayoutFontSize, type TextBlockItem } from '../../offscreen/utils/canvasTypesetting.js';
import { HyphenationService } from '../../offscreen/utils/hyphenation/HyphenationService.js';
import { InpaintManager } from '../../offscreen/services/InpaintManager.js';
import { mapOcrTextToKoharuExact } from '../pipelineVisualKoharuExactTest.js';
import type { Point2D } from '../../shared/utils/geometry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(TEST_ROOT, 'fixtures');
const MODEL_PATH = path.resolve(TEST_ROOT, '../../models/manga109_yolo11n_seg_1024.onnx');
const IMAGE_PATH = path.join(TEST_ROOT, 'test-img/image6.jpg');
const FONT_FAMILY = 'CCWildWords, sans-serif';
const PROTOTYPE_SIZE = 256;

async function captureBaselines() {
  console.log('[Capture] Starting baseline capture for image6.jpg...');
  fs.mkdirSync(FIXTURES, { recursive: true });

  const buffer = fs.readFileSync(IMAGE_PATH);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const rawImage = await loadImage(buffer);
  const { width: pageWidth, height: pageHeight } = rawImage;

  const ocrManager = new OcrManager();
  const ocrMedium = await ocrManager.processImage(arrayBuffer, 'v6-medium', { sourceLang: 'ja', pageWidth, pageHeight });
  const ocrSmall = await ocrManager.processImage(arrayBuffer, 'v6-small', { sourceLang: 'ja', pageWidth, pageHeight });
  await ocrManager.cleanup();

  const saveOcr = (tier: string, result: typeof ocrMedium) => {
    const data = { metadata: { image: 'image6.jpg', imagePath: 'src/test/test-img/image6.jpg', ocrTier: tier, pageWidth, pageHeight, capturedAt: new Date().toISOString() },
      texts: result.texts, boxes: result.boxes, polygons: result.polygons, rawPolygons: result.rawPolygons,
      scores: result.scores, detectionScores: result.detectionScores, directions: result.directions,
      fontSizes: result.fontSizes, angles: result.angles, lineCounts: result.lineCounts };
    fs.writeFileSync(path.join(FIXTURES, `image6_ocr_v6_${tier}.json`), JSON.stringify(data, null, 2));
  };
  saveOcr('medium', ocrMedium);
  saveOcr('small', ocrSmall);
  console.log('[Capture] Saved OCR fixtures');

  const transcriptions = ocrMedium.texts.map((orig, idx) => {
    const mapped = mapOcrTextToKoharuExact(orig, ocrMedium.boxes[idx]);
    const knownUncertain: Record<number, string> = {
      0: 'Watermark debris: raw OCR "我==" stripped to "我" by battery; missing dictionary rule for "我==" vs Japanese SFX.',
      5: 'Isolated SFX character "电" inside lightning glyph panel; no dictionary mapping.',
      8: 'Raw OCR "ボロ" recognized; dictionary maps to "POOR...!"',
      15: 'Raw OCR "明白！" recognized; dictionary maps to "UN-DER-STOOD!".',
      16: 'Homophone "证" for "正" in "现在证是拼尽全力的时候"; dictionary matches on "全力".',
    };
    return { index: idx, originalText: orig, box: ocrMedium.boxes[idx], direction: ocrMedium.directions?.[idx] ?? 'v',
      mappedText: mapped, uncertainty: knownUncertain[idx] ?? null };
  });
  fs.writeFileSync(path.join(FIXTURES, 'image6_koharu_exact_transcription.json'), JSON.stringify({
    metadata: { image: 'image6.jpg', sourceDictionary: 'pipelineVisualKoharuExactTest.ts:mapOcrTextToKoharuExact', totalBlocks: transcriptions.length },
    transcriptions, }, null, 2));
  console.log('[Capture] Saved transcription fixture');

  const session = await ort.InferenceSession.create(MODEL_PATH);
  const { width, height } = rawImage;
  const canvas1024 = createCanvas(1024, 1024);
  const ctx1024 = canvas1024.getContext('2d');
  ctx1024.drawImage(rawImage, 0, 0, 1024, 1024);
  const floats = NeuralBubbleDetector.preprocessImage(ctx1024.getImageData(0, 0, 1024, 1024).data, 1024);
  const output = await session.run({ images: new ort.Tensor('float32', floats, [1, 3, 1024, 1024]) });
  const parsed = NeuralBubbleDetector.parseYolo11Output(output.output0, width, height, 1024, 0.35, 0.45, output.output1);
  await session.release();

  const rawCanvas = createCanvas(width, height);
  const rawCtx = rawCanvas.getContext('2d');
  rawCtx.drawImage(rawImage, 0, 0);
  const rawPixels = rawCtx.getImageData(0, 0, width, height);

  const boxes = ocrMedium.boxes;
  const shapes: (any | undefined)[] = new Array(boxes.length).fill(undefined);
  const shapesMetadata: any[] = [];

  for (let i = 0; i < boxes.length; i++) {
    const textBox = boxes[i];
    const matchedIdx = NeuralBubbleDetector.matchBubbleIndex(textBox, parsed.bubbles);
    if (matchedIdx === -1) continue;
    const item = parsed.items?.[matchedIdx];
    if (!item?.protoMask) continue;
    const { mask, pw, ph, px1, py1 } = item.protoMask;
    const minX = Math.round(px1 * (width / PROTOTYPE_SIZE));
    const minY = Math.round(py1 * (height / PROTOTYPE_SIZE));
    const origPatchW = Math.max(1, Math.round(pw * (width / PROTOTYPE_SIZE)));
    const origPatchH = Math.max(1, Math.round(ph * (height / PROTOTYPE_SIZE)));
    const scaleX = pw / origPatchW, scaleY = ph / origPatchH, avgScale = (scaleX + scaleY) / 2;
    const textCenterX = Math.max(0, Math.min(pw - 1, Math.round((textBox.x + textBox.w / 2 - minX) * scaleX)));
    const textCenterY = Math.max(0, Math.min(ph - 1, Math.round((textBox.y + textBox.h / 2 - minY) * scaleY)));
    const severed = HeuristicBubbleExtractor.severTailOnBinaryMask(mask, pw, ph, textCenterX, textCenterY,
      Math.max(3, Math.round(14 * avgScale)), origPatchW, origPatchH, minX, minY, scaleX, scaleY, false);
    const carrierBox = severed ? severed.carrier : parsed.bubbles[matchedIdx];
    shapes[i] = { x: minX, y: minY, scale: avgScale, scaleX, scaleY, width: pw, height: ph,
      interior: mask, observedInterior: mask, eroded: severed ? severed.eroded : mask, carrierBox, isSeveredCarrier: Boolean(severed) };
    shapesMetadata.push({ boxIndex: i, matchedBubbleIndex: matchedIdx, isSevered: Boolean(severed),
      minX, minY, origPatchW, origPatchH, scaleX, scaleY, avgScale, carrierBox });
  }

  const neuralGeometry = await NeuralBubbleEngine.buildGeometry(null, rawPixels, boxes, undefined, { bubbles: parsed.bubbles, shapes });
  if (!neuralGeometry) throw new Error('NeuralBubbleEngine.buildGeometry returned null');

  const fontPath = path.resolve(TEST_ROOT, '../../scratches/reference/xianscan-rust/web/static/fonts/CCWildWords-Roman.ttf');
  if (fs.existsSync(fontPath)) registerFont(fontPath, { family: 'CCWildWords' });
  HyphenationService.setCustomLoader(async (name: string) => {
    const p = path.resolve(TEST_ROOT, '../../public/assets/hyphenation', `${name}.txt`);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
  });
  await HyphenationService.getInstance().loadLanguage('en');

  const mappedTexts = transcriptions.map(t => t.mappedText);
  const measureCanvas = createCanvas(pageWidth, pageHeight);
  const layout = resolveBubbleLayoutsDetailed({
    ...neuralGeometry, boxes, directions: ocrMedium.directions, angles: ocrMedium.angles, pageWidth, pageHeight,
    accept: (index, proposed) => {
      const curv = neuralGeometry.curvatures?.[index];
      const block: TextBlockItem = { text: mappedTexts[index], polygon: ocrMedium.polygons![index],
        fontSize: ocrMedium.fontSizes?.[index], direction: ocrMedium.directions?.[index], angle: ocrMedium.angles?.[index],
        originalText: ocrMedium.texts[index], sourceLineCount: ocrMedium.lineCounts?.[index],
        isRounded: curv?.isRounded, borderRadius: curv?.borderRadius, typesetMode: curv?.isRounded ? 'contour' : 'simple' };
      return measureBubbleLayoutFontSize(measureCanvas.getContext('2d') as any, block, proposed, FONT_FAMILY, true) > 0;
    },
  });

  const inpaintManager = new InpaintManager();
  const inpaintPolys = (ocrMedium.rawPolygons ?? ocrMedium.polygons) as Point2D[][];
  const cleanedBuffer = await inpaintManager.eraseText(arrayBuffer, inpaintPolys, 'simple');
  const cleanedImage = await loadImage(Buffer.from(cleanedBuffer));
  await inpaintManager.cleanup();

  const renderCanvas = createCanvas(pageWidth, pageHeight);
  const renderCtx = renderCanvas.getContext('2d');
  renderCtx.drawImage(cleanedImage, 0, 0);
  const blocks: TextBlockItem[] = [];
  for (let i = 0; i < mappedTexts.length; i++) {
    const text = mappedTexts[i], poly = ocrMedium.polygons![i];
    if (!text || !poly) continue;
    const typesetBox = layout.typesetBoxes[i] ?? undefined;
    const fixed = typesetBox !== undefined;
    const curv = fixed ? neuralGeometry.curvatures?.[i] : undefined;
    blocks.push({ text, polygon: poly, direction: ocrMedium.directions?.[i] || 'h', typesetBox,
      fontSize: ocrMedium.fontSizes?.[i], angle: ocrMedium.angles?.[i], originalText: ocrMedium.texts[i],
      sourceLineCount: ocrMedium.lineCounts?.[i], isRounded: fixed ? Boolean(curv?.isRounded) : false,
      borderRadius: fixed ? (curv?.borderRadius ?? 0) : 0, typesetMode: fixed ? (curv?.isRounded ? 'contour' : 'simple') : 'balloon',
      contourPoints: fixed ? (layout.contourPoints?.[i] ?? undefined) : undefined });
  }
  const renderInfos = renderTextBlocksBatch(renderCtx as any, blocks, 'en', { width: pageWidth, height: pageHeight }, FONT_FAMILY, true);

  const serializableItems = (parsed.items || []).map((item) => ({
    box: item.box, score: item.score, rawBox: item.rawBox,
    protoMask: item.protoMask ? { pw: item.protoMask.pw, ph: item.protoMask.ph, px1: item.protoMask.px1, py1: item.protoMask.py1,
      maskBase64: Buffer.from(item.protoMask.mask).toString('base64') } : undefined,
  }));

  fs.writeFileSync(path.join(FIXTURES, 'image6_neural_baseline_geometry.json'), JSON.stringify({
    metadata: { image: 'image6.jpg', model: 'manga109_yolo11n_seg_1024.onnx', engine: 'NeuralBubbleEngine', capturedAt: new Date().toISOString(), pageWidth, pageHeight },
    yoloBubbles: parsed.bubbles, yoloItems: serializableItems,
    carriers: neuralGeometry.carriers, proposals: neuralGeometry.proposals,
    curvatures: neuralGeometry.curvatures, contours: neuralGeometry.contours,
    shapesMetadata, resolvedLayout: { typesetBoxes: layout.typesetBoxes, contourPoints: layout.contourPoints, skipped: layout.skipped },
    renderInfos, stageMetrics: { totalOcrBoxes: boxes.length, yoloProposalCount: parsed.bubbles.length,
      matchedProposals: neuralGeometry.proposals.filter(Boolean).length, acceptedTypesetBoxes: layout.typesetBoxes.filter(Boolean).length,
      rejectedTypesetBoxes: layout.typesetBoxes.filter((b) => b === undefined).length },
  }, null, 2));
  console.log('[Capture] Complete! All fixtures created.');
}

captureBaselines().catch((e) => { console.error('[Capture] Failed:', e); process.exit(1); });