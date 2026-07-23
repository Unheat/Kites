import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');

(async () => {
  console.log('================================================================');
  console.log('📊 ACCURATE PIPELINE STAGE BENCHMARK');
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

  const runtimes = {};

  browser.on('targetcreated', async (target) => {
    try {
      const client = await target.createCDPSession();
      await client.send('Runtime.enable');
      client.on('Runtime.consoleAPICalled', e => {
        const text = e.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
        if (text.includes('[PipelineOrchestrator]') || text.includes('[PaddleOcrEngine]') || text.includes('[LamaBaseInpaintEngine]') || text.includes('[TransformersEngine]')) {
          console.log(`\x1b[36m[BENCHMARK]\x1b[0m ${text}`);
          if (text.includes('complete in') || text.includes('finished in')) {
            runtimes[text.split(']')[1] || text] = text;
          }
        }
      });
    } catch (e) {}
  });

  await new Promise(r => setTimeout(r, 3000));

  const targets = await browser.targets();
  const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
  const extId = extTarget.url().split('/')[2];

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
          webgpuOverrides: { llm: true, inpaint: true, ocr: true }
        }
      }, resolve);
    });
  });
  await extPage.close();

  const testHtmlPath = path.join(__dirname, '..', 'scratches', 'benchmark.html');
  fs.writeFileSync(testHtmlPath, `
<!DOCTYPE html>
<html>
<body>
  <img id="manga-target" src="https://i.imgur.com/DvQce3b_d.webp?maxwidth=760&fidelity=grand" crossorigin="anonymous" />
</body>
</html>
  `);

  const page = await browser.newPage();
  await page.goto(`file://${testHtmlPath}`, { waitUntil: 'networkidle0' });

  await page.evaluate(() => {
    const img = document.querySelector('#manga-target');
    if (img) img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });

  await new Promise(r => setTimeout(r, 1000));

  await page.evaluate(() => {
    const btn = document.querySelector('#kites-translate-btn');
    if (btn) btn.click();
  });

  for (let i = 0; i < 180; i++) {
    const isDone = await page.evaluate(() => {
      const img = document.querySelector('#manga-target');
      return img && img.src.startsWith('data:image');
    });
    if (isDone) break;
    await new Promise(r => setTimeout(r, 500));
  }

  await browser.close();
})();
