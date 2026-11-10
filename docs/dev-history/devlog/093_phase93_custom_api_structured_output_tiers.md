# Devlog 093: Custom API Structured-Output Tiers

## 1. Metadata

- **Date:** 2026-11-10
- **Branch:** `feat/custom-api-structured-output`
- **Feature/Task:** Give custom API profiles an explicit structured-output capability tier and send it on the wire.
- **Status:** Completed; extension suite green (1,360 tests / 118 files), typecheck and lint clean.

## 2. Objective

`CustomApiEngine` accepted a `schema` argument from the base engine and silently discarded it. Every custom endpoint therefore received keyed-JSON instructions as prompt text only, and small models (DeepSeek, Groq 8B, Novita) answered with dropped or hallucinated `b0..bN` keys that the strict keyed parser then rejected. The community pool already guarantees key structure through `response_format`; direct user-configured endpoints had no equivalent.

This change adds one catalog-driven tier per profile, sends the matching `response_format`, and degrades safely when an endpoint refuses it.

## 3. Workflow and Implementation

1. **Catalog first.** `src/shared/customApi.ts` now owns `STRUCTURED_OUTPUT_MODES` (`prompt-only`, `json-object`, `json-schema`) with label and description, matching the worker's `OUTPUT_MODES` ids in `worker/src/config/providers.ts` so a tier name means the same guarantee on both sides. `StructuredOutputModeId` is derived with `(typeof CATALOG)[number]['id']`.
2. **Host table, not host guessing.** `STRUCTURED_OUTPUT_HOST_MODES` maps proven hosts to a tier: native `json_schema` hosts (OpenAI, OpenRouter, Groq, Fireworks, Together, Mistral, Cerebras, SambaNova, xAI, Nebius, DeepInfra) and `json_object` only hosts (DeepSeek, Novita, Hyperbolic, Lepton). Matching is exact-or-subdomain. Everything else — proxies, Ollama, vLLM, search endpoints — resolves to `prompt-only`, because an unrecognized `response_format` is a hard 400 there.
3. **Explicit override wins.** `resolveStructuredOutputMode(provider, baseUrl, explicit)` prefers a persisted user choice over detection, so a user can force `json-schema` on a host the table does not know or pin `prompt-only` on a host whose schema support is broken.
4. **Storage boundary.** `normalizeCustomApiConfig` validates the stored tier against the catalog set derived from `STRUCTURED_OUTPUT_MODES`, and drops it for providers that cannot express the field. An unknown or retired value is discarded, never trusted and never fatal, so configurations saved before this field existed keep working with zero migration.
5. **Dedicated transport.** `structuredOutputClient.ts` builds the chat-completions body and returns the assistant text. It is a raw `fetch`, not the Vercel AI SDK, because the SDK exposes no verified pass-through for a caller-supplied strict schema on every OpenAI-compatible host; the body shape here is the same one `CloudflareTranslateEngine` already sends.
6. **Engine routing.** `CustomApiEngine` now dispatches by provider: `openai` and `openai-compatible` use the raw transport with the resolved tier; `claude` and `gemini` keep the AI SDK path. The `schema` argument finally reaches the request.
7. **UI.** `AddApiForm` renders the tiers straight from the catalog as a three-way segmented control with an auto-detect hint. Clicking a tier pins it for the form session (`Manual · reset to auto` restores detection). Validation errors that look like a `response_format` rejection append the exact fix.

## 4. Roadblocks and Decisions

- **The SDK cannot be trusted to forward a schema.** `@ai-sdk/openai@3` gives no caller-controlled `response_format`; `generateText` with an output schema changes text extraction semantics and would break the existing keyed parser. Sending the body ourselves keeps one code path, one set of assertions, and a body shape already proven in production by the Cloudflare engine.
- **Failed-closed downgrade, not a per-request retry loop.** Only HTTP 400 triggers a downgrade, because 400 is the endpoint *rejecting the parameter* while 401/429/5xx are transient request failures handled by the existing retry classifier. The downgrade is memoized per engine instance so a two-batch page does not spend a doomed round trip per batch.
- **The degraded request drops `max_tokens` too.** Reasoning models (o1/o3/gpt-5) reject `max_tokens`, and that also surfaces as 400. A bare body (`model`, `messages`, `stream`) is accepted by every OpenAI-shaped endpoint, so one ladder covers both rejections instead of guessing which parameter caused it.
- **Gemini and Claude stay `prompt-only`.** Anthropic Messages and Google `generateContent` take provider-specific schema options this engine does not send. Advertising "JSON Schema" in the UI while sending nothing would be a lie, so the control is hidden for them and detection returns `prompt-only`. Native Gemini `responseSchema` is a follow-up that can reuse the same catalog.
- **OpenRouter needs `provider.require_parameters: true`.** Without it OpenRouter may route to a backend that ignores `response_format` and silently returns prose. It is attached only to `json-schema` requests, never to `json-object`.
- **`temperature` is never sent.** Several reasoning models answer 400 to any explicit sampling temperature, and deterministic decoding is not needed when a grammar constrains the output.
- **Listener leak fixed while touching the retry loop.** Each retry attempt registered an `abort` listener on the caller's signal and never removed it, so a long job accumulated one stale closure per retry. The listener is now removed in `finally`.
- **Malformed payloads fail fast.** The transport throws on a non-JSON body, a missing `choices[0].message.content`, or an empty string rather than returning `''`, which would otherwise look like "the model translated nothing" and silently fall back to source text.

## 5. Verification and Next Steps

- `npx vitest run src/` — **1,360 tests / 118 files passed**, including new detection, normalization, body-shape, degradation, and no-downgrade-on-5xx coverage.
- `npx tsc -b` — clean.
- `npx oxlint` on the touched files — clean.
- Known behavior worth remembering: a rejection-driven downgrade is logged with `console.warn` and is invisible in the UI beyond that, because the page still translates. If users start reporting "DeepSeek keys are sometimes missing", check that warning first.
- Next: native Gemini `responseSchema` through the same catalog, and expanding `STRUCTURED_OUTPUT_HOST_MODES` only on documented evidence, not on inference.
