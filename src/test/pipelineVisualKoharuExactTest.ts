import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { OcrManager } from '../offscreen/services/OcrManager';
import { InpaintManager } from '../offscreen/services/InpaintManager';
import { renderTextBlocksBatch, measureBubbleLayoutFontSize, type TextBlockItem } from '../offscreen/utils/canvasTypesetting';
import { createCanvas, loadImage, registerFont } from 'canvas';
import type { Point2D } from '../shared/utils/geometry';
import type { BoxRect } from '../offscreen/utils/bubbleExpansion';
import { NeuralBubbleDetector } from '../offscreen/engines/bubble/NeuralBubbleDetector';
import { acquireBubbleGeometry, resolveBubbleLayoutsDetailed } from '../offscreen/services/BubbleLayoutService';
import { HyphenationService } from '../offscreen/utils/hyphenation/HyphenationService';
import * as ort from 'onnxruntime-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register CC Wild Words font for 1:1 typographic parity with Koharu Desktop
const ccWildWordsPath = path.resolve(process.cwd(), 'scratches/reference/xianscan-rust/web/static/fonts/CCWildWords-Roman.ttf');
if (fs.existsSync(ccWildWordsPath)) {
  registerFont(ccWildWordsPath, { family: 'CCWildWords' });
  console.log('[Font] Registered CCWildWords from:', ccWildWordsPath);
}

// Semantic Koharu Desktop transcription mapping for image6.jpg
export function mapOcrTextToKoharuExact(text: string, box: BoxRect): string {
  if (text.includes('敌人太强')) return 'THE ENEMY IS TOO STRONG';
  if (text.includes('可恶')) return 'UGH...';
  if (text.includes('其他人') || text.includes('天老屯')) return "OTHER PEOPLE ARE ALSO STUCK IN THIS STATE WHERE THEY CAN'T FIGHT.";
  if (text.includes('这样下去')) return "THIS KEEPS HAPPENING: IT'S JUST LIKE THAT.";
  if (text.includes('危险') && box.y < 300) return 'NO WAY! THIS IS REALLY DANGEROUS!';
  if (text.includes('救兵') || text.includes('顶住')) return "I'M GOING TO TAKE THIS BURDEN MYSELF. PLEASE RETREAT QUICKLY AND SAVE THE SOLDIERS!!";
  if (text.includes('要想取胜')) return "IF YOU REALLY WANT TO WIN, THERE'S NO OTHER CHOICE.";
  if (text.includes('信我')) return 'TEACHER, PLEASE BELIEVE ME!';
  if (text.includes('老师') && box.y < 450 && box.x > 700) return 'TEACHER!!';
  if (text.includes('ボロ') || text.includes('ボ口')) return 'POOR...!';
  if (text.includes('我知道了')) return 'I GET IT NOW..';
  if (text.includes('勉强') || text.includes('勉強')) return "BUT PLEASE DON'T FORCE YOURSELF TOO MUCH!";
  if (text.includes('要是情况危险') || text.includes('要是情況')) return 'IN CASE THINGS GET DANGEROUS, YOU SHOULD ALL RETREAT IMMEDIATELY!';
  if (text.includes('明白')) return 'UN-DER-STOOD!';
  if (text.includes('全力')) return 'THIS IS WHEN WE REALLY PUSH OURSELVES!';
  if (text.includes('精神')) return "LET'S GET OUR SPIRITS BACK UP!";
  if (text.includes('莲实') || text.includes('蓮實') || text.includes('实！')) return 'LION! YOU HAVE TO GO!';
  if (text.includes('ギ') || text.includes('==') || text.includes('我==') || text.includes('找==')) return 'ギニニニ';
  return text;
}

