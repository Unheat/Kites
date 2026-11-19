/**
 * Runs the language/robustness matrix against the real extension and local WebLLM model.
 *
 * Why this exists: the temperature sweep in `benchmark-webllm-temperature.sh` answers one
 * question for one source language. The failure the browser logs actually show is different —
 * a batch that loops until `max_tokens`, loses its later keys, and then fails the whole page —
 * and it only reproduces on realistic page shapes (long CJK lines mixed with short fragments).
 * This driver therefore sweeps the axes that interact: source language x target language x
 * page shape, records the generation-level evidence (truncation, echo warnings) next to the
 * per-slot outcome, and writes one JSON file per configuration so two code changes can be
 * compared on identical inputs.
 *
 * Combos, matching the six the product actually ships:
 *   auto -> en (zh), auto -> en (ja), auto -> vi (zh), auto -> vi (ja), zh -> en, ja -> en.
 *
 * Usage:
 *   node scripts/webllm-matrix.mjs --label baseline --repeats 2
 *   node scripts/webllm-matrix.mjs --label t07 --model Qwen3.5-0.8B-q4f16_1-MLC
 *   node scripts/webllm-matrix.mjs --label quick --only auto-en-zh --repeats 1
 *
 * The built extension must exist (`npm run build`) and the model must already be cached
 * (run `scripts/webllm-local-run.mjs` once first).
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
/** Fixtures live beside the runner so a config sweep always uses the same page shapes. */
const FIXTURE_DIR = join(REPO_ROOT, 'scripts/fixtures/matrix');
/** Console lines the engine emits when a request did not finish cleanly. */
const TRUNCATION_PATTERN = /hit max_tokens limit/;
const ECHO_PATTERN = /Model echoed (\d+)\/(\d+) slots/;
/** Scripts that must never be counted as translated output for a Latin-script target. */
const SOURCE_SCRIPT_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff66-\uff9f]/;
/** Millisecond slack when attributing a console line to the request that produced it. */
const LOG_WINDOW_SLACK_MS = 250;

/**
 * The matrix itself: one row per shipped combination.
 *
 * `fixture` names a file in `scripts/fixtures/matrix`; `source` and `target` are the popup
 * languages the pipeline is asked for. `auto` exercises the undeclared-source path.
 */
const COMBOS = [
  { id: 'auto-en-zh', fixture: 'zh-dialogue', source: 'auto', target: 'en' },
  { id: 'auto-en-ja', fixture: 'ja-dialogue', source: 'auto', target: 'en' },
  { id: 'auto-vi-zh', fixture: 'zh-dialogue', source: 'auto', target: 'vi' },
  { id: 'auto-vi-ja', fixture: 'ja-dialogue', source: 'auto', target: 'vi' },
  { id: 'zh-en-zh', fixture: 'zh-dialogue', source: 'zh', target: 'en' },
  { id: 'ja-en-ja', fixture: 'ja-dialogue', source: 'ja', target: 'en' },
  // Non-Latin target: Cyrillic output is the check that the pipeline is not silently rewriting into
  // a Latin target, and it is the only non-Latin target the scorer can judge without a script table.
  { id: 'zh-ru-zh', fixture: 'zh-dialogue', source: 'zh', target: 'ru' },
  { id: 'auto-en-zh-real', fixture: 'zh-real-page', source: 'auto', target: 'en' },
  // Focused probes: one chunk by construction, so `--repeats 10` measures the echo rate for that
  // chunk instead of a page-level lottery. The page-level combos above mix several chunks, which is
  // what made a single echoing chunk look like a 15-point swing between runs.
  { id: 'short-en-zh', fixture: 'zh-short-imperatives', source: 'zh', target: 'en' },
  { id: 'short-vi-zh', fixture: 'zh-short-imperatives', source: 'zh', target: 'vi' },
];

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
const label = flags.get('label') ?? 'matrix';
const model = flags.get('model') ?? DEFAULT_MODEL;
const repeats = Number(flags.get('repeats') ?? 1);
const only = flags.get('only');
const profile = flags.get('profile') ?? join(homedir(), '.kites-webllm-profile');
const outDir = resolve(flags.get('out-dir') ?? '/tmp');

/**
 * Finds a Chromium build that can load an unpacked MV3 extension.
 *
 * @returns Absolute path of the browser executable.
 */
