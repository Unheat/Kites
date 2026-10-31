# Devlog 091: Community Pool JSON, Security, and Routing Hardening

## 1. Metadata

- **Date:** 2026-10-31
- **Branch:** `fix/community-pool-hardening`
- **Feature/Task:** Backward-compatible Community Shared Pool hardening and new-client keyed JSON validation.
- **Status:** Implementation and local verification in progress. Not deployed or released.

## 2. Objective

Prevent malformed model replies from being accepted as manga dialogue, make selected upstream routes observable, and repair authentication/concurrency/accounting boundaries without cutting off existing extension installs. Keep the existing provider waterfall deadline and tiny models as emergency fallbacks.

## 3. Workflow and Implementation

1. **Re-audited earlier findings.** Both existing cloud and Custom API clients discard the schema argument; the gateway was not stripping a schema that arrived on the wire. Gemma 4 supports system instructions. Groq has a Qwen 3.6 model card despite its omission from the main model table. Mistral's API ID and documentation slug differ. Corrected these assumptions before finalizing route behavior.
2. **Extracted pure keyed protocol helpers.** Shared schema/SOURCE parsing and validation do not import Chrome or DOM APIs. New cloud requests include optional structured-format metadata; the worker derives keys from the existing SOURCE format for legacy requests.
3. **Hardened client parsing.** Cloud/custom paths reject malformed keyed prose rather than falling through to positional dialogue. Parsing metadata is per request. Cloud batch splitting accounts for prompt/glossary overhead and rejects an oversized segment without truncating it.
4. **Hardened gateway boundaries.** Token-cache identity keys are collision resistant and expiry bounded; auth outages are distinct from bad credentials. Streamed byte limits, runtime message validation, safe errors, quota-endpoint guards, and compatible CORS replace shallow casts/reflection.
5. **Separated routing concerns.** Canonical provider capability/evidence catalog, adapters, circuit state, workload latency, and quota storage have distinct modules. Groq-first static ordering is the initial policy; timeout EMA remains adaptive while route ordering awaits evidence. Model-specific parameters and strict output acceptance remain separate.
6. **Replaced formula-copy tests.** Worker tests import production services, and quota migrations use real local SQLite rather than a handwritten SQL parser. Worker tests now have independent Node Vitest configuration and a CI job.
7. **Corrected deployment guidance.** A separate staging Worker does not inherit production secrets. A same-Worker version can retain them, but Workers implementing Durable Objects do not receive ordinary version URLs under current platform rules. A separately authorized, protected 0%-traffic diagnostic build could test fixed adapter inputs using server secrets without invoking production DO storage.

## 4. Roadblocks and Decisions

- **Schema support vs host support:** Models can support structured output through one serving framework while an endpoint exposes different parameters. Missing docs are not proof of unsupported capability. Gemma's `responseJsonSchema` report is useful evidence but does not establish reliable free-tier behavior for both configured variants. Live capability flags require authorized tests.
- **Quota policy history:** Charging failed attempts was deliberate anti-abuse policy (Devlog 021). Success-only translation allowance must retain separate bounded attempt admission, transaction-safe reservation settlement, and restart/rollover tests.
- **Free storage budget:** More than one SQL statement was already written on success. Index maintenance can add billed row writes. Do not claim 70k/day safely fits a 100k-write budget without accounting evidence. The conservative admission policy must be documented and verified before rollout.
- **Runtime transactions:** Cloudflare DO SQL needs the storage transaction API, not a production implementation built around raw SQL BEGIN/COMMIT. Node SQLite tests adapt their transaction runner to the same interface.
- **No silent dialogue loss:** An early draft truncated oversized text to fit the request; review rejected that approach. Final behavior throws a typed payload-limit error so the existing engine fallback can preserve the full source.

## 5. Verification and Next Steps

Completed checkpoints:
- Extension regression suite: **1,329 tests / 117 files passed** after client hardening.
- Production extension build passed; existing large-bundle warning remains.
- Safe provider-probe default lists the catalog and sends **no inference**.

Worker final test/typecheck totals and local workerd verification must be recorded once source stabilization completes. Intermediate runs are not final acceptance. No live provider probe, staging deploy, production promotion, extension version bump, or store publication has occurred.

Remaining release gates: exact provider/schema compatibility using authorized server-side synthetic probes, isolated staging/account configuration, old/new extension browser testing, live model quality/latency comparison, WAF/alternate endpoint verification, and explicit deployment/publication authorization.

See [audit checklist](../../development/community-pool-audit.md), [backend architecture](../../architecture/backend-worker.md), and [ADR-011](../../decisions/ADR-011-community-pool-validation-and-health-routing.md).
