/**
 * Real-Chrome bubble probe: loads the built extension in Puppeteer Chrome, boots the
 * offscreen document, and drives STUDIO_OCR on a full page so the YOLO bubble stage
 * runs through the production path (real WebGPU/WASM session, real font environment).
 *
 * A/B switch: --wasm forces the bubble engine's WASM provider (popupState.webgpuMaster
 * off) so Chrome-WebGPU output can be diffed against Chrome-WASM and Node.
 *
 * Usage: node scripts/chromeBubbleProbe.mjs [--wasm] [imagePath]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const forceWasm = process.argv.includes('--wasm');
const imgArg = process.argv.find((arg, i) => i > 0 && !arg.startsWith('--') && arg !== process.argv[1] && arg !== '--wasm');
const imagePath = path.resolve(imgArg ?? path.join(__dirname, '..', 'src/test/test-img/image6.jpg'));
const distDir = path.resolve(__dirname, '..', 'dist');

if (!fs.existsSync(imagePath)) {
  console.error(`Image not found: ${imagePath}`);
  process.exit(1);
}

const imageBuffer = fs.readFileSync(imagePath);
const imageBase64 = imageBuffer.toString('base64');

console.log('================================================================');
console.log(`  Chrome Bubble Probe (provider: ${forceWasm ? 'forced WASM' : 'default WebGPU→WASM'})`);
console.log(`  Image: ${imagePath} (${imageBuffer.length} bytes)`);
console.log('================================================================');

const browser = await puppeteer.launch({
  headless: false, // extensions require the full browser
  args: [
    `--disable-extensions-except=${distDir}`,
    `--load-extension=${distDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

try {
  // Locate the extension id from its service worker.
  const swTarget = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().includes('chrome-extension://'),
    { timeout: 30000 },
  );
  const extensionId = new URL(swTarget.url()).host;
  console.log('[Probe] Extension id:', extensionId);

  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/offscreen/offscreen.html`, { waitUntil: 'load' });

  // Give the offscreen module (and its OCR auto-cache) a beat to settle.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Seed popup state: bubble tier neural, GPU master per flag, webgpu probed true.
  await page.evaluate((forceWasmFlag) => {
    return new Promise((resolve) => {
      chrome.storage.local.get(['popupState'], (result) => {
        const popupState = result.popupState ?? {};
        const next = {
          ...popupState,
          bubbleMode: 'neural',
          webgpuMaster: forceWasmFlag ? false : true,
          webgpuSupported: true,
          activeOcrId: popupState.activeOcrId || 'v6-small',
          activeInpaintId: 'none',
        };
        chrome.storage.local.set({ popupState: next }, () => resolve());
      });
    });
  }, forceWasm);

  // Re-login the storage watcher in the offscreen (it listens for changes).
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const { width, height } = await page.evaluate(async (base64) => {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = (err) => reject(new Error(`Failed to decode probe image: ${err}`));
      img.src = `data:image/jpeg;base64,${base64}`;
    });
  }, imageBase64);
  console.log(`[Probe] Image dimensions: ${width}x${height}`);

  const fullPipeline = !process.argv.includes('--bubbles-only');
  console.log(`[Probe] Driving STUDIO_OCR (translate=${fullPipeline}, inpaint=${fullPipeline})...`);
  const probeStart = Date.now();
  const response = await page.evaluate(async (payload) => {
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          target: 'background',
          source: 'studio',
          request: true,
          type: 'STUDIO_OCR',
          payload,
        },
        (res) => {
          void chrome.runtime.lastError;
          resolve(res ?? { status: 'error', error: 'no response' });
        },
      );
    });
  }, {
    imagePatchBase64: `data:image/jpeg;base64,${imageBase64}`,
    width,
    height,
    offsetX: 0,
    offsetY: 0,
    inpaint: fullPipeline,
    translate: fullPipeline,
  });
  const probeMs = Date.now() - probeStart;

  if (response.status !== 'success') {
    console.error('[Probe] STUDIO_OCR failed:', response.error);
    await browser.close();
    process.exit(2);
  }

  // Save the baked patch so the Chrome render can be inspected against the Node runner.
  if (response.inpaintedPatchBase64) {
    const bakedPath = path.resolve(__dirname, '..', `src/test/result/chrome_bake_${forceWasm ? 'wasm' : 'webgpu'}.png`);
    fs.writeFileSync(bakedPath, Buffer.from(response.inpaintedPatchBase64.split(',')[1] ?? '', 'base64'));
    console.log(`[Probe] Baked image -> ${bakedPath}`);
  }

  const textObjects = response.textObjects ?? [];
  console.log(`[Probe] STUDIO_OCR ok in ${probeMs}ms — ${textObjects.length} text objects`);
  for (const obj of textObjects) {
    const contourCount = obj.contourPoints?.length ?? 0;
    console.log(
      `[ChromeBubble #${obj.id}] box=(${Math.round(obj.x)},${Math.round(obj.y)}) ${Math.round(obj.width)}x${Math.round(obj.height)}` +
      ` fontSize=${obj.fontSize ?? '?'} lines=${obj.lines?.length ?? 0}` +
      ` mode=${obj.typesetMode ?? '?'} rounded=${obj.isRounded ? 1 : 0} contourPts=${contourCount}` +
      ` skipped=${obj.isSkipped ? 1 : 0}`,
    );
    if (obj.lines) for (const line of obj.lines) console.log(`    | "${line}"`);
  }

  // Dump machine-readable output for diffing against the Node run.
  const out = {
    provider: forceWasm ? 'chrome-wasm' : 'chrome-webgpu',
    image: path.basename(imagePath),
    width,
    height,
    textObjects: textObjects.map((obj) => ({
      id: obj.id,
      x: obj.x, y: obj.y, width: obj.width, height: obj.height,
      fontSize: obj.fontSize ?? null,
      lineCount: obj.lines?.length ?? 0,
      lines: obj.lines ?? [],
      typesetMode: obj.typesetMode ?? null,
      isRounded: Boolean(obj.isRounded),
      contourPointCount: obj.contourPoints?.length ?? 0,
      isSkipped: Boolean(obj.isSkipped),
    })),
  };
  const outPath = path.resolve(__dirname, '..', `src/test/result/chrome_bubble_probe_${forceWasm ? 'wasm' : 'webgpu'}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[Probe] Wrote ${outPath}`);
} finally {
  await browser.close();
}
