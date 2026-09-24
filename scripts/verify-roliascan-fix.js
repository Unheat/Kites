/**
 * Playwright end-to-end verification for issue #2 — lazy-loaded webtoon readers.
 *
 * Reproduces the reported bug scenario on https://roliascan.com/ with the real built
 * extension: the reader lazy-loads every page after the first behind a long inline SVG
 * placeholder (in `src` and the container's `::before` background). Before the fix, Kites
 * queued the placeholder itself and every page after the first failed silently.
 *
 * What it asserts, per comic page:
 *  1. The content script queues the REAL page URL (console log must show an http(s)
 *     `Sending TRANSLATE_IMAGE to background: …` line — never a `data:` placeholder).
 *  2. The img ends up translated: `data-kites-translated="true"` and a `blob:` source.
 *
 * Usage:
 *   npm run build                     # dist/ must contain the current manifest
 *   node scripts/verify-roliascan-fix.js [chapterUrl] [--pages N]
 *
 * Defaults: chapter https://roliascan.com/read/moon-slayer/ch1-324495/, 2 pages
 * (the eager first page + one lazy page — the minimal issue #2 reproduction).
 *
 * Requirements:
 *   - devDependency `playwright-core`
 *   - A Chromium binary: either `npx playwright@<version> install chromium` (auto-used
 *     from the default ms-playwright cache), or Google Chrome installed (falls back to
 *     the `chrome` channel). Override with KITES_CHROMIUM_PATH=/path/to/chrome.
 *
 * The persistent profile (os.tmpdir()/kites-playwright-verify-profile) keeps model caches
 * between runs, so the second run skips the OCR download.
 */
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_PATH = join(REPO_ROOT, 'dist');
const PROFILE_DIR = join(tmpdir(), 'kites-playwright-verify-profile');

const DEFAULT_CHAPTER_URL = 'https://roliascan.com/read/moon-slayer/ch1-324495/';
// Generous per-page budget: a first-run job can download OCR weights before translating.
const TRANSLATION_TIMEOUT_MS = 5 * 60 * 1000;
// The site's lazy loader swaps the placeholder src shortly after the page scrolls into view.
const LAZY_LOAD_SETTLE_MS = 1500;
const HOVER_SETTLE_MS = 500;

const args = process.argv.slice(2);
const chapterUrl = args.find((arg) => arg.startsWith('http')) || DEFAULT_CHAPTER_URL;
const pagesFlagIndex = args.indexOf('--pages');
const PAGES_TO_TRANSLATE = pagesFlagIndex !== -1 ? Number(args[pagesFlagIndex + 1]) || 2 : 2;

if (!existsSync(join(EXTENSION_PATH, 'manifest.json'))) {
  console.error(`[verify-roliascan] No built extension at ${EXTENSION_PATH}. Run "npm run build" first.`);
  process.exit(1);
}

let playwrightCore;
try {
  playwrightCore = await import('playwright-core');
} catch {
  console.error('[verify-roliascan] Missing devDependency. Run: npm i -D playwright-core');
  process.exit(1);
}
const { chromium } = playwrightCore;

/**
 * Resolves the Chromium executable: explicit env override, then the default
 * ms-playwright cache layout (macOS/Linux), then the installed Chrome channel.
 *
 * @returns {Promise<{executablePath?: string, channel?: string}>} Launch options for chromium.
 */
async function resolveChromium() {
  if (process.env.KITES_CHROMIUM_PATH) {
    return { executablePath: process.env.KITES_CHROMIUM_PATH };
  }
  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
    || join(homedir(), 'Library', 'Caches', 'ms-playwright');
  try {
    const { readdirSync } = await import('node:fs');
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
    // Fall through to the installed Chrome channel.
  }
  return { channel: 'chrome' };
}

/**
 * Collects `Sending TRANSLATE_IMAGE to background: <url>` URLs from the page console.
 *
 * @param {import('playwright-core').Page} page - Reader page to listen on.
 * @returns {string[]} Live array appended by the console listener.
 */
function trackQueuedUrls(page) {
  const queuedUrls = [];
  page.on('console', (entry) => {
    const match = entry.text().match(/Sending TRANSLATE_IMAGE to background: (\S+)/);
    if (match) queuedUrls.push(match[1]);
  });
  return queuedUrls;
}

/**
 * Scrolls the target comic page so its top edge is inside the viewport and waits for the
 * site's lazy loader to swap in the real image. Kites' translate button anchors to the
 * image's top-left corner, so an off-screen top means an off-screen button.
 *
 * @param {import('playwright-core').Page} page - Reader page.
 * @param {number} index - Zero-based index into img.comic-image.
 * @returns {Promise<{x: number, y: number, width: number, height: number}>} Post-scroll bounding box.
 */
