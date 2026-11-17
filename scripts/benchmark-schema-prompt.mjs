#!/usr/bin/env node
/**
 * Benchmarks the structured-output prompt delta against a live json-schema host.
 *
 * The claim under test: on the `json-schema` tier the decoder already guarantees the `b0..bN` keys
 * and JSON syntax, so the two format rule lines are dead weight and removing them costs nothing.
 * This script asks the real provider twice with the same content rules - once with the shipped
 * prompt-only scaffolding, once with the schema-tier prompt - and reports whether the keys and the
 * translations survive.
 *
 * The prompts are not re-typed here: they are dumped from the real engine through a throwaway
 * vitest file, so a prompt edit can never leave this benchmark testing a stale copy.
 *
 * Usage:
 *   GROQ_API_KEY=... node scripts/benchmark-schema-prompt.mjs --provider groq --model llama-3.3-70b-versatile
 *   OPENROUTER_API_KEY=... node scripts/benchmark-schema-prompt.mjs --provider openrouter --model openai/gpt-4o-mini
 *
 * The key may also live in worker/.dev.vars, which this script reads for convenience.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

const DUMP_FILE = '/tmp/kites-prompt-variants.json';
const DUMP_TEST = 'scripts/promptDump.bench.test.ts';

/** Pages used for the comparison: the reported Chinese page and a plain Japanese page. */
const PAGES = [
  {
    name: 'zh-6 (reported page)',
    sourceLangId: 'zh',
    lines: [
      '殷想題以限C的人啊',
      '所说被抓住的时候还是孤身一',
      '不过从造成这种规模的破坏来看，老实交代，你的同伙都在哪？',
      '即公，你似的哦修吗？',
      '再说了，我可是客人呐，你得对我更客气点才行啊',
      '……我看你是没搞清楚状况',
    ],
  },
  {
    name: 'ja-12',
    sourceLangId: 'ja',
    lines: [
      'お前、何してるんだ？',
      'やめてくれ',
      'どこに行くつもりだ',
      'そんなはずはない',
      '助けてくれ！',
      'もう遅い',
      'なぜだ…',
      '信じられない',
      '早く行こう',
      '待って',
      '大丈夫か？',
      'ああ、問題ない',
    ],
  },
];

/** Provider hosts and their credential variable, mirroring STRUCTURED_OUTPUT_HOST_MODES. */
const PROVIDERS = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', envVar: 'GROQ_API_KEY' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', envVar: 'OPENROUTER_API_KEY' },
};

/**
 * Prints this script's usage.
 * @returns Nothing.
 */
function usage() {
  console.log('usage: node scripts/benchmark-schema-prompt.mjs --provider groq|openrouter [--model <id>] [--repeat 2]');
}

/**
 * Reads a credential from the environment, falling back to worker/.dev.vars.
 * @param name - Variable name to look up.
 * @returns The credential, or an empty string when absent.
 */
function readCredential(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync('worker/.dev.vars')) return '';
  const line = readFileSync('worker/.dev.vars', 'utf8')
    .split('\n')
    .find((row) => row.trim().startsWith(`${name}=`));
  return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^"|"$/g, '') : '';
}

/**
 * Dumps the two prompt variants from the real engine into DUMP_FILE.
 * @returns Parsed dump: variants keyed by tier, each with its system prompt.
 */
function dumpPrompts() {
  writeFileSync(
    DUMP_TEST,
    `import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { BaseLlmTranslationEngine } from '../src/offscreen/engines/translation/BaseLlmTranslationEngine';

/** Engine that exposes only the prompt, pinned to one structured-output tier. */
class DumpEngine extends BaseLlmTranslationEngine {
  /** Tier this instance pretends to negotiate. */
  public tier = 'prompt-only';

  protected override promptOutputMode() {
    return this.tier;
  }

  protected async requestLlm() {
    return '{}';
  }

  public prompt() {
    return this.buildSystemPrompt('the detected source language', 'English', [], undefined);
  }
}

describe('prompt dump', () => {
  it('writes both variants', () => {
    const engine = new DumpEngine();
    const promptOnly = engine.prompt();
    engine.tier = 'json-schema';
    const schema = engine.prompt();
    writeFileSync('${DUMP_FILE}', JSON.stringify({ 'prompt-only': promptOnly, 'json-schema': schema }));
  });
});
`
  );
  try {
    execFileSync('npx', ['vitest', 'run', DUMP_TEST], { stdio: 'ignore' });
  } finally {
    unlinkSync(DUMP_TEST);
  }
  return JSON.parse(readFileSync(DUMP_FILE, 'utf8'));
}

