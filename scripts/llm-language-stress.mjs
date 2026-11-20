/**
 * Randomized language stress sweep against the real extension and local WebLLM model.
 *
 * The language matrix only covers Japanese, Chinese and Vietnamese. This runner sweeps a
 * random sample of the languages the product ships, across Latin and non-Latin scripts, in
 * both directions, and scores every slot for gross failure: exact echo, empty answer, a
 * JSON-protocol fragment, or an answer still written in the source script. It is a smoke
 * test, not a quality judgement: a changed slot may still be wrong, but an echoed, empty
 * or source-script slot is provably a failure.
 *
 * Usage:
 *   npm run build
 *   node scripts/llm-language-stress.mjs --label stress-1 --combos 12 --repeats 2
 *   node scripts/llm-language-stress.mjs --label recheck --only ar-vi --repeats 2
 *
 * The combo order is shuffled with a fixed seed so a run is reproducible; change --seed
 * to sample a different cut.
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MODEL = 'Qwen3.5-0.8B-q4f16_1-MLC';
const EXTENSION_DIST = join(REPO_ROOT, 'dist');
const OFFSCREEN_PAGE = 'src/offscreen/offscreen.html';
/** Storage key holding the extension's settings; kept in sync with src/shared/constants.ts. */
const POPUP_STATE_KEY = 'popupState';
/** Console lines the engine emits when a request did not finish cleanly. */
const TRUNCATION_PATTERN = /hit max_tokens limit/;
const ECHO_PATTERN = /Model echoed (\d+)\/(\d+) slots/;
const LOG_WINDOW_SLACK_MS = 250;

/** Dialogue lines per source language; a page is six lines, realistic bubble shapes. */
const DIALOGUE = {
  ja: ['待たせたわね…', '昨日は時間がなかったけど今日はいっぱいえちしようね', 'それじゃこっちおいで', 'ううん、大丈夫だよ', 'わかった、もう我慢できない', '一緒に帰ろう'],
  zh: ['让你久等了', '昨天没时间，今天可以好好亲热', '那么过来这边', '没事', '明白了，我已经忍不住了', '一起回家吧'],
  ko: ['기다리게 해서 미안해', '어제는 시간이 없었지만 오늘은 많이 사랑하자', '그럼 이쪽으로 와', '응, 괜찮아', '알겠어, 더 못 참겠어', '같이 집에 가자'],
  ru: ['Прости, что заставил тебя ждать', 'Вчера не было времени, но сегодня можно любить сколько угодно', 'Тогда иди сюда', 'Нет, всё в порядке', 'Понял, больше не могу терпеть', 'Давай пойдём домой вместе'],
  ar: ['آسف لأنني جعلتك تنتظر', 'لم يكن لدي وقت أمس، لكن اليوم يمكننا أن نحب كثيرًا', 'إذن تعال إلى هنا', 'لا، كل شيء بخير', 'فهمت، لم أعد أستطيع الانتظار', 'لنعد إلى البيت معًا'],
  th: ['ขอโทษที่ทำให้รอ', 'เมื่อวานไม่มีเวลา แต่วันนี้เรารักกันได้มาก', 'งั้นมาทางนี้', 'ไม่เป็นไร', 'เข้าใจแล้ว ทนไม่ไหวแล้ว', 'กลับบ้านด้วยกันเถอะ'],
  hi: ['इंतज़ार कराने के लिए माफ़ करना', 'कल समय नहीं था, लेकिन आज हम बहुत प्यार कर सकते हैं', 'तो यहाँ आओ', 'नहीं, सब ठीक है', 'समझ गया, अब और नहीं सह सकता', 'चलो साथ घर चलते हैं'],
  vi: ['Xin lỗi vì khiến bạn phải chờ', 'Hôm qua không có thời gian, nhưng hôm nay chúng ta có thể yêu nhau nhiều', 'Vậy thì qua đây', 'Không, mọi thứ ổn', 'Hiểu rồi, tôi không thể chịu đựng nữa', 'Chúng ta cùng về nhà đi'],
  fr: ['Pardon de vous faire attendre', 'Hier je n’avais pas le temps, mais aujourd’hui nous pouvons beaucoup nous aimer', 'Alors viens ici', 'Non, tout va bien', 'Compris, je ne peux plus attendre', 'Rentrez chez nous ensemble'],
  es: ['Perdona por hacerte esperar', 'Ayer no tuve tiempo, pero hoy podemos amarnos mucho', 'Entonces ven aquí', 'No, todo está bien', 'Entendido, ya no puedo esperar', 'Volvamos a casa juntos'],
  de: ['Tut mir leid, dass du warten musstest', 'Gestern hatte ich keine Zeit, aber heute können wir uns viel lieben', 'Dann komm hierher', 'Nein, alles ist gut', 'Verstanden, ich kann nicht mehr warten', 'Lass uns zusammen nach Hause gehen'],
  pt: ['Desculpa por fazer você esperar', 'Ontem não tive tempo, mas hoje podemos nos amar muito', 'Então venha aqui', 'Não, está tudo bem', 'Entendido, não consigo mais esperar', 'Vamos para casa juntos'],
};