function resolveChrome() {
  const explicit = flags.get('chrome');
  if (explicit && explicit !== 'true') return explicit;
  const candidates = [
    join(homedir(), 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux/chrome'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('No extension-capable Chromium found. Run `npx playwright install chromium` or pass --chrome.');
  return found;
}

/**
 * Loads one fixture's pages.
 *
 * @param name - Fixture file stem inside the matrix fixture directory.
 * @returns One array of strings per page.
 */
function loadFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

/**
 * Whether a slot value is only JSON punctuation (`{}`, `[]`), i.e. a leftover of the protocol.
 *
 * Mirrors `isJsonSkeleton` in `BaseLlmTranslationEngine.ts`, which is the source of truth; this
 * script runs standalone and cannot import TypeScript. Without this check a page that printed
 * braces into every bubble scored as fully translated, because `{}` is neither the source text nor
 * source script.
 *
 * @param value - Translated slot value.
 * @returns True when the value carries no content beyond JSON structure.
 */
function isProtocolFragment(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  return trimmed.replace(/[\s[\]{},:"'`]/g, '').length === 0;
}

/**
 * Scores one translated page.
 *
 * The failure signals are kept apart on purpose: an echoed slot means the model handed the source
 * text back, `stillSourceScript` means it answered in the wrong writing system (a rewriting pass
 * that never actually translated), and `protocolFragments` means it answered with JSON punctuation
 * instead of text. A slot counts once, whichever fired.
 *
 * @param page - Page texts and the engine's answer, index-aligned.
 * @returns Counts plus the offending slot indices.
 */
function scorePage(page) {
  const echoed = [];
  const stillSourceScript = [];
  const protocolFragments = [];
  for (let slot = 0; slot < page.texts.length; slot += 1) {
    const output = page.translated[slot] ?? '';
    if (output === page.texts[slot]) echoed.push(slot);
    else if (SOURCE_SCRIPT_PATTERN.test(output)) stillSourceScript.push(slot);
    else if (isProtocolFragment(output)) protocolFragments.push(slot);
  }
  return {
    slots: page.texts.length,
    echoed,
    stillSourceScript,
    protocolFragments,
    failed: new Set([...echoed, ...stillSourceScript, ...protocolFragments]).size,
  };
}

if (!existsSync(join(EXTENSION_DIST, 'manifest.json'))) {
  throw new Error(`No built extension at ${EXTENSION_DIST}. Run \`npm run build\` first.`);
}
mkdirSync(profile, { recursive: true });

const selected = COMBOS.filter((combo) => !only || combo.id.includes(only));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: resolveChrome(),
  args: [`--disable-extensions-except=${EXTENSION_DIST}`, `--load-extension=${EXTENSION_DIST}`, '--enable-unsafe-webgpu'],
});

/** Timestamped console lines, used to attribute truncation and echo warnings to a request. */
const consoleLines = [];
context.on('page', (page) => {
  page.on('console', (message) => consoleLines.push({ at: Date.now(), text: message.text() }));
});
let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 60_000 });
const extensionId = new URL(worker.url()).host;

const page = await context.newPage();
page.on('console', (message) => consoleLines.push({ at: Date.now(), text: message.text() }));
await page.goto(`chrome-extension://${extensionId}/${OFFSCREEN_PAGE}`);

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
  },
});

const ready = await page.evaluate(() => Boolean(window.__pipelineOrchestrator?.getTranslationManager));
if (!ready) throw new Error('Offscreen page did not expose __pipelineOrchestrator; build is stale or broken.');

const runs = [];
for (const combo of selected) {
  const pages = loadFixture(combo.fixture);
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    const startedAt = Date.now();
    const results = await page.evaluate(async ({ pageTexts, source, target }) => {
      const manager = window.__pipelineOrchestrator.getTranslationManager();
      const out = [];
      for (const texts of pageTexts) {
        const pageStart = performance.now();
        const translated = await manager.processTranslation(texts, source, target);
        out.push({ texts, translated, ms: Math.round(performance.now() - pageStart) });
      }
      return out;
    }, { pageTexts: pages, source: combo.source, target: combo.target });
    const endedAt = Date.now();

    const windowLines = consoleLines
      .filter((line) => line.at >= startedAt - LOG_WINDOW_SLACK_MS && line.at <= endedAt + LOG_WINDOW_SLACK_MS)
      .map((line) => line.text);
    const truncations = windowLines.filter((text) => TRUNCATION_PATTERN.test(text)).length;
    const echoes = windowLines.filter((text) => ECHO_PATTERN.test(text)).length;

    const scored = results.map(scorePage);
    runs.push({
      combo: combo.id,
      source: combo.source,
      target: combo.target,
      repeat,
      truncations,
      echoWarnings: echoes,
      pages: results.map((result, index) => ({ ...result, ...scored[index] })),
    });

    const totals = scored.reduce((sum, entry) => sum + entry.failed, 0);
    const slots = scored.reduce((sum, entry) => sum + entry.slots, 0);
    console.log(`${combo.id.padEnd(18)} r${repeat}  ${String(totals).padStart(2)}/${String(slots).padEnd(3)} failed  truncations=${truncations}  ${results.reduce((sum, entry) => sum + entry.ms, 0)}ms`);
  }
}

const resultPath = join(outDir, `kites-matrix-${label}.json`);
writeFileSync(resultPath, `${JSON.stringify({ label, model, runs }, null, 2)}\n`);

console.log('\ncombo              failed/slots  rate   truncations  avgMs');
for (const combo of selected) {
  const rows = runs.filter((run) => run.combo === combo.id);
  const slots = rows.flatMap((run) => run.pages).reduce((sum, entry) => sum + entry.slots, 0);
  const failed = rows.flatMap((run) => run.pages).reduce((sum, entry) => sum + entry.failed, 0);
  const truncations = rows.reduce((sum, run) => sum + run.truncations, 0);
  const ms = rows.flatMap((run) => run.pages).reduce((sum, entry) => sum + entry.ms, 0);
  const pages = rows.flatMap((run) => run.pages).length;
  console.log(
    `${combo.id.padEnd(18)} ${String(failed).padStart(4)}/${String(slots).padEnd(6)} ${(failed / slots * 100).toFixed(1).padStart(5)}%  ${String(truncations).padStart(11)}  ${Math.round(ms / pages)}`,
  );
}
console.log(`\nresult ${resultPath}`);

await context.close();
