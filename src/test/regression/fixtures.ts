import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage, registerFont } from 'canvas';
import { HyphenationService } from '../../offscreen/utils/hyphenation/HyphenationService.js';
import { InpaintManager } from '../../offscreen/services/InpaintManager.js';
import type { OcrFixture, BaselineFixture, TranscriptionFixture } from './fixtureTypes.js';

export const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_ROOT = path.join(TEST_ROOT, 'fixtures');
export const MODEL_PATH = path.resolve(TEST_ROOT, '../../models/manga109_yolo11n_seg_1024.onnx');
export const FONT_FAMILY = 'CCWildWords, sans-serif';

/** Load typed JSON fixture. @param filename - Fixture basename. @returns Parsed saved data. */
export function readFixture<T>(filename: string): T {
  const filenamePath = path.join(FIXTURE_ROOT, filename);
  if (!fs.existsSync(filenamePath)) throw new Error(`Missing required fixture at: ${filenamePath}`);
  return JSON.parse(fs.readFileSync(filenamePath, 'utf-8')) as T;
}

/** Load frozen inputs. @returns OCR, model baseline and fixed same-text transcription. */
export function loadFixtures() {
  return {
    ocr: readFixture<OcrFixture>('image6_ocr_v6_medium.json'),
    baseline: readFixture<BaselineFixture>('image6_neural_baseline_geometry.json'),
    transcription: readFixture<TranscriptionFixture>('image6_koharu_exact_transcription.json'),
  };
}

/** Register native Canvas font and English patterns. @returns Completion after pattern loading. */
export async function initializeHarnessEnvironment(): Promise<void> {
  const fontPath = path.resolve(TEST_ROOT, '../../scratches/reference/xianscan-rust/web/static/fonts/CCWildWords-Roman.ttf');
  if (fs.existsSync(fontPath)) registerFont(fontPath, { family: 'CCWildWords' });
  HyphenationService.setCustomLoader(async (dictName: string) => {
    const filename = path.resolve(TEST_ROOT, '../../public/assets/hyphenation', `${dictName}.txt`);
    return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf-8') : null;
  });
  await HyphenationService.getInstance().loadLanguage('en');
}

/** Load original pixels. @param imagePath - Local input. @returns Native image, RGBA data and buffer. */
export async function loadSourceImage(imagePath: string) {
  const buffer = fs.readFileSync(imagePath);
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return { buffer, image, pixels: ctx.getImageData(0, 0, image.width, image.height) };
}

/** Erase original OCR glyphs locally. @param buffer - Source bytes. @param ocr - Frozen polygons. @returns Cleaned native image. */
export async function cleanSourceImage(buffer: Buffer, ocr: OcrFixture) {
  const manager = new InpaintManager();
  try {
    const cleaned = await manager.eraseText(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      ocr.rawPolygons || ocr.polygons, 'simple',
    );
    return await loadImage(Buffer.from(cleaned));
  } finally {
    await manager.cleanup();
  }
}
