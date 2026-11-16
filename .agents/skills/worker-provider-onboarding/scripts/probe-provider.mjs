#!/usr/bin/env node
/**
 * Provider contract probe for Kites worker onboarding.
 *
 * Sends the same request the worker sends and reports which structured-output mode an endpoint
 * really supports. Credentials come from the environment and are never written to disk or printed.
 *
 * Usage:
 *   API_KEY=… BASE_URL=… MODEL=… node probe-provider.mjs [--health] [--rounds N] [--enforcement]
 *
 * Environment:
 *   API_KEY        Bearer key (openai) or x-goog-api-key (gemini). Required.
 *   BASE_URL       API root, e.g. https://api.provider.com/v1. Required.
 *   MODEL          Exact upstream model id. Required.
 *   KIND           'openai' (default) or 'gemini'.
 *   SLOTS          Comma-separated slot count/keys, default 'b0,b1'.
 *   MAX_TOKENS     Completion budget, default 256.
 *   EXTRA_HEADERS  JSON object of extra headers, e.g. '{"HTTP-Referer":"https://kites.ai"}'.
 */

const KIND = (process.env.KIND || 'openai').toLowerCase();
const API_KEY = process.env.API_KEY || '';
const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');
const MODEL = process.env.MODEL || '';
const SLOTS = (process.env.SLOTS || 'b0,b1').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 256);
const EXTRA_HEADERS = JSON.parse(process.env.EXTRA_HEADERS || '{}');

const argv = process.argv.slice(2);
const ROUNDS = Number(argv[argv.indexOf('--rounds') + 1]) > 0 ? Number(argv[argv.indexOf('--rounds') + 1]) : 3;
const MODES = ['schema', 'object', 'prompt'];

if (!API_KEY || !BASE_URL || !MODEL) {
  console.error('Set API_KEY, BASE_URL and MODEL. See the header of this file.');
  process.exit(2);
}

const SOURCE = Object.fromEntries(SLOTS.map((key, index) => [key, index === 0 ? 'こんにちは。' : '谢谢你！']));
const SYSTEM = 'Translate each SOURCE value into English. Reply with one JSON object using the same keys. No prose.';
const USER = `Translate SOURCE into English.\n\nSOURCE:\n${JSON.stringify(SOURCE)}`;

/** Schema asserting the prompt's own keys. */
const slotSchema = {
  type: 'object',
  properties: Object.fromEntries(SLOTS.map((key) => [key, { type: 'string' }])),
  required: SLOTS,
  additionalProperties: false,
};

/** Deliberately contradictory schema: an enforcing endpoint cannot answer with the prompt's keys. */
const enforcementSchema = {
  type: 'object',
  properties: { alpha: { type: 'string', enum: ['ZZZ-ONLY'] }, beta: { type: 'string' } },
  required: ['alpha', 'beta'],
  additionalProperties: false,
};

/** Builds the request body for one mode, mirroring the worker adapters. */
function bodyFor(mode, schema) {
  if (KIND === 'gemini') {
    const generationConfig = { temperature: 0, maxOutputTokens: MAX_TOKENS };
    if (mode !== 'prompt') generationConfig.responseMimeType = 'application/json';
    if (mode === 'schema') generationConfig.responseJsonSchema = schema;
    return {
      contents: [{ role: 'user', parts: [{ text: USER }] }],
      systemInstruction: { parts: [{ text: SYSTEM }] },
      generationConfig,
    };
  }
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: USER },
    ],
    temperature: 0,
    max_tokens: MAX_TOKENS,
    stream: false,
  };
  if (mode === 'schema') body.response_format = { type: 'json_schema', json_schema: { name: 'translation_response', strict: true, schema } };
  if (mode === 'object') body.response_format = { type: 'json_object' };
  return body;
}

