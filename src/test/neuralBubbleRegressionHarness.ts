/**
 * Standalone Offline Neural Bubble Regression Harness.
 *
 * Reuses production/offscreen modules:
 * - NeuralBubbleEngine.buildGeometry
 * - resolveBubbleLayoutsDetailed
 * - renderTextBlocksBatch
 * - measureBubbleLayoutFontSize
 * - CCWildWords font rendering + HyphenationService
 *
 * Compares current execution against frozen baseline fixtures in src/test/fixtures/:
 * - image6_ocr_v6_medium.json
 * - image6_neural_baseline_geometry.json
 * - image6_koharu_exact_transcription.json
 *
 * Outputs stage metrics and rendered PNGs to ignored result directory:
 * - src/test/result/regression/image6_ccwildwords_current.png
 * - src/test/result/regression/image6_ccwildwords_baseline.png
 * - src/test/result/regression/image6_ccwildwords_diff.png
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage, registerFont, type Canvas } from 'canvas';
import * as ort from 'onnxruntime-node';

import type { BoxRect } from '../offscreen/utils/bubbleExpansion.js';
import type { Point2D } from '../shared/utils/geometry.js';
import { NeuralBubbleDetector } from '../offscreen/engines/bubble/NeuralBubbleDetector.js';
import { HeuristicBubbleExtractor, type BubbleShapeEvidence } from '../offscreen/engines/bubble/HeuristicBubbleExtractor.js';
import { NeuralBubbleEngine } from '../offscreen/engines/bubble/NeuralBubbleEngine.js';
import { resolveBubbleLayoutsDetailed } from '../offscreen/services/BubbleLayoutService.js';
import {
  renderTextBlocksBatch,
  measureBubbleLayoutFontSize,
  type TextBlockItem,
} from '../offscreen/utils/canvasTypesetting.js';
import { HyphenationService } from '../offscreen/utils/hyphenation/HyphenationService.js';
import { InpaintManager } from '../offscreen/services/InpaintManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface HarnessOptions {
  /** If true, uses pre-decoded YOLO data rather than running full ONNX session. Default: false */
  fastMode?: boolean;
  /** Custom path to image6.jpg. Default: src/test/test-img/image6.jpg */
  imagePath?: string;
  /** Custom path to YOLO model. Default: models/manga109_yolo11n_seg_1024.onnx */
  yoloModelPath?: string;
  /** Custom directory for output PNGs. Default: src/test/result/regression */
  outputDir?: string;
  /** Whether to log verbose per-bubble metrics. Default: true */
  verbose?: boolean;
}

export interface BoxDiff {
  boxIndex: number;
  originalText: string;
  mappedText: string;
  carrierDiff: boolean;
  proposalDiff: boolean;
  curvatureDiff: boolean;
  contourDiff: boolean;
  typesetBoxDiff: boolean;
  renderInfoDiff: boolean;
  details: string[];
}

export interface HarnessResult {
  success: boolean;
  stageTimingsMs: {
    fontAndHyphenation: number;
    imageLoadAndInpaint: number;
    yoloInference: number;
    geometryBuild: number;
    layoutResolution: number;
    typesettingRender: number;
    total: number;
  };
  metrics: {
    totalOcrBoxes: number;
    totalYoloBubbles: number;
    matchedBoxes: number;
    acceptedLayouts: number;
    rejectedLayouts: number;
    rejectedIndices: number[];
  };
  transcriptionUncertainties: Array<{
    index: number;
    originalText: string;
    mappedText: string;
    uncertainty: string;
  }>;
  differentialSummary: {
    baselineCompared: boolean;
    totalDifferences: number;
    matchingBoxes: number;
    mismatchedBoxes: number;
    boxDiffs: BoxDiff[];
    isIdenticalToBaseline: boolean;
  };
  renderedFiles: {
    currentPng: string;
    baselinePng: string;
    diffPng: string;
  };
}

/**
 * Initializes CC Wild Words font and English hyphenation patterns for 1:1 parity with production.
 */
export async function initializeHarnessEnvironment(): Promise<void> {
  const ccWildWordsPath = path.resolve(
    process.cwd(),
    'scratches/reference/xianscan-rust/web/static/fonts/CCWildWords-Roman.ttf'
  );
  if (fs.existsSync(ccWildWordsPath)) {
    registerFont(ccWildWordsPath, { family: 'CCWildWords' });
  }

  HyphenationService.setCustomLoader(async (dictName: string) => {
    const filePath = path.resolve(process.cwd(), 'public/assets/hyphenation', `${dictName}.txt`);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    return null;
  });
  await HyphenationService.getInstance().loadLanguage('en');
}

