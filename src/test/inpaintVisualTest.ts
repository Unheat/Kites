import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { OcrManager } from '../offscreen/services/OcrManager';
import { InpaintManager, type InpaintTier } from '../offscreen/services/InpaintManager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TIERS: InpaintTier[] = ['none', 'simple', 'telea', 'aot', 'lama-manga'];

async function runInpaintVisualTest() {
  console.log('--- Starting Comprehensive Inpainting Integration Test ---');

  const testImgDir = path.join(__dirname, 'test-img');
  const resultBaseDir = path.join(__dirname, 'result', 'inpainting');

  if (fs.existsSync(resultBaseDir)) {
    fs.rmSync(resultBaseDir, { recursive: true, force: true });
  }
  fs.mkdirSync(resultBaseDir, { recursive: true });

  // Ensure directories for each tier exist
  for (const tier of TIERS) {
    const tierDir = path.join(resultBaseDir, `tier_${tier}`);
    if (!fs.existsSync(tierDir)) {
      fs.mkdirSync(tierDir, { recursive: true });
    }
  }

  const ocrManager = new OcrManager();
  const inpaintManager = new InpaintManager();

  // We have image1.jpg to image4.jpg and image5.png
  const testFiles = ['image1.jpg', 'image2.jpg', 'image3.jpg', 'image4.jpg', 'image5.png'];

  for (const testFile of testFiles) {
    console.log(`\n================================`);
    console.log(`Testing Image: ${testFile}`);
    console.log(`================================`);
    
    const imagePath = path.join(testImgDir, testFile);
    if (!fs.existsSync(imagePath)) {
      console.warn(`[Skip] Test image not found at: ${imagePath}`);
      continue;
    }

    const buffer = fs.readFileSync(imagePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

    console.log('[InpaintTest] Running OCR text detection...');
    const ocrResult = await ocrManager.processImage(arrayBuffer);
    const polygons = ocrResult.rawPolygons || ocrResult.polygons;
    
    if (!polygons || polygons.length === 0) {
      console.warn(`[InpaintTest] No text polygons detected in ${testFile}. Skipping inpainting.`);
      continue;
    }
    console.log(`[InpaintTest] Detected ${polygons.length} text regions.`);

    for (const tier of TIERS) {
      console.log(`\n  -> Running Tier: ${tier.toUpperCase()}`);
      try {
        const start = Date.now();
        const cleanedBuffer = await inpaintManager.eraseText(arrayBuffer, polygons, tier, ocrResult.maskRawCanvas);
        const duration = Date.now() - start;
        console.log(`     Completed in ${duration}ms.`);
        
        const outPath = path.join(resultBaseDir, `tier_${tier}`, testFile);
        fs.writeFileSync(outPath, Buffer.from(cleanedBuffer));
        console.log(`     Saved to: tier_${tier}/${testFile}`);
      } catch (e) {
        console.error(`     [ERROR] Tier ${tier} failed:`, e);
      }
    }
  }

  await ocrManager.cleanup();
  await inpaintManager.cleanup();
  console.log('\n--- Inpainting Visual Test Complete ---');
}

runInpaintVisualTest().catch(err => {
  console.error('Test execution failed:', err);
});