async function scrollComicPageIntoView(page, index) {
  const box = await page.locator('img.comic-image').nth(index).boundingBox();
  if (!box) throw new Error(`img.comic-image[${index}] not found`);
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.evaluate((top) => window.scrollTo(0, top), Math.round(scrollY + box.y - 60));
  await page.waitForTimeout(LAZY_LOAD_SETTLE_MS);
  const settled = await page.locator('img.comic-image').nth(index).boundingBox();
  if (!settled) throw new Error(`img.comic-image[${index}] vanished after scroll`);
  return settled;
}

/**
 * Dismisses the roliascan onboarding tour modal if present, so it doesn't intercept pointer events.
 *
 * @param {import('playwright-core').Page} page - Reader page.
 */
async function dismissTourModal(page) {
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      const skip = btns.find((b) => (b.textContent || '').includes('Skip Tour'));
      if (skip) skip.click();
    });
    await page.waitForTimeout(300);
  } catch {}
}

/**
 * Hovers the comic page to summon Kites' hover translate button, then clicks it.
 *
 * @param {import('playwright-core').Page} page - Reader page.
 * @param {number} index - Zero-based comic page index.
 * @returns {Promise<void>} Resolves after the button click.
 */
async function clickTranslateButton(page, index) {
  await dismissTourModal(page);
  const img = page.locator('img.comic-image').nth(index);
  const box = await img.boundingBox();
  if (!box) throw new Error(`img.comic-image[${index}] has no bounding box`);

  const targetX = box.x + box.width / 2;
  const targetY = Math.max(box.y + 150, 100);
  await page.mouse.move(targetX, targetY, { steps: 6 });
  // Also dispatch a synthetic mouseover to handle site backdrops reliably
  await img.dispatchEvent('mouseover', { clientX: targetX, clientY: targetY, bubbles: true, composed: true });

  const button = page.locator('#kites-translate-btn');
  await button.waitFor({ state: 'visible', timeout: 6000 });
  await button.click();
}

/**
 * Waits until the comic page is translated (data-kites-translated + blob source).
 *
 * @param {import('playwright-core').Page} page - Reader page.
 * @param {number} index - Zero-based comic page index.
 * @returns {Promise<void>} Resolves on success, rejects on timeout.
 */
async function waitForTranslated(page, index) {
  await page.waitForFunction(
    (i) => {
      const img = document.querySelectorAll('img.comic-image')[i];
      return !!img
        && img.getAttribute('data-kites-translated') === 'true'
        && (img.currentSrc || '').startsWith('blob:');
    },
    index,
    { timeout: TRANSLATION_TIMEOUT_MS, polling: 2000 },
  );
}

const launchOptions = await resolveChromium();
console.log(`[verify-roliascan] Launching Chromium (${launchOptions.executablePath || launchOptions.channel}) with extension ${EXTENSION_PATH}`);
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false, // Extensions require a headed context.
  viewport: { width: 1280, height: 720 },
  args: [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
  ],
  ...launchOptions,
});

const page = context.pages()[0] || await context.newPage();
const queuedUrls = trackQueuedUrls(page);
let failures = 0;

try {
  console.log(`[verify-roliascan] Opening ${chapterUrl}`);
  await page.goto(chapterUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  for (let index = 0; index < PAGES_TO_TRANSLATE; index += 1) {
    const label = `page ${index + 1}`;
    await scrollComicPageIntoView(page, index);
    await clickTranslateButton(page, index);
    console.log(`[verify-roliascan] ${label}: clicked translate, waiting for completion…`);
    try {
      await waitForTranslated(page, index);
      console.log(`[verify-roliascan] ${label}: PASS (data-kites-translated + blob src)`);
    } catch (error) {
      failures += 1;
      console.error(`[verify-roliascan] ${label}: FAIL (${error.message.split('\n')[0]})`);
    }
  }

  // Issue #2 regression signal: the queue must never receive a data: placeholder URL.
  const placeholderQueued = queuedUrls.some((url) => url.startsWith('data:'));
  if (placeholderQueued) {
    failures += 1;
    console.error('[verify-roliascan] FAIL: a data: placeholder URL was queued for translation');
  }
  console.log(`[verify-roliascan] Queued URLs: ${JSON.stringify(queuedUrls, null, 2)}`);
} finally {
  await context.close();
}

if (failures > 0) {
  console.error(`[verify-roliascan] ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('[verify-roliascan] All checks passed.');
