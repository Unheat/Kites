import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');
const screenshotDir = path.join(__dirname, '..', 'scratches', 'test-artifacts', 'studio-v2-verification');

fs.mkdirSync(screenshotDir, { recursive: true });

(async () => {
  console.log('[Visual Test] Launching Chrome with unpacked Kites extension...');
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--window-size=1400,900',
    ],
  });

  try {
    console.log('[Visual Test] Waiting for background service worker...');
    const workerTarget = await browser.waitForTarget(
      (target) => target.type() === 'service_worker',
      { timeout: 10000 }
    );
    const workerUrl = workerTarget.url();
    const extensionId = new URL(workerUrl).host;
    console.log(`[Visual Test] Extension ID: ${extensionId}`);

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    const studioUrl = `chrome-extension://${extensionId}/index.html`;
    console.log(`[Visual Test] Navigating to Studio: ${studioUrl}`);
    await page.goto(studioUrl, { waitUntil: 'networkidle0' });

    // Seed Dexie database with a realistic manga page and text blocks
    console.log('[Visual Test] Seeding Dexie test data...');
    await page.evaluate(async () => {
      // Create a test 600x900 canvas image
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 900;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, 600, 900);
        // Draw some comic panel lines
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.strokeRect(40, 40, 520, 380);
        ctx.strokeRect(40, 460, 520, 400);

        // Draw speech bubble 1
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(180, 180, 100, 60, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw speech bubble 2
        ctx.beginPath();
        ctx.ellipse(420, 680, 90, 70, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

      const dbReq = indexedDB.open('KitesDatabase');
      const db = await new Promise((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result);
        dbReq.onerror = () => reject(dbReq.error);
      });

      const tx = db.transaction(['translationJobs', 'images', 'textBlocks'], 'readwrite');
      const jobsStore = tx.objectStore('translationJobs');
      const imagesStore = tx.objectStore('images');
      const textsStore = tx.objectStore('textBlocks');

      const jobReq = jobsStore.add({
        timestamp: Date.now(),
        status: 'completed',
        srcUrl: 'https://example.com/manga/chapter-1/page-1.webp',
      });

      jobReq.onsuccess = () => {
        const jobId = jobReq.result;
        const imgReq = imagesStore.add({
          jobId: jobId,
          rawImageBlob: blob,
          translatedImageBlob: blob,
        });

        imgReq.onsuccess = () => {
          const imageId = imgReq.result;
          // Add text blocks with realistic Vietnamese/English text
          textsStore.add({
            imageId: imageId,
            originalText: '書道',
            translatedText: 'Thư pháp',
            lines: ['Thư pháp'],
            posX: 120,
            posY: 160,
            width: 120,
            height: 40,
            fontSize: 22,
            fontFamily: 'WildWords, CCWildWords, sans-serif',
            color: '#000000',
            strokeColor: '#ffffff',
            direction: 'h',
          });

          textsStore.add({
            imageId: imageId,
            originalText: '八',
            translatedText: 'Tám mươi tám',
            lines: ['Tám mươi', 'tám'],
            posX: 360,
            posY: 660,
            width: 120,
            height: 50,
            fontSize: 18,
            fontFamily: 'WildWords, CCWildWords, sans-serif',
            color: '#000000',
            strokeColor: '#ffffff',
            direction: 'h',
          });
        };
      };

      await new Promise((resolve) => {
        tx.oncomplete = resolve;
      });
    });

    console.log('[Visual Test] Reloading Studio to pick up seeded data...');
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1500));

    // Capture Default Studio View
    console.log('[Visual Test] Capturing 01_studio_default_view.png...');
    await page.screenshot({
      path: path.join(screenshotDir, '01_studio_default_view.png'),
    });

    // Click on Erase/Restore Tool (Ctrl+1)
    console.log('[Visual Test] Selecting Erase / Restore tool...');
    await page.click('button[title*="Restore / Erase Brush"]');
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({
      path: path.join(screenshotDir, '02_erase_tool_settings.png'),
    });

    // Click on Paint Brush Tool (Ctrl+2)
    console.log('[Visual Test] Selecting Paint tool...');
    await page.click('button[title*="Freehand Paint Brush"]');
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({
      path: path.join(screenshotDir, '03_paint_tool_settings.png'),
    });

    // Click on Inpaint Tool (Ctrl+3)
    console.log('[Visual Test] Selecting Inpaint tool...');
    await page.click('button[title*="Local AI Inpaint"]');
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({
      path: path.join(screenshotDir, '04_inpaint_tool_settings.png'),
    });

    // Open Inpaint Tier Dropdown
    console.log('[Visual Test] Opening Inpaint Tier dropdown...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const dropdown = btns.find((b) => b.querySelector('svg.lucide-chevron-down') && (b.textContent.includes('Fill') || b.textContent.includes('LaMa')));
      if (dropdown) dropdown.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({
      path: path.join(screenshotDir, '04b_inpaint_tier_dropdown_open.png'),
    });
    // Close dropdown
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const dropdown = btns.find((b) => b.querySelector('svg.lucide-chevron-down') && (b.textContent.includes('Fill') || b.textContent.includes('LaMa')));
      if (dropdown) dropdown.click();
    });
    await new Promise((r) => setTimeout(r, 200));

    // Click on OCR Tool (Ctrl+4)
    console.log('[Visual Test] Selecting Re-OCR tool...');
    await page.click('button[title*="OCR"]');
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({
      path: path.join(screenshotDir, '04c_ocr_tool_settings.png'),
    });

    // Click on Text Tool (Ctrl+5) and select first bubble
    console.log('[Visual Test] Selecting Text tool...');
    await page.click('button[title*="Text & Typography"]');
    await new Promise((r) => setTimeout(r, 300));

    // Click on the bubble at (120, 160) inside the canvas
    const canvasEl = await page.$('canvas.cursor-crosshair');
    if (canvasEl) {
      const box = await canvasEl.boundingBox();
      if (box) {
        // Bubble is roughly at 180, 180 in 600x900 image
        const clickX = box.x + (180 / 600) * box.width;
        const clickY = box.y + (180 / 900) * box.height;
        await page.mouse.click(clickX, clickY);
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    await page.screenshot({
      path: path.join(screenshotDir, '05_text_bubble_selected.png'),
    });

    // Toggle Hide Boxes (clean preview)
    console.log('[Visual Test] Toggling Hide Boxes...');
    await page.click('button[title*="Hide Boxes"]');
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({
      path: path.join(screenshotDir, '06_hide_boxes_clean_preview.png'),
    });

    // Toggle Show Original (raw untranslated artwork view)
    console.log('[Visual Test] Toggling Show Original...');
    await page.click('button[title*="Show Original"]');
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({
      path: path.join(screenshotDir, '07_show_original_untranslated_preview.png'),
    });

    // Toggle back to Show Translated
    console.log('[Visual Test] Toggling back to Show Translated...');
    await page.click('button[title*="Show Original"]');
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({
      path: path.join(screenshotDir, '08_show_translated_restored.png'),
    });

    console.log('[Visual Test] All visual test screenshots captured successfully!');
  } finally {
    await browser.close();
  }
})();
