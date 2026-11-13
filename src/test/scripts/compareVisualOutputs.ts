/**
 * Compares two visual-test result directories pixel by pixel.
 *
 * Used to check a refactor for rendering regressions: run the same suite on the previous commit and
 * on the current one, then compare the two output folders. For every image it reports the share of
 * changed pixels and writes a highlighted diff PNG, so a real layout change can be told apart from
 * antialiasing noise or a 1px frame shift.
 *
 * Usage:
 *   npx tsx src/test/scripts/compareVisualOutputs.ts <baseline-dir> <current-dir> <output-dir>
 */
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage } from 'canvas';

/** Pixel channel delta above which a pixel counts as changed (ignores codec/antialias noise). */
const CHANGED_PIXEL_THRESHOLD = 24;

/**
 * Writes a page-sized image with changed pixels in red over a faded original.
 *
 * @param baseline - Baseline image.
 * @param current - Current image.
 * @param outputPath - Destination PNG.
 * @returns Changed pixel count and the changed bounding box.
 */
async function writeDiff(
  baseline: string,
  current: string,
  outputPath: string,
): Promise<{ changed: number; total: number; box: string }> {
  const a = await loadImage(baseline);
  const b = await loadImage(current);
  const canvas = createCanvas(a.width, a.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(a, 0, 0);
  const source = ctx.getImageData(0, 0, a.width, a.height);
  const other = (() => {
    const c = createCanvas(b.width, b.height);
    const cx = c.getContext('2d');
    cx.drawImage(b, 0, 0);
    return cx.getImageData(0, 0, b.width, b.height);
  })();

  let changed = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const delta = Math.abs(source.data[i] - other.data[i])
        + Math.abs(source.data[i + 1] - other.data[i + 1])
        + Math.abs(source.data[i + 2] - other.data[i + 2]);
      if (delta > CHANGED_PIXEL_THRESHOLD) {
        changed += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        source.data[i] = 255;
        source.data[i + 1] = 0;
        source.data[i + 2] = 0;
      } else {
        // Fade unchanged pixels so the red overlay is readable.
        source.data[i] = Math.round(source.data[i] * 0.55 + 140);
        source.data[i + 1] = Math.round(source.data[i + 1] * 0.55 + 140);
        source.data[i + 2] = Math.round(source.data[i + 2] * 0.55 + 140);
      }
    }
  }
  ctx.putImageData(source, 0, 0);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
  const box = maxX < 0 ? 'none' : `(${minX},${minY})-(${maxX},${maxY})`;
  return { changed, total: a.width * a.height, box };
}

/**
 * Compares every image present in the baseline directory.
 *
 * @returns Process exit code: 0 when all comparisons completed.
 */
async function main(): Promise<void> {
  const [baselineDir, currentDir, outputDir] = process.argv.slice(2);
  if (!baselineDir || !currentDir || !outputDir) {
    console.error('Usage: npx tsx src/test/scripts/compareVisualOutputs.ts <baseline-dir> <current-dir> <output-dir>');
    process.exit(1);
  }
  const files = fs.readdirSync(baselineDir).filter((file) => /\.(png|jpe?g)$/i.test(file)).sort();
  const report: { file: string; changedPct: number; box: string; status: string }[] = [];
  for (const file of files) {
    const currentPath = path.join(currentDir, file);
    if (!fs.existsSync(currentPath)) {
      report.push({ file, changedPct: 0, box: 'n/a', status: 'missing in current' });
      continue;
    }
    const diffPath = path.join(outputDir, `${path.parse(file).name}_diff.png`);
    const { changed, total, box } = await writeDiff(path.join(baselineDir, file), currentPath, diffPath);
    const changedPct = (100 * changed) / total;
    report.push({ file, changedPct, box, status: changed === 0 ? 'identical' : 'differs' });
  }
  for (const entry of report) {
    console.log(`${entry.file.padEnd(24)} ${entry.changedPct.toFixed(3).padStart(7)}%  ${entry.status.padEnd(18)} bbox=${entry.box}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
