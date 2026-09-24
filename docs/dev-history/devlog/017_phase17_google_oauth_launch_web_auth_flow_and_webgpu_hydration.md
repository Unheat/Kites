### Date: 2026-09-24

* **Feature/Task:** Phase 17: Interactive Google OAuth WebAuthFlow Migration & Zero-Stall WebGPU Hydration
* **Issue Link:** [Issue #4: Fix Google Sign-in Error 400: invalid_request](https://github.com/Unheat/Kites/issues/4)
* **PR:** [PR #5: fix(auth): resolve invalid request sign-in error via launchWebAuthFlow](https://github.com/Unheat/Kites/pull/5)
* **Status:** Completed

---

### Objective

Resolve Google Sign-In failures (`Error 400: invalid_request`, `bad client id`, `Only one web auth flow is allowed at a time`) across Brave, Edge, Arc, and non-synced Chrome profiles by migrating from profile-dependent `chrome.identity.getAuthToken` to standard interactive `chrome.identity.launchWebAuthFlow`. In addition, eliminate popup loading flash (`[...]`) and Vite HMR "zombie offscreen" RPC stalls by introducing cache-first WebGPU capability hydration with a defensive 3-second RAM-only timeout guard.

---

### Incident & Root Cause Analysis

#### 1. Google OAuth Sign-in Failure on Non-Chrome Browsers (`Error 400: invalid_request`)
* **Symptom:** Users running Chromium derivatives (Brave, Edge, Arc, Opera) or Chrome profiles without Google Sync encountered `Error 400: invalid_request` (*"Access blocked: Kites Translator's request is invalid"*) upon clicking "Sign in with Google".
* **Root Cause:** `chrome.identity.getAuthToken` relies on the host browser's native profile sync subsystem. Non-Chrome browsers either lack Google account sync or restrict internal token issuance, causing the underlying Chrome Identity API to reject the request.

#### 2. Downstream OAuth Pitfalls (`bad client id` & `Only one web auth flow allowed`)
* **Pitfall A (`bad client id`):** Chrome extension `manifest.json` requires `oauth2.client_id` to strictly match a Google Cloud OAuth Client ID of type **"Chrome extension"**. When a **"Web application"** Client ID was inserted into `manifest.json`, `getAuthToken` threw `OAuth2 request failed: Service responded with 'bad client id'`.
* **Pitfall B (`Only one web auth flow is allowed at a time`):** Chromium's C++ `IdentityAPI` enforces a hard limit of **one** active WebAuthFlow across the extension runtime. `getValidToken()` previously executed silent `launchWebAuthFlow({ interactive: false })` during extension startup, popup mount, and quota polling. If the redirect URI was misconfigured or Google required user interaction, the headless WebContents remained hung in the background. When the user clicked "Sign in with Google", Chromium rejected the new user flow with `Error: Only one web auth flow is allowed at a time`.
* **Pitfall C (Fallback Degradation):** Catch blocks treated `Only one web auth flow is allowed at a time` as a network error and degraded to `getAuthToken`, re-triggering the original `invalid_request` loop.

#### 3. Popup WebGPU Acceleration Stall (`[...]` Flash in Dev)
* **Symptom:** In long-running development sessions (`npm run dev` running for 2+ hours), opening the popup left GPU Acceleration stuck on `[...]` with disabled toggle buttons.
* **Root Cause:** `DEFAULT_POPUP_STATE.webgpuSupported` was initialized to `null`. On every popup open, `index.tsx` dispatched `CHECK_WEBGPU_SUPPORT` (Popup $\rightarrow$ Background $\rightarrow$ Offscreen). Under Vite HMR, repeated source rebuilds and extension reloads can disconnect the offscreen document from Vite's WebSocket server while Chrome reports `chrome.offscreen.hasDocument() === true` ("Zombie Offscreen"). The unhandled RPC message hung indefinitely, leaving the popup stuck at `webgpuSupported: null`.

---

### Implementation & Architecture

```
[ Popup Mount (0ms) ]
         │
         ├──> Reads chrome.storage.local: hardware_webgpu_supported
         │         │
         │         ├── [ true ] ──> setState({ webgpuSupported: true }) [0ms, Instant Green Supported✓]
         │         │               (No Offscreen RPC sent! Bypasses Zombie Offscreen)
         │         │
         │         └── [ null / unset ] ──> Launch CHECK_WEBGPU_SUPPORT with 3000ms Timeout
         │                                       │
         │                                       ├── Success ──> Save true to storage & RAM
         │                                       └── Timeout/Error ──> setState({ webgpuSupported: false }) in RAM only!
         │                                                            (Never writes false to storage)
         │
[ User clicks "Sign in with Google" ]
         │
         ├──> In-Flight Deduplication Check (signInPromise)
         │
         ├──> chrome.identity.launchWebAuthFlow (interactive: true)
         │         │ URL: https://accounts.google.com/o/oauth2/v2/auth
         │         │ Client ID: GOOGLE_WEB_CLIENT_ID (Web Application)
         │         │ Redirect: https://<ext-id>.chromiumapp.org/
         │         │ Prompt: select_account
         │         │
         │         ├── Success ──> Extract token & expires_in from hash
         │         │              Cache token in storage & fetch User Profile
         │         │
         │         └── Active Flow Guard: If "Only one web auth flow", reject without getAuthToken fallback
```

#### 1. Dual OAuth Client Strategy
* **`manifest.json`:** Preserves the Chrome Extension Client ID (`13839997652-1pfe7h8arhiqlvh3dtn81tc5aibh8pnm.apps.googleusercontent.com`) dedicated exclusively to native `chrome.identity.getAuthToken`.
* **`GoogleOAuthStrategy.ts`:** Uses a separate Web Application Client ID (`GOOGLE_WEB_CLIENT_ID = '13839997652-td8d1oi4ev72shdts4c0ua5gorkoktu2.apps.googleusercontent.com'`) for `chrome.identity.launchWebAuthFlow`, configured with `https://<extension-id>.chromiumapp.org/` in Google Cloud Console.
* **Account Selection:** Added `prompt=select_account` to the auth URL to prevent Google from silently binding to the first logged-in Chrome profile.

#### 2. Concurrency Control & Active Flow Guard
* **In-Flight Deduplication:** Implemented `signInPromise` in `GoogleOAuthStrategy.ts`. Rapid double-clicks by the user reuse the existing in-flight promise rather than attempting concurrent WebAuthFlows.
* **Silent Auth Elimination:** Removed all background calls to `launchWebAuthFlow({ interactive: false })`. `getValidToken()` now strictly performs local cache validation or silent `getAuthToken({ interactive: false })`.
* **Guard against False Fallback:** Explicitly detects `Only one web auth flow is allowed at a time` and user cancellation (`user closed the window`), rejecting cleanly without falling back to `getAuthToken`.

#### 3. Token Lifecycle & Remote Revocation
* Implemented `googleAuthUtils.ts` providing URL hash parsing, token expiration computation (`Date.now() + expiresIn * 1000`), and RFC 7009 token revocation via `https://oauth2.googleapis.com/revoke` on sign-out.

#### 4. Zero-Stall WebGPU Cache Hydration
* **Cache-First Hydration:** In `src/popup/index.tsx`, popup checks `hardware_webgpu_supported` in `chrome.storage.local`. If `true`, it immediately sets `webgpuSupported: true` at Frame 0, completely skipping any RPC to Offscreen.
* **3-Second Defensive Timeout:** In `src/popup/index.tsx` and `GpuAccelerationPanel.tsx`, live hardware probes are wrapped in a 3000ms timeout. If Offscreen hangs or errors, the UI falls back to `webgpuSupported: false` in RAM only.
* **Storage Invariant Preservation:** Enforced invariant from Devlog 015 (*"Cache verified true only; never persist transient false"*). Both `updateState()` and background's `normalizePopupState()` sanitize `webgpuSupported` to `newState.webgpuSupported === true ? true : null` before persisting to `chrome.storage.local`.

---

### Verification & Testing

1. **Unit Test Coverage:**
   * `src/background/auth/googleAuthUtils.test.ts`: 11 tests covering URL parsing, error query detection, token expiry math, and revocation network failure resilience.
   * `src/background/auth/GoogleOAuthStrategy.test.ts`: 11 tests covering interactive sign-in, concurrent deduplication, active flow error handling, cancellation, cache retrieval, and remote sign-out.
   * `src/background/normalizePopupState.test.ts`: 3 tests verifying state normalization, preset repair, and WebGPU override preservation.
   * **Full Test Suite:** 36 test files passed, 282/282 tests passing (0 failures).
2. **Build Verification:**
   * Production bundle built via `npm run build` with zero errors in 1.55s.
3. **Manual Verification:**
   * Google sign-in launches account chooser modal, grants token, fetches profile name/picture, and displays remaining quota in popup.
   * Popup opens instantly with `Supported✓` green badge at Frame 0 without any `[...]` loading flash or dev stalls.

### Addendum: Offscreen OAuth Token Retrieval & Sign-Out Fallback

1. **Direct Storage Retrieval for Offscreen Worker:**
   * In Manifest V3, the translation pipeline executes inside the Offscreen Document (`src/offscreen/`).
   * Previously, `CloudflareTranslateEngine` requested the Google ID/access token from the Background Service Worker via `chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN' })`.
   * Unaddressed or unrouted inter-process messaging across contexts could fail or resolve to `{}` under high load, causing the translation engine to dispatch HTTP POST requests to `https://api.12094852.xyz/v1/chat/completions` without an `Authorization` header, triggering a cryptic 401 `missing_token` error.
   * Because both Background and Offscreen share the same extension origin, `CloudflareTranslateEngine.getAuthToken()` now checks `chrome.storage.local` directly (`kites_oauth_auth_token` and `kites_oauth_token_expires_at`). This provides zero-latency synchronous access to valid tokens and eliminates inter-process message drops.
   * If unauthenticated, `CloudflareTranslateEngine` now throws a clear, actionable error (`Please sign in with Google in Settings to use Cloudflare Translate.`) instead of firing an empty request.

2. **Auto-Fallback on Sign-Out:**
   * When a user signs out via `SIGN_OUT_GOOGLE` / `SIGN_OUT_AUTH`, `src/background/index.ts` and `SettingsView.tsx` now immediately check if `activeEngineId === 'cloudflare-translate'`.
   * If so, `activeEngineId` is automatically reset to `DEFAULT_POPUP_STATE.activeEngineId` (`gg-translate`), and `cloudflare-translate` is filtered out of `fallbackChain`.
   * `normalizePopupState` also asserts that `cloudflare-translate` can only be considered a supported engine if `userAccount.signedIn === true`.

---

### Key Takeaways

1. **Never conflate Extension and Web OAuth Client IDs:** Chrome's `manifest.json` parser validates client ID types against Google's OAuth2 backend. Keep Extension Client IDs for `getAuthToken` and Web Application Client IDs for `launchWebAuthFlow`.
2. **Chromium WebAuthFlow is a Singleton:** Never run `launchWebAuthFlow` in background polling loops; reserve it strictly for explicit user gestures.
3. **Hardware Capabilities are Quasi-Static:** Hardware support rarely changes within a browser session. Probing hardware on every popup mount introduces needless RPC latency and vulnerability to background context lifecycles. Cache verified success and rely on explicit user re-checks for hardware re-probing.
4. **Share State via `chrome.storage.local` Over Fragile RPCs:** When background, popup, and offscreen contexts need shared credentials or static tokens, read directly from `chrome.storage.local` rather than creating complex, error-prone message-passing bridges.
