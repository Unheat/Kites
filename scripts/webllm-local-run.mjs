/**
 * Runs the real translation pipeline in a real browser with a real local WebLLM model.
 *
 * Unit tests assert behaviour; this asserts *reality* — the built extension loaded into Chromium,
 * WebGPU on the host GPU, weights loaded from the model cache, and the actual `TranslationManager`
 * called with the same arguments the pipeline uses. It exists because two production bugs (greedy
 * echo loops, and a page that silently kept its source text) were invisible to the test suite and
 * obvious within one run of this script.
 *
 * How it drives the extension: the offscreen document is opened as a normal tab (it exposes
 * `window.__pipelineOrchestrator`), popup state is written straight into extension storage, and each
 * page of text is sent through `processTranslation`. Console output from the extension — including
 * the engine's warnings — is captured to a log file next to the result JSON.
 *
 * Usage:
 *   node scripts/webllm-local-run.mjs --pages '[["こんにちは","猫が好き"]]' --label ja-smoke
 *   node scripts/webllm-local-run.mjs --pages @pages.json --source auto --target en
 *   node scripts/webllm-local-analyze.mjs ja-smoke
 *
 * Env overrides (flags win): KITES_CHROME, KITES_PROFILE, KITES_MODEL, KITES_SRC, KITES_TGT,
 * KITES_LABEL, KITES_PAGES, KITES_OUT_DIR.
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MODEL = 'Qwen3.5-0.8B-q4f16_1-MLC';
const EXTENSION_DIST = join(REPO_ROOT, 'dist');
const OFFSCREEN_PAGE = 'src/offscreen/offscreen.html';
/** Storage key holding the extension's settings; kept in sync with src/shared/constants.ts. */
const POPUP_STATE_KEY = 'popupState';
const SERVICE_WORKER_TIMEOUT_MS = 60_000;

/**
 * Reads `--name value` pairs from argv.
 *
 * @returns Map of flag name to value, without the leading dashes.
 */
function parseFlags() {
  const flags = new Map();
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[index + 1];
    flags.set(name, next && !next.startsWith('--') ? (index += 1, next) : 'true');
  }
  return flags;
}

const flags = parseFlags();
const flag = (name, fallback) => flags.get(name) ?? process.env[`KITES_${name.toUpperCase()}`] ?? fallback;

/**
 * Resolves the pages to translate from `--pages`, either inline JSON or `@path`.
 *
 * @param raw - Inline JSON array of pages, or `@file.json`.
 * @returns One array of strings per page.
 */
function readPages(raw) {
  if (!raw) {
    throw new Error('No pages given. Pass --pages \'[["line one","line two"]]\' or --pages @file.json');
  }
  const json = raw.startsWith('@') ? readFileSync(resolve(raw.slice(1)), 'utf8') : raw;
  const pages = JSON.parse(json);
  if (!Array.isArray(pages) || !pages.every((page) => Array.isArray(page) && page.every((line) => typeof line === 'string'))) {
    throw new Error('Pages must be a JSON array of arrays of strings.');
  }
  return pages;
}

/**
 * Finds a Chromium binary that can load an unpacked extension.
 *
 * Chrome stable ignores `--load-extension`, so the bundled Playwright build is preferred; a custom
 * path can be supplied with `--chrome`.
 *
 * @returns Absolute path of the browser executable.
 */
function resolveChrome() {
  const explicit = flag('chrome');
  if (explicit && explicit !== 'true') return explicit;

  const candidates = [
    join(homedir(), 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux/chrome'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('No extension-capable Chromium found. Install one with `npx playwright install chromium`, or pass --chrome <path>.');
}

/**
 * Waits for the extension service worker and returns its extension ID.
 *
 * @param context - Persistent browser context with the extension loaded.
 * @returns The unpacked extension's ID.
 */
async function extensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: SERVICE_WORKER_TIMEOUT_MS });
  return new URL(worker.url()).host;
}

const pages = readPages(flag('pages'));
const model = flag('model', DEFAULT_MODEL);
const source = flag('src', 'auto');
const target = flag('tgt', 'en');
const label = flag('label', 'run');
const profile = flag('profile', join(homedir(), '.kites-webllm-profile'));
const outDir = resolve(flag('out-dir', '/tmp'));

if (!existsSync(join(EXTENSION_DIST, 'manifest.json'))) {
  throw new Error(`No built extension at ${EXTENSION_DIST}. Run \`npm run build\` first.`);
}
mkdirSync(profile, { recursive: true });

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: resolveChrome(),
  // The extension is the system under test: load it unpacked and enable WebGPU without a flag UI.
  args: [`--disable-extensions-except=${EXTENSION_DIST}`, `--load-extension=${EXTENSION_DIST}`, '--enable-unsafe-webgpu'],
});

const logs = [];
const seen = new Set();
/**
 * Records a console message once; the same message arrives from the page, the context and the
 * service worker, which would otherwise triple every line.
 *
 * @param message - Playwright console message.
 */
function record(message) {
  const line = `[${message.type()}] ${message.text()}`;
  if (seen.has(line)) return;
  seen.add(line);
  logs.push(line);
}
context.on('console', record);

const id = await extensionId(context);
const page = await context.newPage();
page.on('console', record);
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
await page.goto(`chrome-extension://${id}/${OFFSCREEN_PAGE}`);

await page.evaluate(async ({ key, state }) => {
  const current = (await chrome.storage.local.get(key))[key] ?? {};
  await chrome.storage.local.set({ [key]: { ...current, ...state } });
}, {
  key: POPUP_STATE_KEY,
  state: {
    activeEngineId: model,
    fallbackChain: [],
    webgpuMaster: true,
    webgpuOverrides: { llm: true, ocr: true, inpaint: true, color: true, typeset: true, bubble: true },
    sourceLang: source,
    targetLang: target,
  },
});

const ready = await page.evaluate(() => Boolean(window.__pipelineOrchestrator?.getTranslationManager));
if (!ready) throw new Error('The offscreen page did not expose __pipelineOrchestrator; the build is stale or broken.');

const results = await page.evaluate(async ({ pageTexts, src, tgt }) => {
  const manager = window.__pipelineOrchestrator.getTranslationManager();
  const out = [];
  for (const texts of pageTexts) {
    const started = performance.now();
    const translated = await manager.processTranslation(texts, src, tgt);
    out.push({ texts, translated, ms: Math.round(performance.now() - started) });
  }
  return out;
}, { pageTexts: pages, src: source, tgt: target });

const resultPath = join(outDir, `kites-${label}-result.json`);
const logPath = join(outDir, `kites-${label}-console.log`);
writeFileSync(resultPath, `${JSON.stringify(results, null, 2)}\n`);
writeFileSync(logPath, `${logs.join('\n')}\n`);

console.log(`model      ${model}`);
console.log(`languages  ${source} -> ${target}`);
console.log(`pages      ${results.length}`);
for (const [index, pageResult] of results.entries()) {
  const unchanged = pageResult.texts.filter((text, slot) => pageResult.translated[slot] === text).length;
  console.log(`page ${index + 1}   ${pageResult.ms}ms  unchanged ${unchanged}/${pageResult.texts.length}`);
  for (const [slot, text] of pageResult.translated.entries()) {
    const same = pageResult.texts[slot] === text ? 'SAME ' : 'ok   ';
    console.log(`   ${same}${text}`);
  }
}
const warnings = logs.filter((line) => /Model (omitted|echoed)|Recovery attempt failed|interrupting/.test(line));
for (const warning of warnings) console.log(`warn       ${warning}`);
console.log(`result     ${resultPath}`);
console.log(`console    ${logPath}`);

await context.close();
