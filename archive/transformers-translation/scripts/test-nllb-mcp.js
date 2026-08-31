import puppeteer from 'puppeteer';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PORT = 8095;
const CHROME_DEBUG_PORT = 9222;
const MAX_WAIT_CYCLES = 120;
const CYCLE_DELAY_MS = 1000;
const SAMPLE_IMAGE_URL = 'https://i.imgur.com/DvQce3b_d.webp?maxwidth=760&fidelity=grand';

/**
 * Creates a local HTTP server to host the test manga image.
 * 
 * @returns {http.Server} HTTP server instance.
 */
function startTestServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<head><title>NLLB Real Chrome MCP Test</title></head>
<body>
  <h2>Real Chrome Hardware GPU NLLB-200 Test</h2>
  <img id="manga-target" src="${SAMPLE_IMAGE_URL}" width="600" height="850" crossorigin="anonymous" />
</body>
</html>
    `);
  });
  server.listen(SERVER_PORT);
  return server;
}

/**
 * Runs NLLB-200 translation benchmark on the actual Chrome browser connected via DevTools CDP (port 9222).
 */
async function runRealChromeNllbTest() {
  console.log('================================================================');
  console.log('⚡ REAL CHROME BROWSER (PORT 9222) NLLB-200 HARDWARE BENCHMARK');
  console.log('================================================================');

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${CHROME_DEBUG_PORT}`,
      defaultViewport: null
    });
    console.log('✅ Successfully connected to real Chrome browser on port 9222!');
  } catch (err) {
    console.error(`❌ Could not connect to Chrome on port ${CHROME_DEBUG_PORT}. Make sure Chrome is running with remote debugging enabled. Error:`, err.message);
    process.exit(1);
  }

  // Attach console logging across browser targets
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
          console.log(`\x1b[36m[${ts}]\x1b[0m ${text}`);
        }
      });
    } catch (e) {}
  };

  for (const t of await browser.targets()) {
    await attachLogger(t);
  }
  browser.on('targetcreated', attachLogger);

  const targets = await browser.targets();
  const extTarget = targets.find((t) => t.url().includes('chrome-extension://'));
  if (!extTarget) {
    console.error('❌ Extension not found in target Chrome browser. Ensure Kites extension is loaded.');
    process.exit(1);
  }
  const extId = extTarget.url().split('/')[2];
  console.log(`✅ Kites Extension ID: ${extId}`);

  // Set popup state to NLLB-200 + simple inpaint
  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
  await extPage.evaluate(() => {
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
            webgpuMaster: true,
            webgpuOverrides: { ocr: true, inpaint: true, llm: true }
          }
        },
        resolve
      );
    });
  });
  await extPage.close();

  // Open test page in Chrome
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

  console.log('\n[Trigger] Dispatching TRANSLATE_IMAGE to background extension worker...');
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

  console.log('\n================================================================');
  if (finished) {
    console.log(`🎉 REAL CHROME HARDWARE GPU PIPELINE COMPLETED IN ${totalElapsed}s!`);
  } else {
    console.log(`⏱️ TIMED OUT after ${totalElapsed}s`);
  }
  console.log('================================================================');

  await page.close();
}

(async () => {
  const server = startTestServer();
  try {
    await runRealChromeNllbTest();
  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    server.close();
    process.exit(0);
  }
})();
