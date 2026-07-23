import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');

(async () => {
  console.log('================================================================');
  console.log('⚡ REAL BROWSER WEBGPU ACCELERATION PIPELINE BENCHMARK');
  console.log('================================================================');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--enable-unsafe-webgpu',
      '--use-webgpu-adapter=swiftshader-or-default'
    ]
  });

  const swLogs = [];
  browser.on('targetcreated', async (target) => {
    const type = target.type();
    if (type === 'service_worker' || type === 'page' || type === 'other') {
      try {
        const client = await target.createCDPSession();
        await client.send('Runtime.enable');
        client.on('Runtime.consoleAPICalled', e => {
          const text = e.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
          swLogs.push(text);
          if (text.includes('[PipelineOrchestrator]') || text.includes('[InpaintManager]') || text.includes('[OcrManager]') || text.includes('[TranslationManager]')) {
            console.log(`\x1b[33m[GPU LOG]\x1b[0m ${text}`);
          }
        });
      } catch (e) {}
    }
  });

  await new Promise(r => setTimeout(r, 3000));

  const targets = await browser.targets();
  const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
  if (!extTarget) {
    console.error('❌ Extension target not found');
    await browser.close();
    process.exit(1);
  }
  const extId = extTarget.url().split('/')[2];
  console.log(`✅ Extension ID: ${extId}`);

  const setGpuState = async (engineId, inpaintId) => {
    const extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${extId}/popup.html`);
    await extPage.evaluate((eId, iId) => {
      return new Promise(resolve => {
        chrome.storage.local.set({
          popupState: {
            activeEngineId: eId,
            activeInpaintId: iId,
            fallbackChain: ['Xenova/opus-mt-ja-en'],
            sourceLang: 'auto',
            targetLang: 'en',
            concurrency: 1,
            isAuto: false,
            manualMode: 'hover',
            webgpuSupported: true,
            webgpuMaster: true,
            webgpuOverrides: { ocr: true, inpaint: true, llm: true }
          }
        }, resolve);
      });
    }, engineId, inpaintId);
    await extPage.close();
  };

  const testHtmlPath = path.join(__dirname, '..', 'scratches', 'gpu-manga-test.html');
  fs.writeFileSync(testHtmlPath, `
<!DOCTYPE html>
<html>
<body>
  <h1>WebGPU Benchmark Target</h1>
  <img id="gpu-img" src="https://i.imgur.com/DvQce3b_d.webp?maxwidth=760&fidelity=grand" crossorigin="anonymous" />
</body>
</html>
  `);

  const page = await browser.newPage();
  await page.goto(`file://${testHtmlPath}`, { waitUntil: 'networkidle0' });

  const benchmarkTier = async (label, engineId, inpaintId) => {
    console.log(`\n======================================================`);
    console.log(`🎮 BENCHMARKING: ${label}`);
    console.log(`   GPU Master: ENABLED | Overrides: ALL TRUE`);
    console.log(`   Engine: ${engineId} | Inpaint: ${inpaintId}`);
    console.log(`======================================================`);

    await setGpuState(engineId, inpaintId);

    // Download model weights
    const extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${extId}/popup.html`);
    if (inpaintId !== 'simple' && inpaintId !== 'none') {
      console.log(`[GPU] Prefetching inpaint weights for ${inpaintId}...`);
      await extPage.evaluate((id) => {
        return new Promise(r => chrome.runtime.sendMessage({ type: 'START_MODEL_DOWNLOAD', payload: { modelId: id, category: 'inpaint' } }, r));
      }, inpaintId);
    }
    if (engineId !== 'gg-translate') {
      console.log(`[GPU] Prefetching translation weights for ${engineId}...`);
      await extPage.evaluate((id) => {
        return new Promise(r => chrome.runtime.sendMessage({ type: 'START_MODEL_DOWNLOAD', payload: { modelId: id } }, r));
      }, engineId);
    }
    await extPage.close();

    // Trigger image translation on page
    await page.evaluate(() => {
      const img = document.querySelector('#gpu-img');
      if (img) img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 800));

    await page.evaluate(() => {
      const btn = document.querySelector('#kites-translate-btn');
      if (btn) btn.click();
    });

    // Wait for translation output base64
    const start = Date.now();
    let done = false;
    for (let i = 0; i < 200; i++) {
      const src = await page.evaluate(() => document.querySelector('#gpu-img')?.src || '');
      if (src.startsWith('data:image')) {
        const wallTime = ((Date.now() - start) / 1000).toFixed(2);
        console.log(`✅ [${label}] COMPLETED IN ${wallTime}s Wall Time! Base64 result length: ${src.length}`);
        done = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!done) {
      console.error(`❌ [${label}] Timed out.`);
    }
  };

  // Run all 3 inpainting tiers with GPU acceleration
  await benchmarkTier('Tier 1: LaMa Base (WebGPU)', 'gg-translate', 'lama-base');
  await benchmarkTier('Tier 2: LaMa Manga (WebGPU)', 'gg-translate', 'lama-manga');
  await benchmarkTier('Tier 3: AOT-GAN (WebGPU)', 'gg-translate', 'aotgan');

  // Run Transformers & WebLLM models with GPU acceleration
  await benchmarkTier('Transformers GPU (Xenova/opus-mt-ja-en)', 'Xenova/opus-mt-ja-en', 'simple');
  await benchmarkTier('WebLLM GPU (SmolLM2-135M-Instruct-q0f16-MLC)', 'SmolLM2-135M-Instruct-q0f16-MLC', 'simple');

  console.log('\n======================================================');
  console.log('🎉 ALL WEBGPU ACCELERATION RUNS COMPLETE!');
  console.log('======================================================');

  await browser.close();
})();
