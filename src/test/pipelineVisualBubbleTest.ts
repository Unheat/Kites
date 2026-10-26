import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { OcrManager } from '../offscreen/services/OcrManager';
import { InpaintManager } from '../offscreen/services/InpaintManager';
import { GoogleTranslateEngine } from '../offscreen/engines/translation/GoogleTranslateEngine';
import { renderTextBlocksBatch, measureBubbleLayoutFontSize, type TextBlockItem } from '../offscreen/utils/canvasTypesetting';
import { createCanvas, loadImage } from 'canvas';
import type { Point2D } from '../shared/utils/geometry';
import { NeuralBubbleDetector } from '../offscreen/engines/bubble/NeuralBubbleDetector';
import { HeuristicBubbleExtractor } from '../offscreen/engines/bubble/HeuristicBubbleExtractor';
import { acquireBubbleGeometry, resolveBubbleLayouts, type BubbleGeometry } from '../offscreen/services/BubbleLayoutService';
import { DEFAULT_RENDER_FONT_FAMILY } from '../offscreen/utils/canvasTypesetting';
import * as ort from 'onnxruntime-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPipelineVisualBubbleTest() {
  console.log('--- Starting Speech Bubble Detection & Typesetting Visual Test ---');

  const testImgDir = path.join(__dirname, 'test-img');
  const baseResultDir = path.join(__dirname, 'result');
  const heuristicDir = path.join(baseResultDir, 'pipeline_bubble_heuristic');
  const neuralDir = path.join(baseResultDir, 'pipeline_bubble_neural');
  const smartMaskDir = path.join(baseResultDir, 'pipeline_bubble_smart_mask');

  // Ensure result directories exist and clean stale outputs
  [heuristicDir, neuralDir, smartMaskDir].forEach((dir) => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
  });

  const ocrManager = new OcrManager();
  const inpaintManager = new InpaintManager();
  const translator = new GoogleTranslateEngine();
  await translator.init();

  // Load Neural Bubble Detector model if available in test/models or models/
  const candidateBubblePaths = [
    path.resolve(process.cwd(), 'src/test/models/bubble/manga109_yolo11n_seg_1024.onnx'),
    path.resolve(process.cwd(), 'models/manga109_yolo11n_seg_1024.onnx'),
    path.resolve(process.cwd(), 'models/detector-v4-s_int8.onnx'),
  ];
  const neuralModelPath = candidateBubblePaths.find((p) => fs.existsSync(p));
  let neuralSession: any = null;
  if (neuralModelPath) {
    console.log(`[Neural] Loading ONNX detector from ${neuralModelPath}...`);
    try {
      neuralSession = await ort.InferenceSession.create(neuralModelPath);
      console.log('[Neural] ONNX detector session initialized successfully.');
    } catch (err) {
      console.warn('[Neural] Failed initializing ONNX session, neural tier will fallback to heuristic:', err);
    }
  } else {
    console.warn(`[Neural] No bubble model found in candidate paths. Skipping neural tier.`);
  }

  const testFiles = ['image1.jpg', 'image2.jpg', 'image3.jpg', 'image4.jpg', 'image5.png', 'image6.jpg', 'image7.jpg', 'image8.png'];

  for (const testFile of testFiles) {
    console.log(`\n================================`);
    console.log(`Processing Test Image: ${testFile}`);
    console.log(`================================`);

    const imagePath = path.join(testImgDir, testFile);
    if (!fs.existsSync(imagePath)) {
      console.warn(`[Skip] Test image not found at: ${imagePath}`);
      continue;
    }

    const buffer = fs.readFileSync(imagePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const rawImage = await loadImage(buffer);
    const pageWidth = rawImage.width;
    const pageHeight = rawImage.height;

    // 1. OCR Stage
    console.log('[Pipeline] Running OCR text detection...');
    const ocrResult = await ocrManager.processImage(arrayBuffer, 'v6-small', { sourceLang: 'ja', pageWidth, pageHeight });
    const polygons = ocrResult.polygons as Point2D[][];
    const texts = ocrResult.texts;
    const boxes = ocrResult.boxes;

    if (!polygons || polygons.length === 0) {
      console.warn(`[Pipeline] No text polygons detected in ${testFile}. Skipping.`);
      continue;
    }
    console.log(`[Pipeline] Detected ${polygons.length} text regions.`);

    // 2. Simple Inpainting (STRICTLY using rawPolygons - Inpaint Isolation Invariant)
    console.log('[Pipeline] Running Inpainting (tier: simple)...');
    const inpaintPolygons = ocrResult.rawPolygons || polygons;
    const cleanedBuffer = await inpaintManager.eraseText(arrayBuffer, inpaintPolygons, 'simple');
    const cleanedImage = await loadImage(Buffer.from(cleanedBuffer));

    // 3. Translation
    console.log("[Pipeline] Translating text with Google Translate...");
    let translatedTexts: string[];
    try {
      translatedTexts = await translator.translate(texts, 'auto', 'en');
    } catch (err) {
      console.warn(`[Pipeline] Translation failed for ${testFile}:`, err);
      continue;
    }

    // Prepare raw image canvas data for Heuristic Carrier Extractor
    const rawCanvas = createCanvas(pageWidth, pageHeight);
    const rawCtx = rawCanvas.getContext('2d');
    rawCtx.drawImage(rawImage, 0, 0);
    const rawImageData = rawCtx.getImageData(0, 0, pageWidth, pageHeight);

    // -------------------------------------------------------------
    // PASS 1: TIER 1 HEURISTIC BUBBLE EXTRACTOR (0 MB)
    // -------------------------------------------------------------
    console.log("\n--- [Pass 1] Tier 1 Heuristic Bubble Expansion ---");
    const heuristicGeometry = acquireBubbleGeometry(rawImageData, boxes);

    /**
     * Uses the production acquisition/layout contract after translation and font readiness.
     * @param ctx - Actual output measurement context. @param geometry - Original carrier evidence.
     * @returns Accepted fixed boxes, with the same source-font and complete-text fit guard as production.
     */
    const resolveLayouts = (ctx: any, geometry: BubbleGeometry) => resolveBubbleLayouts({
      ...geometry, boxes, directions: ocrResult.directions, angles: ocrResult.angles, pageWidth, pageHeight,
      accept: (index, proposed) => {
        const curv = geometry.curvatures?.[index];
        const block: TextBlockItem = {
          text: translatedTexts[index], polygon: polygons[index], fontSize: ocrResult.fontSizes?.[index],
          direction: ocrResult.directions?.[index], angle: ocrResult.angles?.[index],
          originalText: texts[index], sourceLineCount: ocrResult.lineCounts?.[index],
          isRounded: curv?.isRounded,
          borderRadius: curv?.borderRadius,
          typesetMode: curv?.isRounded ? 'ellipse' : 'simple',
        };
        const fitted = measureBubbleLayoutFontSize(ctx, block, proposed, DEFAULT_RENDER_FONT_FAMILY);
        return fitted > 0;
      },
      onDiagnostics: (counts) => console.log('[Bubble layouts]', counts)
    });

    // Bake Heuristic Output
    {
      const canvas = createCanvas(pageWidth, pageHeight);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(cleanedImage, 0, 0);
      if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready;
      const heuristicTypesetBoxes = resolveLayouts(ctx, heuristicGeometry);

      const textBlockItems: TextBlockItem[] = [];
      for (let i = 0; i < translatedTexts.length; i++) {
        const text = translatedTexts[i];
        const poly = polygons[i];
        if (text && poly) {
          const curv = heuristicGeometry.curvatures?.[i];
          textBlockItems.push({
            text,
            polygon: poly,
            direction: ocrResult.directions ? ocrResult.directions[i] : 'h',
            typesetBox: heuristicTypesetBoxes[i],
            fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
            angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
            originalText: texts[i],
            sourceLineCount: ocrResult.lineCounts ? ocrResult.lineCounts[i] : undefined,
            isRounded: curv?.isRounded,
            borderRadius: curv?.borderRadius,
            typesetMode: curv?.isRounded ? 'ellipse' : 'simple',
          });
        }
      }
      renderTextBlocksBatch(ctx as any, textBlockItems, 'en', { width: pageWidth, height: pageHeight });
      const outPath = path.join(heuristicDir, testFile);
      fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
      console.log(`[Heuristic] Saved baked image: result/pipeline_bubble_heuristic/${testFile}`);
    }

    // -------------------------------------------------------------
    // PASS 2: TIER 2 NEURAL RT-DETR/YOLO BUBBLE DETECTOR (~11 MB)
    // -------------------------------------------------------------
    if (neuralSession) {
      console.log("\n--- [Pass 2] Tier 2 Neural Bubble Expansion ---");
      const isYolo11 = neuralSession.outputNames && neuralSession.outputNames.includes('output0');
      const inputSize = isYolo11 ? 1024 : 640;
      const resizeCanvas = createCanvas(inputSize, inputSize);
      const resizeCtx = resizeCanvas.getContext('2d');
      resizeCtx.drawImage(rawImage, 0, 0, inputSize, inputSize);
      const resizedImgData = resizeCtx.getImageData(0, 0, inputSize, inputSize).data;

      const floatData = NeuralBubbleDetector.preprocessImage(resizedImgData, inputSize);
      const tensorImages = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);

      const feeds: Record<string, any> = { images: tensorImages };
      if (neuralSession.inputNames && neuralSession.inputNames.includes('orig_target_sizes')) {
        feeds.orig_target_sizes = new ort.Tensor('int64', new BigInt64Array([BigInt(pageWidth), BigInt(pageHeight)]), [1, 2]);
      }

      const neuralOutput = await neuralSession.run(feeds);

      let parsedNeural: ReturnType<typeof NeuralBubbleDetector.parseYolo11Output>;
      if (neuralOutput.output0) {
        parsedNeural = NeuralBubbleDetector.parseYolo11Output(
          neuralOutput.output0,
          pageWidth,
          pageHeight,
          inputSize,
          0.35,
          0.45,
          neuralOutput.output1
        );
      } else {
        parsedNeural = NeuralBubbleDetector.parseDetections(
          neuralOutput.labels.data as any,
          neuralOutput.boxes.data as any,
          neuralOutput.scores.data as any,
          0.30
        );
      }
      const detectedBubbles = parsedNeural.bubbles;
      console.log(`[Neural] Detected ${detectedBubbles.length} bubble proposals across image.`);

      // Pass 2: YOLO Box (raw bounding proposals)
      const neuralGeometry = acquireBubbleGeometry(rawImageData, boxes, detectedBubbles);

      const canvas = createCanvas(pageWidth, pageHeight);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(cleanedImage, 0, 0);
      if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready;
      const neuralTypesetBoxes = resolveLayouts(ctx, neuralGeometry);

      const textBlockItems: TextBlockItem[] = [];
      for (let i = 0; i < translatedTexts.length; i++) {
        const text = translatedTexts[i];
        const poly = polygons[i];
        if (text && poly) {
          const curv = neuralGeometry.curvatures?.[i];
          textBlockItems.push({
            text,
            polygon: poly,
            direction: ocrResult.directions ? ocrResult.directions[i] : 'h',
            typesetBox: neuralTypesetBoxes[i],
            fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
            angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
            originalText: texts[i],
            sourceLineCount: ocrResult.lineCounts ? ocrResult.lineCounts[i] : undefined,
            isRounded: curv?.isRounded,
            borderRadius: curv?.borderRadius,
            typesetMode: curv?.isRounded ? 'ellipse' : 'simple',
          });
        }
      }
      renderTextBlocksBatch(ctx as any, textBlockItems, 'en', { width: pageWidth, height: pageHeight });
      const outPath = path.join(neuralDir, testFile);
      fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
      console.log(`[Neural] Saved baked image: result/pipeline_bubble_neural/${testFile}`);

      // Pass 3: YOLO Smart Mask (neural-mask with morphological tail severing on AI mask)
      if (parsedNeural.items && parsedNeural.items.length > 0) {
        console.log(`\n--- [Pass 3] Tier 3 YOLO Smart Mask Expansion ---`);
        const neuralShapes: (any | undefined)[] = new Array(boxes.length).fill(undefined);

        for (let i = 0; i < boxes.length; i++) {
          const textBox = boxes[i];
          const matchedIdx = NeuralBubbleDetector.matchBubbleIndex(textBox, detectedBubbles);
          if (matchedIdx === -1) continue;

          const item = parsedNeural.items[matchedIdx];
          if (!item || !item.protoMask) continue;

          const { mask, pw, ph, px1, py1 } = item.protoMask;
          const minX = Math.round(px1 * (pageWidth / 256));
          const minY = Math.round(py1 * (pageHeight / 256));
          const origPatchW = Math.max(1, Math.round(pw * (pageWidth / 256)));
          const origPatchH = Math.max(1, Math.round(ph * (pageHeight / 256)));

          const scaleX = pw / origPatchW;
          const scaleY = ph / origPatchH;

          const textCenterX = Math.max(0, Math.min(pw - 1, Math.round((textBox.x + textBox.w / 2 - minX) * scaleX)));
          const textCenterY = Math.max(0, Math.min(ph - 1, Math.round((textBox.y + textBox.h / 2 - minY) * scaleY)));

          const avgScale = (scaleX + scaleY) / 2;
          const rErode = Math.max(3, Math.round(14 * avgScale));

          const severed = HeuristicBubbleExtractor.severTailOnBinaryMask(
            mask,
            pw,
            ph,
            textCenterX,
            textCenterY,
            rErode,
            origPatchW,
            origPatchH,
            minX,
            minY,
            scaleX,
            scaleY,
            false
          );

          if (severed) {
            neuralShapes[i] = {
              x: minX,
              y: minY,
              scale: avgScale,
              width: pw,
              height: ph,
              interior: mask,
              observedInterior: mask,
              eroded: severed.eroded,
              carrierBox: severed.carrier,
              isSeveredCarrier: true,
            };
          }
        }

        const maskGeometry = acquireBubbleGeometry(rawImageData, boxes, detectedBubbles, neuralShapes);
        const maskCanvas = createCanvas(pageWidth, pageHeight);
        const maskCtx = maskCanvas.getContext('2d');
        maskCtx.drawImage(cleanedImage, 0, 0);
        const maskTypesetBoxes = resolveLayouts(maskCtx, maskGeometry);

        const maskTextBlockItems: TextBlockItem[] = [];
        for (let i = 0; i < translatedTexts.length; i++) {
          const text = translatedTexts[i];
          const poly = polygons[i];
          if (text && poly) {
            const curv = maskGeometry.curvatures?.[i];
            maskTextBlockItems.push({
              text,
              polygon: poly,
              direction: ocrResult.directions ? ocrResult.directions[i] : 'h',
              typesetBox: maskTypesetBoxes[i],
              fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
              angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
              originalText: texts[i],
              sourceLineCount: ocrResult.lineCounts ? ocrResult.lineCounts[i] : undefined,
              isRounded: curv?.isRounded,
              borderRadius: curv?.borderRadius,
              typesetMode: curv?.isRounded ? 'ellipse' : 'simple',
            });
          }
        }
        renderTextBlocksBatch(maskCtx as any, maskTextBlockItems, 'en', { width: pageWidth, height: pageHeight });
        const maskOutPath = path.join(smartMaskDir, testFile);
        fs.writeFileSync(maskOutPath, maskCanvas.toBuffer('image/png'));
        console.log(`[SmartMask] Saved baked image: result/pipeline_bubble_smart_mask/${testFile}`);
      }
    }
  }

  await ocrManager.cleanup();
  await inpaintManager.cleanup();
  console.log('\n======================================================');
  console.log('--- Speech Bubble Visual Test Complete Successfully ---');
  console.log('Outputs:');
  console.log('  Heuristic  -> result/pipeline_bubble_heuristic/');
  console.log('  Neural     -> result/pipeline_bubble_neural/');
  console.log('  Smart Mask -> result/pipeline_bubble_smart_mask/');
  console.log('======================================================\n');
}

export { runPipelineVisualBubbleTest };

if (process.argv[1] && process.argv[1].endsWith('pipelineVisualBubbleTest.ts')) {
  runPipelineVisualBubbleTest()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[BubbleTest] Fatal error:', err);
      process.exit(1);
    });
}
