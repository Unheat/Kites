import puppeteer from 'puppeteer';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');

// Simple HTTP server so content script runs in http:// context
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
<!DOCTYPE html>
<html>
<body>
  <img id="manga-target" src="https://i.imgur.com/DvQce3b_d.webp?maxwidth=760&fidelity=grand" width="600" height="850" crossorigin="anonymous" />
</body>
</html>
  `);
});
server.listen(8089);

async function runBenchmark(webgpuMaster) {
  const modeName = webgpuMaster ? '🚀 FULL GPU ON (WebGPU)' : '🐢 GPU OFF (WASM)';
  console.log('\n================================================================');
  console.log(modeName);
  console.log('   Pipeline: gg-translate + simple fill + PaddleOCR');
  console.log(`   Config: webgpuMaster = ${webgpuMaster}`);
  console.log('================================================================');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
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

  // Attach logger to all browser targets to monitor execution logs
  const attachLogger = async (target) => {
    try {
      const client = await target.createCDPSession();
      await client.send('Runtime.enable');
      client.on('Runtime.consoleAPICalled', e => {
        const text = e.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
        if (text) {
          const ts = new Date().toISOString().substring(11, 23);
          console.log(`[${ts}] ${text}`);
        }
      });
    } catch (e) {}
  };
  for (const t of await browser.targets()) await attachLogger(t);
  browser.on('targetcreated', attachLogger);

  await new Promise(r => setTimeout(r, 3000));

  const targets = await browser.targets();
  const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
  const extId = extTarget.url().split('/')[2];

  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
  await extPage.evaluate((webgpuMaster) => {
    return new Promise(resolve => {
      chrome.storage.local.set({
        popupState: {
          activeEngineId: 'gg-translate',
          activeInpaintId: 'simple',
          fallbackChain: ['Xenova/opus-mt-ja-en'],
          sourceLang: 'auto',
          targetLang: 'en',
          concurrency: 1,
          isAuto: false,
          manualMode: 'hover',
          webgpuSupported: true,
          webgpuMaster: webgpuMaster,
          webgpuOverrides: { ocr: true, inpaint: true, llm: true }
        }
      }, resolve);
    });
  }, webgpuMaster);
  await extPage.close();

  const page = await browser.newPage();
  await page.goto('http://localhost:8089/', { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    return new Promise(resolve => {
      const img = document.querySelector('#manga-target');
      if (img.complete) resolve();
      else img.onload = resolve;
    });
  });

  console.log('\n[Trigger] Dispatching TRANSLATE_IMAGE message to background service worker...');
  const startMs = Date.now();
  const triggerPage = await browser.newPage();
  await triggerPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
  await triggerPage.evaluate(() => {
    chrome.runtime.sendMessage({
      type: 'TRANSLATE_IMAGE',
      url: 'https://i.imgur.com/DvQce3b_d.webp?maxwidth=760&fidelity=grand'
    });
  });
  await triggerPage.close();

  let finished = false;
  let totalElapsed = '0.00';
  for (let i = 0; i < 120; i++) {
    const isDone = await page.evaluate(() => {
      const img = document.querySelector('#manga-target');
      return img && img.src.startsWith('data:image');
    });
    if (isDone) {
      totalElapsed = ((Date.now() - startMs) / 1000).toFixed(2);
      finished = true;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (finished) {
    console.log(`\n🎉 ${modeName} COMPLETED IN ${totalElapsed}s!\n`);
  } else {
    totalElapsed = ((Date.now() - startMs) / 1000).toFixed(2);
    console.log(`\n⏱️ ${modeName} TIMED OUT (${totalElapsed}s)\n`);
  }

  await browser.close();
  return totalElapsed;
}

(async () => {
  const offTime = await runBenchmark(false);
  const onTime = await runBenchmark(true);
  server.close();

  console.log('================================================================');
  console.log('📊 FINAL BENCHMARK SUMMARY (gg-translate + simple fill + paddle)');
  console.log('================================================================');
  console.log(`🐢 GPU OFF (WASM Mode):   ${offTime}s`);
  console.log(`🚀 GPU ON  (WebGPU Mode): ${onTime}s`);
  console.log('================================================================');
})();
