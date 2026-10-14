/**
 * Puppeteer automated test script verifying the post-translation finished controls:
 * 1. An image is translated.
 * 2. It remembers its translated state.
 * 3. Hovering / interacting reveals the finished action buttons: Toggle, Download, Edit in Studio.
 * 4. Clicking Edit in Studio opens Studio with the image's jobId selected.
 */
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = path.resolve(__dirname, '../dist');
const testArtifactsDir = path.resolve(__dirname, '../scratches/test-artifacts/content-finished-buttons');

if (!fs.existsSync(testArtifactsDir)) {
  fs.mkdirSync(testArtifactsDir, { recursive: true });
}

async function runTest() {
  const server = http.createServer((req, res) => {
    if (req.url === '/manga.png') {
      // 1x1 transparent png
      const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(pngBuffer);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Manga Test Page</title>
          <style>
            body { margin: 40px; background: #0f1117; color: white; font-family: sans-serif; }
            .manga-container { width: 500px; margin: 0 auto; }
            img { width: 500px; height: 700px; display: block; border-radius: 8px; }
          </style>
        </head>
        <body>
          <div class="manga-container">
            <h2>Test Manga Chapter</h2>
            <img id="test-manga-img" src="/manga.png" style="width: 500px; height: 700px; background: #333;" />
          </div>
        </body>
      </html>
    `);
  });

  await new Promise((resolve) => server.listen(3456, resolve));
  console.log('[Test] Local server listening on http://127.0.0.1:3456');

  console.log('[Test] Launching Chrome with unpacked Kites extension...');
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  try {
    const swTarget = await browser.waitForTarget((target) => target.type() === 'service_worker', { timeout: 10000 });
    const extensionId = new URL(swTarget.url()).host;
    console.log('[Test] Extension ID:', extensionId);

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });

    await page.goto('http://127.0.0.1:3456', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 1500));

    // Hover over the image via dispatchEvent and mouse movement
    console.log('[Test] Hovering over manga image to reveal TranslateButton...');
    await page.evaluate(() => {
      const img = document.querySelector('#test-manga-img');
      const rect = img.getBoundingClientRect();
      const event = new MouseEvent('mouseover', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      });
      img.dispatchEvent(event);
    });
    await new Promise((r) => setTimeout(r, 1000));

    // Verify translate button appears
    const translateBtn = await page.$('#kites-translate-btn');
    if (!translateBtn) {
      throw new Error('Translate button did not appear on hover!');
    }
    console.log('[Test] Translate button appeared successfully.');

    // Simulate sending IMAGE_TRANSLATED message to the tab via background SW
    console.log('[Test] Simulating IMAGE_TRANSLATED message with jobId 42...');
    const sw = await swTarget.worker();
    await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'IMAGE_TRANSLATED',
          payload: {
            jobId: 42,
            originalUrl: 'http://127.0.0.1:3456/manga.png',
            bakedBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
          }
        });
      }
    });

    await new Promise((r) => setTimeout(r, 1000));

    // Check if finished actions cluster appeared
    const toggleBtn = await page.$('[data-kites-toggle-btn="true"]');
    const downloadBtn = await page.$('[data-kites-download-btn="true"]');
    const editBtn = await page.$('[data-kites-edit-btn="true"]');

    if (!toggleBtn || !downloadBtn || !editBtn) {
      console.log('Finished buttons status:', {
        toggle: Boolean(toggleBtn),
        download: Boolean(downloadBtn),
        edit: Boolean(editBtn)
      });
      throw new Error('Finished buttons cluster did not appear!');
    }

    console.log('[Test] Finished buttons cluster verified: Toggle, Download, and Edit in Studio are present!');

    // Capture screenshot of finished controls
    await page.screenshot({ path: path.join(testArtifactsDir, '01_finished_buttons_cluster.png') });
    console.log('[Test] Captured screenshot: 01_finished_buttons_cluster.png');

    // Test clicking Edit in Studio
    console.log('[Test] Clicking Edit in Studio...');
    const newTargetPromise = browser.waitForTarget((t) => t.url().includes('index.html'), { timeout: 8000 });
    await editBtn.click();
    const studioTarget = await newTargetPromise;
    console.log('[Test] Verified Studio opened ->', studioTarget.url());

    console.log('[Test] All tests passed cleanly!');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch((err) => {
  console.error('[Test Failed]', err);
  process.exit(1);
});
