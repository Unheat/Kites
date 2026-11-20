/**
 * Measures OCR stability across page scales.
 *
 * Renders the same dialogue layout at several pixel scales and runs the real pipeline on each, then
 * reports how many blocks were found, how many were preserved as artwork, and how many came back
 * translated. A geometry threshold that is hardcoded in pixels changes meaning with scale, so the
 * counts drift; normalising thresholds by page size should keep them proportional.
 *
 * Requires a development build (`npm run build:dev`) because the per-block audit only prints there.
 * Usage: node scripts/ocr-scale-matrix.mjs [--scales 1,2,3] [--label name]
 */
import puppeteer from 'puppeteer';
import { createCanvas } from 'canvas';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const label = argValue('--label', 'scale');
const scales = argValue('--scales', '1,2,3').split(',').map(Number);
const exe = join(homedir(), 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const ext = join(process.cwd(), 'dist');
const profile = join(homedir(), '.kites-webllm-profile');
const LINES = ['你这话是什么意思？', '别装傻，你明明知道我在说什么', '我只是路过而已，别把我卷进来', '行了，都别吵了', '相信我', '跟我来'];

/**
 * Draws the fixture at a given scale, so the same layout has proportionally larger text.
 *
 * @param scale - Multiplier applied to every pixel dimension.
 * @returns PNG buffer of the page.
 */
function renderFixture(scale) {
  const width = Math.round(720 * scale);
  const height = Math.round(960 * scale);
  const canvas = createCanvas(width, height);
  const drawing = canvas.getContext('2d');
  drawing.fillStyle = '#ffffff';
  drawing.fillRect(0, 0, width, height);
  drawing.fillStyle = '#111111';
  drawing.font = `bold ${Math.round(46 * scale)}px sans-serif`;
  LINES.forEach((line, index) => drawing.fillText(line, 40 * scale, (140 + index * 130) * scale));
  return canvas.toBuffer('image/png');
}

const pages = new Map(scales.map((scale) => [String(scale), renderFixture(scale)]));
const server = createServer((req, res) => {
  const scale = (req.url ?? '').match(/scale-(\d+(?:\.\d+)?)\.png/)?.[1];
  if (scale && pages.has(scale)) {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(pages.get(scale));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  const target = (req.url ?? '').match(/scale-(\d+(?:\.\d+)?)\.png/)?.[1] ?? '1';
  res.end(`<!doctype html><body style="margin:0"><img id="page" src="/scale-${target}.png" width="620"></body></html>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: false,
  userDataDir: profile,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox', '--enable-unsafe-webgpu'],
});

const lines = [];
const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 30000 });
const id = new URL(swTarget.url()).host;

/**
 * Streams the offscreen document's console, where the pipeline and the block audit log.
 *
 * @returns Number of attached targets so far (the document is created on the first job).
 */
async function attachOffscreenLog() {
  const targets = browser.targets().filter((t) => t.url().includes('offscreen'));
  for (const target of targets) {
    if (target.__attached) continue;
    target.__attached = true;
    const session = await target.createCDPSession();
    await session.send('Runtime.enable');
    session.on('Runtime.consoleAPICalled', (event) => {
      const text = (event.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (text) lines.push(text);
    });
  }
  return targets.length;
}

const config = await browser.newPage();
await config.goto(`chrome-extension://${id}/popup.html`);
await config.evaluate(() => new Promise((r) => chrome.storage.local.set({
  kites_debug_pipeline_audit: true,
  popupState: { isExtensionEnabled: true, isAuto: false, manualMode: 'persistent', concurrency: 1, isDark: true,
    renderFontPresetId: 'standard', sourceLang: 'auto', targetLang: 'en',
    activeEngineId: 'Qwen3.5-0.8B-q4f16_1-MLC', activeInpaintId: 'telea', activeOcrId: 'v6-small',
    fallbackChain: [], customApis: [], webgpuSupported: true, webgpuMaster: true,
    webgpuOverrides: { llm: true, inpaint: true, ocr: true } },
}, r)));

const results = [];
for (const scale of scales) {
  lines.length = 0;
  const page = await browser.newPage();
  await page.goto(`${base}/scale-${scale}.html`);
  await page.waitForSelector('[data-kites-translate-control]', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 400));
  await page.hover('#page');
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => document.querySelector('[data-kites-translate-button="true"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  for (let i = 0; i < 40; i += 1) {
    if (await attachOffscreenLog()) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  for (let i = 0; i < 180; i += 1) {
    const src = await page.evaluate(() => document.querySelector('#page')?.getAttribute('src') ?? '');
    if (src.startsWith('blob:')) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 1500));

  const audit = lines.filter((l) => l.includes('[PipelineAudit] job') && !l.includes('one line each'));
  const count = (stage) => audit.filter((l) => l.includes(` ${stage} `)).length;
  results.push({
    scale,
    blocks: audit.length,
    preserved: count('preserved'),
    translated: count('translated'),
    echoed: count('echoed'),
    empty: count('empty-answer'),
    mergedGroups: new Set(lines.filter((l) => l.includes('Merged Speech Bubble'))).size,
  });
  await page.close();
}

console.log(`\nrun: ${label}`);
console.log('scale  blocks  preserved  translated  echoed  empty  mergedGroups');
for (const r of results) {
  console.log(
    `${String(r.scale).padEnd(6)} ${String(r.blocks).padStart(6)} ${String(r.preserved).padStart(10)} ` +
    `${String(r.translated).padStart(11)} ${String(r.echoed).padStart(7)} ${String(r.empty).padStart(6)} ${String(r.mergedGroups).padStart(13)}`
  );
}
await browser.close();
server.close();
