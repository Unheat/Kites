import puppeteer from 'puppeteer';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');

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

(async () => {
  console.log('🔍 DIAGNOSTIC: Tracing full message flow through extension\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
    ]
  });

  const attachLogger = async (target) => {
    const type = target.type();
    const url = target.url();
    try {
      const client = await target.createCDPSession();
      await client.send('Runtime.enable');
      client.on('Runtime.consoleAPICalled', e => {
        const text = e.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
        if (url.includes('chrome-extension://') || text.includes('[Background]') || text.includes('[Content') || text.includes('[Offscreen]') || text.includes('[Pipeline') || text.includes('[Translation') || text.includes('[Paddle')) {
          const ts = new Date().toISOString().substring(11, 23);
          console.log(`\x1b[33m[${ts}] [${type}]\x1b[0m ${text}`);
        }
      });
      console.log(`  ✅ Attached CDP logger to: ${type} → ${url.substring(0, 80)}`);
    } catch (e) {
      console.log(`  ⚠️  Could not attach to ${type}: ${e.message}`);
    }
  };

  console.log('📡 Attaching to existing targets...');
  for (const t of await browser.targets()) {
    await attachLogger(t);
  }
  browser.on('targetcreated', attachLogger);

  await new Promise(r => setTimeout(r, 3000));

  const targets = await browser.targets();
  const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
  const extId = extTarget?.url().split('/')[2];
  console.log(`\n🔑 Extension ID: ${extId}\n`);

  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
  await extPage.evaluate(() => {
    return new Promise(resolve => {
      chrome.storage.local.set({
        popupState: {
          activeEngineId: 'gg-translate',
          activeInpaintId: 'simple',
          fallbackChain: [],
          sourceLang: 'auto',
          targetLang: 'en',
          concurrency: 1,
          isAuto: false,
          manualMode: 'hover',
          webgpuSupported: true,
          webgpuMaster: false,
          webgpuOverrides: { ocr: true, inpaint: true, llm: true }
        }
      }, resolve);
    });
  });
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

  console.log('\n🖱️  Step 1: Hovering over image...');
  await page.evaluate(() => {
    const img = document.querySelector('#manga-target');
    if (img) {
      img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 1500));

  const hasButton = await page.evaluate(() => !!document.querySelector('#kites-translate-btn'));
  console.log(`🔘 Translate button visible: ${hasButton}`);

  if (!hasButton) {
    await browser.close();
    server.close();
    return;
  }

  console.log('\n🖱️  Step 2: Clicking translate button...');
  const startMs = Date.now();
  await page.evaluate(() => {
    const btn = document.querySelector('#kites-translate-btn');
    if (btn) btn.click();
  });

  console.log('\n⏳ Waiting for pipeline to complete (max 60s)...\n');
  
  let finished = false;
  for (let i = 0; i < 120; i++) {
    const isDone = await page.evaluate(() => {
      const img = document.querySelector('#manga-target');
      return img && img.src.startsWith('data:image');
    });
    if (isDone) {
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(2);
      console.log(`\n🎉 Pipeline COMPLETED in ${elapsed}s!`);
      finished = true;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!finished) {
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(2);
    console.log(`\n❌ Pipeline TIMED OUT after ${elapsed}s`);
  }

  await browser.close();
  server.close();
})();
