# Devlog 022: Token-Normalized Adaptive Timeout with DO SQLite Persistence

### 1. Metadata
* **Date:** 2026-09-26
* **Feature/Task:** Token-Normalized Adaptive Timeout (`ms/token`), SQLite Persistence, and 3-Sample Warm-Up
* **Commit:** `b86ebc6`
* **Status:** Completed & Deployed

---

### 2. Objective
Replace coarse raw-latency EMA in `SharedPoolDO.ts` with token-normalized (`ms/token`) speed tracking. Raw latency EMA unfairly penalized dense pages (e.g., 20 text blocks requiring 2.5s) when preceded by tiny single-line bubbles that shrunk the timeout to under 1s. The new system normalizes speed by tokens, scales timeouts proportionally to input length, persists baseline speeds across worker cold starts in Durable Object SQLite, and uses a 3-sample warm-up guard before activating dynamic scaling.

---

### 3. Implementation Steps

1. **Data Model & Schema (`worker/src/types.ts` & `SharedPoolDO.ts`)**:
   - Extended `ProviderCircuitState` with `emaMsPerToken: number` and `sampleCount: number`.
   - Created `provider_metrics` table in DO SQLite:
     ```sql
     CREATE TABLE IF NOT EXISTS provider_metrics (
       route_id TEXT PRIMARY KEY,
       ema_ms_per_token REAL NOT NULL,
       sample_count INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );
     ```
   - Added `loadProviderMetrics()` in DO constructor to hydrate in-memory metrics on startup (0 SQLite reads on hot request path).

2. **Token-Scaled Adaptive Timeout (`SharedPoolDO.ts`)**:
   - `sampleCount < 3` (Learning Phase): Enforces `route.defaultTimeoutMs` to avoid cold-start jitter.
   - `sampleCount >= 3` (Trained Phase): Computes dynamic timeout:
     $$\text{expectedTime} = 600\text{ms} + (\text{estimatedTokens} \times \text{emaMsPerToken})$$
     $$\text{timeout} = \text{clamp}(\text{round}(\text{expectedTime} \times 1.5), 2000\text{ms}, 6000\text{ms})$$
   - Bound to the total 12.5s waterfall budget.

3. **Success-Only Outcome Recording & Outlier Guard (`SharedPoolDO.ts`)**:
   - Only HTTP 200 successes update the EMA rate and increment `sampleCount`.
   - Outlier guard clamps individual run samples to $[2, 50]\text{ms/token}$ before $\alpha = 0.3$ smoothing.
   - Failures (429, 408, 500) only trip the circuit breaker and never contaminate the speed average.
   - Each success writes an SQLite upsert (`provider_metrics`) to persist across worker sleep.

4. **Testing & Deployment**:
   - Added unit tests in `worker/test/router.test.ts` verifying warm-up fallback, token scaling, outlier clamping, and error exclusion.
   - All 21 worker tests pass.
   - Merged to `main` and deployed live to `api.12094852.xyz` via `wrangler deploy`.

---

### 4. Roadblocks & Decisions
* **Zero Disk Reads During Requests**: Preloading all 9 provider metrics into `providerMetricsCache` on DO instantiation guarantees in-memory speed with zero storage reads during translation execution.
* **Separation of Speed vs. Availability**: Rate limits (429) and network drops (5xx) must not be treated as "fast" responses despite their low latency. Isolating EMA updates strictly to successful completions maintains true inference speed calibration.

---

### 5. Next Steps
* Monitor live logs on `api.12094852.xyz` as user traffic exercises different manga density levels.
