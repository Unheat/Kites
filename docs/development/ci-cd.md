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

All three workflows install pinned Node (`.nvmrc`, currently 22.14) with `npm ci`.

---

## 2. Main CI (`ci.yml`)

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

## 5. Release Process (Extension)

1. Verify `npm test` and `npm run build` pass locally on `main`.
2. Bump the version in **both** `package.json` and `manifest.json` (single-source rule: they must match).
3. Package: `npm run package` → builds and zips `dist/` as `kites-vX.Y.Z.zip`.
4. Tag `vX.Y.Z` on the release commit and create the GitHub Release with the zip attached. Convention: title `vX.Y.Z - short description`, no emoji icons in release assets.
5. Upload the zip to the Chrome Web Store dashboard (store version trails the GitHub tag).

Historical note: re-pointing an existing tag makes its release a draft — republish with `gh release edit --draft=false --latest`.

## 6. Cloudflare Worker Deployment (`worker/`)

Never deploy directly to production users (AGENTS.md §10). The promotion ladder is:

1. **Isolated preview** — `npx wrangler versions upload --cwd worker` (private preview URL, no live traffic, no production DB writes).
2. **Staging** — `npx wrangler deploy --env staging --cwd worker` (isolated staging DO SQLite database for end-to-end tests).
3. **Production** — only after `npm --prefix worker test` passes and preview/staging checks succeed: `npm --prefix worker run deploy` (or `npx wrangler versions deploy`).

Production endpoint: `api.12094852.xyz` (see `src/shared/constants.ts` for client-side endpoint constants).

---

## 7. What Is NOT Automated

- **Chrome Web Store upload** — manual dashboard step after each release.
- **Visual acceptance QA** — smoke artifacts are evidence, not gates; real-page visual checks stay manual.
- **Extension store listing copy** — description updates are committed to the repo (`chrome_store/`) but applied manually.
- **Website deploy** (`site/`) — deployed out-of-band; `site/index.html` and assets are not built by CI.
