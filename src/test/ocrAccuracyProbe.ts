import * as fs from 'fs';
import * as path from 'path';
import { loadImage } from 'canvas';
import { PaddleOcrEngine } from '../offscreen/engines/ocr/PaddleOcrEngine';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Images probed, in a fixed order so two runs are diffable line by line.
 * Kept in sync with ocrVisualTestRawPolygon.ts.
 */
const TEST_IMAGES = ['image1.jpg', 'image2.jpg', 'image3.jpg', 'image4.jpg', 'image5.png', 'image6.jpg'];

/**
 * Emits raw per-line OCR recognition for every test image as stable plain text, so two
 * branches can be compared with `diff`.
 *
 * This probes `PaddleOcrEngine.recognize` directly rather than `OcrManager.processImage`
 * on purpose. OcrManager applies textline merging, which groups lines into bubbles — that
 * grouping differs between branches and would make the two outputs structurally
 * incomparable. The engine's raw output is one entry per detected text line on every
 * branch, which is exactly the recognition quality we are trying to measure.
 *
 * Lines are sorted by (y, x) so that detection ordering differences do not show up as diff
 * noise; only genuine changes in box position or recognised text do.
 *
 * Output format, one LINE record per detected text line:
 *   LINE <image> <x>,<y>,<w>,<h> <recognised text>
 *
 * @returns A promise that resolves once every image has been probed.
 */
async function runAccuracyProbe(): Promise<void> {
  const testImgDir = path.join(__dirname, 'test-img');
  const present = fs.readdirSync(testImgDir).filter((f: string) => TEST_IMAGES.includes(f));
  const filesToProcess = TEST_IMAGES.filter(f => present.includes(f));

  if (filesToProcess.length === 0) {
    console.error('No matching images found in src/test/test-img/');
    return;
  }

  const engine = new PaddleOcrEngine();
  await engine.init();

  for (const file of filesToProcess) {
    const imgPath = path.join(testImgDir, file);
    let img;
    try {
      img = await loadImage(imgPath);
    } catch (e) {
      console.log(`SUMMARY ${file} ERROR could not load image: ${e}`);
      continue;
    }

    const buf = fs.readFileSync(imgPath);
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

    try {
      const result = await engine.recognize(arrayBuffer);
      console.log(`IMAGE ${file} ${img.width}x${img.height}`);

      const rows = result.texts.map((text, i) => {
        const b = result.boxes[i];
        return {
          x: Math.round(b.x),
          y: Math.round(b.y),
          w: Math.round(b.w),
          h: Math.round(b.h),
          text,
        };
      });
      // Stable reading order so detection-order changes are not mistaken for accuracy changes.
      rows.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));

      for (const r of rows) {
        console.log(`LINE ${file} ${r.x},${r.y},${r.w},${r.h} ${r.text}`);
      }
      console.log(`SUMMARY ${file} lines=${rows.length}`);
    } catch (e) {
      console.log(`SUMMARY ${file} ERROR ${e}`);
    }
  }

  await engine.destroy();
}

runAccuracyProbe().catch(err => {
  console.error('Accuracy probe failed:', err);
  process.exit(1);
});
