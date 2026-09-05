import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { OcrManager } from '../offscreen/services/OcrManager';
import { InpaintManager } from '../offscreen/services/InpaintManager';
import { GoogleTranslateEngine } from '../offscreen/engines/translation/GoogleTranslateEngine';
import { renderTextBlocksBatch, type TextBlockItem } from '../offscreen/utils/canvasTypesetting';
import { createCanvas, loadImage } from 'canvas';
import type { Point2D } from '../shared/utils/geometry';

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

  // We have image1.jpg to image4.jpg and image5.png
  const testFiles = ['image1.jpg', 'image2.jpg', 'image3.jpg', 'image4.jpg', 'image5.png', 'image6.jpg', 'image7.jpg'];

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

    // Bake passes — one per renderer branch so every algorithm added since v1 has a
    // visible output:
    //   en  -> Cotrans default renderer: XianScan 4-pass fit, diamond wrap, page font
    //          baseline, background-adaptive color sampling, decollision
    //   ja  -> legacy vertical-CJK path: char stacking + vertical punctuation mapping
    //   ar  -> legacy RTL path: canvas-native bidi via ctx.direction
    const bakePasses: { lang: string; suffix: string }[] = [
      { lang: 'en', suffix: '' },
      { lang: 'ja', suffix: '.vertical' },
      { lang: 'ar', suffix: '.rtl' },
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

      // Load the cleaned buffer into node-canvas
      const img = await loadImage(Buffer.from(cleanedBuffer));
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');

      // Draw the clean inpainted image
      ctx.drawImage(img, 0, 0);

      // Draw all translated text blocks in one batch through the production renderer.
      const textBlockItems: TextBlockItem[] = [];
      for (let i = 0; i < translatedTexts.length; i++) {
        const text = translatedTexts[i];
        const poly = polygons[i];
        if (text && poly) {
          textBlockItems.push({
            text,
            polygon: poly,
            direction: ocrResult.directions ? ocrResult.directions[i] : 'h',
            // No explicit colors: renderTextBlocksBatch samples the cleaned page and
            // picks black/white text per background luminance (production path).
            fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
            angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
            originalText: texts[i],
            sourceLineCount: ocrResult.lineCounts ? ocrResult.lineCounts[i] : undefined
          });
        }
      }
      const renderInfos = renderTextBlocksBatch(ctx as any, textBlockItems, pass.lang, { width: img.width, height: img.height });

      // Make color sampling visible: summarize the picked text colors per pass.
      const rendered = renderInfos.filter(i => i !== null);
      const whiteTextCount = rendered.filter(i => i!.textColor === 'white').length;
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

runPipelineVisualTest().catch(err => {
  console.error('Test execution failed:', err);
});
