/**
 * Scores OCR fidelity of the real pipeline against one page image at several detector resolutions.
 *
 * The page is served at native size and translated through the extension itself, then every block the
 * per-block audit reports is scored against dialogue that is known to be present. That separates
 * "detection never found it" (block missing, or preserved as artwork) from "recognition misread it"
 * (block present, characters wrong), which is the difference between a resolution problem and a
 * classifier problem.
 *
 * Requires a development build (`npm run build:dev`) for the audit.
 * Usage: node scripts/ocr-resolution-matrix.mjs --image /tmp/page.png --label 960
 */
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const label = argValue('--label', 'unlabelled');
const imagePath = argValue('--image', '/tmp/page-under-test.png');
const image = readFileSync(imagePath);

// Local detector-only experiment: no translation, extension profile, or browser required.
// Usage: node --import tsx scripts/ocr-resolution-matrix.mjs --image page.png --ocr-only --caps 640,960,1280,1920
if (process.argv.includes('--ocr-only')) {
  const { PaddleOcrEngine } = await import('../src/offscreen/engines/ocr/PaddleOcrEngine.ts');
  const { extractPolygons } = await import('../src/offscreen/engines/ocr/extractPolygons.ts');
  const { OcrManager } = await import('../src/offscreen/services/OcrManager.ts');
  const manager = new OcrManager();
  // A separately bundled candidate allows A/B filtering without editing the shipped manager.
  const candidatePath = argValue('--candidate-manager', '');
  const candidateManager = candidatePath
    ? new (await import((await import('node:url')).pathToFileURL(candidatePath).href)).OcrManager()
    : null;
  const unclipRatio = 1.8; // Match CustomPaddleDetector's shipped expansion.
  const { loadImage } = await import('@napi-rs/canvas');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const loaded = await loadImage(image);
  const engine = new PaddleOcrEngine(argValue('--model', 'v6-small'));
  await engine.init();
  const service = engine.service;
  const source = service.platform.createCanvas(loaded.width, loaded.height);
  source.getContext('2d').drawImage(loaded, 0, 0);
  const detector = engine.customDetector;
  const originalRun = service.detector.session.run.bind(service.detector.session);
  let probabilityMap;
  let tensorShape;
  service.detector.session.run = async (...args) => {
    const outputs = await originalRun(...args);
    const output = outputs[service.detector.session.outputNames[0]];
    probabilityMap = new Float32Array(output.data);
    tensorShape = output.dims;
    return outputs;
  };
  const caps = argValue('--caps', '640,960,1280,1920').split(',').map(Number);
  const thresholds = argValue('--thresholds', '0.3,0.2').split(',').map(Number);
  if (!caps.every((cap) => Number.isFinite(cap) && cap > 0)
      || !thresholds.every((value) => value > 0 && value < 1)) {
    throw new Error('Caps must be positive; probability thresholds must be between zero and one.');
  }
  const results = [];
  for (const cap of caps) {
    service.detector.options.maxSideLength = cap;
    service.options.detection.maxSideLength = cap;
    const started = Date.now();
    const detected = await detector.detectPolygons(source);
    for (const threshold of thresholds) {
      const scale = Math.min(1, cap / Math.max(source.width, source.height));
      const candidates = threshold === 0.3
        ? detected.polygons.map((points, index) => ({ points, score: detected.scores[index] }))
        : extractPolygons(probabilityMap, tensorShape[3], tensorShape[2], source.width, source.height,
          threshold, unclipRatio, scale);
      const recognized = await engine.recognizeCropsFromCanvas(source, candidates.map((candidate) => candidate.points));
      const blocks = candidates.map((candidate, index) => ({
        polygon: candidate.points, detectionScore: candidate.score,
        text: recognized.texts[index], recognitionScore: recognized.scores[index],
      }));
      const polygons = candidates.map((candidate) => candidate.points);
      const rawResult = {
        texts: recognized.texts, scores: recognized.scores, polygons,
        detectionScores: candidates.map((candidate) => candidate.score),
        boxes: polygons.map((points) => {
          const x = Math.min(...points.map((point) => point.x));
          const y = Math.min(...points.map((point) => point.y));
          return { x, y, width: Math.max(...points.map((point) => point.x)) - x,
            height: Math.max(...points.map((point) => point.y)) - y };
        }),
      };
      const context = { pageWidth: source.width, pageHeight: source.height, sourceLang: argValue('--source-lang', 'auto') };
      const merged = await manager.mergeTextBlocks(structuredClone(rawResult), context);
      const candidateMerged = candidateManager
        ? await candidateManager.mergeTextBlocks(structuredClone(rawResult), context) : undefined;
      const probes = [];
      if (process.argv.includes('--probe-furigana')) {
        const targetIndex = blocks.findIndex((block) => block.text.includes('こっち'));
        if (targetIndex >= 0) {
          const target = blocks[targetIndex];
          const bounds = (points) => ({
            x: Math.min(...points.map((point) => point.x)), y: Math.min(...points.map((point) => point.y)),
            w: Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
            h: Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
          });
          const b1 = bounds(target.polygon);
          for (let index = 0; index < blocks.length; index += 1) {
            const b2 = bounds(blocks[index].polygon);
            const fs2 = Math.min(b2.w, b2.h);
            if (index === targetIndex || !(b2.h > b2.w * 1.2)
                || !(Math.min(b1.w, b1.h) < 0.45 * fs2)
                || !(Math.abs(b1.x - b2.x) < fs2 * 1.5)
                || !(Math.max(0, Math.min(b1.y + b1.h, b2.y + b2.h) - Math.max(b1.y, b2.y)) > Math.min(b1.w, b1.h) * 0.5)) continue;
            probes.push({ neighbor: blocks[index], bounds: b2 });
          }
        }
      }
      results.push({ cap, threshold, input: tensorShape, elapsedMs: Date.now() - started, blocks, probes,
        merged: { texts: merged.texts, boxes: merged.boxes, artwork: merged.artwork },
        candidateMerged: candidateMerged && { texts: candidateMerged.texts, boxes: candidateMerged.boxes, artwork: candidateMerged.artwork } });
      console.log(`OCR_RESULT ${JSON.stringify(results.at(-1))}`);
    }
  }
  const output = argValue('--output', 'result/ocr-resolution-matrix.json');
  mkdirSync(join(output, '..'), { recursive: true });
  writeFileSync(output, JSON.stringify({ imagePath, width: source.width, height: source.height, results }, null, 2));
  process.exit(0);
}

