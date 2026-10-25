import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distPath = path.join(rootDir, 'dist');
const testImgPath = path.join(rootDir, 'src/test/test-img/image1.jpg');
const modelFilePath = path.join(rootDir, 'src/test/models/color/manga-colorize-fp16.onnx');
const resultDir = path.join(rootDir, 'src/test/result');
const PORT = 8765;

async function runE2eColorTest() {
  console.log('--- Starting Playwright Live Browser E2E Colorization Test ---');

  if (!fs.existsSync(distPath)) {
    throw new Error('Dist folder not found. Run "npm run build" first.');
  }
  if (!fs.existsSync(modelFilePath)) {
    throw new Error(`Model file not found at: ${modelFilePath}`);
  }

  // 1. Start local HTTP test server
  const imgBuffer = fs.readFileSync(testImgPath);
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>E2E Manga Colorization Live Test</title></head>
<body style="margin: 20px; background: #1a1a1a; color: white;">
  <h2>Kites E2E Live Manga Colorization Test</h2>
  <img id="test-manga-img" src="/image1.jpg" style="width: 600px; display: block; border: 2px solid #555;" />
</body>
</html>`);
    } else if (req.url === '/image1.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(imgBuffer);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`[Server] Local test HTTP server running at http://127.0.0.1:${PORT}/`);

  const chromePath = puppeteer.executablePath();
  const userDataDir = `/tmp/kites-e2e-color-profile-${Date.now()}`;

  console.log('[Playwright] Launching Chrome with unpacked Kites extension & WebGPU flags...');
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
      '--enable-unsafe-webgpu',
      '--enable-features=WebGPU',
      '--no-sandbox',
    ],
  });

  try {
    await new Promise((r) => setTimeout(r, 2000));
    const extId = 'pcaokchkdgnmfgjkljfpghlfohbdjcmj';

    // 2. Open offscreen document to seed model weights into Cache API
    console.log('[E2E] Opening offscreen document to seed color model weights into Cache API...');
    const offscreenPage = await context.newPage();
    await offscreenPage.goto(`chrome-extension://${extId}/src/offscreen/offscreen.html`);

    const modelBuf = fs.readFileSync(modelFilePath);
    await offscreenPage.evaluate(async (bufBase64) => {
      const raw = atob(bufBase64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const cache = await caches.open('kites-color-models-v1');
      const url = 'https://huggingface.co/Faridzar/manga-colorization-v2-onnx/resolve/main/manga-colorize-fp16.onnx';
      await cache.put(url, new Response(bytes.buffer));
    }, modelBuf.toString('base64'));
    console.log('[E2E] Color model cached in kites-color-models-v1 successfully.');

    // 3. Configure PopupState in chrome.storage.local
    console.log('[E2E] Configuring extension popup settings with Manga Colorizer (AI)...');
    await offscreenPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.storage.local.get('popupState', (data) => {
          const current = data.popupState || {};
          const updated = {
            ...current,
            activeEngineId: 'gg-translate',
            activeInpaintId: 'simple',
            activeColorId: 'manga-colorization-v2',
            activeOcrId: 'v6-small',
            isExtensionEnabled: true,
            webgpuMaster: true,
            webgpuOverrides: { ...(current.webgpuOverrides || {}), color: true },
          };
          chrome.storage.local.set({ popupState: updated }, resolve);
        });
      });
    });

    // 4. Open test manga page
    console.log(`[E2E] Navigating to http://127.0.0.1:${PORT}/ ...`);
    const testPage = await context.newPage();
    await testPage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

    // 5. Hover over image to show Kites hover control
    console.log('[E2E] Hovering over manga image to trigger content script...');
    const imgLocator = testPage.locator('#test-manga-img');
    await imgLocator.hover();

    // 6. Click translate button
    console.log('[E2E] Waiting for #kites-translate-btn to become visible in DOM...');
    const btnLocator = testPage.locator('#kites-translate-btn');
    await btnLocator.waitFor({ state: 'visible', timeout: 10000 });
    console.log('[E2E] Clicking #kites-translate-btn...');
    await btnLocator.click();

    // 7. Wait for live DOM image replacement
    console.log('[E2E] Waiting for pipeline execution and image replacement (blob:)...');
    await testPage.waitForFunction(() => {
      const img = document.querySelector('#test-manga-img');
      return img && img.src && (img.src.startsWith('blob:') || img.getAttribute('data-kites-original-src'));
    }, { timeout: 30000 });

    const finalSrc = await testPage.evaluate(() => document.querySelector('#test-manga-img')?.src);
    console.log(`[E2E] Verified: Image successfully replaced in DOM! Src: ${finalSrc?.slice(0, 50)}...`);

    // 8. Capture screenshot for verification
    fs.mkdirSync(resultDir, { recursive: true });
    const screenshotPath = path.join(resultDir, 'e2e_browser_colorized_dom.png');
    await testPage.screenshot({ path: screenshotPath });
    console.log(`[E2E] Saved browser screenshot to: ${screenshotPath}`);

    // 9. Quantitative color validation in DOM
    const colorStats = await testPage.evaluate(() => {
      const img = document.querySelector('#test-manga-img');
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let coloredPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const delta = Math.abs(data[i] - data[i + 1]) + Math.abs(data[i + 1] - data[i + 2]);
        if (delta > 15) coloredPixels++;
      }
      return {
        totalPixels: data.length / 4,
        coloredPixels,
        colorRatio: (coloredPixels / (data.length / 4) * 100).toFixed(1) + '%',
      };
    });
    console.log('[E2E] Quantitative color analysis:', colorStats);

    if (colorStats.coloredPixels < 1000) {
      throw new Error(`Colorization check failed: Only ${colorStats.coloredPixels} colored pixels found.`);
    }

    console.log('--- Playwright Live Browser E2E Test Passed Successfully! ---');
  } finally {
    await context.close();
    server.close();
  }
}

runE2eColorTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[E2E] Test Error:', err);
    process.exit(1);
  });
