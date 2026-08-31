import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');

(async () => {
  console.log('================================================================');
  console.log('⚖️ COMPARATIVE BENCHMARK: FULL GPU ACCELERATION OFF VS FULL ON');
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

  await new Promise(r => setTimeout(r, 3000));

  const targets = await browser.targets();
  const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
  if (!extTarget) {
    console.error('❌ Extension not loaded');
    await browser.close();
    process.exit(1);
  }
  const extId = extTarget.url().split('/')[2];
  console.log(`✅ Extension Loaded. ID: ${extId}`);

  const testHtmlPath = path.join(__dirname, '..', 'scratches', 'compare-test.html');
  fs.writeFileSync(testHtmlPath, `
<!DOCTYPE html>
<html>
<body>
  <img id="manga-target" src="https://i.imgur.com/DvQce3b_d.webp?maxwidth=760&fidelity=grand" crossorigin="anonymous" />
</body>
</html>
  `);

  const runPipelineBenchmark = async (modeName, webgpuConfig) => {
    console.log(`\n================================================================`);
    console.log(`🚀 STARTING RUN: ${modeName}`);
    console.log(`   Config:`, JSON.stringify(webgpuConfig));
    console.log(`================================================================`);

    const runLogs = [];

    const targetHandler = async (t) => {
      try {
        const client = await t.createCDPSession();
        await client.send('Runtime.enable');
        client.on('Runtime.consoleAPICalled', e => {
          const text = e.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
          if (text.includes('[PipelineOrchestrator]') || text.includes('[PaddleOcrEngine]') || text.includes('[LamaBaseInpaintEngine]') || text.includes('[TransformersEngine]') || text.includes('WebGPU') || text.includes('provider') || text.includes('fallback')) {
            runLogs.push(text);
            console.log(`[${modeName}] ${text}`);
          }
        });
      } catch (e) {}
    };

    browser.on('targetcreated', targetHandler);

    // Set popup state
    const extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
    await extPage.evaluate((cfg) => {
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
            webgpuSupported: cfg.master,
            webgpuMaster: cfg.master,
            webgpuOverrides: {
              llm: cfg.llm,
              inpaint: cfg.inpaint,
              ocr: cfg.ocr
            }
          }
        }, resolve);
      });
    }, webgpuConfig);
    await extPage.close();

    const page = await browser.newPage();
    await page.goto(`file://${testHtmlPath}`, { waitUntil: 'networkidle0' });

    // Trigger translation
    const startMs = Date.now();
    await page.evaluate(() => {
      const img = document.querySelector('#manga-target');
      if (img) img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    await new Promise(r => setTimeout(r, 1000));

    await page.evaluate(() => {
      const btn = document.querySelector('#kites-translate-btn');
      if (btn) btn.click();
    });

    let completed = false;
    for (let i = 0; i < 240; i++) {
      const isBase64 = await page.evaluate(() => {
        const img = document.querySelector('#manga-target');
        return img && img.src.startsWith('data:image');
      });
      if (isBase64) {
        completed = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    const elapsedMs = Date.now() - startMs;
    console.log(`\n🏁 [${modeName}] Completed in ${(elapsedMs / 1000).toFixed(2)}s`);

    await page.close();
    browser.off('targetcreated', targetHandler);

    return {
      mode: modeName,
      elapsedMs,
      logs: runLogs
    };
  };

  // Run A: GPU OFF (WASM / CPU)
  const resCpu = await runPipelineBenchmark('GPU_OFF_CPU_WASM', { master: false, ocr: false, inpaint: false, llm: false });

  // Run B: GPU ON (WebGPU)
  const resGpu = await runPipelineBenchmark('GPU_ON_WEBGPU', { master: true, ocr: true, inpaint: true, llm: true });

  console.log('\n================================================================');
  console.log('📊 FINAL COMPARATIVE BENCHMARK SUMMARY');
  console.log('================================================================');
  console.log(`CPU / WASM Run Total: ${(resCpu.elapsedMs / 1000).toFixed(2)}s`);
  console.log(`WebGPU Run Total:     ${(resGpu.elapsedMs / 1000).toFixed(2)}s`);

  await browser.close();
})();
