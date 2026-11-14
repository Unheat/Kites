import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { OcrManager } from '../offscreen/services/OcrManager';
import { InpaintManager } from '../offscreen/services/InpaintManager';
import { GoogleTranslateEngine } from '../offscreen/engines/translation/GoogleTranslateEngine';
import { renderTextBlocksBatch, type TextBlockItem } from '../offscreen/utils/canvasTypesetting';
import { createCanvas, loadImage } from 'canvas';
import type { Point2D } from '../shared/utils/geometry';
import { detectBlockTextColorsFromContext } from '../offscreen/utils/textColorDetection';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPipelineVisualTest() {
  console.log('--- Starting End-to-End Pipeline Visual Test ---');

  const testImgDir = path.join(__dirname, 'test-img');
  const resultBaseDir = path.join(__dirname, 'result', 'pipeline');

  if (fs.existsSync(resultBaseDir)) {
    fs.rmSync(resultBaseDir, { recursive: true, force: true });
  }
  fs.mkdirSync(resultBaseDir, { recursive: true });

  const ocrManager = new OcrManager();
  const inpaintManager = new InpaintManager();
  const translator = new GoogleTranslateEngine();
  await translator.init();

  const testFiles = ['image1.jpg', 'image2.jpg', 'image3.jpg', 'image4.jpg', 'image5.png', 'image6.jpg', 'image7.jpg', 'image8.png'];

  for (const testFile of testFiles) {
    console.log(`\n================================`);
    console.log(`Testing Image: ${testFile}`);
    console.log(`================================`);
    
    const imagePath = path.join(testImgDir, testFile);
    if (!fs.existsSync(imagePath)) {
      console.warn(`[Skip] Test image not found at: ${imagePath}`);
      continue;
    }

    const buffer = fs.readFileSync(imagePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const probeImage = await loadImage(buffer);
    const pageWidth = probeImage.width;
    const pageHeight = probeImage.height;

    // 1. Prepare raw canvas for pre-inpaint color detection and bubble geometry
    const rawCanvas = createCanvas(pageWidth, pageHeight);
    const rawCtx = rawCanvas.getContext('2d');
    rawCtx.drawImage(probeImage, 0, 0);

    // 2. OCR text detection with the DISABLED bubble tier: no ownership policy, so the whole page
    // merges as one bucket and every region renders through the plain rectangle path. Bubble-tier
    // behaviour is covered by pipelineVisualBubbleTest, which runs heuristic and neural passes.
    console.log('[PipelineTest] Running OCR text detection...');
    const sourceLang = (testFile === 'image8.png' || testFile === 'image5.png') ? undefined : 'ja';
    const ocrResult = await ocrManager.processImage(arrayBuffer, 'v6-small', { sourceLang, pageWidth, pageHeight });
    const polygons = ocrResult.polygons as Point2D[][];
    const texts = ocrResult.texts;
    const boxes = ocrResult.boxes;
    
    if (!polygons || polygons.length === 0) {
      console.warn(`[PipelineTest] No text polygons detected in ${testFile}. Skipping.`);
      continue;
    }
    console.log(`[PipelineTest] Detected ${polygons.length} text regions.`);

    // Preserved artwork keeps its ink; the harness renders like the product, so it is skipped too.
    const artworkIndices = new Set((ocrResult.artwork ?? []).map((item) => item.index));

    // 3. Pre-inpaint ink color detection (original artwork)
    const detectedColors = detectBlockTextColorsFromContext(rawCtx as any, boxes, pageWidth, pageHeight);

    // 4. Disabled tier: no bubble geometry, so the renderer uses the plain rectangle path.

    // 5. Inpainting (simple fill using raw polygons)
    console.log(`[PipelineTest] Running Inpainting (tier: simple)...`);
    const inpaintPolygons = ocrResult.rawPolygons || polygons;
    const cleanedBuffer = await inpaintManager.eraseText(arrayBuffer, inpaintPolygons, 'simple');

    // 6. Translation and Typesetting pass
    const bakePasses: { lang: string; suffix: string }[] = [
      { lang: 'en', suffix: '' },
    ];

    for (const pass of bakePasses) {
      console.log(`[PipelineTest] Pass '${pass.lang}': translating...`);
      let translatedTexts: string[];
      try {
        translatedTexts = await translator.translate(texts, 'auto', pass.lang);
      } catch (err) {
        console.warn(`[PipelineTest] Pass '${pass.lang}' translation failed, skipping bake:`, err);
        continue;
      }

      // Load cleaned buffer into canvas
      const img = await loadImage(Buffer.from(cleanedBuffer));
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // Build initial text block items
      const textBlockItems: TextBlockItem[] = [];
      const itemOcrIndices: number[] = [];

      for (let i = 0; i < translatedTexts.length; i++) {
        if (artworkIndices.has(i)) continue;
        const text = translatedTexts[i];
        const poly = polygons[i];
        if (text && poly) {
          const detectedColor = detectedColors[i];
          textBlockItems.push({
            text,
            polygon: poly,
            direction: ocrResult.directions ? ocrResult.directions[i] : 'h',
            textColor: detectedColor?.textColor,
            strokeColor: detectedColor?.strokeColor,
            fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
            angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
            originalText: texts[i],
            sourceLineCount: ocrResult.lineCounts ? ocrResult.lineCounts[i] : undefined
          });
          itemOcrIndices.push(i);
        }
      }

      // Disabled tier: no bubble geometry, so every region stays on the plain rectangle path.

      // Render all blocks through the production renderer
      const renderInfos = renderTextBlocksBatch(ctx as any, textBlockItems, pass.lang, { width: img.width, height: img.height });

      const rendered = renderInfos.filter((i) => i !== null);
      const whiteTextCount = rendered.filter((i) => i!.textColor === 'white').length;
      console.log(`[PipelineTest] Pass '${pass.lang}': ${rendered.length} blocks rendered, ${whiteTextCount} on dark backgrounds (white text).`);

      const outName = testFile.replace(/(\.\w+)$/, `${pass.suffix}$1`);
      const outPath = path.join(resultBaseDir, outName);
      fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
      console.log(`[PipelineTest] Saved baked image to: result/pipeline/${outName}`);
    }
  }

  await ocrManager.cleanup();
  await inpaintManager.cleanup();
  console.log('\n--- Pipeline Visual Test Complete ---');
}

export { runPipelineVisualTest };

if (process.argv[1] && process.argv[1].endsWith('pipelineVisualTest.ts')) {
  runPipelineVisualTest()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[PipelineTest] Fatal error:', err);
      process.exit(1);
    });
}