/** Sends one request and extracts the model text plus the fields that decide a mode. */
async function send(mode, schema) {
  const url = KIND === 'gemini'
    ? `${BASE_URL}/models/${MODEL}:generateContent`
    : `${BASE_URL}/chat/completions`;
  const headers = KIND === 'gemini'
    ? { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY, ...EXTRA_HEADERS }
    : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}`, ...EXTRA_HEADERS };

  const started = Date.now();
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyFor(mode, schema)) });
  } catch (error) {
    return { status: 0, ms: Date.now() - started, content: '', finish: 'transport', error: String(error.name) };
  }
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* non-JSON error page */ }

  if (KIND === 'gemini') {
    const candidate = payload?.candidates?.[0];
    return {
      status: response.status,
      ms: Date.now() - started,
      content: candidate?.content?.parts?.map((part) => part.text).join('') ?? '',
      finish: candidate?.finishReason ?? '',
      tokens: payload?.usageMetadata?.totalTokenCount ?? null,
      error: payload?.error ? `${payload.error.status}/${payload.error.code}` : '',
      model: payload?.modelVersion ?? MODEL,
    };
  }
  const choice = payload?.choices?.[0];
  return {
    status: response.status,
    ms: Date.now() - started,
    content: choice?.message?.content ?? '',
    finish: choice?.finish_reason ?? '',
    tokens: payload?.usage?.total_tokens ?? null,
    error: payload?.error?.message?.slice(0, 80) ?? '',
    model: payload?.model ?? MODEL,
  };
}

/** A mode passes only when the answer is one JSON object with exactly the requested keys. */
function isValidKeyedJson(content) {
  if (typeof content !== 'string' || !content.trim()) return false;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const keys = Object.keys(parsed).sort();
    return JSON.stringify(keys) === JSON.stringify([...SLOTS].sort())
      && SLOTS.every((key) => typeof parsed[key] === 'string');
  } catch {
    return false;
  }
}

async function health() {
  const result = await send('prompt', null);
  console.log(JSON.stringify({
    kind: KIND, model: MODEL, status: result.status, ms: result.ms,
    authenticated: result.status !== 401 && result.status !== 403,
    error: result.error || undefined,
  }));
  process.exit(result.status === 200 ? 0 : 1);
}

async function enforcement() {
  // A router can hand the request to a backend that burns the budget thinking. That answer says
  // nothing about enforcement, so retry until one attempt produces a judgement on the keys.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await send('schema', enforcementSchema);
    let keys = [];
    try { keys = Object.keys(JSON.parse(result.content)); } catch { /* not JSON */ }

    if (result.status !== 200) {
      console.log(JSON.stringify({ attempt, status: result.status, error: result.error, verdict: 'inconclusive: request failed' }));
      if (result.status === 401 || result.status === 403) process.exit(1);
      continue;
    }
    if (keys.length === 0) {
      console.log(JSON.stringify({ attempt, status: 200, finish: result.finish, verdict: 'inconclusive: no usable JSON to judge' }));
      continue;
    }

    const enforced = keys.includes('alpha') && keys.includes('beta');
    console.log(JSON.stringify({
      attempt, status: 200, finish: result.finish, keys,
      schemaEnforced: enforced,
      verdict: enforced
        ? 'json-schema IS enforced (schema keys returned)'
        : 'response_format accepted but NOT enforced (prompt keys returned)',
      raw: result.content.slice(0, 200),
    }));
    process.exit(0);
  }
  console.log(JSON.stringify({ verdict: 'inconclusive after 3 attempts: repeat at a quieter time' }));
  process.exit(1);
}

async function bruteForce() {
  for (const mode of MODES) {
    const rows = [];
    for (let i = 0; i < ROUNDS; i += 1) rows.push(await send(mode, slotSchema));
    const passed = rows.filter((row) => row.status === 200 && row.finish !== 'length' && isValidKeyedJson(row.content)).length;
    console.log(`\n=== ${mode}: ${passed}/${rows.length} usable ===`);
    for (const row of rows) {
      const valid = row.status === 200 && isValidKeyedJson(row.content);
      console.log(`${row.status} ${row.ms}ms finish=${row.finish} tokens=${row.tokens} validKeyedJson=${valid} model=${row.model}`);
      console.log(`   ${valid ? JSON.stringify(row.content.slice(0, 120)) : JSON.stringify((row.content || row.error || '').slice(0, 120))}`);
    }
  }
  console.log('\nDeclare the first mode above that passed every round. If none did, the working option is prompt-only.');
}

if (argv.includes('--health')) await health();
else if (argv.includes('--enforcement')) await enforcement();
else await bruteForce();