async function runKoharuExactTest() {
  console.log('--- Starting Koharu Exact Text & Typography Visual Test ---');

  const testImgPath = path.join(__dirname, 'test-img/image6.jpg');
  const baseResultDir = path.join(__dirname, 'result');
  const outDir = path.join(baseResultDir, 'pipeline_bubble_neural');
  fs.mkdirSync(outDir, { recursive: true });

  const ocrManager = new OcrManager();
  const inpaintManager = new InpaintManager();

  // Register local filesystem pattern loader for Node test environment
  HyphenationService.setCustomLoader(async (dictName: string) => {
    const filePath = path.resolve(process.cwd(), 'public/assets/hyphenation', `${dictName}.txt`);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    return null;
  });
  await HyphenationService.getInstance().loadLanguage('en');

  const buffer = fs.readFileSync(testImgPath);
  const rawImage = await loadImage(buffer);
  const pageWidth = rawImage.width;
  const pageHeight = rawImage.height;

  // 1. OCR Stage (matches user browser tier: v6-medium)
  console.log('[Pipeline] Running OCR text detection with v6-medium...');
  const ocrResult = await ocrManager.processImage(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    'v6-medium',
    { sourceLang: 'ja', pageWidth, pageHeight }
  );
  const polygons = ocrResult.polygons as Point2D[][];
  const texts = ocrResult.texts;
  const boxes = ocrResult.boxes;

  // 2. Simple Inpainting
  console.log('[Pipeline] Running Inpainting (tier: simple)...');
  const cleanedBuffer = await inpaintManager.eraseText(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    ocrResult.rawPolygons || polygons,
    'simple'
  );
  const cleanedImage = await loadImage(Buffer.from(cleanedBuffer));

  // 3. Exact Koharu Texts mapped semantically
  const translatedTexts: string[] = texts.map((t, i) => mapOcrTextToKoharuExact(t, boxes[i]));

  // 4. Neural YOLO Bubble Detector
  const modelPath = path.resolve(process.cwd(), 'models/manga109_yolo11n_seg_1024.onnx');
  const neuralSession = await ort.InferenceSession.create(modelPath);

  const inputSize = 1024;
  const resizeCanvas = createCanvas(inputSize, inputSize);
  const resizeCtx = resizeCanvas.getContext('2d');
  resizeCtx.drawImage(rawImage, 0, 0, inputSize, inputSize);
  const resizedImgData = resizeCtx.getImageData(0, 0, inputSize, inputSize).data;
  const floatData = NeuralBubbleDetector.preprocessImage(resizedImgData, inputSize);
  const tensorImages = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);
  const neuralOutput = await neuralSession.run({ images: tensorImages });
  const parsedNeural = NeuralBubbleDetector.parseYolo11Output(
    neuralOutput.output0,
    pageWidth,
    pageHeight,
    inputSize,
    0.35,
    0.45,
    neuralOutput.output1
  );

  const neuralShapes: (any | undefined)[] = new Array(boxes.length).fill(undefined);
  for (let i = 0; i < boxes.length; i++) {
    const textBox = boxes[i];
    const matchedIdx = NeuralBubbleDetector.matchBubbleIndex(textBox, parsedNeural.bubbles);
    if (matchedIdx === -1) continue;

    const item = parsedNeural.items?.[matchedIdx];
    if (!item || !item.protoMask) continue;

    const { mask, pw, ph, px1, py1 } = item.protoMask;
    const minX = Math.round(px1 * (pageWidth / 256));
    const minY = Math.round(py1 * (pageHeight / 256));
    const origPatchW = Math.max(1, Math.round(pw * (pageWidth / 256)));
    const origPatchH = Math.max(1, Math.round(ph * (pageHeight / 256)));
    const scaleX = pw / origPatchW;
    const scaleY = ph / origPatchH;
    const avgScale = (scaleX + scaleY) / 2;

    neuralShapes[i] = {
      x: minX,
      y: minY,
      scale: avgScale,
      width: pw,
      height: ph,
      interior: mask,
      observedInterior: mask,
      eroded: mask,
      carrierBox: parsedNeural.bubbles[matchedIdx],
      isSeveredCarrier: false,
    };
  }

  const rawCanvas = createCanvas(pageWidth, pageHeight);
  const rawCtx = rawCanvas.getContext('2d');
  rawCtx.drawImage(rawImage, 0, 0);
  const rawImageData = rawCtx.getImageData(0, 0, pageWidth, pageHeight);

  const neuralGeometry = acquireBubbleGeometry(rawImageData, boxes, parsedNeural.bubbles, neuralShapes);

  const canvas = createCanvas(pageWidth, pageHeight);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(cleanedImage, 0, 0);

  const fontFamily = 'CCWildWords, sans-serif';

  const neuralLayout = resolveBubbleLayoutsDetailed({
    ...neuralGeometry,
    boxes,
    directions: ocrResult.directions,
    angles: ocrResult.angles,
    pageWidth,
    pageHeight,
    accept: (index, proposed) => {
      const curv = neuralGeometry.curvatures?.[index];
      const block: TextBlockItem = {
        text: translatedTexts[index],
        polygon: polygons[index],
        fontSize: ocrResult.fontSizes?.[index],
        direction: ocrResult.directions?.[index],
        angle: ocrResult.angles?.[index],
        originalText: texts[index],
        sourceLineCount: ocrResult.lineCounts?.[index],
        isRounded: curv?.isRounded,
        borderRadius: curv?.borderRadius,
        typesetMode: curv?.isRounded ? 'contour' : 'simple',
      };
      const fitted = measureBubbleLayoutFontSize(ctx as any, block, proposed, fontFamily, true);
      if (index === 15) {
        console.log(`[accept #15] proposed=${JSON.stringify(proposed)} fitted=${fitted}`);
      }
      return fitted > 0;
    },
    onDiagnostics: (counts) => console.log('[Bubble layouts]', counts)
  });

  const neuralTypesetBoxes = neuralLayout.typesetBoxes;
  const neuralContours = neuralLayout.contourPoints;

  console.log('DEBUG neuralContours #13 and #14:', {
    c13: neuralContours?.[13],
    c14: neuralContours?.[14],
  });

  const textBlockItems: TextBlockItem[] = [];
  for (let i = 0; i < translatedTexts.length; i++) {
    const text = translatedTexts[i];
    const poly = polygons[i];
    if (text && poly) {
      const typesetBox = neuralTypesetBoxes[i];
      const fixed = typesetBox !== undefined;
      const curv = fixed ? neuralGeometry.curvatures?.[i] : undefined;
      textBlockItems.push({
        text,
        polygon: poly,
        direction: ocrResult.directions ? ocrResult.directions[i] : 'h',
        typesetBox,
        fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
        angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
        originalText: texts[i],
        sourceLineCount: ocrResult.lineCounts ? ocrResult.lineCounts[i] : undefined,
        isRounded: fixed ? Boolean(curv?.isRounded) : false,
        borderRadius: fixed ? (curv?.borderRadius ?? 0) : 0,
        typesetMode: fixed ? (curv?.isRounded ? 'contour' : 'simple') : 'balloon',
        contourPoints: fixed ? neuralContours?.[i] : undefined,
      });
    }
  }

  const renderInfos = renderTextBlocksBatch(
    ctx as any,
    textBlockItems,
    'en',
    { width: pageWidth, height: pageHeight },
    fontFamily,
    true // isBold for comic dialogue
  );

  for (let i = 0; i < renderInfos.length; i++) {
    console.log(`[Koharu Exact #${i}] "${textBlockItems[i]?.text}" ->`, JSON.stringify(renderInfos[i]));
  }

  const outPath = path.join(outDir, 'image6_koharu_exact.png');
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log(`\n[Done] Saved baked image: ${outPath}`);

  await ocrManager.cleanup();
  await inpaintManager.cleanup();
}

runKoharuExactTest();
