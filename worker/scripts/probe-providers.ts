/**
 * Live Provider Connectivity & Health Probe
 *
 * Safely tests connections to all enabled upstream LLM providers (Gemini, Groq, Mistral, OpenRouter).
 * Security: Reads keys from gitignored worker/.dev.vars or process.env. Masks all keys in console output.
 *
 * Usage:
 *   npx tsx worker/scripts/probe-providers.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDER_ROUTES, ProviderRouteConfig } from '../src/config/providers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_VARS_PATH = path.resolve(__dirname, '../.dev.vars');

/**
 * Loads environment variables from worker/.dev.vars without external dependencies.
 */
function loadDevVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (fs.existsSync(DEV_VARS_PATH)) {
    const lines = fs.readFileSync(DEV_VARS_PATH, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        vars[key] = val;
      }
    }
  }
  return vars;
}

const localVars = loadDevVars();

/**
 * Resolves an API key from process.env or worker/.dev.vars.
 */
function getSecret(envVarName?: string): string | undefined {
  if (!envVarName) return undefined;
  return process.env[envVarName] || localVars[envVarName];
}

/**
 * Masks an API key for safe console logging.
 */
function maskSecret(key?: string): string {
  if (!key) return '[NOT CONFIGURED]';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

interface ProbeResult {
  priority: number;
  id: string;
  name: string;
  model: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'NO_KEY';
  statusCode?: number;
  latencyMs?: number;
  preview?: string;
  error?: string;
}

const TEST_PROMPT = 'Return raw JSON only: {"b0": "Hello"} as translation of {"b0": "こんにちは"}.';

async function testGemini(route: ProviderRouteConfig, apiKey: string): Promise<Omit<ProbeResult, 'priority' | 'id' | 'name' | 'model'>> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${route.modelName}:generateContent?key=${apiKey}`;
  const start = performance.now();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: TEST_PROMPT }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 60 },
      }),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { status: 'FAILED', statusCode: res.status, latencyMs, error: errText.slice(0, 100) };
    }
    const data = (await res.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { status: 'SUCCESS', statusCode: 200, latencyMs, preview: text.trim().slice(0, 40) };
  } catch (err: any) {
    return { status: 'FAILED', latencyMs: Math.round(performance.now() - start), error: err.message };
  }
}

async function testOpenAICompatible(route: ProviderRouteConfig, apiKey: string): Promise<Omit<ProbeResult, 'priority' | 'id' | 'name' | 'model'>> {
  const endpoint = `${route.baseUrl}/chat/completions`;
  const start = performance.now();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(route.customHeaders || {}),
      },
      body: JSON.stringify({
        model: route.modelName,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        temperature: 0.1,
        max_tokens: 60,
      }),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { status: 'FAILED', statusCode: res.status, latencyMs, error: errText.slice(0, 100) };
    }
    const data = (await res.json()) as any;
    const text = data?.choices?.[0]?.message?.content || '';
    return { status: 'SUCCESS', statusCode: 200, latencyMs, preview: text.trim().slice(0, 40) };
  } catch (err: any) {
    return { status: 'FAILED', latencyMs: Math.round(performance.now() - start), error: err.message };
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('   Kites Cloudflare Worker Provider Health Probe');
  console.log('======================================================\n');

  // 1. Probe Live Cloudflare Worker Gateway
  process.stdout.write('Checking deployed Cloudflare Gateway (https://api.12094852.xyz/health)... ');
  try {
    const gwStart = performance.now();
    const gwRes = await fetch('https://api.12094852.xyz/health');
    const gwLatency = Math.round(performance.now() - gwStart);
    if (gwRes.ok) {
      console.log(`✅ ONLINE (${gwLatency}ms)`);
    } else {
      console.log(`⚠️ HTTP ${gwRes.status}`);
    }
  } catch (e: any) {
    console.log(`❌ UNREACHABLE: ${e.message}`);
  }

  console.log('\nChecking Upstream LLM Providers in Priority Order:\n');

  // Sort routes by priority
  const sorted = [...PROVIDER_ROUTES].sort((a, b) => a.priority - b.priority);
  const results: ProbeResult[] = [];

  for (const route of sorted) {
    if (!route.enabled) {
      results.push({
        priority: route.priority,
        id: route.id,
        name: route.name,
        model: route.modelName,
        status: 'SKIPPED',
        error: 'Route disabled in config',
      });
      continue;
    }

    if (route.type === 'workers-ai') {
      results.push({
        priority: route.priority,
        id: route.id,
        name: route.name,
        model: route.modelName,
        status: 'SKIPPED',
        error: 'Native Cloudflare Workers AI (requires edge worker runtime)',
      });
      continue;
    }

    const apiKey = getSecret(route.apiKeyEnvVar);
    if (!apiKey) {
      results.push({
        priority: route.priority,
        id: route.id,
        name: route.name,
        model: route.modelName,
        status: 'NO_KEY',
        error: `Secret ${route.apiKeyEnvVar} not set in worker/.dev.vars`,
      });
      continue;
    }

    process.stdout.write(`[#${route.priority}] Probing ${route.name} (${route.modelName})... `);
    let outcome: Omit<ProbeResult, 'priority' | 'id' | 'name' | 'model'>;

    if (route.type === 'gemini') {
      outcome = await testGemini(route, apiKey);
    } else {
      outcome = await testOpenAICompatible(route, apiKey);
    }

    if (outcome.status === 'SUCCESS') {
      console.log(`✅ 200 OK (${outcome.latencyMs}ms) -> "${outcome.preview}"`);
    } else {
      console.log(`❌ HTTP ${outcome.statusCode || 'ERR'} (${outcome.latencyMs}ms): ${outcome.error}`);
    }

    results.push({
      priority: route.priority,
      id: route.id,
      name: route.name,
      model: route.modelName,
      ...outcome,
    });
  }

  console.log('\n======================================================');
  console.log('                   Summary Table');
  console.log('======================================================\n');
  console.table(
    results.map((r) => ({
      Pri: r.priority,
      Provider: r.name,
      Model: r.model,
      Status: r.status,
      HTTP: r.statusCode || '-',
      Latency: r.latencyMs ? `${r.latencyMs}ms` : '-',
      Note: r.preview || r.error || '-',
    }))
  );

  console.log('Security Note: All secrets were masked and never written to logs or disk.');
  console.log('To add API keys for testing, add them to worker/.dev.vars (gitignored).\n');
}

main().catch(console.error);
