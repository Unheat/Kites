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

  // Ensure result directories exist and clean stale outputs
  [heuristicDir, neuralDir].forEach((dir) => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
  });

  const ocrManager = new OcrManager();
  const inpaintManager = new InpaintManager();
  const translator = new GoogleTranslateEngine();
  await translator.init();

  // Load Neural Bubble Detector model if available in models/
  const neuralModelPath = path.resolve(process.cwd(), 'models/detector-v4-s_int8.onnx');
  let neuralSession: any = null;
  if (fs.existsSync(neuralModelPath)) {
    console.log(`[Neural] Loading ONNX detector from ${neuralModelPath}...`);
    try {
      neuralSession = await ort.InferenceSession.create(neuralModelPath);
      console.log('[Neural] ONNX detector session initialized successfully.');
    } catch (err) {
      console.warn('[Neural] Failed initializing ONNX session, neural tier will fallback to heuristic:', err);
    }
  } else {
    console.warn(`[Neural] Model not found at ${neuralModelPath}. Skipping neural tier.`);
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
        const block: TextBlockItem = {
          text: translatedTexts[index], polygon: polygons[index], fontSize: ocrResult.fontSizes?.[index],
          direction: ocrResult.directions?.[index], angle: ocrResult.angles?.[index],
          originalText: texts[index], sourceLineCount: ocrResult.lineCounts?.[index]
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
          textBlockItems.push({
            text,
            polygon: poly,
            direction: ocrResult.directions ? ocrResult.directions[i] : 'h',
            typesetBox: heuristicTypesetBoxes[i],
            fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
            angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
            originalText: texts[i],
            sourceLineCount: ocrResult.lineCounts ? ocrResult.lineCounts[i] : undefined
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
      const inputSize = 640;
      const resizeCanvas = createCanvas(inputSize, inputSize);
      const resizeCtx = resizeCanvas.getContext('2d');
      resizeCtx.drawImage(rawImage, 0, 0, inputSize, inputSize);
      const resizedImgData = resizeCtx.getImageData(0, 0, inputSize, inputSize).data;

      const floatData = NeuralBubbleDetector.preprocessImage(resizedImgData, inputSize);
      const tensorImages = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);
      const tensorSizes = new ort.Tensor('int64', new BigInt64Array([BigInt(pageWidth), BigInt(pageHeight)]), [1, 2]);

      const neuralOutput = await neuralSession.run({
        images: tensorImages,
        orig_target_sizes: tensorSizes
      });

      const { bubbles: detectedBubbles } = NeuralBubbleDetector.parseDetections(
        neuralOutput.labels.data as any,
        neuralOutput.boxes.data as any,
        neuralOutput.scores.data as any,
        0.30
      );
      console.log(`[Neural] Detected ${detectedBubbles.length} bubble proposals across image.`);

      const neuralGeometry = acquireBubbleGeometry(rawImageData, boxes, detectedBubbles);

      // Bake Neural Output
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
          textBlockItems.push({
            text,
            polygon: poly,
            direction: ocrResult.directions ? ocrResult.directions[i] : 'h',
            typesetBox: neuralTypesetBoxes[i],
            fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
            angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
            originalText: texts[i],
            sourceLineCount: ocrResult.lineCounts ? ocrResult.lineCounts[i] : undefined
          });
        }
      }
      renderTextBlocksBatch(ctx as any, textBlockItems, 'en', { width: pageWidth, height: pageHeight });
      const outPath = path.join(neuralDir, testFile);
      fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
      console.log(`[Neural] Saved baked image: result/pipeline_bubble_neural/${testFile}`);
    }
  }

  await ocrManager.cleanup();
  await inpaintManager.cleanup();
  console.log('\n======================================================');
  console.log('--- Speech Bubble Visual Test Complete Successfully ---');
  console.log('Outputs:');
  console.log('  Heuristic -> result/pipeline_bubble_heuristic/');
  console.log('  Neural    -> result/pipeline_bubble_neural/');
  console.log('======================================================\n');
}

runPipelineVisualBubbleTest().catch((err) => {
  console.error('Test execution failed:', err);
});
