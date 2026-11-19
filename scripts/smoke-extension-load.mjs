/**
 * Loads the built extension in a real browser and checks it still boots cleanly.
 *
 * The matrix runner proves the translation pipeline works, but it opens the offscreen document
 * directly. This one loads the packed extension the way a user does, so it catches the class of
 * breakage a manifest or startup change causes: a permission the browser rejects, a service worker
 * that throws, an offscreen document that never appears.
 *
 * Usage: node scripts/smoke-extension-load.mjs
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** Console patterns that mean the extension is broken rather than merely noisy. */
const FATAL_PATTERNS = [/Uncaught/, /GrammarMatcherInitError/, /ContextWindowSizeExceededError/, /Manifest is not valid/i];

/** Wall-clock budget for the service worker to register. */
const SERVICE_WORKER_TIMEOUT_MS = 30_000;

/**
 * Finds an extension-capable Chromium, the same way the matrix runner does.
 *
 * @returns Absolute path of the browser executable.
 */
function resolveChrome() {
  const candidates = [
    join(homedir(), 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux/chrome'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('No extension-capable Chromium found; run `npx playwright install chromium`.');
  return found;
}

const extensionPath = join(process.cwd(), 'dist');
const userDataDir = mkdtempSync(join(tmpdir(), 'kites-smoke-'));

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false, // extensions do not load in headless Chromium
  executablePath: resolveChrome(),
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-sandbox',
    '--enable-unsafe-webgpu',
  ],
});

const consoleLines = [];
context.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
context.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));

let failures = 0;

/**
 * Records one check.
 *
 * @param label - What was asserted.
 * @param ok - Whether it held.
 * @param detail - Extra context printed either way.
 */
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

try {
  const worker = context.serviceWorkers()[0]
    ?? await context.waitForEvent('serviceworker', { timeout: SERVICE_WORKER_TIMEOUT_MS });
  const extensionId = new URL(worker.url()).host;
  check('service worker registers', Boolean(extensionId), extensionId);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/offscreen/offscreen.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  const granted = await page.evaluate(async () => ({
    unlimitedStorage: await chrome.permissions.contains({ permissions: ['unlimitedStorage'] }),
    orchestrator: Boolean(window.__pipelineOrchestrator?.getTranslationManager),
    webgpu: Boolean(navigator.gpu),
  }));
  check('unlimitedStorage is granted', granted.unlimitedStorage);
  check('offscreen document boots the orchestrator', granted.orchestrator);
  check('WebGPU is exposed to the offscreen document', granted.webgpu);

  const fatal = consoleLines.filter((line) => FATAL_PATTERNS.some((pattern) => pattern.test(line)));
  check('no fatal console output', fatal.length === 0, fatal.join(' | ').slice(0, 400));
} finally {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nsmoke: OK' : `\nsmoke: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
