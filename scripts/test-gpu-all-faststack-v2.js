import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');

(async () => {
  console.log('================================================================');
  console.log('🚀 FULL GPU ACCELERATION ON (ALL STAGES BENCHMARK V2)');
  console.log('   Translation: gg-translate');
  console.log('   Inpaint: lama-manga');
  console.log('   Config: webgpuMaster = true, ocr = true, inpaint = true');
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

  browser.on('targetcreated', async (t) => {
    try {
      const client = await t.createCDPSession();
      await client.send('Runtime.enable');
      client.on('Runtime.consoleAPICalled', e => {
        const text = e.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
        if (text.includes('[PipelineOrchestrator]') || text.includes('[PaddleOcrEngine]') || text.includes('[LamaMangaInpaintEngine]') || text.includes('[TranslationManager]')) {
          const timestamp = new Date().toISOString().substring(11, 23);
          console.log(`\x1b[36m[${timestamp}]\x1b[0m ${text}`);
        }
      });
    } catch (e) {}
  });

  await new Promise(r => setTimeout(r, 3000));

  const targets = await browser.targets();
  const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
  const extId = extTarget.url().split('/')[2];

  // Set popup state to FULL GPU ACCELERATION ON
  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
  await extPage.evaluate(() => {
    return new Promise(resolve => {
      chrome.storage.local.set({
        popupState: {
          activeEngineId: 'gg-translate',
          activeInpaintId: 'lama-manga',
          fallbackChain: ['Xenova/opus-mt-ja-en'],
          sourceLang: 'auto',
          targetLang: 'en',
          concurrency: 1,
          isAuto: false,
          manualMode: 'hover',
          webgpuSupported: true,
          webgpuMaster: true,
          webgpuOverrides: {
            ocr: true,     // FULL GPU ACCELERATION ON FOR OCR
            inpaint: true, // FULL GPU ACCELERATION ON FOR INPAINTING
            llm: true      // FULL GPU ACCELERATION ON FOR LLM
          }
        }
      }, resolve);
    });
  });
  await extPage.close();

  // Load actual Imgur manga page or create HTML with image load listener
  const page = await browser.newPage();
  await page.goto('https://en.wikipedia.org/wiki/Manga', { waitUntil: 'networkidle0' });

  console.log('\n[Trigger] Finding manga image and triggering translate...');
  const startMs = Date.now();

  const triggered = await page.evaluate(() => {
    const img = Array.from(document.querySelectorAll('img')).find(i => i.clientWidth > 200 && i.clientHeight > 200);
    if (!img) return false;
    img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return true;
  });

  console.log(`[Trigger] Image hovered: ${triggered}. Waiting for button...`);
  await new Promise(r => setTimeout(r, 1500));

  await page.evaluate(() => {
    const btn = document.querySelector('#kites-translate-btn');
    if (btn) btn.click();
  });

  for (let i = 0; i < 240; i++) {
    const isDone = await page.evaluate(() => {
      const img = Array.from(document.querySelectorAll('img')).find(i => i.clientWidth > 200);
      return img && img.src.startsWith('data:image');
    });
    if (isDone) {
      const totalElapsed = ((Date.now() - startMs) / 1000).toFixed(2);
      console.log(`\n🎉 FULL GPU ACCELERATION PIPELINE COMPLETED IN ${totalElapsed}s!`);
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  await browser.close();
})();
