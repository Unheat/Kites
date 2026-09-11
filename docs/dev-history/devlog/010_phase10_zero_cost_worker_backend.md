# Devlog: Zero-Cost Translation Backend & Durable Objects Pool

* **Date:** 2026-09-04
* **Feature/Task:** Phase 10: Cloudflare Worker Zero-Cost Translation Pool with Durable Objects
* **Ticket/Issue Link:** N/A
* **Status:** Completed

---

## Objective

Build a zero-cost, high-reliability serverless translation proxy for Kites extension users using Cloudflare Workers and Durable Objects. The backend aggregates multiple free-tier LLM providers (Mistral 3B, Google Gemini, Cloudflare Workers AI, Groq, OpenRouter) and enforces strict per-user rolling 24-hour rate limits (100 requests/day) authenticated via Google OAuth.

---

## Workflow & Implementation Steps

1. **Durable Object Quota Authority (`worker/src/durable/SharedPoolDO.ts`):** Implemented `SharedPoolDO` backed by SQLite inside Cloudflare Durable Objects. Tracked rolling 24-hour sliding request timestamps per user ID (`sub`), enforcing the 100 requests/24h ceiling.
2. **Two-Layer Rate Limiter:**
   * *Layer 1 (Proactive sliding windows):* Tracks requests per second (RPS), requests per minute (RPM), and requests per day (RPD) in memory before dispatching requests.
   * *Layer 2 (Reactive smart cooldowns):* Catches upstream HTTP 429 (rate limit) and 402 (quota exceeded) errors and dynamically puts failing providers on cooldown (2s for RPS, 60s for RPM, UTC midnight for daily quota).
3. **Provider Adapters (`worker/src/adapters/`):**
   * Implemented normalized adapters for OpenAI-compatible, Google Gemini (`generateContent`), and Cloudflare Workers AI.
   * Filtered internal reasoning/thought chunks from Gemini responses to avoid returning raw chain-of-thought to users.
   * Elevated Mistral 3B as priority 1 with 10 RPS limit; demoted low-quality 1B models.
4. **Authentication & Token Verification (`worker/src/auth/`):** Built pluggable authentication strategies verifying Google OAuth access tokens (`ya29...`) against Google UserInfo and OIDC ID tokens.
5. **Client Engine (`src/offscreen/engines/translation/CloudflareTranslateEngine.ts`):** Connected the extension offscreen document to `/v1/chat/completions` on the worker, routing Google auth tokens retrieved from the background service worker.
6. **Local-Only Fallback Guard:** Added `CloudflarePoolExhaustedError` handling in `TranslationManager`: when the shared pool is exhausted, the engine prunes external APIs from the waterfall and continues strictly with local on-device models.

---

## Roadblocks & Decisions

### Offscreen Document chrome.identity Restriction

* **The Problem:** Chrome extensions disallow `chrome.identity` access inside Offscreen Documents.
* **The Solution:** Offscreen document sends a runtime message `GET_AUTH_TOKEN` to the Background Service Worker, which acquires the interactive/cached Google token and returns it over internal message passing.

### Gemini 2.0 Thinking Chunks Leaking into Translation

* **The Problem:** Newer Gemini models output thinking tokens inside `candidates[0].content.parts`, causing internal reasoning text to appear in speech bubbles.
* **The Solution:** Filtered parts in `gemini.ts` using `part.thought !== true` and concatenated only true content parts.

---

## Verification

* Unit tests in `worker/test/quota.test.ts`, `worker/test/auth.test.ts`, and `worker/test/router.test.ts` verified quota math, rate limit sliding windows, and adapter transformations.
* Integration tests in `src/offscreen/engines/translation/CloudflareTranslateEngine.test.ts` verified batch delimiter parsing and local-only fallback pruning on pool exhaustion.

---

## Next Steps / Key Takeaways

* **Key Takeaway:** Durable Objects with embedded SQLite provide a lightweight, zero-maintenance authority for rolling rate limits without spinning up external Redis or PostgreSQL clusters.
* **Next Action:** Add client-side account display and sign-in status in the popup settings view.
