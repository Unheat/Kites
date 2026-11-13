# CI/CD & Release Pipeline

**Status:** Current as of v1.3.0 (2026-10-30)
**Scope:** GitHub Actions workflows, release packaging, Cloudflare Worker deployment, and Chrome Web Store distribution.

---

## 1. Workflow Overview

| Workflow | File | Triggers | Purpose |
| --- | --- | --- | --- |
| **Kites CI/CD** | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | push/PR → `main` | Lint, unit tests, production build, artifact upload |
| **Pipeline Integration Smoke Test** | [`.github/workflows/pipeline-smoke.yml`](../../.github/workflows/pipeline-smoke.yml) | push/PR touching `src/offscreen/**`, `src/shared/**`, `src/test/**`; manual dispatch | CPU-tier full-pipeline smoke matrix + visual pipeline suite |
| **Validate Model Registry URLs** | [`.github/workflows/validate-model-registry.yml`](../../.github/workflows/validate-model-registry.yml) | push/PR, weekly (Sun 00:00 UTC) | Headless check that every external model URL in the OCR/inpaint/bubble/color registries resolves |
| **Worker Provider Key Health** | [`.github/workflows/worker-key-health.yml`](../../.github/workflows/worker-key-health.yml) | push to `main` touching the provider catalog/probe/workflow, weekly (Mon 03:00 UTC), manual dispatch | Probes every production provider credential through the live Worker and fails when one is rejected |

All workflows install pinned Node (`.nvmrc`, currently 22.14) with `npm ci`.

---

## 2. Main CI (`ci.yml`)

Job `worker-tests` separately installs `worker/` dependencies, runs the worker unit tests, and typechecks the worker. No provider credentials or live inference are needed for this job.

Job `test-and-build` runs, in order:

1. **Lint** — `npm run lint` (Oxlint).
2. **Unit tests** — `npm run test` (Vitest, `src/` only; visual tests are NOT part of this gate).
3. **Build** — `npm run build` (`copy-wasm` → `tsc -b` → `vite build`). TypeScript project checks fail the build.
4. **Artifact** — `dist/` uploaded as `kites-extension-build`, 7-day retention.

PRs to `main` must pass this workflow before merge.

## 3. Pipeline Smoke Matrix (`pipeline-smoke.yml`)

Runs the real offscreen pipeline headlessly on CPU:

- `npm run test:pipeline:smoke` — `src/test/pipelineSmokeMatrix.ts`, multi-tier CPU matrix (Tier 2).
- `npm run test:visual:pipeline` — `src/test/pipelineVisualTest.ts`, emits baked result images.

**Model weight cache:** `src/test/models` cached under key `kites-smoke-models-v1`. Bump the key suffix when the required model set changes.

**Artifacts:** baked smoke/pipeline images are uploaded `if: always()` so a failed page can be inspected without a local rerun.

**Scope caveat:** these are smoke tests, not visual acceptance gates. Green output proves the pipeline completes and produces baked images; it does not prove typesetting parity or inpaint quality on new pages. Visual QA on real pages remains a manual step (see [testing.md](testing.md)).

## 4. Model Registry URL Validation (`validate-model-registry.yml`)

Runs `node scripts/validate-model-urls.mjs`, which extracts every external model download URL referenced by the OCR registry, inpaint engines, bubble detection, and colorization tiers, and performs HEAD/GET reachability checks.

- **Weekly schedule** catches upstream deletions (e.g. Hugging Face repo takedowns) even without code changes.
- A red run means users would hit a broken model download at runtime — fix the registry before shipping.

## 4.1 Worker Provider Key Health (`worker-key-health.yml`)

Worker secrets are write-only, so the only proof a provider key is alive is letting the Worker use it. The job calls `GET /internal/provider-health` (404 unless `PROVIDER_HEALTH_TOKEN` is configured) and reports verdicts only — never key material.

