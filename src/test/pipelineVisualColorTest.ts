import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { OcrManager } from '../offscreen/services/OcrManager';
import { InpaintManager } from '../offscreen/services/InpaintManager';
import { ColorManager } from '../offscreen/services/ColorManager';
import { GoogleTranslateEngine } from '../offscreen/engines/translation/GoogleTranslateEngine';
import { renderTextBlocksBatch, type TextBlockItem } from '../offscreen/utils/canvasTypesetting';
import { createCanvas, loadImage } from 'canvas';
import type { Point2D } from '../shared/utils/geometry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runPipelineVisualColorTest() {
  console.log('--- Starting Manga Colorization Visual Test ---');

  const testImgDir = path.join(__dirname, 'test-img');
  const resultBaseDir = path.join(__dirname, 'result', 'pipeline_color');

  if (fs.existsSync(resultBaseDir)) {
    fs.rmSync(resultBaseDir, { recursive: true, force: true });
  }
  fs.mkdirSync(resultBaseDir, { recursive: true });

  const colorModelPath = path.resolve(process.cwd(), 'src/test/models/color/manga-colorize-fp16.onnx');
  if (!fs.existsSync(colorModelPath)) {
    console.log(`[ColorTest] Downloading manga-colorize-fp16.onnx from HuggingFace...`);
    fs.mkdirSync(path.dirname(colorModelPath), { recursive: true });
    const res = await fetch('https://huggingface.co/Faridzar/manga-colorization-v2-onnx/resolve/main/manga-colorize-fp16.onnx', { redirect: 'follow' });
    if (!res.ok) throw new Error(`Failed to download color model: HTTP ${res.status}`);
    fs.writeFileSync(colorModelPath, Buffer.from(await res.arrayBuffer()));
    console.log(`[ColorTest] Model downloaded successfully.`);
  }

  const ocrManager = new OcrManager();
  const inpaintManager = new InpaintManager();
  const colorManager = new ColorManager();
  const translator = new GoogleTranslateEngine();
  await translator.init();

  const testFiles = ['image1.jpg', 'image2.jpg', 'image3.jpg', 'image6.jpg', 'image8.png'];

  for (const testFile of testFiles) {
    console.log(`\n================================`);
    console.log(`Processing Colorization Test: ${testFile}`);
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

    // 1. OCR Detection (Runs on original high-contrast B&W image)
    console.log('[ColorTest] 1. Running OCR detection on B&W image...');
    const sourceLang = testFile === 'image8.png' ? undefined : 'ja';
    const ocrResult = await ocrManager.processImage(arrayBuffer, 'v6-small', { sourceLang, pageWidth, pageHeight });
    const polygons = (ocrResult.polygons || []) as Point2D[][];
    const texts = ocrResult.texts || [];

    if (!polygons || polygons.length === 0) {
      console.warn(`[ColorTest] No text polygons detected in ${testFile}. Skipping.`);
      continue;
    }
    console.log(`[ColorTest] Detected ${polygons.length} text blocks.`);

    // 2. Manga Colorization (Runs on raw B&W image BEFORE inpainting)
    console.log('[ColorTest] 2. Running Neural Manga Colorization on raw image (manga-colorization-v2)...');
    const colorStart = performance.now();
    const colorizedBuffer = await colorManager.colorize(
      arrayBuffer,
      undefined,
      'manga-colorization-v2',
      undefined,
      { targetSize: 576 }
    );
    const colorDuration = (performance.now() - colorStart).toFixed(2);
    console.log(`[ColorTest] Colorization complete in ${colorDuration}ms.`);

    const colorImgPath = path.join(resultBaseDir, `${path.parse(testFile).name}_colorized.png`);
    fs.writeFileSync(colorImgPath, Buffer.from(colorizedBuffer));
    console.log(`[ColorTest] Saved colorized image to: ${colorImgPath}`);

    // 3. Inpainting (erasing Japanese text ON the colorized image)
    console.log('[ColorTest] 3. Erasing text with inpainting (sampling colored background)...');
    const inpaintPolygons = ocrResult.rawPolygons || polygons;
    const cleanedBuffer = await inpaintManager.eraseText(colorizedBuffer, inpaintPolygons, 'simple');

    const cleanImgPath = path.join(resultBaseDir, `${path.parse(testFile).name}_clean.png`);
    fs.writeFileSync(cleanImgPath, Buffer.from(cleanedBuffer));
    console.log(`[ColorTest] Saved cleaned inpainted image to: ${cleanImgPath}`);

    // 4. Translation
    console.log('[ColorTest] 4. Translating text to English...');
    let translatedTexts: string[];
    try {
      translatedTexts = await translator.translate(texts, 'auto', 'en');
    } catch (err) {
      console.warn('[ColorTest] Translation failed, using source texts:', err);
      translatedTexts = texts;
    }

    // 5. Typesetting onto clean inpainted color canvas
    console.log('[ColorTest] 5. Typesetting translated text onto colorized canvas...');
    const cleanImg = await loadImage(Buffer.from(cleanedBuffer));
    const canvas = createCanvas(cleanImg.width, cleanImg.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cleanImg, 0, 0);

    const textBlockItems: TextBlockItem[] = [];
    for (let i = 0; i < translatedTexts.length; i++) {
      const text = translatedTexts[i];
      const poly = polygons[i];
      const dir = ocrResult.directions ? ocrResult.directions[i] : 'h';
      if (text && poly) {
        textBlockItems.push({
          text,
          polygon: poly as any,
          direction: dir,
          fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
          angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
          originalText: ocrResult.texts[i],
          sourceLineCount: ocrResult.lineCounts ? ocrResult.lineCounts[i] : undefined,
        });
      }
    }

    renderTextBlocksBatch(
      ctx as any,
      textBlockItems,
      'en',
      { width: cleanImg.width, height: cleanImg.height },
      'Wild Words, CC Wild Words, Anime Ace, sans-serif',
      false
    );

    const finalPath = path.join(resultBaseDir, `${path.parse(testFile).name}_final.png`);
    fs.writeFileSync(finalPath, canvas.toBuffer('image/png'));
    console.log(`[ColorTest] Saved final colorized result to: ${finalPath}`);
  }

  console.log('\n--- Manga Colorization Visual Test Completed Successfully! ---');
}

// Auto-run if executed directly via npx tsx
if (process.argv[1] && process.argv[1].endsWith('pipelineVisualColorTest.ts')) {
  runPipelineVisualColorTest()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[ColorTest] Fatal Error:', err);
      process.exit(1);
    });
}
