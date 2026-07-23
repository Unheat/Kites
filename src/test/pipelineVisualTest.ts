import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { OcrManager } from '../offscreen/services/OcrManager';
import { InpaintManager } from '../offscreen/services/InpaintManager';
import { renderTextBlocksBatch, type TextBlockItem } from '../offscreen/utils/canvasTypesetting';
import { createCanvas, loadImage } from 'canvas';
import type { Point2D } from '../shared/utils/geometry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPipelineVisualTest() {
  console.log('--- Starting End-to-End Pipeline Visual Test ---');

  const testImgDir = path.join(__dirname, 'test-img');
  const resultBaseDir = path.join(__dirname, 'result', 'pipeline');

  if (fs.existsSync(resultBaseDir)) {
    fs.rmSync(resultBaseDir, { recursive: true, force: true });
  }
  fs.mkdirSync(resultBaseDir, { recursive: true });

  const ocrManager = new OcrManager();
  const inpaintManager = new InpaintManager();

  // We have image1.jpg to image4.jpg and image5.png
  const testFiles = ['image1.jpg', 'image2.jpg', 'image3.jpg', 'image4.jpg', 'image5.png', 'image6.jpg'];

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

    console.log('[PipelineTest] Running OCR text detection...');
    const ocrResult = await ocrManager.processImage(arrayBuffer);
    const polygons = ocrResult.polygons as Point2D[][];
    const texts = ocrResult.texts;
    
    if (!polygons || polygons.length === 0) {
      console.warn(`[PipelineTest] No text polygons detected in ${testFile}. Skipping.`);
      continue;
    }
    console.log(`[PipelineTest] Detected ${polygons.length} text regions.`);

    console.log(`[PipelineTest] Running Inpainting (tier: simple)...`);
    const cleanedBuffer = await inpaintManager.eraseText(arrayBuffer, polygons, 'simple');

    // Simulate Translation with a mock dictionary for visual testing
    const mockDict: Record<string, string> = {
      // image 4
      "それなら問題ありませんよ！": "If that's the case, there's no problem! I won't do it!",
      "重要なのは実用性だね。": "What is truly important is practicality, right?",
      "じっようせい": "practicality",
      "30度回転するし！": "Rotate 30 degrees, I will do it!",
      "かいてん": "rotate",
      "いざとなれば食べられるよーん": "When push comes to shove, it is completely edible~",
      // fallbacks
      "せんよ！": "I won't do it!",
      "問題ありま": "There's no problem.",
      "それなら": "If that's the case,",
      "重要なのは": "What is truly important is",
      "実用性だね。": "Practicality, right?",
      "するし！": "I will do it!",
      "30度回転": "Rotate 30 degrees",
      "食べられるよーん": "It is completely edible~",
      "いざとなれば": "When push comes to shove",
      "休": "REST",
      "やす(む)、やす(まる)、キュウ": "rest(mu), rest(maru), kyuu",
      "ex. 夏休み(なつやすみ) - summer vacation": "ex. 夏休み(natsu yasumi) - summer vacation",
      "ex. 休日(きゅうじつ) - holiday; day off": "ex. 休日(kyuujitsu) - holiday; day off",
      "ノ": "no",
      "1": "1",
      "亻": "person",
      "什": "ten",
      "ちょっと": "a little",
      "休けい。": "rest.",
      "ぜ": "ze",
      "m": "m",
      "はあ": "ha",
      "は-": "ha",
      "あ": "a",
      "はあはあ": "(heavy panting)",
      "ゼーはー": "(slower panting)",
      "ちょっと休けい。": "Time to rest.",
      "这里由我来顶住，老师快撤退，去搬救兵！！": "I'll hold them off here, you all hurry and retreat to get reinforcements!!",
      "要想取胜的话没有别的办法了！": "There is no other way to win!",
      "要是情况危险的活，莲实你也要马上撤退！": "If the situation is dangerous, Hasumi, you must also retreat immediately!",
      "……我知道了！但是千万不要勉强自己！": "......I see! But don't force yourself!",
      "中这样太危险了": "It's too dangerous to get hit like this",
      "在征提挪尽全力的时候": "When putting forth all our strength",
      "敌人太强了…！": "The enemy is too strong...!",
      "这样下去的话…": "If this continues...",
      "明白": "Understood",
      "老师": "Teacher! Please trust me!",
      "打起精神来": "Cheer up",
      "諸都信我！": "Everyone believes me!",
      "莲实！": "Hasumi!",
      "棋老半郎态": "Chess veteran half-hearted"
    };
    const translatedTexts = texts.map(text => {
      // Clean up text
      const cleanText = text.trim();
      const matched = Object.keys(mockDict).find(k => cleanText === k || cleanText.includes(k) && k.length > 2);
      if (matched) return mockDict[matched];
      // Keep English/punctuation as is
      if (/^[a-zA-Z\s.,;-]+$/.test(cleanText)) return cleanText;
      // Default: just use a short placeholder instead of massive text
      return "Translated"; 
    });
    console.log(`[PipelineTest] Baking translated text into Canvas...`);
    
    // Load the cleaned buffer into node-canvas
    const img = await loadImage(Buffer.from(cleanedBuffer));
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    
    // Draw the clean inpainted image
    ctx.drawImage(img, 0, 0);
    
    // Draw all translated text blocks in one batch (Cotrans manga2eng renderer needs the
    // clean page snapshot and cross-block enlarge-ratio negotiation)
    const textBlockItems: TextBlockItem[] = [];
    for (let i = 0; i < translatedTexts.length; i++) {
      const text = translatedTexts[i];
      const poly = polygons[i];
      if (text && poly) {
        textBlockItems.push({
          text,
          polygon: poly,
          direction: ocrResult.directions ? ocrResult.directions[i] : 'h',
          textColor: '#000000',
          strokeColor: '#FFFFFF',
          fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
          angle: ocrResult.angles ? ocrResult.angles[i] : undefined
        });
      }
    }
    renderTextBlocksBatch(ctx as any, textBlockItems, 'en', { width: img.width, height: img.height });
    
    const outPath = path.join(resultBaseDir, testFile);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`[PipelineTest] Saved final baked image to: result/pipeline/${testFile}`);
  }

  await ocrManager.cleanup();
  await inpaintManager.cleanup();
  console.log('\n--- Pipeline Visual Test Complete ---');
}

runPipelineVisualTest().catch(err => {
  console.error('Test execution failed:', err);
});
