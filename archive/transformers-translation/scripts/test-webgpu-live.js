import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');

(async () => {
  console.log('================================================================');
  console.log('🚀 WEBGPU FULL ACCELERATION LIVE BROWSER TEST');
  console.log('================================================================');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--enable-unsafe-webgpu',
      '--use-webgpu-adapter=swiftshader',
      '--enable-features=Vulkan,UseSkiaRenderer,WebGPU'
    ]
  });

  const logs = [];

  browser.on('targetcreated', async (target) => {
    try {
      const client = await target.createCDPSession();
      await client.send('Runtime.enable');
      client.on('Runtime.consoleAPICalled', e => {
        const text = e.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
        logs.push(text);
        if (text.includes('webgpu') || text.includes('WebGPU') || text.includes('[PipelineOrchestrator]') || text.includes('[PaddleOcrEngine]') || text.includes('[LamaBaseInpaintEngine]') || text.includes('[TransformersEngine]')) {
          console.log(`\x1b[35m[BROWSER LOG]\x1b[0m ${text}`);
        }
      });
    } catch (e) {}
  });

  await new Promise(r => setTimeout(r, 3000));

  const targets = await browser.targets();
  const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
  if (!extTarget) {
    console.error('❌ Extension not found.');
    await browser.close();
    process.exit(1);
  }
  const extId = extTarget.url().split('/')[2];
  console.log(`✅ Loaded Extension ID: ${extId}`);

  // Enable FULL WebGPU acceleration across all 3 engines
  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
  await extPage.evaluate(() => {
    return new Promise(resolve => {
      chrome.storage.local.set({
        popupState: {
          activeEngineId: 'Xenova/opus-mt-ja-en',
          activeInpaintId: 'lama-base',
          sourceLang: 'auto',
          targetLang: 'en',
          concurrency: 1,
          isAuto: false,
          manualMode: 'hover',
          webgpuSupported: true,
          webgpuMaster: true,
          webgpuOverrides: {
            llm: true,
            inpaint: true,
            ocr: true
          }
        }
      }, resolve);
    });
  });
  await extPage.close();

  // Create local HTML page with manga image
  const testHtmlPath = path.join(__dirname, '..', 'scratches', 'webgpu-manga-test.html');
  fs.writeFileSync(testHtmlPath, `
<!DOCTYPE html>
<html>
<head><title>WebGPU Test Page</title></head>
<body style="background: #111; color: #fff; text-align: center; padding: 20px;">
  <h2>WebGPU Acceleration Test Page</h2>
  <img id="manga-target" src="https://i.imgur.com/DvQce3b_d.webp?maxwidth=760&fidelity=grand" crossorigin="anonymous" style="max-width: 650px;" />
</body>
</html>
  `);

  const page = await browser.newPage();
  await page.goto(`file://${testHtmlPath}`, { waitUntil: 'networkidle0' });

  // Pre-download lama-base weights
  console.log('[Setup] Explicitly triggering model downloads...');
  const dlPage = await browser.newPage();
  await dlPage.goto(`chrome-extension://${extId}/popup.html`);
  await dlPage.evaluate(() => {
    chrome.runtime.sendMessage({ type: 'START_MODEL_DOWNLOAD', payload: { modelId: 'lama-base', category: 'inpaint' } });
    chrome.runtime.sendMessage({ type: 'START_MODEL_DOWNLOAD', payload: { modelId: 'Xenova/opus-mt-ja-en' } });
  });
  await dlPage.close();

  await new Promise(r => setTimeout(r, 2000));

  console.log('🚀 Triggering Full WebGPU Pipeline on Manga Image...');
  await page.evaluate(() => {
    const img = document.querySelector('#manga-target');
    if (img) img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });

  await new Promise(r => setTimeout(r, 1000));

  await page.evaluate(() => {
    const btn = document.querySelector('#kites-translate-btn');
    if (btn) btn.click();
  });

  console.log('⌛ Waiting for pipeline execution and logs (up to 120s)...');
  const startTime = Date.now();
  let done = false;

  for (let i = 0; i < 240; i++) {
    const isBase64 = await page.evaluate(() => {
      const img = document.querySelector('#manga-target');
      return img && img.src.startsWith('data:image');
    });

    if (isBase64) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\n🎉 PIPELINE COMPLETED SUCCESSFULLY IN ${elapsed}s!`);
      done = true;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!done) {
    console.error('❌ Pipeline execution timed out.');
  }

  console.log('\n================================================================');
  console.log('📊 ACCELERATION & RUNTIME SUMMARY');
  console.log('================================================================');
  
  const relevantLogs = logs.filter(l => 
    l.includes('[PipelineOrchestrator]') || 
    l.includes('[PaddleOcrEngine]') || 
    l.includes('[LamaBaseInpaintEngine]') || 
    l.includes('[TransformersEngine]') || 
    l.includes('Selected provider') ||
    l.includes('on device:')
  );

  relevantLogs.forEach(l => console.log('  ' + l));

  await browser.close();
})();
