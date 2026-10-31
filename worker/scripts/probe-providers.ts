/**
 * Opt-in provider contract probe using synthetic public dialogue only.
 *
 * Usage: npx tsx worker/scripts/probe-providers.ts --run --route=<route-id>
 * This consumes provider quota. Without --run it only lists the catalog.
 * Secrets come from environment variables; values and model text are never logged.
 */
import { PROVIDER_ROUTES } from '../src/config/providers';

const PROBE_TIMEOUT_MS = 6_000;
const PROBE_MAX_OUTPUT_TOKENS = 512;
const SYNTHETIC_SOURCE = { b0: 'こんにちは。', b1: '谢谢你！' };

/** Resolve a deliberately selected catalog route without probing every provider. */
function selectedRoute() {
  const id = process.argv.find((arg) => arg.startsWith('--route='))?.slice('--route='.length);
  const route = PROVIDER_ROUTES.find((candidate) => candidate.id === id);
  if (!route) throw new Error('Select one catalog route with --route=<route-id>.');
  if (!route.enabled) throw new Error('Selected route is disabled pending verification.');
  return route;
}

/** Build a minimal legacy-client request so deployed clients remain part of QA. */
function syntheticRequest() {
  return {
    model: 'kites-translation',
    messages: [
      { role: 'system' as const, content: 'Translate into English. Return only JSON with the same keys as SOURCE. No explanations.' },
      { role: 'user' as const, content: `Translate SOURCE into English.\n\nSOURCE:\n${JSON.stringify(SYNTHETIC_SOURCE)}` },
    ],
    temperature: 0,
    max_tokens: PROBE_MAX_OUTPUT_TOKENS,
    stream: false,
  };
}

/** Execute one explicit external inference and report only safe diagnostic fields. */
async function main(): Promise<void> {
  if (!process.argv.includes('--run')) {
    console.table(PROVIDER_ROUTES.map(({ id, modelName, priority, enabled }) => ({ id, modelName, priority, enabled })));
    console.log('No inference sent. --run --route=<route-id> consumes that provider’s allowance. Set its key in the environment.');
    return;
  }
  const selected = selectedRoute();
  // An explicit probe-only override tests endpoint support without changing live routing.
  const route = process.argv.includes('--test-json-schema')
    ? { ...selected, outputCapability: 'json-schema' as const }
    : selected;
  if (route.type === 'workers-ai') {
    throw new Error('Workers AI must be tested through the isolated staging Worker binding.');
  }
  const secret = route.apiKeyEnvVar ? process.env[route.apiKeyEnvVar] : undefined;
  if (!secret || /placeholder|your[_-]?key|example/i.test(secret)) {
    throw new Error('A valid authorized environment credential is required; no request sent.');
  }
  const { buildSchema, validateKeyedJson } = await import('../../src/shared/translation/keyedJson');
  const request = { ...syntheticRequest(), response_format: {
    type: 'json_schema' as const,
    json_schema: { name: 'translation', strict: true, schema: buildSchema(Object.keys(SYNTHETIC_SOURCE).length) },
  } };
  const start = Date.now();
  const result = route.type === 'gemini'
    ? await (await import('../src/adapters/gemini')).executeGemini(route, request, secret, PROBE_TIMEOUT_MS)
    : await (await import('../src/adapters/openai-compatible')).executeOpenAICompatible(route, request, secret, PROBE_TIMEOUT_MS);
  const content = result.data?.choices?.[0]?.message?.content;
  let valid = false;
  if (result.success && typeof content === 'string') {
    try {
      validateKeyedJson(content, Object.keys(SYNTHETIC_SOURCE));
      valid = true;
    } catch {
      // Probe reports invalid output without printing potentially sensitive upstream text.
    }
  }
  console.log(JSON.stringify({ route: route.id, model: result.data?.model,
    status: result.statusCode, latencyMs: Date.now() - start, validKeyedJson: valid }));
  if (!valid) process.exitCode = 1;
}

main().catch(() => {
  console.error('Probe did not complete. Check route selection, authorized credentials, and provider configuration. No secrets or raw provider errors were logged.');
  process.exitCode = 1;
});
