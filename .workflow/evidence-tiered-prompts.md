# Evidence: tier-dependent prompt format rules

mode=manual — **judge gates were inline self-audits**, not independent reviewers: the delegated
judge children stall on this repo (4 consecutive), so the PR gate degrades to a self-audit with this
disclosure rather than a false claim that a judge ran.

## Guarantees

| item | before | after |
| --- | --- | --- |
| prompt-only prompt | key contract + raw-JSON guard | unchanged (221 tokens) |
| json-object prompt | both rules | key contract only (194 tokens) |
| json-schema prompt | both rules | content rules only (163 tokens) |
| degraded retry after a 400 | re-sent schema-tier prompt, no scaffolding | rules appended to the system turn |
| answer mapping | correct | correct (tests assert `['bonjour','monde']`) |

## Verification

```
npx vitest run src/offscreen/engines/translation/BaseLlmTranslationEngine.prompt.test.ts  # 7 passed (RED first: 2 failed)
npx vitest run src/offscreen/engines/translation/CustomApiEngine.test.ts                  # 27 passed
npm test                                                                                  # 1524 passed, 129 files
npx tsc --noEmit                                                                          # clean
npm run lint                                                                              # 0 errors
npm run docs:check                                                                        # delta +0, 0 shape violations
npm run build                                                                             # ok
```

Commit trail: `test: add reproducer for tier-dependent prompt format rules` (RED) →
`feat(translation): write the prompt for the structured-output tier in use` (GREEN).

## Pending (cannot be closed locally)

Live benchmark against a real `json-schema` host: `worker/.dev.vars` keys answer 401/400, so
`scripts/benchmark-schema-prompt.mjs` has only been exercised up to the HTTP call. It reports
status, exact-key match, kept lines, CJK residue and latency per variant; it must be run with a
working `GROQ_API_KEY` or `OPENROUTER_API_KEY` before this change is claimed to preserve output
quality on schema hosts.