/** Script family per source language, used to detect an answer that stayed in the source script. */
const SCRIPT_PATTERN = {
  ja: /[\u3040-\u30ff\u4e00-\u9fff]/,
  zh: /[\u4e00-\u9fff]/,
  ko: /[\uac00-\ud7af]/,
  ru: /[\u0400-\u04ff]/,
  ar: /[\u0600-\u06ff]/,
  th: /[\u0e00-\u0e7f]/,
  hi: /[\u0900-\u097f]/,
};

/**
 * Deterministic PRNG so a stress run can be reproduced exactly.
 *
 * @param seed - Integer seed.
 * @returns Function producing uniform values in [0, 1).
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
const label = flags.get('label') ?? 'stress';
const model = flags.get('model') ?? DEFAULT_MODEL;
const seed = Number(flags.get('seed') ?? 20261121);
const comboCount = Math.min(Number(flags.get('combos') ?? 12), 40);
const repeats = Number(flags.get('repeats') ?? 2);
const profile = flags.get('profile') ?? join(homedir(), '.kites-webllm-profile');
const outDir = resolve(flags.get('out-dir') ?? '/tmp');

const random = mulberry32(seed);
const sources = Object.keys(DIALOGUE);
const targets = ['en', 'vi', 'fr', 'ru', 'ja', 'zh', 'ko', 'ar', 'es', 'de'];
const allCombos = [];
for (const source of sources) {
  for (const target of targets) {
    if (source === target) continue;
    if (source === 'auto') continue;
    allCombos.push({ id: `${source}-${target}`, source, target });
  }
}
// Shuffle deterministically, then take a cut, so each run samples a different part of the space.
for (let i = allCombos.length - 1; i > 0; i -= 1) {
  const j = Math.floor(random() * (i + 1));
  [allCombos[i], allCombos[j]] = [allCombos[j], allCombos[i]];
}
const only = flags.get('only');
const selected = allCombos.filter((combo) => !only || combo.id.includes(only)).slice(0, comboCount);

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
 * Whether a slot value is only JSON punctuation (`{}`, `[]`), i.e. a leftover of the protocol.
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
 * Scores one translated page for gross failure.
 *
 * @param page - Page texts and the engine's answer, index-aligned.
 * @param source - Source language id, for the script check.
 * @returns Counts plus the offending slot indices.
 */
function scorePage(page, source) {
  const echoed = [];
  const empty = [];
  const stillSourceScript = [];
  const protocolFragments = [];
  const pattern = SCRIPT_PATTERN[source];
  for (let slot = 0; slot < page.texts.length; slot += 1) {
    const output = page.translated[slot] ?? '';
    if (!output.trim()) empty.push(slot);
    else if (output === page.texts[slot]) echoed.push(slot);
    else if (pattern?.test(output)) stillSourceScript.push(slot);
    else if (isProtocolFragment(output)) protocolFragments.push(slot);
  }
  return {
    slots: page.texts.length,
    echoed,
    empty,
    stillSourceScript,
    protocolFragments,
    failed: new Set([...echoed, ...empty, ...stillSourceScript, ...protocolFragments]).size,
  };
}

if (!existsSync(join(EXTENSION_DIST, 'manifest.json'))) {
  throw new Error(`No built extension at ${EXTENSION_DIST}. Run \`npm run build\` first.`);
}
mkdirSync(profile, { recursive: true });

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
  const pages = [DIALOGUE[combo.source]];
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

    const scored = results.map((result) => scorePage(result, combo.source));
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
    console.log(`${combo.id.padEnd(12)} r${repeat}  ${String(totals).padStart(2)}/${String(slots).padEnd(3)} failed  truncations=${truncations}  ${results.reduce((sum, entry) => sum + entry.ms, 0)}ms`);
  }
}

const resultPath = join(outDir, `kites-stress-${label}.json`);
writeFileSync(resultPath, `${JSON.stringify({ label, model, seed, runs }, null, 2)}\n`);

console.log('\ncombo        failed/slots  rate   truncations  echoWarn  avgMs');
for (const combo of selected) {
  const rows = runs.filter((run) => run.combo === combo.id);
  const slots = rows.flatMap((run) => run.pages).reduce((sum, entry) => sum + entry.slots, 0);
  const failed = rows.flatMap((run) => run.pages).reduce((sum, entry) => sum + entry.failed, 0);
  const truncations = rows.reduce((sum, run) => sum + run.truncations, 0);
  const echoWarn = rows.reduce((sum, run) => sum + run.echoWarnings, 0);
  const ms = rows.flatMap((run) => run.pages).reduce((sum, entry) => sum + entry.ms, 0);
  const pages = rows.flatMap((run) => run.pages).length;
  console.log(
    `${combo.id.padEnd(12)} ${String(failed).padStart(4)}/${String(slots).padEnd(7)} ${(failed / slots * 100).toFixed(1).padStart(5)}%  ${String(truncations).padStart(12)}  ${String(echoWarn).padStart(8)}  ${Math.round(ms / pages)}`,
  );
}
console.log(`\nresult ${resultPath}`);

await context.close();
