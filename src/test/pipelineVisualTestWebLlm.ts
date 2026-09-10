import puppeteer, { type Browser, type CDPSession, type Target } from 'puppeteer';
import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../dist');
const USER_DATA_DIR = path.resolve(__dirname, '../../test/model/.chrome-profile-webllm-visual');
const TEST_IMAGE_DIR = path.resolve(__dirname, 'test-img');
const RESULT_DIR = path.resolve(process.cwd(), 'result/pipeline_webllm');
const WEBLLM_MODEL_ID = process.env.WEBLLM_MODEL_ID || 'Qwen2.5-3B-Instruct-q4f16_1-MLC';
const WEBLLM_NO_FEWSHOT = process.env.WEBLLM_NO_FEWSHOT === '1';
const TRANSLATE_TIMEOUT_MS = 15 * 60 * 1000;
const TARGET_TIMEOUT_MS = 30_000;
const TEST_FILES = ['image1.jpg', 'image2.jpg', 'image3.jpg', 'image4.jpg', 'image5.png', 'image6.jpg', 'image7.jpg'];
const BUTTON_SELECTOR = '[data-kites-translate-button], #kites-translate-btn';
const TRANSLATED_IMAGE_SELECTOR = 'img[data-kites-translated="true"][data-kites-applied-src^="blob:"]';
type TranslationLogEntry = { file: string; source: string; translated: string };

/**
 * Serves one test image per page for content-script translation.
 * @returns HTTP server after it starts listening on a random local port.
 */
