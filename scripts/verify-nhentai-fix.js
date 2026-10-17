/**
 * Playwright end-to-end verification for nhentai image replacement.
 *
 * Verifies that on a paginated manga reader (nhentai /g/123/1/):
 * 1. The image is detected and hover button appears.
 * 2. Clicking Translate successfully translates and REPLACES img.src immediately with blob URL.
 * 3. data-kites-translated="true" is present immediately on first pass (WITHOUT clicking Eye).
 * 4. The 3 finished action buttons appear (Eye, Download, Studio).
 * 5. Toggling the Eye icon works to show original and switch back to translated.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_PATH = join(REPO_ROOT, 'dist');
const PROFILE_DIR = join(tmpdir(), 'kites-nhentai-verify-profile');

const DEFAULT_URL = 'https://nhentai.net/g/688293/1/';

if (!existsSync(join(EXTENSION_PATH, 'manifest.json'))) {
  console.error(`[verify-nhentai] No built extension at ${EXTENSION_PATH}. Run "npm run build" first.`);
  process.exit(1);
}

const { chromium } = await import('playwright-core');

async function resolveChromium() {
  if (process.env.KITES_CHROMIUM_PATH) {
    return { executablePath: process.env.KITES_CHROMIUM_PATH };
  }
  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
    || join(homedir(), 'Library', 'Caches', 'ms-playwright');
  try {
    const versions = readdirSync(cacheRoot)
      .filter((name) => name.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const version of versions) {
      const macPath = join(cacheRoot, version, 'chrome-mac-arm64',
        'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
      const linuxPath = join(cacheRoot, version, 'chrome-linux', 'chrome');
      if (existsSync(macPath)) return { executablePath: macPath };
      if (existsSync(linuxPath)) return { executablePath: linuxPath };
    }
  } catch {
    // Fall through
  }
  return { channel: 'chrome' };
}

const launchOptions = await resolveChromium();
console.log(`[verify-nhentai] Launching Chromium (${launchOptions.executablePath || launchOptions.channel}) with Kites extension...`);

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  ...launchOptions,
  args: [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-sandbox',
  ],
  viewport: { width: 1280, height: 900 },
});

console.log('[verify-nhentai] Waiting for extension background worker...');
let worker = context.serviceWorkers()[0];
if (!worker) {
  worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
}
console.log('[verify-nhentai] Extension worker active. Configuring test settings...');
await worker.evaluate(() => {
  return chrome.storage.local.set({
    popupState: {
      activeEngineId: 'gg-translate',
      activeInpaintId: 'simple',
      sourceLang: 'auto',
      targetLang: 'en',
      concurrency: 3,
      isExtensionEnabled: true,
      manualMode: 'hover',
    },
  });
});

console.log('[verify-nhentai] Opening new page for nhentai...');
const page = await context.newPage();

page.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('[Content Script]') || text.includes('[Background]') || text.includes('[Pipeline]')) {
    console.log(`  [BROWSER] ${text}`);
  }
});

await page.goto(DEFAULT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('[verify-nhentai] Page loaded:', await page.title());

// Wait for reader image
const imgLocator = page.locator('#image-container img');
await imgLocator.waitFor({ state: 'visible', timeout: 15000 });

const initialSrc = await imgLocator.getAttribute('src');
console.log('[verify-nhentai] Initial image src:', initialSrc);

// Scroll image top into view so Kites anchor button is visible
await page.evaluate(() => {
  const img = document.querySelector('#image-container img');
  if (img) img.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(1000);

// Hover over image
const imgBox = await imgLocator.boundingBox();
if (!imgBox) throw new Error('Image bounding box not found');

console.log('[verify-nhentai] Hovering over reader image at', imgBox.x + imgBox.width / 2, imgBox.y + 150);
await page.mouse.move(imgBox.x + imgBox.width / 2, imgBox.y + 150, { steps: 5 });
await imgLocator.dispatchEvent('mouseover', {
  clientX: imgBox.x + imgBox.width / 2,
  clientY: imgBox.y + 150,
  bubbles: true,
  composed: true,
});

// Wait for translate button
const translateBtn = page.locator('#kites-translate-btn');
await translateBtn.waitFor({ state: 'visible', timeout: 10000 });
console.log('[verify-nhentai] Kites Translate button visible.');

// Click Translate
console.log('[verify-nhentai] Clicking Translate Image button...');
await translateBtn.click();

// Wait for translation completion on the image element
console.log('[verify-nhentai] Waiting for translation to complete on image element...');
await page.waitForFunction(
  () => {
    const img = document.querySelector('#image-container img');
    return (
      img?.getAttribute('data-kites-translated') === 'true' &&
      (img?.getAttribute('src')?.startsWith('blob:') || img?.currentSrc?.startsWith('blob:'))
    );
  },
  { timeout: 90000, polling: 500 }
);

const replacedSrc = await imgLocator.getAttribute('src');
const isTranslatedAttr = await imgLocator.getAttribute('data-kites-translated');
console.log('[verify-nhentai] SUCCESS! Image replaced immediately on first pass:');
console.log('  data-kites-translated:', isTranslatedAttr);
console.log('  replaced src:', replacedSrc);

if (!replacedSrc?.startsWith('blob:')) {
  throw new Error(`FAIL: Image src was not replaced with blob URL: ${replacedSrc}`);
}
if (isTranslatedAttr !== 'true') {
  throw new Error(`FAIL: data-kites-translated is not true: ${isTranslatedAttr}`);
}

// Verify finished action buttons appear
const finishedActions = page.locator('[data-kites-finished-actions="true"]');
await finishedActions.waitFor({ state: 'visible', timeout: 5000 });
const toggleBtn = page.locator('[data-kites-toggle-btn="true"]');
const downloadBtn = page.locator('[data-kites-download-btn="true"]');
const editBtn = page.locator('[data-kites-edit-btn="true"]');

if (!(await toggleBtn.isVisible())) throw new Error('FAIL: Eye toggle button missing');
if (!(await downloadBtn.isVisible())) throw new Error('FAIL: Download button missing');
if (!(await editBtn.isVisible())) throw new Error('FAIL: Edit in Studio button missing');
console.log('[verify-nhentai] All 3 finished action buttons visible (Eye, Download, Edit).');

// Verify eye toggle (original vs translated)
console.log('[verify-nhentai] Testing Eye toggle to original artwork...');
await toggleBtn.click();
await page.waitForTimeout(500);
const toggleOriginalSrc = await imgLocator.getAttribute('src');
console.log('  After toggle original src:', toggleOriginalSrc);
if (toggleOriginalSrc !== initialSrc) {
  throw new Error(`FAIL: Toggle original did not restore initial src: ${toggleOriginalSrc}`);
}

console.log('[verify-nhentai] Testing Eye toggle back to translated...');
await toggleBtn.click();
await page.waitForTimeout(500);
const toggleBackSrc = await imgLocator.getAttribute('src');
console.log('  After toggle back src:', toggleBackSrc);
if (!toggleBackSrc?.startsWith('blob:')) {
  throw new Error(`FAIL: Toggle back did not restore blob src: ${toggleBackSrc}`);
}

console.log('[verify-nhentai] ALL VERIFICATION CHECKS PASSED CLEANLY!');
await context.close();
process.exit(0);
