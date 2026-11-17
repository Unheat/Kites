# Plan: tier-dependent prompt format rules

**Mode**: manual (DeepAI Code child-task path). Judge gates are inline self-audits because the
delegated judge children stall after ~4-8 tool items on this repo (4 consecutive attempts), which is
disclosed in `.workflow/evidence-tiered-prompts.md`.

## Grounded cause

`buildSystemPrompt` ships two output-format rules to every host: the keyed-object contract and the
raw-JSON guard. A `json-schema` request constrains decoding, so neither rule can be violated; the
lines are tokens spent on instructions the model has no freedom to break.

## Bounded scope

- `src/shared/translation/outputModes.ts` — `formatRulesFor(mode)` over the existing tier catalog.
- `src/offscreen/engines/translation/BaseLlmTranslationEngine.ts` — tier-aware prompt assembly,
  `promptOutputMode()` hook (default `prompt-only` = today's behaviour).
- `src/offscreen/engines/translation/CustomApiEngine.ts` — report the live tier; retrofit the
  missing rules onto the degraded retry.
- Tests: `BaseLlmTranslationEngine.prompt.test.ts`, `CustomApiEngine.test.ts`.
- Script: `scripts/benchmark-schema-prompt.mjs` (live verification).

**Out of scope**: prompt-only worked example, chunk budget, OCR text handling, worker-side prompts.

## Approach

One content-rule block (unchanged) + format rules derived from the tier. No second prompt template.

## Decisive test

- `npx vitest run src/offscreen/engines/translation/BaseLlmTranslationEngine.prompt.test.ts`
- `npx vitest run src/offscreen/engines/translation/CustomApiEngine.test.ts`
- Live: `node scripts/benchmark-schema-prompt.mjs --provider groq` — keys exact, no CJK residue,
  same translations as the shipped prompt.

## Repo obligations

- TSDoc on every added symbol (docs:check ratchet), `npm test`, `tsc`, `lint`, `docs:check`, `build`.
- No ADR: reversible prompt-internal change, covered by tests.
