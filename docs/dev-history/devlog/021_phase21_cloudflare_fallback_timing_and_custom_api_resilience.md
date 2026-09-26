# Devlog 021: Cloudflare Fallback Timing and Translation Waterfall Resiliency

### 1. Metadata
* **Date:** 2026-09-26
* **Feature/Task:** Cloudflare Worker Fallback Timing & TranslationManager Waterfall Resiliency
* **PR:** [#11](https://github.com/Unheat/Kites/pull/11)
* **Status:** Completed

---

### 2. Objective
Address timing mismatches and provider fallback edge cases across the Cloudflare Worker microservice (`api.12094852.xyz`) and the client extension's `TranslationManager`. Ensure that when Cloudflare's free pool exhausts, user-configured Custom APIs (OpenAI, Claude) and Google Translate remain intact in the fallback chain rather than being prematurely discarded.

---

### 3. Implementation Steps

#### Cloudflare Worker Backend (`worker/src`):
1. **Total Waterfall Time Budget (`SharedPoolDO.ts`)**:
   - Added `MAX_TOTAL_WATERFALL_MS = 12_500` to establish a strict deadline across sequential provider attempts.
   - If the remaining budget drops below `MIN_TIMEOUT_MS` (2000ms), the waterfall exits early and returns HTTP 502 with `code: 'all_providers_cooling_down'`.
   - Guarantees the server responds cleanly with a JSON error payload within ~12.5 seconds, preventing the client's 15-second `AbortController` from firing an unexpected socket abort.
2. **Stream Reading Timeout Protection (`openai-compatible.ts` & `gemini.ts`)**:
   - Moved `clearTimeout(timer)` into `finally` blocks so that `await response.text()` and `await response.json()` network body reads remain covered by the abort signal.
3. **Workers AI Native Adapter Timeout (`workers-ai.ts`)**:
   - Replaced passive `AbortController` with `Promise.race` against an explicit `timeoutPromise` that throws `AbortError` after `timeoutMs`.
4. **Transient 408 Timeout Cooldown (`SharedPoolDO.ts`)**:
   - Explicitly mapped HTTP 408 to a short 5-second circuit cooldown (15s on consecutive failures) and adjusted `circuit.emaLatencyMs` upward.
5. **Deployment**:
   - Verified 18 unit tests in `worker/test/`.
   - Merged directly to `main` and deployed live to `api.12094852.xyz` via `wrangler deploy`.

#### Client Extension (`src/offscreen/services/`):
1. **Removed Over-Engineered Fallback Pruning (`TranslationManager.ts`)**:
   - Removed the `if (error instanceof CloudflarePoolExhaustedError)` block that was filtering `engineSequence` to only WebLLM and `chrome-translator`.
   - Now follows a pure waterfall: failures log a warning and proceed directly to the next engine in the sequence (preserving Custom APIs and Google Translate).
2. **Detailed Error Logging**:
   - Included `${errorMsg}` and the raw error object in waterfall warnings and terminal failure messages.
3. **Unit Tests**:
   - Added test in `TranslationManager.test.ts` verifying Custom API fallback execution after a Cloudflare engine failure.
   - All 311 unit tests pass; production build succeeds cleanly.

---

### 4. Roadblocks & Decisions
* **Upfront User Quota Consumption**: Retained the upfront `checkAndConsumeQuota()` write in `SharedPoolDO.ts`. While failing requests consume 1 credit of the 100 daily free allowance, this is an intentional anti-abuse mechanism to prevent malicious/buggy clients from executing unbounded retry loops that exhaust Cloudflare's 100k daily API request limit.
* **Mistral Rate Limit Evaluation**: Analyzed Mistral's 429 cooldown. Because Mistral AI free tier is purely rate-limited per-second (10 RPS) and does not enforce an RPM cap, assigning a 2-second cooldown on 429 when `route.rpsLimit` is present is mathematically correct. Daily quota exhaustion and `Retry-After` headers are handled by earlier precedence checks.

---

### 5. Next Steps
* Merge PR #11 into `main` and include in next extension version bump.
