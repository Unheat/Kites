#!/usr/bin/env node
/**
 * Runs the real CustomApiEngine across every structured-output tier against a live OpenAI-compatible
 * endpoint, and reports both the translations and the exact request each tier produced.
 *
 * Why a script and not a test: it needs a network key and a provider that is up, so it must never run
 * as part of `npm test`. It writes a throwaway vitest file, runs it with the key passed through the
 * environment, prints the report, and deletes the file. The key is never written to disk.
 *
 * Usage:
 *   OPENROUTER_TEST_KEY=sk-or-... node scripts/benchmark-custom-api-modes.mjs
 *   OPENROUTER_TEST_KEY=... OPENROUTER_TEST_MODEL=google/gemma-4-26b-a4b-it:free node scripts/benchmark-custom-api-modes.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const RESULT_FILE = '/tmp/kites-live-modes.json';
const TEMP_TEST = '.workflow/customapi-live.bench.test.ts';

/** Throwaway harness: drives the engine, records the request bodies, writes the report. */
const HARNESS = `import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { CustomApiEngine } from '../src/offscreen/engines/translation/CustomApiEngine';
import type { StructuredOutputModeId } from '../src/shared/translation/outputModes';

/** Pages used for the live mode comparison. */
const PAGES = [
  {
    name: 'zh-6 (reported page)',
    lang: 'zh',
    lines: [
      '殷想題以限C的人啊',
      '所说被抓住的时候还是孤身一',
      '不过从造成这种规模的破坏来看，老实交代，你的同伙都在哪？',
      '即公，你似的哦修吗？',
      '再说了，我可是客人呐，你得对我更客气点才行啊',
      '……我看你是没搞清楚状况',
    ],
  },
  { name: 'ja-3', lang: 'ja', lines: ['逃げろ！', 'くそっ', 'よくやった'] },
];

const CJK = /[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff]/;
const captured: any[] = [];
let activeMode = '';

/** Runs one live batch through the real engine for a given output mode. */
async function runMode(mode: StructuredOutputModeId, model: string, page: any) {
  const engine = new CustomApiEngine({
    id: 'live-' + mode,
    provider: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelName: model,
    apiKey: process.env.OPENROUTER_TEST_KEY as string,
    outputMode: mode,
  });
  await engine.init();

  const started = Date.now();
  let error = '';
  let out: string[] = [];
  try {
    out = await engine.translate(page.lines, page.lang, 'en');
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }
  const ms = Date.now() - started;
  return {
    mode,
    page: page.name,
    status: error ? 'ERROR' : 'ok',
    kept: out.filter((line, index) => line === page.lines[index]).length,
    cjk: out.filter((line) => CJK.test(line ?? '')).length,
    blank: out.filter((line) => !line || !line.trim()).length,
    literalNewline: out.filter((line) => line.includes('\\\\n')).length,
    ms,
    error: error.slice(0, 120),
    out,
  };
}

describe('live custom api modes', () => {
  it('runs every mode against the real endpoint', async () => {
    const model = process.env.OPENROUTER_TEST_MODEL || 'nvidia/nemotron-3.5-super-vl:free';
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: any, init?: RequestInit) => {
      try {
        const body = JSON.parse(String(init?.body ?? '{}'));
        const system = String(body.messages?.[0]?.content ?? '');
        captured.push({
          mode: activeMode,
          promptChars: system.length,
          responseFormat: body.response_format?.type ?? 'none',
          keyContractInPrompt: system.includes('exact same keys as SOURCE'),
        });
      } catch {
        // best effort: a body we cannot read does not change the request
      }
      return (realFetch as typeof fetch)(input as RequestInfo, init);
    }) as typeof fetch;

    const rows = [];
    for (const mode of ['json-schema', 'json-object', 'prompt-only'] as StructuredOutputModeId[]) {
      for (const page of PAGES) {
        activeMode = mode + '/' + page.name;
        rows.push(await runMode(mode, model, page));
      }
    }
    writeFileSync('${RESULT_FILE}', JSON.stringify({ rows, captured }, null, 2));
  }, 900000);
});
`;

if (!process.env.OPENROUTER_TEST_KEY) {
  console.error('set OPENROUTER_TEST_KEY (a throwaway key); it is never written to disk');
  process.exit(2);
}

writeFileSync(TEMP_TEST, HARNESS);
try {
  execFileSync('npx', ['vitest', 'run', TEMP_TEST], { stdio: 'ignore', env: process.env });
} finally {
  rmSync(TEMP_TEST, { force: true });
}

if (!existsSync(RESULT_FILE)) {
  console.error('no result file: the harness did not finish');
  process.exit(1);
}
const { rows, captured } = JSON.parse(readFileSync(RESULT_FILE, 'utf8'));
const model = process.env.OPENROUTER_TEST_MODEL || 'nvidia/nemotron-3.5-super-vl:free';
console.log(`model=${model}\n`);
console.table(rows.map(({ out, ...rest }) => rest));
console.log('request shapes actually sent:');
console.table(captured);
for (const row of rows) {
  console.log(`\n--- ${row.mode} / ${row.page}`);
  console.log(row.out.map((line) => '  ' + line).join('\n'));
}
