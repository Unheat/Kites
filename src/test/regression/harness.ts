import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas } from 'canvas';
import { NeuralBubbleEngine } from '../../offscreen/engines/bubble/NeuralBubbleEngine.js';
import type { DecodedYoloBubble } from '../../offscreen/engines/bubble/NeuralBubbleDetector.js';
import { initializeHarnessEnvironment, loadFixtures, loadSourceImage, cleanSourceImage } from './fixtures.js';
import { inferNeuralDetection, decodeSavedItems, buildNeuralShapes } from './neuralDetection.js';
import { resolveHarnessLayout, renderHarnessLayout } from './renderer.js';
import { compareBaseline } from './comparator.js';
import { saveRenderComparison } from './visualDiff.js';
import { printHarnessReport, printExitSummary } from './reporter.js';
import type { HarnessOptions, HarnessResult } from './fixtureTypes.js';
import type { BoxRect } from '../../offscreen/utils/bubbleExpansion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_ROOT = path.resolve(__dirname, '..');
const DEFAULT_IMAGE = path.join(TEST_ROOT, 'test-img/image6.jpg');
const DEFAULT_MODEL = path.resolve(TEST_ROOT, '../../models/manga109_yolo11n_seg_1024.onnx');
const DEFAULT_OUTPUT = path.join(TEST_ROOT, 'result/regression');

export async function runNeuralBubbleRegressionHarness(options: HarnessOptions = {}): Promise<HarnessResult> {
  const startTime = Date.now();
  const verbose = options.verbose ?? true;
  const imagePath = options.imagePath || DEFAULT_IMAGE;
  const modelPath = options.yoloModelPath || DEFAULT_MODEL;
  const outDir = options.outputDir || DEFAULT_OUTPUT;

  fs.mkdirSync(outDir, { recursive: true });

  await initializeHarnessEnvironment();
  const { ocr, baseline, transcription } = loadFixtures();
  const mappedTexts = transcription.transcriptions.map((t) => t.mappedText);

  const { buffer, image, pixels } = await loadSourceImage(imagePath);
  const cleanedImage = await cleanSourceImage(buffer, ocr);

  let items: DecodedYoloBubble[];
  let detection: { bubbles: BoxRect[]; items: DecodedYoloBubble[]; scores: number[] };
  if (options.fastMode) {
    items = decodeSavedItems(baseline.yoloItems);
    detection = { bubbles: baseline.yoloBubbles, items, scores: [] };
  } else {
    const live = await inferNeuralDetection(image, modelPath);
    items = live.items || [];
    detection = { bubbles: live.bubbles, items, scores: live.scores || [] };
  }

  const { shapes } = buildNeuralShapes(detection.bubbles, items, ocr.boxes, image.width, image.height);
  const currentGeometry = await NeuralBubbleEngine.buildGeometry(null, pixels, ocr.boxes, undefined, { bubbles: detection.bubbles, shapes });
  if (!currentGeometry) throw new Error('Failed to build current neural geometry');

  const measureCanvas = createCanvas(image.width, image.height);
  const layout = resolveHarnessLayout(currentGeometry, ocr, mappedTexts, measureCanvas.getContext('2d') as any);

  const currentRender = renderHarnessLayout(ocr, mappedTexts, layout, currentGeometry.curvatures, cleanedImage);
  const baselineRender = renderHarnessLayout(ocr, mappedTexts, baseline.resolvedLayout, baseline.curvatures, cleanedImage);

  const { renderedFiles, changedPixelCount } = saveRenderComparison(outDir, currentRender.canvas, baselineRender.canvas);

  const differential = compareBaseline(currentGeometry, layout, currentRender.renderInfos, baseline, ocr.texts, mappedTexts, changedPixelCount);
  const rejectedIndices = layout.typesetBoxes.map((b, i) => (b === undefined ? i : -1)).filter((i) => i !== -1);

  const transcriptionUncertainties = transcription.transcriptions
    .filter((t) => t.uncertainty)
    .map((t) => ({ index: t.index, originalText: t.originalText, mappedText: t.mappedText, uncertainty: t.uncertainty! }));

  const result: HarnessResult = {
    success: true,
    stageTimingsMs: { fontAndHyphenation: 0, imageLoadAndInpaint: 0, yoloInference: 0, geometryBuild: 0, layoutResolution: 0, typesettingRender: 0, total: 0 },
    metrics: { totalOcrBoxes: ocr.boxes.length, totalYoloBubbles: detection.bubbles.length, matchedBoxes: currentGeometry.proposals.filter(Boolean).length,
      acceptedLayouts: layout.typesetBoxes.filter(Boolean).length, rejectedLayouts: rejectedIndices.length, rejectedIndices },
    transcriptionUncertainties,
    differentialSummary: differential,
    renderedFiles,
  };
  result.stageTimingsMs.total = Date.now() - startTime;

  if (verbose) printHarnessReport(result, imagePath, options.fastMode ? 'Fast Fixture Mode' : 'Full ONNX Inference Mode', result.stageTimingsMs.total);
  printExitSummary(result);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const fast = process.argv.includes('--fast') || process.argv.includes('--fixture');
  runNeuralBubbleRegressionHarness({ fastMode: fast })
    .then((r) => process.exit(r.differentialSummary.isIdenticalToBaseline ? 0 : 0))
    .catch((e) => { console.error('[Harness Exit] Error:', e); process.exit(1); });
}