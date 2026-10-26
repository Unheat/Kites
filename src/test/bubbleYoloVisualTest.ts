import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from 'canvas';
import * as ort from 'onnxruntime-node';
import { NeuralBubbleDetector } from '../offscreen/engines/bubble/NeuralBubbleDetector';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface YoloPerformanceStats {
  file: string;
  dimensions: string;
  preprocessMs: number;
  inferenceMs: number;
  decodeMs: number;
  renderMs: number;
  totalMs: number;
  bubblesCount: number;
}

/**
 * Visual integration test for Tier 2 Neural YOLO Speech Bubble Detector & Segmenter.
 *
 * Runs full-page YOLO11-seg inference, decodes speech bubble bounding boxes and prototype masks,
 * renders both the semi-transparent blue mask overlay and labeled bounding boxes (matching the
 * official HuggingFace demo visualization), and outputs marked visual test images to
 * src/test/result/bubble_yolo/.
 *
 * @returns A promise that resolves when all test images have been evaluated.
 */
export async function runBubbleYoloVisualTest(): Promise<void> {
  console.log('================================================================');
  console.log('     Tier 2: YOLO Neural Bubble & Mask Visual Integration Test');
  console.log('================================================================');

  const testImgDir = path.join(__dirname, 'test-img');
  const resultDir = path.join(__dirname, 'result', 'bubble_yolo');

  if (fs.existsSync(resultDir)) {
    fs.rmSync(resultDir, { recursive: true, force: true });
  }
  fs.mkdirSync(resultDir, { recursive: true });

  // Locate YOLO model weights
  const candidateModelPaths = [
    path.resolve(process.cwd(), 'src/test/models/bubble/manga109_yolo11n_seg_1024.onnx'),
    path.resolve(process.cwd(), 'models/manga109_yolo11n_seg_1024.onnx'),
    path.resolve(process.cwd(), 'models/manga109_segmentation_bubble_1024.onnx'),
  ];
  const modelPath = candidateModelPaths.find((p) => fs.existsSync(p));

  if (!modelPath) {
    console.error('[YOLO Test] Could not find YOLO ONNX model in candidate paths:', candidateModelPaths);
    return;
  }

  console.log(`[YOLO Test] Loading ONNX session from: ${modelPath}`);
  const session = await ort.InferenceSession.create(modelPath);
  console.log('[YOLO Test] ONNX session initialized successfully.\n');

  const files = fs.readdirSync(testImgDir).filter((file: string) =>
    file.endsWith('.jpg') || file.endsWith('.png')
  ).sort();

  if (files.length === 0) {
    console.error('No test images found in src/test/test-img/');
    return;
  }

  const perfStats: YoloPerformanceStats[] = [];
  const inputSize = 1024;

  for (const file of files) {
    console.log(`----------------------------------------------------------------`);
    console.log(`Processing: ${file}`);
    console.log(`----------------------------------------------------------------`);

    const imagePath = path.join(testImgDir, file);
    const img = await loadImage(imagePath);
    const width = img.width;
    const height = img.height;

    // 1. Preprocessing Stage (Resize & Normalize Planar Tensor)
    const t0 = performance.now();
    const resizeCanvas = createCanvas(inputSize, inputSize);
    const resizeCtx = resizeCanvas.getContext('2d');
    resizeCtx.drawImage(img, 0, 0, inputSize, inputSize);
    const resizedImgData = resizeCtx.getImageData(0, 0, inputSize, inputSize).data;

    const floatData = NeuralBubbleDetector.preprocessImage(resizedImgData, inputSize);
    const tensorImages = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);
    const preprocessMs = performance.now() - t0;

    // 2. ONNX Neural Inference Stage
    const t1 = performance.now();
    const neuralOutput = await session.run({ images: tensorImages });
    const inferenceMs = performance.now() - t1;

    // 3. Postprocessing & Mask Decoding Stage
    const t2 = performance.now();
    const parsed = NeuralBubbleDetector.parseYolo11Output(
      neuralOutput.output0,
      width,
      height,
      inputSize,
      0.35,
      0.45,
      neuralOutput.output1
    );
    const decodeMs = performance.now() - t2;
    const items = parsed.items || [];

    // 4. Visual Rendering Stage: Both Bounding Box and Segmentation Mask
    const t3 = performance.now();
    const outCanvas = createCanvas(width, height);
    const outCtx = outCanvas.getContext('2d');
    outCtx.drawImage(img, 0, 0);

    // Pass 4a: Render smooth blue segmentation masks
    outCtx.imageSmoothingEnabled = true;
    for (const item of items) {
      if (!item.protoMask) continue;
      const { mask, pw, ph, px1, py1 } = item.protoMask;

      const patchCanvas = createCanvas(pw, ph);
      const patchCtx = patchCanvas.getContext('2d');
      const patchImgData = patchCtx.createImageData(pw, ph);
      const pData = patchImgData.data;

      for (let i = 0; i < mask.length; i++) {
        if (mask[i] === 1) {
          const idx = i * 4;
          pData[idx] = 0;        // R
          pData[idx + 1] = 102;  // G
          pData[idx + 2] = 255;  // B
          pData[idx + 3] = 100;  // Alpha (~0.39 semi-transparent blue tint)
        }
      }
      patchCtx.putImageData(patchImgData, 0, 0);

      const dx = px1 * (width / 256);
      const dy = py1 * (height / 256);
      const dw = pw * (width / 256);
      const dh = ph * (height / 256);

      outCtx.drawImage(patchCanvas, dx, dy, dw, dh);
    }

    // Pass 4b: Render blue bounding boxes and labels (matching HuggingFace demo)
    outCtx.lineWidth = 3;
    outCtx.strokeStyle = '#0055ff';
    outCtx.font = 'bold 16px sans-serif';

    for (const item of items) {
      const { box, score } = item;

      // Outer Bounding Rectangle
      outCtx.strokeStyle = '#0055ff';
      outCtx.strokeRect(box.x, box.y, box.w, box.h);

      // Label Header Tag ("balloon 0.94")
      const label = `balloon ${score.toFixed(2)}`;
      const textMetrics = outCtx.measureText(label);
      const tagH = 22;
      const tagW = Math.round(textMetrics.width + 12);
      const tagY = box.y >= tagH ? box.y - tagH : box.y;

      outCtx.fillStyle = '#0055ff';
      outCtx.fillRect(box.x, tagY, tagW, tagH);

      outCtx.fillStyle = '#ffffff';
      outCtx.textBaseline = 'middle';
      outCtx.fillText(label, box.x + 6, tagY + tagH / 2);
    }

    const renderMs = performance.now() - t3;
    const totalMs = preprocessMs + inferenceMs + decodeMs + renderMs;

    // Save visual output
    const outPath = path.join(resultDir, `out_${file}`);
    const outBuffer = file.endsWith('.png')
      ? outCanvas.toBuffer('image/png')
      : outCanvas.toBuffer('image/jpeg', { quality: 0.95 });
    fs.writeFileSync(outPath, outBuffer);

    console.log(`Dimensions: ${width}x${height} | Preprocess: ${preprocessMs.toFixed(1)}ms`);
    console.log(`Inference: ${inferenceMs.toFixed(1)}ms | Decode: ${decodeMs.toFixed(2)}ms (${items.length} bubbles)`);
    console.log(`Rendering: ${renderMs.toFixed(1)}ms | Total: ${totalMs.toFixed(1)}ms`);
    console.log(`Saved marked output: ${outPath}\n`);

    perfStats.push({
      file,
      dimensions: `${width}x${height}`,
      preprocessMs,
      inferenceMs,
      decodeMs,
      renderMs,
      totalMs,
      bubblesCount: items.length,
    });

    // Cleanup per-iteration tensors
    tensorImages.dispose();
  }

  // Print Consolidated Performance Summary Table
  console.log('================================================================');
  console.log('                YOLO Visual Test Performance Summary');
  console.log('================================================================');
  console.log(
    'Image'.padEnd(14) +
    'Dimensions'.padEnd(13) +
    'Bubbles'.padStart(8) +
    'Pre (ms)'.padStart(10) +
    'Infer (ms)'.padStart(12) +
    'Dec (ms)'.padStart(10) +
    'Total (ms)'.padStart(12)
  );
  console.log('-'.repeat(79));

  let totalPre = 0;
  let totalInfer = 0;
  let totalDec = 0;
  let totalOverall = 0;
  let totalBubbles = 0;

  for (const s of perfStats) {
    totalPre += s.preprocessMs;
    totalInfer += s.inferenceMs;
    totalDec += s.decodeMs;
    totalOverall += s.totalMs;
    totalBubbles += s.bubblesCount;

    console.log(
      s.file.padEnd(14) +
      s.dimensions.padEnd(13) +
      String(s.bubblesCount).padStart(8) +
      s.preprocessMs.toFixed(1).padStart(10) +
      s.inferenceMs.toFixed(1).padStart(12) +
      s.decodeMs.toFixed(2).padStart(10) +
      s.totalMs.toFixed(1).padStart(12)
    );
  }

  console.log('-'.repeat(79));
  const count = perfStats.length;
  console.log(
    'AVERAGE'.padEnd(27) +
    String(totalBubbles).padStart(8) +
    (totalPre / count).toFixed(1).padStart(10) +
    (totalInfer / count).toFixed(1).padStart(12) +
    (totalDec / count).toFixed(2).padStart(10) +
    (totalOverall / count).toFixed(1).padStart(12)
  );
  console.log('================================================================\n');
}

// Auto-execute if invoked as a CLI script directly
if (process.argv[1] && process.argv[1].endsWith('bubbleYoloVisualTest.ts')) {
  runBubbleYoloVisualTest().catch((err) => {
    console.error('Fatal error executing bubbleYoloVisualTest:', err);
    process.exit(1);
  });
}
