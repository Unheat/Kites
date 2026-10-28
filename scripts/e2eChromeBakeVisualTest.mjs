import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');
const imagePath = path.resolve(__dirname, '..', 'src/test/test-img/image6.jpg');

const imageBuffer = fs.readFileSync(imagePath);
const imageBlob = new Blob([imageBuffer], { type: 'image/jpeg' });

const browser = await puppeteer.launch({
  headless: false,
  args: [
    `--disable-extensions-except=${distDir}`,
    `--load-extension=${distDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

try {
  const swTarget = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().includes('chrome-extension://'),
    { timeout: 30000 },
  );
  const extensionId = new URL(swTarget.url()).host;
  console.log('[E2E] Extension ID:', extensionId);

  // Locate actual offscreen target created by background worker and attach CDP console listener
  const offscreenTarget = browser.targets().find((t) => t.url().includes('offscreen.html'));
  if (offscreenTarget) {
    const cdp = await offscreenTarget.createCDPSession();
    await cdp.send('Runtime.enable');
    cdp.send('Console.enable').catch(() => {});
    cdp.on('Runtime.consoleAPICalled', (e) => {
      console.log('[Offscreen Worker Console]', e.args.map((a) => a.value ?? a.description ?? '').join(' '));
    });
  }

  const page = await browser.newPage();
  page.on('console', (msg) => console.log('[Chrome Console]', msg.text()));
  await page.goto(`chrome-extension://${extensionId}/src/offscreen/offscreen.html`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 2000));

  // Set popupState to the exact user settings
  await page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.set({
        popupState: {
          activeEngineId: 'google-translate',
          activeInpaintId: 'simple',
          colorizationMode: 'off',
          activeOcrId: 'v6-medium',
          bubbleMode: 'neural',
          renderFontPresetId: 'comic', // Wild Words
          webgpuMaster: true,
          webgpuSupported: true,
          targetLang: 'en',
        }
      }, resolve);
    });
  });

  console.log('[E2E] Storage configured with user settings.');
  await new Promise((r) => setTimeout(r, 1000));

  // Pre-seed YOLO bubble model into browser CacheStorage so neural bubble detection runs
  const modelPath = path.resolve(__dirname, '..', 'models/manga109_yolo11n_seg_1024.onnx');
  if (fs.existsSync(modelPath)) {
    console.log('[E2E] Seeding YOLO bubble model into Chrome CacheStorage...');
    const modelBytes = fs.readFileSync(modelPath);
    const modelBase64 = modelBytes.toString('base64');
    await page.evaluate(async (mB64) => {
      const url = 'https://huggingface.co/mednasserallah/manga109-segmentation-bubble-onnx/resolve/main/manga109_segmentation_bubble_1024.onnx';
      const cache = await caches.open('kites-bubble-models-v1');
      const byteChars = atob(mB64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const response = new Response(byteArray, { headers: { 'Content-Type': 'application/octet-stream' } });
      await cache.put(url, response);
      console.log('[E2E] Seeded YOLO model into kites-bubble-models-v1 CacheStorage.');
    }, modelBase64);
  }

  // Insert test job into IndexedDB and trigger PROCESS_JOB
  console.log('[E2E] Inserting translation job into IndexedDB...');
  const base64Data = imageBuffer.toString('base64');
  const jobId = await page.evaluate(async (b64) => {
    // Open IndexedDB database 'KitesDatabase'
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('KitesDatabase');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['translationJobs', 'images'], 'readwrite');
        const jobsStore = tx.objectStore('translationJobs');
        const imagesStore = tx.objectStore('images');

        const jobReq = jobsStore.add({
          timestamp: Date.now(),
          status: 'pending',
          srcUrl: 'file://image6.jpg',
        });

        jobReq.onsuccess = () => {
          const newJobId = jobReq.result;
          // Decode b64 to blob
          const byteChars = atob(b64);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'image/jpeg' });

          const imgReq = imagesStore.add({
            jobId: newJobId,
            rawImageBlob: blob,
          });

          imgReq.onsuccess = () => {
            tx.oncomplete = () => resolve(newJobId);
          };
        };
      };
    });
  }, base64Data);

  console.log('[E2E] Job created with ID:', jobId);
  console.log('[E2E] Running PROCESS_JOB in real Chrome offscreen...');

  const startTime = Date.now();
  const bakedBase64 = await page.evaluate(async (id) => {
    return await window.__pipelineOrchestrator.runPipeline(id);
  }, jobId);

  const elapsed = Date.now() - startTime;
  console.log(`[E2E] Pipeline complete in ${elapsed}ms.`);

  if (!bakedBase64) {
    console.error('[E2E] Pipeline failed: no bakedBase64 returned');
    await browser.close();
    process.exit(1);
  }

  const outPath = path.resolve(__dirname, '..', 'src/test/result/e2e_chrome_baked_wildwords.png');
  const buffer = Buffer.from(bakedBase64.split(',')[1], 'base64');
  fs.writeFileSync(outPath, buffer);
  console.log('[E2E] Saved baked image to:', outPath);

  const blocks = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open('KitesDatabase');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('textBlocks', 'readonly');
        const store = tx.objectStore('textBlocks');
        const allReq = store.getAll();
        allReq.onsuccess = () => resolve(allReq.result);
      };
    });
  });

  console.log(`\n--- DB Text Blocks (${blocks.length}) ---`);
  for (const b of blocks) {
    const cpCount = b.contourPoints ? b.contourPoints.length : 0;
    const plCount = b.positionedLines ? b.positionedLines.length : 0;
    console.log(`[#${b.id}] (${Math.round(b.posX)},${Math.round(b.posY)}) ${Math.round(b.width)}x${Math.round(b.height)} font=${b.fontSize} mode=${b.typesetMode} cp=${cpCount} pl=${plCount} orig="${b.originalText}" trans="${b.translatedText}"`);
    if (b.lines) console.log('    lines:', JSON.stringify(b.lines));
    if (b.id === 17) console.log('    cp points:', JSON.stringify(b.contourPoints));
  }

  await browser.close();
  console.log('[E2E] Success!');
} catch (e) {
  console.error('[E2E] Fatal error:', e);
  await browser.close();
  process.exit(1);
}
