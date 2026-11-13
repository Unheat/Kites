### Date: 2026-11-13

* **Feature/Task:** Community pool 401 (`invalid_token`) on Cloudflare Translate after the first hour of a signed-in session
* **Status:** Completed (worker-side; extension code unchanged)

### Objective

A translation job failed with `Cloudflare translate request failed (401): Authentication failed: Invalid or expired token` and the watermark fell back to the next engine, so translation silently never happened. Determine whether the gateway was down for everyone, and decide between a Worker-only fix and an extension release.

### Incident & Root Cause Analysis

1. **Where the 401 came from:** the message is the sanitized output of `authenticateProtectedRequest` in `worker/src/http/auth-guard.ts` after `authManager.verifyToken()` threw a genuine client rejection. It is not `missing_token`, not the edge rate limiter (that answers 429/403), and not `server_misconfigured` (500). So a non-empty Bearer token arrived and genuinely failed verification: expired, revoked, or wrong audience.
2. **Two OAuth clients, one accepted audience:** the extension signs in with `chrome.identity.launchWebAuthFlow` using the Web Application client (`GOOGLE_WEB_CLIENT_ID`), but `getValidToken()` silently refreshes an expired token with `chrome.identity.getAuthToken`, which mints a token for the Chrome Extension client from `manifest.json`. Google stamps the minting client into the token audience (`aud`/`issued_to`). The Worker had a single `GOOGLE_CLIENT_ID` binding, so whichever client it held, tokens from the other client were rejected as `invalid_token`.
3. **Why it looks like "Cloudflare broke":** the failure is time-correlated, not request-correlated. The interactive token is valid for ~60 minutes and works; once it expires, the silent refresh path returns an extension-client token the gateway refuses. `CloudflareTranslateEngine` purges the token from `chrome.storage.local` on 401, but Chrome still holds the same cached token, so every subsequent request re-sends it and 401s again for up to the rest of the hour. The failure therefore repeats across jobs and pages and only heals after a fresh interactive sign-in.
4. **Why this is not one machine:** it is a property of the auth contract between the two Google clients and the single-audience check, so any user who keeps Cloudflare Translate active past the first token lifetime reaches the same path. It is not an AI provider outage, a quota exhaustion (`all_providers_cooling_down` / `quota_exhausted` have their own codes), or a corrupted local profile.

### Workflow & Implementation Steps

1. **Traced the client token source** in `CloudflareTranslateEngine.getAuthToken()` → `chrome.storage.local` → `GET_AUTH_TOKEN` → `GoogleOAuthStrategy.getValidToken()`, confirming the silent refresh is the only path that can mint a token from the second client.
2. **Generalized audience matching to an allowlist:** `normalizeAcceptedClientIds()` in `worker/src/auth/tokeninfo.ts` trims, de-duplicates, and drops blank candidates; `normalizeAndMatchAudience()` now accepts `string | readonly string[]` and still fails closed on malformed types, empty claims, and any claim outside the allowlist.
3. **Applied the allowlist to both verification paths:** `getAcceptedClientIds(env)` builds the list from `GOOGLE_CLIENT_ID` plus the new optional `GOOGLE_EXTENSION_CLIENT_ID`; `verifyGoogleIdToken()` (RS256 OIDC path) and the `ya29.` tokeninfo path both consume it. Multi-audience ID tokens still require `azp` to be inside the allowlist.
4. **Added server-side rejection logging:** the genuine-invalid branch of `auth-guard.ts` now emits `{"event":"auth_rejected","requestId":…,"reason":<verifier message>}`. The message is an error string (for example `Token audience mismatch: expected …`), never the bearer token, and it is the only way to tell expiry from audience mismatch, since the client response is deliberately generic.
5. **Configured both audiences on production:** `GOOGLE_CLIENT_ID` = Web Application client, `GOOGLE_EXTENSION_CLIENT_ID` = Chrome Extension client, then deployed version `aea5cf80-7de6-42ed-8426-2c951680c387` at 100%.
6. **Verified:** `npm --prefix worker test` (115 tests passing; `test/quota.test.ts` fails to collect on this machine because `node:sqlite` is unavailable in the local Node build, unrelated to this change) and `npx tsc --noEmit` clean. `GET /health` returns 200, a bogus Bearer token returns 401 with the sanitized body, and `wrangler tail` captured `auth_rejected … "Invalid Google access token (HTTP 400)"`, proving the new log line reaches production.

### Roadblocks & Decisions

* **The Problem:** the client response is intentionally generic, so the actual rejection reason was invisible from both the extension console and the browser.
* **The Solution:** accept both client IDs at the gateway and log the verifier's reason server-side. Rejected alternative: shipping an extension update that re-mints a Web-client token on 401 — it needs a store review, and the gateway would still be inconsistent with how the client actually refreshes tokens.
* **Reasoning:** both clients live in the same Google Cloud project and identify the same Google user (`sub` is stable across them), so the quota hash is unchanged. Accepting a second audience does not widen the trust boundary to anyone outside the project; rejecting it only broke legitimate long sessions.
* **Cost check:** one extra string comparison per audience claim; no extra network call, no extra storage.

### Next Steps / Key Takeaways

* **Takeaway:** an OAuth gateway must accept every client that its own client app can mint tokens from — otherwise auth works until the first silent refresh.
* **Takeaway:** keep the client-facing 401 generic, but always log the verifier reason on the server; a 401 wave is otherwise undiagnosable from user reports.
* **Invariant:** `GOOGLE_EXTENSION_CLIENT_ID` must track `manifest.json`'s `oauth2.client_id`, and `GOOGLE_CLIENT_ID` must track `GOOGLE_WEB_CLIENT_ID`. Rotating either client without updating the Worker binding silently reintroduces this failure.
