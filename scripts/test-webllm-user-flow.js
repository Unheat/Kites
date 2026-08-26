/**
 * Real-user-flow e2e test: WebLLM translation engine + Simple Fill inpainting + PaddleOCR,
 * with GPU Acceleration fully enabled.
 *
 * This drives the built extension (dist/) exactly the way a person would:
 *   1. Open Chrome with the unpacked extension loaded.
 *   2. Configure Settings (GPU on, WebLLM model selected, Simple Fill, PaddleOCR).
 *   3. Visit a real page with a manga/comic image.
 *   4. Hover the image, click the Kites translate button.
 *   5. Wait for the baked (translated) image to appear.
 *
 * The WebLLM model itself is NOT read from test/model/ -- the extension downloads it
 * from Hugging Face on first run, same as any real user, and caches it in the browser
 * profile's Cache Storage. We use a persistent --user-data-dir so that cache survives
 * across repeated runs of this script (fast iteration while debugging).
 *
 * Usage: node scripts/test-webllm-user-flow.js
 */
import puppeteer from 'puppeteer';
import path from 'path';
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');
const userDataDir = path.join(__dirname, '..', 'test', 'model', '.chrome-profile');
const testImagePath = path.join(__dirname, '..', 'src', 'test', 'test-img', 'image6.jpg');

// Model under test -- matches the reference copy fetched into test/model/ via
// scripts/download-webllm-model.mjs. Smallest model in the app's registry, so the
// real download (from Hugging Face, into the browser's own cache) stays quick.
const WEBLLM_MODEL_ID = 'SmolLM2-135M-Instruct-q0f16-MLC';

// Which translation engine to exercise. Defaults to the WebLLM model under test; pass
// `--engine=gg-translate` to run the identical flow with the network engine instead, which
// isolates how much of the pipeline cost comes from having a local LLM resident in the
// offscreen document versus the OCR/inpaint stages themselves.
const ENGINE_ARG = process.argv.find((a) => a.startsWith('--engine='));
const ACTIVE_ENGINE_ID = ENGINE_ARG ? ENGINE_ARG.split('=')[1] : WEBLLM_MODEL_ID;

// First-run downloads: WebLLM weights (~260MB from Hugging Face) AND PaddleOCR's
// v6-medium detection+recognition .ort models (~140MB combined, from
// media.githubusercontent.com). That GitHub media host has been observed on this
// network throttled to ~200KB/s, which alone can take 10+ minutes -- this is NOT the
// extension hanging, it just looks that way because ppu-paddle-ocr reports no download
// progress. Generous timeout accounts for that; the browser caches everything after
// the first run, so subsequent runs are fast.
const MODEL_INIT_TIMEOUT_MS = 15 * 60 * 1000;
const TRANSLATE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Serves a minimal page hosting the local test manga image (image6.jpg) over http://,
 * so the content script (which only matches http(s)/https URLs) attaches normally --
 * mirrors how a real user would encounter the image on a real webpage.
 */
function startTestImageServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/image6.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      fs.createReadStream(testImagePath).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><body>
      <img id="manga-target" src="/image6.jpg" style="max-width:800px;" />
    </body></html>`);
  });
  // Port 0 = let the OS assign a free ephemeral port. Using a fixed port meant a crashed or
  // still-shutting-down previous run would hold it and fail the next run with EADDRINUSE.
  return new Promise((resolve) => {
    server.listen(0, () => resolve(server));
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clears the Chrome profile's singleton lock left behind when a previous run was interrupted.
 *
 * Puppeteer refuses to launch with "The browser is already running for <userDataDir>" if these
 * lock files survive, which otherwise requires manual cleanup between runs.
 */
function releaseStaleProfileLock() {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const p = path.join(userDataDir, name);
    try {
      if (fs.existsSync(p) || fs.lstatSync(p, { throwIfNoEntry: false })) {
        fs.rmSync(p, { force: true, recursive: true });
        console.log(`[E2E] Removed stale profile lock: ${name}`);
      }
    } catch {
      // Lock may not exist, or may be held by a live browser -- launch will report it clearly.
    }
  }
}

/**
 * Verifies the offscreen document (where WebLLM actually runs) got a real hardware
 * WebGPU adapter, not a software fallback like SwiftShader. Throws if it's software --
 * this project requires real GPU results, so a silent software fallback must fail loud.
 */
async function assertHardwareWebGPU(browser) {
  const offscreenTarget = await browser.waitForTarget((t) => t.url().includes('offscreen.html'), {
    timeout: 15000,
  });
  const client = await offscreenTarget.createCDPSession();
  const { result } = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      if (!navigator.gpu) return { supported: false };
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return { supported: true, adapter: null };
      const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
      return {
        supported: true,
        isFallbackAdapter: adapter.isFallbackAdapter === true,
        vendor: info?.vendor,
        architecture: info?.architecture,
        description: info?.description,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const gpu = result.value;
  console.log('[E2E] WebGPU adapter check (offscreen document):', JSON.stringify(gpu));

  if (!gpu.supported) {
    throw new Error('navigator.gpu is not available in the offscreen document.');
  }
  if (gpu.isFallbackAdapter) {
    throw new Error(
      'WebGPU is using a SOFTWARE fallback adapter (SwiftShader/virtual GPU), not real hardware. ' +
        'This project requires real GPU acceleration for these tests -- check the machine\'s GPU drivers ' +
        'and Chrome GPU flags rather than letting the test run on software rendering.'
    );
  }
}

async function main() {
  const testServer = await startTestImageServer();
  const testServerPort = testServer.address().port;
  console.log(`[E2E] Local test-image server listening on http://localhost:${testServerPort}`);

  releaseStaleProfileLock();
  console.log('[E2E] Launching Chrome with Kites extension (persistent profile)...');
  const browser = await puppeteer.launch({
    headless: false, // extensions + real WebGPU require a real browser window
    userDataDir,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--disable-software-rasterizer', // don't let Chrome silently fall back to SwiftShader
      // On Windows, WebGPU's `powerPreference: 'high-performance'` is IGNORED -- Chrome reuses
      // whichever adapter it already allocated for other Chrome workloads, which on a laptop is
      // the integrated GPU, because Chromium cannot yet composite across GPUs on Windows.
      // Without this switch the engine silently runs on Intel UHD instead of the discrete
      // NVIDIA MX550. See https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
      '--force_high_performance_gpu',
    ],
  });

  const consoleBuffer = [];
  browser.on('targetcreated', async (target) => {
    try {
      const type = target.type();
      if (['service_worker', 'background_page', 'page', 'other'].includes(type)) {
        const client = await target.createCDPSession();
        await client.send('Runtime.enable');
        client.on('Runtime.consoleAPICalled', (e) => {
          const args = e.args.map((a) => (a.value !== undefined ? a.value : a.description)).join(' ');
          const line = `[${type.toUpperCase()}] ${args}`;
          console.log(line);
          consoleBuffer.push(line);
        });
        client.on('Runtime.exceptionThrown', (e) => {
          const line = `[${type.toUpperCase()} EXCEPTION] ${e.exceptionDetails.text} ${e.exceptionDetails.exception?.description || ''}`;
          console.error(line);
          consoleBuffer.push(line);
        });
      }
    } catch {
      // Some targets (e.g. devtools) refuse CDP attach -- safe to ignore.
    }
  });

  try {
    console.log('[E2E] Waiting for the extension service worker to boot...');
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().includes('chrome-extension://'),
      { timeout: 20000 }
    );
    const extId = swTarget.url().split('/')[2];
    console.log(`[E2E] Extension ID: ${extId}`);

    // --- Step 1: Apply Settings exactly as the Settings UI would produce ---
    console.log('[E2E] Opening popup and applying settings (GPU on, WebLLM engine, Simple Fill, PaddleOCR)...');
    const settingsPage = await browser.newPage();
    await settingsPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });

    const popupState = {
      isExtensionEnabled: true,
      isAuto: false,
      manualMode: 'hover',
      concurrency: 1,
      isDark: true,
      sourceLang: 'ja',
      targetLang: 'en',
      activeEngineId: ACTIVE_ENGINE_ID,
      activeInpaintId: 'simple',
      activeOcrId: 'paddle-dbnet',
      fallbackChain: [],
      customApis: [],
      webgpuSupported: true,
      webgpuMaster: true,
      webgpuOverrides: { llm: true, inpaint: true, ocr: true },
    };

    await settingsPage.evaluate((state) => {
      return new Promise((resolve) => chrome.storage.local.set({ popupState: state }, resolve));
    }, popupState);
    console.log('[E2E] Settings applied:', JSON.stringify(popupState));

    // Start every run from an empty job queue. The persistent profile keeps IndexedDB between
    // runs, so a job left in 'processing' by an earlier crashed run would still occupy the
    // single concurrency slot and the pipeline would never start ("Queue at capacity (1/1)").
    // A real user's first run has an empty DB; this reproduces that.
    await settingsPage.evaluate(() => {
      return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('KitesDatabase');
        req.onsuccess = req.onerror = req.onblocked = () => resolve(true);
      });
    });
    console.log('[E2E] Cleared KitesDatabase so the job queue starts empty.');

    // Clear stale jobs. The persistent profile keeps IndexedDB between runs, so a job left in
    // 'processing' by an interrupted run permanently occupies a concurrency slot and the
    // background queue reports "Queue at capacity" and never dispatches the new job.
    const cleared = await settingsPage.evaluate(() => {
      return new Promise((resolve) => {
        const req = indexedDB.open('KitesDatabase');
        req.onsuccess = () => {
          const db = req.result;
          const names = Array.from(db.objectStoreNames);
          if (names.length === 0) return resolve('no stores');
          const tx = db.transaction(names, 'readwrite');
          for (const n of names) tx.objectStore(n).clear();
          tx.oncomplete = () => { db.close(); resolve(`cleared: ${names.join(', ')}`); };
          tx.onerror = () => { db.close(); resolve(`error: ${tx.error?.message}`); };
        };
        req.onerror = () => resolve(`open failed: ${req.error?.message}`);
      });
    });
    console.log(`[E2E] Reset prior job state -> ${cleared}`);

    await settingsPage.close();

    console.log('[E2E] Verifying the offscreen document has real hardware WebGPU (not SwiftShader)...');
    await assertHardwareWebGPU(browser);
    console.log('[E2E] Confirmed: real hardware WebGPU adapter in use.');

    // --- Step 2: Visit a real page and find a translatable image ---
    const testPageUrl = `http://localhost:${testServerPort}/`;
    console.log(`[E2E] Navigating to ${testPageUrl} (image6.jpg)...`);
    const page = await browser.newPage();
    page.on('console', (msg) => console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));
    page.on('pageerror', (err) => console.error('[PAGE ERROR]', err));
    // 'load' rather than 'networkidle0': the page is a single local image, and networkidle0
    // can hang waiting for a 500ms window with zero connections that never arrives.
    await page.goto(testPageUrl, { waitUntil: 'load' });
    await wait(500); // let the content script's MutationObserver attach to the image

    const imageSrc = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const validImg = imgs.find((img) => img.getBoundingClientRect().width > 150);
      return validImg ? validImg.src : null;
    });

    if (!imageSrc) {
      throw new Error('No suitable test image found on the page.');
    }
    console.log(`[E2E] Target image: ${imageSrc}`);

    // --- Step 3: Hover + click, exactly like a real user ---
    await wait(1000); // let the content script's MutationObserver attach the hover button
    console.log('[E2E] Hovering image to reveal the Kites translate button...');
    const hovered = await page.evaluate((targetSrc) => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const img = imgs.find((i) => i.src === targetSrc);
      if (!img) return false;
      img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      return true;
    }, imageSrc);
    if (!hovered) throw new Error('Failed to dispatch hover event on target image.');

    await wait(500);
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('#kites-translate-btn');
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!clicked) throw new Error('Kites translate button did not render after hover.');
    console.log('[E2E] Clicked translate. Waiting for pipeline (WebLLM download + OCR + inpaint + translation)...');

    // --- Step 4: Wait for the real result ---
    const deadline = Date.now() + MODEL_INIT_TIMEOUT_MS + TRANSLATE_TIMEOUT_MS;
    let resultSrc = null;
    while (Date.now() < deadline) {
      resultSrc = await page.evaluate((targetSrc) => {
        const imgs = Array.from(document.querySelectorAll('img'));
        const img = imgs.find((i) => i.src === targetSrc || i.src.startsWith('data:image'));
        return img && img.src.startsWith('data:image/png;base64') ? img.src.slice(0, 60) + '...' : null;
      }, imageSrc);
      if (resultSrc) break;
      await wait(1000);
    }

    if (resultSrc) {
      console.log(`\n[E2E] SUCCESS. Translated image rendered: ${resultSrc}`);
      console.log('\n[E2E] ===== TIMING BREAKDOWN =====');
      consoleBuffer
        .filter((l) => /complete in|finished in|took |Timing:|tok\/s|branch finished/.test(l))
        .forEach((l) => console.log('  ' + l));
      console.log('\n[E2E] ===== TRANSLATION QUALITY =====');
      const pairStart = consoleBuffer.findIndex((l) => l.includes('Translation pairs'));
      if (pairStart !== -1) {
        consoleBuffer.slice(pairStart, pairStart + 40)
          .filter((l) => l.includes('->'))
          .forEach((l) => console.log('  ' + l));
      }
    } else {
      console.error('\n[E2E] FAILED. Translation did not complete within the timeout.');
      console.error('[E2E] Last captured console lines:');
      consoleBuffer.slice(-40).forEach((l) => console.error('  ' + l));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('[E2E] Test crashed:', err);
    console.error('[E2E] Last captured console lines:');
    consoleBuffer.slice(-40).forEach((l) => console.error('  ' + l));
    process.exitCode = 1;
  } finally {
    console.log('[E2E] Closing browser in 3 seconds...');
    await wait(3000);
    await browser.close();
    testServer.close();
  }
}

main();
