/**
 * Real-browser harness for the translate path across an idle gap.
 *
 * Drives what a user does: a page with a manga-like image, hover it, click the content script's
 * translate control, and wait for the image to be swapped for a blob: URL. Two jobs, separated by an
 * idle period longer than `JOB_STALL_TIMEOUT_MS` (60s), so a wait that inherits the earlier silence
 * fails here the way it fails in the report this harness exists for.
 *
 * Reads the authoritative rows from IndexedDB and reports console errors, so it catches what the unit
 * tests cannot: a job abandoned mid-flight, and a job that finished but whose status or page went
 * missing.
 *
 * Usage:  node scripts/stall-e2e.mjs [--idle-ms 62000]
 * Needs a Chromium build and a profile with the WebLLM model cached (see scripts/webllm-matrix.mjs).
 */
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from 'canvas';

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
};
const IDLE_MS = argValue('--idle-ms', 62000);
const FIXTURE_PATH = join(homedir(), '.kites-webllm-profile', 'stall-e2e-fixture.png');

/**
 * Writes the fixture page when it is missing: six Chinese dialogue lines on a light background, enough
 * for OCR to find blocks and the local engine to translate them.
 */
function ensureFixture() {
  if (existsSync(FIXTURE_PATH)) return;
  const canvas = createCanvas(900, 1200);
  const drawing = canvas.getContext('2d');
  drawing.fillStyle = '#ffffff';
  drawing.fillRect(0, 0, 900, 1200);
  drawing.fillStyle = '#111111';
  drawing.font = 'bold 46px sans-serif';
  const lines = ['你这话是什么意思？', '别装傻，你明明知道我在说什么', '我只是路过而已，别把我卷进来', '行了，都别吵了', '相信我', '跟我来'];
  lines.forEach((line, index) => drawing.fillText(line, 60, 180 + index * 160));
  writeFileSync(FIXTURE_PATH, canvas.toBuffer('image/png'));
}
const exe = join(homedir(), 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const ext = join(process.cwd(), 'dist');
const profile = join(homedir(), '.kites-webllm-profile');
ensureFixture();
const png = readFileSync(FIXTURE_PATH);
const logs = [];

const server = createServer((req, res) => {
  if (req.url?.endsWith('.png')) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); return; }
  res.writeHead(200, { 'content-type': 'text/html' });
  const image = req.url?.includes('page2') ? '/2.png' : '/1.png';
  res.end(`<!doctype html><html><body style="margin:0"><img id="page" src="${image}" width="620" style="display:block"></body></html>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const ctx = await chromium.launchPersistentContext(profile, {
  headless: false, executablePath: exe,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox', '--enable-unsafe-webgpu'],
});

const configure = (page) => page.evaluate(() => new Promise((resolve) => {
  chrome.storage.local.set({ popupState: {
    isExtensionEnabled: true, isAuto: false, manualMode: 'persistent', concurrency: 1, isDark: true,
    renderFontPresetId: 'standard', sourceLang: 'auto', targetLang: 'en',
    activeEngineId: 'Qwen3.5-0.8B-q4f16_1-MLC', activeInpaintId: 'telea', activeOcrId: 'v6-small',
    fallbackChain: [], customApis: [], webgpuSupported: true, webgpuMaster: true,
    webgpuOverrides: { llm: true, inpaint: true, ocr: true },
  } }, resolve);
}));

const clickTranslate = async (page, selector) => {
  // The content script mounts the control hidden and reveals it on hover; wait for the mount, then
  // hover the image and click the button regardless of the opacity transition.
  await page.locator('[data-kites-translate-control]').first().waitFor({ state: 'attached', timeout: 20000 });
  await page.hover(selector);
  await page.waitForTimeout(400);
  // DOM click: React's handler is the same one a pointer click reaches, and it avoids hit-testing
  // the control's fixed overlay position.
  const label = await page.evaluate((imageSelector) => {
    const button = document.querySelector('[data-kites-translate-button="true"]');
    const before = document.querySelector(imageSelector)?.getAttribute('src') ?? '';
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return { label: button?.getAttribute('aria-label') ?? null, before: before.slice(0, 16) };
  }, selector);
  return label;
};

const waitSwapped = async (page, selector, timeoutMs) => {
  const started = Date.now();
  for (;;) {
    const src = await page.getAttribute(selector, 'src');
    const failed = await page.locator('[data-kites-translate-button="true"]').getAttribute('title').catch(() => null);
    if (src?.startsWith('blob:')) return { outcome: 'translated', src: src.slice(0, 24), waitedMs: Date.now() - started };
    if (failed && /fail|error/i.test(failed)) return { outcome: 'failed', title: failed, waitedMs: Date.now() - started };
    if (Date.now() - started > timeoutMs) return { outcome: 'timed-out', src: src?.slice(0, 24), waitedMs: Date.now() - started };
    await page.waitForTimeout(1000);
  }
};

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
  sw.on('console', (msg) => logs.push(`[sw:${msg.type()}] ${msg.text()}`));
  const id = new URL(sw.url()).host;

  const config = await ctx.newPage();
  await config.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'domcontentloaded' });
  await config.waitForTimeout(1200);
  await configure(config);

  const page = await ctx.newPage();
  const readJobs = async () => {
    const config2 = await ctx.newPage();
    await config2.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'domcontentloaded' });
    const rows = await config2.evaluate(async () => {
      const open = () => new Promise((res, rej) => { const r = indexedDB.open('KitesDatabase'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const db = await open();
      return new Promise((res, rej) => { const r = db.transaction('translationJobs', 'readonly').objectStore('translationJobs').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    });
    await config2.close();
    const last = rows.at(-1);
    return last && { id: last.id, srcUrl: last.srcUrl, status: last.status, durationMs: last.durationMs ?? null, error: last.error ?? null };
  };
  const showJobs = async (label) => console.log(label, JSON.stringify(await readJobs()));
  page.on('console', (msg) => logs.push(`[page:${msg.type()}] ${msg.text()}`));
  await page.goto(`${base}/page.html`, { waitUntil: 'load' });
  await page.waitForSelector('#page');
  await page.waitForSelector('[data-kites-translate-control]', { timeout: 20000 });
  await page.waitForTimeout(500);

  console.log('control 1:', JSON.stringify(await clickTranslate(page, '#page')));
  console.log('job 1:', JSON.stringify(await waitSwapped(page, '#page', 180000)));

  await showJobs('job 1 row:');
  console.log(`idling ${IDLE_MS / 1000}s (stall budget is 60s)...`);
  await page.waitForTimeout(IDLE_MS);
  await page.goto(`${base}/page2.html`, { waitUntil: 'load' });
  await page.waitForSelector('[data-kites-translate-control]', { timeout: 20000 });
  await page.waitForTimeout(500);

  console.log('control 2:', JSON.stringify(await clickTranslate(page, '#page')));
  console.log('job 2:', JSON.stringify(await waitSwapped(page, '#page', 180000)));
  await showJobs('job 2 row:');

  const stalls = logs.filter((line) => /made no progress|stall limit|\bstalled\b|not marking it complete/i.test(line));
  const connectionErrors = logs.filter((line) => /Could not establish connection/i.test(line));
  const otherErrors = logs.filter((line) => /\[(sw|page):error\]/i.test(line) && !/Could not establish connection/i.test(line));
  console.log('stall lines:', stalls.length, JSON.stringify(stalls.slice(0, 3)));
  console.log('connection errors:', connectionErrors.length);
  console.log('other console errors:', otherErrors.length, JSON.stringify(otherErrors.slice(0, 4)));
} finally {
  await ctx.close();
  server.close();
}