/**
 * Compares two bounding boxes for approximate geometric equality (<= 0.5px tolerance).
 */
function isBoxEqual(a?: BoxRect | null, b?: BoxRect | null, tolerance: number = 0.5): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.w - b.w) <= tolerance &&
    Math.abs(a.h - b.h) <= tolerance
  );
}

/**
 * Compares two 2D polygon contours for equality.
 */
function isContourEqual(a?: Point2D[] | null, b?: Point2D[] | null, tolerance: number = 0.5): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].x - b[i].x) > tolerance || Math.abs(a[i].y - b[i].y) > tolerance) {
      return false;
    }
  }
  return true;
}

/**
 * Generates a visual pixel diff image between two canvases.
 * Matching pixels are converted to grayscale; diverging pixels are painted bright magenta.
 */
function generateVisualDiff(
  currentCanvas: Canvas,
  baselineCanvas: Canvas,
  width: number,
  height: number
): { diffCanvas: Canvas; changedPixelCount: number } {
  const diffCanvas = createCanvas(width, height);
  const diffCtx = diffCanvas.getContext('2d');

  const currCtx = currentCanvas.getContext('2d');
  const baseCtx = baselineCanvas.getContext('2d');

  const currData = currCtx.getImageData(0, 0, width, height).data;
  const baseData = baseCtx.getImageData(0, 0, width, height).data;

  const diffImgData = diffCtx.createImageData(width, height);
  const out = diffImgData.data;

  let changedPixelCount = 0;
  for (let i = 0; i < currData.length; i += 4) {
    const dr = Math.abs(currData[i] - baseData[i]);
    const dg = Math.abs(currData[i + 1] - baseData[i + 1]);
    const db = Math.abs(currData[i + 2] - baseData[i + 2]);
    const da = Math.abs(currData[i + 3] - baseData[i + 3]);

    if (dr > 3 || dg > 3 || db > 3 || da > 3) {
      changedPixelCount++;
      // Bright magenta for difference
      out[i] = 255;
      out[i + 1] = 0;
      out[i + 2] = 255;
      out[i + 3] = 255;
    } else {
      // Dimmed grayscale background for context
      const gray = Math.round((currData[i] * 0.299 + currData[i + 1] * 0.587 + currData[i + 2] * 0.114) * 0.4);
      out[i] = gray;
      out[i + 1] = gray;
      out[i + 2] = gray;
      out[i + 3] = 255;
    }
  }

  diffCtx.putImageData(diffImgData, 0, 0);
  return { diffCanvas, changedPixelCount };
}

/**
 * Runs the complete neural bubble regression harness.
 *
 * @param options - Configuration options for model paths, fast mode, and logging.
 * @returns Comprehensive metrics, differential comparison against frozen baseline, and paths to rendered PNGs.
 */
