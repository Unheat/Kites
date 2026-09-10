import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from 'canvas';
import { OcrManager } from '../offscreen/services/OcrManager';
import { InpaintManager } from '../offscreen/services/InpaintManager';
import { CustomApiEngine } from '../offscreen/engines/translation/CustomApiEngine';
import { renderTextBlocksBatch, type TextBlockItem } from '../offscreen/utils/canvasTypesetting';
import type { Point2D } from '../shared/utils/geometry';
import type { CustomApiConfig } from '../shared/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_FILES = ['image1.jpg', 'image2.jpg', 'image3.jpg', 'image4.jpg', 'image5.png', 'image6.jpg', 'image7.jpg'];
const ENV_PATH = path.resolve(__dirname, '../../scripts/.env');
const RESULT_DIR = path.resolve(process.cwd(), 'result/pipeline_custom_api');

type TranslationLogEntry = { file: string; source: string; translated: string };

/**
 * Reads one secret from the git-ignored scripts/.env file.
 * @param key - Environment key to read.
 * @returns Trimmed secret value.
 */
function readIgnoredEnvKey(key: string): string {
  if (!fs.existsSync(ENV_PATH)) throw new Error(`Missing ignored environment file: ${ENV_PATH}`);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = fs.readFileSync(ENV_PATH, 'utf8').match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.+?)\\s*$`, 'm'));
  const value = match?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!value) throw new Error(`${key} is missing from ${ENV_PATH}`);
  return value;
}

/**
 * Runs the seven-image OCR, simple-inpaint, translation, and render baseline.
 * @returns Promise resolved after all PNG outputs and translation logs are written.
 */
async function runPipelineVisualTestCustomApi(): Promise<void> {
  console.log('--- Starting End-to-End Pipeline Visual Test (Custom API: OpenRouter) ---');
  const testImgDir = path.join(__dirname, 'test-img');
  const ocrManager = new OcrManager();
  const inpaintManager = new InpaintManager();
  const translationLog: TranslationLogEntry[] = [];
  let generatedImageCount = 0;
  const customConfig: CustomApiConfig = {
    id: 'openrouter-visual-test',
    provider: 'openai-compatible',
    modelName: 'openrouter/free',
    apiKey: readIgnoredEnvKey('OPENROUTER_API_KEY'),
    baseUrl: 'https://openrouter.ai/api/v1',
  };
  const translator = new CustomApiEngine(customConfig);

  fs.rmSync(RESULT_DIR, { recursive: true, force: true });
  fs.mkdirSync(RESULT_DIR, { recursive: true });

  try {
    await translator.init();
    for (const testFile of TEST_FILES) {
      const imagePath = path.join(testImgDir, testFile);
      if (!fs.existsSync(imagePath)) throw new Error(`Missing baseline image: ${imagePath}`);
      const buffer = fs.readFileSync(imagePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
      const probe = await loadImage(buffer);
      const ocrResult = await ocrManager.processImage(arrayBuffer, 'v6-small', {
        sourceLang: 'ja', pageWidth: probe.width, pageHeight: probe.height,
      });
      const polygons = ocrResult.polygons as Point2D[][];
      if (!polygons?.length || !ocrResult.texts?.length) throw new Error(`OCR produced no text for ${testFile}`);

      const cleanedBuffer = await inpaintManager.eraseText(arrayBuffer, ocrResult.rawPolygons || polygons, 'simple');
      const translatedTexts = await translator.translate(ocrResult.texts, 'auto', 'en');
      if (translatedTexts.length !== ocrResult.texts.length || translatedTexts.some((text) => !text?.trim())) {
        throw new Error(`Translation failed or returned incomplete output for ${testFile}`);
      }
      ocrResult.texts.forEach((source, index) => {
        const entry = { file: testFile, source, translated: translatedTexts[index] };
        translationLog.push(entry);
        console.log(`[CustomApiTest] ${entry.file}: "${entry.source}" -> "${entry.translated}"`);
      });

      const image = await loadImage(Buffer.from(cleanedBuffer));
      const canvas = createCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const blocks: TextBlockItem[] = translatedTexts.map((text, index) => ({
        text,
        polygon: polygons[index],
        direction: ocrResult.directions?.[index] || 'h',
        fontSize: ocrResult.fontSizes?.[index],
        angle: ocrResult.angles?.[index],
        originalText: ocrResult.texts[index],
        sourceLineCount: ocrResult.lineCounts?.[index],
      }));
      renderTextBlocksBatch(context as any, blocks, 'en', { width: image.width, height: image.height });
      const outputName = `${path.parse(testFile).name}.png`;
      fs.writeFileSync(path.join(RESULT_DIR, outputName), canvas.toBuffer('image/png'));
      generatedImageCount += 1;
      console.log(`[CustomApiTest] Saved ${outputName}`);
    }
    fs.writeFileSync(path.join(RESULT_DIR, 'translation-log.json'), JSON.stringify(translationLog, null, 2));
    if (generatedImageCount === 0) throw new Error('Custom API visual test produced zero PNG outputs.');
  } finally {
    await Promise.allSettled([ocrManager.cleanup(), inpaintManager.cleanup(), translator.destroy?.() ?? Promise.resolve()]);
  }
}

runPipelineVisualTestCustomApi().catch((error) => {
  console.error('Custom API visual test failed:', error);
  process.exitCode = 1;
});
