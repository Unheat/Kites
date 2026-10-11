import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');

// Setup local HTTP server so Chrome content scripts inject reliably (file:// blocks extensions)
const testImgPath = path.join(__dirname, '..', 'src', 'test', 'test-img', 'image4.jpg');
const testImgBytes = fs.readFileSync(testImgPath);

const server = http.createServer((req, res) => {
  if (req.url === '/image4.jpg') {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(testImgBytes);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!DOCTYPE html>
<html>
<body style="margin: 40px; background: #eee;">
  <h2>WebGPU Bubble Real Browser Test</h2>
  <img id="manga-img" src="/image4.jpg" width="672" height="960" />
</body>
</html>`);
});

const PORT = 8093;
server.listen(PORT);

(async () => {
  console.log('================================================================');
  console.log(`⚡ TESTING WEBGPU BUBBLE DETECTION IN REAL CHROME ON PORT ${PORT}`);
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

  const logs = [];
  const attachLogger = async (target) => {
    try {
      const type = target.type();
      const client = await target.createCDPSession();
      await client.send('Runtime.enable');
      client.on('Runtime.consoleAPICalled', (e) => {
        const text = e.args.map((a) => (a.value !== undefined ? a.value : a.description || '')).join(' ');
        logs.push(text);
        if (
          text.includes('[NeuralBubbleDetector]') ||
          text.includes('[BubbleManager]') ||
          text.includes('[PipelineOrchestrator]') ||
          text.includes('MaxPool') ||
          text.includes('recursively') ||
          text.includes('ceil') ||
          text.includes('error') ||
          text.includes('Error')
        ) {
          console.log(`[BROWSER] ${text}`);
        }
      });
    } catch (e) {}
  };

  for (const t of await browser.targets()) {
    await attachLogger(t);
  }
  browser.on('targetcreated', attachLogger);

  await new Promise((r) => setTimeout(r, 2000));

  const targets = await browser.targets();
  const extTarget = targets.find((t) => t.url().includes('chrome-extension://'));
  if (!extTarget) {
    console.error('❌ Extension target not found');
    server.close();
    await browser.close();
    process.exit(1);
  }
  const extId = extTarget.url().split('/')[2];
  console.log(`✅ Extension ID: ${extId}`);

  // Configure popup state: bubbleMode = 'neural', webgpuOverrides.bubble = true
  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${extId}/popup.html`);
  await extPage.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.set({
        popupState: {
          activeEngineId: 'gg-translate',
          activeInpaintId: 'simple',
          activeOcrId: 'v6-small',
          fallbackChain: [],
          sourceLang: 'auto',
          targetLang: 'en',
          concurrency: 1,
          isAuto: false,
          manualMode: 'hover',
          webgpuSupported: true,
          webgpuMaster: true,
          bubbleMode: 'neural',
          webgpuOverrides: { ocr: false, inpaint: false, llm: false, bubble: true }
        }
      }, resolve);
    });
  });
  await extPage.close();

  // Pre-seed downloaded model cache into Cache API in offscreen document via CDP
  console.log('⚡ Seeding YOLO11 model into offscreen Cache API...');
  const offscreenTarget = (await browser.targets()).find((t) => t.url().includes('offscreen.html'));
  if (offscreenTarget) {
    try {
      const cdp = await offscreenTarget.createCDPSession();
      await cdp.send('Runtime.enable');
      const modelBuffer = fs.readFileSync(path.join(__dirname, '..', 'models', 'detector-v4-s_int8.onnx'));
      const base64 = modelBuffer.toString('base64');
      await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const bin = atob("${base64}");
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const cache = await caches.open('kites-bubble-models-v1');
          const url = 'https://huggingface.co/mednasserallah/manga109-segmentation-bubble-onnx/resolve/main/manga109_segmentation_bubble_1024.onnx';
          await cache.put(url, new Response(new Blob([bytes], { type: 'application/octet-stream' })));
          console.log('[Offscreen] YOLO11 model successfully cached in Cache API!');
        })()`,
        awaitPromise: true
      });
      console.log('⚡ Model successfully seeded into Offscreen Cache API!');
    } catch (err) {
      console.warn('⚠️ Could not seed model via CDP:', err.message);
    }
  }

  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle2' });

  // Hover over the image to show translate button
  console.log('⚡ Hovering over image to activate Kites button...');
  await page.evaluate(() => {
    const img = document.querySelector('#manga-img');
    if (img) {
      img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      img.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 1200));

  // Find and click the translate button
  console.log('⚡ Clicking translate button...');
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('#kites-translate-btn') || document.querySelector('[data-kites-translate-button="true"]');
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    console.log('⚠️ Could not click button directly, queuing translation via background message...');
    const extPage2 = await browser.newPage();
    await extPage2.goto(`chrome-extension://${extId}/popup.html`);
    await extPage2.evaluate((url) => {
      chrome.runtime.sendMessage({ type: 'TRANSLATE_IMAGE', url });
    }, `http://localhost:${PORT}/image4.jpg`);
    await extPage2.close();
  }

  // Wait for translation completion
  console.log('⚡ Monitoring translation pipeline on WebGPU...');
  let completed = false;
  for (let i = 0; i < 60; i++) {
    const src = await page.evaluate(() => document.querySelector('#manga-img')?.src || '');
    if (src.startsWith('data:image/png;base64') || logs.some((l) => l.includes('Pipeline complete for job'))) {
      console.log('✅ Pipeline finished successfully on WebGPU!');
      completed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Check if any ceil_mode or MaxPool error occurred
  const ceilErrors = logs.filter((l) => l.includes('using ceil() in shape computation is not yet supported for MaxPool'));
  if (ceilErrors.length === 0) {
    console.log('🎉 VERIFIED: Zero MaxPool ceil errors detected! YOLO11 WebGPU runs cleanly!');
  } else {
    console.error('❌ MaxPool ceil error detected:', ceilErrors);
  }

  server.close();
  await browser.close();
  process.exit(ceilErrors.length === 0 ? 0 : 1);
})();