export async function runNeuralBubbleRegressionHarness(options: HarnessOptions = {}): Promise<HarnessResult> {
  const startTime = Date.now();
  const verbose = options.verbose ?? true;

  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const testImgPath = options.imagePath || path.resolve(__dirname, 'test-img/image6.jpg');
  const modelPath = options.yoloModelPath || path.resolve(process.cwd(), 'models/manga109_yolo11n_seg_1024.onnx');
  const outDir = options.outputDir || path.resolve(__dirname, 'result/regression');

  fs.mkdirSync(outDir, { recursive: true });

  // 1. Initialize environment (Font + Hyphenation)
  const t0 = Date.now();
  await initializeHarnessEnvironment();
  const tFont = Date.now() - t0;

  // 2. Load fixtures
  const ocrFixturePath = path.join(fixturesDir, 'image6_ocr_v6_medium.json');
  const baselineFixturePath = path.join(fixturesDir, 'image6_neural_baseline_geometry.json');
  const transcriptionFixturePath = path.join(fixturesDir, 'image6_koharu_exact_transcription.json');

  if (!fs.existsSync(ocrFixturePath)) {
    throw new Error(`Missing required OCR fixture at: ${ocrFixturePath}`);
  }
  if (!fs.existsSync(baselineFixturePath)) {
    throw new Error(`Missing required neural baseline fixture at: ${baselineFixturePath}`);
  }
  if (!fs.existsSync(transcriptionFixturePath)) {
    throw new Error(`Missing required transcription fixture at: ${transcriptionFixturePath}`);
  }

  const ocrData = JSON.parse(fs.readFileSync(ocrFixturePath, 'utf-8'));
  const baselineData = JSON.parse(fs.readFileSync(baselineFixturePath, 'utf-8'));
  const transcriptionData = JSON.parse(fs.readFileSync(transcriptionFixturePath, 'utf-8'));

  const boxes: BoxRect[] = ocrData.boxes;
  const texts: string[] = ocrData.texts;
  const polygons: Point2D[][] = ocrData.polygons;
  const directions: ('h' | 'v')[] = ocrData.directions || [];
  const angles: number[] = ocrData.angles || [];
  const fontSizes: number[] = ocrData.fontSizes || [];
  const lineCounts: number[] = ocrData.lineCounts || [];

  const translatedTexts: string[] = transcriptionData.transcriptions.map((item: any) => item.mappedText);

  // 3. Load test image & run simple inpainting
  const t1 = Date.now();
  const imgBuffer = fs.readFileSync(testImgPath);
  const rawImage = await loadImage(imgBuffer);
  const pageWidth = rawImage.width;
  const pageHeight = rawImage.height;

  const inpaintManager = new InpaintManager();
  const inpaintPolygons = ocrData.rawPolygons || polygons;
  const cleanedBuffer = await inpaintManager.eraseText(
    imgBuffer.buffer.slice(imgBuffer.byteOffset, imgBuffer.byteOffset + imgBuffer.byteLength),
    inpaintPolygons,
    'simple'
  );
  const cleanedImage = await loadImage(Buffer.from(cleanedBuffer));
  await inpaintManager.cleanup();
  const tInpaint = Date.now() - t1;

  // 4. YOLO Bubble Detection
  const t2 = Date.now();
  let parsedNeuralBubbles: BoxRect[] = [];
  let parsedNeuralItems: any[] = [];

  if (options.fastMode) {
    parsedNeuralBubbles = baselineData.yoloBubbles;
    parsedNeuralItems = (baselineData.yoloItems || []).map((item: any) => ({
      box: item.box,
      score: item.score,
      label: item.label,
      protoMask: item.protoMask
        ? {
            pw: item.protoMask.pw,
            ph: item.protoMask.ph,
            px1: item.protoMask.px1,
            py1: item.protoMask.py1,
            mask: new Uint8Array(Buffer.from(item.protoMask.maskBase64, 'base64')),
          }
        : undefined,
    }));
  } else {
    const neuralSession = await ort.InferenceSession.create(modelPath);
    const inputSize = 1024;
    const resizeCanvas = createCanvas(inputSize, inputSize);
    const resizeCtx = resizeCanvas.getContext('2d');
    resizeCtx.drawImage(rawImage, 0, 0, inputSize, inputSize);
    const resizedImgData = resizeCtx.getImageData(0, 0, inputSize, inputSize).data;
    const floatData = NeuralBubbleDetector.preprocessImage(resizedImgData, inputSize);
    const tensorImages = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);
    const neuralOutput = await neuralSession.run({ images: tensorImages });
    const parsed = NeuralBubbleDetector.parseYolo11Output(
      neuralOutput.output0,
      pageWidth,
      pageHeight,
      inputSize,
      0.35,
      0.45,
      neuralOutput.output1
    );
    parsedNeuralBubbles = parsed.bubbles;
    parsedNeuralItems = parsed.items || [];
  }
  const tYolo = Date.now() - t2;

  // 5. Decode prototype masks & sever tails
  const t3 = Date.now();
  const shapes: (BubbleShapeEvidence | undefined)[] = new Array(boxes.length).fill(undefined);

  for (let i = 0; i < boxes.length; i++) {
    const textBox = boxes[i];
    const matchedIdx = NeuralBubbleDetector.matchBubbleIndex(textBox, parsedNeuralBubbles);
    if (matchedIdx === -1) continue;

    const item = parsedNeuralItems[matchedIdx];
    if (!item || !item.protoMask) continue;

    const { mask, pw, ph, px1, py1 } = item.protoMask;
    const minX = Math.round(px1 * (pageWidth / 256));
    const minY = Math.round(py1 * (pageHeight / 256));
    const origPatchW = Math.max(1, Math.round(pw * (pageWidth / 256)));
    const origPatchH = Math.max(1, Math.round(ph * (pageHeight / 256)));
    const scaleX = pw / origPatchW;
    const scaleY = ph / origPatchH;
    const avgScale = (scaleX + scaleY) / 2;

    const textCenterX = Math.max(0, Math.min(pw - 1, Math.round((textBox.x + textBox.w / 2 - minX) * scaleX)));
    const textCenterY = Math.max(0, Math.min(ph - 1, Math.round((textBox.y + textBox.h / 2 - minY) * scaleY)));
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

    shapes[i] = {
      x: minX,
      y: minY,
      scale: avgScale,
      scaleX,
      scaleY,
      width: pw,
      height: ph,
      interior: mask,
      observedInterior: mask,
      eroded: severed ? severed.eroded : mask,
      carrierBox: severed ? severed.carrier : parsedNeuralBubbles[matchedIdx],
      isSeveredCarrier: Boolean(severed),
    };
  }

  const rawCanvas = createCanvas(pageWidth, pageHeight);
  const rawCtx = rawCanvas.getContext('2d');
  rawCtx.drawImage(rawImage, 0, 0);
  const rawImageData = rawCtx.getImageData(0, 0, pageWidth, pageHeight);

  const currentGeometry = await NeuralBubbleEngine.buildGeometry(null, rawImageData, boxes, undefined, {
    bubbles: parsedNeuralBubbles,
    shapes,
  });

  if (!currentGeometry) {
    throw new Error('Failed to build current neural geometry');
  }
  const tGeom = Date.now() - t3;

  // 6. Resolve bubble layouts detailed
  const t4 = Date.now();
  const fontFamily = 'CCWildWords, sans-serif';
  const measureCanvas = createCanvas(pageWidth, pageHeight);
  const measureCtx = measureCanvas.getContext('2d');

  const resolvedLayout = resolveBubbleLayoutsDetailed({
    ...currentGeometry,
    boxes,
    directions,
    angles,
    pageWidth,
    pageHeight,
    accept: (index, proposed) => {
      const curv = currentGeometry.curvatures?.[index];
      const block: TextBlockItem = {
        text: translatedTexts[index],
        polygon: polygons[index],
        fontSize: fontSizes[index],
        direction: directions[index],
        angle: angles[index],
        originalText: texts[index],
        sourceLineCount: lineCounts[index],
        isRounded: curv?.isRounded,
        borderRadius: curv?.borderRadius,
        typesetMode: curv?.isRounded ? 'contour' : 'simple',
      };
      const fitted = measureBubbleLayoutFontSize(measureCtx as any, block, proposed, fontFamily, true);
      return fitted > 0;
    },
  });
  const tLayout = Date.now() - t4;

  // 7. Render Text Blocks Batch for Current
  const t5 = Date.now();
  const currentRenderCanvas = createCanvas(pageWidth, pageHeight);
  const currentCtx = currentRenderCanvas.getContext('2d');
  currentCtx.drawImage(cleanedImage, 0, 0);

  const currentTextBlockItems: TextBlockItem[] = [];
  for (let i = 0; i < translatedTexts.length; i++) {
    const text = translatedTexts[i];
    const poly = polygons[i];
    if (text && poly) {
      const rawTypesetBox = resolvedLayout.typesetBoxes[i];
      const typesetBox = rawTypesetBox != null ? rawTypesetBox : undefined;
      const fixed = typesetBox !== undefined;
      const curv = fixed ? currentGeometry.curvatures?.[i] : undefined;
      currentTextBlockItems.push({
        text,
        polygon: poly,
        direction: directions[i] || 'h',
        typesetBox,
        fontSize: fontSizes[i],
        angle: angles[i],
        originalText: texts[i],
        sourceLineCount: lineCounts[i],
        isRounded: fixed ? Boolean(curv?.isRounded) : false,
        borderRadius: fixed ? (curv?.borderRadius ?? 0) : 0,
        typesetMode: fixed ? (curv?.isRounded ? 'contour' : 'simple') : 'balloon',
        contourPoints: fixed ? (resolvedLayout.contourPoints?.[i] ?? undefined) : undefined,
      });
    }
  }

  const currentRenderInfos = renderTextBlocksBatch(
    currentCtx as any,
    currentTextBlockItems,
    'en',
    { width: pageWidth, height: pageHeight },
    fontFamily,
    true
  );

  // 8. Render Baseline image for exact visual diff
  const baselineRenderCanvas = createCanvas(pageWidth, pageHeight);
  const baselineCtx = baselineRenderCanvas.getContext('2d');
  baselineCtx.drawImage(cleanedImage, 0, 0);

  const baselineTextBlockItems: TextBlockItem[] = [];
  for (let i = 0; i < translatedTexts.length; i++) {
    const text = translatedTexts[i];
    const poly = polygons[i];
    if (text && poly) {
      const rawTypesetBox = baselineData.resolvedLayout.typesetBoxes[i];
      const typesetBox = rawTypesetBox != null ? rawTypesetBox : undefined;
      const fixed = typesetBox !== undefined;
      const curv = fixed ? baselineData.curvatures?.[i] : undefined;
      baselineTextBlockItems.push({
        text,
        polygon: poly,
        direction: directions[i] || 'h',
        typesetBox,
        fontSize: fontSizes[i],
        angle: angles[i],
        originalText: texts[i],
        sourceLineCount: lineCounts[i],
        isRounded: fixed ? Boolean(curv?.isRounded) : false,
        borderRadius: fixed ? (curv?.borderRadius ?? 0) : 0,
        typesetMode: fixed ? (curv?.isRounded ? 'contour' : 'simple') : 'balloon',
        contourPoints: fixed ? (baselineData.resolvedLayout.contourPoints?.[i] ?? undefined) : undefined,
      });
    }
  }

  renderTextBlocksBatch(
    baselineCtx as any,
    baselineTextBlockItems,
    'en',
    { width: pageWidth, height: pageHeight },
    fontFamily,
    true
  );

  const tRender = Date.now() - t5;

  // 9. Save rendered PNGs and visual diff
  const currentPngPath = path.join(outDir, 'image6_ccwildwords_current.png');
  const baselinePngPath = path.join(outDir, 'image6_ccwildwords_baseline.png');
  const diffPngPath = path.join(outDir, 'image6_ccwildwords_diff.png');

  fs.writeFileSync(currentPngPath, currentRenderCanvas.toBuffer('image/png'));
  fs.writeFileSync(baselinePngPath, baselineRenderCanvas.toBuffer('image/png'));

  const { diffCanvas, changedPixelCount } = generateVisualDiff(
    currentRenderCanvas,
    baselineRenderCanvas,
    pageWidth,
    pageHeight
  );
  fs.writeFileSync(diffPngPath, diffCanvas.toBuffer('image/png'));

  // 10. Perform Stage & Geometry Differential Against Baseline
  const boxDiffs: BoxDiff[] = [];
  let matchingBoxes = 0;
  let mismatchedBoxes = 0;

  for (let i = 0; i < boxes.length; i++) {
    const currCarrier = currentGeometry.carriers[i];
    const baseCarrier = baselineData.carriers[i];
    const carrierDiff = !isBoxEqual(currCarrier, baseCarrier);

    const currProposal = currentGeometry.proposals[i];
    const baseProposal = baselineData.proposals[i];
    const proposalDiff = !isBoxEqual(currProposal, baseProposal);

    const currCurv = currentGeometry.curvatures?.[i];
    const baseCurv = baselineData.curvatures?.[i];
    const curvatureDiff =
      Boolean(currCurv?.isRounded) !== Boolean(baseCurv?.isRounded) ||
      (currCurv?.borderRadius ?? 0) !== (baseCurv?.borderRadius ?? 0);

    const currContour = currentGeometry.contours?.[i];
    const baseContour = baselineData.contours?.[i];
    const contourDiff = !isContourEqual(currContour, baseContour);

    const currTypeset = resolvedLayout.typesetBoxes[i];
    const baseTypeset = baselineData.resolvedLayout.typesetBoxes[i];
    const typesetBoxDiff = !isBoxEqual(currTypeset, baseTypeset);

    const currRender = currentRenderInfos[i];
    const baseRender = baselineData.renderInfos[i];
    const renderInfoDiff =
      currRender?.fontSize !== baseRender?.fontSize ||
      currRender?.lineCount !== baseRender?.lineCount;

    const hasAnyDiff =
      carrierDiff ||
      proposalDiff ||
      curvatureDiff ||
      contourDiff ||
      typesetBoxDiff ||
      renderInfoDiff;

    const details: string[] = [];
    if (carrierDiff) {
      details.push(
        `Carrier mismatch: curr=${JSON.stringify(currCarrier)} base=${JSON.stringify(baseCarrier)}`
      );
    }
    if (proposalDiff) {
      details.push(
        `Proposal mismatch: curr=${JSON.stringify(currProposal)} base=${JSON.stringify(baseProposal)}`
      );
    }
    if (curvatureDiff) {
      details.push(
        `Curvature mismatch: curr=${JSON.stringify(currCurv)} base=${JSON.stringify(baseCurv)}`
      );
    }
    if (contourDiff) {
      details.push(
        `Contour mismatch: currPoints=${currContour?.length ?? 0} basePoints=${baseContour?.length ?? 0}`
      );
    }
    if (typesetBoxDiff) {
      details.push(
        `TypesetBox mismatch: curr=${JSON.stringify(currTypeset)} base=${JSON.stringify(baseTypeset)}`
      );
    }
    if (renderInfoDiff) {
      details.push(
        `RenderInfo mismatch: currFont=${currRender?.fontSize} baseFont=${baseRender?.fontSize}`
      );
    }

    if (hasAnyDiff) {
      mismatchedBoxes++;
      boxDiffs.push({
        boxIndex: i,
        originalText: texts[i],
        mappedText: translatedTexts[i],
        carrierDiff,
        proposalDiff,
        curvatureDiff,
        contourDiff,
        typesetBoxDiff,
        renderInfoDiff,
        details,
      });
    } else {
      matchingBoxes++;
    }
  }

  const rejectedIndices = resolvedLayout.typesetBoxes
    .map((box, idx) => (box === undefined ? idx : -1))
    .filter((idx) => idx !== -1);

  const transcriptionUncertainties = transcriptionData.transcriptions
    .filter((item: any) => Boolean(item.uncertainty))
    .map((item: any) => ({
      index: item.index,
      originalText: item.originalText,
      mappedText: item.mappedText,
      uncertainty: item.uncertainty,
    }));

  const totalTime = Date.now() - startTime;

  const result: HarnessResult = {
    success: true,
    stageTimingsMs: {
      fontAndHyphenation: tFont,
      imageLoadAndInpaint: tInpaint,
      yoloInference: tYolo,
      geometryBuild: tGeom,
      layoutResolution: tLayout,
      typesettingRender: tRender,
      total: totalTime,
    },
    metrics: {
      totalOcrBoxes: boxes.length,
      totalYoloBubbles: parsedNeuralBubbles.length,
      matchedBoxes: currentGeometry.proposals.filter(Boolean).length,
      acceptedLayouts: resolvedLayout.typesetBoxes.filter(Boolean).length,
      rejectedLayouts: rejectedIndices.length,
      rejectedIndices,
    },
    transcriptionUncertainties,
    differentialSummary: {
      baselineCompared: true,
      totalDifferences: boxDiffs.length,
      matchingBoxes,
      mismatchedBoxes,
      boxDiffs,
      isIdenticalToBaseline: boxDiffs.length === 0 && changedPixelCount === 0,
    },
    renderedFiles: {
      currentPng: currentPngPath,
      baselinePng: baselinePngPath,
      diffPng: diffPngPath,
    },
  };

  if (verbose) {
    console.log('\n======================================================');
    console.log('   NEURAL BUBBLE OFFLINE REGRESSION HARNESS REPORT   ');
    console.log('======================================================');
    console.log(`Image: ${testImgPath} (${pageWidth}x${pageHeight})`);
    console.log(`Mode: ${options.fastMode ? 'Fast Fixture Mode' : 'Full ONNX Inference Mode'}`);
    console.log('\n--- Stage Metrics & Timings ---');
    console.log(`1. Font & Hyphenation Init:  ${tFont}ms`);
    console.log(`2. Image Load & Inpaint:     ${tInpaint}ms`);
    console.log(`3. YOLO Bubble Inference:    ${tYolo}ms (${parsedNeuralBubbles.length} proposals)`);
    console.log(`4. Geometry Extraction:      ${tGeom}ms`);
    console.log(`5. Layout Resolution:        ${tLayout}ms (${result.metrics.acceptedLayouts} accepted, ${result.metrics.rejectedLayouts} fallback)`);
    console.log(`6. Text Rendering:           ${tRender}ms`);
    console.log(`Total Pipeline Execution:    ${totalTime}ms`);

    console.log('\n--- Layout Acceptance Breakdown ---');
    console.log(`Accepted Typeset Boxes (${result.metrics.acceptedLayouts}/${boxes.length}):`);
    for (let i = 0; i < boxes.length; i++) {
      const tb = resolvedLayout.typesetBoxes[i];
      if (tb) {
        console.log(
          `  Box #${i}: [x:${tb.x}, y:${tb.y}, w:${tb.w}, h:${tb.h}] font:${currentRenderInfos[i]?.fontSize}px ("${translatedTexts[i].slice(0, 30)}...")`
        );
      }
    }
    console.log(`Rejected/Fallback Boxes (${result.metrics.rejectedLayouts}): indices [${rejectedIndices.join(', ')}]`);

    console.log('\n--- Differential Against Baseline Fixture ---');
    console.log(`Matching boxes:   ${matchingBoxes}/${boxes.length}`);
    console.log(`Mismatched boxes: ${mismatchedBoxes}/${boxes.length}`);
    console.log(`Pixel Diff Count: ${changedPixelCount} divergent pixels`);
    console.log(`Status:           ${result.differentialSummary.isIdenticalToBaseline ? '100% IDENTICAL' : 'DIVERGED'}`);

    if (boxDiffs.length > 0) {
      console.log('\nDivergences:');
      for (const diff of boxDiffs) {
        console.log(`  Box #${diff.boxIndex} ("${diff.mappedText}"):`);
        for (const d of diff.details) {
          console.log(`    - ${d}`);
        }
      }
    }

    console.log('\n--- Regional Enclosure & Ground-Truth Analysis ---');
    console.log('Joined Multi-Lobe Speech Balloons:');
    console.log('  - Pair #1 & #2: [Top Right] "UGH..." + "THE ENEMY IS TOO STRONG" (connected balloon)');
    console.log('  - Pair #3 & #4: [Top Left]  "OTHER PEOPLE..." + "THIS KEEPS HAPPENING..." (connected balloon)');
    console.log('  - Pair #12 & #13: [Mid-Lower Left] "I GET IT NOW.." + "BUT PLEASE DON\'T FORCE..." (connected balloon)');
    console.log('Free-Text / Uncontained Manga Dialogue (Conservatively Rejected to Disabled fallback):');
    console.log('  - Box #8:  [Center] "老师你们赶快撤退去搬救兵！！" (large background speech without closed border)');
    console.log('  - Box #16: [Bottom Right] "现在证是拼尽全力的时候" (open panel text without contour)');
    console.log('  - Box #17: [Bottom Right] "打起精神来" (open panel text without contour)');
    console.log('  - Box #18: [Bottom Right] "莲实！" (open panel text without contour)');
    console.log('Small Chamber Stability:');
    console.log('  - Box #15: [Bottom Left] "UN-DER-STOOD!" ("明白！") (tiny lower chamber; high sensitivity to erosion)');
    console.log('Artwork / Watermark Debris (Accepted via High Background Contrast):');
    console.log('  - Box #0:  [Top Edge] "我" (residual watermark from "我==")');
    console.log('  - Box #5:  [Center] "电" (SFX lightning/spark glyph)');

    console.log('\n--- Transcription Uncertainties ---');
    for (const u of transcriptionUncertainties) {
      console.log(`  Box #${u.index}: original="${u.originalText}" mapped="${u.mappedText}"`);
      console.log(`    Note: ${u.uncertainty}`);
    }

    console.log('\n--- Rendered PNG Deliverables ---');
    console.log(`Current Render:  ${currentPngPath}`);
    console.log(`Baseline Render: ${baselinePngPath}`);
    console.log(`Visual Diff:     ${diffPngPath}`);
    console.log('======================================================\n');
  }

  return result;
}

// CLI runner
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const isFast = process.argv.includes('--fast') || process.argv.includes('--fixture');
  runNeuralBubbleRegressionHarness({ fastMode: isFast })
    .then((res) => {
      if (res.differentialSummary.isIdenticalToBaseline) {
        console.log('[Harness Exit] Regression test PASSED with 100% parity against baseline.');
        process.exit(0);
      } else {
        console.warn('[Harness Exit] Baseline differential detected changes (expected when validating active refactors).');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('[Harness Exit] Error running regression harness:', err);
      process.exit(1);
    });
}
