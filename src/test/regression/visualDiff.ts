import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, type Canvas } from 'canvas';

const CHANNEL_TOLERANCE = 3; // Existing per-channel pixel threshold.
const DIM_FACTOR = 0.4; // Existing grayscale context intensity.

/** Generate native Canvas pixel diff. Matching pixels dimmed; divergent pixels magenta.
 * @param current - Current rendering. @param baseline - Frozen-geometry rendering with current renderer.
 * @returns Diff canvas and differing pixel count; not a saved historical renderer image.
 */
export function generateVisualDiff(current: Canvas, baseline: Canvas) {
  const { width, height } = current;
  const diffCanvas = createCanvas(width, height);
  const ctx = diffCanvas.getContext('2d');
  const currData = current.getContext('2d').getImageData(0, 0, width, height).data;
  const baseData = baseline.getContext('2d').getImageData(0, 0, width, height).data;
  const image = ctx.createImageData(width, height);
  const out = image.data;
  let changedPixelCount = 0;
  for (let i = 0; i < currData.length; i += 4) {
    const changed = Math.abs(currData[i] - baseData[i]) > CHANNEL_TOLERANCE
      || Math.abs(currData[i + 1] - baseData[i + 1]) > CHANNEL_TOLERANCE
      || Math.abs(currData[i + 2] - baseData[i + 2]) > CHANNEL_TOLERANCE
      || Math.abs(currData[i + 3] - baseData[i + 3]) > CHANNEL_TOLERANCE;
    if (changed) {
      changedPixelCount++;
      out[i] = 255; out[i + 1] = 0; out[i + 2] = 255; out[i + 3] = 255;
    } else {
      const gray = Math.round((currData[i] * 0.299 + currData[i + 1] * 0.587 + currData[i + 2] * 0.114) * DIM_FACTOR);
      out[i] = gray; out[i + 1] = gray; out[i + 2] = gray; out[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { diffCanvas, changedPixelCount };
}

/** Save ignored artifacts. @param outDir - Output directory. @param current - Current canvas.
 * @param baseline - Frozen-geometry canvas. @returns Paths and pixel difference count.
 */
export function saveRenderComparison(outDir: string, current: Canvas, baseline: Canvas) {
  fs.mkdirSync(outDir, { recursive: true });
  const renderedFiles = {
    currentPng: path.join(outDir, 'image6_ccwildwords_current.png'),
    baselinePng: path.join(outDir, 'image6_ccwildwords_baseline.png'),
    diffPng: path.join(outDir, 'image6_ccwildwords_diff.png'),
  };
  const { diffCanvas, changedPixelCount } = generateVisualDiff(current, baseline);
  fs.writeFileSync(renderedFiles.currentPng, current.toBuffer('image/png'));
  fs.writeFileSync(renderedFiles.baselinePng, baseline.toBuffer('image/png'));
  fs.writeFileSync(renderedFiles.diffPng, diffCanvas.toBuffer('image/png'));
  return { renderedFiles, changedPixelCount };
}
