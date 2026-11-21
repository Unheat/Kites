# Translation gate

**Status:** Enforced. `npm run gate:translation` locally, `.github/workflows/translation-gate.yml` in CI.

The rule: **a change that can alter what text reaches a user's page must ship with a measurement of
the real pipeline, and the measurement must be equal to or better than the recorded baseline.**

Green unit tests are not that measurement. They assert plumbing — that a key is parsed, a budget is
spent, an array is the right length. They cannot see whether the model still translated the line,
because the model is not in the test. Two real regressions in this project passed a fully green
suite: a romaji answer (`tsu datsu wa ne…`) accepted as English, and an Arabic answer accepted as
Vietnamese. Both were found by running the pipeline, not by asserting about it.

## What counts as touching the pipeline

`scripts/translation-gate.mjs` holds the list; the short version:

- `src/offscreen/engines/translation/` — prompts, chunking, recovery, failure accounting
- `src/offscreen/engines/ocr/` and `OcrManager.ts` — recognition decides the strings sent
- `src/offscreen/services/TranslationManager.ts`, `PipelineOrchestrator.ts`
- `src/shared/translation/`, `textCleaning.ts`, `LanguageRegistry.ts`, `sourceLanguageHint.ts`,
  `glossary.ts`

Test files are excluded on purpose: a test documents behaviour, it cannot change a user's page.

## Producing the evidence

Run on a machine with a GPU, because the measurement is the real model in a real browser:

```bash
npm run build
npx tsx scripts/webllm-matrix.mjs --label gate --repeats 2
node scripts/translation-gate.mjs --record --from /tmp/kites-matrix-gate.json --repeats 2
node scripts/translation-gate.mjs            # verify before committing
```

`--record` writes `docs/dev-history/receipts/translation-gate/latest.json`, which stores:

- `pipelineFingerprint` — SHA-256 over the tracked pipeline files and their contents
- `commit`, `model`, `repeats`, `seed`, `label`, and the result file it came from
- per-combo `failed` / `slots`

Both must be committed with the change. To record the *reference* build instead, so the next run has
something honest to compare against, use `--absorb`:

```bash
git stash && npm run build
npx tsx scripts/webllm-matrix.mjs --label ref --repeats 2
node scripts/translation-gate.mjs --absorb /tmp/kites-matrix-ref.json
git stash pop && npm run build
``` `baseline.json` is the reference the next run is compared
against; promote a new baseline when you deliberately accept a worse number, and say so in the PR.

For a wide language sweep rather than the fixed combos, use `scripts/llm-language-stress.mjs`
(seeded, random direction sample, gross-failure scoring) and record its output the same way.

## What the gate fails on

| Situation | Result |
| --- | --- |
| No pipeline files in the diff | Pass — nothing to prove |
| Pipeline changed, no receipt | Fail, with the commands to produce one |
| Receipt fingerprint ≠ current pipeline | Fail — the measurement is stale, re-run it |
| Combo worse than baseline by more than `--tolerance` | Fail |
| Equal, improved, or within tolerance | Pass |
| Combo with fewer than 36 slots | Skipped for comparison — too small to mean anything |
| Base ref unavailable (shallow clone) | Fail — a gate that cannot see the diff must not report success |

The comparison is against the **worst run the reference build produced**, not against a single
sample. `baseline.json` stores a band per combo:

```json
"auto-vi-zh": { "slots": 36, "failed": 2, "failedMin": 2, "failedMax": 11 }
```

That band is not caution, it is what twelve runs of the *reference* build measured on this combo:
2, 5, 5, 5, 6, 6, 7, 9, 9, 10, 10, 11 of 36. The reference is a stochastic process at temperature
0.7, so a single-sample baseline fails the reference build itself. `--absorb <result.json>` widens
the band with another reference run and appends to `samples`; `--record` writes the receipt for a
candidate change.

`samples` is stored because min/max alone cannot show how the band was built: absorbing an
accidentally-broken build looks exactly like absorbing an honest run. Check the samples list when a
band is wider than you expect.

`REGRESSION_RATE_TOLERANCE` is 25 % as a secondary guard for when the slot count itself differs
between baseline and receipt (fixture edit, different `--repeats`); the band is the primary check.

## Verified to fail

The gate is only worth having if it still fails a real regression. Verified by injecting 30/36 into
`auto-vi-zh` in a copy of the receipt:

```
translation gate: FAILED
Translation regressed past tolerance:
  auto-vi-zh: 30/36 failed vs baseline 2-11/36 band (+19, 52.8%; the reference
  build never exceeded the band, so this is not sampling noise)
```

`--tolerance` defaults to **0** additional slots, because the band already contains the measured
spread of the reference build; a combo fails only by exceeding the worst run the reference ever
produced. Raise it with `--tolerance` only when you know a fixture or `--repeats` changed the sample
size, and say why in the PR.

## Why this is a CI gate and not a lint rule

- **Lint is the wrong layer.** Oxlint is static and must stay fast; a browser benchmark in it would
  make every commit slow, GPU-dependent, and flaky.
- **A doc alone drifts.** An instruction file is guidance an agent can skip; the searches agree that
  when an instruction file says a check is mandatory but CI no longer runs it, the file is wrong, not
  the commit. So `AGENTS.md` carries one line pointing here, and this workflow carries the teeth.
- **CI cannot run the measurement itself.** GitHub-hosted runners are Linux/CPU with no WebGPU, so
  the real WebLLM benchmark cannot execute there. CI enforces the *evidence*; the hardware runs the
  test. When a GPU runner is available, add the benchmark job to this workflow and keep the receipt
  as the fallback.

## Limits worth knowing

- **The gate measures the model, so it inherits the model's variance.** A change worth less than the
  band's width (for `auto-vi-zh`, nine slots on 36) is invisible here. That is why a translation
  change also needs a *targeted* measurement on the case it changes — the `fr-en-fr` combo exists
  because the CJK fixtures cannot see the already-target oracle at all (it skips 0 of 186 CJK
  fixture lines).
- The gate is only as good as the combos in the baseline. Eleven combos across four source languages
  is coverage of the paths that broke before, not proof about the ~55 other target languages.
- A receipt proves *one* build was measured. It does not prove the measurement was honest; review
  the `label`, `repeats` and the result file in the diff.
- Seeded randomness keeps a stress run reproducible, but a different `--seed` samples different
  directions, so a stress receipt is evidence for the directions it ran, not all of them.
- The baseline band must be re-absorbed when the *reference* changes for a legitimate reason (a
  model upgrade, a fixture edit). Absorbing a candidate change into the band would hide it.
