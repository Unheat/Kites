import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage } from 'canvas';
import { OcrManager } from '../offscreen/services/OcrManager';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Executes a visual integration test on a set of pre-selected test images,
 * running the OCR pipeline on each, drawing cyan/red polygons, and outputting
 * marked visual images to the result directory.
 * 
 * @returns A promise that resolves when the test execution is complete.
 */
async function runVisualTest() {
  console.log('--- Starting OCR Visual Integration Test ---');
  
  const testImgDir = path.join(__dirname, 'test-img');
  const resultDir = path.join(__dirname, 'result', 'ocr-raw');
  
  if (!fs.existsSync(resultDir)) {
    fs.mkdirSync(resultDir, { recursive: true });
  }

  // Get all images from test-img folder
  const testImages = [
    'image1.jpg',
    'image2.jpg',
    'image3.jpg',
    'image4.jpg',
    'image5.png',
    'image6.jpg'
  ];

  const files = fs.readdirSync(testImgDir).filter((file: string) => 
    file.endsWith('.jpg') || file.endsWith('.png')
  );

  const filesToProcess = files.filter((file: string) => testImages.includes(file));

  if (filesToProcess.length === 0) {
    console.error('No matching images found in src/test/test-img/');
    return;
  }

  const manager = new OcrManager();

  for (const file of filesToProcess) {
    console.log(`\nProcessing: ${file}`);
    const imagePath = path.join(testImgDir, file);
    
    // Read file into ArrayBuffer
    const buffer = fs.readFileSync(imagePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

    const startTime = Date.now();
    
    // Run OCR Detection and Recognition
    const result = await manager.processImage(arrayBuffer);
    
    const rawPolygons = result.rawPolygons || result.polygons || [];
    console.log(`OCR took ${Date.now() - startTime}ms. Found ${rawPolygons.length} RAW text regions.`);

    // Load image into Canvas to draw boxes
    const image = await loadImage(buffer);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');

    // Draw original image
    ctx.drawImage(image, 0, 0);

    // Draw bounding boxes and text
    ctx.lineWidth = 3;

    rawPolygons.forEach((poly, index) => {
      // Draw pure JS perfectly rotated polygons in Cyan
      if (poly && poly.length >= 4) {
        ctx.strokeStyle = 'cyan';
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        ctx.lineTo(poly[1].x, poly[1].y);
        ctx.lineTo(poly[2].x, poly[2].y);
        ctx.lineTo(poly[3].x, poly[3].y);
        ctx.closePath();
        ctx.stroke();
      }
    });

    // Save result image
    const outPath = path.join(resultDir, `out_${file}`);
    const outBuffer = canvas.toBuffer('image/jpeg');
    fs.writeFileSync(outPath, outBuffer);
    
    console.log(`Saved visual result to: ${outPath}`);
  }

  await manager.cleanup();
  console.log('\n--- Test Complete ---');
}

runVisualTest().catch(console.error);
