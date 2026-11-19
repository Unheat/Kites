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
import { prebuiltAppConfig } from '@mlc-ai/web-llm';
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

/** How often the deletion check re-reads cache and install state. */
const DELETE_POLL_INTERVAL_MS = 2_000;
/** Generous ceiling: the first run downloads real weights from Hugging Face. */
const DELETE_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Reads one model's on-disk locations from the bundled catalog and registry.
 *
 * @param modelId - Model to inspect.
 * @returns Cache-key prefix, wasm library URL, and whether another installable model shares it.
 */
function catalogFacts(modelId) {
  const registry = JSON.parse(readFileSync(join(REPO_ROOT, 'src/shared/models-registry.json'), 'utf8'));
  const installable = new Set(registry.map((entry) => entry.id));
  const record = prebuiltAppConfig.model_list.find((entry) => entry.model_id === modelId);
  if (!record) throw new Error(`${modelId} is not in the bundled WebLLM catalog.`);
  const base = record.model.endsWith('/') ? record.model : `${record.model}/`;
  const prefix = new URL(base.match(/.+\/resolve\/.+\//) ? base : `${base}resolve/main/`).href;
  const libShared = prebuiltAppConfig.model_list.some(
    (entry) => entry.model_id !== modelId && entry.model_lib === record.model_lib && installable.has(entry.model_id),
  );
  return { prefix, lib: record.model_lib, libShared };
}

/**
 * Drives the real model-deletion path through the built extension and asserts its effects.
 *
 * Sends the same `{ target: 'background', request: true }` envelopes the popup sends, so the
 * background route guard, the offscreen handler, the download refusal, the cache sweep and the
 * stale-manifest-free re-download are all exercised on real WebGPU hardware with real weights.
 *
 * @param page - The offscreen extension page.
 * @param modelId - Model to download, delete, re-download and delete again.
 */
async function runDeletionCheck(page, modelId) {
  const facts = catalogFacts(modelId);
  const send = (type, payload) => page.evaluate((message) => new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(
      response ?? { status: 'error', error: String(chrome.runtime.lastError?.message) },
    ));
  }), { type, target: 'background', source: 'popup', request: true, payload });
  const isCached = async () => Boolean((await send('CHECK_MODEL_STATUS', { modelId })).isCached);
  const readCache = () => page.evaluate(async ({ prefix, lib }) => {
    const result = { modelPrefix: 0, configPrefix: 0, wasmHasLib: false, rawKeys: 0 };
    const scopes = ['webllm/model', 'webllm/config', 'webllm/wasm'];
    for (const scope of scopes) {
      const cache = await caches.open(scope);
      const keys = (await cache.keys()).map((request) => request.url);
      result.rawKeys += keys.length;
      if (scope === 'webllm/model') result.modelPrefix = keys.filter((url) => url.startsWith(prefix)).length;
      if (scope === 'webllm/config') result.configPrefix = keys.filter((url) => url.startsWith(prefix)).length;
      if (scope === 'webllm/wasm') result.wasmHasLib = keys.includes(lib);
    }
    return result;
  }, { prefix: facts.prefix, lib: facts.lib });
  const waitFor = async (label, predicate) => {
    const deadline = Date.now() + DELETE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, DELETE_POLL_INTERVAL_MS));
    }
    throw new Error(`Timed out waiting for ${label} (${modelId}).`);
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  const evidence = { modelId, prefix: facts.prefix, libShared: facts.libShared };

  // Clean slate: an earlier run may have left the model cached.
  if (await isCached()) {
    const cleanup = await send('DELETE_MODEL', { modelId });
    assert(cleanup.status === 'success', `Cleanup delete failed: ${cleanup.error}`);
    await waitFor('cleanup', async () => !(await isCached()));
  }

  await send('START_MODEL_DOWNLOAD', { modelId, category: 'translation' });
  await waitFor('the download to start writing files', async () => (await readCache()).modelPrefix > 0);

  const refused = await send('DELETE_MODEL', { modelId });
  evidence.deleteDuringDownload = refused;
  assert(
    refused.status === 'error' && /downloading|queued/i.test(refused.error ?? ''),
    `Deleting during a download was not refused: ${JSON.stringify(refused)}`,
  );

  await waitFor('the downloaded model to report installed', isCached);
  const before = await readCache();
  evidence.cacheBeforeDelete = before;
  assert(before.modelPrefix > 0 && before.configPrefix > 0, `Model files are missing before delete: ${JSON.stringify(before)}`);

  const deleted = await send('DELETE_MODEL', { modelId });
  evidence.delete = deleted;
  assert(deleted.status === 'success', `Delete failed: ${deleted.error}`);
  await waitFor('the model to report uninstalled', async () => !(await isCached()));

  const after = await readCache();
  evidence.cacheAfterDelete = after;
  assert(after.modelPrefix === 0, `webllm/model still holds ${after.modelPrefix} entries for the model`);
  assert(after.configPrefix === 0, `webllm/config still holds ${after.configPrefix} entries for the model`);
  assert(
    after.wasmHasLib === facts.libShared,
    facts.libShared
      ? 'A model_lib still needed by another registry model was deleted'
      : 'The unshared model_lib was not reclaimed',
  );

  // The decisive stability check: a fresh download must work after the sweep, which it cannot if
  // the stale tensor-cache.json manifest survived.
  await send('START_MODEL_DOWNLOAD', { modelId, category: 'translation' });
  await waitFor('the model to reinstall after deletion', isCached);
  evidence.reinstalled = true;

  const secondDelete = await send('DELETE_MODEL', { modelId });
  evidence.secondDelete = secondDelete;
  assert(secondDelete.status === 'success', `Second delete failed: ${secondDelete.error}`);
  await waitFor('the model to report uninstalled after the second delete', async () => !(await isCached()));
  assert((await readCache()).modelPrefix === 0, 'Second delete left model files behind');

  const evidencePath = join(outDir, `kites-${label}-delete.json`);
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`model      ${modelId}`);
  console.log(`delete     refused during download: ${refused.error}`);
  console.log(`cache      before model=${before.modelPrefix} config=${before.configPrefix} wasm=${before.wasmHasLib}`);
  console.log(`cache      after  model=${after.modelPrefix} config=${after.configPrefix} wasm=${after.wasmHasLib}`);
  console.log(`reinstall  ok (no stale manifest)`);
  console.log(`evidence   ${evidencePath}`);
}

const pages = flag('delete-model') ? [] : readPages(flag('pages'));
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

if (flag('delete-model')) {
  await runDeletionCheck(page, flag('delete-model'));
  await context.close();
} else {

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
}
