import puppeteer from 'puppeteer';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '..', 'dist');
const SERVER_PORT = 8093;
const MAX_WAIT_CYCLES = 600;
const CYCLE_DELAY_MS = 500;
const STARTUP_DELAY_MS = 3000;
const SAMPLE_IMAGE_URL = 'https://i.imgur.com/DvQce3b_d.webp?maxwidth=760&fidelity=grand';

/**
 * Creates an HTTP server to serve the sample manga page for benchmark testing.
 * 
 * @returns {http.Server} The running HTTP server instance.
 */
function startTestServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<body>
  <img id="manga-target" src="${SAMPLE_IMAGE_URL}" width="600" height="850" crossorigin="anonymous" />
</body>
</html>
    `);
  });
  server.listen(SERVER_PORT);
  return server;
}

/**
 * Executes the NLLB-200 pipeline benchmark using Puppeteer.
 * 
 * @param {boolean} webgpuMaster - Whether WebGPU acceleration is enabled.
 * @returns {Promise<{ modeName: string, totalElapsed: string, finished: boolean }>} Benchmark performance results.
 */
async function runNllbBenchmark(webgpuMaster) {
  const modeName = webgpuMaster ? '🚀 WEBGPU ON' : '🐢 WEBGPU OFF (WASM)';
  console.log('\n================================================================');
  console.log(`BENCHMARK RUN: ${modeName}`);
  console.log('   Model: Xenova/nllb-200-distilled-600M');
  console.log('   Inpaint: simple fill');
  console.log(`   WebGPU Master: ${webgpuMaster}`);
  console.log('================================================================');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      ...(webgpuMaster ? [
        '--enable-unsafe-webgpu',
        '--use-gl=angle',
        '--use-angle=metal',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
        '--enable-features=Vulkan,UseSkiaRenderer,WebGPU'
      ] : [])
    ]
  });

  const attachLogger = async (target) => {
    try {
      const client = await target.createCDPSession();
      await client.send('Runtime.enable');
      client.on('Runtime.consoleAPICalled', (e) => {
        const text = e.args.map((a) => (a.value !== undefined ? a.value : a.description || '')).join(' ');
        if (
          text.includes('[TransformersEngine]') ||
          text.includes('[PipelineOrchestrator]') ||
          text.includes('[PaddleOcrEngine]') ||
          text.includes('[TranslationManager]')
        ) {
          const ts = new Date().toISOString().substring(11, 23);
          console.log(`[${ts}] ${text}`);
        }
      });
    } catch (e) {}
  };

  for (const t of await browser.targets()) {
    await attachLogger(t);
  }
  browser.on('targetcreated', attachLogger);

  await new Promise((r) => setTimeout(r, STARTUP_DELAY_MS));

  const targets = await browser.targets();
  const extTarget = targets.find((t) => t.url().includes('chrome-extension://'));
  if (!extTarget) {
    throw new Error('Chrome extension target not found.');
  }
  const extId = extTarget.url().split('/')[2];

  // Configure Popup settings to use NLLB-200 + Simple Inpaint
  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
  await extPage.evaluate((webgpuMaster) => {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          popupState: {
            activeEngineId: 'Xenova/nllb-200-distilled-600M',
            activeInpaintId: 'simple',
            fallbackChain: [],
            sourceLang: 'auto',
            targetLang: 'en',
            concurrency: 1,
            isAuto: false,
            manualMode: 'hover',
            webgpuSupported: true,
            webgpuMaster: webgpuMaster,
            webgpuOverrides: { ocr: webgpuMaster, inpaint: webgpuMaster, llm: webgpuMaster }
          }
        },
        resolve
      );
    });
  }, webgpuMaster);
  await extPage.close();

  const page = await browser.newPage();
  await page.goto(`http://localhost:${SERVER_PORT}/`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    return new Promise((resolve) => {
      const img = document.querySelector('#manga-target');
      if (img && img.complete) resolve();
      else if (img) img.onload = resolve;
      else resolve();
    });
  });

  console.log('\n[Trigger] Dispatching TRANSLATE_IMAGE message to background extension...');
  const startMs = Date.now();

  const triggerPage = await browser.newPage();
  await triggerPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
  await triggerPage.evaluate((imgUrl) => {
    chrome.runtime.sendMessage({
      type: 'TRANSLATE_IMAGE',
      url: imgUrl
    });
  }, SAMPLE_IMAGE_URL);
  await triggerPage.close();

  let finished = false;
  let totalElapsed = '0.00';
  for (let i = 0; i < MAX_WAIT_CYCLES; i++) {
    const isDone = await page.evaluate(() => {
      const img = document.querySelector('#manga-target');
      return img && img.src && img.src.startsWith('data:image');
    });

    if (isDone) {
      totalElapsed = ((Date.now() - startMs) / 1000).toFixed(2);
      finished = true;
      break;
    }

    await new Promise((r) => setTimeout(r, CYCLE_DELAY_MS));
  }

  if (finished) {
    console.log(`\n🎉 ${modeName} COMPLETED IN ${totalElapsed}s!\n`);
  } else {
    totalElapsed = ((Date.now() - startMs) / 1000).toFixed(2);
    console.log(`\n⏱️ ${modeName} TIMED OUT (${totalElapsed}s)\n`);
  }

  await browser.close();
  return { modeName, totalElapsed, finished };
}

(async () => {
  const server = startTestServer();
  try {
    // 1. Run WebGPU OFF (WASM)
    const wasmResult = await runNllbBenchmark(false);

    // 2. Run WebGPU ON
    const webgpuResult = await runNllbBenchmark(true);

    console.log('================================================================');
    console.log('📊 FINAL NLLB-200 BENCHMARK SUMMARY (NLLB-200 + simple fill + Paddle)');
    console.log('================================================================');
    console.log(`🐢 WEBGPU OFF (WASM Mode):   ${wasmResult.totalElapsed}s (Success: ${wasmResult.finished})`);
    console.log(`🚀 WEBGPU ON  (WebGPU Mode): ${webgpuResult.totalElapsed}s (Success: ${webgpuResult.finished})`);
    console.log('================================================================');
  } catch (err) {
    console.error('Benchmark execution error:', err);
  } finally {
    server.close();
    process.exit(0);
  }
})();