/**
 * Builds the strict keyed schema the extension sends for a batch.
 * @param count - Number of slots.
 * @returns JSON schema with the exact b0..bN keys required.
 */
function keyedSchema(count) {
  const properties = {};
  for (let index = 0; index < count; index += 1) properties[`b${index}`] = { type: 'string' };
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/**
 * Calls one chat completion with strict json_schema output.
 * @param provider - Provider entry from PROVIDERS.
 * @param key - API key.
 * @param model - Model id.
 * @param systemPrompt - System prompt variant under test.
 * @param lines - Source lines for this request.
 * @returns Status, latency, parsed object, and raw error when the call failed.
 */
async function callJsonSchema(provider, key, model, systemPrompt, lines) {
  const source = {};
  lines.forEach((line, index) => {
    source[`b${index}`] = line;
  });
  const body = {
    model,
    temperature: 0,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Translate SOURCE from the detected source language to English.\n\nSOURCE:\n${JSON.stringify(source)}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'translation_batch', strict: true, schema: keyedSchema(lines.length) },
    },
  };

  const started = Date.now();
  const response = await fetch(provider.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - started;
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(JSON.parse(text).choices[0].message.content);
  } catch {
    parsed = null;
  }
  return { status: response.status, elapsed, parsed, raw: text.slice(0, 300) };
}

/**
 * Scores one answer: JSON parse, exact keys, and how many lines stayed in source script.
 * @param lines - Source lines.
 * @param parsed - Parsed model answer, or null.
 * @returns Score object.
 */
function score(lines, parsed) {
  const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
  const expected = lines.map((_line, index) => `b${index}`);
  const keys = parsed ? Object.keys(parsed) : [];
  const exactKeys = keys.length === expected.length && expected.every((key) => keys.includes(key));
  const kept = parsed ? expected.filter((key) => parsed[key] === lines[Number(key.slice(1))]).length : 0;
  const cjkLeft = parsed ? expected.filter((key) => cjk.test(parsed[key] ?? '')).length : 0;
  return { exactKeys, kept, cjkLeft };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? fallback : args[at + 1];
  };
  const providerId = option('provider', 'groq');
  const provider = PROVIDERS[providerId];
  if (!provider) {
    usage();
    process.exit(2);
  }
  const model = option('model', providerId === 'groq' ? 'llama-3.3-70b-versatile' : 'openai/gpt-4o-mini');
  const repeats = Number(option('repeat', 2));
  const key = readCredential(provider.envVar);
  if (!key) {
    console.error(`no ${provider.envVar} in the environment or worker/.dev.vars`);
    process.exit(2);
  }

  const prompts = dumpPrompts();
  console.log(`provider=${providerId} model=${model} repeats=${repeats}`);
  console.log(`prompt-only prompt: ${prompts['prompt-only'].length} chars`);
  console.log(`json-schema prompt: ${prompts['json-schema'].length} chars`);
  console.log(`delta: ${prompts['prompt-only'].length - prompts['json-schema'].length} chars\n`);

  const rows = [];
  for (const variant of ['prompt-only', 'json-schema']) {
    for (const page of PAGES) {
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        const result = await callJsonSchema(provider, key, model, prompts[variant], page.lines);
        const scored = result.parsed ? score(page.lines, result.parsed) : { exactKeys: false, kept: -1, cjkLeft: -1 };
        rows.push({
          variant,
          page: page.name,
          repeat,
          status: result.status,
          keys: scored.exactKeys ? 'exact' : 'WRONG',
          kept: scored.kept,
          cjk: scored.cjkLeft,
          ms: result.elapsed,
          error: result.parsed ? '' : result.raw.replace(/\s+/g, ' ').slice(0, 80),
        });
      }
    }
  }
  console.table(rows);
}

await main();