function startTestImageServer(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const fileName = decodeURIComponent(request.url?.replace(/^\//, '') || '');
      const filePath = path.join(TEST_IMAGE_DIR, fileName);
      if (!TEST_FILES.includes(fileName) || !fs.existsSync(filePath)) {
        response.writeHead(404).end('Not Found');
        return;
      }
      response.writeHead(200, { 'Content-Type': path.extname(filePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg' });
      fs.createReadStream(filePath).pipe(response);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/**
 * Removes stale profile locks while preserving downloaded model caches.
 * @returns Nothing.
 */
function releaseStaleProfileLock(): void {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    fs.rmSync(path.join(USER_DATA_DIR, name), { force: true, recursive: true });
  }
}

/**
 * Attaches console capture to one existing or newly-created extension target.
 * @param target - Puppeteer browser target to inspect.
 * @param extensionId - Extension ID, when already known.
 * @param consoleBuffer - Shared captured console lines.
 * @param sessions - Sessions retained until browser shutdown.
 * @returns Promise resolved after attachment or safe rejection.
 */
async function attachConsoleCapture(
  target: Target,
  extensionId: string | undefined,
  consoleBuffer: string[],
  sessions: CDPSession[],
): Promise<void> {
  if (extensionId && !target.url().startsWith(`chrome-extension://${extensionId}/`)) return;
  if (!extensionId && !target.url().startsWith('chrome-extension://')) return;
  try {
    const session = await target.createCDPSession();
    sessions.push(session);
    await session.send('Runtime.enable');
    session.on('Runtime.consoleAPICalled', (event) => {
      const args = event.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
      const line = `[${target.type().toUpperCase()}] ${args}`;
      consoleBuffer.push(line);
      console.log(line);
    });
  } catch (error) {
    console.warn(`[WebLLM-E2E] Could not capture target ${target.url()}:`, error);
  }
}

/**
 * Verifies an offscreen extension target can create a non-fallback WebGPU device.
 * @param browser - Running browser instance.
 * @param extensionId - Loaded extension ID.
 * @returns Promise resolved after hardware validation.
 */
async function assertHardwareWebGpuInOffscreen(
  browser: Browser,
  extensionId: string,
  consoleBuffer: string[],
  sessions: CDPSession[],
): Promise<void> {
  const offscreenTarget = await browser.waitForTarget(
    (target) => target.url().startsWith(`chrome-extension://${extensionId}/`) && target.url().includes('offscreen'),
    { timeout: TARGET_TIMEOUT_MS },
  );
  const session = await offscreenTarget.createCDPSession();
  sessions.push(session);
  await session.send('Runtime.enable');
  session.on('Runtime.consoleAPICalled', (event) => {
    const args = event.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
    const line = `[OFFSCREEN] ${args}`;
    consoleBuffer.push(line);
    console.log(line);
  });
  const result = await session.send('Runtime.evaluate', {
    expression: `(async () => {
      globalThis.__KITES_WEBLLM_NO_FEWSHOT__ = ${WEBLLM_NO_FEWSHOT ? 'true' : 'false'};
      if (!navigator.gpu) return { ok: false, reason: 'navigator.gpu unavailable' };
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return { ok: false, reason: 'high-performance adapter unavailable' };
      const info = adapter.info || {};
      if (adapter.isFallbackAdapter === true || info.isFallbackAdapter === true) {
        return { ok: false, reason: 'fallback/software adapter', info };
      }
      const device = await adapter.requestDevice();
      device.destroy();
      return { ok: true, info };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const probe = result.result.value as { ok?: boolean; reason?: string; info?: unknown } | undefined;
  if (!probe?.ok) throw new Error(`Real hardware WebGPU unavailable in offscreen: ${probe?.reason || 'probe failed'}`);
  console.log('[WebLLM-E2E] Offscreen hardware WebGPU verified:', JSON.stringify(probe.info));
}

/**
 * Extracts newly captured pipeline source/translated pairs.
 * @param file - Test image name owning these console lines.
 * @param lines - New console lines for the image.
 * @returns Parsed translation log entries.
 */
function extractTranslationPairs(file: string, lines: string[]): TranslationLogEntry[] {
  const entries: TranslationLogEntry[] = [];
  const pairPattern = /\[\d+\]\s+["“](.*?)["”]\s*->\s*["“](.*?)["”]/;
  for (const line of lines) {
    const match = line.match(pairPattern);
    if (!match) continue;
    const entry = { file, source: match[1], translated: match[2] };
    entries.push(entry);
    console.log(`[WebLLM-E2E] ${file}: "${entry.source}" -> "${entry.translated}"`);
  }
  return entries;
}

/**
 * Runs browser-driven WebLLM visual translation against all baseline images.
 * @returns Promise resolved after PNG and JSON artifacts are saved.
 */
async function main(): Promise<void> {
  if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) throw new Error('Extension not built. Run `npm run build` first.');
  for (const file of TEST_FILES) {
    if (!fs.existsSync(path.join(TEST_IMAGE_DIR, file))) throw new Error(`Missing baseline image: ${file}`);
  }
  fs.rmSync(RESULT_DIR, { recursive: true, force: true });
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  releaseStaleProfileLock();

  let server: http.Server | undefined;
  let browser: Browser | undefined;
  const consoleBuffer: string[] = [];
  const sessions: CDPSession[] = [];
  const translationLog: TranslationLogEntry[] = [];
  let generatedImageCount = 0;

  try {
    server = await startTestImageServer();
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port.');
    browser = await puppeteer.launch({
      headless: false,
      userDataDir: USER_DATA_DIR,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--enable-unsafe-webgpu',
        '--ignore-gpu-blocklist',
        '--disable-software-rasterizer',
        '--force_high_performance_gpu',
      ],
    });

    const serviceWorker = await browser.waitForTarget(
      (target) => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'),
      { timeout: TARGET_TIMEOUT_MS },
    );
    const extensionId = new URL(serviceWorker.url()).host;
    browser.on('targetcreated', (target) => void attachConsoleCapture(target, extensionId, consoleBuffer, sessions));
    await Promise.all(browser.targets().map((target) => attachConsoleCapture(target, extensionId, consoleBuffer, sessions)));

    const settingsPage = await browser.newPage();
    try {
      await settingsPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
      await settingsPage.evaluate((modelId, noFewShot) => new Promise<void>((resolve) => {
        (globalThis as any).__KITES_WEBLLM_NO_FEWSHOT__ = noFewShot;
        chrome.storage.local.set({ popupState: {
          isExtensionEnabled: true, isAuto: false, manualMode: 'persistent', concurrency: 1,
          sourceLang: 'ja', targetLang: 'en', activeEngineId: modelId,
          activeInpaintId: 'simple', activeOcrId: 'v6-small', fallbackChain: [], customApis: [],
          webgpuSupported: true, webgpuMaster: true,
          webgpuOverrides: { llm: true, inpaint: true, ocr: true },
        } }, resolve);
      }), WEBLLM_MODEL_ID, WEBLLM_NO_FEWSHOT);
    } finally {
      await settingsPage.close();
    }

    await assertHardwareWebGpuInOffscreen(browser, extensionId, consoleBuffer, sessions);

    for (const testFile of TEST_FILES) {
      const page = await browser.newPage();
      try {
        await page.evaluateOnNewDocument((noFewShot) => {
          (globalThis as any).__KITES_WEBLLM_NO_FEWSHOT__ = noFewShot;
        }, WEBLLM_NO_FEWSHOT);
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(`http://127.0.0.1:${address.port}/${encodeURIComponent(testFile)}`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('img', { timeout: TARGET_TIMEOUT_MS });
        await page.waitForSelector(BUTTON_SELECTOR, { timeout: TARGET_TIMEOUT_MS, visible: true });
        const logStart = consoleBuffer.length;
        await page.click(BUTTON_SELECTOR);
        await page.waitForSelector(TRANSLATED_IMAGE_SELECTOR, { timeout: TRANSLATE_TIMEOUT_MS, visible: true });
        const translatedImage = await page.$(TRANSLATED_IMAGE_SELECTOR);
        if (!translatedImage) throw new Error(`Translated image element disappeared for ${testFile}`);
        const outputName = `${path.parse(testFile).name}.png`;
        await translatedImage.screenshot({ path: path.join(RESULT_DIR, outputName) });
        generatedImageCount += 1;
        const pairs = extractTranslationPairs(testFile, consoleBuffer.slice(logStart));
        if (pairs.length === 0) throw new Error(`No source/translated pairs captured for ${testFile}`);
        translationLog.push(...pairs);
        console.log(`[WebLLM-E2E] Saved ${outputName}`);
      } finally {
        await page.close();
      }
    }

    fs.writeFileSync(path.join(RESULT_DIR, 'translation-log.json'), JSON.stringify(translationLog, null, 2));
    if (generatedImageCount === 0) throw new Error('WebLLM visual test produced zero PNG outputs.');
  } finally {
    await Promise.allSettled(sessions.map((session) => session.detach()));
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error('WebLLM visual test failed:', error);
  process.exitCode = 1;
});
