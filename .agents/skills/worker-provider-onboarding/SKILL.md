---
name: worker-provider-onboarding
description: Add, verify, or debug a provider in the Cloudflare translation worker fallback. Use when told to add a model/provider to the worker fallback, to check whether a provider still works, to decide a provider's structured-output mode, or to set its rate/token limits. Covers docs lookup, live key check, brute-forcing json_schema → json_object → prompt-only with real translation requests, catalog wiring, and the deploy/verification ladder.
---

# Onboarding a provider into the worker fallback

The worker routes translations through `worker/src/config/providers.ts`. A route is only
trustworthy when three things are proven: the credential works, the model returns a usable
keyed-JSON translation, and the declared output mode is actually enforced by that endpoint.

## Hard rules

- **The API key never touches the repo.** Pass it inline in the shell (`API_KEY='…' node …`), or
  export it for one command. Never write it into a file under the repository, never into a script
  that is saved there, never into a commit, docs, or chat. Throwaway scripts go in `/tmp` and are
  deleted in the same session.
- **Never print the key** (`echo`, `set -x`, `console.log(process.env…)`). Print only status codes,
  finish reasons, token counts and model text.
- **A 200 is not proof.** Some endpoints accept `response_format` and ignore it. Prove enforcement
  before declaring `json-schema` (step 4).
- **No route without evidence.** `verificationEvidence: 'probed'` requires an actual call you made
  or saw; otherwise leave `'documented'`/`'unknown'` and say so.

## 1. Decide the wire protocol

Read the catalog entry type you are adding: `openai-compatible`, `gemini`, or `workers-ai`.

- `openai-compatible` → `POST {baseUrl}/chat/completions`, bearer auth.
- `gemini` → `POST {baseUrl}/models/{model}:generateContent`, `x-goog-api-key` header.
- `workers-ai` → **cannot be probed locally** (needs the `AI` binding). Skip to step 8 and prove it
  with `GET /internal/provider-health?route=<id>` after a staging deploy.

## 2. Read the provider's own documentation

Search and then fetch the exact pages, not a summary. You need four answers:

1. Structured output: does it document `response_format` (`json_schema` / `json_object`), or a
   provider-specific field (`responseSchema`, `responseJsonSchema`, `format`)?
2. Rate limits: RPS or RPM, RPD, and the **token** budgets (TPM/TPD) for the exact model id.
3. Max output tokens, and whether `temperature` is accepted (several reasoning models reject it).
4. The exact model id — catalogue pages and model cards often disagree.

## 3. Check the credential before anything else

```bash
API_KEY='PASTE_KEY' BASE_URL='https://api.provider.com/v1' MODEL='provider/model-id' \
node .agents/skills/worker-provider-onboarding/scripts/probe-provider.mjs --health
```

A 401/403 stops here: the key is dead, ask for a new one. 402/429 means the key works but the plan
is exhausted — record that, it is not a code problem.

## 4. Brute-force the three modes, in priority order

`json-schema` → `json-object` → `prompt-only`. The script sends the same request the worker sends:
a system instruction, a `SOURCE` block with two slots, and the mode's `response_format`.

```bash
API_KEY='PASTE_KEY' BASE_URL='https://api.provider.com/v1' MODEL='provider/model-id' \
node .agents/skills/worker-provider-onboarding/scripts/probe-provider.mjs --rounds 3
```

Success for a mode means **all** of: HTTP 200, `finish_reason: stop`, and content parsing as one
JSON object whose keys are exactly the requested slots (`b0`, `b1`). The script prints that verdict
per attempt.

Then prove enforcement for whichever mode looked best — a contradictory schema must be honoured:

```bash
API_KEY='PASTE_KEY' BASE_URL='https://api.provider.com/v1' MODEL='provider/model-id' \
node .agents/skills/worker-provider-onboarding/scripts/probe-provider.mjs --enforcement
```

If the model still answers with the prompt's keys (`b0`/`b1`) instead of the schema's
(`alpha`/`beta`, enum `ZZZ-ONLY`), or a malformed schema is accepted, that endpoint does **not**
enforce schemas — declare `prompt-only` and say why in the route comment.

Gemini equivalent: `KIND=gemini` on the same script; it maps to `responseMimeType` plus exactly one
of `responseJsonSchema` / `responseSchema`.

## 5. Turn evidence into a catalog entry

Add to `PROVIDER_ROUTES` in `worker/src/config/providers.ts`:

```ts
{
  id: 'provider-model',                       // stable, used by ?route= and health reports
  name: 'Provider Model',
  enabled: true,
  priority: N,                                 // contiguous with neighbours; emergency last
  qualityTier: 'high' | 'medium' | 'emergency',
  type: 'openai-compatible',
  baseUrl: 'https://api.provider.com/v1',
  modelName: 'provider/model-id',
  apiKeyEnvVar: 'PROVIDER_API_KEY',
  rpsLimit / rpmLimit / rpdLimit / tpmLimit / tpdLimit,   // omit what the docs do not publish
  maxInflight: 2,
  defaultTimeoutMs: 4000,
  outputCapability: 'json-schema' | 'json-object' | 'prompt-only',
  requestOptions: { … },                       // only what the provider needs
  verificationEvidence: 'probed',
}
```

Rules that keep this maintainable:

- Every limit is optional and independent; **whichever trips first** blocks the route. Token budgets
  are checked before dispatch (consumed + prompt estimate) and charged after (provider usage).
- Record in a comment **why** a mode was chosen, and any rejected shape, so nobody "upgrades" it on
  a 200 later.
- Add the secret name to `worker/src/types.ts` `Env` and to `worker/WAF_RULES.md`.
- Removing a route: delete the block and renumber priorities contiguously.

## 6. Tests and gate

```bash
npm --prefix worker test && npx tsc --noEmit -p worker/tsconfig.json
npm run lint && npm test && npm run docs:check && npm run docs:api && npm run build
```

`worker/test/provider-health.test.ts` iterates the real catalog and asserts each route's wire mode
matches its declared capability, so a new route is covered automatically. Only touch
`provider-route-parity.test.ts` when it names a route you removed.

## 7. Deploy and verify on the real service

```bash
cd worker
npx wrangler versions upload          # candidate, no traffic
npx wrangler deploy --env staging     # isolated worker; set its secrets separately
npx wrangler deploy                   # production, only after staging looks right
printf '%s' "$PROVIDER_API_KEY" | npx wrangler secret put PROVIDER_API_KEY
```

Then ask the deployed worker, not your laptop:

```bash
curl -sS "https://api.12094852.xyz/internal/provider-health?route=<route-id>" \
  -H "x-provider-health-token: $PROVIDER_HEALTH_TOKEN"
```

Expect `{"verdict":"ok","mode":"<declared mode>","attempts":1}`. `invalid_output` names a detail
(`no_content`, `finish_length`, `finish_other`, `not_keyed_json`, `safety_refusal`) — a body shape
problem, not a dead key. `upstream_error` with 503/408 is provider capacity.

## 8. Report back

Give a table with verdict, route, mode, status and latency, plus what changed. Do not silently
disable or "fix" a route on suspicion: state the evidence and let the owner decide.
