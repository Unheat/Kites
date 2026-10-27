import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from 'canvas';
import { OcrManager } from '../offscreen/services/OcrManager';
import { HeuristicBubbleExtractor, type BubbleShapeEvidence } from '../offscreen/engines/bubble/HeuristicBubbleExtractor';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ImagePerformanceStats {
  file: string;
  dimensions: string;
  ocrMs: number;
  boxesCount: number;
  extractionMs: number;
  carriersCount: number;
  renderMs: number;
  totalMs: number;
}

/**
 * Visual integration test for Tier 1 Heuristic Bubble Extractor.
 *
 * Runs OCR to locate speech bubbles, executes heuristic morphological opening
 * and chamber expansion, maps the binary interior mask directly onto the original
 * page image (tinting interior pixels blue [1] while preserving background pixels [0]),
 * and outputs marked visual test images to src/test/result/bubble_heuristic/.
 *
 * @returns A promise that resolves when all test images have been evaluated.
 */
export async function runBubbleHeuristicVisualTest(): Promise<void> {
  console.log('================================================================');
  console.log('     Tier 1: Heuristic Bubble Extractor Visual Integration Test');
  console.log('================================================================');

  const testImgDir = path.join(__dirname, 'test-img');
  const resultDir = path.join(__dirname, 'result', 'bubble_heuristic');

  if (fs.existsSync(resultDir)) {
    fs.rmSync(resultDir, { recursive: true, force: true });
  }
  fs.mkdirSync(resultDir, { recursive: true });

  const files = fs.readdirSync(testImgDir).filter((file: string) =>
    file.endsWith('.jpg') || file.endsWith('.png')
  ).sort();

  if (files.length === 0) {
    console.error('No test images found in src/test/test-img/');
    return;
  }

  const ocrManager = new OcrManager();
  const perfStats: ImagePerformanceStats[] = [];

  for (const file of files) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`Processing: ${file}`);
    console.log(`----------------------------------------------------------------`);

    const imagePath = path.join(testImgDir, file);
    const buffer = fs.readFileSync(imagePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

    const img = await loadImage(buffer);
    const pageWidth = img.width;
    const pageHeight = img.height;

    // 1. OCR Text Localization
    const t0 = performance.now();
    const sourceLang = (file === 'image8.png' || file === 'image5.png') ? undefined : 'ja';
    const ocrResult = await ocrManager.processImage(arrayBuffer, 'v6-small', {
      sourceLang,
      pageWidth,
      pageHeight,
    });
    const ocrMs = performance.now() - t0;
    const boxes = ocrResult.boxes || [];

    // Prepare full image pixel buffer for morphology analysis
    const probeCanvas = createCanvas(pageWidth, pageHeight);
    const probeCtx = probeCanvas.getContext('2d');
    probeCtx.drawImage(img, 0, 0);
    const imgData = probeCtx.getImageData(0, 0, pageWidth, pageHeight);

    // 2. Heuristic Carrier Extraction & Binary Mask Generation
    const t1 = performance.now();
    const shapes: BubbleShapeEvidence[] = [];
    const carriers = boxes.map((box) => {
      return HeuristicBubbleExtractor.extractCarrierBox(imgData, box, {
        allTextBoxes: boxes,
        onShapeEvidence: (evidence) => {
          shapes.push(evidence);
        },
      });
    });
    const extractionMs = performance.now() - t1;
    const validCarriers = carriers.filter(Boolean);

    // 3. Render Binary Mask onto Original Image
    const t2 = performance.now();
    const outCanvas = createCanvas(pageWidth, pageHeight);
    const outCtx = outCanvas.getContext('2d');
    outCtx.drawImage(img, 0, 0);

    // Global binary mask: 1 = speech bubble chamber interior, 0 = original image pixel
    const fullMask = new Uint8Array(pageWidth * pageHeight);

    for (const shape of shapes) {
      const mask = shape.reconstructed ?? shape.interior;
      const { x, y, scale, width: pw, height: ph } = shape;

      for (let py = 0; py < ph; py++) {
        const yStart = Math.min(pageHeight - 1, y + Math.floor(py / scale));
        const yEnd = Math.min(pageHeight, y + Math.ceil((py + 1) / scale));

        for (let px = 0; px < pw; px++) {
          if (mask[py * pw + px] === 1) {
            const xStart = Math.min(pageWidth - 1, x + Math.floor(px / scale));
            const xEnd = Math.min(pageWidth, x + Math.ceil((px + 1) / scale));

            for (let my = yStart; my < yEnd; my++) {
              const rowOffset = my * pageWidth;
              for (let mx = xStart; mx < xEnd; mx++) {
                fullMask[rowOffset + mx] = 1;
              }
            }
          }
        }
      }
    }

    // Apply blue color tint where binary mask is 1, keep original pixel if 0
    const outImgData = outCtx.getImageData(0, 0, pageWidth, pageHeight);
    const data = outImgData.data;
    const tintR = 0;
    const tintG = 102;
    const tintB = 255;
    const alpha = 0.40;
    const invAlpha = 1.0 - alpha;

    let maskPixelCount = 0;
    for (let i = 0; i < fullMask.length; i++) {
      if (fullMask[i] === 1) {
        maskPixelCount++;
        const p = i * 4;
        data[p] = Math.round(data[p] * invAlpha + tintR * alpha);
        data[p + 1] = Math.round(data[p + 1] * invAlpha + tintG * alpha);
        data[p + 2] = Math.round(data[p + 2] * invAlpha + tintB * alpha);
      }
    }
    outCtx.putImageData(outImgData, 0, 0);
    const renderMs = performance.now() - t2;
    const totalMs = ocrMs + extractionMs + renderMs;

    // Save visual output
    const outPath = path.join(resultDir, `out_${file}`);
    const outBuffer = file.endsWith('.png')
      ? outCanvas.toBuffer('image/png')
      : outCanvas.toBuffer('image/jpeg', { quality: 0.95 });
    fs.writeFileSync(outPath, outBuffer);

    console.log(`Dimensions: ${pageWidth}x${pageHeight} | OCR: ${ocrMs.toFixed(1)}ms (${boxes.length} boxes)`);
    console.log(`Heuristic Extraction: ${extractionMs.toFixed(2)}ms (${validCarriers.length} carriers, ${shapes.length} shapes)`);
    console.log(`Rendering: ${renderMs.toFixed(1)}ms (${maskPixelCount.toLocaleString()} masked pixels) | Total: ${totalMs.toFixed(1)}ms`);
    console.log(`Saved marked output: ${outPath}`);

    perfStats.push({
      file,
      dimensions: `${pageWidth}x${pageHeight}`,
      ocrMs,
      boxesCount: boxes.length,
      extractionMs,
      carriersCount: validCarriers.length,
      renderMs,
      totalMs,
    });
  }

  await ocrManager.cleanup();

  // Print Consolidated Performance Summary Table
  console.log('\n================================================================');
  console.log('              Heuristic Visual Test Performance Summary');
  console.log('================================================================');
  console.log(
    'Image'.padEnd(14) +
    'Dimensions'.padEnd(13) +
    'Boxes'.padStart(6) +
    'Carriers'.padStart(9) +
    'OCR (ms)'.padStart(11) +
    'Heur (ms)'.padStart(12) +
    'Total (ms)'.padStart(12)
  );
  console.log('-'.repeat(77));

  let totalOcr = 0;
  let totalHeur = 0;
  let totalOverall = 0;

  for (const s of perfStats) {
    totalOcr += s.ocrMs;
    totalHeur += s.extractionMs;
    totalOverall += s.totalMs;

    console.log(
      s.file.padEnd(14) +
      s.dimensions.padEnd(13) +
      String(s.boxesCount).padStart(6) +
      String(s.carriersCount).padStart(9) +
      s.ocrMs.toFixed(1).padStart(11) +
      s.extractionMs.toFixed(2).padStart(12) +
      s.totalMs.toFixed(1).padStart(12)
    );
  }

  console.log('-'.repeat(77));
  const avgOcr = totalOcr / perfStats.length;
  const avgHeur = totalHeur / perfStats.length;
  const avgTotal = totalOverall / perfStats.length;

  console.log(
    'AVERAGE'.padEnd(27) +
    ''.padStart(6) +
    ''.padStart(9) +
    avgOcr.toFixed(1).padStart(11) +
    avgHeur.toFixed(2).padStart(12) +
    avgTotal.toFixed(1).padStart(12)
  );
  console.log('================================================================\n');
}

// Auto-execute if invoked as a CLI script directly
if (process.argv[1] && process.argv[1].endsWith('bubbleHeuristicVisualTest.ts')) {
  runBubbleHeuristicVisualTest().catch((err) => {
    console.error('Fatal error executing bubbleHeuristicVisualTest:', err);
    process.exit(1);
  });
}
