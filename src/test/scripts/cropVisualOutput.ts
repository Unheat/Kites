/**
 * Crops a region out of a visual-test output so two runs can be compared side by side.
 *
 * Usage:
 *   npx tsx src/test/scripts/cropVisualOutput.ts <src.png> <out.png> <x> <y> <w> <h>
 */
import * as fs from 'fs';
import { createCanvas, loadImage } from 'canvas';

const [source, output, x, y, width, height] = process.argv.slice(2);
if (!source || !output) {
  console.error('Usage: npx tsx src/test/scripts/cropVisualOutput.ts <src.png> <out.png> <x> <y> <w> <h>');
  process.exit(1);
}
const image = await loadImage(source);
const canvas = createCanvas(Number(width), Number(height));
canvas.getContext('2d').drawImage(
  image, Number(x), Number(y), Number(width), Number(height), 0, 0, Number(width), Number(height),
);
fs.writeFileSync(output, canvas.toBuffer('image/png'));