/** Dialogue known to be on the page, used as ground truth for scoring. */
const EXPECTED = [
  '好厉害，屁穴在紧紧咬着老公',
  '让我等这么久了，吧…学生穴也太舒服了',
  '压迫感十分强劲',
  '我也差不多了',
  '要肉射咯！绝对要让你怀上！',
  '精子涌上来了！那我就这样直接在屁穴里射一发吧',
  '这是…什么情况…脑袋里面变得一片空白……',
  '射了！',
];

/**
 * Levenshtein distance, used to score how close a read is to the expected line.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns Edit distance in characters.
 */
function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

/**
 * Best-match containment score: how much of an expected line survives inside a single read block.
 *
 * @param expected - The drawn line.
 * @param read - Text OCR returned for one block.
 * @returns Recall in [0, 1]; 1 means every expected character was read in order.
 */
function recall(expected, read) {
  if (!read) return 0;
  const best = Math.min(...EXPECTED.map((other) => distance(expected, other) + (other === expected ? 0 : 0)));
  void best;
  return 1 - distance(expected, read.slice(0, expected.length)) / expected.length;
}

const server = createServer((req, res) => {
  if ((req.url ?? '').endsWith('.png')) {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(image);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  // Native size, so the capture is the page and not a browser-scaled copy of it.
  res.end('<!doctype html><body style="margin:0;background:#fff"><img id="page" src="/page.png" width="1200"></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const exe = join(homedir(), 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const ext = join(process.cwd(), 'dist');
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: false,
  userDataDir: join(homedir(), '.kites-webllm-profile'),
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox', '--enable-unsafe-webgpu'],
});

const lines = [];
try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 30000 });
  const id = new URL(swTarget.url()).host;
  const config = await browser.newPage();
  await config.setViewport({ width: 420, height: 720 });
  await config.goto(`chrome-extension://${id}/popup.html`);
  await config.evaluate(() => new Promise((r) => chrome.storage.local.set({
    kites_debug_pipeline_audit: true,
    popupState: { isExtensionEnabled: true, isAuto: false, manualMode: 'persistent', concurrency: 1, isDark: true,
      renderFontPresetId: 'standard', sourceLang: 'auto', targetLang: 'en',
      activeEngineId: 'Qwen3.5-0.8B-q4f16_1-MLC', activeInpaintId: 'telea', activeOcrId: 'v6-small',
      fallbackChain: [], customApis: [], webgpuSupported: true, webgpuMaster: true,
      webgpuOverrides: { llm: true, inpaint: true, ocr: true } },
  }, r)));
  await config.close();

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(`${base}/`);
  await page.waitForSelector('[data-kites-translate-control]', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 500));

  let attached = false;
  const attach = async () => {
    for (const target of browser.targets().filter((t) => t.url().includes('offscreen'))) {
      if (target.__attached) continue;
      target.__attached = true;
      const session = await target.createCDPSession();
      await session.send('Runtime.enable');
      session.on('Runtime.consoleAPICalled', (event) => {
        const text = (event.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
        if (text) lines.push(text);
      });
      attached = true;
    }
  };

  const started = Date.now();
  await page.hover('#page').catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => document.querySelector('[data-kites-translate-button="true"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  for (let i = 0; i < 60 && !attached; i += 1) {
    await attach();
    await new Promise((r) => setTimeout(r, 500));
  }
  for (let i = 0; i < 240; i += 1) {
    const src = await page.evaluate(() => document.querySelector('#page')?.getAttribute('src') ?? '').catch(() => '');
    if (src.startsWith('blob:')) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const elapsedMs = Date.now() - started;
  await new Promise((r) => setTimeout(r, 1500));

  const blocks = lines
    .filter((l) => l.includes('[PipelineAudit] job') && l.includes('#'))
    .map((line) => ({
      stage: line.match(/#\d+ (\S+)/)?.[1] ?? '?',
      size: line.match(/(\d+x\d+) /)?.[1] ?? '?',
      text: line.match(/"([^"]*)"/)?.[1] ?? '',
    }));

  const scores = EXPECTED.map((expected) => {
    let best = { text: '', score: 0 };
    for (const block of blocks) {
      const value = recall(expected, block.text);
      if (value > best.score) best = { text: block.text, score: value };
    }
    return { expected, read: best.text, score: best.score };
  });
  const hits = scores.filter((s) => s.score >= 0.7).length;

  console.log(`\nrun: ${label} | ${(elapsedMs / 1000).toFixed(1)}s | ${blocks.length} block(s) | preserved ${blocks.filter((b) => b.stage === 'preserved').length}`);
  console.log(`dialogue recovered >=70%: ${hits}/${EXPECTED.length} | mean recall ${(scores.reduce((s, x) => s + x.score, 0) / EXPECTED.length).toFixed(2)}`);
  for (const s of scores) console.log(`  ${s.score >= 0.7 ? 'OK  ' : 'MISS'} recall=${s.score.toFixed(2)} "${s.expected}" <- "${s.read}"`);
  console.log('blocks:');
  for (const b of blocks.slice(0, 40)) console.log(`  ${b.stage.padEnd(12)} ${b.size.padEnd(9)} "${b.text}"`);
} finally {
  await browser.close().catch(() => {});
  server.close();
}
