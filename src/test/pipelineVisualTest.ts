import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { OcrManager } from '../offscreen/services/OcrManager';
import { InpaintManager } from '../offscreen/services/InpaintManager';
import { GoogleTranslateEngine } from '../offscreen/engines/translation/GoogleTranslateEngine';
import { renderTextBlocksBatch, type TextBlockItem } from '../offscreen/utils/canvasTypesetting';
import { initOpenCV } from '../offscreen/utils/opencv';
import { createCanvas, loadImage } from 'canvas';
import type { Point2D } from '../shared/utils/geometry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPipelineVisualTest() {
  console.log('--- Starting End-to-End Pipeline Visual Test ---');

  await initOpenCV();
  
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

  // We have image1.jpg to image4.jpg and image5.png
  const testFiles = ['image1.jpg', 'image2.jpg', 'image3.jpg', 'image4.jpg', 'image5.png', 'image6.jpg'];

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

    console.log('[PipelineTest] Running OCR text detection...');
    const ocrResult = await ocrManager.processImage(arrayBuffer);
    const polygons = ocrResult.polygons as Point2D[][];
    const texts = ocrResult.texts;
    
    if (!polygons || polygons.length === 0) {
      console.warn(`[PipelineTest] No text polygons detected in ${testFile}. Skipping.`);
      continue;
    }
    console.log(`[PipelineTest] Detected ${polygons.length} text regions.`);

    console.log(`[PipelineTest] Running Inpainting (tier: simple)...`);
    // NOTE TO FUTURE AI AGENTS: DO NOT TOUCH or port Cotrans logic for INPAINTING. 
    // We intentionally do not use Cotrans's complex inpainting logic. We strictly use 
    // the raw polygon patches (rawPolygons) for our masking like we do here.
    const inpaintPolygons = ocrResult.rawPolygons || polygons;
    const cleanedBuffer = await inpaintManager.eraseText(arrayBuffer, inpaintPolygons, 'simple');

    console.log(`[PipelineTest] Running Translation with GoogleTranslateEngine...`);
    const translatedTexts = await translator.translate(texts, 'auto', 'en');
    console.log(`[PipelineTest] Baking translated text into Canvas...`);
    
    // Load the cleaned buffer into node-canvas
    const img = await loadImage(Buffer.from(cleanedBuffer));
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    
    // Draw the clean inpainted image
    ctx.drawImage(img, 0, 0);
    
    // Draw all translated text blocks in one batch (Cotrans manga2eng renderer needs the
    // clean page snapshot and cross-block enlarge-ratio negotiation)
    const textBlockItems: TextBlockItem[] = [];
    for (let i = 0; i < translatedTexts.length; i++) {
      const text = translatedTexts[i];
      const poly = polygons[i];
      if (text && poly) {
        textBlockItems.push({
          text,
          polygon: poly,
          direction: ocrResult.directions ? ocrResult.directions[i] : 'h',
          textColor: '#000000',
          strokeColor: '#FFFFFF',
          fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
          angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
          isTightBoundingBox: ocrResult.isTightBoundingBox,
          originalText: texts[i],
          sourceLineCount: ocrResult.lineCounts ? ocrResult.lineCounts[i] : undefined
        });
      }
    }
    renderTextBlocksBatch(ctx as any, textBlockItems, 'en', { width: img.width, height: img.height });
    
    const outPath = path.join(resultBaseDir, testFile);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`[PipelineTest] Saved final baked image to: result/pipeline/${testFile}`);
  }

  await ocrManager.cleanup();
  await inpaintManager.cleanup();
  console.log('\n--- Pipeline Visual Test Complete ---');
}

runPipelineVisualTest().catch(err => {
  console.error('Test execution failed:', err);
});