- **Gate semantics:** a rejected credential (`broken > 0`) fails the run. `request_rejected` (`configIssue`) and `unknown` (timeouts, 5xx, quota) are warnings — they mean the catalog shape or upstream state needs attention, not that the key is dead.
- **Repository secret:** `PROVIDER_HEALTH_TOKEN` in GitHub Actions must hold the **same** value as the Worker secret of that name. Both are write-only, so a rotation means generating one value and setting it twice:
  ```bash
  openssl rand -hex 32 | npx wrangler versions secret put PROVIDER_HEALTH_TOKEN --cwd worker
  npx wrangler versions deploy <version-id>@100% --cwd worker -y
  gh secret set PROVIDER_HEALTH_TOKEN --repo Unheat/Kites
  ```
  Never print the value into a log, commit, or chat transcript. A missing GitHub secret is CI wiring, not a dead credential: the job fails immediately saying so.
- **Fork safety:** the job runs only on `Unheat/Kites`, because forks cannot read these secrets.

## 5. Release Process (Extension)

1. Verify `npm test` and `npm run build` pass locally on `main`.
2. Bump the version in **both** `package.json` and `manifest.json` (single-source rule: they must match).
3. Package: `npm run package` → builds and zips `dist/` as `kites-vX.Y.Z.zip`.
4. Tag `vX.Y.Z` on the release commit and create the GitHub Release with the zip attached. Convention: title `vX.Y.Z - short description`, no emoji icons in release assets.
5. Upload the zip to the Chrome Web Store dashboard (store version trails the GitHub tag).

Historical note: re-pointing an existing tag makes its release a draft — republish with `gh release edit --draft=false --latest`.

## 6. Cloudflare Worker Deployment (`worker/`)

Never deploy directly to production users (AGENTS.md §10). The promotion ladder is:

1. **Local verification** — run `npm --prefix worker test` and the worker TypeScript check. CI runs both without live credentials.
2. **Isolated staging** — after deployment authorization, `npx wrangler deploy --env staging --cwd worker`. The explicit staging configuration names a separate Worker and its own Durable Object binding; verify the deployed namespace is distinct before stateful tests. Configure staging secrets separately. A deploy command does not itself run end-to-end tests. Protect the staging endpoint before testing it.
3. **Version candidate** — `npx wrangler versions upload --cwd worker` uploads a candidate without promoting live traffic. Existing encrypted secrets on the same Worker can be retained; separate staging does not inherit them. **Workers implementing Durable Objects do not receive ordinary version URLs under the current platform rules.** A version upload is not a promise of a runnable preview URL. For adapter checks using existing server secrets, a separately authorized diagnostic build can be included at 0% traffic and targeted with a version override. This changes deployment configuration and is not an isolated sandbox. Restrict it to verified developer authentication, fixed synthetic fixtures, no normal translation routes, and no production Durable Object calls. Inspect actual bindings/exposure and remove the diagnostic version after use.
4. **Production** — only after tests and staging/preview checks pass, with explicit promotion authorization: `npm --prefix worker run deploy` (or `npx wrangler versions deploy`). Deploy the backward-compatible worker before publishing client hardening.

Provider checks are opt-in: `npm --prefix worker run test:providers -- --run --route=<route-id>` sends one synthetic request using environment credentials and consumes provider allowance. Without `--run`, the script only lists the catalog. Never commit credentials, log raw responses, infer live model health from invalid local keys, or run paid probes without a budget decision.

The weekly `worker-key-health.yml` gate is the credential path instead: it probes every catalog route through the deployed Worker using the `PROVIDER_HEALTH_TOKEN` GitHub secret (section 4.1).

Production `workers.dev` exposure is a separate rollout check: verify the custom-domain auth/WAF path first, then disable alternate production endpoints explicitly. Staging may retain its own controlled `workers.dev` endpoint. Local configuration alone does not prove the current dashboard exposure state.

Production endpoint: `api.12094852.xyz` (see `src/shared/constants.ts` for client-side endpoint constants).

---

## 7. What Is NOT Automated

- **Chrome Web Store upload** — manual dashboard step after each release.
- **Visual acceptance QA** — smoke artifacts are evidence, not gates; real-page visual checks stay manual.
- **Extension store listing copy** — description updates are committed to the repo (`chrome_store/`) but applied manually.
- **Website deploy** (`site/`) — deployed out-of-band; `site/index.html` and assets are not built by CI.
