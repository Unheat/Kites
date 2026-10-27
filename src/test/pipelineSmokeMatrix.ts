import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from 'canvas';
import { OcrManager } from '../offscreen/services/OcrManager';
import { InpaintManager } from '../offscreen/services/InpaintManager';
import { ColorManager } from '../offscreen/services/ColorManager';
import { GoogleTranslateEngine } from '../offscreen/engines/translation/GoogleTranslateEngine';
import { acquireBubbleGeometry, resolveBubbleLayouts, resolveBubbleLayoutsDetailed } from '../offscreen/services/BubbleLayoutService';
import {
  renderTextBlocksBatch,
  measureBubbleLayoutFontSize,
  type TextBlockItem,
  DEFAULT_RENDER_FONT_FAMILY,
} from '../offscreen/utils/canvasTypesetting';
import type { Point2D } from '../shared/utils/geometry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_IMG_DIR = path.join(__dirname, 'test-img');
const SMOKE_RESULT_DIR = path.join(__dirname, 'result', 'pipeline_smoke');

/**
 * Downloads a model from HuggingFace if absent on disk.
 */
async function ensureModelOnDisk(localRelPath: string, remoteUrl: string): Promise<string> {
  const fullPath = path.resolve(ROOT_DIR, localRelPath);
  if (fs.existsSync(fullPath)) return fullPath;

  console.log(`[SmokeRunner] Downloading ${path.basename(fullPath)} from ${remoteUrl}...`);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const res = await fetch(remoteUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Kites/1.2.3 CI',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Failed to download model from ${remoteUrl}: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(fullPath, buffer);
  console.log(`[SmokeRunner] Saved ${path.basename(fullPath)} (${(buffer.length / (1024 * 1024)).toFixed(1)} MB).`);
  return fullPath;
}

export async function runPipelineSmokeMatrix(): Promise<void> {
  console.log('===========================================================');
  console.log('--- Tier 2: Pipeline Smoke Test Matrix (Multi-Tier CPU) ---');
  console.log('===========================================================\n');

  if (fs.existsSync(SMOKE_RESULT_DIR)) {
    fs.rmSync(SMOKE_RESULT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(SMOKE_RESULT_DIR, { recursive: true });

  const ocrManager = new OcrManager();
  const inpaintManager = new InpaintManager();
  const colorManager = new ColorManager();
  const translator = new GoogleTranslateEngine();
  await translator.init();

  // Ensure neural color model is downloaded
  await ensureModelOnDisk(
    'src/test/models/color/manga-colorize-fp16.onnx',
    'https://huggingface.co/Faridzar/manga-colorization-v2-onnx/resolve/main/manga-colorize-fp16.onnx'
  );

  const testImageNames = ['image1.jpg', 'image8.png'];

  // -------------------------------------------------------------
  // Combo 1: Baseline Fast (OCR + Simple Inpaint + Default Typeset)
  // -------------------------------------------------------------
  console.log('\n--- [Combo 1] Baseline Fast (v6-small + Simple Inpaint + Diamond Typeset) ---');
  for (const imgName of testImageNames) {
    const imgPath = path.join(TEST_IMG_DIR, imgName);
    const buffer = fs.readFileSync(imgPath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const probe = await loadImage(buffer);

    const ocrResult = await ocrManager.processImage(arrayBuffer, 'v6-small', {
      sourceLang: imgName === 'image8.png' ? undefined : 'ja',
      pageWidth: probe.width,
      pageHeight: probe.height,
    });
    if (!ocrResult.texts || ocrResult.texts.length === 0) {
      throw new Error(`[Combo 1] OCR failed to detect text in ${imgName}`);
    }
    console.log(`  ${imgName}: OCR detected ${ocrResult.texts.length} text blocks.`);

    const inpaintPolygons = (ocrResult.rawPolygons || ocrResult.polygons || []) as Point2D[][];
    const cleaned = await inpaintManager.eraseText(arrayBuffer, inpaintPolygons, 'simple');
    if (cleaned.byteLength < 5000) {
      throw new Error(`[Combo 1] Inpaint returned invalid buffer (${cleaned.byteLength} bytes)`);
    }

    const translated = await translator.translate(ocrResult.texts, 'auto', 'en');
    const cleanImg = await loadImage(Buffer.from(cleaned));
    const canvas = createCanvas(cleanImg.width, cleanImg.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cleanImg, 0, 0);

    const items: TextBlockItem[] = [];
    for (let i = 0; i < translated.length; i++) {
      if (translated[i] && ocrResult.polygons?.[i]) {
        items.push({
          text: translated[i],
          polygon: ocrResult.polygons[i] as any,
          direction: ocrResult.directions ? ocrResult.directions[i] : 'h',
          fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
          angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
          originalText: ocrResult.texts[i],
        });
      }
    }
    const rendered = renderTextBlocksBatch(ctx as any, items, 'en', { width: cleanImg.width, height: cleanImg.height });
    if (rendered.filter(Boolean).length === 0) {
      throw new Error(`[Combo 1] Failed to render text blocks for ${imgName}`);
    }

    const outPath = path.join(SMOKE_RESULT_DIR, `combo1_baseline_${imgName}.png`);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`  ✅ Passed: saved ${path.basename(outPath)} (${(canvas.toBuffer('image/png').length / 1024).toFixed(1)} KB)`);
  }

  // -----------------------------------------------------------------
  // Combo 2: Morphology & Telea Inpaint (FMM + Heuristic Bubble Carrier)
  // -----------------------------------------------------------------
  console.log('\n--- [Combo 2] Advanced Inpaint & Carrier (v6-small + Telea FMM + Heuristic Bubble) ---');
  {
    const imgName = 'image1.jpg';
    const imgPath = path.join(TEST_IMG_DIR, imgName);
    const buffer = fs.readFileSync(imgPath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const probe = await loadImage(buffer);

    const ocrResult = await ocrManager.processImage(arrayBuffer, 'v6-small', {
      sourceLang: 'ja',
      pageWidth: probe.width,
      pageHeight: probe.height,
    });
    const inpaintPolygons = (ocrResult.rawPolygons || ocrResult.polygons || []) as Point2D[][];

    // Telea Inpainting (FMM)
    const startTelea = performance.now();
    const cleaned = await inpaintManager.eraseText(arrayBuffer, inpaintPolygons, 'telea');
    console.log(`  Telea inpainting completed in ${(performance.now() - startTelea).toFixed(1)}ms (${cleaned.byteLength} bytes).`);
    if (cleaned.byteLength < 5000) throw new Error('[Combo 2] Telea inpaint returned invalid buffer');

    // Heuristic speech bubble extraction
    const rawCanvas = createCanvas(probe.width, probe.height);
    const rawCtx = rawCanvas.getContext('2d');
    rawCtx.drawImage(probe, 0, 0);
    const imgData = rawCtx.getImageData(0, 0, probe.width, probe.height);

    const bubbleGeom = acquireBubbleGeometry(
      { data: imgData.data, width: probe.width, height: probe.height },
      ocrResult.boxes
    );
    console.log(`  Heuristic carrier extraction completed for ${bubbleGeom.carriers.length} bubbles.`);

    const translated = await translator.translate(ocrResult.texts, 'auto', 'en');
    const cleanImg = await loadImage(Buffer.from(cleaned));
    const canvas = createCanvas(cleanImg.width, cleanImg.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cleanImg, 0, 0);

    const items: TextBlockItem[] = translated.map((text, i) => ({
      text,
      polygon: (ocrResult.polygons?.[i] || []) as any,
      direction: 'h',
      fontSize: ocrResult.fontSizes?.[i],
      originalText: ocrResult.texts[i],
    }));

    const typesetBoxes = resolveBubbleLayouts({
      ...bubbleGeom,
      boxes: ocrResult.boxes,
      pageWidth: probe.width,
      pageHeight: probe.height,
      accept: (index, proposed) => {
        const block = items[index];
        if (!block) return false;
        return measureBubbleLayoutFontSize(ctx as any, block, proposed, DEFAULT_RENDER_FONT_FAMILY, false, 'en') > 0;
      },
    });
    items.forEach((item, i) => {
      item.typesetBox = typesetBoxes[i];
    });

    renderTextBlocksBatch(ctx as any, items, 'en', { width: cleanImg.width, height: cleanImg.height });
    const outPath = path.join(SMOKE_RESULT_DIR, `combo2_telea_heuristic_${imgName}.png`);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`  ✅ Passed: saved ${path.basename(outPath)}`);
  }

  // -----------------------------------------------------------------
  // Combo 3: Koharu Contour DP Typeset & Curvature (2D Scanline DP Solver)
  // -----------------------------------------------------------------
  console.log('\n--- [Combo 3] Koharu Contour DP Typeset & Curvature (2D Scanline DP Solver) ---');
  {
    const imgName = 'image1.jpg';
    const imgPath = path.join(TEST_IMG_DIR, imgName);
    const buffer = fs.readFileSync(imgPath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const probe = await loadImage(buffer);

    const rawCanvas = createCanvas(probe.width, probe.height);
    const rawCtx = rawCanvas.getContext('2d');
    rawCtx.drawImage(probe, 0, 0);
    const imgData = rawCtx.getImageData(0, 0, probe.width, probe.height);

    const ocrResult = await ocrManager.processImage(arrayBuffer, 'v6-small', {
      sourceLang: 'ja',
      pageWidth: probe.width,
      pageHeight: probe.height,
    });
    const cleaned = await inpaintManager.eraseText(arrayBuffer, ocrResult.polygons as any, 'simple');
    const translated = await translator.translate(ocrResult.texts, 'auto', 'en');

    const bubbleGeom = acquireBubbleGeometry(
      { data: imgData.data, width: probe.width, height: probe.height },
      ocrResult.boxes
    );

    const cleanImg = await loadImage(Buffer.from(cleaned));
    const canvas = createCanvas(cleanImg.width, cleanImg.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cleanImg, 0, 0);

    const items: TextBlockItem[] = translated.map((text, i) => ({
      text,
      polygon: (ocrResult.polygons?.[i] || []) as any,
      direction: ocrResult.directions ? ocrResult.directions[i] : 'h',
      fontSize: ocrResult.fontSizes?.[i],
      originalText: ocrResult.texts[i],
    }));

    const detailed = resolveBubbleLayoutsDetailed({
      ...bubbleGeom,
      boxes: ocrResult.boxes,
      directions: ocrResult.directions,
      angles: ocrResult.angles,
      pageWidth: probe.width,
      pageHeight: probe.height,
      accept: (index, proposed) => {
        const block = items[index];
        if (!block) return false;
        const curv = bubbleGeom?.curvatures?.[index];
        const blockWithCurv = curv?.isRounded
          ? { ...block, isRounded: true, borderRadius: curv.borderRadius, typesetMode: 'contour' as const }
          : { ...block, isRounded: false, borderRadius: 0, typesetMode: 'simple' as const };
        return measureBubbleLayoutFontSize(ctx as any, blockWithCurv, proposed, DEFAULT_RENDER_FONT_FAMILY) > 0;
      },
    });

    items.forEach((item, i) => {
      item.typesetBox = detailed.typesetBoxes[i];
      item.contourPoints = detailed.contourPoints[i];
      const curv = bubbleGeom?.curvatures?.[i];
      if (curv) {
        item.isRounded = curv.isRounded;
        item.borderRadius = curv.borderRadius;
        item.typesetMode = curv.isRounded ? 'contour' : 'simple';
      }
    });

    const renderInfos = renderTextBlocksBatch(ctx as any, items, 'en', { width: cleanImg.width, height: cleanImg.height });
    if (renderInfos.filter(Boolean).length === 0) {
      throw new Error('[Combo 3] Contour DP typesetting produced 0 rendered blocks');
    }

    const outPath = path.join(SMOKE_RESULT_DIR, `combo3_contour_dp_${imgName}.png`);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`  ✅ Passed: saved ${path.basename(outPath)} (Koharu contour DP fitted without overflow)`);
  }

  // -----------------------------------------------------------------
  // Combo 4: Manga Colorization + Background Sampling
  // -----------------------------------------------------------------
  console.log('\n--- [Combo 4] Neural Manga Colorization (manga-colorization-v2 + CIELAB L* Fusion) ---');
  {
    const imgName = 'image1.jpg';
    const imgPath = path.join(TEST_IMG_DIR, imgName);
    const buffer = fs.readFileSync(imgPath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const probe = await loadImage(buffer);

    const ocrResult = await ocrManager.processImage(arrayBuffer, 'v6-small', {
      sourceLang: 'ja',
      pageWidth: probe.width,
      pageHeight: probe.height,
    });

    const startColor = performance.now();
    const colorized = await colorManager.colorize(
      arrayBuffer,
      undefined,
      'manga-colorization-v2',
      undefined,
      { targetSize: 576 }
    );
    console.log(`  Colorization completed in ${(performance.now() - startColor).toFixed(1)}ms (${colorized.byteLength} bytes).`);
    if (colorized.byteLength < 10000) {
      throw new Error('[Combo 4] Colorization returned invalid buffer');
    }

    const inpaintPolygons = (ocrResult.rawPolygons || ocrResult.polygons || []) as Point2D[][];
    const cleaned = await inpaintManager.eraseText(colorized, inpaintPolygons, 'simple');

    const cleanImg = await loadImage(Buffer.from(cleaned));
    const canvas = createCanvas(cleanImg.width, cleanImg.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cleanImg, 0, 0);

    const translated = await translator.translate(ocrResult.texts, 'auto', 'en');
    const items: TextBlockItem[] = translated.map((text, i) => ({
      text,
      polygon: (ocrResult.polygons?.[i] || []) as any,
      direction: 'h',
      fontSize: ocrResult.fontSizes?.[i],
      originalText: ocrResult.texts[i],
    }));

    renderTextBlocksBatch(ctx as any, items, 'en', { width: cleanImg.width, height: cleanImg.height });
    const outPath = path.join(SMOKE_RESULT_DIR, `combo4_colorized_${imgName}.png`);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`  ✅ Passed: saved ${path.basename(outPath)}`);
  }

  await ocrManager.cleanup();
  await inpaintManager.cleanup();
  await colorManager.destroy();

  console.log('\n===========================================================');
  console.log('✅ ALL 4 PIPELINE TIER SMOKE COMBINATIONS PASSED CLEANLY!');
  console.log(`Outputs: ${SMOKE_RESULT_DIR}/`);
  console.log('===========================================================\n');
}

// Auto-run if executed directly via npx tsx
if (process.argv[1] && process.argv[1].endsWith('pipelineSmokeMatrix.ts')) {
  runPipelineSmokeMatrix()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ [SmokeRunner] Fatal Pipeline Smoke Error:', err);
      process.exit(1);
    });
}
